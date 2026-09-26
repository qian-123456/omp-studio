//! Encrypted secret vault: `~/.omp-workspace/env/keys.env`.
//!
//! The file is `.env`-format (`# comments`, `SLUG_API_KEY=<value>` lines) but
//! VALUES ARE ENCRYPTED, not plaintext: AES-256-GCM with a random nonce per
//! entry, stored as `v1:<nonce_b64>:<ct_b64>`. The 32-byte master key lives in
//! the macOS Keychain (service `omp-workspace.vault`, account `master-v1`).
//! Plaintext key material exists ONLY in memory (injection / connection test /
//! explicit .env export) — never logged, never returned to the frontend after
//! save, never written anywhere but this file. There is NO plaintext fallback:
//! when the Keychain is unavailable the vault fails with a clear error.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine as _;

use crate::paths;

const KEYCHAIN_SERVICE: &str = "omp-workspace.vault";
const KEYCHAIN_ACCOUNT: &str = "master-v1";
/// Ciphertext format version prefix.
const VERSION: &str = "v1";

/// `~/.omp-workspace/env/keys.env`
pub fn vault_path() -> PathBuf {
    paths::data_dir().join("env").join("keys.env")
}

fn env_dir() -> PathBuf {
    paths::data_dir().join("env")
}

/// Create the vault directory with `chmod 700` (idempotent).
pub fn ensure_dir() -> Result<(), String> {
    let dir = env_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建密钥目录失败: {e}"))?;
    set_mode(&dir, 0o700)
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
        .map_err(|e| format!("设置文件权限失败: {e}"))
}

#[cfg(not(unix))]
fn set_mode(_path: &Path, _mode: u32) -> Result<(), String> {
    Ok(())
}

// ---- master key (macOS Keychain via the `security` CLI) ----

fn decode_hex_key(hex: &str) -> Option<[u8; 32]> {
    let hex = hex.trim();
    if hex.len() != 64 {
        return None;
    }
    let mut key = [0u8; 32];
    for (i, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(key)
}

fn keychain_read() -> Result<[u8; 32], String> {
    let out = std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            KEYCHAIN_ACCOUNT,
            "-w",
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("无法运行 security 命令: {e}"))?;
    if !out.status.success() {
        return Err(keychain_error());
    }
    let hex = String::from_utf8_lossy(&out.stdout);
    decode_hex_key(&hex).ok_or_else(keychain_error)
}

fn keychain_error() -> String {
    format!(
        "无法访问 macOS 钥匙串（service: {KEYCHAIN_SERVICE}）。密钥库依赖钥匙串加密保存主密钥，\
         不会降级为明文存储；请在「系统设置 → 隐私与安全性」中允许访问，或删除旧钥匙串条目后重试。"
    )
}

fn random_key() -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    getrandom::fill(&mut key).map_err(|e| format!("生成随机主密钥失败: {e}"))?;
    Ok(key)
}

fn keychain_create(key: &[u8; 32]) -> Result<(), String> {
    let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    let out = std::process::Command::new("security")
        .args([
            "add-generic-password",
            "-U",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            KEYCHAIN_ACCOUNT,
            "-w",
            &hex,
        ])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("无法运行 security 命令: {e}"))?;
    if !out.status.success() {
        return Err(keychain_error());
    }
    Ok(())
}

/// Load the master key, creating a fresh random one in the Keychain on first
/// use. A successful load is cached for the process lifetime.
pub fn master_key() -> Result<[u8; 32], String> {
    static KEY: OnceLock<[u8; 32]> = OnceLock::new();
    if let Some(key) = KEY.get() {
        return Ok(*key);
    }
    let key = match keychain_read() {
        Ok(key) => key,
        Err(read_err) => {
            // First use (no vault content yet): create a fresh key. When the
            // vault already holds ciphertext a new key would be useless, so
            // surface the read error instead.
            let has_content = std::fs::read(vault_path())
                .map(|bytes| !bytes.is_empty())
                .unwrap_or(false);
            if has_content {
                return Err(read_err);
            }
            let key = random_key()?;
            keychain_create(&key)?;
            key
        }
    };
    let _ = KEY.set(key);
    Ok(key)
}

