//! Narrow, redacted global runner settings. No secrets enter subprocess arguments.
use super::models_yml_write::{block_end, opens_block, parse_line};
use serde::Serialize;
use serde_json::Value;
use std::{collections::BTreeMap, io::Write, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceConfigSnapshot {
    target: String,
    stamp: String,
    values: BTreeMap<String, Value>,
    secrets: BTreeMap<String, bool>,
}
fn fields(target: &str) -> Result<&'static [(&'static str, bool)], String> {
    match target {
        "searxng" => Ok(&[
            ("endpoint", false),
            ("token", true),
            ("basicUsername", true),
            ("basicPassword", true),
            ("categories", false),
            ("engines", false),
            ("language", false),
            ("safesearch", false),
        ]),
        "tts" => Ok(&[("localVoice", false), ("localSpeed", false)]),
        "stt" => Ok(&[("language", false)]),
        _ => Err("Unsupported service settings target".into()),
    }
}
fn stamp(text: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
fn read_text(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(_) => Err("Cannot read service settings".into()),
    }
}
fn snapshot(target: &str, text: &str) -> Result<ServiceConfigSnapshot, String> {
    let allowed = fields(target)?;
    let root: serde_yaml_ng::Value =
        serde_yaml_ng::from_str(text).map_err(|_| "Invalid config.yml")?;
    if !root.is_null() && !root.is_mapping() {
        return Err("config.yml must be a mapping".into());
    }
    if root
        .get(target)
        .is_some_and(|v| !v.is_null() && !v.is_mapping())
    {
        return Err("Service settings must be a mapping".into());
    }
    let mut values = BTreeMap::new();
    let mut secrets = BTreeMap::new();
    for &(key, secret) in allowed {
        let value = root.get(target).and_then(|v| v.get(key));
        if secret {
            secrets.insert(
                key.into(),
                value.is_some_and(|v| !v.is_null() && v.as_str() != Some("")),
            );
        } else if let Some(value) = value.filter(|v| !v.is_null()) {
            if !value.is_string() && !value.is_number() && !value.is_bool() {
                return Err("Complex service parameter requires advanced editor".into());
            }
            if key == "endpoint"
                && value
                    .as_str()
                    .and_then(|s| reqwest::Url::parse(s).ok())
                    .is_some_and(|u| {
                        !u.username().is_empty() || u.password().is_some() || u.query().is_some()
                    })
            {
                return Err("Move embedded endpoint credentials to dedicated authentication fields using the advanced editor".into());
            }
            values.insert(
                key.into(),
                serde_json::to_value(value).map_err(|_| "Invalid service value")?,
            );
        }
    }
    Ok(ServiceConfigSnapshot {
        target: target.into(),
        stamp: stamp(text),
        values,
        secrets,
    })
}
fn scalar_comment(rest: &str) -> &str {
    let mut single = false;
    let mut double = false;
    let mut escaped = false;
    for (i, c) in rest.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if double && c == '\\' {
            escaped = true;
            continue;
        }
        if !double && c == '\'' {
            single = !single;
        } else if !single && c == '"' {
            double = !double;
        } else if !single
            && !double
            && c == '#'
            && (i == 0 || rest.as_bytes()[i - 1].is_ascii_whitespace())
        {
            return rest[i.saturating_sub(1)..].trim_end();
        }
    }
    ""
}
fn validate(target: &str, changes: &BTreeMap<String, Value>) -> Result<(), String> {
    let allowed = fields(target)?;
    for (key, value) in changes {
        if !allowed.iter().any(|(k, _)| *k == key) {
            return Err("Unsupported service parameter".into());
        }
        if value.is_null() {
            continue;
        }
        if target == "searxng" && key == "safesearch" {
            if !value.as_u64().is_some_and(|v| v <= 2) {
                return Err("Safe search must be 0, 1 or 2".into());
            }
            continue;
        }
        if target == "tts" && key == "localSpeed" {
            if !value.as_f64().is_some_and(|v| v.is_finite() && v > 0.0) {
                return Err("Speed must be greater than zero".into());
            }
            continue;
        }
        let value = value
            .as_str()
            .ok_or("Service parameter must be a string or null")?;
        if value.is_empty() || value.len() > 16384 || value.chars().any(|c| c.is_control()) {
            return Err("Invalid service parameter".into());
        }
        if key == "endpoint" {
            let url = reqwest::Url::parse(value).map_err(|_| "Invalid endpoint URL")?;
            if !matches!(url.scheme(), "http" | "https")
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(
                    "Endpoint requires HTTP(S), without embedded credentials, query or fragment"
                        .into(),
                );
            }
        }
    }
    Ok(())
}
fn edit(text: &str, target: &str, changes: &BTreeMap<String, Value>) -> Result<String, String> {
    validate(target, changes)?;
    snapshot(target, text)?;
    let mut out: Vec<String> = text.split_inclusive('\n').map(str::to_string).collect();
    for (key, value) in changes {
        let lines: Vec<&str> = out.iter().map(String::as_str).collect();
        let at = lines.iter().position(|line| {
            let l = parse_line(line);
            l.indent == 0 && l.entry.as_ref().is_some_and(|(k, _)| k == target)
        });
        let Some(at) = at else {
            if value.is_null() {
                continue;
            }
            if out.last().is_some_and(|s| !s.ends_with('\n')) {
                out.last_mut().unwrap().push('\n');
            }
            // Keep one physical line per entry: subsequent fields use parse_line.
            out.push(format!("{target}:\n"));
            out.push(format!(
                "  {key}: {}\n",
                serde_json::to_string(value).map_err(|_| "Invalid parameter")?
            ));
            continue;
        };
        if !opens_block(parse_line(lines[at]).entry.unwrap().1) {
            return Err("Service settings must use a block mapping; use advanced editor".into());
        }
        let end = block_end(&lines, at, 0);
        let child_indent = lines[at + 1..end]
            .iter()
            .map(|s| parse_line(s))
            .find(|l| !l.trivia)
            .map_or(2, |l| l.indent);
        let hit = (at + 1..end).find(|&i| {
            let l = parse_line(lines[i]);
            l.indent == child_indent && l.entry.as_ref().is_some_and(|(k, _)| k == key)
        });
        if let Some(i) = hit {
            if block_end(&lines, i, child_indent) != i + 1 {
                return Err("Complex service value requires advanced editor".into());
            }
            // Keep inline comments on the changed scalar as well as all unrelated bytes.
            let rest = parse_line(lines[i]).entry.unwrap().1;
            let comment = scalar_comment(rest);
            let eol = if lines[i].ends_with("\r\n") {
                "\r\n"
            } else {
                "\n"
            };
            if value.is_null() {
                if comment.is_empty() {
                    out.remove(i);
                } else {
                    out[i] = format!("{}{comment}{eol}", " ".repeat(child_indent));
                }
            } else {
                out[i] = format!(
                    "{}{key}: {}{comment}{eol}",
                    " ".repeat(child_indent),
                    serde_json::to_string(value).map_err(|_| "Invalid parameter")?
                );
            }
        } else if !value.is_null() {
            if end > 0 && !out[end - 1].ends_with('\n') {
                out[end - 1].push('\n');
            }
            out.insert(
                end,
                format!(
                    "{}{key}: {}\n",
                    " ".repeat(child_indent),
                    serde_json::to_string(value).map_err(|_| "Invalid parameter")?
                ),
            );
        }
    }
    let result = out.concat();
    snapshot(target, &result)?;
    Ok(result)
}
/// Resolve existing links, including relative links, without ever replacing the link itself.
fn write_destination(path: &Path) -> Result<std::path::PathBuf, String> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => {
            let resolved =
                std::fs::canonicalize(path).map_err(|_| "Cannot resolve service settings file")?;
            if !resolved.is_file() {
                return Err("Service settings target must be a file".into());
            }
            Ok(resolved)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Canonicalize an existing parent too: a directory link must not
            // redirect the commit after the original snapshot has been read.
            match path.parent().filter(|parent| parent.exists()) {
                Some(parent) => Ok(std::fs::canonicalize(parent)
                    .map_err(|_| "Cannot resolve service settings directory")?
                    .join(path.file_name().ok_or("Invalid config filename")?)),
                None => Ok(path.to_path_buf()),
            }
        }
        Err(_) => Err("Cannot inspect service settings file".into()),
    }
}
fn write_at(
    path: &Path,
    target: &str,
    changes: &BTreeMap<String, Value>,
    expected: Option<&str>,
) -> Result<ServiceConfigSnapshot, String> {
    let destination = write_destination(path)?;
    let original = read_text(&destination)?;
    if expected != Some(stamp(&original).as_str()) {
        return Err("Service settings changed; reopen before saving".into());
    }
    let text = edit(&original, target, changes)?;
    if text == original {
        return snapshot(target, &text);
    }
    let parent = destination.parent().ok_or("Invalid config directory")?;
    std::fs::create_dir_all(parent).map_err(|_| "Cannot create config directory")?;
    let temporary = parent.join(format!(".service-config-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "Cannot create service settings file")?;
        file.write_all(text.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot write service settings")?;
        if write_destination(path)? != destination || read_text(&destination)? != original {
            return Err("Service settings changed; reopen before saving".to_string());
        }
        std::fs::rename(&temporary, &destination).map_err(|_| "Cannot replace service settings")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result?;
    snapshot(target, &text)
}
#[tauri::command]
pub async fn service_config_read(target: String) -> Result<ServiceConfigSnapshot, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    let destination = write_destination(&super::config_yml::config_path())?;
    snapshot(&target, &read_text(&destination)?)
}
#[tauri::command]
pub async fn service_config_write(
    target: String,
    changes: BTreeMap<String, Value>,
    expected_stamp: Option<String>,
) -> Result<ServiceConfigSnapshot, String> {
    let _guard = super::MUTATION_LOCK.lock().await;
    write_at(
        &super::config_yml::config_path(),
        &target,
        &changes,
        expected_stamp.as_deref(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tts_then_new_searxng_multiple_fields_roundtrip() {
        let dir = std::env::temp_dir().join(format!("service-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.yml");
        let original = "# preserved\nunrelated: true\n";
        std::fs::write(&path, original).unwrap();
        let tts = write_at(
            &path,
            "tts",
            &BTreeMap::from([("localVoice".into(), serde_json::json!("af_bella"))]),
            Some(&stamp(original)),
        )
        .unwrap();
        let before = read_text(&path).unwrap();
        let changes = BTreeMap::from([
            (
                "endpoint".into(),
                serde_json::json!("http://127.0.0.1:18080"),
            ),
            (
                "token".into(),
                serde_json::json!("synthetic-fixture-token-26"),
            ),
        ]);
        let saved = write_at(&path, "searxng", &changes, Some(&tts.stamp)).unwrap();
        let text = read_text(&path).unwrap();
        assert!(text.starts_with(&before));
        assert_eq!(text.lines().filter(|line| *line == "searxng:").count(), 1);
        let reopened = snapshot("searxng", &text).unwrap();
        assert_eq!(reopened.stamp, saved.stamp);
        assert_eq!(reopened.values["endpoint"], changes["endpoint"]);
        assert!(reopened.secrets["token"]);
        assert!(!reopened.values.contains_key("token"));
        assert_eq!(snapshot("tts", &text).unwrap().values, tts.values);
        let root: serde_yaml_ng::Value = serde_yaml_ng::from_str(&text).unwrap();
        assert_eq!(root["searxng"]["token"].as_str(), changes["token"].as_str());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn new_block_keeps_physical_lines_and_quoted_scalar_syntax() {
        for source in [
            "",
            "# preserved without newline",
            "tts:\r\n  localVoice: af_bella",
        ] {
            let changes = BTreeMap::from([
                (
                    "endpoint".into(),
                    serde_json::json!("http://127.0.0.1:18080"),
                ),
                (
                    "token".into(),
                    serde_json::json!("quoted: \"value\" # literal"),
                ),
            ]);
            let output = edit(source, "searxng", &changes).unwrap();
            assert!(output.starts_with(source));
            assert_eq!(output.lines().filter(|line| *line == "searxng:").count(), 1);
            let root: serde_yaml_ng::Value = serde_yaml_ng::from_str(&output).unwrap();
            assert_eq!(root["searxng"]["token"].as_str(), changes["token"].as_str());
            assert!(snapshot("searxng", &output).unwrap().secrets["token"]);
        }
    }

    #[test]
    fn malformed_yaml_and_unsupported_mapping_never_write() {
        let dir = std::env::temp_dir().join(format!("service-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.yml");
        let changes = BTreeMap::from([
            (
                "endpoint".into(),
                serde_json::json!("http://127.0.0.1:18080"),
            ),
            ("token".into(), serde_json::json!("fixture-only")),
        ]);
        for source in [
            "tts:\n  localVoice: [unterminated\n",
            "searxng:\n  endpoint: old\nsearxng:\n  token: fixture-only\n",
            "searxng: {endpoint: old}\n",
        ] {
            std::fs::write(&path, source).unwrap();
            assert!(write_at(&path, "searxng", &changes, Some(&stamp(source))).is_err());
            assert_eq!(read_text(&path).unwrap(), source);
            assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn writes_symlink_target_without_replacing_link_and_rejects_dangling_links() {
        use std::os::unix::fs::symlink;
        let dir =
            std::env::temp_dir().join(format!("service-config-link-{}", uuid::Uuid::new_v4()));
        let targets = dir.join("targets");
        std::fs::create_dir_all(&targets).unwrap();
        let target = targets.join("actual.yml");
        let path = dir.join("config.yml");
        let original = "unrelated: preserved\n";
        std::fs::write(&target, original).unwrap();
        symlink("targets/actual.yml", &path).unwrap();
        let changes = BTreeMap::from([("token".into(), Value::String("fixture-only".into()))]);
        write_at(&path, "searxng", &changes, Some(&stamp(original))).unwrap();
        assert!(std::fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            std::fs::read_link(&path).unwrap(),
            std::path::PathBuf::from("targets/actual.yml")
        );
        assert!(read_text(&target).unwrap().contains("fixture-only"));
        assert!(read_text(&target).unwrap().starts_with(original));

        let dangling = dir.join("dangling.yml");
        symlink("targets/missing.yml", &dangling).unwrap();
        assert!(write_at(&dangling, "searxng", &changes, Some(&stamp(""))).is_err());
        assert!(std::fs::symlink_metadata(&dangling)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!targets.join("missing.yml").exists());
        assert!(write_destination(&dangling).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn redacts_preserves_and_rejects_invalid_parameters() {
        let source = "# global\nsearxng:\n  endpoint: https://old.example\n  token: secret\n  future: keep # unknown\nother: 42\n";
        let changes = BTreeMap::from([(
            "endpoint".into(),
            Value::String("https://new.example".into()),
        )]);
        let output = edit(source, "searxng", &changes).unwrap();
        assert!(output.contains("  token: secret\n  future: keep # unknown\nother: 42\n"));
        let read = snapshot("searxng", &output).unwrap();
        assert!(read.secrets["token"]);
        assert!(!read.values.contains_key("token"));
        assert!(edit(source, "other", &changes).is_err());
        assert!(edit(
            source,
            "searxng",
            &BTreeMap::from([("path".into(), Value::String("/tmp".into()))])
        )
        .is_err());
        assert!(edit(
            source,
            "searxng",
            &BTreeMap::from([(
                "endpoint".into(),
                Value::String("https://u:p@example.org".into())
            )])
        )
        .is_err());
        let reset = edit(
            source,
            "searxng",
            &BTreeMap::from([("token".into(), Value::Null)]),
        )
        .unwrap();
        assert!(!snapshot("searxng", &reset).unwrap().secrets["token"]);
    }
    #[test]
    fn local_parameters_and_scalar_comments_are_preserved() {
        let source = "tts:\n  localVoice: custom_existing_voice\n  localSpeed: 1 # pace\n  future: keep\nsearxng:\n  token: \"old # literal\" # retained\n";
        let output = edit(
            source,
            "tts",
            &BTreeMap::from([("localSpeed".into(), serde_json::json!(1.25))]),
        )
        .unwrap();
        assert!(output.contains("localVoice: custom_existing_voice"));
        assert!(output.contains("localSpeed: 1.25 # pace"));
        assert!(output.contains("future: keep"));
        let reset = edit(
            &output,
            "searxng",
            &BTreeMap::from([("token".into(), Value::Null)]),
        )
        .unwrap();
        assert!(!reset.contains("old # literal"));
        assert!(reset.contains("# retained"));
        assert!(validate(
            "tts",
            &BTreeMap::from([("localSpeed".into(), serde_json::json!(0))])
        )
        .is_err());
        assert!(validate(
            "tts",
            &BTreeMap::from([("apiKey".into(), serde_json::json!("not-supported"))])
        )
        .is_err());
        assert!(validate(
            "searxng",
            &BTreeMap::from([("safesearch".into(), serde_json::json!(3))])
        )
        .is_err());
        assert!(validate(
            "stt",
            &BTreeMap::from([("language".into(), serde_json::json!("zh"))])
        )
        .is_ok());
    }
    #[test]
    fn stale_stamp_never_writes_and_atomic_save_is_private() {
        let dir = std::env::temp_dir().join(format!("service-config-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.yml");
        let original = "unrelated: true\n";
        std::fs::write(&path, original).unwrap();
        let changes = BTreeMap::from([("token".into(), Value::String("test-only".into()))]);
        assert!(write_at(&path, "searxng", &changes, Some("stale")).is_err());
        assert_eq!(read_text(&path).unwrap(), original);
        write_at(&path, "searxng", &changes, Some(&stamp(original))).unwrap();
        assert!(read_text(&path).unwrap().starts_with(original));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
