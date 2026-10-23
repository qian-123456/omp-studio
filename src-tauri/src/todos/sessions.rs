//! Session lookup: catalog first, falling back to locating the JSONL file directly
//! (keeps D useful while the catalog module is still a stub).

use std::path::PathBuf;

use crate::contracts::SessionMeta;
use crate::paths;
use crate::state::AppState;

/// `#<n>` from a title like "#115 Fix bug", else a short id.
pub fn fallback_label(title: &str, id: &str) -> String {
    let digits: String = title
        .strip_prefix('#')
        .map(|r| r.chars().take_while(char::is_ascii_digit).collect())
        .unwrap_or_default();
    if digits.is_empty() {
        format!("#{}", id.chars().take(6).collect::<String>())
    } else {
        format!("#{digits}")
    }
}

/// Find `<sessions>/<bucket>/<ts>_<id>.jsonl`.
pub fn find_file(session_id: &str) -> Option<PathBuf> {
    let suffix = format!("_{session_id}.jsonl");
    let buckets = std::fs::read_dir(paths::omp_sessions_dir()).ok()?;
    for bucket in buckets.flatten() {
        let Ok(files) = std::fs::read_dir(bucket.path()) else {
            continue;
        };
        for f in files.flatten() {
            if f.file_name().to_string_lossy().ends_with(&suffix) {
                return Some(f.path());
            }
        }
    }
    None
}

pub async fn lookup(state: &AppState, session_id: &str) -> Option<SessionMeta> {
    if let Some(meta) = crate::catalog::get(state, session_id).await {
        return Some(meta);
    }
    let id = session_id.to_string();
    tokio::task::spawn_blocking(move || {
        let file = find_file(&id)?;
        let (_, cwd, title) = super::transcript::head_info(&file)?;
        Some(SessionMeta {
            label: fallback_label(&title, &id),
            title: if title.is_empty() {
                "未命名".to_string()
            } else {
                title
            },
            id,
            tool: "omp".to_string(),
            file: file.to_string_lossy().to_string(),
            cwd,
            ..Default::default()
        })
    })
    .await
    .ok()
    .flatten()
}

/// "#12 标题" display name for todo titles and notifications.
pub fn display_name(meta: &SessionMeta) -> String {
    let title = super::transcript::truncate_chars(&meta.title, 40);
    if meta.label.is_empty() || title.starts_with(&meta.label) {
        title
    } else {
        format!("{} {title}", meta.label)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        assert_eq!(fallback_label("#115 Fix", "abcdefgh"), "#115");
        assert_eq!(fallback_label("Fix", "abcdefgh"), "#abcdef");
    }

    #[test]
    fn display_name_avoids_duplicate_label() {
        let m = SessionMeta {
            label: "#3".into(),
            title: "#3 登录修复".into(),
            ..Default::default()
        };
        assert_eq!(display_name(&m), "#3 登录修复");
        let m = SessionMeta {
            label: "#L4".into(),
            title: "重构".into(),
            ..Default::default()
        };
        assert_eq!(display_name(&m), "#L4 重构");
    }
}
