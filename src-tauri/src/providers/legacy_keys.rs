//! Startup migration of vault-backed provider keys to plaintext `models.yml`.
//!
//! Older versions could keep a provider key in the AES vault and put a command
//! reference (`apiKey: "!'<data_dir>/bin/ompws-key' '<id>'"`) in OMP's
//! `models.yml`. That storage mode is gone; keys live in models.yml as plaintext
//! (OMP's own format). For every provider whose `apiKey` is a reference through
//! THIS instance's shim for its own id, the vault key is written into models.yml
//! (through `edit_file`: timestamped backup, read-back verification, restore on
//! failure) and only then dropped from the vault.
//!
//! `~/.omp/agent/models.yml` is shared by every dev instance, each with its own
//! data directory, vault and shim: references to another instance's shim are
//! never touched. A provider whose vault entry is missing or unreadable stays
//! exactly as it is (the `--ompws-key` CLI in [`super::key_ref`] keeps serving
//! it). The shim file is deleted once models.yml no longer mentions it.
//! Other vault entries (the Cloudflare DDNS token) are never touched. Idempotent;
//! errors are logged (never with key material) and never panic.

use std::path::Path;

use super::models_yml_providers::{self as yml, edit_file};
use super::{key_ref, vault};

/// Vault slug of the Cloudflare DDNS token (`mobile::ddns::VAULT_SLUG`): never
/// a provider key, so never read or removed here.
const RESERVED_SLUGS: [&str; 1] = [crate::mobile::ddns::VAULT_SLUG];

/// The slice of the vault this migration needs (a fake in tests).
trait LegacyVault {
    /// Decrypted entry for `slug`; `Ok(None)` when there is none.
    fn read(&self, slug: &str) -> Result<Option<String>, String>;
    fn remove(&self, slug: &str) -> Result<(), String>;
}

struct RealVault;

