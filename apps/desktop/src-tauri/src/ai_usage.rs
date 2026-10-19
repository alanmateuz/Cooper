//! Uso de IA do dia, lido localmente dos JSONL do Claude Code (~/.claude/projects) e do Codex (~/.codex/sessions).
//!
//! Privacidade: as structs abaixo só têm campos numéricos, ids usados para tirar duplicatas e o nome do modelo.
//! O serde descarta todo o resto (prompts, respostas, código, caminhos) sem guardar. O resultado
//! (`UsageReport`) não tem nenhum campo de texto livre; o teste `nada_de_texto_sai_do_leitor` garante isso.
//!
//! Formato conferido nos arquivos reais em 2026-10-18:
//! - Claude Code: linhas `type: "assistant"` com `message.usage`; a mesma resposta aparece em várias linhas
//!   (mesmo `message.id` + `requestId`), então fica só a última. Não há informação de limite.
//! - Codex: `event_msg` com `payload.type: "token_count"`; `info.total_token_usage` é cumulativo por sessão
//!   (o uso é a diferença entre leituras) e `input_tokens` já inclui `cached_input_tokens`.
//!   `rate_limits.primary` é a janela de 5 h e `secondary` a semanal, com `used_percent` e `resets_at` (epoch s).
//! - Limites do Claude Code não estão nos JSONL. Vêm da status line do Cooper (packages/mcp-server/src/cooper-statusline.ts),
//!   que grava em ~/.cooper/claude-limits.json só `five_hour`/`seven_day` (percentual e reinício).
//! Linha que não bate com o formato é ignorada; arquivo ilegível também. Nada disso derruba o app.
//!
//! Desempenho: o widget pede a leitura a cada 60 s. Cada arquivo fica em cache (posição já lida, tamanho e
//! acumulador próprio), e a próxima leitura só processa as linhas novas. Relê do zero se o arquivo encolher
//! ou se o dia mudar. Uma última linha sem quebra de linha (ainda sendo escrita) espera a próxima leitura.

use std::collections::{BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Serialize, Default, Clone, Copy, Debug, PartialEq)]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

