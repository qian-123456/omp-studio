//! Legacy command-reference support (read-only).
//!
//! Older versions could keep a provider key in an AES vault and write
//! `apiKey: "!'<shim>' '<id>'"` into OMP's `models.yml`; OMP ran that through
//! `/bin/sh -c`, executing the shim `<data_dir>/bin/ompws-key`, which
//! re-invokes this binary with `--ompws-key <id>` to print the decrypted key.
//! That storage mode is gone: keys are plaintext in models.yml. This module only
//! recognises such leftover references ([`parse_command_ref`], [`is_ref_for`])
//! and still serves the `--ompws-key` CLI ([`run_cli`]) so a reference that
//! could not be migrated by `providers::legacy_keys` keeps working in OMP.
//! Nothing here generates references or installs the shim any more.

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
#[cfg(test)]
fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// The raw `apiKey` value (before YAML quoting): `!'<shim>' '<id>'`. Test-only:
/// production code never writes references.
#[cfg(test)]
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
            let r = command_ref(shim, id);
            let yaml = format!(
                "apiKey: {}\n",
                crate::providers::models_yml_providers::yaml_double_quoted(&r)
            );
            let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(&yaml).unwrap();
            let got = v.get("apiKey").and_then(|v| v.as_str()).unwrap();
            assert_eq!(got, r, "{id}");
        }
    }

    #[test]
    fn non_references_do_not_parse() {
        assert_eq!(parse_command_ref("plain-key"), None);
        assert_eq!(parse_command_ref("!echo hi"), None);
        assert_eq!(parse_command_ref("!'a'"), None);
        assert_eq!(parse_command_ref("!'a' 'b' 'c'"), None);
        assert_eq!(parse_command_ref("!'a' b"), None);
    }
}
