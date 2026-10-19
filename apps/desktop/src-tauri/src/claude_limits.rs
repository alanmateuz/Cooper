//! Atualiza os limites do Claude Code sem o terminal: roda `claude -p` em segundo plano (Haiku, uma resposta curta)
//! e lê o evento `rate_limit_event` da saída stream-json. Só os dois percentuais e reinícios são gravados, no mesmo
//! ~/.cooper/claude-limits.json que a status line usa. Nada da conversa é guardado.
//!
//! Formato conferido em 2026-10-18 (Claude Code v2.1.299, plano Pro):
//!   {"type":"rate_limit_event","rate_limit_info":{..., "unifiedWindows":{
//!     "five_hour":{"utilization":0.58,"resetsAt":1792383600}, "seven_day":{"utilization":0.11,"resetsAt":1792522800}}}}
//! O campo não está na documentação da status line; se sumir ou mudar, o resultado é "sem dados", nunca um valor inventado.
//! Custo: cada atualização é uma mensagem real e entra no limite de 5 h.

use std::fs;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::agent_config::write_atomic;

#[derive(Deserialize)]
struct Event {
    #[serde(rename = "type")]
    kind: Option<String>,
    rate_limit_info: Option<Info>,
}

#[derive(Deserialize)]
struct Info {
    #[serde(rename = "unifiedWindows")]
    unified_windows: Option<Windows>,
}

#[derive(Deserialize)]
struct Windows {
    five_hour: Option<Win>,
    seven_day: Option<Win>,
}

#[derive(Deserialize)]
struct Win {
    utilization: f64,
    #[serde(rename = "resetsAt")]
    resets_at: i64,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Window {
    pub used_percentage: f64,
    pub resets_at: i64,
}

/// Mesmo formato que a status line grava (cooper-statusline.ts).
#[derive(Serialize, Debug, PartialEq)]
pub struct Limits {
    pub five_hour: Option<Window>,
    pub seven_day: Option<Window>,
    pub observed_at: i64,
}

fn win(w: Option<Win>) -> Option<Window> {
    let w = w.filter(|w| w.utilization.is_finite())?;
    Some(Window { used_percentage: (w.utilization * 100.0).clamp(0.0, 100.0).round(), resets_at: w.resets_at })
}

/// Último `rate_limit_event` com janelas na saída stream-json.
fn parse(stdout: &str, now_ms: i64) -> Option<Limits> {
    stdout
        .lines()
        .filter(|l| l.contains("rate_limit_event"))
        .filter_map(|l| serde_json::from_str::<Event>(l).ok())
        .filter(|e| e.kind.as_deref() == Some("rate_limit_event"))
        .filter_map(|e| e.rate_limit_info?.unified_windows)
        .map(|w| Limits { five_hour: win(w.five_hour), seven_day: win(w.seven_day), observed_at: now_ms })
        .filter(|l| l.five_hour.is_some() || l.seven_day.is_some())
        .last()
}

/// Versão "a.b.c" de uma pasta claude-code/<versão>, para escolher a mais nova.
fn version(name: &str) -> Option<(u32, u32, u32)> {
    let mut it = name.split('.').map(|p| p.parse::<u32>().ok());
    Some((it.next()??, it.next()??, it.next()??))
}

/// Executável do Claude Code: o do PATH, ou o que vem dentro do app desktop do Claude
/// (que no Windows pode estar na pasta virtualizada do pacote MSIX).
fn claude_candidates() -> Vec<PathBuf> {
    let mut out = vec![PathBuf::from(if cfg!(windows) { "claude.exe" } else { "claude" })];
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".local").join("bin").join(if cfg!(windows) { "claude.exe" } else { "claude" }));
    }
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        roots.push(appdata.join("Claude").join("claude-code"));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        if let Ok(rd) = fs::read_dir(local.join("Packages")) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().starts_with("Claude_") {
                    roots.push(e.path().join("LocalCache").join("Roaming").join("Claude").join("claude-code"));
                }
            }
        }
    }
    let mut bundled: Vec<((u32, u32, u32), PathBuf)> = Vec::new();
    for root in roots {
        let Ok(vers) = fs::read_dir(&root) else { continue };
        for v in vers.flatten() {
            let Some(ver) = version(&v.file_name().to_string_lossy()) else { continue };
            let Ok(hashes) = fs::read_dir(v.path()) else { continue };
            for h in hashes.flatten() {
                let exe = h.path().join(if cfg!(windows) { "claude.exe" } else { "claude" });
                if exe.is_file() {
                    bundled.push((ver, exe));
                }
            }
        }
    }
    bundled.sort_by(|a, b| b.0.cmp(&a.0));
    out.extend(bundled.into_iter().map(|(_, p)| p));
    out
}

