//! Visualize feature: bundled omp plugin + spawn wiring.
//!
//! The app ships an omp "Agent Plugins" package (repo
//! `src-tauri/resources/plugins/omp-workspace-visualize/`, manifest +
//! `skills/visualize/SKILL.md`) embedded via `include_str!`. At startup it is
//! written to `~/.omp-workspace/plugins/omp-workspace-visualize/` and every
//! app-launched session gets `--plugin-dir <that dir>` when
//! `settings.visualize_enabled` is on (default). omp then lists `visualize` in
//! the system-prompt skills section and registers `/skill:visualize`; the
//! frontend renders ```` ```visualize ```` fenced blocks in the sandboxed
//! viewer (see `src/features/chat/visualize/`).

use std::path::{Path, PathBuf};

use crate::paths;

/// Bundled plugin manifest (agent-plugins.org 1.0.0 schema).
const PLUGIN_JSON: &str = include_str!("../resources/plugins/omp-workspace-visualize/plugin.json");
/// Bundled skill guidance (the model-facing visualize contract).
const SKILL_MD: &str =
    include_str!("../resources/plugins/omp-workspace-visualize/skills/visualize/SKILL.md");

/// `~/.omp-workspace/plugins/omp-workspace-visualize/`
pub fn plugin_dir() -> PathBuf {
    paths::data_dir()
        .join("plugins")
        .join("omp-workspace-visualize")
}

/// Write `content` to `path` when missing or different (atomic temp + rename).
/// Returns true if written.
fn write_if_changed(path: &Path, content: &str) -> std::io::Result<bool> {
    if std::fs::read_to_string(path).is_ok_and(|cur| cur == content) {
        return Ok(false);
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content)?;
    std::fs::rename(&tmp, path)?;
    Ok(true)
}

/// Install the bundled plugin into `~/.omp-workspace/plugins/` (startup).
/// Best-effort: failures only mean sessions won't get the skill this launch.
pub fn install() {
    let dir = plugin_dir();
    for (rel, content) in [
        ("plugin.json", PLUGIN_JSON),
        ("skills/visualize/SKILL.md", SKILL_MD),
    ] {
        if let Err(e) = write_if_changed(&dir.join(rel), content) {
            tracing::warn!("install visualize plugin ({rel}): {e}");
        }
    }
}

/// The `--plugin-dir` argument for a spawn, or None when disabled or incomplete.
/// Both embedded files must be installed together; a failed skill write must not
/// leave the manifest advertising a missing or stale model-facing contract.
pub fn spawn_plugin_dir(enabled: bool) -> Option<PathBuf> {
    if !enabled {
        return None;
    }
    let dir = plugin_dir();
    complete_bundle(&dir).then_some(dir)
}

fn complete_bundle(dir: &Path) -> bool {
    [
        ("plugin.json", PLUGIN_JSON),
        ("skills/visualize/SKILL.md", SKILL_MD),
    ]
    .into_iter()
    .all(|(rel, content)| {
        std::fs::read_to_string(dir.join(rel)).is_ok_and(|current| current == content)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_manifest_and_skill_then_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("ompws-viz-{}", uuid::Uuid::new_v4()));
        let manifest = dir.join("plugin.json");
        let skill = dir.join("skills/visualize/SKILL.md");
        assert!(write_if_changed(&manifest, PLUGIN_JSON).unwrap());
        assert!(write_if_changed(&skill, SKILL_MD).unwrap());
        assert!(!write_if_changed(&manifest, PLUGIN_JSON).unwrap());
        assert!(!write_if_changed(&skill, SKILL_MD).unwrap());
        // Drifted content is rewritten.
        std::fs::write(&skill, "stale").unwrap();
        assert!(write_if_changed(&skill, SKILL_MD).unwrap());
        assert_eq!(std::fs::read_to_string(&skill).unwrap(), SKILL_MD);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn spawn_plugin_dir_respects_enabled_flag() {
        assert!(spawn_plugin_dir(false).is_none());
    }

    #[test]
    fn incomplete_or_stale_bundle_is_not_spawned() {
        let dir = std::env::temp_dir().join(format!("ompws-viz-partial-{}", uuid::Uuid::new_v4()));
        let manifest = dir.join("plugin.json");
        let skill = dir.join("skills/visualize/SKILL.md");
        assert!(!complete_bundle(&dir));
        write_if_changed(&manifest, PLUGIN_JSON).unwrap();
        assert!(
            !complete_bundle(&dir),
            "manifest alone cannot advertise the skill"
        );

        // Deterministic failed install: the skill path is occupied by a directory.
        std::fs::create_dir_all(&skill).unwrap();
        assert!(write_if_changed(&skill, SKILL_MD).is_err());
        assert!(!complete_bundle(&dir));
        std::fs::remove_dir(&skill).unwrap();
        write_if_changed(&skill, SKILL_MD).unwrap();
        assert!(complete_bundle(&dir));

        std::fs::write(&skill, "stale guidance").unwrap();
        assert!(
            !complete_bundle(&dir),
            "partial upgrades must not load old skill content"
        );
        write_if_changed(&skill, SKILL_MD).unwrap();
        std::fs::write(&manifest, "{}").unwrap();
        assert!(!complete_bundle(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
