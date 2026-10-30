//! Hooks do Cooper nos agentes, para a presença "Executando" observada:
//! - Claude Code: ~/.claude/settings.json → "hooks";
//! - Codex: ~/.codex/hooks.json, mesmo formato (doc oficial, consultada em 30/10/2026: learn.chatgpt.com/docs/hooks).
//!   O Codex só roda hooks depois de a pessoa aprová-los uma vez com /hooks.
//! `preview_agent_hooks` só descreve; `install_agent_hooks` roda depois da confirmação no widget, com backup.
//! Os hooks de outras ferramentas ficam intactos: só entram e saem as entradas cujo comando contém MARK.
//! A conexão do script (url, chave pública, token do agente) é copiada da entrada "cooper" da configuração MCP
//! do agente para ~/.cooper/hook-<agente>.json; por isso o agente precisa estar conectado antes.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::claude_statusline::{save, settings_path};
use crate::paths::{backup, cooper_dir, write_atomic};

const MARK: &str = "cooper-hook";
/// Eventos com hook do Cooper. PreToolUse cobre "usando ferramentas"; Stop devolve para "online".
const EVENTS: [&str; 3] = ["UserPromptSubmit", "PreToolUse", "Stop"];

#[derive(Clone, Copy, PartialEq)]
enum Agent {
    Claude,
    Codex,
}

fn agent(kind: &str) -> Result<Agent, String> {
    match kind {
        "claude_code" => Ok(Agent::Claude),
        "codex" => Ok(Agent::Codex),
        _ => Err("agente sem suporte a hooks".into()),
    }
}

const fn slug(a: Agent) -> &'static str {
    match a {
        Agent::Claude => "claude_code",
        Agent::Codex => "codex",
    }
}

const fn label(a: Agent) -> &'static str {
    match a {
        Agent::Claude => "Claude Code",
        Agent::Codex => "Codex",
    }
}

#[derive(Serialize)]
pub struct HooksPlan {
    pub file: String,
    pub installed: bool,
    pub events: Vec<String>,
    pub command: String,
    /// quantos hooks de outras ferramentas existem nesses eventos (continuam como estão)
    pub others: usize,
    pub backup: Option<String>,
}

fn codex_dir() -> Result<PathBuf, String> {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))
        .ok_or_else(|| "pasta do usuário não encontrada".into())
}

fn hooks_file(a: Agent) -> Result<PathBuf, String> {
    match a {
        Agent::Claude => settings_path(),
        Agent::Codex => Ok(codex_dir()?.join("hooks.json")),
    }
}

fn read_file(a: Agent) -> Result<(PathBuf, String, Value), String> {
    let path = hooks_file(a)?;
    let raw = if path.exists() { fs::read_to_string(&path).map_err(|e| e.to_string())? } else { "{}".into() };
    let root: Value = serde_json::from_str(&raw).map_err(|e| format!("{} inválido: {e}", path.display()))?;
    if !root.is_object() {
        return Err(format!("{} não é um objeto", path.display()));
    }
    Ok((path, raw, root))
}

fn our_command(app: &AppHandle, a: Agent) -> Result<String, String> {
    let p = app
        .path()
        .resolve("mcp/cooper-hook.js", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let s = p.display().to_string();
    let s = s.trim_start_matches(r"\\?\").replace('\\', "/");
    if s.contains('"') {
        return Err("caminho do script inesperado".into());
    }
    Ok(format!("node \"{s}\" {}", slug(a)))
}

fn is_ours(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| hs.iter().any(|h| h.get("command").and_then(Value::as_str).is_some_and(|c| c.contains(MARK))))
}

fn groups<'a>(root: &'a Value, event: &str) -> impl Iterator<Item = &'a Value> {
    root.get("hooks").and_then(|h| h.get(event)).and_then(Value::as_array).into_iter().flatten()
}

fn installed(root: &Value) -> bool {
    EVENTS.iter().all(|e| groups(root, e).any(is_ours))
}

fn others(root: &Value) -> usize {
    EVENTS.iter().map(|e| groups(root, e).filter(|g| !is_ours(g)).count()).sum()
}

/// Tira as entradas do Cooper dos eventos; apaga listas e o objeto "hooks" que ficarem vazios.
fn strip_ours(root: &mut Value) {
    let Some(hooks) = root.get_mut("hooks").and_then(Value::as_object_mut) else { return };
    for e in EVENTS {
        if let Some(list) = hooks.get_mut(e).and_then(Value::as_array_mut) {
            list.retain(|g| !is_ours(g));
            if list.is_empty() {
                hooks.remove(e);
            }
        }
    }
    if hooks.is_empty() {
        root.as_object_mut().unwrap().remove("hooks");
    }
}

