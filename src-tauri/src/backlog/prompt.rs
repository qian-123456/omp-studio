//! `backlog_build_prompt`: item + resolved refs rendered into prompts/backlog_dispatch.md.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

use crate::contracts::{BacklogItem, BacklogKind, SessionMeta};
use crate::prompts;
use crate::state::AppState;
use crate::todos::transcript::truncate_chars;

const MAX_FILE_BYTES: u64 = 100 * 1024;
const MAX_FILE_LINES: usize = 200;

pub fn kind_label(kind: BacklogKind) -> &'static str {
    match kind {
        BacklogKind::Idea => "idea",
        BacklogKind::Bug => "bug report",
        BacklogKind::Todo => "task",
    }
}

pub fn format_session(meta: &SessionMeta, summary: Option<&str>) -> String {
    let mut s = format!(
        "- Session {} \"{}\" (cwd `{}`, transcript `{}`)",
        meta.label, meta.title, meta.cwd, meta.file
    );
    if let Some(sum) = summary.filter(|t| !t.trim().is_empty()) {
        s.push_str("\n  Summary:\n");
        for line in sum.lines() {
            s.push_str(&format!("  {line}\n"));
        }
        s.truncate(s.trim_end().len());
    }
    s
}

pub fn format_file(path: &str, lines: Option<&str>) -> String {
    let range = lines.map(|l| format!(" (lines {l})")).unwrap_or_default();
    let mut s = format!("- File `{path}`{range}");
    let p = Path::new(path);
    let small = std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.len() <= MAX_FILE_BYTES);
    if small {
        if let Ok(f) = std::fs::File::open(p) {
            let all: Vec<String> = BufReader::new(f).lines().map_while(Result::ok).collect();
            let shown = &all[..all.len().min(MAX_FILE_LINES)];
            let note = if all.len() > MAX_FILE_LINES {
                format!(" — first {MAX_FILE_LINES} of {} lines", all.len())
            } else {
                String::new()
            };
            s.push_str(&format!("{note}\n```\n{}\n```", shown.join("\n")));
        }
    }
    s
}

pub fn format_annotation(text: &str, path: Option<&str>, lines: Option<&str>) -> String {
    let mut src = String::new();
    if let Some(p) = path {
        src = format!(
            " (from `{p}`{})",
            lines.map(|l| format!(" lines {l}")).unwrap_or_default()
        );
    }
    let quoted: Vec<String> = text.lines().map(|l| format!("  > {l}")).collect();
    format!("- Quote{src}:\n{}", quoted.join("\n"))
}

pub async fn build(state: &AppState, item: &BacklogItem) -> String {
    let mut parts = Vec::new();
    for r in &item.refs {
        match r.kind.as_str() {
            "session" => {
                let Some(sid) = r.session_id.as_deref() else {
                    continue;
                };
                match crate::todos::sessions::lookup(state, sid).await {
                    Some(meta) => {
                        let summary = crate::todos::summary(state, sid, false)
                            .await
                            .or_else(|| meta.last_assistant.clone())
                            .map(|s| truncate_chars(&s, 2000));
                        parts.push(format_session(&meta, summary.as_deref()));
                    }
                    None => parts.push(format!("- Session {sid}")),
                }
            }
            "file" => {
                if let Some(p) = r.path.as_deref() {
                    parts.push(format_file(p, r.lines.as_deref()));
                }
            }
            _ => {
                if let Some(t) = r.text.as_deref().filter(|t| !t.trim().is_empty()) {
                    parts.push(format_annotation(t, r.path.as_deref(), r.lines.as_deref()));
                }
            }
        }
    }
    let mut vars = HashMap::new();
    vars.insert("kind", kind_label(item.kind).to_string());
    vars.insert("text", item.text.clone());
    vars.insert("refs", parts.join("\n"));
    prompts::render(prompts::BACKLOG_DISPATCH, &vars)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_refs() {
        let meta = SessionMeta {
            label: "#3".into(),
            title: "登录".into(),
            cwd: "/p".into(),
            file: "/f.jsonl".into(),
            ..Default::default()
        };
        let s = format_session(&meta, Some("a\nb"));
        assert!(s.starts_with("- Session #3 \"登录\""));
        assert!(s.ends_with("  a\n  b"));
        let a = format_annotation("x\ny", Some("src/a.ts"), Some("3-4"));
        assert_eq!(a, "- Quote (from `src/a.ts` lines 3-4):\n  > x\n  > y");
    }

    #[test]
    fn inlines_small_files_capped() {
        let dir = std::env::temp_dir().join(format!("ompws-d-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("big.txt");
        let body: Vec<String> = (1..=250).map(|i| format!("line {i}")).collect();
        std::fs::write(&p, body.join("\n")).unwrap();
        let s = format_file(p.to_str().unwrap(), None);
        assert!(s.contains("first 200 of 250 lines"));
        assert!(s.contains("line 200\n```") && !s.contains("line 201"));
        assert_eq!(
            format_file("/nonexistent/x", None),
            "- File `/nonexistent/x`"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn renders_template() {
        let mut vars = HashMap::new();
        vars.insert("kind", "bug report".to_string());
        vars.insert("text", "Fix it".to_string());
        vars.insert("refs", String::new());
        let out = prompts::render(prompts::BACKLOG_DISPATCH, &vars);
        assert!(out.contains("following bug report") && !out.contains("Related context"));
        assert!(!out.contains("{{"));
    }
}
