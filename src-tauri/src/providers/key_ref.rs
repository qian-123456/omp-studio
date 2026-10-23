//! Command-reference mechanism for encrypted provider keys.
//!
//! An "encrypted" provider keeps `apiKey: "!'<shim>' '<id>'"` in OMP's own
//! `models.yml`. OMP runs that value through `/bin/sh -c`, which executes the shim
//! `<data_dir>/bin/ompws-key`; the shim re-invokes this binary with
//! `--ompws-key <id>`, which prints the decrypted vault key to stdout. Nothing
//! but the vault holds the secret, and it works in any terminal OMP runs in.

use std::path::{Path, PathBuf};

use crate::paths;

use super::commands::sanitize_slug;
use super::vault;

/// CLI flag handled by `main.rs` before any Tauri initialisation.
pub const KEY_FLAG: &str = "--ompws-key";

/// `<data_dir>/bin/ompws-key`
pub fn shim_path() -> PathBuf {
    paths::data_dir().join("bin").join("ompws-key")
}

/// Vault entry name for a provider id.
pub fn vault_slug(id: &str) -> String {
    sanitize_slug(id)
}

/// POSIX sh single-quoting: wrap in `'` and turn each `'` into `'\''`.
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// The raw `apiKey` value (before YAML quoting): `!'<shim>' '<id>'`.
pub fn command_ref(shim: &Path, id: &str) -> String {
    format!("!{} {}", sh_quote(&shim.to_string_lossy()), sh_quote(id))
}

/// Split a string of sh single-quoted words (`'a' 'b'\''c'`). Anything that is
/// not single-quoted text, whitespace between words or an escaped quote → `None`.
fn parse_sh_words(s: &str) -> Option<Vec<String>> {
    let mut words = Vec::new();
    let mut cur: Option<String> = None;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                let word = cur.get_or_insert_with(String::new);
                loop {
                    match chars.next()? {
                        '\'' => break,
                        ch => word.push(ch),
                    }
                }
            }
            '\\' => {
                if chars.next()? != '\'' {
                    return None;
                }
                cur.get_or_insert_with(String::new).push('\'');
            }
            c if c.is_whitespace() => {
                if let Some(w) = cur.take() {
                    words.push(w);
                }
            }
            _ => return None,
        }
    }
    if let Some(w) = cur {
        words.push(w);
    }
    Some(words)
}

/// Inverse of [`command_ref`]: `(shim path, provider id)`.
pub fn parse_command_ref(value: &str) -> Option<(String, String)> {
    let rest = value.trim().strip_prefix('!')?;
    let mut words = parse_sh_words(rest)?;
    if words.len() != 2 {
        return None;
    }
    let id = words.pop()?;
    let shim = words.pop()?;
    Some((shim, id))
}

/// True when `value` is the command reference for `id` through `shim`.
pub fn is_ref_for(value: &str, shim: &Path, id: &str) -> bool {
    parse_command_ref(value).is_some_and(|(s, i)| Path::new(&s) == shim && i == id)
}

/// Content of the shim script for `exe`; `data_dir` is exported only when the
/// data directory is overridden.
pub fn shim_script(exe: &Path, data_dir_override: Option<&Path>) -> String {
    let mut out = String::from("#!/bin/sh\n");
    if let Some(dir) = data_dir_override {
        let q = sh_quote(&dir.to_string_lossy());
        out.push_str(&format!("OMPWS_DATA_DIR={q}; export OMPWS_DATA_DIR\n"));
    }
    out.push_str(&format!(
        "exec {} {KEY_FLAG} \"$@\"\n",
        sh_quote(&exe.to_string_lossy())
    ));
    out
}

fn data_dir_override() -> Option<PathBuf> {
    std::env::var("OMPWS_DATA_DIR")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(|v| PathBuf::from(v.trim()))
}

/// Write the shim for the running executable when its content differs.
pub fn install_shim() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法确定应用路径: {}", e.kind()))?;
    install_shim_at(
        &shim_path(),
        &shim_script(&exe, data_dir_override().as_deref()),
    )
}

fn install_shim_at(path: &Path, content: &str) -> Result<(), String> {
    if std::fs::read_to_string(path).is_ok_and(|cur| cur == content) {
        return Ok(());
    }
    let dir = path
        .parent()
        .ok_or_else(|| "密钥脚本路径无效".to_string())?;
    std::fs::create_dir_all(dir).map_err(|e| format!("创建 bin 目录失败: {}", e.kind()))?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("写入密钥脚本失败: {}", e.kind()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("设置密钥脚本权限失败: {}", e.kind()))?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("替换密钥脚本失败: {}", e.kind()))
}

