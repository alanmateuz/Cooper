//! Grava a entrada `cooper` na configuração de usuário do Claude Code (~/.claude.json)
//! ou do Codex (~/.codex/config.toml), sem depender do CLI de cada um.
//! Sempre faz backup antes e preserva o resto do arquivo (ordem das chaves e formatação).

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::paths::{backup, write_atomic};

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
    let local = url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:");
    if !(url.starts_with("https://") || local) || anon.is_empty() {
        return Err("configuração do Supabase ausente".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate;

    const TOKEN: &str = "coop_0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn aceita_supabase_hospedado_e_local() {
        assert!(validate(TOKEN, "https://abc.supabase.co", "eyJ").is_ok());
        assert!(validate(TOKEN, "http://127.0.0.1:54321", "eyJ").is_ok());
    }

    #[test]
    fn recusa_token_ou_servidor_estranho() {
        assert!(validate("coop_xyz", "https://abc.supabase.co", "eyJ").is_err());
        assert!(validate(TOKEN, "http://exemplo.com", "eyJ").is_err());
        assert!(validate(TOKEN, "https://abc.supabase.co", "").is_err());
    }
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
