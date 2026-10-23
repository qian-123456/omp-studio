//! Provider mutations over OMP's `models.yml` and the key vault.
//!
//! Pure over explicit paths and a [`KeyStore`], so tests need no global state.
//! Every `models.yml` write goes through `models_yml_providers::edit_file`
//! (timestamped backup, read-back verification, restore on failure); vault
//! changes are rolled back when that write fails. Callers hold
//! `providers::MUTATION_LOCK`. Errors are user-facing and never contain keys.

use std::path::Path;

use crate::contracts::{KeyMode, ProviderKeyKind, ProviderUpsert};

use super::commands::sanitize_slug;
use super::models_yml_providers::{self as yml, edit_file, BlockSpec, YmlProvider};
use super::rows::{self, KeyEnv};
use super::{key_ref, vault};

/// Where encrypted provider keys live.
pub trait KeyStore {
    fn has(&self, slug: &str) -> bool;
    fn get(&self, slug: &str) -> Result<Option<String>, String>;
    fn put(&self, slug: &str, key: &str) -> Result<(), String>;
    fn remove(&self, slug: &str) -> Result<(), String>;
}

/// The real encrypted vault (`~/.omp-workspace/env/keys.env`).
pub struct VaultStore;

impl KeyStore for VaultStore {
    fn has(&self, slug: &str) -> bool {
        vault::contains(slug)
    }
    fn get(&self, slug: &str) -> Result<Option<String>, String> {
        if !vault::contains(slug) {
            return Ok(None);
        }
        vault::read_entry(slug)
    }
    fn put(&self, slug: &str, key: &str) -> Result<(), String> {
        vault::write_entry(slug, key)
    }
    fn remove(&self, slug: &str) -> Result<(), String> {
        vault::remove_entry(slug)
    }
}

pub struct Env<'a> {
    pub models_yml: &'a Path,
    pub shim: &'a Path,
    pub store: &'a dyn KeyStore,
}

impl Env<'_> {
    pub fn provider(&self, id: &str) -> Result<Option<YmlProvider>, String> {
        Ok(yml::read_providers(self.models_yml)?
            .into_iter()
            .find(|p| p.id == id))
    }

    fn kind_of(&self, p: &YmlProvider) -> ProviderKeyKind {
        let vault_has = |slug: &str| self.store.has(slug);
        let env_set = |_: &str| false;
        rows::detect_key(
            &p.id,
            p.api_key.as_deref(),
            p.auth_none,
            &[],
            &KeyEnv {
                shim: self.shim,
                vault_has: &vault_has,
                env_set: &env_set,
            },
        )
        .kind
    }

    fn is_own_ref(&self, p: &YmlProvider) -> bool {
        p.api_key
            .as_deref()
            .is_some_and(|v| key_ref::is_ref_for(v, self.shim, &p.id))
    }
}

/// `<SLUG_UPPER>_API_KEY` line name used by the `.env` export.
pub fn export_var_name(id: &str) -> String {
    let upper: String = sanitize_slug(id)
        .to_ascii_uppercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{upper}_API_KEY")
}

fn validate_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("供应商 ID 不能为空".to_string());
    }
    if id.chars().any(char::is_control) {
        return Err("供应商 ID 不能包含控制字符".to_string());
    }
    Ok(id)
}

fn validate_key(key: &str) -> Result<&str, String> {
    let key = key.trim();
    if key.is_empty() {
        return Err("密钥不能为空".to_string());
    }
    if key.contains(['\0', '\n', '\r']) {
        return Err("密钥包含非法字符".to_string());
    }
    Ok(key)
}

fn is_local_url(base_url: &str) -> bool {
    let rest = base_url
        .split_once("://")
        .map_or(base_url, |(_, rest)| rest);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    let host = if let Some(v6) = host.strip_prefix('[') {
        v6.split(']').next().unwrap_or("")
    } else {
        host.split(':').next().unwrap_or("")
    };
    matches!(host, "localhost" | "127.0.0.1" | "::1" | "0.0.0.0")
}