impl Tokens {
    fn add(&mut self, o: Tokens) {
        self.input += o.input;
        self.output += o.output;
        self.cache_read += o.cache_read;
        self.cache_write += o.cache_write;
    }
    fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Limit {
    pub used_pct: f64,
    pub window_minutes: Option<u32>,
    /// epoch em segundos
    pub resets_at: i64,
}

#[derive(Serialize, Default, Debug)]
pub struct AgentUsage {
    pub tokens: Tokens,
    pub models: Vec<String>,
    pub primary: Option<Limit>,
    pub secondary: Option<Limit>,
    /// epoch em ms do último registro de hoje
    pub last_event_at: Option<i64>,
    /// epoch em ms de quando os limites foram lidos (para mostrar "lido HH:MM")
    pub limits_observed_at: Option<i64>,
}

#[derive(Serialize, Default, Debug)]
pub struct UsageReport {
    pub claude_code: Option<AgentUsage>,
    pub codex: Option<AgentUsage>,
}

// ───────────── formatos (só o que interessa) ─────────────

#[derive(Deserialize)]
struct ClaudeLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    message: Option<ClaudeMessage>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    id: Option<String>,
    model: Option<String>,
    usage: Option<ClaudeUsage>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct ClaudeUsage {
    input_tokens: u64,
    output_tokens: u64,
    cache_creation_input_tokens: u64,
    cache_read_input_tokens: u64,
}

#[derive(Deserialize)]
struct CodexLine {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<CodexPayload>,
}

#[derive(Deserialize)]
struct CodexPayload {
    #[serde(rename = "type")]
    kind: Option<String>,
    info: Option<CodexInfo>,
    rate_limits: Option<CodexLimits>,
    model: Option<String>,
}

#[derive(Deserialize)]
struct CodexInfo {
    total_token_usage: Option<CodexTokens>,
}

#[derive(Deserialize, Default, Clone, Copy)]
#[serde(default)]
struct CodexTokens {
    input_tokens: u64,
    cached_input_tokens: u64,
    cache_write_input_tokens: u64,
    output_tokens: u64,
}

impl CodexTokens {
    fn normalized(self) -> Tokens {
        Tokens {
            input: self.input_tokens.saturating_sub(self.cached_input_tokens),
            output: self.output_tokens,
            cache_read: self.cached_input_tokens,
            cache_write: self.cache_write_input_tokens,
        }
    }
}

#[derive(Deserialize)]
struct CodexLimits {
    primary: Option<CodexWindow>,
    secondary: Option<CodexWindow>,
}

#[derive(Deserialize)]
struct CodexWindow {
    used_percent: f64,
    window_minutes: Option<u32>,
    resets_at: Option<i64>,
}

// ───────────── utilidades ─────────────

/// "2026-10-18T22:55:07.123Z" ou com "+03:00" → epoch em ms.
fn parse_ts(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let n = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?, n(17, 19)?);
    let mut i = 19;
    let mut ms = 0;
    if b.get(i) == Some(&b'.') {
        let start = i + 1;
        i = start;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let frac = &s[start..i];
        ms = format!("{:0<3}", &frac[..frac.len().min(3)]).parse::<i64>().ok()?;
    }
    let offset_min = match b.get(i) {
        Some(b'Z') => 0,
        Some(c @ (b'+' | b'-')) => {
            let sign = if *c == b'+' { 1 } else { -1 };
            sign * (n(i + 1, i + 3)? * 60 + n(i + 4, i + 6)?)
        }
        _ => return None,
    };
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let doy = (153 * ((mo + 9) % 12) + 2) / 5 + d - 1;
    let days = era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468;
    Some(((days * 86_400 + h * 3600 + mi * 60 + se - offset_min * 60) * 1000) + ms)
}

/// Só nomes de modelo comportados (ex.: "claude-opus-5-5", "gpt-5.5-codex"); o resto é descartado.
fn clean_model(m: &str) -> Option<String> {
    let ok = !m.is_empty() && m.len() <= 80 && m.chars().all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c));
    ok.then(|| m.to_string())
}

fn add_model(set: &mut BTreeSet<String>, m: Option<&str>) {
    if let Some(m) = m.and_then(clean_model) {
        if set.len() < 10 {
            set.insert(m);
        }
    }
}

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Arquivos .jsonl abaixo de `root`, com a data de modificação (epoch ms).
fn jsonl_files(root: &Path) -> Vec<(PathBuf, i64)> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(meta) = e.metadata() else { continue };
            if meta.is_dir() {
                stack.push(p);
            } else if p.extension().is_some_and(|x| x == "jsonl") {
                let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
                out.push((p, mtime));
            }
        }
    }
    out
}

/// Posição já lida de um arquivo.
#[derive(Default, Clone, Copy, Debug, PartialEq)]
struct Cursor {
    offset: u64,
}

/// Linhas completas novas desde `cur.offset`. None se o arquivo encolheu (o chamador relê do zero).
/// Uma última linha sem '\n' (ainda sendo escrita) não é consumida.
fn read_new_lines(path: &Path, cur: &mut Cursor) -> Option<Vec<String>> {
    let len = fs::metadata(path).ok()?.len();
    if len < cur.offset {
        return None;
    }
    if len == cur.offset {
        return Some(Vec::new());
    }
    let mut f = File::open(path).ok()?;
    f.seek(SeekFrom::Start(cur.offset)).ok()?;
    let mut r = BufReader::new(f);
    let mut out = Vec::new();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        let n = r.read_until(b'\n', &mut buf).ok()?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break; // fim, ou linha incompleta: fica para a próxima leitura
        }
        cur.offset += n as u64;
        out.push(String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string());
    }
    Some(out)
}

