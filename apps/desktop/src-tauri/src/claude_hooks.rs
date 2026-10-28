//! Hooks do Cooper no Claude Code (~/.claude/settings.json → "hooks"), para a presença "Executando" observada.
//! `preview_claude_hooks` só descreve; `install_claude_hooks` roda depois da confirmação no widget, com backup.
//! Os hooks de outras ferramentas ficam intactos: só entram e saem as entradas cujo comando contém MARK.
//! A conexão do script (url, chave pública, token do agente) é copiada da entrada "cooper" de ~/.claude.json
//! para ~/.cooper/hook.json; por isso o Claude Code precisa estar conectado antes.

use std::fs;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::claude_statusline::{read_settings, save};
use crate::paths::{backup, cooper_dir, write_atomic};

const MARK: &str = "cooper-hook";
/// Eventos com hook do Cooper. PreToolUse cobre "usando ferramentas"; Stop devolve para "online".
const EVENTS: [&str; 3] = ["UserPromptSubmit", "PreToolUse", "Stop"];

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

fn our_command(app: &AppHandle) -> Result<String, String> {
    let p = app
        .path()
        .resolve("mcp/cooper-hook.js", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let s = p.display().to_string();
    let s = s.trim_start_matches(r"\\?\").replace('\\', "/");
    if s.contains('"') {
        return Err("caminho do script inesperado".into());
    }
    Ok(format!("node \"{s}\""))
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

/// Copia a conexão do agente Claude Code (já gravada pelo app em ~/.claude.json) para o script do hook.
fn write_connection() -> Result<(), String> {
    let path = dirs::home_dir().ok_or("pasta do usuário não encontrada")?.join(".claude.json");
    let raw = fs::read_to_string(&path).map_err(|_| "conecte o Claude Code ao Cooper primeiro (⚙ → Agentes)")?;
    let root: Value = serde_json::from_str(&raw).map_err(|e| format!("~/.claude.json inválido: {e}"))?;
    let env = root
        .pointer("/mcpServers/cooper/env")
        .ok_or("conecte o Claude Code ao Cooper primeiro (⚙ → Agentes)")?;
    let get = |k: &str| env.get(k).and_then(Value::as_str).map(String::from).ok_or(format!("{k} ausente na conexão do Claude Code"));
    let cfg = json!({ "url": get("COOPER_SUPABASE_URL")?, "anon": get("COOPER_SUPABASE_ANON_KEY")?, "token": get("COOPER_TOKEN")? });
    let dir = cooper_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join("hook.json"), &serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?)
}

fn plan(path: &std::path::Path, root: &Value, command: String, backup: Option<String>) -> HooksPlan {
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
pub fn preview_claude_hooks(app: AppHandle) -> Result<HooksPlan, String> {
    let (path, _, root) = read_settings()?;
    Ok(plan(&path, &root, our_command(&app)?, None))
}

#[tauri::command]
pub fn install_claude_hooks(app: AppHandle) -> Result<HooksPlan, String> {
    let (path, raw, mut root) = read_settings()?;
    let command = our_command(&app)?;
    write_connection()?;
    strip_ours(&mut root); // reinstalar troca o caminho sem duplicar
    let obj = root.as_object_mut().unwrap();
    let hooks = obj.entry("hooks").or_insert_with(|| json!({}));
    let hooks = hooks.as_object_mut().ok_or("\"hooks\" no settings.json não é um objeto")?;
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
pub fn remove_claude_hooks(app: AppHandle) -> Result<HooksPlan, String> {
    let (path, raw, mut root) = read_settings()?;
    if !EVENTS.iter().any(|e| groups(&root, e).any(is_ours)) {
        return Err("os hooks do Cooper não estão instalados".into());
    }
    strip_ours(&mut root);
    let backup = backup(&path)?;
    save(&path, &raw, &root)?;
    let _ = fs::remove_file(cooper_dir()?.join("hook.json"));
    Ok(plan(&path, &root, our_command(&app).unwrap_or_default(), backup))
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
            hooks.entry(e).or_insert_with(|| json!([])).as_array_mut().unwrap().push(json!({ "hooks": [{ "command": "node \"/x/cooper-hook.js\"" }] }));
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
}
