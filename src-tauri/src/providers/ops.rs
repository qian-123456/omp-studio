//! Provider mutations over OMP's `models.yml` and the key vault.
//!
//! Pure over explicit paths and a [`KeyStore`], so tests need no global state.
//! Every `models.yml` write goes through `models_yml_providers::edit_file`
//! (timestamped backup, read-back verification, restore on failure); vault
//! changes are rolled back when that write fails. Callers hold
//! `providers::MUTATION_LOCK`. Errors are user-facing and never contain keys.

use std::path::Path;

use crate::contracts::{BuiltinOverride, KeyMode, ProviderKeyKind, ProviderUpsert};

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
/// contradictory `auth: none`. A block created here for a discovery-only local
/// engine also gets `discovery` + `api`, so OMP keeps discovering its models.
fn set_api_key_text(text: &str, id: &str, rendered: &str) -> Result<String, String> {
    let created = yml::block_is_empty(text, id)?.is_none();
    let mut t = yml::ensure_provider(text, id)?;
    t = yml::set_field(&t, id, "apiKey", Some(rendered))?;
    if yml::parse_providers(&t)?
        .iter()
        .any(|p| p.id == id && p.auth_none)
    {
        t = yml::set_field(&t, id, "auth", None)?;
    }
    if created {
        t = yml::ensure_discovery_text(&t, id)?;
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

/// Apply all vault changes before committing YAML, restoring prior entries on
/// failure. In particular, failed cleanup must never commit a plaintext,
/// deleted or renamed block while its old vault entry remains behind.
fn with_vault_changes<T>(
    env: &Env,
    changes: &[(String, Option<String>)],
    commit: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let previous = changes
        .iter()
        .map(|(slug, _)| env.store.get(slug))
        .collect::<Result<Vec<_>, _>>()?;
    let mut attempted = Vec::new();
    let result = (|| {
        for (index, (slug, next)) in changes.iter().enumerate() {
            if *next == previous[index] {
                continue;
            }
            attempted.push(index);
            match next {
                Some(key) => env.store.put(slug, key)?,
                None => env.store.remove(slug)?,
            }
        }
        commit()
    })();
    if let Err(error) = result {
        let mut rollback_failed = false;
        for index in attempted.into_iter().rev() {
            let slug = &changes[index].0;
            // A failed atomic vault operation usually left the entry intact.
            if env.store.get(slug).ok().as_ref() == Some(&previous[index]) {
                continue;
            }
            let restored = match &previous[index] {
                Some(key) => env.store.put(slug, key),
                None => env.store.remove(slug),
            };
            rollback_failed |= restored.is_err();
        }
        return Err(if rollback_failed {
            format!("{error}；密钥库回滚失败，请检查供应商密钥状态")
        } else {
            error
        });
    }
    result
}

/// An empty key retains its material, not an explicitly changed storage mode.
/// External commands and environment-variable references are not materialized.
fn key_for_save(
    env: &Env,
    old: Option<&YmlProvider>,
    new_key: Option<&str>,
    mode: KeyMode,
    renaming: bool,
) -> Result<Option<String>, String> {
    if let Some(key) = new_key {
        return Ok(Some(key.to_string()));
    }
    let Some(old) = old else {
        return Ok(None);
    };
    if env.is_own_ref(old) && (mode == KeyMode::Plaintext || renaming) {
        let key = env
            .store
            .get(&key_ref::vault_slug(&old.id))?
            .ok_or_else(|| "密钥库中找不到原供应商的密钥，请先重新设置密钥".to_string())?;
        let key = validate_key(&key)?;
        if mode == KeyMode::Plaintext && key.starts_with('!') {
            return Err(
                "明文密钥不能以 ! 开头（OMP 会把它当作命令执行），请改用加密保存".to_string(),
            );
        }
        return Ok(Some(key.to_string()));
    }
    if mode == KeyMode::Encrypted && env.kind_of(old) == ProviderKeyKind::Plaintext {
        return old
            .api_key
            .as_deref()
            .map(validate_key)
            .transpose()
            .map(|key| key.map(str::to_string));
    }
    Ok(None)
}

/// Store `key` for `id` in `mode`; creates an override block for a built-in.
pub fn apply_key(env: &Env, id: &str, key: &str, mode: KeyMode) -> Result<(), String> {
    let key = validate_key(key)?;
    if mode == KeyMode::Plaintext && key.starts_with('!') {
        return Err("明文密钥不能以 ! 开头（OMP 会把它当作命令执行），请改用加密保存".to_string());
    }
    let slug = key_ref::vault_slug(id);
    let changes = [(slug, (mode == KeyMode::Encrypted).then(|| key.to_string()))];
    let (raw, rendered) = key_value(env, id, key, mode);
    with_vault_changes(env, &changes, || {
        edit_file(
            env.models_yml,
            &|t| set_api_key_text(t, id, &rendered),
            &|w| check_api_key(w, id, &raw),
        )
    })
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
    // `auth: none` and a key contradict each other; "no key needed" wins.
    let new_key = api_key
        .map(str::trim)
        .filter(|k| !k.is_empty() && !input.auth_none)
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
    let old_slug = old.map(|p| key_ref::vault_slug(&p.id));
    let slug = key_ref::vault_slug(id);
    let creating = orig.is_none();
    let auth_none = input.auth_none || (creating && new_key.is_none() && is_local_url(base_url));

    let spec = BlockSpec {
        id: id.to_string(),
        name: input.display_name.clone(),
        base_url: base_url.to_string(),
        api: api.to_string(),
        models: input.models.clone(),
        auth_none,
    };

    let saved_key = if input.auth_none {
        None
    } else {
        key_for_save(env, old, new_key, mode, renaming)?
    };
    let key_edit = saved_key.as_deref().map(|k| key_value(env, id, k, mode));
    let mut changes = Vec::new();
    if renaming {
        if let Some(old_slug) = &old_slug {
            if *old_slug != slug {
                changes.push((old_slug.clone(), None));
            }
        }
    }
    if saved_key.is_some() || input.auth_none {
        changes.push((slug, saved_key.filter(|_| mode == KeyMode::Encrypted)));
    }
    with_vault_changes(env, &changes, || {
        edit_file(
            env.models_yml,
            &|t| {
                let mut t = t.to_string();
                if let (true, Some(o)) = (renaming, orig) {
                    t = yml::rename_provider(&t, o, id)?;
                }
                t = yml::upsert_block_text(&t, &spec)?;
                if input.auth_none {
                    t = yml::set_field(&t, id, "apiKey", None)?;
                } else if !auth_none {
                    t = yml::set_field(&t, id, "auth", None)?;
                }
                if let Some((_, rendered)) = &key_edit {
                    t = set_api_key_text(&t, id, rendered)?;
                }
                Ok(t)
            },
            &|w| {
                yml::verify_block(w, &spec)?;
                let got = yml::parse_providers(w)?;
                if got.iter().any(|p| p.id == id && p.auth_none != auth_none) {
                    return Err(format!("写入后校验失败: {id}"));
                }
                if let Some((raw, _)) = &key_edit {
                    check_api_key(w, id, raw)?;
                }
                Ok(())
            },
        )
    })?;
    Ok(id.to_string())
}

/// Create / update / drop the override block of a built-in provider. Keeps the
/// fields it does not manage (`modelOverrides`, `headers`, `name`, ...). `api_key`
/// `None` keeps the key material while honoring `mode`; `auth_none` wins. An empty result
/// deletes the block. `default_base_url` is the built-in endpoint, used when
/// extra models need an address and none was typed.
pub fn save_builtin(
    env: &Env,
    input: &BuiltinOverride,
    default_base_url: Option<&str>,
    api_key: Option<&str>,
    mode: KeyMode,
) -> Result<(), String> {
    let id = validate_id(&input.id)?;
    let typed = input
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|u| !u.is_empty());
    let base_url = if input.extra_models.is_empty() {
        typed
    } else {
        Some(
            typed
                .or_else(|| default_base_url.map(str::trim).filter(|u| !u.is_empty()))
                .ok_or_else(|| "添加模型需要先填写地址".to_string())?,
        )
    };
    let new_key = api_key
        .map(str::trim)
        .filter(|k| !k.is_empty() && !input.auth_none)
        .map(validate_key)
        .transpose()?;
    if mode == KeyMode::Plaintext && new_key.is_some_and(|k| k.starts_with('!')) {
        return Err("明文密钥不能以 ! 开头（OMP 会把它当作命令执行），请改用加密保存".to_string());
    }
    let slug = key_ref::vault_slug(id);
    let old = env.provider(id)?;
    let saved_key = if input.auth_none {
        None
    } else {
        key_for_save(env, old.as_ref(), new_key, mode, false)?
    };
    let key_edit = saved_key.as_deref().map(|k| key_value(env, id, k, mode));
    let changes = if saved_key.is_some() || input.auth_none {
        vec![(slug, saved_key.filter(|_| mode == KeyMode::Encrypted))]
    } else {
        Vec::new()
    };
    let auth_none = input.auth_none;
    with_vault_changes(env, &changes, || {
        edit_file(
            env.models_yml,
            &|t| {
                let mut t = yml::ensure_provider(t, id)?;
                if let Some((_, rendered)) = &key_edit {
                    t = set_api_key_text(&t, id, rendered)?;
                }
                let url = base_url.map(yml::yaml_scalar);
                t = yml::set_field(&t, id, "baseUrl", url.as_deref())?;
                t = yml::set_models_text(&t, id, &input.extra_models)?;
                if auth_none {
                    t = yml::set_field(&t, id, "apiKey", None)?;
                    t = yml::set_field(&t, id, "auth", Some("none"))?;
                } else {
                    t = yml::set_field(&t, id, "auth", None)?;
                }
                if yml::block_is_empty(&t, id)? == Some(true) {
                    return yml::remove_provider(&t, id);
                }
                yml::ensure_discovery_text(&t, id)
            },
            &|w| {
                if yml::block_is_empty(w, id)?.is_none() {
                    return Ok(());
                }
                yml::verify_override(w, id, base_url, auth_none, &input.extra_models)?;
                if let Some((raw, _)) = &key_edit {
                    check_api_key(w, id, raw)?;
                }
                Ok(())
            },
        )
    })
}

/// Delete the `providers.<id>` block and its vault entry.
pub fn delete(env: &Env, id: &str) -> Result<(), String> {
    if env.provider(id)?.is_none() {
        return Err("该供应商是 OMP 内置供应商，没有可删除的配置".to_string());
    }
    with_vault_changes(env, &[(key_ref::vault_slug(id), None)], || {
        edit_file(env.models_yml, &|t| yml::remove_provider(t, id), &|w| {
            if yml::ids_in(w).contains(id) {
                Err(format!("写入后校验失败: {id}"))
            } else {
                Ok(())
            }
        })
    })
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
            auth_none: false,
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
        upsert(&env, &input, None, KeyMode::Encrypted).unwrap();
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
        upsert(&env, &input, None, KeyMode::Encrypted).unwrap();
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
            auth_none: false,
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

    fn ov(id: &str, base: Option<&str>, auth_none: bool, models: &[&str]) -> BuiltinOverride {
        BuiltinOverride {
            id: id.into(),
            base_url: base.map(String::from),
            auth_none,
            extra_models: models.iter().map(|m| ModelEntry::Id((*m).into())).collect(),
        }
    }

    #[test]
    fn save_builtin_builds_updates_and_keeps_unmanaged_fields() {
        let fx = Fx::new("providers:\n  openai:\n    name: Mine\n    modelOverrides:\n      gpt-4o:\n        name: X\n");
        let env = fx.env();
        save_builtin(
            &env,
            &ov("openai", Some("https://gw.example/v1"), false, &["m1"]),
            None,
            Some("sk-1"),
            KeyMode::Plaintext,
        )
        .unwrap();
        let p = env.provider("openai").unwrap().unwrap();
        assert_eq!(p.base_url.as_deref(), Some("https://gw.example/v1"));
        assert_eq!(p.api_key.as_deref(), Some("sk-1"));
        assert_eq!(p.name.as_deref(), Some("Mine"));
        assert_eq!(p.models, vec![ModelEntry::Id("m1".into())]);
        assert!(fx.text().contains("modelOverrides:"));

        // no key → kept; drop baseUrl + models
        save_builtin(
            &env,
            &ov("openai", None, false, &[]),
            None,
            None,
            KeyMode::Plaintext,
        )
        .unwrap();
        let p = env.provider("openai").unwrap().unwrap();
        assert_eq!(p.base_url, None);
        assert!(p.models.is_empty());
        assert_eq!(p.api_key.as_deref(), Some("sk-1"));
        let t = fx.text();
        assert!(t.contains("modelOverrides:") && t.contains("name: Mine"));
        assert!(!t.contains("models:") && !t.contains("baseUrl"));
    }

    #[test]
    fn save_builtin_extra_models_need_an_address() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        let err = save_builtin(
            &env,
            &ov("openai", None, false, &["m"]),
            None,
            None,
            KeyMode::Plaintext,
        )
        .unwrap_err();
        assert_eq!(err, "添加模型需要先填写地址");
        assert_eq!(fx.text(), BASE);
        save_builtin(
            &env,
            &ov("openai", None, false, &["m"]),
            Some("https://api.openai.com/v1"),
            None,
            KeyMode::Plaintext,
        )
        .unwrap();
        let p = env.provider("openai").unwrap().unwrap();
        assert_eq!(p.base_url.as_deref(), Some("https://api.openai.com/v1"));
        assert_eq!(p.models.len(), 1);
    }

    #[test]
    fn save_builtin_auth_none_toggles_and_empty_block_is_deleted() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        save_builtin(
            &env,
            &ov("groq", None, true, &[]),
            None,
            Some("ignored"),
            KeyMode::Encrypted,
        )
        .unwrap();
        let p = env.provider("groq").unwrap().unwrap();
        assert!(p.auth_none && p.api_key.is_none());
        assert!(!fx.store.has(&key_ref::vault_slug("groq")), "key ignored");

        save_builtin(
            &env,
            &ov("groq", None, false, &[]),
            None,
            Some("sk-g"),
            KeyMode::Encrypted,
        )
        .unwrap();
        let p = env.provider("groq").unwrap().unwrap();
        assert!(!p.auth_none);
        assert!(key_ref::is_ref_for(
            p.api_key.as_deref().unwrap(),
            Path::new(SHIM),
            "groq"
        ));

        // unchecked, no key: still has the apiKey → block stays; removing it empties it
        delete(&env, "groq").unwrap();
        save_builtin(
            &env,
            &ov("groq", None, true, &[]),
            None,
            None,
            KeyMode::Plaintext,
        )
        .unwrap();
        save_builtin(
            &env,
            &ov("groq", None, false, &[]),
            None,
            None,
            KeyMode::Plaintext,
        )
        .unwrap();
        assert_eq!(fx.text(), BASE);
        assert!(env.provider("groq").unwrap().is_none());
    }

    #[test]
    fn discovery_only_blocks_always_get_discovery_and_api() {
        let fx = Fx::new("");
        let env = fx.env();
        save_builtin(
            &env,
            &ov("ollama", None, true, &[]),
            None,
            None,
            KeyMode::Plaintext,
        )
        .unwrap();
        let t = fx.text();
        assert!(
            t.contains("discovery: { type: ollama }") && t.contains("api: ollama"),
            "{t}"
        );
        assert!(env.provider("ollama").unwrap().unwrap().auth_none);

        // set_key path
        let fx = Fx::new("");
        apply_key(&fx.env(), "lm-studio", "sk-x", KeyMode::Plaintext).unwrap();
        let t = fx.text();
        assert!(t.contains("discovery: { type: lm-studio }"), "{t}");
        assert!(
            t.contains("api: openai-completions") && t.contains("apiKey: sk-x"),
            "{t}"
        );

        // a non-discovery built-in is left alone
        let fx = Fx::new("");
        apply_key(&fx.env(), "openai", "sk-x", KeyMode::Plaintext).unwrap();
        assert!(!fx.text().contains("discovery"));
    }
    /// Synthetic, atomic failures: never reads the real vault or credentials.
    struct FaultStore<'a> {
        inner: &'a MemStore,
        failures: RefCell<Vec<(&'static str, String)>>,
    }

    impl FaultStore<'_> {
        fn check(&self, operation: &str, slug: &str) -> Result<(), String> {
            let mut failures = self.failures.borrow_mut();
            if failures
                .first()
                .is_some_and(|(op, id)| *op == operation && id == slug)
            {
                failures.remove(0);
                return Err(format!("injected {operation} failure"));
            }
            Ok(())
        }
    }

    impl KeyStore for FaultStore<'_> {
        fn has(&self, slug: &str) -> bool {
            self.inner.has(slug)
        }
        fn get(&self, slug: &str) -> Result<Option<String>, String> {
            self.check("get", slug)?;
            self.inner.get(slug)
        }
        fn put(&self, slug: &str, key: &str) -> Result<(), String> {
            self.check("put", slug)?;
            self.inner.put(slug, key)
        }
        fn remove(&self, slug: &str) -> Result<(), String> {
            self.check("remove", slug)?;
            self.inner.remove(slug)
        }
    }

    fn edit_plain() -> ProviderUpsert {
        ProviderUpsert {
            original_id: Some("plain".into()),
            id: "plain".into(),
            display_name: None,
            base_url: "https://p.example/v1".into(),
            api: "openai-completions".into(),
            models: vec![ModelEntry::Id("m1".into())],
            auth_none: false,
        }
    }

    #[test]
    fn blank_key_upsert_honors_storage_mode_in_both_directions() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        upsert(&env, &edit_plain(), None, KeyMode::Encrypted).unwrap();
        assert_eq!(
            env.kind_of(&env.provider("plain").unwrap().unwrap()),
            ProviderKeyKind::Encrypted
        );
        assert_eq!(
            fx.store.get("plain").unwrap().as_deref(),
            Some("sk-plain-123")
        );
        upsert(&env, &edit_plain(), Some("  "), KeyMode::Plaintext).unwrap();
        assert_eq!(
            env.provider("plain").unwrap().unwrap().api_key.as_deref(),
            Some("sk-plain-123")
        );
        assert!(!fx.store.has("plain"));
        assert_eq!(block_of(&fx.text(), "other"), block_of(BASE, "other"));
    }

    #[test]
    fn blank_key_builtin_honors_storage_mode_in_both_directions() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        let input = ov("plain", Some("https://p.example/v1"), false, &["m1"]);
        save_builtin(&env, &input, None, None, KeyMode::Encrypted).unwrap();
        assert_eq!(
            env.kind_of(&env.provider("plain").unwrap().unwrap()),
            ProviderKeyKind::Encrypted
        );
        save_builtin(&env, &input, None, Some("  "), KeyMode::Plaintext).unwrap();
        assert_eq!(
            env.provider("plain").unwrap().unwrap().api_key.as_deref(),
            Some("sk-plain-123")
        );
        assert!(!fx.store.has("plain"));
    }

    #[test]
    fn blank_key_mode_preserves_external_references() {
        for key in ["MY_API_KEY", "!external-key-command"] {
            for mode in [KeyMode::Encrypted, KeyMode::Plaintext] {
                let fx = Fx::new(&BASE.replace("sk-plain-123", &yml::yaml_scalar(key)));
                let env = fx.env();
                upsert(&env, &edit_plain(), None, mode).unwrap();
                assert_eq!(
                    env.provider("plain").unwrap().unwrap().api_key.as_deref(),
                    Some(key)
                );
                save_builtin(
                    &env,
                    &ov("plain", Some("https://p.example/v1"), false, &["m1"]),
                    None,
                    None,
                    mode,
                )
                .unwrap();
                assert_eq!(
                    env.provider("plain").unwrap().unwrap().api_key.as_deref(),
                    Some(key)
                );
                assert!(fx.store.0.borrow().is_empty());
            }
        }
    }

    #[test]
    fn rename_and_blank_key_can_convert_encrypted_key_to_plaintext() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        encrypt(&env, "plain").unwrap();
        let mut input = edit_plain();
        input.id = "renamed".into();
        upsert(&env, &input, None, KeyMode::Plaintext).unwrap();
        assert!(env.provider("plain").unwrap().is_none());
        assert_eq!(
            env.provider("renamed").unwrap().unwrap().api_key.as_deref(),
            Some("sk-plain-123")
        );
        assert!(fx.store.0.borrow().is_empty());
    }

    #[test]
    fn missing_vault_or_command_like_secret_cannot_be_saved_as_plaintext() {
        for key in [None, Some("!synthetic-command-like-secret")] {
            let fx = Fx::new(BASE);
            let env = fx.env();
            encrypt(&env, "plain").unwrap();
            match key {
                Some(key) => fx.store.put("plain", key).unwrap(),
                None => fx.store.remove("plain").unwrap(),
            }
            let before = fx.text();
            assert!(upsert(&env, &edit_plain(), None, KeyMode::Plaintext).is_err());
            assert!(save_builtin(
                &env,
                &ov("plain", None, false, &[]),
                None,
                None,
                KeyMode::Plaintext
            )
            .is_err());
            assert_eq!(fx.text(), before);
            assert_eq!(fx.store.get("plain").unwrap().as_deref(), key);
        }
    }

    #[test]
    fn cleanup_failure_keeps_config_and_original_encrypted_key() {
        for operation in [
            "decrypt",
            "set-key",
            "upsert",
            "upsert-auth-none",
            "builtin",
            "builtin-auth-none",
            "delete",
            "rename",
        ] {
            let fx = Fx::new(BASE);
            encrypt(&fx.env(), "plain").unwrap();
            let before = fx.text();
            let store = FaultStore {
                inner: &fx.store,
                failures: RefCell::new(vec![("remove", "plain".into())]),
            };
            let env = Env {
                store: &store,
                ..fx.env()
            };
            let mut input = edit_plain();
            let result = match operation {
                "decrypt" => decrypt(&env, "plain"),
                "set-key" => apply_key(&env, "plain", "sk-replacement", KeyMode::Plaintext),
                "upsert" => upsert(&env, &input, None, KeyMode::Plaintext).map(|_| ()),
                "upsert-auth-none" => {
                    input.auth_none = true;
                    upsert(&env, &input, None, KeyMode::Encrypted).map(|_| ())
                }
                "builtin" => save_builtin(
                    &env,
                    &ov("plain", None, false, &[]),
                    None,
                    None,
                    KeyMode::Plaintext,
                ),
                "builtin-auth-none" => save_builtin(
                    &env,
                    &ov("plain", None, true, &[]),
                    None,
                    None,
                    KeyMode::Encrypted,
                ),
                "delete" => delete(&env, "plain"),
                "rename" => {
                    input.id = "renamed".into();
                    upsert(&env, &input, None, KeyMode::Encrypted).map(|_| ())
                }
                _ => unreachable!(),
            };
            assert!(
                result.unwrap_err().contains("injected remove failure"),
                "{operation}"
            );
            assert_eq!(fx.text(), before, "{operation}");
            assert_eq!(
                fx.store.get("plain").unwrap().as_deref(),
                Some("sk-plain-123")
            );
            assert!(!fx.store.has("renamed"));
        }
    }

    #[test]
    fn rename_destination_write_failure_restores_original_vault_entry() {
        let fx = Fx::new(BASE);
        encrypt(&fx.env(), "plain").unwrap();
        let before = fx.text();
        let store = FaultStore {
            inner: &fx.store,
            failures: RefCell::new(vec![("put", "renamed".into())]),
        };
        let env = Env {
            store: &store,
            ..fx.env()
        };
        let mut input = edit_plain();
        input.id = "renamed".into();
        assert!(upsert(&env, &input, None, KeyMode::Encrypted)
            .unwrap_err()
            .contains("injected put failure"));
        assert_eq!(fx.text(), before);
        assert_eq!(
            fx.store.get("plain").unwrap().as_deref(),
            Some("sk-plain-123")
        );
        assert!(!fx.store.has("renamed"));
    }

    #[test]
    fn vault_snapshot_read_failure_does_not_modify_config_or_key() {
        let fx = Fx::new(BASE);
        encrypt(&fx.env(), "plain").unwrap();
        let before = fx.text();
        let store = FaultStore {
            inner: &fx.store,
            failures: RefCell::new(vec![("get", "plain".into())]),
        };
        let env = Env {
            store: &store,
            ..fx.env()
        };
        assert!(apply_key(&env, "plain", "sk-new", KeyMode::Plaintext)
            .unwrap_err()
            .contains("injected get failure"));
        assert_eq!(fx.text(), before);
        assert_eq!(
            fx.store.get("plain").unwrap().as_deref(),
            Some("sk-plain-123")
        );
    }

    #[test]
    fn yaml_failure_restores_vault_changes() {
        for previous in [None, Some("sk-previous")] {
            let fx = Fx::new("providers: [invalid\n");
            if let Some(key) = previous {
                fx.store.put("plain", key).unwrap();
            }
            for mode in [KeyMode::Encrypted, KeyMode::Plaintext] {
                assert!(apply_key(&fx.env(), "plain", "sk-new", mode).is_err());
                assert_eq!(fx.text(), "providers: [invalid\n");
                assert_eq!(fx.store.get("plain").unwrap().as_deref(), previous);
            }
        }
    }

    #[test]
    fn rollback_failure_is_reported_instead_of_hidden() {
        let fx = Fx::new(BASE);
        let store = FaultStore {
            inner: &fx.store,
            failures: RefCell::new(vec![("remove", "plain".into())]),
        };
        let env = Env {
            store: &store,
            ..fx.env()
        };
        let result: Result<(), String> = with_vault_changes(
            &env,
            &[("plain".into(), Some("sk-synthetic".into()))],
            || Err("injected YAML failure".into()),
        );
        let error = result.unwrap_err();
        assert!(error.contains("injected YAML failure"));
        assert!(error.contains("密钥库回滚失败"));
        assert!(!error.contains("sk-synthetic"));
        assert_eq!(fx.text(), BASE);
    }
}