// ───────────── Claude Code ─────────────

#[derive(Default)]
struct ClaudeAcc {
    /// (message.id, requestId) → (uso, horário, modelo); fica o último visto
    by_id: HashMap<(String, String), (Tokens, i64, Option<String>)>,
    anon: usize,
}

fn scan_claude(acc: &mut ClaudeAcc, src: impl Iterator<Item = String>, since_ms: i64) {
    for line in src {
        if !line.contains("\"usage\"") {
            continue;
        }
        let Ok(l) = serde_json::from_str::<ClaudeLine>(&line) else { continue };
        if l.kind.as_deref() != Some("assistant") {
            continue;
        }
        let Some(ts) = l.timestamp.as_deref().and_then(parse_ts) else { continue };
        let Some(msg) = l.message else { continue };
        let Some(u) = msg.usage else { continue };
        if ts < since_ms {
            continue;
        }
        let tokens = Tokens {
            input: u.input_tokens,
            output: u.output_tokens,
            cache_read: u.cache_read_input_tokens,
            cache_write: u.cache_creation_input_tokens,
        };
        let key = match (msg.id, l.request_id) {
            (Some(a), Some(b)) => (a, b),
            (Some(a), None) => (a, String::new()),
            _ => {
                acc.anon += 1;
                (format!("#{}", acc.anon), String::new())
            }
        };
        acc.by_id.insert(key, (tokens, ts, msg.model));
    }
}

fn finish_claude(acc: ClaudeAcc) -> Option<AgentUsage> {
    if acc.by_id.is_empty() {
        return None;
    }
    let mut u = AgentUsage::default();
    let mut models = BTreeSet::new();
    for (tokens, ts, model) in acc.by_id.into_values() {
        u.tokens.add(tokens);
        u.last_event_at = Some(u.last_event_at.map_or(ts, |x| x.max(ts)));
        add_model(&mut models, model.as_deref());
    }
    u.models = models.into_iter().collect();
    Some(u)
}

// ───────────── Codex ─────────────

#[derive(Default)]
struct CodexAcc {
    tokens: Tokens,
    models: BTreeSet<String>,
    last_event_at: Option<i64>,
    /// (horário, primary, secondary) da leitura de limite mais recente
    limits: Option<(i64, Option<Limit>, Option<Limit>)>,
}

fn to_limit(w: Option<CodexWindow>) -> Option<Limit> {
    let w = w?;
    Some(Limit { used_pct: w.used_percent.clamp(0.0, 100.0), window_minutes: w.window_minutes, resets_at: w.resets_at? })
}

/// Um arquivo do Codex é uma sessão. Guarda a última leitura cumulativa (`prev`) para continuar de onde parou.
#[derive(Default)]
struct CodexFile {
    prev: Option<CodexTokens>,
    acc: CodexAcc,
}

/// Arquivo inteiro de uma vez (usado nos testes).
#[cfg(test)]
fn scan_codex_file(acc: &mut CodexAcc, src: impl Iterator<Item = String>, since_ms: i64) {
    let mut f = CodexFile { prev: None, acc: std::mem::take(acc) };
    scan_codex(&mut f, src, since_ms);
    *acc = f.acc;
}

