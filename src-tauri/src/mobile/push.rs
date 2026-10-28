//! Web push for the phone app: RFC 8030 delivery, RFC 8291 `aes128gcm`
//! payload encryption and RFC 8292 VAPID, hand-rolled on `ring` (already in
//! the tree through rustls) so no OpenSSL is pulled in.
//!
//! * The VAPID P-256 key pair is generated once and stored in the `settings`
//!   table (`mobile_vapid_pkcs8`, base64url PKCS#8). Keys are never logged.
//! * Subscriptions live in `push_subscriptions` (SQLite, migration v21), one
//!   row per push endpoint, owned by the paired device that registered it.
//! * [`run`] listens on the app event bus and pushes when a session needs
//!   approval / an answer, errors, or finishes a turn, but only to devices
//!   that have no open SSE stream (they would see it live).

use std::collections::HashMap;
use std::future::Future;
use std::sync::LazyLock;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine as _;
use parking_lot::Mutex;
use ring::rand::SystemRandom;
use ring::signature::{EcdsaKeyPair, KeyPair as _, ECDSA_P256_SHA256_FIXED_SIGNING};
use ring::{aead, agreement, hkdf};
use rusqlite::{params, Connection, OptionalExtension as _};
use serde_json::{json, Value};
use tokio::sync::watch;

use crate::contracts::SessionStatus;
use crate::state::{AppEvent, AppState};

const VAPID_SETTING_KEY: &str = "mobile_vapid_pkcs8";
/// RFC 8292 `sub` claim; push services only require a contact URI.
const VAPID_SUBJECT: &str = "mailto:omp-workspace@example.com";
/// How long a push service keeps an undeliverable message.
const PUSH_TTL_SECS: u32 = 3600;
/// VAPID token validity (RFC 8292 caps it at 24 h).
const VAPID_TTL_SECS: i64 = 12 * 3600;
/// Subscriptions kept per paired device (oldest are dropped).
const MAX_PER_DEVICE: i64 = 8;
const RECORD_SIZE: u32 = 4096;

/// Push services a subscription endpoint may point at. The server POSTs to the
/// endpoint the phone supplies, so anything else (private hosts, arbitrary
/// URLs) would be an SSRF vector.
const PUSH_HOST_SUFFIXES: &[&str] = &[
    "fcm.googleapis.com",
    "android.googleapis.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
];

// ---------------------------------------------------------------- VAPID

pub struct Vapid {
    key: EcdsaKeyPair,
    /// Uncompressed P-256 public key (65 bytes).
    pub public: Vec<u8>,
}

impl Vapid {
    fn from_pkcs8(der: &[u8]) -> Result<Self, String> {
        let key =
            EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, der, &SystemRandom::new())
                .map_err(|_| "VAPID 密钥无效".to_string())?;
        let public = key.public_key().as_ref().to_vec();
        Ok(Self { key, public })
    }

    /// `applicationServerKey` as the browser expects it (base64url, no padding).
    pub fn public_b64(&self) -> String {
        B64.encode(&self.public)
    }

    /// `Authorization` header value (RFC 8292 §2, `vapid` scheme).
    fn authorization(&self, endpoint: &str, now: i64) -> Result<String, String> {
        let aud = origin_of(endpoint).ok_or("订阅地址无效")?;
        let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims = B64.encode(
            json!({"aud": aud, "exp": now + VAPID_TTL_SECS, "sub": VAPID_SUBJECT}).to_string(),
        );
        let signing_input = format!("{header}.{claims}");
        let sig = self
            .key
            .sign(&SystemRandom::new(), signing_input.as_bytes())
            .map_err(|_| "VAPID 签名失败".to_string())?;
        Ok(format!(
            "vapid t={signing_input}.{}, k={}",
            B64.encode(sig.as_ref()),
            self.public_b64()
        ))
    }
}

/// Load the stored VAPID key pair, generating and persisting it on first use.
pub fn load_vapid(conn: &Connection) -> Result<Vapid, String> {
    let read = || -> Result<Option<Vec<u8>>, String> {
        let stored: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                [VAPID_SETTING_KEY],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("读取推送密钥失败: {e}"))?;
        Ok(stored.and_then(|s| B64.decode(s).ok()))
    };
    if let Some(der) = read()? {
        if let Ok(v) = Vapid::from_pkcs8(&der) {
            return Ok(v);
        }
    }
    let der = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &SystemRandom::new())
        .map_err(|_| "生成推送密钥失败".to_string())?;
    // First writer wins; a corrupt stored value is replaced.
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![VAPID_SETTING_KEY, B64.encode(der.as_ref())],
    )
    .map_err(|e| format!("保存推送密钥失败: {e}"))?;
    Vapid::from_pkcs8(der.as_ref())
}