// ---- crypto (key passed explicitly so tests need no Keychain) ----

/// Encrypt to `v1:<nonce_b64>:<ct_b64>` (random nonce per entry).
pub fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<String, String> {
    let cipher = Aes256Gcm::new(key.into());
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).map_err(|e| format!("生成随机 nonce 失败: {e}"))?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "加密失败".to_string())?;
    Ok(format!(
        "{VERSION}:{}:{}",
        base64::engine::general_purpose::STANDARD.encode(nonce),
        base64::engine::general_purpose::STANDARD.encode(ct)
    ))
}

/// Decrypt a token produced by [`encrypt`].
pub fn decrypt(key: &[u8; 32], token: &str) -> Result<String, String> {
    let mut parts = token.splitn(3, ':');
    let version = parts.next().unwrap_or_default();
    if version != VERSION {
        return Err(format!("不支持的密文版本: {version}"));
    }
    let nonce_b64 = parts.next().ok_or("密文格式错误")?;
    let ct_b64 = parts.next().ok_or("密文格式错误")?;
    let nonce = base64::engine::general_purpose::STANDARD
        .decode(nonce_b64)
        .map_err(|_| "密文格式错误".to_string())?;
    let ct = base64::engine::general_purpose::STANDARD
        .decode(ct_b64)
        .map_err(|_| "密文格式错误".to_string())?;
    let cipher = Aes256Gcm::new(key.into());
    let pt = cipher
        .decrypt(Nonce::from_slice(&nonce), ct.as_ref())
        .map_err(|_| "解密失败：密钥与密文不匹配".to_string())?;
    String::from_utf8(pt).map_err(|_| "解密结果不是有效的 UTF-8".to_string())
}

// ---- `.env` file format ----

/// Parse `.env`-format text into `(key, value)` pairs, skipping comments,
/// blank and malformed lines. Surrounding quotes are stripped.
/// The live paste-preview runs in the frontend (same rules); this canonical
/// parser is exercised by the unit tests below.
#[allow(dead_code)]
pub fn parse_env_text(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        let mut value = v.trim().to_string();
        if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            value = value[1..value.len() - 1].to_string();
        }
        if value.is_empty() {
            continue;
        }
        out.push((key.to_string(), value));
    }
    out
}

/// Vault line key for a provider slug (`my-slug` → `MY-SLUG_API_KEY`).
pub fn line_key(slug: &str) -> String {
    format!("{}_API_KEY", slug.to_ascii_uppercase())
}

fn read_lines() -> Result<Vec<String>, String> {
    let path = vault_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取密钥文件失败: {e}"))?;
    Ok(text.lines().map(str::to_string).collect())
}

/// Atomic write (tmp + rename), `chmod 600` after every write.
fn write_lines(lines: &[String]) -> Result<(), String> {
    ensure_dir()?;
    let path = vault_path();
    let tmp = path.with_extension("env.tmp");
    let body = if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    };
    std::fs::write(&tmp, body).map_err(|e| format!("写入密钥文件失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("替换密钥文件失败: {e}"))?;
    set_mode(&path, 0o600)
}

/// Whether a non-empty vault entry exists for the slug (no decryption).
pub fn contains(slug: &str) -> bool {
    let needle = line_key(slug);
    read_lines().is_ok_and(|lines| {
        lines.iter().any(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty()
                && !trimmed.starts_with('#')
                && trimmed
                    .split_once('=')
                    .is_some_and(|(k, v)| k.trim() == needle && !v.trim().is_empty())
        })
    })
}

/// Decrypt and return the stored secret for a slug (in-memory only).
pub fn read_entry(slug: &str) -> Result<Option<String>, String> {
    read_entry_with(&master_key()?, slug)
}