/// O total é cumulativo por sessão: soma a diferença entre leituras.
fn scan_codex(file: &mut CodexFile, src: impl Iterator<Item = String>, since_ms: i64) {
    let CodexFile { prev, acc } = file;
    for line in src {
        let is_count = line.contains("\"token_count\"");
        if !is_count && !line.contains("\"turn_context\"") {
            continue;
        }
        let Ok(l) = serde_json::from_str::<CodexLine>(&line) else { continue };
        let Some(ts) = l.timestamp.as_deref().and_then(parse_ts) else { continue };
        let Some(p) = l.payload else { continue };

        if l.kind.as_deref() == Some("turn_context") {
            if ts >= since_ms {
                add_model(&mut acc.models, p.model.as_deref());
            }
            continue;
        }
        if p.kind.as_deref() != Some("token_count") {
            continue;
        }
        if let Some(cur) = p.info.and_then(|i| i.total_token_usage) {
            let delta = match *prev {
                Some(pr) if cur.input_tokens >= pr.input_tokens && cur.output_tokens >= pr.output_tokens => CodexTokens {
                    input_tokens: cur.input_tokens - pr.input_tokens,
                    cached_input_tokens: cur.cached_input_tokens.saturating_sub(pr.cached_input_tokens),
                    cache_write_input_tokens: cur.cache_write_input_tokens.saturating_sub(pr.cache_write_input_tokens),
                    output_tokens: cur.output_tokens - pr.output_tokens,
                },
                _ => cur, // primeira leitura da sessão, ou contador reiniciado
            };
            *prev = Some(cur);
            if ts >= since_ms && delta.normalized().total() > 0 {
                acc.tokens.add(delta.normalized());
                acc.last_event_at = Some(acc.last_event_at.map_or(ts, |x| x.max(ts)));
            }
        }
        if let Some(rl) = p.rate_limits {
            if acc.limits.as_ref().is_none_or(|(t, _, _)| ts >= *t) {
                acc.limits = Some((ts, to_limit(rl.primary), to_limit(rl.secondary)));
            }
        }
    }
}

/// Junta os acumuladores de vários arquivos do Codex.
fn merge_codex<'a>(files: impl Iterator<Item = &'a CodexAcc>) -> CodexAcc {
    let mut out = CodexAcc::default();
    for a in files {
        out.tokens.add(a.tokens);
        for m in &a.models {
            add_model(&mut out.models, Some(m));
        }
        if let Some(t) = a.last_event_at {
            out.last_event_at = Some(out.last_event_at.map_or(t, |x| x.max(t)));
        }
        if let Some((t, p, s)) = &a.limits {
            if out.limits.as_ref().is_none_or(|(ot, _, _)| t >= ot) {
                out.limits = Some((*t, p.clone(), s.clone()));
            }
        }
    }
    out
}

/// Junta os acumuladores de vários arquivos do Claude Code. A mesma resposta pode aparecer em mais de um
/// arquivo (sessão retomada copia o histórico): fica uma por id, a de horário mais recente.
fn merge_claude<'a>(files: impl Iterator<Item = &'a ClaudeAcc>) -> ClaudeAcc {
    let mut out = ClaudeAcc::default();
    for a in files {
        for (k, v) in &a.by_id {
            if out.by_id.get(k).is_none_or(|cur| v.1 >= cur.1) {
                out.by_id.insert(k.clone(), v.clone());
            }
        }
    }
    out
}

fn finish_codex(acc: CodexAcc, now_s: i64) -> Option<AgentUsage> {
    // limite cujo reinício já passou não vale mais: fica desconhecido
    let fresh = |l: Option<Limit>| l.filter(|l| l.resets_at > now_s);
    let (primary, secondary, at) = acc.limits.map(|(t, p, s)| (fresh(p), fresh(s), Some(t))).unwrap_or((None, None, None));
    if acc.tokens.total() == 0 && primary.is_none() && secondary.is_none() {
        return None;
    }
    let limits_observed_at = if primary.is_some() || secondary.is_some() { at } else { None };
    Some(AgentUsage {
        tokens: acc.tokens,
        models: acc.models.into_iter().collect(),
        primary,
        secondary,
        last_event_at: acc.last_event_at,
        limits_observed_at,
    })
}

// ───────────── limites do Claude Code (status line) ─────────────

#[derive(Deserialize)]
struct StatusWindow {
    used_percentage: f64,
    resets_at: i64,
}

#[derive(Deserialize)]
struct StatusLimits {
    five_hour: Option<StatusWindow>,
    seven_day: Option<StatusWindow>,
    observed_at: Option<i64>,
}

