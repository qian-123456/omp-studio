//! Self-signed TLS certificate generation, persistence, and Rustls server config.

use parking_lot::Mutex;
use rcgen::generate_simple_self_signed;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Clone)]
pub struct TlsIdentity {
    pub server_config: Arc<rustls::ServerConfig>,
    pub cert_sha256: String,
}

#[derive(Serialize, Deserialize)]
struct CertMetadata {
    sans: Vec<String>,
    fingerprint: String,
}

static IDENTITY: Mutex<Option<(Option<String>, TlsIdentity)>> = Mutex::new(None);

fn tls_dir() -> PathBuf {
    crate::paths::data_dir().join("mobile-tls")
}

#[cfg(unix)]
fn set_key_mode(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|e| format!("设置私钥文件权限失败: {e}"))
}

#[cfg(not(unix))]
fn set_key_mode(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Create the TLS directory with mode 0700; also re-enforced when it already
/// exists (e.g. created by an older version with default permissions).
fn ensure_tls_dir(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt as _, PermissionsExt as _};
        if dir.is_dir() {
            fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("设置 TLS 证书目录权限失败: {e}"))?;
        } else {
            if let Some(parent) = dir.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建 TLS 证书目录失败: {e}"))?;
            }
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(dir)
                .map_err(|e| format!("创建 TLS 证书目录失败: {e}"))?;
        }
        Ok(())
    }
    #[cfg(not(unix))]
    fs::create_dir_all(dir).map_err(|e| format!("创建 TLS 证书目录失败: {e}"))
}

/// Write the private key so it is never readable by others, even briefly:
/// fresh 0600 temp file (`create_new`), write, then rename into place.
fn write_private_key(dir: &Path, key_der: &[u8]) -> Result<(), String> {
    let key_path = dir.join("key.der");
    let tmp_path = dir.join("key.der.tmp");
    let _ = fs::remove_file(&tmp_path); // stale temp from an interrupted run
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt as _;
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp_path)
            .map_err(|e| format!("保存 TLS 私钥失败: {e}"))?
    };
    #[cfg(not(unix))]
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
        .map_err(|e| format!("保存 TLS 私钥失败: {e}"))?;
    file.write_all(key_der)
        .map_err(|e| format!("保存 TLS 私钥失败: {e}"))?;
    drop(file);
    // The rename carries the temp file's 0600 mode onto the target.
    fs::rename(&tmp_path, &key_path).map_err(|e| format!("保存 TLS 私钥失败: {e}"))
}

fn compute_fingerprint(der: &[u8]) -> String {
    let hash = Sha256::digest(der);
    hash.iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

/// Compute SANs that must be present in the certificate.
fn required_sans(ddns_hostname: Option<&str>) -> Vec<String> {
    let mut sans = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "::1".to_string(),
    ];
    if let Some(host) = ddns_hostname {
        let trimmed = host.trim();
        if !trimmed.is_empty() && !sans.iter().any(|s| s.eq_ignore_ascii_case(trimmed)) {
            sans.push(trimmed.to_string());
        }
    }
    sans
}

fn is_covered(existing_sans: &[String], required: &[String]) -> bool {
    required.iter().all(|req| {
        existing_sans
            .iter()
            .any(|ext| ext.eq_ignore_ascii_case(req))
    })
}

/// Generate new self-signed certificate, persist to disk with the key at 0600.
fn generate_and_persist(sans: &[String]) -> Result<TlsIdentity, String> {
    let dir = tls_dir();
    ensure_tls_dir(&dir)?;

    let cert_key = generate_simple_self_signed(sans.to_vec())
        .map_err(|e| format!("生成自签名证书失败: {e}"))?;

    let cert_der = cert_key.cert.der().to_vec();
    let key_der = cert_key.key_pair.serialize_der();
    let fingerprint = compute_fingerprint(&cert_der);

    let cert_path = dir.join("cert.der");

    fs::write(&cert_path, &cert_der).map_err(|e| format!("保存 TLS 证书失败: {e}"))?;
    write_private_key(&dir, &key_der)?;

    let meta = CertMetadata {
        sans: sans.to_vec(),
        fingerprint: fingerprint.clone(),
    };
    if let Ok(meta_json) = serde_json::to_string_pretty(&meta) {
        let _ = fs::write(dir.join("meta.json"), meta_json);
    }

    build_identity(cert_der, key_der, fingerprint)
}

fn build_identity(
    cert_der: Vec<u8>,
    key_der: Vec<u8>,
    fingerprint: String,
) -> Result<TlsIdentity, String> {
    let cert = CertificateDer::from(cert_der);
    let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key_der));

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let server_config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| format!("TLS 协议版本配置失败: {e}"))?
        .with_no_client_auth()
        .with_single_cert(vec![cert], key)
        .map_err(|e| format!("TLS 证书加载失败: {e}"))?;

    Ok(TlsIdentity {
        server_config: Arc::new(server_config),
        cert_sha256: fingerprint,
    })
}

/// Ensure a self-signed certificate exists that covers `localhost` and `ddns_hostname` (if set).
/// Regenerates if the configured hostname is not covered.
pub fn ensure_tls_identity(ddns_hostname: Option<&str>) -> Result<TlsIdentity, String> {
    let host_norm = ddns_hostname
        .map(str::trim)
        .filter(|h| !h.is_empty())
        .map(str::to_string);

    let dir = tls_dir();
    ensure_tls_dir(&dir)?;

    let mut guard = IDENTITY.lock();
    if let Some((cached_host, ident)) = guard.as_ref() {
        if *cached_host == host_norm {
            return Ok(ident.clone());
        }
    }

    let cert_path = dir.join("cert.der");
    let key_path = dir.join("key.der");
    let meta_path = dir.join("meta.json");
    let needed_sans = required_sans(ddns_hostname);

    if cert_path.exists() && key_path.exists() && meta_path.exists() {
        if let Ok(meta_bytes) = fs::read(&meta_path) {
            if let Ok(meta) = serde_json::from_slice::<CertMetadata>(&meta_bytes) {
                if is_covered(&meta.sans, &needed_sans) {
                    if let (Ok(cert_der), Ok(key_der)) = (fs::read(&cert_path), fs::read(&key_path))
                    {
                        // Re-enforce 0600: an earlier failed chmod must not
                        // leave the key readable.
                        set_key_mode(&key_path)?;
                        let fp = compute_fingerprint(&cert_der);
                        if let Ok(ident) = build_identity(cert_der, key_der, fp) {
                            *guard = Some((host_norm, ident.clone()));
                            return Ok(ident);
                        }
                    }
                }
            }
        }
    }

    let ident = generate_and_persist(&needed_sans)?;
    *guard = Some((host_norm, ident.clone()));
    Ok(ident)
}