/// Raw `apiKey` value and its YAML rendering for `mode`.
fn key_value(env: &Env, id: &str, key: &str, mode: KeyMode) -> (String, String) {
    match mode {
        KeyMode::Encrypted => (
            key_ref::command_ref(env.shim, id),
            key_ref::command_ref_yaml(env.shim, id),
        ),
        KeyMode::Plaintext => (key.to_string(), yml::yaml_scalar(key)),
    }
}

/// Set `providers.<id>.apiKey` (creating the block when absent), dropping a now
/// contradictory `auth: none`.
fn set_api_key_text(text: &str, id: &str, rendered: &str) -> Result<String, String> {
    let mut t = yml::ensure_provider(text, id)?;
    t = yml::set_field(&t, id, "apiKey", Some(rendered))?;
    if yml::parse_providers(&t)?
        .iter()
        .any(|p| p.id == id && p.auth_none)
    {
        t = yml::set_field(&t, id, "auth", None)?;
    }
    Ok(t)
}

fn check_api_key(written: &str, id: &str, raw: &str) -> Result<(), String> {
    let all =
        yml::parse_providers(written).map_err(|_| "写入后 models.yml 无法解析".to_string())?;
    if all
        .iter()
        .any(|p| p.id == id && p.api_key.as_deref() == Some(raw))
    {
        Ok(())
    } else {
        Err(format!("写入后校验失败: {id}"))
    }
}

/// Store `key` for `id` in `mode`; creates an override block for a built-in.
pub fn apply_key(env: &Env, id: &str, key: &str, mode: KeyMode) -> Result<(), String> {
    let key = validate_key(key)?;
    if mode == KeyMode::Plaintext && key.starts_with('!') {
        return Err("明文密钥不能以 ! 开头（OMP 会把它当作命令执行），请改用加密保存".to_string());
    }
    let slug = key_ref::vault_slug(id);
    let prev = env.store.get(&slug).ok().flatten();
    if mode == KeyMode::Encrypted {
        env.store.put(&slug, key)?;
    }
    let (raw, rendered) = key_value(env, id, key, mode);
    let result = edit_file(
        env.models_yml,
        &|t| set_api_key_text(t, id, &rendered),
        &|w| check_api_key(w, id, &raw),
    );
    if let Err(e) = result {
        if mode == KeyMode::Encrypted {
            let _ = match &prev {
                Some(p) => env.store.put(&slug, p),
                None => env.store.remove(&slug),
            };
        }
        return Err(e);
    }
    if mode == KeyMode::Plaintext {
        env.store.remove(&slug)?;
    }
    Ok(())
}

/// Move a plaintext `apiKey` into the vault and leave a command reference.
pub fn encrypt(env: &Env, id: &str) -> Result<(), String> {
    let p = env
        .provider(id)?
        .ok_or_else(|| "models.yml 中找不到该供应商".to_string())?;
    if env.kind_of(&p) != ProviderKeyKind::Plaintext {
        return Err("该供应商的密钥不是明文，无需加密".to_string());
    }
    let key = p.api_key.clone().unwrap_or_default();
    apply_key(env, id, &key, KeyMode::Encrypted)
}

/// Write the vault key back into `models.yml` as plaintext and drop the entry.
pub fn decrypt(env: &Env, id: &str) -> Result<(), String> {
    let p = env
        .provider(id)?
        .ok_or_else(|| "models.yml 中找不到该供应商".to_string())?;
    match env.kind_of(&p) {
        ProviderKeyKind::Encrypted => {}
        ProviderKeyKind::VaultMissing => {
            return Err("密钥库中找不到该供应商的密钥，请重新设置密钥".to_string())
        }
        _ => return Err("该供应商的密钥未加密，无需改回明文".to_string()),
    }
    let key = env
        .store
        .get(&key_ref::vault_slug(id))?
        .ok_or_else(|| "密钥库中找不到该供应商的密钥，请重新设置密钥".to_string())?;
    apply_key(env, id, &key, KeyMode::Plaintext)
}