fn cooper_dir() -> Option<PathBuf> {
    std::env::var_os("COOPER_HOME").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".cooper")))
}

/// Junta os limites gravados pela status line ao uso do Claude Code. Reinício já passado = desconhecido.
fn with_claude_limits(usage: Option<AgentUsage>, raw: Option<&str>, now_s: i64) -> Option<AgentUsage> {
    let parsed = raw.and_then(|r| serde_json::from_str::<StatusLimits>(r).ok());
    let lim = |w: Option<StatusWindow>, minutes: u32| {
        w.filter(|w| w.resets_at > now_s && w.used_percentage.is_finite())
            .map(|w| Limit { used_pct: w.used_percentage.clamp(0.0, 100.0), window_minutes: Some(minutes), resets_at: w.resets_at })
    };
    let (primary, secondary, at) =
        parsed.map(|p| (lim(p.five_hour, 300), lim(p.seven_day, 10_080), p.observed_at)).unwrap_or((None, None, None));
    if usage.is_none() && primary.is_none() && secondary.is_none() {
        return None;
    }
    let mut u = usage.unwrap_or_default();
    u.limits_observed_at = if primary.is_some() || secondary.is_some() { at } else { None };
    u.primary = primary;
    u.secondary = secondary;
    Some(u)
}

// ───────────── comando ─────────────

fn claude_root() -> Option<PathBuf> {
    let base = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".claude")))?;
    Some(base.join("projects"))
}

fn codex_root() -> Option<PathBuf> {
    let base = std::env::var_os("CODEX_HOME").map(PathBuf::from).or_else(|| dirs::home_dir().map(|h| h.join(".codex")))?;
    Some(base.join("sessions"))
}

/// Estado entre leituras: um cursor e um acumulador por arquivo, válidos para um `since_ms` (o dia).
#[derive(Default)]
struct UsageCache {
    since_ms: i64,
    claude: HashMap<PathBuf, (Cursor, ClaudeAcc)>,
    codex: HashMap<PathBuf, (Cursor, CodexFile)>,
}

fn cache() -> &'static Mutex<UsageCache> {
    static CACHE: OnceLock<Mutex<UsageCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(UsageCache::default()))
}

/// Lê só o que é novo em cada arquivo pedido; arquivo que encolheu recomeça do zero; os que saíram da lista são esquecidos.
fn refresh<S: Default>(states: &mut HashMap<PathBuf, (Cursor, S)>, wanted: &[PathBuf], mut scan: impl FnMut(&mut S, Vec<String>)) {
    states.retain(|p, _| wanted.contains(p));
    for path in wanted {
        let entry = states.entry(path.clone()).or_default();
        let lines = match read_new_lines(path, &mut entry.0) {
            Some(l) => l,
            None => {
                *entry = Default::default();
                read_new_lines(path, &mut entry.0).unwrap_or_default()
            }
        };
        if !lines.is_empty() {
            scan(&mut entry.1, lines);
        }
    }
}

fn read_usage(cache: &mut UsageCache, claude_root: Option<PathBuf>, codex_root: Option<PathBuf>, limits_raw: Option<String>, since_ms: i64, now_s: i64) -> UsageReport {
    if cache.since_ms != since_ms {
        *cache = UsageCache { since_ms, ..Default::default() }; // dia novo: recomeça
    }
    let mut report = UsageReport::default();

    if let Some(root) = claude_root {
        let wanted: Vec<PathBuf> = jsonl_files(&root).into_iter().filter(|(_, m)| *m >= since_ms).map(|(p, _)| p).collect();
        refresh(&mut cache.claude, &wanted, |acc, lines| scan_claude(acc, lines.into_iter(), since_ms));
        let merged = merge_claude(cache.claude.values().map(|(_, a)| a));
        report.claude_code = with_claude_limits(finish_claude(merged), limits_raw.as_deref(), now_s);
    }

    if let Some(root) = codex_root {
        let mut files = jsonl_files(&root);
        files.sort_by_key(|(_, m)| std::cmp::Reverse(*m));
        // arquivos de hoje, e sempre o mais recente (os limites semanais valem por vários dias)
        let wanted: Vec<PathBuf> = files.iter().enumerate().filter(|(i, (_, m))| *m >= since_ms || *i == 0).map(|(_, (p, _))| p.clone()).collect();
        refresh(&mut cache.codex, &wanted, |f, lines| scan_codex(f, lines.into_iter(), since_ms));
        report.codex = finish_codex(merge_codex(cache.codex.values().map(|(_, f)| &f.acc)), now_s);
    }
    report
}

