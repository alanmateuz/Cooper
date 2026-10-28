//! Estado do git local de uma pasta, para o cartão da pessoa (branch, sha, à frente/atrás, quantos arquivos alterados).
//! Só lê metadados com o próprio `git`: nunca conteúdo de arquivo, diff ou nome de arquivo.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Serialize, Debug, PartialEq)]
pub struct Remote {
    pub owner: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct GitStatus {
    /// repositório do GitHub do remoto "origin", se houver
    pub remote: Option<Remote>,
    pub branch: Option<String>,
    pub head_sha: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub dirty_files_count: u32,
}

fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(dir).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: sem janela de console piscando
    }
    let out = cmd.output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// github.com/dono/nome a partir de https://, git@ ou ssh://, com ou sem .git.
pub fn parse_github(url: &str) -> Option<Remote> {
    let rest = url.trim().split_once("github.com")?.1.trim_start_matches([':', '/']);
    let mut parts = rest.trim_end_matches('/').trim_end_matches(".git").splitn(2, '/');
    let owner = parts.next()?.to_string();
    let name = parts.next()?.to_string();
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
    (ok(&owner) && ok(&name)).then_some(Remote { owner, name })
}

#[tauri::command]
pub fn git_repo_status(path: String) -> Result<GitStatus, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err("pasta não encontrada".into());
    }
    if git(dir, &["rev-parse", "--is-inside-work-tree"]).as_deref() != Some("true") {
        return Err("essa pasta não é um repositório git (ou o git não está instalado)".into());
    }
    let remote = git(dir, &["remote", "get-url", "origin"]).and_then(|u| parse_github(&u));
    let branch = git(dir, &["symbolic-ref", "--quiet", "--short", "HEAD"]);
    let head_sha = git(dir, &["rev-parse", "HEAD"]).filter(|s| s.len() == 40);
    let (ahead, behind) = git(dir, &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
        .and_then(|s| {
            let mut it = s.split_whitespace().map(|n| n.parse::<u32>().ok());
            Some((it.next()??, it.next()??))
        })
        .map_or((None, None), |(a, b)| (Some(a), Some(b)));
    let dirty_files_count = git(dir, &["status", "--porcelain"]).map_or(0, |s| s.lines().filter(|l| !l.is_empty()).count() as u32);
    Ok(GitStatus { remote, branch, head_sha, ahead, behind, dirty_files_count })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_remotos_do_github() {
        let r = |o: &str, n: &str| Some(Remote { owner: o.into(), name: n.into() });
        assert_eq!(parse_github("https://github.com/alanmateuz/hacko.git"), r("alanmateuz", "hacko"));
        assert_eq!(parse_github("git@github.com:alanmateuz/hacko.git"), r("alanmateuz", "hacko"));
        assert_eq!(parse_github("ssh://git@github.com/a-b/c_d.e"), r("a-b", "c_d.e"));
        assert_eq!(parse_github("https://gitlab.com/a/b"), None);
        assert_eq!(parse_github("https://github.com/a"), None);
    }
}