/// `scheme://host[:port]` of an absolute URL (the VAPID `aud`).
fn origin_of(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    let host = u.host_str()?;
    Some(match u.port() {
        Some(p) => format!("{}://{host}:{p}", u.scheme()),
        None => format!("{}://{host}", u.scheme()),
    })
}

// ----------------------------------------------------------- encryption

struct Len(usize);

impl hkdf::KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

fn hkdf_expand(prk: &hkdf::Prk, info: &[u8], out: &mut [u8]) -> Result<(), String> {
    prk.expand(&[info], Len(out.len()))
        .and_then(|okm| okm.fill(out))
        .map_err(|_| "HKDF 失败".to_string())
}

/// Content-encryption key and nonce of RFC 8291 §3.4 / RFC 8188.
struct Keys {
    cek: [u8; 16],
    nonce: [u8; 12],
}

fn derive_keys(
    ua_public: &[u8],
    as_public: &[u8],
    auth_secret: &[u8],
    ecdh_secret: &[u8],
    salt: &[u8; 16],
) -> Result<Keys, String> {
    // PRK_key = HKDF-Extract(salt = auth_secret, IKM = ecdh_secret)
    let prk_key = hkdf::Salt::new(hkdf::HKDF_SHA256, auth_secret).extract(ecdh_secret);
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(ua_public);
    key_info.extend_from_slice(as_public);
    let mut ikm = [0u8; 32];
    hkdf_expand(&prk_key, &key_info, &mut ikm)?;
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, salt).extract(&ikm);
    let mut keys = Keys {
        cek: [0; 16],
        nonce: [0; 12],
    };
    hkdf_expand(&prk, b"Content-Encoding: aes128gcm\0", &mut keys.cek)?;
    hkdf_expand(&prk, b"Content-Encoding: nonce\0", &mut keys.nonce)?;
    Ok(keys)
}

/// RFC 8291 body for a single record: `salt | rs | idlen | as_public | ciphertext`.
fn encrypt_body(
    ua_public: &[u8],
    as_public: &[u8],
    auth_secret: &[u8],
    ecdh_secret: &[u8],
    salt: &[u8; 16],
    plaintext: &[u8],
) -> Result<Vec<u8>, String> {
    let max = RECORD_SIZE as usize - 16 - 1;
    if plaintext.len() > max {
        return Err("推送内容过长".into());
    }
    let keys = derive_keys(ua_public, as_public, auth_secret, ecdh_secret, salt)?;
    let mut record = plaintext.to_vec();
    record.push(0x02); // last-record padding delimiter
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_128_GCM, &keys.cek).map_err(|_| "AES 密钥无效")?,
    );
    key.seal_in_place_append_tag(
        aead::Nonce::assume_unique_for_key(keys.nonce),
        aead::Aad::empty(),
        &mut record,
    )
    .map_err(|_| "加密失败".to_string())?;
    let mut body = Vec::with_capacity(21 + as_public.len() + record.len());
    body.extend_from_slice(salt);
    body.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    body.push(as_public.len() as u8);
    body.extend_from_slice(as_public);
    body.extend_from_slice(&record);
    Ok(body)
}

/// ECDH over P-256 with a fresh ephemeral key: `(our public key, shared secret)`.
fn ecdh(ua_public: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let rng = SystemRandom::new();
    let eph = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng)
        .map_err(|_| "生成临时密钥失败".to_string())?;
    let public = eph
        .compute_public_key()
        .map_err(|_| "计算公钥失败".to_string())?
        .as_ref()
        .to_vec();
    let peer = agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, ua_public);
    let secret = agreement::agree_ephemeral(eph, &peer, |s| s.to_vec())
        .map_err(|_| "订阅公钥无效".to_string())?;
    Ok((public, secret))
}

/// Encrypt `plaintext` for one subscription (fresh ephemeral key and salt).
fn encrypt_for(sub: &Subscription, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let ua_public = B64.decode(&sub.p256dh).map_err(|_| "p256dh 无效")?;
    let auth_secret = B64.decode(&sub.auth).map_err(|_| "auth 无效")?;
    let (as_public, secret) = ecdh(&ua_public)?;
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|_| "随机数不可用".to_string())?;
    encrypt_body(
        &ua_public,
        &as_public,
        &auth_secret,
        &secret,
        &salt,
        plaintext,
    )
}

// -------------------------------------------------------- subscriptions

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Subscription {
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
    /// `mobile_devices.token_hash` of the owning paired device.
    pub token_hash: String,
}

fn endpoint_allowed(endpoint: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    if u.scheme() != "https"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some_and(|p| p != 443)
    {
        return false;
    }
    // `domain()` is None for IP-literal hosts.
    match u.domain() {
        Some(h) => {
            let h = h.to_ascii_lowercase();
            PUSH_HOST_SUFFIXES
                .iter()
                .any(|s| h == *s || h.ends_with(&format!(".{s}")))
        }
        None => false,
    }
}