/// Create or edit a custom provider block. Returns the (trimmed) provider id.
pub fn upsert(
    env: &Env,
    input: &ProviderUpsert,
    api_key: Option<&str>,
    mode: KeyMode,
) -> Result<String, String> {
    let id = validate_id(&input.id)?;
    let base_url = input.base_url.trim();
    let api = input.api.trim();
    if base_url.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    if api.is_empty() {
        return Err("API 协议不能为空".to_string());
    }
    let new_key = api_key
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(validate_key)
        .transpose()?;
    if mode == KeyMode::Plaintext && new_key.is_some_and(|k| k.starts_with('!')) {
        return Err("明文密钥不能以 ! 开头（OMP 会把它当作命令执行），请改用加密保存".to_string());
    }

    let all = yml::read_providers(env.models_yml)?;
    let orig = input
        .original_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let exists = |x: &str| all.iter().any(|p| p.id == x);
    match orig {
        None if exists(id) => return Err("供应商 ID 已存在".to_string()),
        Some(o) if !exists(o) => return Err("models.yml 中找不到要编辑的供应商".to_string()),
        Some(o) if o != id && exists(id) => return Err("供应商 ID 已存在".to_string()),
        _ => {}
    }
    let renaming = orig.is_some_and(|o| o != id);
    let old = orig.and_then(|o| all.iter().find(|p| p.id == o));
    let old_was_ref = old.is_some_and(|p| env.is_own_ref(p));
    let old_slug = old.map(|p| key_ref::vault_slug(&p.id));
    let slug = key_ref::vault_slug(id);
    let creating = orig.is_none();

    let spec = BlockSpec {
        id: id.to_string(),
        name: input.display_name.clone(),
        base_url: base_url.to_string(),
        api: api.to_string(),
        models: input.models.clone(),
        auth_none: creating && new_key.is_none() && is_local_url(base_url),
    };

    let prev = env.store.get(&slug).ok().flatten();
    let mut wrote_vault = false;
    if let Some(k) = new_key {
        if mode == KeyMode::Encrypted {
            env.store.put(&slug, k)?;
            wrote_vault = true;
        }
    } else if renaming && old_was_ref {
        let old_slug = old_slug.as_deref().unwrap_or_default();
        let v = env
            .store
            .get(old_slug)?
            .ok_or_else(|| "密钥库中找不到原供应商的密钥，请先重新设置密钥".to_string())?;
        env.store.put(&slug, &v)?;
        wrote_vault = true;
    }

    let key_edit = new_key.map(|k| key_value(env, id, k, mode));
    let carry_ref = renaming && old_was_ref && new_key.is_none();
    let carried = key_ref::command_ref(env.shim, id);
    let result = edit_file(
        env.models_yml,
        &|t| {
            let mut t = t.to_string();
            if let (true, Some(o)) = (renaming, orig) {
                t = yml::rename_provider(&t, o, id)?;
            }
            t = yml::upsert_block_text(&t, &spec)?;
            if let Some((_, rendered)) = &key_edit {
                t = set_api_key_text(&t, id, rendered)?;
            } else if carry_ref {
                t = yml::set_field(
                    &t,
                    id,
                    "apiKey",
                    Some(&key_ref::command_ref_yaml(env.shim, id)),
                )?;
            }
            Ok(t)
        },
        &|w| {
            yml::verify_block(w, &spec)?;
            if let Some((raw, _)) = &key_edit {
                check_api_key(w, id, raw)?;
            } else if carry_ref {
                check_api_key(w, id, &carried)?;
            }
            Ok(())
        },
    );
    if let Err(e) = result {
        if wrote_vault {
            let _ = match &prev {
                Some(p) => env.store.put(&slug, p),
                None => env.store.remove(&slug),
            };
        }
        return Err(e);
    }
    if renaming {
        if let Some(old_slug) = &old_slug {
            if *old_slug != slug {
                env.store.remove(old_slug)?;
            }
        }
    }
    if new_key.is_some() && mode == KeyMode::Plaintext {
        env.store.remove(&slug)?;
    }
    Ok(id.to_string())
}

/// Delete the `providers.<id>` block and its vault entry.
pub fn delete(env: &Env, id: &str) -> Result<(), String> {
    if env.provider(id)?.is_none() {
        return Err("该供应商是 OMP 内置供应商，没有可删除的配置".to_string());
    }
    edit_file(env.models_yml, &|t| yml::remove_provider(t, id), &|w| {
        if yml::ids_in(w).contains(id) {
            Err(format!("写入后校验失败: {id}"))
        } else {
            Ok(())
        }
    })?;
    env.store.remove(&key_ref::vault_slug(id))
}