fn cooper_dir() -> Result<PathBuf, String> {
    std::env::var_os("COOPER_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".cooper")))
        .ok_or_else(|| "pasta do usuário não encontrada".into())
}

fn run(exe: &PathBuf, cwd: &PathBuf) -> std::io::Result<String> {
    let mut cmd = Command::new(exe);
    cmd.args(["-p", "Responda apenas: ok", "--output-format", "stream-json", "--verbose", "--max-turns", "1", "--model", "haiku"])
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: sem janela de console piscando
    }
    let mut child = cmd.spawn()?;
    let mut stdout = child.stdout.take().expect("stdout");
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if start.elapsed() > Duration::from_secs(90) {
            let _ = child.kill();
            return Err(std::io::Error::other("o Claude Code demorou demais"));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Ok(reader.join().unwrap_or_default())
}

#[derive(Serialize)]
pub struct RefreshResult {
    pub five_hour: Option<f64>,
    pub seven_day: Option<f64>,
    pub observed_at: i64,
}

/// Botão "Atualizar limite" e atualização automática do widget.
#[tauri::command]
pub async fn refresh_claude_limits() -> Result<RefreshResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let dir = cooper_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let mut last_err = "Claude Code não encontrado nesta máquina".to_string();
        for exe in claude_candidates() {
            let out = match run(&exe, &dir) {
                Ok(o) => o,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
            };
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
            let Some(limits) = parse(&out, now) else {
                last_err = "o Claude Code não informou limites (precisa de login com plano Pro ou Max)".into();
                continue;
            };
            write_atomic(&dir.join("claude-limits.json"), &serde_json::to_string(&limits).map_err(|e| e.to_string())?)?;
            return Ok(RefreshResult {
                five_hour: limits.five_hour.as_ref().map(|w| w.used_percentage),
                seven_day: limits.seven_day.as_ref().map(|w| w.used_percentage),
                observed_at: limits.observed_at,
            });
        }
        Err(last_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_o_evento_de_limite_e_nada_mais() {
        let out = [
            r#"{"type":"system","subtype":"init","cwd":"C:\\SEGREDO","tools":["Bash"]}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"SEGREDO"}]}}"#,
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour","unifiedWindows":{"five_hour":{"utilization":0.58,"resetsAt":1792383600},"seven_day":{"utilization":0.114,"resetsAt":1792522800}}}}"#,
            r#"{"type":"result","subtype":"success","result":"SEGREDO"}"#,
        ]
        .join("\n");
        let l = parse(&out, 7).unwrap();
        assert_eq!(l.five_hour, Some(Window { used_percentage: 58.0, resets_at: 1792383600 }));
        assert_eq!(l.seven_day, Some(Window { used_percentage: 11.0, resets_at: 1792522800 }));
        assert!(!serde_json::to_string(&l).unwrap().contains("SEGREDO"));
    }

    #[test]
    fn sem_evento_ou_formato_novo_da_sem_dados() {
        assert!(parse(r#"{"type":"result","subtype":"success"}"#, 0).is_none());
        assert!(parse(r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#, 0).is_none());
    }

    /// Atualização real nesta máquina (uma mensagem curta no Haiku): `cargo test -- --ignored atualizacao_real --nocapture`
    #[test]
    #[ignore]
    fn atualizacao_real() {
        let r = tauri::async_runtime::block_on(refresh_claude_limits());
        println!("{}", r.map(|r| serde_json::to_string(&r).unwrap()).unwrap_or_else(|e| format!("erro: {e}")));
    }

    #[test]
    fn escolhe_versao() {
        assert_eq!(version("2.1.299"), Some((2, 1, 299)));
        assert!(version("lixo").is_none());
    }
}
