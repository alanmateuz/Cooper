//! Grava o trecho do Cooper (lembrete curto; as regras vêm do servidor MCP) em CLAUDE.md e AGENTS.md na raiz de um repositório.
//! Duas etapas: `preview_agent_instructions` diz o que vai acontecer com cada arquivo, sem tocar em nada;
//! `write_agent_instructions` só roda depois que a pessoa confirma no widget.
//! O trecho fica entre marcadores; gravar de novo substitui só o trecho e preserva o resto do arquivo.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const START: &str = "<!-- cooper:start -->";
const END: &str = "<!-- cooper:end -->";
const FILES: [&str; 2] = ["CLAUDE.md", "AGENTS.md"];

#[derive(Serialize)]
pub struct FilePlan {
    pub name: String,
    pub path: String,
    /// "create" | "append" | "replace" | "unchanged"
    pub action: &'static str,
}

fn repo_dir(repo: &str) -> Result<PathBuf, String> {
    let dir = PathBuf::from(repo.trim());
    if !dir.is_dir() {
        return Err("pasta não encontrada".into());
    }
    if !dir.join(".git").exists() {
        return Err("essa pasta não é a raiz de um repositório git (falta .git)".into());
    }
    Ok(dir)
}

fn validate_block(block: &str) -> Result<(), String> {
    let ok = block.starts_with(START) && block.trim_end().ends_with(END) && block.len() <= 20_000 && block.matches(START).count() == 1;
    if ok { Ok(()) } else { Err("trecho de instruções em formato inesperado".into()) }
}

/// Conteúdo novo do arquivo e a ação correspondente.
fn plan(current: Option<&str>, block: &str) -> (String, &'static str) {
    let Some(cur) = current else { return (format!("{block}\n"), "create") };
    if let (Some(s), Some(e)) = (cur.find(START), cur.find(END)) {
        if s < e {
            let next = format!("{}{}{}", &cur[..s], block.trim_end(), &cur[e + END.len()..]);
            return if next == cur { (next, "unchanged") } else { (next, "replace") };
        }
    }
    let sep = if cur.is_empty() { "" } else if cur.ends_with("\n\n") { "" } else if cur.ends_with('\n') { "\n" } else { "\n\n" };
    (format!("{cur}{sep}{block}\n"), "append")
}

fn read(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| format!("não consegui ler {}: {e}", path.display()))
}

#[tauri::command]
pub fn preview_agent_instructions(repo: String, block: String) -> Result<Vec<FilePlan>, String> {
    validate_block(&block)?;
    let dir = repo_dir(&repo)?;
    FILES
        .iter()
        .map(|name| {
            let path = dir.join(name);
            let (_, action) = plan(read(&path)?.as_deref(), &block);
            Ok(FilePlan { name: (*name).into(), path: path.display().to_string(), action })
        })
        .collect()
}

#[tauri::command]
pub fn write_agent_instructions(repo: String, block: String, files: Vec<String>) -> Result<Vec<FilePlan>, String> {
    validate_block(&block)?;
    let dir = repo_dir(&repo)?;
    let mut done = Vec::new();
    for name in files {
        let name = FILES.iter().find(|f| **f == name).ok_or("arquivo fora da lista permitida")?;
        let path = dir.join(name);
        let (next, action) = plan(read(&path)?.as_deref(), &block);
        if action != "unchanged" {
            let tmp = path.with_extension("cooper-tmp");
            fs::write(&tmp, &next).map_err(|e| e.to_string())?;
            fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        }
        done.push(FilePlan { name: (*name).into(), path: path.display().to_string(), action });
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    const B: &str = "<!-- cooper:start -->\n## Cooper\n- regra\n<!-- cooper:end -->";

    #[test]
    fn cria_acrescenta_e_substitui() {
        assert_eq!(plan(None, B).1, "create");
        let (appended, a) = plan(Some("# Projeto\n"), B);
        assert_eq!(a, "append");
        assert!(appended.starts_with("# Projeto\n\n<!-- cooper:start -->"));
        assert_eq!(plan(Some(&appended), B).1, "unchanged");
        let changed = B.replace("regra", "regra nova");
        let (replaced, r) = plan(Some(&appended), &changed);
        assert_eq!(r, "replace");
        assert!(replaced.starts_with("# Projeto\n") && replaced.contains("regra nova") && !replaced.contains("- regra\n"));
    }

    #[test]
    fn recusa_trecho_estranho() {
        assert!(validate_block("qualquer coisa").is_err());
        assert!(validate_block(B).is_ok());
    }
}