/// The usable key of `id`: vault (encrypted), literal (plaintext) or a set env
/// var. `Ok(None)` for command / OAuth / missing keys.
pub fn resolve_key(
    env: &Env,
    id: &str,
    env_var: &dyn Fn(&str) -> Option<String>,
) -> Result<Option<String>, String> {
    let Some(p) = env.provider(id)? else {
        return Ok(None);
    };
    match env.kind_of(&p) {
        ProviderKeyKind::Encrypted => env.store.get(&key_ref::vault_slug(id)),
        ProviderKeyKind::Plaintext => Ok(p.api_key),
        ProviderKeyKind::EnvVar => Ok(p.api_key.as_deref().and_then(env_var)),
        _ => Ok(None),
    }
}

/// `<SLUG_UPPER>_API_KEY=<key>` lines for resolvable keys; `ids` fixes the
/// selection and order, otherwise every models.yml provider in file order.
pub fn export_env_text(
    env: &Env,
    ids: Option<&[String]>,
    env_var: &dyn Fn(&str) -> Option<String>,
) -> Result<String, String> {
    let all = yml::read_providers(env.models_yml)?;
    let order: Vec<&str> = match ids {
        Some(ids) => ids.iter().map(String::as_str).collect(),
        None => all.iter().map(|p| p.id.as_str()).collect(),
    };
    let mut seen = std::collections::HashSet::new();
    let mut out = String::new();
    for id in order {
        if !seen.insert(id) {
            continue;
        }
        if let Some(key) = resolve_key(env, id, env_var)? {
            out.push_str(&format!("{}={key}\n", export_var_name(id)));
        }
    }
    Ok(out)
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::contracts::ModelEntry;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[derive(Default)]
    pub struct MemStore(pub RefCell<HashMap<String, String>>);

    impl KeyStore for MemStore {
        fn has(&self, slug: &str) -> bool {
            self.0.borrow().contains_key(slug)
        }
        fn get(&self, slug: &str) -> Result<Option<String>, String> {
            Ok(self.0.borrow().get(slug).cloned())
        }
        fn put(&self, slug: &str, key: &str) -> Result<(), String> {
            self.0
                .borrow_mut()
                .insert(slug.to_string(), key.to_string());
            Ok(())
        }
        fn remove(&self, slug: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(slug);
            Ok(())
        }
    }

    const SHIM: &str = "/d/bin/ompws-key";

    struct Fx {
        dir: PathBuf,
        path: PathBuf,
        store: MemStore,
    }

    impl Fx {
        fn new(yaml: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("ompws-ops-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("models.yml");
            std::fs::write(&path, yaml).unwrap();
            Fx {
                dir,
                path,
                store: MemStore::default(),
            }
        }
        fn env(&self) -> Env<'_> {
            Env {
                models_yml: &self.path,
                shim: Path::new(SHIM),
                store: &self.store,
            }
        }
        fn text(&self) -> String {
            std::fs::read_to_string(&self.path).unwrap()
        }
    }

    impl Drop for Fx {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    const BASE: &str = "providers:\n  plain:\n    baseUrl: https://p.example/v1\n    api: openai-completions\n    apiKey: sk-plain-123\n    models:\n      - id: m1\n  other:\n    baseUrl: https://o.example\n    apiKey: OTHER_ENV\n  \"聪明 it's\":\n    baseUrl: https://c.example\n    apiKey: sk-cn-456\n";

    fn block_of(text: &str, id: &str) -> String {
        let all = yml::parse_providers(text).unwrap();
        format!("{:?}", all.iter().find(|p| p.id == id))
    }

    #[test]
    fn encrypt_then_decrypt_roundtrip_leaves_others_untouched() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        encrypt(&env, "plain").unwrap();
        let after = fx.text();
        let p = env.provider("plain").unwrap().unwrap();
        assert_eq!(
            p.api_key.as_deref(),
            Some(key_ref::command_ref(Path::new(SHIM), "plain").as_str())
        );
        assert!(!after.contains("sk-plain-123"));
        assert_eq!(
            fx.store.get("plain").unwrap().as_deref(),
            Some("sk-plain-123")
        );
        assert_eq!(block_of(&after, "other"), block_of(BASE, "other"));
        assert_eq!(block_of(&after, "聪明 it's"), block_of(BASE, "聪明 it's"));
        assert!(encrypt(&env, "plain").is_err(), "already encrypted");

        decrypt(&env, "plain").unwrap();
        assert_eq!(fx.text(), BASE);
        assert!(fx.store.get("plain").unwrap().is_none());
        assert!(decrypt(&env, "plain").is_err());
    }

    #[test]
    fn encrypt_handles_unicode_and_quote_ids() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        encrypt(&env, "聪明 it's").unwrap();
        let slug = key_ref::vault_slug("聪明 it's");
        assert_eq!(fx.store.get(&slug).unwrap().as_deref(), Some("sk-cn-456"));
        let p = env.provider("聪明 it's").unwrap().unwrap();
        let (shim, id) = key_ref::parse_command_ref(p.api_key.as_deref().unwrap()).unwrap();
        assert_eq!((shim.as_str(), id.as_str()), (SHIM, "聪明 it's"));
    }

    #[test]
    fn env_var_and_missing_cannot_be_encrypted() {
        let fx = Fx::new(BASE);
        assert!(encrypt(&fx.env(), "other").is_err());
        assert!(encrypt(&fx.env(), "nope").is_err());
        assert_eq!(fx.text(), BASE);
    }

    #[test]
    fn set_key_modes_and_builtin_override_block() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        apply_key(&env, "opencode-zen", "sk-new", KeyMode::Encrypted).unwrap();
        let p = env.provider("opencode-zen").unwrap().unwrap();
        assert!(p.base_url.is_none());
        assert!(key_ref::is_ref_for(
            p.api_key.as_deref().unwrap(),
            Path::new(SHIM),
            "opencode-zen"
        ));
        assert_eq!(
            fx.store.get("opencode-zen").unwrap().as_deref(),
            Some("sk-new")
        );

        apply_key(&env, "opencode-zen", "sk-plain", KeyMode::Plaintext).unwrap();
        assert_eq!(
            env.provider("opencode-zen")
                .unwrap()
                .unwrap()
                .api_key
                .as_deref(),
            Some("sk-plain")
        );
        assert!(!fx.store.has("opencode-zen"), "stale vault entry dropped");

        assert!(apply_key(&env, "plain", "!rm -rf", KeyMode::Plaintext).is_err());
        assert!(apply_key(&env, "plain", "  ", KeyMode::Plaintext).is_err());
        assert!(apply_key(&env, "plain", "a\nb", KeyMode::Encrypted).is_err());
        assert_eq!(block_of(&fx.text(), "plain"), block_of(BASE, "plain"));
    }

    #[test]
    fn upsert_insert_update_delete_keep_others_byte_identical() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        let mut input = ProviderUpsert {
            original_id: None,
            id: "brand new".into(),
            display_name: Some("Nice".into()),
            base_url: "https://n.example/v1".into(),
            api: "openai-completions".into(),
            models: vec![ModelEntry::Id("a".into())],
        };
        upsert(&env, &input, Some("sk-n"), KeyMode::Encrypted).unwrap();
        let t = fx.text();
        assert!(t.starts_with(BASE), "append-only for a new block");
        assert!(fx.store.has(&key_ref::vault_slug("brand new")));
        assert!(
            upsert(&env, &input, None, KeyMode::Plaintext).is_err(),
            "duplicate id"
        );

        // update: no key → key kept, other blocks identical
        input.original_id = Some("brand new".into());
        input.base_url = "https://n2.example/v1".into();
        upsert(&env, &input, None, KeyMode::Plaintext).unwrap();
        let t2 = fx.text();
        let p = env.provider("brand new").unwrap().unwrap();
        assert_eq!(p.base_url.as_deref(), Some("https://n2.example/v1"));
        assert!(key_ref::is_ref_for(
            p.api_key.as_deref().unwrap(),
            Path::new(SHIM),
            "brand new"
        ));
        for id in ["plain", "other", "聪明 it's"] {
            assert_eq!(block_of(&t2, id), block_of(BASE, id));
        }

        // rename carries the encrypted key
        input.id = "renamed".into();
        upsert(&env, &input, None, KeyMode::Plaintext).unwrap();
        assert!(env.provider("brand new").unwrap().is_none());
        let r = env.provider("renamed").unwrap().unwrap();
        assert!(key_ref::is_ref_for(
            r.api_key.as_deref().unwrap(),
            Path::new(SHIM),
            "renamed"
        ));
        assert_eq!(
            fx.store
                .get(&key_ref::vault_slug("renamed"))
                .unwrap()
                .as_deref(),
            Some("sk-n")
        );
        assert!(!fx.store.has(&key_ref::vault_slug("brand new")));

        delete(&env, "renamed").unwrap();
        assert_eq!(fx.text(), BASE);
        assert!(!fx.store.has(&key_ref::vault_slug("renamed")));
        assert!(delete(&env, "renamed").is_err());
    }

    #[test]
    fn upsert_local_without_key_sets_auth_none_and_validates() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        let input = ProviderUpsert {
            original_id: None,
            id: "ollama".into(),
            display_name: None,
            base_url: "http://localhost:11434/v1".into(),
            api: "openai-completions".into(),
            models: vec![],
        };
        upsert(&env, &input, None, KeyMode::Plaintext).unwrap();
        assert!(env.provider("ollama").unwrap().unwrap().auth_none);
        upsert(
            &env,
            &ProviderUpsert {
                original_id: Some("ollama".into()),
                ..input.clone()
            },
            Some("sk-x"),
            KeyMode::Plaintext,
        )
        .unwrap();
        let p = env.provider("ollama").unwrap().unwrap();
        assert!(!p.auth_none);
        assert_eq!(p.api_key.as_deref(), Some("sk-x"));
        for bad in ["", "  ", "a\u{7}b"] {
            let r = upsert(
                &env,
                &ProviderUpsert {
                    id: bad.into(),
                    ..input.clone()
                },
                None,
                KeyMode::Plaintext,
            );
            assert!(r.is_err(), "{bad:?}");
        }
        let hosted = ProviderUpsert {
            id: "hosted".into(),
            base_url: "https://h.example".into(),
            ..input
        };
        upsert(&env, &hosted, None, KeyMode::Plaintext).unwrap();
        assert!(!env.provider("hosted").unwrap().unwrap().auth_none);
    }

    #[test]
    fn resolve_and_export() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        encrypt(&env, "plain").unwrap();
        let envv = |n: &str| (n == "OTHER_ENV").then(|| "from-env".to_string());
        assert_eq!(
            resolve_key(&env, "plain", &envv).unwrap().as_deref(),
            Some("sk-plain-123")
        );
        assert_eq!(
            resolve_key(&env, "other", &envv).unwrap().as_deref(),
            Some("from-env")
        );
        assert_eq!(resolve_key(&env, "ghost", &envv).unwrap(), None);
        let text = export_env_text(&env, None, &envv).unwrap();
        assert_eq!(
            text,
            format!(
                "PLAIN_API_KEY=sk-plain-123\nOTHER_API_KEY=from-env\n{}=sk-cn-456\n",
                export_var_name("聪明 it's")
            )
        );
        let only = export_env_text(&env, Some(&["other".to_string()]), &envv).unwrap();
        assert_eq!(only, "OTHER_API_KEY=from-env\n");
        let n = export_var_name("a-b+c");
        assert!(
            n.starts_with("A_B_C_")
                && n.ends_with("_API_KEY")
                && n.chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_'),
            "{n}"
        );
        assert_eq!(export_var_name("my-gw"), "MY_GW_API_KEY");
    }

    #[test]
    fn local_url_detection() {
        for u in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234",
            "http://[::1]:80/x",
            "localhost",
        ] {
            assert!(is_local_url(u), "{u}");
        }
        for u in [
            "https://api.example.com",
            "http://localhost.evil.com",
            "https://x/localhost",
        ] {
            assert!(!is_local_url(u), "{u}");
        }
    }
}
