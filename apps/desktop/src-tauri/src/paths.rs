//! Pastas e gravação de arquivos usadas por vários módulos.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Pasta do Cooper na máquina (~/.cooper, ou COOPER_HOME): limites do Claude, cadeia da status line.
pub fn cooper_dir() -> Result<PathBuf, String> {
    std::env::var_os("COOPER_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".cooper")))
        .ok_or_else(|| "pasta do usuário não encontrada".into())
}

/// Escreve num arquivo temporário e renomeia, para nunca deixar o arquivo pela metade.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("cooper-tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Cópia `<arquivo>.bak-cooper-<epoch>` antes de mexer numa configuração do usuário. None se o arquivo não existia.
pub fn backup(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let bak = path.with_file_name(format!("{}.bak-cooper-{ts}", path.file_name().and_then(|n| n.to_str()).unwrap_or("config")));
    fs::copy(path, &bak).map_err(|e| format!("não consegui fazer backup: {e}"))?;
    Ok(Some(bak.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grava_atomico_e_faz_backup() {
        let dir = std::env::temp_dir().join(format!("cooper-paths-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let f = dir.join("sub").join("a.json");
        assert_eq!(backup(&f).unwrap(), None);
        write_atomic(&f, "1").unwrap();
        let bak = backup(&f).unwrap().unwrap();
        write_atomic(&f, "2").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "2");
        assert_eq!(fs::read_to_string(bak).unwrap(), "1");
        assert!(!f.with_extension("cooper-tmp").exists());
    }
}