/// Validate a browser `PushSubscription` and bind it to `token_hash`.
pub fn validate_subscription(
    endpoint: &str,
    p256dh: &str,
    auth: &str,
    token_hash: &str,
) -> Result<Subscription, String> {
    if endpoint.len() > 2048 || !endpoint_allowed(endpoint) {
        return Err("不支持的推送服务地址".into());
    }
    let key = B64.decode(p256dh.trim_end_matches('=')).unwrap_or_default();
    if key.len() != 65 || key[0] != 0x04 {
        return Err("p256dh 必须是未压缩的 P-256 公钥".into());
    }
    let secret = B64.decode(auth.trim_end_matches('=')).unwrap_or_default();
    if secret.len() != 16 {
        return Err("auth 必须是 16 字节".into());
    }
    Ok(Subscription {
        endpoint: endpoint.to_string(),
        // Stored canonical (unpadded) so later decoding is uniform.
        p256dh: B64.encode(key),
        auth: B64.encode(secret),
        token_hash: token_hash.to_string(),
    })
}

pub fn save_subscription(conn: &Connection, sub: &Subscription, now: &str) -> Result<(), String> {
    let err = |e: rusqlite::Error| format!("保存订阅失败: {e}");
    conn.execute(
        "INSERT INTO push_subscriptions(endpoint, p256dh, auth, token_hash, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
           token_hash = excluded.token_hash",
        params![sub.endpoint, sub.p256dh, sub.auth, sub.token_hash, now],
    )
    .map_err(err)?;
    conn.execute(
        "DELETE FROM push_subscriptions WHERE token_hash = ?1 AND endpoint NOT IN (
           SELECT endpoint FROM push_subscriptions WHERE token_hash = ?1
           ORDER BY created_at DESC, rowid DESC LIMIT ?2)",
        params![sub.token_hash, MAX_PER_DEVICE],
    )
    .map_err(err)?;
    Ok(())
}

/// Remove `endpoint` when it belongs to `token_hash`; returns rows removed.
pub fn remove_subscription(conn: &Connection, endpoint: &str, token_hash: &str) -> usize {
    conn.execute(
        "DELETE FROM push_subscriptions WHERE endpoint = ?1 AND token_hash = ?2",
        params![endpoint, token_hash],
    )
    .unwrap_or(0)
}

fn drop_endpoint(conn: &Connection, endpoint: &str) {
    let _ = conn.execute(
        "DELETE FROM push_subscriptions WHERE endpoint = ?1",
        [endpoint],
    );
}

