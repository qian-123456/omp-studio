//! Provider mutations over OMP's `models.yml`.
//!
//! Pure over explicit paths, so tests need no global state. Provider keys are
//! written as plaintext `apiKey` values (OMP's own format); every `models.yml`
//! write goes through `models_yml_providers::edit_file` (timestamped backup,
//! read-back verification, restore on failure). Callers hold
//! `providers::MUTATION_LOCK`. Errors are user-facing and never contain keys.

use std::path::Path;

use crate::contracts::{BuiltinOverride, ProviderKeyKind, ProviderUpsert};

use super::commands::sanitize_slug;
use super::models_yml_providers::{self as yml, edit_file, BlockSpec, YmlProvider};
use super::rows::{self, KeyEnv};

pub struct Env<'a> {
    pub models_yml: &'a Path,
}

impl Env<'_> {
    pub fn provider(&self, id: &str) -> Result<Option<YmlProvider>, String> {
        Ok(yml::read_providers(self.models_yml)?
            .into_iter()
            .find(|p| p.id == id))
    }

    fn kind_of(&self, p: &YmlProvider) -> ProviderKeyKind {
        let env_set = |_: &str| false;
        rows::detect_key(
            p.api_key.as_deref(),
            p.auth_none,
            &[],
            &KeyEnv { env_set: &env_set },
        )
        .kind
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

/// A key OMP will use verbatim: non-empty, single-line and not a `!command`
/// (OMP would execute such a value instead of sending it).
fn validate_plain_key(key: &str) -> Result<&str, String> {
    let key = validate_key(key)?;
    if key.starts_with('!') {
        return Err("密钥不能以 ! 开头（OMP 会把它当作命令执行）".to_string());
    }
    Ok(key)
}

/// Store `key` as plaintext `apiKey` for `id`; creates an override block for a built-in.
pub fn apply_key(env: &Env, id: &str, key: &str) -> Result<(), String> {
    let key = validate_plain_key(key)?;
    let rendered = yml::yaml_scalar(key);
    edit_file(
        env.models_yml,
        &|t| set_api_key_text(t, id, &rendered),
        &|w| check_api_key(w, id, key),
    )
}

/// Create or edit a custom provider block. Returns the (trimmed) provider id.
pub fn upsert(env: &Env, input: &ProviderUpsert, api_key: Option<&str>) -> Result<String, String> {
    let id = validate_id(&input.id)?;
    let base_url = input.base_url.trim();
    let api = input.api.trim();
    if base_url.is_empty() {
        return Err("Base URL 不能为空".to_string());
    }
    let every_model_has_api = !input.models.is_empty() && input.models.iter().all(|model| {
        matches!(model, crate::contracts::ModelEntry::Spec(spec) if spec.api.as_deref().is_some_and(|api| !api.trim().is_empty()))
    });
    if api.is_empty() && !every_model_has_api {
        return Err("API 协议不能为空，除非每个模型均明确设置协议".to_string());
    }
    // `auth: none` and a key contradict each other; "no key needed" wins.
    let new_key = api_key
        .map(str::trim)
        .filter(|k| !k.is_empty() && !input.auth_none)
        .map(validate_plain_key)
        .transpose()?;

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

    // No new key: the existing `apiKey` (literal, env var name, command) stays.
    let key_edit = new_key
        .filter(|_| !input.auth_none)
        .map(|k| (k, yml::yaml_scalar(k)));
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
    )?;
    Ok(id.to_string())
}

/// Create / update / drop the override block of a built-in provider. Keeps the
/// fields it does not manage (`modelOverrides`, `headers`, `name`, ...). `api_key`
/// `None` keeps the existing key; `auth_none` wins. An empty result
/// deletes the block. `default_base_url` is the built-in endpoint, used when
/// extra models need an address and none was typed.
pub fn save_builtin(
    env: &Env,
    input: &BuiltinOverride,
    default_base_url: Option<&str>,
    api_key: Option<&str>,
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
        .map(validate_plain_key)
        .transpose()?;
    let key_edit = new_key.map(|k| (k, yml::yaml_scalar(k)));
    let auth_none = input.auth_none;
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
}