/// (url, anon, token) da entrada "cooper" que o app gravou ao conectar o agente.
fn connection(a: Agent) -> Result<(String, String, String), String> {
    let missing = || format!("conecte o {} ao Cooper primeiro (⚙ → Agentes)", label(a));
    let three = |f: &dyn Fn(&str) -> Option<String>| -> Result<(String, String, String), String> {
        Ok((
            f("COOPER_SUPABASE_URL").ok_or_else(missing)?,
            f("COOPER_SUPABASE_ANON_KEY").ok_or_else(missing)?,
            f("COOPER_TOKEN").ok_or_else(missing)?,
        ))
    };
    match a {
        Agent::Claude => {
            let path = dirs::home_dir().ok_or("pasta do usuário não encontrada")?.join(".claude.json");
            let raw = fs::read_to_string(&path).map_err(|_| missing())?;
            let root: Value = serde_json::from_str(&raw).map_err(|e| format!("~/.claude.json inválido: {e}"))?;
            let env = root.pointer("/mcpServers/cooper/env").ok_or_else(missing)?;
            three(&|k| env.get(k).and_then(Value::as_str).map(String::from))
        }
        Agent::Codex => {
            let raw = fs::read_to_string(codex_dir()?.join("config.toml")).map_err(|_| missing())?;
            let doc: toml_edit::DocumentMut = raw.parse().map_err(|e| format!("config.toml inválido: {e}"))?;
            let env = doc.get("mcp_servers").and_then(|m| m.get("cooper")).and_then(|c| c.get("env")).ok_or_else(missing)?;
            three(&|k| env.get(k).and_then(|v| v.as_str()).map(String::from))
        }
    }
}

/// Copia a conexão para o script do hook (~/.cooper/hook-<agente>.json).
fn write_connection(a: Agent) -> Result<(), String> {
    let (url, anon, token) = connection(a)?;
    let dir = cooper_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let cfg = json!({ "url": url, "anon": anon, "token": token });
    write_atomic(&dir.join(format!("hook-{}.json", slug(a))), &serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)
}

fn plan(path: &Path, root: &Value, command: String, backup: Option<String>) -> HooksPlan {
    HooksPlan {
        file: path.display().to_string(),
        installed: installed(root),
        events: EVENTS.iter().map(|e| e.to_string()).collect(),
        command,
        others: others(root),
        backup,
    }
}

#[tauri::command]
pub fn preview_agent_hooks(app: AppHandle, kind: String) -> Result<HooksPlan, String> {
    let a = agent(&kind)?;
    let (path, _, root) = read_file(a)?;
    Ok(plan(&path, &root, our_command(&app, a)?, None))
}

#[tauri::command]
pub fn install_agent_hooks(app: AppHandle, kind: String) -> Result<HooksPlan, String> {
    let a = agent(&kind)?;
    let (path, raw, mut root) = read_file(a)?;
    let command = our_command(&app, a)?;
    write_connection(a)?;
    strip_ours(&mut root); // reinstalar troca o caminho sem duplicar
    let obj = root.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("\"hooks\" não é um objeto")?;
    for e in EVENTS {
        let list = hooks.entry(e).or_insert_with(|| json!([]));
        let list = list.as_array_mut().ok_or(format!("hooks.{e} não é uma lista"))?;
        list.push(json!({ "hooks": [{ "type": "command", "command": command, "timeout": 5 }] }));
    }
    let backup = backup(&path)?;
    save(&path, &raw, &root)?;
    Ok(plan(&path, &root, command, backup))
}

#[tauri::command]
pub fn remove_agent_hooks(app: AppHandle, kind: String) -> Result<HooksPlan, String> {
    let a = agent(&kind)?;
    let (path, raw, mut root) = read_file(a)?;
    if !EVENTS.iter().any(|e| groups(&root, e).any(is_ours)) {
        return Err("os hooks do Cooper não estão instalados".into());
    }
    strip_ours(&mut root);
    let backup = backup(&path)?;
    save(&path, &raw, &root)?;
    let _ = fs::remove_file(cooper_dir()?.join(format!("hook-{}.json", slug(a))));
    Ok(plan(&path, &root, our_command(&app, a).unwrap_or_default(), backup))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instala_e_remove_sem_mexer_nos_outros() {
        let mut root = json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "say pronto" }] }] }, "model": "x" });
        assert_eq!(others(&root), 1);
        let hooks = root["hooks"].as_object_mut().unwrap();
        for e in EVENTS {
            hooks.entry(e).or_insert_with(|| json!([])).as_array_mut().unwrap().push(json!({ "hooks": [{ "command": "node \"/x/cooper-hook.js\" codex" }] }));
        }
        assert!(installed(&root));
        strip_ours(&mut root);
        assert!(!installed(&root));
        assert_eq!(root, json!({ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "say pronto" }] }] }, "model": "x" }));
    }

    #[test]
    fn remove_objeto_hooks_vazio() {
        let mut root = json!({ "hooks": { "PreToolUse": [{ "hooks": [{ "command": "node cooper-hook.js" }] }] } });
        strip_ours(&mut root);
        assert_eq!(root, json!({}));
    }

    #[test]
    fn so_claude_e_codex() {
        assert!(agent("claude_code").is_ok() && agent("codex").is_ok());
        assert!(agent("cursor").is_err());
    }
}
