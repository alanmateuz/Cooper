//! Salva um anexo baixado na pasta Downloads da pessoa.
//! O widget busca o arquivo no Supabase Storage e manda os bytes crus (sem JSON) com o nome no cabeçalho
//! `x-file-name` (codificado com encodeURIComponent). Nunca sobrescreve: "nome (1).ext", "nome (2).ext"...

use std::fs;
use std::path::{Path, PathBuf};

use tauri::ipc::{InvokeBody, Request};

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or(""), 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Só o nome do arquivo, sem pastas nem caracteres proibidos no Windows.
fn safe_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if "<>:\"|?*".contains(c) || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() { "anexo".into() } else { trimmed.chars().take(180).collect() }
}

fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    (1..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

#[tauri::command]
pub fn save_download(request: Request) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("conteúdo inválido".into()) };
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("arquivo maior que 10 MB".into());
    }
    let raw = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).unwrap_or("anexo");
    let name = safe_name(&percent_decode(raw));
    let dir = dirs::download_dir().ok_or("pasta Downloads não encontrada")?;
    let path = free_path(&dir, &name);
    fs::write(&path, bytes).map_err(|e| format!("não consegui salvar: {e}"))?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nome_seguro() {
        assert_eq!(safe_name("..\\..\\Windows\\evil.exe"), "evil.exe");
        assert_eq!(safe_name("a/b/c:d?.pdf"), "c_d_.pdf");
        assert_eq!(safe_name("   "), "anexo");
        assert_eq!(percent_decode("Relat%C3%B3rio%20final.pdf"), "Relatório final.pdf");
        assert_eq!(percent_decode("100%"), "100%");
    }
}