/// `since_ms`: início do dia local, calculado pelo widget.
#[tauri::command]
pub async fn read_ai_usage(since_ms: i64) -> UsageReport {
    tauri::async_runtime::spawn_blocking(move || {
        let limits = cooper_dir().and_then(|d| fs::read_to_string(d.join("claude-limits.json")).ok());
        let mut c = cache().lock().unwrap_or_else(|e| e.into_inner());
        read_usage(&mut c, claude_root(), codex_root(), limits, since_ms, now_secs())
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn it(v: &[&str]) -> impl Iterator<Item = String> {
        v.iter().map(|s| s.to_string()).collect::<Vec<_>>().into_iter()
    }

    const SINCE: i64 = 1_792_281_600_000; // 2026-10-18T00:00:00Z

    #[test]
    fn horario_iso() {
        assert_eq!(parse_ts("2026-10-18T00:00:00Z"), Some(SINCE));
        assert_eq!(parse_ts("2026-10-18T00:00:00.5Z"), Some(SINCE + 500));
        assert_eq!(parse_ts("2026-10-18T03:00:00+03:00"), Some(SINCE));
        assert_eq!(parse_ts("ontem"), None);
    }

    #[test]
    fn claude_tira_duplicatas_e_ignora_ontem() {
        let mut acc = ClaudeAcc::default();
        scan_claude(
            &mut acc,
            it(&[
                r#"{"type":"assistant","timestamp":"2026-10-18T10:00:00.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":2,"output_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}"#,
                r#"{"type":"assistant","timestamp":"2026-10-18T10:00:01.000Z","requestId":"r1","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":2,"output_tokens":30,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}"#,
                r#"{"type":"assistant","timestamp":"2026-10-17T23:59:59.000Z","requestId":"r0","message":{"id":"m0","usage":{"input_tokens":999,"output_tokens":999}}}"#,
                r#"{"type":"user","timestamp":"2026-10-18T10:00:00.000Z","message":{"role":"user","content":"usage"}}"#,
                "linha quebrada {",
            ]),
            SINCE,
        );
        let u = finish_claude(acc).unwrap();
        assert_eq!(u.tokens, Tokens { input: 2, output: 30, cache_read: 100, cache_write: 50 });
        assert_eq!(u.models, vec!["claude-opus-5-5"]);
        assert!(u.primary.is_none());
    }

    #[test]
    fn codex_soma_diferencas_e_pega_limites() {
        let mut acc = CodexAcc::default();
        let tc = |ts: &str, input: u64, cached: u64, out: u64, pct: f64| {
            format!(
                r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{input},"cached_input_tokens":{cached},"cache_write_input_tokens":0,"output_tokens":{out},"reasoning_output_tokens":0,"total_tokens":0}}}},"rate_limits":{{"primary":{{"used_percent":{pct},"window_minutes":300,"resets_at":4102444800}},"secondary":{{"used_percent":18.0,"window_minutes":10080,"resets_at":1000}}}}}}}}"#
            )
        };
        let lines = vec![
            tc("2026-10-17T23:00:00.000Z", 1000, 800, 10, 5.0), // ontem: só serve de base
            r#"{"timestamp":"2026-10-18T09:00:00.000Z","type":"turn_context","payload":{"model":"gpt-5.5-codex","cwd":"C:\\segredo"}}"#.to_string(),
            tc("2026-10-18T09:00:01.000Z", 1500, 1000, 30, 13.0),
            tc("2026-10-18T09:00:02.000Z", 1500, 1000, 30, 13.0), // repetido: diferença zero
        ];
        scan_codex_file(&mut acc, lines.into_iter(), SINCE);
        let u = finish_codex(acc, 2_000_000_000).unwrap();
        assert_eq!(u.tokens, Tokens { input: 300, output: 20, cache_read: 200, cache_write: 0 });
        assert_eq!(u.models, vec!["gpt-5.5-codex"]);
        assert_eq!(u.primary, Some(Limit { used_pct: 13.0, window_minutes: Some(300), resets_at: 4_102_444_800 }));
        assert!(u.secondary.is_none(), "reinício já passou: limite desconhecido");
    }

    /// Leitura dos arquivos reais desta máquina (só números): `cargo test -- --ignored arquivos_reais --nocapture`
    #[test]
    #[ignore]
    fn arquivos_reais() {
        let since = (now_secs() - 86_400) * 1000;
        let t0 = std::time::Instant::now();
        let r = tauri::async_runtime::block_on(read_ai_usage(since));
        let first = t0.elapsed();
        let t1 = std::time::Instant::now();
        tauri::async_runtime::block_on(read_ai_usage(since));
        println!("primeira leitura: {first:?}; segunda (só linhas novas): {:?}", t1.elapsed());
        println!("{}", serde_json::to_string_pretty(&r).unwrap());
    }

    fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cooper-usage-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn append(path: &Path, s: &str) {
        use std::io::Write;
        fs::OpenOptions::new().create(true).append(true).open(path).unwrap().write_all(s.as_bytes()).unwrap();
    }

    #[test]
    fn linha_incompleta_espera_a_proxima_leitura() {
        let p = temp_dir("parcial").join("a.jsonl");
        append(&p, "um\ndo");
        let mut c = Cursor::default();
        assert_eq!(read_new_lines(&p, &mut c).unwrap(), vec!["um"]);
        assert_eq!(c.offset, 3);
        append(&p, "is\r\ntrês\n");
        assert_eq!(read_new_lines(&p, &mut c).unwrap(), vec!["dois", "três"]);
        assert_eq!(read_new_lines(&p, &mut c).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn arquivo_que_encolheu_pede_releitura() {
        let p = temp_dir("encolheu").join("a.jsonl");
        append(&p, "x\n");
        let mut c = Cursor { offset: 100 };
        assert!(read_new_lines(&p, &mut c).is_none());
    }

    #[test]
    fn leitura_incremental_igual_a_leitura_inteira() {
        let claude = temp_dir("claude");
        let codex = temp_dir("codex");
        let cl = |id: &str, out: u64| {
            format!(r#"{{"type":"assistant","timestamp":"2026-10-18T10:00:00Z","requestId":"r{id}","message":{{"id":"m{id}","model":"claude-opus-5-5","usage":{{"input_tokens":1,"output_tokens":{out}}}}}}}"#) + "\n"
        };
        let cx = |ts: &str, input: u64, out: u64| {
            format!(r#"{{"timestamp":"{ts}","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":{input},"output_tokens":{out}}}}}}}}}"#) + "\n"
        };
        let (cf, xf) = (claude.join("s.jsonl"), codex.join("s.jsonl"));
        append(&cf, &cl("1", 10));
        append(&xf, &cx("2026-10-18T09:00:00Z", 100, 10));

        let mut inc = UsageCache::default();
        let first = read_usage(&mut inc, Some(claude.clone()), Some(codex.clone()), None, SINCE, 0);
        assert_eq!(first.codex.as_ref().unwrap().tokens.total(), 110);

        // mais linhas: a mesma resposta do Claude atualizada, uma nova, e a sessão do Codex crescendo
        append(&cf, &cl("1", 30));
        append(&cf, &cl("2", 5));
        append(&xf, &cx("2026-10-18T09:05:00Z", 150, 20));
        let second = read_usage(&mut inc, Some(claude.clone()), Some(codex.clone()), None, SINCE, 0);
        let full = read_usage(&mut UsageCache::default(), Some(claude), Some(codex), None, SINCE, 0);

        let tok = |r: &UsageReport| (r.claude_code.as_ref().unwrap().tokens, r.codex.as_ref().unwrap().tokens);
        assert_eq!(tok(&second), tok(&full));
        assert_eq!(second.claude_code.unwrap().tokens, Tokens { input: 2, output: 35, cache_read: 0, cache_write: 0 });
        assert_eq!(second.codex.unwrap().tokens.total(), 170);
    }

    #[test]
    fn dia_novo_recomeca_o_cache() {
        let codex = temp_dir("dia");
        let f = codex.join("s.jsonl");
        append(&f, r#"{"timestamp":"2026-10-18T09:00:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":50,"output_tokens":5}}}}"#);
        append(&f, "\n");
        let mut c = UsageCache::default();
        assert!(read_usage(&mut c, None, Some(codex.clone()), None, SINCE, 0).codex.is_some());
        let next_day = SINCE + 86_400_000;
        assert!(read_usage(&mut c, None, Some(codex), None, next_day, 0).codex.is_none(), "uso de ontem não conta hoje");
        assert_eq!(c.since_ms, next_day);
    }

    #[test]
    fn limites_da_status_line() {
        let raw = r#"{"five_hour":{"used_percentage":23.5,"resets_at":2000},"seven_day":{"used_percentage":41.2,"resets_at":500},"observed_at":1}"#;
        let u = with_claude_limits(None, Some(raw), 1000).unwrap();
        assert_eq!(u.limits_observed_at, Some(1));
        assert_eq!(u.primary, Some(Limit { used_pct: 23.5, window_minutes: Some(300), resets_at: 2000 }));
        assert!(u.secondary.is_none(), "reinício já passou");
        assert_eq!(u.tokens.total(), 0);
        assert!(with_claude_limits(None, Some("lixo"), 1000).is_none());
        assert!(with_claude_limits(None, None, 1000).is_none());
    }

    #[test]
    fn nada_de_texto_sai_do_leitor() {
        let secret = "SEGREDO-do-prompt";
        let mut c = ClaudeAcc::default();
        scan_claude(
            &mut c,
            it(&[&format!(
                r#"{{"type":"assistant","timestamp":"2026-10-18T10:00:00Z","cwd":"C:\\{secret}","requestId":"r","message":{{"id":"m","model":"modelo {secret}","content":[{{"type":"text","text":"{secret}"}}],"usage":{{"input_tokens":1,"output_tokens":1,"service_tier":"{secret}"}}}}}}"#
            )]),
            SINCE,
        );
        let mut x = CodexAcc::default();
        scan_codex_file(
            &mut x,
            it(&[
                &format!(r#"{{"timestamp":"2026-10-18T10:00:00Z","type":"turn_context","payload":{{"model":"{secret} x","summary":"{secret}"}}}}"#),
                &format!(
                    r#"{{"timestamp":"2026-10-18T10:00:01Z","type":"event_msg","payload":{{"type":"token_count","info":{{"total_token_usage":{{"input_tokens":5,"output_tokens":1}}}},"rate_limits":{{"limit_id":"{secret}","plan_type":"{secret}","primary":{{"used_percent":1.0,"resets_at":4102444800}}}}}}}}"#
                ),
            ]),
            SINCE,
        );
        let report = UsageReport { claude_code: finish_claude(c), codex: finish_codex(x, 0) };
        let json = serde_json::to_string(&report).unwrap();
        assert!(report.claude_code.is_some() && report.codex.is_some());
        assert!(!json.contains("SEGREDO"), "texto vazou: {json}");
    }
}
