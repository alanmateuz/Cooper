//! Grava a entrada `cooper` na configuração de usuário do Claude Code (~/.claude.json)
//! ou do Codex (~/.codex/config.toml), sem depender do CLI de cada um.
//! Sempre faz backup antes e preserva o resto do arquivo (ordem das chaves e formatação).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct ConnectResult {
    /// Arquivo alterado.
    pub file: String,
    /// Cópia do arquivo anterior (None se o arquivo não existia).
    pub backup: Option<String>,
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "pasta do usuário não encontrada".into())
}

pub(crate) fn backup(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let bak = path.with_file_name(format!(
        "{}.bak-cooper-{ts}",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("config")
    ));
    fs::copy(path, &bak).map_err(|e| format!("não consegui fazer backup: {e}"))?;
    Ok(Some(bak.display().to_string()))
}

/// Escreve num arquivo temporário e renomeia, para nunca deixar o arquivo pela metade.
pub(crate) fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("cooper-tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn server_path(app: &AppHandle) -> Result<String, String> {
    let p = app
        .path()
        .resolve("mcp/index.js", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let s = p.display().to_string();
    // Remove o prefixo \\?\ do Windows e usa barras normais (aceitas pelo node).
    Ok(s.trim_start_matches(r"\\?\").replace('\\', "/"))
}

fn validate(token: &str, url: &str, anon: &str) -> Result<(), String> {
    let ok_token = token.len() == 53 && token.starts_with("coop_") && token[5..].chars().all(|c| c.is_ascii_hexdigit());
    if !ok_token {
        return Err("token em formato inesperado".into());
    }
    if !url.starts_with("https://") || anon.is_empty() {
        return Err("configuração do Supabase ausente".into());
    }
    Ok(())
}

fn connect_claude(server: &str, token: &str, url: &str, anon: &str) -> Result<ConnectResult, String> {
    let path = home()?.join(".claude.json");
    let raw = if path.exists() { fs::read_to_string(&path).map_err(|e| e.to_string())? } else { "{}".into() };
    let mut root: serde_json::Value = serde_json::from_str(&raw).map_err(|e| format!("~/.claude.json inválido: {e}"))?;
    let obj = root.as_object_mut().ok_or("~/.claude.json não é um objeto")?;
    let servers = obj.entry("mcpServers").or_insert_with(|| serde_json::json!({}));
    let servers = servers.as_object_mut().ok_or("mcpServers não é um objeto")?;
    servers.insert(
        "cooper".into(),
        serde_json::json!({
            "type": "stdio",
            "command": "node",
            "args": [server],
            "env": { "COOPER_TOKEN": token, "COOPER_SUPABASE_URL": url, "COOPER_SUPABASE_ANON_KEY": anon }
        }),
    );
    let backup = backup(&path)?;
    let mut out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    if raw.ends_with('\n') {
        out.push('\n');
    }
    write_atomic(&path, &out)?;
    Ok(ConnectResult { file: path.display().to_string(), backup })
}

fn connect_codex(server: &str, token: &str, url: &str, anon: &str) -> Result<ConnectResult, String> {
    use toml_edit::{value, Array, DocumentMut, Item, Table};
    let path = home()?.join(".codex").join("config.toml");
    let raw = if path.exists() { fs::read_to_string(&path).map_err(|e| e.to_string())? } else { String::new() };
    let mut doc: DocumentMut = raw.parse().map_err(|e| format!("config.toml inválido: {e}"))?;

    if !doc.contains_key("mcp_servers") {
        let mut t = Table::new();
        t.set_implicit(true);
        doc["mcp_servers"] = Item::Table(t);
    }
    let mut entry = Table::new();
    entry["command"] = value("node");
    let mut args = Array::new();
    args.push(server);
    entry["args"] = value(args);
    let mut env = Table::new();
    env["COOPER_TOKEN"] = value(token);
    env["COOPER_SUPABASE_URL"] = value(url);
    env["COOPER_SUPABASE_ANON_KEY"] = value(anon);
    entry["env"] = Item::Table(env);
    doc["mcp_servers"]["cooper"] = Item::Table(entry);

    let backup = backup(&path)?;
    write_atomic(&path, &doc.to_string())?;
    Ok(ConnectResult { file: path.display().to_string(), backup })
}

/// Chamado pelo widget depois que a pessoa gera o token e clica em "Conectar".
#[tauri::command]
pub fn connect_agent(app: AppHandle, kind: String, token: String, url: String, anon: String) -> Result<ConnectResult, String> {
    validate(&token, &url, &anon)?;
    let server = server_path(&app)?;
    match kind.as_str() {
        "claude_code" => connect_claude(&server, &token, &url, &anon),
        "codex" => connect_codex(&server, &token, &url, &anon),
        _ => Err("agente sem conexão automática; use o comando".into()),
    }
}