impl LegacyVault for RealVault {
    fn read(&self, slug: &str) -> Result<Option<String>, String> {
        // `contains` first: `read_entry` would create a master key for an empty vault.
        if !vault::contains(slug) {
            return Ok(None);
        }
        vault::read_entry(slug)
    }
    fn remove(&self, slug: &str) -> Result<(), String> {
        vault::remove_entry(slug)
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
struct Report {
    /// Providers whose key now sits in models.yml as plaintext.
    migrated: usize,
    /// Providers with a reference through this shim that were left untouched.
    skipped: usize,
    /// The shim file was deleted.
    shim_removed: bool,
}

/// Startup entry (after the `providers.json` migration), against the real
/// files. Runs before any command, so it needs no `MUTATION_LOCK`.
pub fn migrate_vault_keys_to_plaintext() {
    let models = yml::models_yml_path();
    let shim = key_ref::shim_path();
    match migrate(&models, &shim, &RealVault) {
        Ok(r) => {
            if r.migrated > 0 || r.skipped > 0 || r.shim_removed {
                tracing::info!(
                    "providers: moved {} vault key(s) to models.yml, {} left as is{}",
                    r.migrated,
                    r.skipped,
                    if r.shim_removed {
                        ", removed key shim"
                    } else {
                        ""
                    }
                );
            }
        }
        Err(e) => tracing::warn!("providers: vault key migration failed: {e}"),
    }
}

/// A key written as plaintext `apiKey`: trimmed, non-empty, single-line and not
/// a `!command` (OMP would execute that instead of sending it).
fn plain_key(raw: &str) -> Option<&str> {
    let key = raw.trim();
    (!key.is_empty() && !key.starts_with('!') && !key.contains(['\0', '\n', '\r'])).then_some(key)
}

/// Whether models.yml (or its text) still refers to `shim`.
fn mentions_shim(text: &str, shim: &Path) -> bool {
    let shim_str = shim.to_string_lossy();
    if text.contains(shim_str.as_ref()) {
        return true;
    }
    // Quoted differently in YAML (escapes): fall back to the parsed values.
    yml::parse_providers(text).is_ok_and(|ps| {
        ps.iter().any(|p| {
            p.api_key
                .as_deref()
                .and_then(key_ref::parse_command_ref)
                .is_some_and(|(s, _)| Path::new(&s) == shim)
        })
    })
}

fn migrate(models_yml: &Path, shim: &Path, vault: &dyn LegacyVault) -> Result<Report, String> {
    let providers = yml::read_providers(models_yml)?;
    let mut report = Report::default();
    let mut migrated_slugs = Vec::new();

    for p in &providers {
        let Some(raw) = p.api_key.as_deref() else {
            continue;
        };
        if !key_ref::is_ref_for(raw, shim, &p.id) {
            continue;
        }
        let slug = key_ref::vault_slug(&p.id);
        let key = if RESERVED_SLUGS.contains(&slug.as_str()) {
            Err("reserved vault entry".to_string())
        } else {
            vault.read(&slug).and_then(|k| {
                k.as_deref()
                    .and_then(plain_key)
                    .map(str::to_string)
                    .ok_or_else(|| "no usable vault entry".to_string())
            })
        };
        let written = key.and_then(|key| {
            edit_file(
                models_yml,
                &|t| yml::set_field(t, &p.id, "apiKey", Some(&yml::yaml_scalar(&key))),
                &|w| {
                    let ok = yml::parse_providers(w)
                        .map_err(|_| "写入后 models.yml 无法解析".to_string())?
                        .iter()
                        .any(|q| q.id == p.id && q.api_key.as_deref() == Some(key.as_str()));
                    ok.then_some(())
                        .ok_or_else(|| format!("写入后校验失败: {}", p.id))
                },
            )
        });
        match written {
            Ok(()) => {
                report.migrated += 1;
                migrated_slugs.push(slug);
            }
            Err(e) => {
                tracing::warn!("providers: key of '{}' left in the vault: {e}", p.id);
                report.skipped += 1;
            }
        }
    }

    // Entries go only after every write has succeeded.
    for slug in migrated_slugs {
        if let Err(e) = vault.remove(&slug) {
            tracing::warn!("providers: could not drop migrated vault entry '{slug}': {e}");
        }
    }

    // Foreign refs, failures and unparseable leftovers keep the shim alive.
    let text = match std::fs::read_to_string(models_yml) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(format!("读取 models.yml 失败: {}", e.kind())),
    };
    if !mentions_shim(&text, shim) {
        match std::fs::remove_file(shim) {
            Ok(()) => report.shim_removed = true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!("providers: could not remove key shim: {}", e.kind()),
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::path::PathBuf;

    #[derive(Default)]
    struct MemVault {
        entries: RefCell<HashMap<String, String>>,
        /// Slugs whose read fails (unreadable ciphertext / master key).
        broken: RefCell<HashSet<String>>,
        /// Number of `remove` calls, in order.
        removed: RefCell<Vec<String>>,
    }

    impl MemVault {
        fn with(entries: &[(&str, &str)]) -> Self {
            let v = MemVault::default();
            for (k, val) in entries {
                v.entries
                    .borrow_mut()
                    .insert(k.to_string(), val.to_string());
            }
            v
        }
        fn has(&self, slug: &str) -> bool {
            self.entries.borrow().contains_key(slug)
        }
    }

    impl LegacyVault for MemVault {
        fn read(&self, slug: &str) -> Result<Option<String>, String> {
            if self.broken.borrow().contains(slug) {
                return Err("解密失败".into());
            }
            Ok(self.entries.borrow().get(slug).cloned())
        }
        fn remove(&self, slug: &str) -> Result<(), String> {
            self.removed.borrow_mut().push(slug.to_string());
            self.entries.borrow_mut().remove(slug);
            Ok(())
        }
    }

    struct Fx {
        dir: PathBuf,
        models: PathBuf,
        shim: PathBuf,
    }

    impl Fx {
        fn new(models_yml: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("ompws-legacy-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(dir.join("bin")).unwrap();
            let fx = Fx {
                models: dir.join("models.yml"),
                shim: dir.join("bin").join("ompws-key"),
                dir,
            };
            std::fs::write(&fx.models, models_yml).unwrap();
            std::fs::write(&fx.shim, "#!/bin/sh\n").unwrap();
            fx
        }
        fn run(&self, vault: &dyn LegacyVault) -> Report {
            migrate(&self.models, &self.shim, vault).unwrap()
        }
        fn text(&self) -> String {
            std::fs::read_to_string(&self.models).unwrap()
        }
        fn key(&self, id: &str) -> Option<String> {
            yml::read_providers(&self.models)
                .unwrap()
                .into_iter()
                .find(|p| p.id == id)
                .and_then(|p| p.api_key)
        }
        fn reference(&self, id: &str) -> String {
            key_ref::command_ref(&self.shim, id)
        }
        fn baks(&self) -> usize {
            std::fs::read_dir(&self.dir)
                .unwrap()
                .filter(|e| {
                    e.as_ref()
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with("models.yml.bak-")
                })
                .count()
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// models.yml with the given `(id, apiKey)` blocks, other fields untouched.
    fn yaml(blocks: &[(&str, &str)]) -> String {
        let mut out = String::from("# user comment\nproviders:\n");
        for (id, key) in blocks {
            out.push_str(&format!(
                "  {}:\n    baseUrl: https://{}.example/v1\n    api: openai-completions\n    apiKey: {}\n    models:\n      - id: m1\n",
                yml::yaml_double_quoted(id),
                id.replace(' ', "-"),
                yml::yaml_double_quoted(key)
            ));
        }
        out
    }

    fn with_refs(ids: &[&str]) -> Fx {
        let fx = Fx::new("");
        let blocks: Vec<(String, String)> = ids
            .iter()
            .map(|id| (id.to_string(), fx.reference(id)))
            .collect();
        let borrowed: Vec<(&str, &str)> = blocks
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        std::fs::write(&fx.models, yaml(&borrowed)).unwrap();
        fx
    }

    #[test]
    fn migrates_keys_drops_entries_and_removes_the_shim() {
        let fx = with_refs(&["alpha", "beta"]);
        let before = fx.text();
        let vault = MemVault::with(&[
            ("alpha", "sk-alpha"),
            ("beta", "sk-beta"),
            (crate::mobile::ddns::VAULT_SLUG, "cf-token"),
        ]);
        let r = fx.run(&vault);
        assert_eq!(
            r,
            Report {
                migrated: 2,
                skipped: 0,
                shim_removed: true
            }
        );
        assert_eq!(fx.key("alpha").as_deref(), Some("sk-alpha"));
        assert_eq!(fx.key("beta").as_deref(), Some("sk-beta"));
        assert!(!fx.text().contains("ompws-key"));
        assert!(fx.text().starts_with("# user comment\n"));
        assert!(fx.baks() >= 1, "models.yml backed up");
        // the rest of each block is untouched
        assert_eq!(
            fx.text()
                .replace("sk-alpha", "X")
                .replace("sk-beta", "Y")
                .lines()
                .count(),
            before.lines().count()
        );
        assert!(!vault.has("alpha") && !vault.has("beta"));
        assert!(
            vault.has(crate::mobile::ddns::VAULT_SLUG),
            "DDNS token kept"
        );
        assert_eq!(vault.removed.borrow().len(), 2);
        assert!(!fx.shim.exists());
    }

    #[test]
    fn second_run_is_a_no_op() {
        let fx = with_refs(&["alpha"]);
        let vault = MemVault::with(&[("alpha", "sk-alpha")]);
        assert_eq!(fx.run(&vault).migrated, 1);
        let after = fx.text();
        let baks = fx.baks();
        let again = fx.run(&vault);
        assert_eq!(again, Report::default());
        assert_eq!(fx.text(), after);
        assert_eq!(fx.baks(), baks, "no further write, no new backup");
        assert_eq!(vault.removed.borrow().len(), 1);
    }

    #[test]
    fn missing_or_unreadable_vault_entry_leaves_everything_untouched() {
        for broken in [false, true] {
            let fx = with_refs(&["alpha", "beta"]);
            let before = fx.text();
            let vault = MemVault::with(&[("alpha", "sk-alpha")]);
            if broken {
                vault.broken.borrow_mut().insert("beta".into());
                vault.entries.borrow_mut().insert("beta".into(), "x".into());
            }
            let r = fx.run(&vault);
            // alpha migrates, beta keeps its reference and the shim stays
            assert_eq!(
                r,
                Report {
                    migrated: 1,
                    skipped: 1,
                    shim_removed: false
                }
            );
            assert_eq!(fx.key("alpha").as_deref(), Some("sk-alpha"));
            assert_eq!(fx.key("beta"), Some(fx.reference("beta")));
            assert!(fx.shim.exists());
            assert_eq!(vault.has("beta"), broken, "beta entry untouched");
            assert!(!vault.has("alpha"));
            assert_ne!(fx.text(), before);
        }

        let fx = with_refs(&["alpha"]);
        let before = fx.text();
        let r = fx.run(&MemVault::default());
        assert_eq!((r.migrated, r.skipped, r.shim_removed), (0, 1, false));
        assert_eq!(fx.text(), before, "no write, no backup");
        assert_eq!(fx.baks(), 0);
        assert!(fx.shim.exists());
    }

    #[test]
    fn unusable_vault_values_are_not_written() {
        for bad in ["!rm -rf", "   ", "a\nb"] {
            let fx = with_refs(&["alpha"]);
            let before = fx.text();
            let vault = MemVault::with(&[("alpha", bad)]);
            let r = fx.run(&vault);
            assert_eq!((r.migrated, r.skipped), (0, 1), "{bad:?}");
            assert_eq!(fx.text(), before);
            assert!(vault.has("alpha"));
            assert!(fx.shim.exists());
        }
    }

    #[test]
    fn references_through_another_shim_or_id_are_never_touched() {
        let fx = with_refs(&[]);
        let foreign = key_ref::command_ref(Path::new("/other/data/bin/ompws-key"), "alpha");
        let wrong_id = key_ref::command_ref(&fx.shim, "someone-else");
        std::fs::write(
            &fx.models,
            yaml(&[
                ("alpha", &foreign),
                ("beta", &wrong_id),
                ("gamma", "!pass show x"),
                ("delta", "sk-literal"),
                ("eps", "SOME_ENV"),
            ]),
        )
        .unwrap();
        let before = fx.text();
        let vault = MemVault::with(&[
            ("alpha", "sk-alpha"),
            ("beta", "sk-beta"),
            ("gamma", "sk-gamma"),
        ]);
        let r = fx.run(&vault);
        // beta points at this shim (for another id): not ours to convert, shim stays
        assert_eq!((r.migrated, r.skipped, r.shim_removed), (0, 0, false));
        assert_eq!(fx.text(), before);
        assert_eq!(vault.entries.borrow().len(), 3);
        assert!(vault.removed.borrow().is_empty());
        assert!(fx.shim.exists());
    }

    #[test]
    fn shim_is_removed_when_models_yml_only_has_foreign_or_no_refs() {
        let fx = with_refs(&[]);
        let foreign = key_ref::command_ref(Path::new("/other/data/bin/ompws-key"), "alpha");
        std::fs::write(&fx.models, yaml(&[("alpha", &foreign), ("beta", "sk-1")])).unwrap();
        let before = fx.text();
        let r = fx.run(&MemVault::with(&[("alpha", "sk-alpha")]));
        assert_eq!(
            r,
            Report {
                migrated: 0,
                skipped: 0,
                shim_removed: true
            }
        );
        assert_eq!(fx.text(), before, "foreign ref untouched");
        assert!(!fx.shim.exists());
        // absent shim is fine
        assert_eq!(fx.run(&MemVault::default()), Report::default());
        // absent models.yml too
        std::fs::remove_file(&fx.models).unwrap();
        assert_eq!(fx.run(&MemVault::default()), Report::default());
    }

    #[test]
    fn unparseable_models_yml_changes_nothing_and_keeps_the_shim() {
        let fx = Fx::new("providers: [oops\n");
        let vault = MemVault::with(&[("alpha", "sk-alpha")]);
        assert!(migrate(&fx.models, &fx.shim, &vault).is_err());
        assert_eq!(fx.text(), "providers: [oops\n");
        assert!(fx.shim.exists());
        assert!(vault.has("alpha"));
    }

    #[cfg(unix)]
    #[test]
    fn write_failure_keeps_the_vault_entry_the_reference_and_the_shim() {
        use std::os::unix::fs::PermissionsExt;
        let fx = with_refs(&["alpha"]);
        std::fs::set_permissions(&fx.models, std::fs::Permissions::from_mode(0o444)).unwrap();
        if std::fs::OpenOptions::new()
            .append(true)
            .open(&fx.models)
            .is_ok()
        {
            // running as a user that ignores permissions (root): cannot simulate
            return;
        }
        let before = fx.text();
        let vault = MemVault::with(&[("alpha", "sk-alpha")]);
        let r = fx.run(&vault);
        assert_eq!((r.migrated, r.skipped, r.shim_removed), (0, 1, false));
        assert_eq!(fx.text(), before);
        assert!(vault.has("alpha"), "vault entry kept after failed write");
        assert!(vault.removed.borrow().is_empty());
        assert!(fx.shim.exists());

        // once writable again the next startup completes the migration
        std::fs::set_permissions(&fx.models, std::fs::Permissions::from_mode(0o644)).unwrap();
        // backups are named by millisecond; the first one inherited 0o444
        std::thread::sleep(std::time::Duration::from_millis(5));
        let r = fx.run(&vault);
        assert_eq!((r.migrated, r.shim_removed), (1, true));
        assert_eq!(fx.key("alpha").as_deref(), Some("sk-alpha"));
        assert!(!vault.has("alpha"));
    }

    #[test]
    fn a_provider_named_like_the_ddns_entry_never_receives_the_ddns_token() {
        let id = crate::mobile::ddns::VAULT_SLUG;
        let fx = with_refs(&[id]);
        let before = fx.text();
        let vault = MemVault::with(&[(id, "cf-token")]);
        let r = fx.run(&vault);
        assert_eq!((r.migrated, r.skipped, r.shim_removed), (0, 1, false));
        assert_eq!(fx.text(), before);
        assert!(!fx.text().contains("cf-token"));
        assert!(vault.has(id));
    }

    #[test]
    fn keys_with_yaml_special_characters_round_trip() {
        let fx = with_refs(&["alpha", "beta", "gamma"]);
        let vault = MemVault::with(&[
            ("alpha", "k: v #x"),
            ("beta", "\"quoted\" 'single' \\"),
            ("gamma", "  spaced-123  "),
        ]);
        assert_eq!(fx.run(&vault).migrated, 3);
        assert_eq!(fx.key("alpha").as_deref(), Some("k: v #x"));
        assert_eq!(fx.key("beta").as_deref(), Some("\"quoted\" 'single' \\"));
        assert_eq!(fx.key("gamma").as_deref(), Some("spaced-123"));
    }
}
