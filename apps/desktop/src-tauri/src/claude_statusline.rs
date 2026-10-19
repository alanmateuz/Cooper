//! Instala a status line do Cooper no Claude Code (~/.claude/settings.json), para ler os limites de 5 h e semana.
//! `preview_claude_statusline` só descreve o que vai acontecer; `install_claude_statusline` roda depois da
//! confirmação no widget, com backup. Testado em 2026-10-18: o Claude Code do terminal (v2.1.299) roda a status line;
//! o app desktop do Claude (aba Code) não roda, então lá os limites não chegam.
//! Uma status line que já existia é guardada em ~/.cooper/statusline.json:
//! o script do Cooper repassa o JSON para ela, e `remove_claude_statusline` a devolve ao lugar.

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::paths::{backup, cooper_dir, write_atomic};

const MARK: &str = "cooper-statusline";

#[derive(Serialize)]
pub struct StatusLinePlan {
    pub file: String,
    /// a status line do Cooper já está configurada
    pub installed: bool,
    /// comando da status line atual que será mantida (repassada), se houver
    pub previous: Option<String>,
    /// comando que será gravado
    pub command: String,
    pub backup: Option<String>,
}

fn settings_path() -> Result<PathBuf, String> {
    let base = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".claude")))
        .ok_or("pasta do usuário não encontrada")?;
    Ok(base.join("settings.json"))
}


fn our_command(app: &AppHandle) -> Result<String, String> {
    let p = app
        .path()
        .resolve("mcp/cooper-statusline.js", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let s = p.display().to_string();
    let s = s.trim_start_matches(r"\\?\").replace('\\', "/");
    if s.contains('"') {
        return Err("caminho do script inesperado".into());
    }
    Ok(format!("node \"{s}\""))
}

fn read_settings() -> Result<(PathBuf, String, Value), String> {
    let path = settings_path()?;
    let raw = if path.exists() { fs::read_to_string(&path).map_err(|e| e.to_string())? } else { "{}".into() };
    let root: Value = serde_json::from_str(&raw).map_err(|e| format!("settings.json inválido: {e}"))?;
    if !root.is_object() {
        return Err("settings.json não é um objeto".into());
    }
    Ok((path, raw, root))
}

fn is_ours(v: &Value) -> bool {
    v.get("command").and_then(Value::as_str).is_some_and(|c| c.contains(MARK))
}

fn current_command(root: &Value) -> Option<String> {
    root.get("statusLine").filter(|v| !is_ours(v)).and_then(|v| v.get("command")).and_then(Value::as_str).map(String::from)
}

fn save(path: &PathBuf, raw: &str, root: &Value) -> Result<(), String> {
    let mut out = serde_json::to_string_pretty(root).map_err(|e| e.to_string())?;
    if raw.ends_with('\n') || raw == "{}" {
        out.push('\n');
    }
    write_atomic(path, &out)
}

#[tauri::command]
pub fn preview_claude_statusline(app: AppHandle) -> Result<StatusLinePlan, String> {
    let (path, _, root) = read_settings()?;
    let installed = root.get("statusLine").is_some_and(is_ours);
    Ok(StatusLinePlan { file: path.display().to_string(), installed, previous: current_command(&root), command: our_command(&app)?, backup: None })
}

#[tauri::command]
pub fn install_claude_statusline(app: AppHandle) -> Result<StatusLinePlan, String> {
    let (path, raw, mut root) = read_settings()?;
    let command = our_command(&app)?;
    let existing = root.get("statusLine").cloned();
    let previous = existing.as_ref().filter(|v| !is_ours(v)).cloned();

    // guarda a status line anterior (só na primeira instalação; reinstalar não a perde)
    let dir = cooper_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let chain = dir.join("statusline.json");
    if previous.is_some() || !chain.exists() {
        write_atomic(&chain, &serde_json::to_string_pretty(&json!({ "previous": previous })).map_err(|e| e.to_string())?)?;
    }

    let mut entry = json!({ "type": "command", "command": command });
    if let Some(padding) = existing.as_ref().and_then(|v| v.get("padding")).cloned() {
        entry["padding"] = padding;
    }
    root.as_object_mut().unwrap().insert("statusLine".into(), entry);
    let backup = backup(&path)?;
    save(&path, &raw, &root)?;
    let prev_cmd = previous.as_ref().and_then(|v| v.get("command")).and_then(Value::as_str).map(String::from);
    Ok(StatusLinePlan { file: path.display().to_string(), installed: true, previous: prev_cmd, command, backup })
}

#[tauri::command]
pub fn remove_claude_statusline() -> Result<StatusLinePlan, String> {
    let (path, raw, mut root) = read_settings()?;
    if !root.get("statusLine").is_some_and(is_ours) {
        return Err("a status line do Cooper não está instalada".into());
    }
    let chain = cooper_dir()?.join("statusline.json");
    let previous = fs::read_to_string(&chain)
        .ok()
        .and_then(|r| serde_json::from_str::<Value>(&r).ok())
        .and_then(|v| v.get("previous").cloned())
        .filter(|v| v.is_object());
    let obj = root.as_object_mut().unwrap();
    match &previous {
        Some(p) => obj.insert("statusLine".into(), p.clone()),
        None => obj.remove("statusLine"),
    };
    let backup = backup(&path)?;
    save(&path, &raw, &root)?;
    let _ = fs::remove_file(&chain);
    let prev_cmd = previous.as_ref().and_then(|v| v.get("command")).and_then(Value::as_str).map(String::from);
    Ok(StatusLinePlan { file: path.display().to_string(), installed: false, previous: prev_cmd, command: String::new(), backup })
}