/// [`read_entry`] with a caller-supplied master key (avoids repeat Keychain
/// reads when processing many providers).
pub fn read_entry_with(key: &[u8; 32], slug: &str) -> Result<Option<String>, String> {
    let needle = line_key(slug);
    for line in read_lines()? {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            if k.trim() == needle {
                let value = v.trim();
                if value.is_empty() {
                    return Ok(None);
                }
                return Ok(Some(decrypt(key, value)?));
            }
        }
    }
    Ok(None)
}

/// Encrypt and upsert the secret for a slug, replacing the existing line
/// in place (comments and unrelated entries are preserved).
pub fn write_entry(slug: &str, plaintext: &str) -> Result<(), String> {
    if plaintext.is_empty() {
        return Err("密钥不能为空".to_string());
    }
    if plaintext.contains('\0') || plaintext.contains('\n') || plaintext.contains('\r') {
        return Err("密钥包含非法字符".to_string());
    }
    let key = master_key()?;
    let token = encrypt(&key, plaintext.as_bytes())?;
    let needle = line_key(slug);
    let mut lines = read_lines()?;
    let mut replaced = false;
    for line in lines.iter_mut() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, _)) = trimmed.split_once('=') {
            if k.trim() == needle {
                *line = format!("{needle}={token}");
                replaced = true;
                break;
            }
        }
    }
    if !replaced {
        lines.push(format!("{needle}={token}"));
    }
    write_lines(&lines)
}

/// Remove the vault entry for a slug. A missing entry is not an error.
pub fn remove_entry(slug: &str) -> Result<(), String> {
    let needle = line_key(slug);
    let mut lines = read_lines()?;
    let before = lines.len();
    lines.retain(|line| {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            return true;
        }
        trimmed
            .split_once('=')
            .map(|(k, _)| k.trim() != needle)
            .unwrap_or(true)
    });
    if lines.len() == before {
        return Ok(());
    }
    write_lines(&lines)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> [u8; 32] {
        let mut key = [0u8; 32];
        getrandom::fill(&mut key).unwrap();
        key
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let key = test_key();
        let secret = "sk-abc123-密钥-with unicode ✓";
        let token = encrypt(&key, secret.as_bytes()).unwrap();
        assert!(token.starts_with("v1:"));
        assert!(!token.contains("sk-abc123"));
        assert_eq!(decrypt(&key, &token).unwrap(), secret);
    }

    #[test]
    fn nonce_differs_per_entry_and_wrong_key_fails() {
        let key = test_key();
        let t1 = encrypt(&key, b"same").unwrap();
        let t2 = encrypt(&key, b"same").unwrap();
        assert_ne!(t1, t2, "random nonce per entry");

        let other = test_key();
        assert!(decrypt(&other, &t1).is_err());
        assert!(decrypt(&key, "v0:xx:yy").is_err());
        assert!(decrypt(&key, "v1:notb64:alsonot").is_err());
    }

    #[test]
    fn parse_env_text_skips_comments_and_malformed_lines() {
        let text = "# comment\nANTHROPIC_API_KEY=sk-aaa\n\nBROKEN\n\
                    QUOTED=\"with spaces\"\nEMPTY=\nBAD KEY=x\nOPENAI_API_KEY = sk-bbb \n";
        let entries = parse_env_text(text);
        assert_eq!(
            entries,
            vec![
                ("ANTHROPIC_API_KEY".to_string(), "sk-aaa".to_string()),
                ("QUOTED".to_string(), "with spaces".to_string()),
                ("OPENAI_API_KEY".to_string(), "sk-bbb".to_string()),
            ]
        );
    }

    #[test]
    fn line_key_uppercases_slug() {
        assert_eq!(line_key("openai"), "OPENAI_API_KEY");
        assert_eq!(line_key("my-gateway"), "MY-GATEWAY_API_KEY");
    }

    #[test]
    fn decode_hex_key_validates_length_and_hex() {
        assert!(decode_hex_key(&"ab".repeat(32)).is_some());
        assert!(decode_hex_key("abcd").is_none());
        assert!(decode_hex_key(&"zz".repeat(32)).is_none());
    }
}