/// Decrypted key for provider `id`; errors never contain key material.
fn key_for_cli(id: &str) -> Result<String, String> {
    let slug = vault_slug(id);
    // `contains` first: `master_key` would create a key for an empty vault.
    if !vault::contains(&slug) {
        return Err(format!("no vault entry for provider '{id}'"));
    }
    vault::read_entry(&slug)?.ok_or_else(|| format!("no vault entry for provider '{id}'"))
}

/// Body of `omp-workspace --ompws-key <id>`: prints the key (no newline) to
/// stdout and returns the exit code. Messages on stderr are secret-free.
pub fn run_cli(id: Option<String>) -> i32 {
    use std::io::Write;
    let Some(id) = id else {
        eprintln!("usage: {KEY_FLAG} <provider id>");
        return 1;
    };
    match key_for_cli(&id) {
        Ok(key) => {
            let mut out = std::io::stdout().lock();
            if out
                .write_all(key.as_bytes())
                .and_then(|()| out.flush())
                .is_err()
            {
                return 1;
            }
            0
        }
        Err(e) => {
            eprintln!("ompws-key: {e}");
            1
        }
    }
}

/// YAML double-quoted scalar (`\` and `"` escaped; control chars as `\uXXXX`).
pub fn yaml_double_quoted(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| format!("\"{s}\""))
}

/// The `apiKey` scalar for an encrypted provider, ready to follow `apiKey: `.
pub fn command_ref_yaml(shim: &Path, id: &str) -> String {
    yaml_double_quoted(&command_ref(shim, id))
}

#[cfg(test)]
mod tests {
    use super::*;

    const IDS: [&str; 6] = [
        "plain",
        "with space",
        "a+b",
        "it's",
        "聪明 AI-散户",
        "mix ' \" \\ $x `y`",
    ];

    #[test]
    fn command_ref_round_trips_awkward_ids() {
        let shim = Path::new("/Users/some one/.omp-workspace/bin/ompws-key");
        for id in IDS {
            let r = command_ref(shim, id);
            assert_eq!(
                parse_command_ref(&r),
                Some((shim.to_string_lossy().into_owned(), id.to_string())),
                "{id}"
            );
            assert!(is_ref_for(&r, shim, id));
            assert!(!is_ref_for(&r, shim, "other"));
        }
    }

    #[test]
    fn command_ref_survives_yaml_quoting() {
        let shim = Path::new("/d/bin/ompws-key");
        for id in IDS {
            let yaml = format!("apiKey: {}\n", command_ref_yaml(shim, id));
            let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(&yaml).unwrap();
            let got = v.get("apiKey").and_then(|v| v.as_str()).unwrap();
            assert_eq!(got, command_ref(shim, id), "{id}");
        }
        assert_eq!(
            command_ref_yaml(shim, "it's"),
            r#""!'/d/bin/ompws-key' 'it'\\''s'""#
        );
    }

    #[test]
    fn non_references_do_not_parse() {
        assert_eq!(parse_command_ref("plain-key"), None);
        assert_eq!(parse_command_ref("!echo hi"), None);
        assert_eq!(parse_command_ref("!'a'"), None);
        assert_eq!(parse_command_ref("!'a' 'b' 'c'"), None);
        assert_eq!(parse_command_ref("!'a' b"), None);
    }

    #[test]
    fn shim_script_shapes() {
        let exe = Path::new("/Applications/OMP Workspace.app/Contents/MacOS/omp-workspace");
        assert_eq!(
            shim_script(exe, None),
            "#!/bin/sh\nexec '/Applications/OMP Workspace.app/Contents/MacOS/omp-workspace' --ompws-key \"$@\"\n"
        );
        let with = shim_script(exe, Some(Path::new("/tmp/d'ir")));
        assert!(with.contains("OMPWS_DATA_DIR='/tmp/d'\\''ir'; export OMPWS_DATA_DIR\n"));
    }

    #[test]
    fn install_shim_is_idempotent_and_private() {
        let dir = std::env::temp_dir().join(format!("ompws-shim-{}", uuid::Uuid::new_v4()));
        let path = dir.join("bin").join("ompws-key");
        install_shim_at(&path, "#!/bin/sh\nA\n").unwrap();
        install_shim_at(&path, "#!/bin/sh\nB\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "#!/bin/sh\nB\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }
        let _ = std::fs::remove_dir_all(dir);
    }
}