/// Subscriptions of still-paired devices; `device` narrows to one device.
pub fn list_subscriptions(conn: &Connection, device: Option<&str>) -> Vec<Subscription> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT s.endpoint, s.p256dh, s.auth, s.token_hash FROM push_subscriptions s
         JOIN mobile_devices d ON d.token_hash = s.token_hash
         WHERE (?1 IS NULL OR s.token_hash = ?1) ORDER BY s.created_at",
    ) else {
        return Vec::new();
    };
    stmt.query_map([device], |r| {
        Ok(Subscription {
            endpoint: r.get(0)?,
            p256dh: r.get(1)?,
            auth: r.get(2)?,
            token_hash: r.get(3)?,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

// -------------------------------------------------------- SSE presence

static SSE_CLIENTS: LazyLock<Mutex<HashMap<String, usize>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DevicePresence {
    pub current_session: Option<String>,
    pub visible: bool,
}

struct PresenceRecord {
    presence: DevicePresence,
    updated_at: std::time::Instant,
}

static PRESENCE: LazyLock<Mutex<HashMap<String, PresenceRecord>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Marks a device as having a live `/api/events` stream while it is alive.
pub struct SseGuard(String);

impl SseGuard {
    pub fn new(token_hash: String) -> Self {
        *SSE_CLIENTS.lock().entry(token_hash.clone()).or_insert(0) += 1;
        Self(token_hash)
    }
}

impl Drop for SseGuard {
    fn drop(&mut self) {
        let mut map = SSE_CLIENTS.lock();
        if let Some(n) = map.get_mut(&self.0) {
            *n -= 1;
            if *n == 0 {
                map.remove(&self.0);
            }
        }
    }
}

pub fn has_sse_client(token_hash: &str) -> bool {
    SSE_CLIENTS.lock().contains_key(token_hash)
}

/// Update device foreground visibility and currently viewed session.
pub fn update_presence(token_hash: &str, current_session: Option<String>, visible: bool) {
    PRESENCE.lock().insert(
        token_hash.to_string(),
        PresenceRecord {
            presence: DevicePresence {
                current_session,
                visible,
            },
            updated_at: std::time::Instant::now(),
        },
    );
}

/// Clear presence for a device.
#[allow(dead_code)]
pub fn clear_presence(token_hash: &str) {
    PRESENCE.lock().remove(token_hash);
}

/// Read current presence state for a device.
#[allow(dead_code)]
pub fn get_presence(token_hash: &str) -> Option<DevicePresence> {
    PRESENCE
        .lock()
        .get(token_hash)
        .map(|record| record.presence.clone())
}

/// Whether a device is currently connected via SSE AND actively in the foreground
/// viewing that specific session. If so, web push is suppressed.
pub fn is_viewing_session(token_hash: &str, session_id: &str) -> bool {
    if !has_sse_client(token_hash) {
        return false;
    }
    let map = PRESENCE.lock();
    let Some(presence) = map.get(token_hash) else {
        return false;
    };
    presence.updated_at.elapsed() < Duration::from_secs(45)
        && presence.presence.visible
        && presence.presence.current_session.as_deref() == Some(session_id)
}
// ------------------------------------------------------------- delivery

/// One ready-to-send HTTP request to a push service.
pub struct PushHttp {
    pub endpoint: String,
    pub authorization: String,
    pub body: Vec<u8>,
    pub ttl: u32,
    pub urgency: &'static str,
}

/// POST to the push service; resolves to its HTTP status. Redirects are not
/// followed (the endpoint host was allow-listed, its redirect target was not).
pub async fn http_post(req: PushHttp) -> Result<u16, String> {
    static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap_or_default()
    });
    let res = CLIENT
        .post(&req.endpoint)
        .header("Authorization", req.authorization)
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream")
        .header("TTL", req.ttl.to_string())
        .header("Urgency", req.urgency)
        .body(req.body)
        .send()
        .await
        .map_err(|e| format!("推送请求失败: {}", e.without_url()))?;
    Ok(res.status().as_u16())
}

fn build_request(
    vapid: &Vapid,
    sub: &Subscription,
    payload: &[u8],
    now: i64,
    urgency: &'static str,
) -> Result<PushHttp, String> {
    Ok(PushHttp {
        endpoint: sub.endpoint.clone(),
        authorization: vapid.authorization(&sub.endpoint, now)?,
        body: encrypt_for(sub, payload)?,
        ttl: PUSH_TTL_SECS,
        urgency,
    })
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Summary {
    pub sent: u32,
    /// Subscriptions deleted because the push service reported them gone.
    pub removed: u32,
    pub failed: u32,
}

/// Encrypt and send `payload` to subscriptions (optionally one device, optionally
/// only devices without an open SSE stream). 404/410 delete the subscription.
pub async fn notify<F, Fut>(
    db: &Mutex<Connection>,
    device: Option<&str>,
    skip_live_devices: bool,
    payload: &Value,
    send: F,
) -> Summary
where
    F: Fn(PushHttp) -> Fut,
    Fut: Future<Output = Result<u16, String>>,
{
    let (vapid, subs) = {
        let conn = db.lock();
        let Ok(vapid) = load_vapid(&conn) else {
            return Summary::default();
        };
        (vapid, list_subscriptions(&conn, device))
    };
    let body = payload.to_string();
    let now = chrono::Utc::now().timestamp();
    let mut out = Summary::default();
    for sub in subs {
        if skip_live_devices {
            if let Some(session_id) = payload.get("sessionId").and_then(Value::as_str) {
                if is_viewing_session(&sub.token_hash, session_id) {
                    continue;
                }
            }
        }
        let status = match build_request(&vapid, &sub, body.as_bytes(), now, "high") {
            Ok(req) => send(req).await,
            Err(e) => Err(e),
        };
        match status {
            Ok(200..=299) => out.sent += 1,
            Ok(404 | 410) => {
                drop_endpoint(&db.lock(), &sub.endpoint);
                out.removed += 1;
            }
            Ok(code) => {
                tracing::warn!("web push rejected with HTTP {code}");
                out.failed += 1;
            }
            Err(e) => {
                tracing::warn!("web push failed: {e}");
                out.failed += 1;
            }
        }
    }
    out
}

// ------------------------------------------------------- event listener

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Kind {
    Approval,
    Question,
    Error,
    Done,
}

/// Status transitions the phone should hear about.
fn classify(old: SessionStatus, new: SessionStatus) -> Option<Kind> {
    match new {
        SessionStatus::AwaitingApproval => Some(Kind::Approval),
        SessionStatus::AwaitingAnswer => Some(Kind::Question),
        SessionStatus::Error => Some(Kind::Error),
        SessionStatus::Review if old == SessionStatus::Working => Some(Kind::Done),
        _ => None,
    }
}

/// Notification payload; the service worker shows `title`/`body` and opens `url`.
fn payload(kind: Kind, session_id: &str, name: &str, detail: &str) -> Value {
    let (title, fallback) = match kind {
        Kind::Approval => ("需要审批", "有工具调用等待你的批准"),
        Kind::Question => ("需要你的回答", "会话正在等待你的回答"),
        Kind::Error => ("会话出错", "会话遇到错误，需要处理"),
        Kind::Done => ("回合完成", "会话已完成，等待验收"),
    };
    let detail = detail.trim();
    let body = if detail.is_empty() {
        fallback.to_string()
    } else {
        format!("{name}：{detail}")
    };
    json!({
        "title": format!("{title} · {name}"),
        "body": body.chars().take(140).collect::<String>(),
        "url": format!("#/s/{session_id}"),
        "tag": session_id,
        "sessionId": session_id,
    })
}

fn first_line(s: &str) -> &str {
    s.lines().find(|l| !l.trim().is_empty()).unwrap_or("")
}

/// A distinct dialog must never share the rate-limit key of its predecessor.
fn notification_identity(kind: Kind, pending: &[crate::contracts::PendingUiRequest]) -> String {
    if matches!(kind, Kind::Approval | Kind::Question) {
        let mut keys: Vec<String> = pending
            .iter()
            .map(|p| {
                format!(
                    "{}:{}",
                    p.request.get("id").unwrap_or(&Value::Null),
                    p.received_at
                )
            })
            .collect();
        keys.sort();
        if !keys.is_empty() {
            let encoded = serde_json::to_vec(&keys).expect("string list serializes");
            return B64.encode(ring::digest::digest(&ring::digest::SHA256, &encoded).as_ref());
        }
        // A missing snapshot is not evidence that two requests are identical.
        return uuid::Uuid::new_v4().to_string();
    }
    String::new()
}
async fn push_session_event(
    state: &AppState,
    session_id: &str,
    kind: Kind,
    identity: &str,
    pending: Vec<crate::contracts::PendingUiRequest>,
) {
    let meta = crate::catalog::get(state, session_id).await;
    let name = meta
        .as_ref()
        .map(crate::todos::sessions::display_name)
        .unwrap_or_else(|| "会话".to_string());
    let detail = match kind {
        Kind::Approval | Kind::Question => pending
            .first()
            .and_then(|p| {
                p.request
                    .get("title")
                    .and_then(Value::as_str)
                    .map(String::from)
            })
            .map(|t| first_line(&t).to_string())
            .unwrap_or_default(),
        Kind::Done => meta
            .as_ref()
            .and_then(|m| m.last_assistant.as_deref())
            .map(|t| first_line(t).to_string())
            .unwrap_or_default(),
        Kind::Error => String::new(),
    };
    let mut body = payload(kind, session_id, &name, &detail);
    if !identity.is_empty() {
        body["tag"] = json!(format!("{session_id}:{identity}"));
    }
    notify(&state.db, None, true, &body, http_post).await;
}

/// Bus listener; runs until `shutdown` flips (mobile server stop).
pub async fn run(state: AppState, mut shutdown: watch::Receiver<bool>) {
    let mut rx = state.bus.subscribe();
    // Only identical requests share a rate-limit window, never an entire session.
    let mut recent: HashMap<(String, Kind, String), std::time::Instant> = HashMap::new();
    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    return;
                }
            }
            ev = rx.recv() => match ev {
                Ok(AppEvent::SessionStatusChanged { session_id, old, new }) => {
                    let Some(kind) = classify(old, new) else { continue };
                    let pending = if matches!(kind, Kind::Approval | Kind::Question) {
                        crate::rpc::pending_ui(&state, &session_id).await
                    } else { Vec::new() };
                    let identity = notification_identity(kind, &pending);
                    let now = std::time::Instant::now();
                    recent.retain(|_, t| now.duration_since(*t) < Duration::from_secs(30));
                    if recent.insert((session_id.clone(), kind, identity.clone()), now).is_some() {
                        continue;
                    }
                    let state = state.clone();
                    tokio::spawn(async move { push_session_event(&state, &session_id, kind, &identity, pending).await });
                }
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    }
}

/// Payload of `POST /push/test`.
pub fn test_payload() -> Value {
    json!({
        "title": "OMP 通知已开启",
        "body": "这是一条测试通知",
        "url": "#/",
        "tag": "omp-test",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinct_approval_requests_are_not_rate_limited_together() {
        let pending = |id: &str| {
            vec![crate::contracts::PendingUiRequest {
                session_id: "s".into(),
                request: json!({"id": id}),
                received_at: "same-instant".into(),
            }]
        };
        let first = notification_identity(Kind::Approval, &pending("first"));
        let second = notification_identity(Kind::Approval, &pending("second"));
        let mut recent = HashMap::new();
        assert!(recent
            .insert(("s", Kind::Approval, first.clone()), ())
            .is_none());
        assert!(recent.insert(("s", Kind::Approval, second), ()).is_none());
        assert!(recent.insert(("s", Kind::Approval, first), ()).is_some());
        assert_ne!(
            notification_identity(Kind::Approval, &[]),
            notification_identity(Kind::Approval, &[])
        );
    }

    #[test]
    fn stale_foreground_presence_does_not_suppress_notifications() {
        let device = "stale-presence-regression";
        let _guard = SseGuard::new(device.into());
        update_presence(device, Some("s".into()), true);
        assert!(is_viewing_session(device, "s"));
        PRESENCE.lock().get_mut(device).unwrap().updated_at =
            std::time::Instant::now() - Duration::from_secs(46);
        assert!(!is_viewing_session(device, "s"));
        clear_presence(device);
    }
    use ring::signature::{UnparsedPublicKey, ECDSA_P256_SHA256_FIXED};

    fn b64(s: &str) -> Vec<u8> {
        B64.decode(s).unwrap()
    }

    pub(crate) fn push_db() -> Connection {
        crate::mobile::auth::test_db()
    }

    /// RFC 8291 Appendix A / §5: every intermediate value and the final body.
    #[test]
    fn rfc8291_known_answer() {
        let ua_public = b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4");
        let as_public = b64("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
        let auth_secret = b64("BTBZMqHH6r4Tts7J_aSIgg");
        let ecdh_secret = b64("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs");
        let salt: [u8; 16] = b64("DGv6ra1nlYgDCS1FRnbzlw").try_into().unwrap();
        let plaintext = b"When I grow up, I want to be a watermelon";

        let keys = derive_keys(&ua_public, &as_public, &auth_secret, &ecdh_secret, &salt).unwrap();
        assert_eq!(B64.encode(keys.cek), "oIhVW04MRdy2XN9CiKLxTg");
        assert_eq!(B64.encode(keys.nonce), "4h_95klXJ5E_qnoN");

        let body = encrypt_body(
            &ua_public,
            &as_public,
            &auth_secret,
            &ecdh_secret,
            &salt,
            plaintext,
        )
        .unwrap();
        assert_eq!(
            B64.encode(&body),
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
        );
    }

    #[test]
    fn ecdh_is_symmetric_and_rejects_bad_keys() {
        let rng = SystemRandom::new();
        let ua = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng).unwrap();
        let ua_pub = ua.compute_public_key().unwrap().as_ref().to_vec();
        let (as_pub, secret) = ecdh(&ua_pub).unwrap();
        let back = agreement::agree_ephemeral(
            ua,
            &agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, &as_pub),
            |s| s.to_vec(),
        )
        .unwrap();
        assert_eq!(secret, back);
        assert!(ecdh(&[4u8; 65]).is_err());
    }

    #[test]
    fn vapid_key_is_stored_once_and_signs_verifiable_jwt() {
        let conn = push_db();
        let a = load_vapid(&conn).unwrap();
        let b = load_vapid(&conn).unwrap();
        assert_eq!(a.public, b.public, "generated once, then reused");
        assert_eq!(a.public.len(), 65);
        assert_eq!(a.public[0], 0x04);

        let auth = a
            .authorization("https://fcm.googleapis.com/fcm/send/abc", 1_000_000)
            .unwrap();
        let rest = auth.strip_prefix("vapid t=").unwrap();
        let (jwt, k) = rest.split_once(", k=").unwrap();
        assert_eq!(k, a.public_b64());
        let mut parts = jwt.split('.');
        let (h, c, s) = (
            parts.next().unwrap(),
            parts.next().unwrap(),
            parts.next().unwrap(),
        );
        assert_eq!(
            String::from_utf8(b64(h)).unwrap(),
            r#"{"typ":"JWT","alg":"ES256"}"#
        );
        let claims: Value = serde_json::from_slice(&b64(c)).unwrap();
        assert_eq!(claims["aud"], "https://fcm.googleapis.com");
        assert_eq!(claims["exp"], 1_000_000 + VAPID_TTL_SECS);
        assert!(claims["sub"].as_str().unwrap().starts_with("mailto:"));
        UnparsedPublicKey::new(&ECDSA_P256_SHA256_FIXED, &a.public)
            .verify(format!("{h}.{c}").as_bytes(), &b64(s))
            .expect("valid ES256 signature");
    }

    fn good_keys() -> (String, String) {
        let rng = SystemRandom::new();
        let k = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng).unwrap();
        (
            B64.encode(k.compute_public_key().unwrap().as_ref()),
            B64.encode([7u8; 16]),
        )
    }

    #[test]
    fn subscription_validation_and_ssrf_allowlist() {
        let (p, a) = good_keys();
        let ok = "https://fcm.googleapis.com/fcm/send/x";
        assert!(validate_subscription(ok, &p, &a, "dev").is_ok());
        assert!(validate_subscription(
            "https://updates.push.services.mozilla.com/wpush/v2/x",
            &p,
            &a,
            "d"
        )
        .is_ok());
        assert!(validate_subscription("https://web.push.apple.com/Q", &p, &a, "d").is_ok());
        assert!(
            validate_subscription("https://wns2-par02p.notify.windows.com/w", &p, &a, "d").is_ok()
        );
        for bad in [
            "http://fcm.googleapis.com/x",
            "https://127.0.0.1/x",
            "https://localhost/x",
            "https://evilfcm.googleapis.com.example.com/x",
            "https://notfcm.googleapisx.com/x",
            "https://user:pw@fcm.googleapis.com/x",
            "https://fcm.googleapis.com:8443/x",
            "https://192.168.1.2/x",
            "not a url",
        ] {
            assert!(validate_subscription(bad, &p, &a, "d").is_err(), "{bad}");
        }
        assert!(validate_subscription(ok, "AAAA", &a, "d").is_err());
        assert!(validate_subscription(ok, &p, "AAAA", "d").is_err());
        // Padded base64 from some clients is canonicalised.
        let padded = format!("{a}==");
        assert_eq!(validate_subscription(ok, &p, &padded, "d").unwrap().auth, a);
    }

    fn pair_device(conn: &Connection, hash: &str) {
        conn.execute(
            "INSERT INTO mobile_devices(token_hash, name, created_at) VALUES(?1, 'p', 'x')",
            [hash],
        )
        .unwrap();
    }

    #[test]
    fn subscription_store_crud_scoping_and_cap() {
        let conn = push_db();
        pair_device(&conn, "dev1");
        pair_device(&conn, "dev2");
        let (p, a) = good_keys();
        let sub = |i: usize, dev: &str| {
            validate_subscription(
                &format!("https://fcm.googleapis.com/fcm/send/{i}"),
                &p,
                &a,
                dev,
            )
            .unwrap()
        };
        save_subscription(&conn, &sub(1, "dev1"), "t1").unwrap();
        save_subscription(&conn, &sub(1, "dev1"), "t1").unwrap(); // upsert, no duplicate
        save_subscription(&conn, &sub(2, "dev2"), "t2").unwrap();
        assert_eq!(list_subscriptions(&conn, None).len(), 2);
        assert_eq!(list_subscriptions(&conn, Some("dev1")).len(), 1);

        // A device cannot remove another device's subscription.
        assert_eq!(
            remove_subscription(&conn, &sub(2, "dev2").endpoint, "dev1"),
            0
        );
        assert_eq!(
            remove_subscription(&conn, &sub(2, "dev2").endpoint, "dev2"),
            1
        );
        assert_eq!(list_subscriptions(&conn, None).len(), 1);

        // Revoked (unpaired) devices stop receiving pushes.
        conn.execute("DELETE FROM mobile_devices WHERE token_hash = 'dev1'", [])
            .unwrap();
        assert!(list_subscriptions(&conn, None).is_empty());

        // Per-device cap keeps the newest.
        pair_device(&conn, "dev3");
        for i in 0..(MAX_PER_DEVICE as usize + 3) {
            save_subscription(&conn, &sub(100 + i, "dev3"), &format!("t{i:03}")).unwrap();
        }
        let kept = list_subscriptions(&conn, Some("dev3"));
        assert_eq!(kept.len(), MAX_PER_DEVICE as usize);
        assert!(kept.iter().all(|s| !s.endpoint.ends_with("/100")));
    }

    #[test]
    fn classify_covers_attention_transitions_only() {
        use SessionStatus::*;
        assert_eq!(classify(Working, AwaitingApproval), Some(Kind::Approval));
        assert_eq!(classify(Working, AwaitingAnswer), Some(Kind::Question));
        assert_eq!(classify(Working, Error), Some(Kind::Error));
        assert_eq!(classify(Working, Review), Some(Kind::Done));
        assert_eq!(classify(Idle, Review), None, "not a finished turn");
        assert_eq!(classify(Working, Idle), None);
        assert_eq!(classify(Review, Working), None);
    }

    #[test]
    fn payload_links_to_the_session() {
        let p = payload(
            Kind::Approval,
            "s1",
            "#3 修复",
            "Allow tool: bash\nCommand: ls",
        );
        assert_eq!(p["url"], "#/s/s1");
        assert_eq!(p["tag"], "s1");
        assert!(p["title"].as_str().unwrap().contains("需要审批"));
        let empty = payload(Kind::Done, "s1", "x", "  ");
        assert!(empty["body"].as_str().unwrap().contains("完成"));
    }

    #[tokio::test]
    async fn notify_encrypts_skips_live_devices_and_prunes_gone_endpoints() {
        let conn = push_db();
        pair_device(&conn, "live");
        pair_device(&conn, "away");
        let (p, a) = good_keys();
        for (i, dev) in [(1, "live"), (2, "away"), (3, "away")] {
            let s = validate_subscription(
                &format!("https://fcm.googleapis.com/fcm/send/{i}"),
                &p,
                &a,
                dev,
            )
            .unwrap();
            save_subscription(&conn, &s, &format!("t{i}")).unwrap();
        }
        let db = Mutex::new(conn);
        let _guard = SseGuard::new("live".into());
        update_presence("live", Some("s1".into()), true);

        let seen = Mutex::new(Vec::<(String, usize, String)>::new());
        let send = |req: PushHttp| {
            seen.lock().push((
                req.endpoint.clone(),
                req.body.len(),
                req.authorization.clone(),
            ));
            let status = if req.endpoint.ends_with("/3") {
                410
            } else {
                201
            };
            async move { Ok::<u16, String>(status) }
        };
        let sum = notify(
            &db,
            None,
            true,
            &json!({"title": "t", "sessionId": "s1"}),
            send,
        )
        .await;
        assert_eq!(
            sum,
            Summary {
                sent: 1,
                removed: 1,
                failed: 0
            }
        );
        let seen = seen.into_inner();
        assert_eq!(
            seen.len(),
            2,
            "the device actively viewing session s1 in foreground is skipped"
        );
        assert!(seen
            .iter()
            .all(|(_, len, auth)| *len > 86 + 16 && auth.starts_with("vapid t=")));
        assert_eq!(
            list_subscriptions(&db.lock(), None).len(),
            2,
            "410 endpoint deleted"
        );

        // `/push/test` style: no live-device filtering, one device.
        let sum = notify(&db, Some("live"), false, &json!({}), |_| async {
            Ok::<u16, String>(201)
        })
        .await;
        assert_eq!(sum.sent, 1);
        // A non-2xx/404/410 answer keeps the subscription.
        let sum = notify(&db, Some("away"), false, &json!({}), |_| async {
            Ok::<u16, String>(500)
        })
        .await;
        assert_eq!((sum.sent, sum.failed), (0, 1));
        assert_eq!(list_subscriptions(&db.lock(), Some("away")).len(), 1);
    }

    #[test]
    fn sse_guard_counts_streams_per_device() {
        let g1 = SseGuard::new("sse-dev".into());
        let g2 = SseGuard::new("sse-dev".into());
        assert!(has_sse_client("sse-dev"));
        drop(g1);
        assert!(has_sse_client("sse-dev"));
        drop(g2);
        assert!(!has_sse_client("sse-dev"));
    }
    #[test]
    fn presence_viewing_session_conditions() {
        clear_presence("dev1");
        assert!(
            !is_viewing_session("dev1", "s1"),
            "no SSE stream, cannot view"
        );

        let _guard = SseGuard::new("dev1".into());
        assert!(
            !is_viewing_session("dev1", "s1"),
            "no presence recorded yet"
        );

        // Background tab
        update_presence("dev1", Some("s1".into()), false);
        assert!(
            !is_viewing_session("dev1", "s1"),
            "background tab should not suppress push"
        );

        // Viewing another session
        update_presence("dev1", Some("s2".into()), true);
        assert!(
            !is_viewing_session("dev1", "s1"),
            "viewing another session should not suppress push"
        );
        assert!(
            is_viewing_session("dev1", "s2"),
            "viewing s2 in foreground suppresses s2 push"
        );

        // Home / null session
        update_presence("dev1", None, true);
        assert!(
            !is_viewing_session("dev1", "s1"),
            "home screen should not suppress session push"
        );

        // Foreground viewing s1
        update_presence("dev1", Some("s1".into()), true);
        assert!(is_viewing_session("dev1", "s1"));

        clear_presence("dev1");
        assert!(!is_viewing_session("dev1", "s1"));
    }

    #[tokio::test]
    async fn notify_sends_to_background_or_different_session() {
        let conn = push_db();
        pair_device(&conn, "bg-dev");
        pair_device(&conn, "diff-dev");
        let (p, a) = good_keys();
        let s1 = validate_subscription("https://fcm.googleapis.com/fcm/send/bg", &p, &a, "bg-dev")
            .unwrap();
        save_subscription(&conn, &s1, "t1").unwrap();
        let s2 = validate_subscription(
            "https://fcm.googleapis.com/fcm/send/diff",
            &p,
            &a,
            "diff-dev",
        )
        .unwrap();
        save_subscription(&conn, &s2, "t2").unwrap();

        let _g1 = SseGuard::new("bg-dev".into());
        let _g2 = SseGuard::new("diff-dev".into());

        // bg-dev is viewing s1 but in background tab
        update_presence("bg-dev", Some("s1".into()), false);
        // diff-dev is in foreground but viewing s2
        update_presence("diff-dev", Some("s2".into()), true);

        let db = Mutex::new(conn);
        let seen = Mutex::new(Vec::<String>::new());
        let send = |req: PushHttp| {
            seen.lock().push(req.endpoint);
            async move { Ok::<u16, String>(201) }
        };

        let sum = notify(
            &db,
            None,
            true,
            &json!({"title": "s1 update", "sessionId": "s1"}),
            send,
        )
        .await;
        assert_eq!(
            sum.sent, 2,
            "both devices receive push because neither is in foreground viewing s1"
        );
    }
}