/// Delete the `providers.<id>` block.
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
    })
}

/// The usable key of `id`: the literal (plaintext) or a set env var.
/// `Ok(None)` for command / OAuth / missing keys.
pub fn resolve_key(
    env: &Env,
    id: &str,
    env_var: &dyn Fn(&str) -> Option<String>,
) -> Result<Option<String>, String> {
    let Some(p) = env.provider(id)? else {
        return Ok(None);
    };
    match env.kind_of(&p) {
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
mod tests {
    use super::*;
    use crate::contracts::ModelEntry;
    use std::path::PathBuf;

    struct Fx {
        dir: PathBuf,
        path: PathBuf,
    }

    impl Fx {
        fn new(yaml: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("ompws-ops-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("models.yml");
            std::fs::write(&path, yaml).unwrap();
            Fx { dir, path }
        }
        fn env(&self) -> Env<'_> {
            Env {
                models_yml: &self.path,
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
    fn set_key_writes_plaintext_and_builtin_override_block() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        apply_key(&env, "opencode-zen", "sk-new").unwrap();
        let p = env.provider("opencode-zen").unwrap().unwrap();
        assert!(p.base_url.is_none());
        assert_eq!(p.api_key.as_deref(), Some("sk-new"));
        assert!(fx.text().contains("sk-new"));

        apply_key(&env, "opencode-zen", "  sk-plain  ").unwrap();
        assert_eq!(
            env.provider("opencode-zen")
                .unwrap()
                .unwrap()
                .api_key
                .as_deref(),
            Some("sk-plain")
        );

        // awkward but legal keys round-trip through YAML quoting
        for key in ["a b", "k\"q'x", "#hash", "key: v", "聪明-1", "123", "true"] {
            apply_key(&env, "plain", key).unwrap();
            assert_eq!(
                env.provider("plain").unwrap().unwrap().api_key.as_deref(),
                Some(key),
                "{key}"
            );
        }
    }

    #[test]
    fn invalid_keys_are_rejected_without_touching_the_file() {
        let fx = Fx::new(BASE);
        let env = fx.env();
        for bad in ["!rm -rf", "  ", "", "a\nb", "a\rb", "a\0b", "  !cmd"] {
            assert!(apply_key(&env, "plain", bad).is_err(), "{bad:?}");
        }
        assert_eq!(fx.text(), BASE);
        let input = edit_plain();
        assert!(upsert(&env, &input, Some("!cmd")).is_err());
        assert!(upsert(&env, &input, Some("a\nb")).is_err());
        assert!(save_builtin(&env, &ov("plain", None, false, &[]), None, Some("!cmd")).is_err());
        assert_eq!(fx.text(), BASE);
    }

    #[test]
    fn write_failure_keeps_file_and_reports_error() {
        let fx = Fx::new("providers: [invalid\n");
        assert!(apply_key(&fx.env(), "plain", "sk-new").is_err());
        assert_eq!(fx.text(), "providers: [invalid\n");
    }

    #[test]
    fn mixed_services_allow_no_provider_api_only_with_explicit_model_apis() {
        let fx = Fx::new("");
        let mut input = ProviderUpsert {
            original_id: None,
            id: "services".into(),
            display_name: None,
            base_url: "https://example.com/v1".into(),
            api: String::new(),
            models: [
                ("image", "openai-images"),
                ("stt", "openai-transcriptions"),
                ("tts", "openai-speech"),
                ("embedding", "openai-embeddings"),
                ("rerank", "openrouter-rerank"),
                ("video", "openrouter-video"),
            ]
            .into_iter()
            .map(|(kind, api)| {
                ModelEntry::Spec(crate::contracts::ModelSpec {
                    id: format!("{kind}-model"),
                    kind: Some(kind.into()),
                    api: Some(api.into()),
                    ..crate::contracts::ModelSpec::default()
                })
            })
            .collect(),
            auth_none: false,
        };
        upsert(&fx.env(), &input, None).unwrap();
        let provider = fx.env().provider("services").unwrap().unwrap();
        assert_eq!(provider.api, None);
        assert_eq!(provider.models, input.models);
        input.original_id = Some("services".into());
        input.api = "openai-completions".into();
        upsert(&fx.env(), &input, None).unwrap();
        assert_eq!(
            fx.env()
                .provider("services")
                .unwrap()
                .unwrap()
                .api
                .as_deref(),
            Some("openai-completions")
        );
        input.api.clear();
        upsert(&fx.env(), &input, None).unwrap();
        assert_eq!(fx.env().provider("services").unwrap().unwrap().api, None);
        input.models.push(ModelEntry::Id("missing-api".into()));
        let before = fx.text();
        assert!(upsert(&fx.env(), &input, None).is_err());
        assert_eq!(fx.text(), before);
        input.models.clear();
        assert!(upsert(&fx.env(), &input, None).is_err());
    }

    #[test]
    fn upsert_insert_update_rename_delete_keep_others_byte_identical() {
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
        upsert(&env, &input, Some("sk-n")).unwrap();
        let t = fx.text();
        assert!(t.starts_with(BASE), "append-only for a new block");
        assert_eq!(
            env.provider("brand new")
                .unwrap()
                .unwrap()
                .api_key
                .as_deref(),
            Some("sk-n")
        );
        assert!(upsert(&env, &input, None).is_err(), "duplicate id");

        // update: no key → key kept, other blocks identical
        input.original_id = Some("brand new".into());
        input.base_url = "https://n2.example/v1".into();
        upsert(&env, &input, None).unwrap();
        let t2 = fx.text();
        let p = env.provider("brand new").unwrap().unwrap();
        assert_eq!(p.base_url.as_deref(), Some("https://n2.example/v1"));
        assert_eq!(p.api_key.as_deref(), Some("sk-n"));
        for id in ["plain", "other", "聪明 it's"] {
            assert_eq!(block_of(&t2, id), block_of(BASE, id));
        }

        // new key replaces; rename carries the key
        upsert(&env, &input, Some("sk-n2")).unwrap();
        input.id = "renamed".into();
        upsert(&env, &input, None).unwrap();
        assert!(env.provider("brand new").unwrap().is_none());
        let r = env.provider("renamed").unwrap().unwrap();
        assert_eq!(r.api_key.as_deref(), Some("sk-n2"));

        delete(&env, "renamed").unwrap();
        assert_eq!(fx.text(), BASE);
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
        upsert(&env, &input, None).unwrap();
        assert!(env.provider("ollama").unwrap().unwrap().auth_none);
        upsert(
            &env,
            &ProviderUpsert {
                original_id: Some("ollama".into()),
                ..input.clone()
            },
            Some("sk-x"),
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
            );
            assert!(r.is_err(), "{bad:?}");
        }
        let hosted = ProviderUpsert {
            id: "hosted".into(),
            base_url: "https://h.example".into(),
            ..input
        };
        upsert(&env, &hosted, None).unwrap();
        assert!(!env.provider("hosted").unwrap().unwrap().auth_none);
    }

    #[test]
    fn resolve_and_export() {
        let fx = Fx::new(BASE);
        let env = fx.env();
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
        )
        .unwrap();
        let p = env.provider("openai").unwrap().unwrap();
        assert_eq!(p.base_url.as_deref(), Some("https://gw.example/v1"));
        assert_eq!(p.api_key.as_deref(), Some("sk-1"));
        assert_eq!(p.name.as_deref(), Some("Mine"));
        assert_eq!(p.models, vec![ModelEntry::Id("m1".into())]);
        assert!(fx.text().contains("modelOverrides:"));

        // no key → kept; drop baseUrl + models
        save_builtin(&env, &ov("openai", None, false, &[]), None, None).unwrap();
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
        let err = save_builtin(&env, &ov("openai", None, false, &["m"]), None, None).unwrap_err();
        assert_eq!(err, "添加模型需要先填写地址");
        assert_eq!(fx.text(), BASE);
        save_builtin(
            &env,
            &ov("openai", None, false, &["m"]),
            Some("https://api.openai.com/v1"),
            None,
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
        save_builtin(&env, &ov("groq", None, true, &[]), None, Some("ignored")).unwrap();
        let p = env.provider("groq").unwrap().unwrap();
        assert!(p.auth_none && p.api_key.is_none(), "key ignored");

        save_builtin(&env, &ov("groq", None, false, &[]), None, Some("sk-g")).unwrap();
        let p = env.provider("groq").unwrap().unwrap();
        assert!(!p.auth_none);
        assert_eq!(p.api_key.as_deref(), Some("sk-g"));

        // unchecked, no key: still has the apiKey → block stays; removing it empties it
        delete(&env, "groq").unwrap();
        save_builtin(&env, &ov("groq", None, true, &[]), None, None).unwrap();
        save_builtin(&env, &ov("groq", None, false, &[]), None, None).unwrap();
        assert_eq!(fx.text(), BASE);
        assert!(env.provider("groq").unwrap().is_none());
    }

    #[test]
    fn discovery_only_blocks_always_get_discovery_and_api() {
        let fx = Fx::new("");
        let env = fx.env();
        save_builtin(&env, &ov("ollama", None, true, &[]), None, None).unwrap();
        let t = fx.text();
        assert!(
            t.contains("discovery: { type: ollama }") && t.contains("api: ollama"),
            "{t}"
        );
        assert!(env.provider("ollama").unwrap().unwrap().auth_none);

        // set_key path
        let fx = Fx::new("");
        apply_key(&fx.env(), "lm-studio", "sk-x").unwrap();
        let t = fx.text();
        assert!(t.contains("discovery: { type: lm-studio }"), "{t}");
        assert!(
            t.contains("api: openai-completions") && t.contains("apiKey: sk-x"),
            "{t}"
        );

        // a non-discovery built-in is left alone
        let fx = Fx::new("");
        apply_key(&fx.env(), "openai", "sk-x").unwrap();
        assert!(!fx.text().contains("discovery"));
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
    fn blank_key_keeps_existing_literal_env_var_and_command_keys() {
        for key in ["sk-plain-123", "MY_API_KEY", "!external-key-command"] {
            let fx = Fx::new(&BASE.replace("sk-plain-123", &yml::yaml_scalar(key)));
            let env = fx.env();
            upsert(&env, &edit_plain(), None).unwrap();
            upsert(&env, &edit_plain(), Some("  ")).unwrap();
            assert_eq!(
                env.provider("plain").unwrap().unwrap().api_key.as_deref(),
                Some(key)
            );
            save_builtin(
                &env,
                &ov("plain", Some("https://p.example/v1"), false, &["m1"]),
                None,
                None,
            )
            .unwrap();
            assert_eq!(
                env.provider("plain").unwrap().unwrap().api_key.as_deref(),
                Some(key)
            );
            assert_eq!(block_of(&fx.text(), "other"), block_of(BASE, "other"));
        }
    }

    #[test]
    fn leftover_legacy_reference_is_a_command_and_new_key_replaces_it() {
        let legacy = crate::providers::key_ref::command_ref(Path::new("/d/bin/ompws-key"), "plain");
        let fx = Fx::new(&BASE.replace("sk-plain-123", &yml::yaml_double_quoted(&legacy)));
        let env = fx.env();
        let p = env.provider("plain").unwrap().unwrap();
        assert_eq!(env.kind_of(&p), ProviderKeyKind::Command);
        assert_eq!(resolve_key(&env, "plain", &|_| None).unwrap(), None);
        apply_key(&env, "plain", "sk-fresh").unwrap();
        assert_eq!(fx.text().replace("sk-fresh", "sk-plain-123"), BASE);
    }
}
