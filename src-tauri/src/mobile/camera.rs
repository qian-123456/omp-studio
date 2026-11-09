//! Temporary, deliberately isolated LAN camera receiver. No mobile-workbench routes
//! or credentials are shared with this listener.
use std::{
    io::{Cursor, Write},
    net::{IpAddr, Ipv4Addr},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    body::{to_bytes, Body},
    extract::{Path as RoutePath, Request, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use hyper_util::rt::{TokioIo, TokioTimer};
use image::{ImageFormat, ImageReader};
use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::sync::{watch, Semaphore};
use tower::ServiceExt;
use uuid::Uuid;

const MAX_PHOTO: usize = 20 * 1024 * 1024;
const MAX_TOTAL: usize = 200 * 1024 * 1024;
const MAX_PHOTOS: usize = 20;
const TTL: Duration = Duration::from_secs(600);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const LAN_ERROR: &str = "未找到可用的局域网，请连接 Wi-Fi 或手机热点后重试";

static LIFECYCLE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CURRENT: Mutex<Option<Arc<Session>>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraLink {
    capture_id: String,
    url: String,
    qr_svg: String,
    expires_at: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraPhoto {
    id: String,
    path: String,
    name: String,
    width: u32,
    height: u32,
    state: PhotoState,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum PhotoState {
    Received,
    Attached,
    Failed,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum CaptureState {
    Waiting,
    Connected,
    Expired,
    Stopped,
}

impl CaptureState {
    fn active(self) -> bool {
        matches!(self, Self::Waiting | Self::Connected)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CameraSnapshot {
    capture_id: String,
    state: CaptureState,
    expires_at: String,
    photos: Vec<CameraPhoto>,
}

#[derive(Clone)]
struct StoredPhoto {
    photo: CameraPhoto,
    hash: [u8; 32],
    size: usize,
}

struct SessionData {
    state: CaptureState,
    photos: Vec<StoredPhoto>,
    bytes: usize,
}

struct Session {
    id: String,
    host: String,
    origin: String,
    token_hash: [u8; 32],
    expires_at: String,
    deadline: Instant,
    language: &'static str,
    lan_ip: Option<Ipv4Addr>,
    route_identity: Option<String>,
    images_dir: PathBuf,
    data: Mutex<SessionData>,
    upload: Arc<Semaphore>,
    shutdown: watch::Sender<bool>,
    closed: watch::Sender<bool>,
}

impl Session {
    // The data lock serializes cancellation with the final file commit.
    fn refresh(&self, data: &mut SessionData) {
        if data.state.active() && Instant::now() >= self.deadline {
            data.state = CaptureState::Expired;
            let _ = self.shutdown.send(true);
        }
    }

    fn finish(&self, state: CaptureState) {
        let mut data = self.data.lock();
        self.refresh(&mut data);
        if data.state.active() {
            data.state = state;
            let _ = self.shutdown.send(true);
        }
    }

    fn active(&self) -> bool {
        let mut data = self.data.lock();
        self.refresh(&mut data);
        data.state.active()
    }

    fn ip_matches(&self) -> bool {
        self.lan_ip
            .is_none_or(|ip| local_ip_address::local_ip().ok() == Some(IpAddr::V4(ip)))
    }

    fn network_matches(&self) -> bool {
        self.ip_matches()
            && self
                .route_identity
                .as_ref()
                .is_none_or(|route| default_route().as_ref() == Some(route))
    }
}

fn lan_ip() -> Result<Ipv4Addr, String> {
    match local_ip_address::local_ip() {
        Ok(IpAddr::V4(ip))
            if ip.is_private()
                && !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast() =>
        {
            Ok(ip)
        }
        _ => Err(LAN_ERROR.into()),
    }
}

// Include the default gateway and interface, not just the address: switching
// between networks can leave the host with the same private IPv4 address.
#[cfg(target_os = "macos")]
fn default_route() -> Option<String> {
    let output = std::process::Command::new("/sbin/route")
        .args(["-n", "get", "default"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let field = |name: &str| {
        text.lines()
            .find_map(|line| line.trim().strip_prefix(name).map(str::trim))
            .map(str::to_owned)
    };
    Some(format!("{}|{}", field("interface:")?, field("gateway:")?))
}

#[cfg(target_os = "linux")]
fn default_route() -> Option<String> {
    let text = std::fs::read_to_string("/proc/net/route").ok()?;
    let mut routes: Vec<String> = text
        .lines()
        .skip(1)
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 8 || fields[1] != "00000000" || fields[7] != "00000000" {
                return None;
            }
            let flags = u32::from_str_radix(fields[3], 16).ok()?;
            if flags & 1 == 0 {
                return None;
            }
            Some(format!("{}|{}|{}", fields[0], fields[2], fields[6]))
        })
        .collect();
    routes.sort_unstable();
    if routes.is_empty() {
        None
    } else {
        Some(routes.join(";"))
    }
}

#[cfg(target_os = "windows")]
fn default_route() -> Option<String> {
    let output = std::process::Command::new("route")
        .args(["print", "-4"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let mut routes: Vec<String> = text
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 5 || fields[0] != "0.0.0.0" || fields[1] != "0.0.0.0" {
                return None;
            }
            Some(fields[..5].join("|"))
        })
        .collect();
    routes.sort_unstable();
    if routes.is_empty() {
        None
    } else {
        Some(routes.join(";"))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn default_route() -> Option<String> {
    None
}

// Dynamic-store notifications report writes, not necessarily changes of
// network. Compare the connection identity instead of revoking on every write.
#[cfg(target_os = "macos")]
struct NetworkNotifications {
    receiver: watch::Receiver<bool>,
    run_loop: system_configuration::core_foundation::runloop::CFRunLoop,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
}

#[cfg(target_os = "macos")]
impl Drop for NetworkNotifications {
    fn drop(&mut self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::Release);
        self.run_loop.stop();
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone)]
struct NetworkIdentity {
    interface: String,
    service: String,
    signature: Option<String>,
    wifi_profile: Option<String>,
}

#[cfg(target_os = "macos")]
struct NetworkSnapshot {
    identity: NetworkIdentity,
    link_active: Option<bool>,
    wifi_present: bool,
}

#[cfg(target_os = "macos")]
fn network_snapshot(
    store: &system_configuration::dynamic_store::SCDynamicStore,
    interface: &str,
) -> Option<NetworkSnapshot> {
    use system_configuration::core_foundation::{
        base::{CFType, TCFType},
        boolean::CFBoolean,
        dictionary::CFDictionary,
        string::CFString,
    };

    fn dictionary(
        store: &system_configuration::dynamic_store::SCDynamicStore,
        key: &str,
    ) -> Option<CFDictionary<CFString, CFType>> {
        let dict: CFDictionary = store.get(key)?.downcast_into()?;
        // Property-list dictionaries have CFString keys and CFType values.
        Some(unsafe { CFDictionary::wrap_under_get_rule(dict.as_concrete_TypeRef()) })
    }
    fn string(dict: &CFDictionary<CFString, CFType>, key: &str) -> Option<String> {
        dict.find(CFString::new(key))?
            .downcast::<CFString>()
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty())
    }

    let global = dictionary(store, "State:/Network/Global/IPv4")?;
    let primary_interface = string(&global, "PrimaryInterface")?;
    let service = string(&global, "PrimaryService")?;
    let ipv4 = dictionary(store, &format!("State:/Network/Service/{service}/IPv4"));
    let wifi = dictionary(
        store,
        &format!("State:/Network/Interface/{interface}/AirPort"),
    );
    let link = dictionary(store, &format!("State:/Network/Interface/{interface}/Link"));
    Some(NetworkSnapshot {
        identity: NetworkIdentity {
            interface: primary_interface,
            service,
            signature: ipv4
                .as_ref()
                .and_then(|dict| string(dict, "NetworkSignature")),
            wifi_profile: wifi.as_ref().and_then(|dict| string(dict, "ProfileID")),
        },
        link_active: link.as_ref().and_then(|dict| {
            dict.find(CFString::new("Active"))?
                .downcast::<CFBoolean>()
                .map(bool::from)
        }),
        wifi_present: wifi.is_some(),
    })
}

#[cfg(target_os = "macos")]
fn network_identity_changed(baseline: &NetworkIdentity, current: &NetworkSnapshot) -> bool {
    // AirPort can omit its profile during a dictionary rewrite even while
    // associated. Compare later values with the original, not that snapshot.
    let identity = &current.identity;
    current.link_active == Some(false)
        || identity.interface != baseline.interface
        || identity.service != baseline.service
        || matches!((&baseline.signature, &identity.signature), (Some(a), Some(b)) if a != b)
        || matches!((&baseline.wifi_profile, &identity.wifi_profile), (Some(a), Some(b)) if a != b)
}

#[cfg(target_os = "macos")]
fn network_identity_unavailable(baseline: &NetworkIdentity, current: &NetworkSnapshot) -> bool {
    (baseline.signature.is_some() && current.identity.signature.is_none())
        || (baseline.wifi_profile.is_some() && current.identity.wifi_profile.is_none())
}

#[cfg(target_os = "macos")]
struct NetworkWatch {
    baseline: NetworkIdentity,
    changed: watch::Sender<bool>,
}

#[cfg(target_os = "macos")]
impl NetworkWatch {
    fn observe(&self, current: Option<&NetworkSnapshot>) {
        if current.is_none_or(|current| network_identity_changed(&self.baseline, current)) {
            self.changed.send_replace(true);
        }
    }
}

#[cfg(target_os = "macos")]
fn network_store_changed(
    store: system_configuration::dynamic_store::SCDynamicStore,
    _: system_configuration::core_foundation::array::CFArray<
        system_configuration::core_foundation::string::CFString,
    >,
    watch: &mut NetworkWatch,
) {
    let current = network_snapshot(&store, &watch.baseline.interface);
    watch.observe(current.as_ref());
}

#[cfg(target_os = "macos")]
async fn network_notifications(interface: String) -> Result<NetworkNotifications, String> {
    use system_configuration::core_foundation::{
        array::CFArray,
        runloop::{kCFRunLoopDefaultMode, CFRunLoop},
        string::CFString,
    };
    use system_configuration::dynamic_store::{
        SCDynamicStoreBuilder, SCDynamicStoreCallBackContext,
    };

    let (changed, receiver) = watch::channel(false);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let cancelled = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let thread_cancelled = cancelled.clone();
    std::thread::Builder::new()
        .name("camera-network-watch".into())
        .spawn(move || {
            let Some(snapshot_store) =
                SCDynamicStoreBuilder::new("omp camera network identity").build()
            else {
                let _ = ready_tx.send(None);
                return;
            };
            let Some(initial) = network_snapshot(&snapshot_store, &interface) else {
                let _ = ready_tx.send(None);
                return;
            };
            if initial.identity.interface != interface
                || initial.link_active == Some(false)
                || (initial.wifi_present && initial.identity.wifi_profile.is_none())
                || (initial.identity.signature.is_none() && initial.identity.wifi_profile.is_none())
            {
                let _ = ready_tx.send(None);
                return;
            }
            let baseline = initial.identity;
            let callback = SCDynamicStoreCallBackContext {
                callout: network_store_changed,
                info: NetworkWatch {
                    baseline: baseline.clone(),
                    changed: changed.clone(),
                },
            };
            let Some(store) = SCDynamicStoreBuilder::new("omp camera network watch")
                .callback_context(callback)
                .build()
            else {
                let _ = ready_tx.send(None);
                return;
            };
            let keys = CFArray::from_CFTypes(&[
                CFString::new("State:/Network/Global/IPv4"),
                CFString::new(&format!("State:/Network/Interface/{interface}/Link")),
                CFString::new(&format!("State:/Network/Interface/{interface}/AirPort")),
                CFString::new(&format!("State:/Network/Service/{}/IPv4", baseline.service)),
            ]);
            let patterns = CFArray::<CFString>::from_CFTypes(&[]);
            if !store.set_notification_keys(&keys, &patterns) {
                let _ = ready_tx.send(None);
                return;
            }
            if network_snapshot(&store, &interface).is_none_or(|current| {
                network_identity_changed(&baseline, &current)
                    || network_identity_unavailable(&baseline, &current)
            }) {
                let _ = ready_tx.send(None);
                return;
            }
            let Some(source) = store.create_run_loop_source() else {
                let _ = ready_tx.send(None);
                return;
            };
            let run_loop = CFRunLoop::get_current();
            run_loop.add_source(&source, unsafe { kCFRunLoopDefaultMode });
            if ready_tx.send(Some(run_loop)).is_err() {
                return;
            }
            // Recheck even if callbacks keep arriving. A transient dictionary
            // rewrite can omit fields, but persistently missing identity fails closed.
            let mut next_check = Instant::now() + Duration::from_secs(1);
            while !thread_cancelled.load(std::sync::atomic::Ordering::Acquire) && !*changed.borrow()
            {
                if matches!(
                CFRunLoop::run_in_mode(
                    unsafe { kCFRunLoopDefaultMode },
                    next_check.saturating_duration_since(Instant::now()),
                    true,
                ),
                system_configuration::core_foundation::runloop::CFRunLoopRunResult::Finished
                    | system_configuration::core_foundation::runloop::CFRunLoopRunResult::Stopped
            ) {
                    break;
                }
                if Instant::now() >= next_check {
                    if network_snapshot(&store, &interface).is_none_or(|current| {
                        network_identity_changed(&baseline, &current)
                            || network_identity_unavailable(&baseline, &current)
                    }) {
                        changed.send_replace(true);
                        break;
                    }
                    next_check = Instant::now() + Duration::from_secs(1);
                }
            }
            if !thread_cancelled.load(std::sync::atomic::Ordering::Acquire) {
                changed.send_replace(true);
            }
        })
        .map_err(|_| LAN_ERROR.to_string())?;
    let run_loop = ready_rx
        .await
        .map_err(|_| LAN_ERROR.to_string())?
        .ok_or(LAN_ERROR)?;
    Ok(NetworkNotifications {
        receiver,
        run_loop,
        cancelled,
    })
}

// A stopped capture remains available for renewal until another capture replaces it.
async fn prepare_previous(
    previous: Option<Arc<Session>>,
    resume_capture_id: Option<&str>,
) -> Result<Option<(String, SessionData)>, String> {
    let Some(previous) = previous else {
        return if resume_capture_id.is_some() {
            Err("拍照连接不存在，无法重新连接".into())
        } else {
            Ok(None)
        };
    };
    if previous.active() {
        return Err("已有拍照连接，请先结束".into());
    }
    if resume_capture_id.is_some_and(|id| id != previous.id) {
        return Err("拍照连接不存在，无法重新连接".into());
    }

    // A blocking decoder can outlive its connection task; wait for both before
    // copying receipts or reusing the listener port.
    let _permit = previous.upload.acquire().await.map_err(|e| e.to_string())?;
    let mut closed = previous.closed.subscribe();
    if !*closed.borrow() {
        closed.changed().await.map_err(|e| e.to_string())?;
    }
    if resume_capture_id.is_none() {
        return Ok(None);
    }
    let data = previous.data.lock();
    Ok(Some((
        previous.id.clone(),
        SessionData {
            state: CaptureState::Waiting,
            photos: data.photos.clone(),
            bytes: data.bytes,
        },
    )))
}

async fn bind_camera_listener(
    ip: Ipv4Addr,
    data_dir: &Path,
) -> Result<tokio::net::TcpListener, String> {
    let port_path = data_dir.join("camera-port");
    let bind_saved = |port| async move {
        tokio::net::TcpListener::bind((ip, port))
            .await
            .map_err(|e| format!("无法启动拍照服务，端口 {port} 不可用: {e}"))
    };
    let read_port = || -> Result<Option<u16>, String> {
        let contents = match std::fs::read_to_string(&port_path) {
            Ok(contents) => contents,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("无法读取拍照端口: {e}")),
        };
        let value = contents.trim();
        let port = value
            .bytes()
            .all(|b| b.is_ascii_digit())
            .then(|| value.parse::<u16>().ok())
            .flatten()
            .filter(|port| *port != 0)
            .ok_or_else(|| "保存的拍照端口无效".to_string())?;
        Ok(Some(port))
    };
    if let Some(port) = read_port()? {
        return bind_saved(port).await;
    }

    std::fs::create_dir_all(data_dir).map_err(|e| format!("无法保存拍照端口: {e}"))?;
    let listener = bind_saved(0).await?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let temp = data_dir.join(format!(".camera-port-{}.tmp", Uuid::new_v4()));
    let result = write_temporary(&temp, port.to_string().as_bytes())
        .and_then(|()| std::fs::hard_link(&temp, &port_path));
    let _ = std::fs::remove_file(&temp);
    match result {
        Ok(()) => Ok(listener),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            drop(listener);
            let port = read_port()?.ok_or("保存的拍照端口不存在")?;
            bind_saved(port).await
        }
        Err(e) => Err(format!("无法保存拍照端口: {e}")),
    }
}

pub async fn start(
    language: Option<String>,
    resume_capture_id: Option<String>,
) -> Result<CameraLink, String> {
    let language = match language.as_deref() {
        None | Some("zh-CN") => "zh-CN",
        Some("en-US") => "en-US",
        Some(_) => return Err("不支持的语言".into()),
    };
    let _lifecycle = LIFECYCLE.lock().await;
    let previous = CURRENT.lock().clone();
    let resumed = prepare_previous(previous, resume_capture_id.as_deref()).await?;
    let ip = lan_ip()?;
    let route_identity = tokio::task::spawn_blocking(default_route)
        .await
        .map_err(|_| LAN_ERROR.to_string())?
        .ok_or(LAN_ERROR)?;
    #[cfg(target_os = "macos")]
    let notifications = {
        let interface = route_identity
            .split('|')
            .next()
            .filter(|name| !name.is_empty())
            .ok_or(LAN_ERROR)?;
        let notifications = network_notifications(interface.to_owned()).await?;
        let current = tokio::task::spawn_blocking(default_route)
            .await
            .map_err(|_| LAN_ERROR.to_string())?;
        if current.as_deref() != Some(route_identity.as_str())
            || lan_ip()? != ip
            || *notifications.receiver.borrow()
        {
            return Err(LAN_ERROR.into());
        }
        notifications
    };
    let listener = bind_camera_listener(ip, &crate::paths::data_dir()).await?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let host = format!("{ip}:{port}");
    let origin = format!("http://{host}");
    let mut secret = [0_u8; 32];
    getrandom::fill(&mut secret).map_err(|e| format!("无法生成拍照令牌: {e}"))?;
    let token = URL_SAFE_NO_PAD.encode(secret);
    let url = format!("{origin}/camera#token={token}");
    let qr_svg = super::qr_svg(&url)?;
    let (shutdown, receiver) = watch::channel(false);
    let (closed, _) = watch::channel(false);
    let (id, data) = resumed.unwrap_or_else(|| {
        (
            Uuid::new_v4().to_string(),
            SessionData {
                state: CaptureState::Waiting,
                photos: Vec::new(),
                bytes: 0,
            },
        )
    });
    let session = Arc::new(Session {
        id,
        host,
        origin,
        token_hash: Sha256::digest(token.as_bytes()).into(),
        expires_at: (chrono::Utc::now() + chrono::Duration::minutes(10))
            .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        deadline: Instant::now() + TTL,
        language,
        lan_ip: Some(ip),
        route_identity: Some(route_identity),
        images_dir: crate::paths::images_dir(),
        data: Mutex::new(data),
        upload: Arc::new(Semaphore::new(1)),
        shutdown,
        closed,
    });
    let link = CameraLink {
        capture_id: session.id.clone(),
        url,
        qr_svg,
        expires_at: session.expires_at.clone(),
    };
    *CURRENT.lock() = Some(session.clone());
    tokio::spawn(run_server(listener, session.clone(), receiver));
    #[cfg(target_os = "macos")]
    tokio::spawn(async move {
        monitor(session, notifications.receiver.clone()).await;
        drop(notifications);
    });
    #[cfg(not(target_os = "macos"))]
    tokio::spawn(async move {
        let (_sender, receiver) = watch::channel(false);
        monitor(session, receiver).await;
    });
    Ok(link)
}

async fn monitor(session: Arc<Session>, mut network_changed: watch::Receiver<bool>) {
    let mut shutdown = session.shutdown.subscribe();
    loop {
        if *shutdown.borrow() {
            break;
        }
        if *network_changed.borrow() {
            session.finish(CaptureState::Stopped);
            break;
        }
        tokio::select! {
            _ = shutdown.changed() => break,
            _ = network_changed.changed() => {
                session.finish(CaptureState::Stopped);
                break;
            },
            _ = tokio::time::sleep(Duration::from_secs(2)) => {
                if !session.active() { break; }
                let check_session = session.clone();
                if !tokio::task::spawn_blocking(move || check_session.network_matches()).await.unwrap_or(false) {
                    session.finish(CaptureState::Stopped);
                    break;
                }
            }
        }
    }
}

async fn run_server(
    listener: tokio::net::TcpListener,
    session: Arc<Session>,
    shutdown: watch::Receiver<bool>,
) {
    run_server_with_timeout(listener, session, shutdown, REQUEST_TIMEOUT).await;
}

async fn run_server_with_timeout(
    listener: tokio::net::TcpListener,
    session: Arc<Session>,
    mut shutdown: watch::Receiver<bool>,
    header_timeout: Duration,
) {
    let app = router(session.clone());
    let mut tasks = tokio::task::JoinSet::new();
    let connections = Arc::new(Semaphore::new(32));
    // The HTTP/1 builder starts its header timer immediately, unlike the
    // auto-detect builder which can wait forever before choosing a protocol.
    let mut builder = hyper::server::conn::http1::Builder::new();
    builder
        .timer(TokioTimer::new())
        .header_read_timeout(header_timeout);
    loop {
        if *shutdown.borrow() {
            break;
        }
        tokio::select! {
            _ = shutdown.changed() => break,
            Some(_) = tasks.join_next(), if !tasks.is_empty() => {},
            accepted = listener.accept() => {
                let Ok((stream, _)) = accepted else {
                    session.finish(CaptureState::Stopped);
                    break;
                };
                let Ok(permit) = connections.clone().try_acquire_owned() else { continue; };
                let app = app.clone();
                let builder = builder.clone();
                tasks.spawn(async move {
                    let _permit = permit;
                    let service = hyper::service::service_fn(move |request: hyper::Request<hyper::body::Incoming>| {
                        app.clone().oneshot(request.map(Body::new))
                    });
                    let _ = builder.serve_connection(TokioIo::new(stream), service).await;
                });
            }
        }
    }
    drop(listener);
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    session.closed.send_replace(true);
}

fn find_session(capture_id: &str) -> Result<Arc<Session>, String> {
    CURRENT
        .lock()
        .as_ref()
        .filter(|s| s.id == capture_id)
        .cloned()
        .ok_or_else(|| "拍照连接不存在".into())
}

pub async fn poll(capture_id: String) -> Result<CameraSnapshot, String> {
    let session = find_session(&capture_id)?;
    if !session.ip_matches() {
        session.finish(CaptureState::Stopped);
    }
    let mut data = session.data.lock();
    session.refresh(&mut data);
    Ok(CameraSnapshot {
        capture_id,
        state: data.state,
        expires_at: session.expires_at.clone(),
        photos: data.photos.iter().map(|p| p.photo.clone()).collect(),
    })
}

pub async fn ack(
    capture_id: String,
    photo_id: String,
    error: Option<String>,
) -> Result<(), String> {
    let session = find_session(&capture_id)?;
    if !session.ip_matches() {
        session.finish(CaptureState::Stopped);
    }
    let mut data = session.data.lock();
    session.refresh(&mut data);
    if !data.state.active() {
        return Err("拍照连接已结束".into());
    }
    let photo = data
        .photos
        .iter_mut()
        .find(|p| p.photo.id == photo_id)
        .ok_or("照片不存在")?;
    // A delayed failure must not undo a successful acknowledgement.
    if photo.photo.state != PhotoState::Attached {
        photo.photo.state = if error.is_some() {
            PhotoState::Failed
        } else {
            PhotoState::Attached
        };
        photo.photo.error = error;
    }
    Ok(())
}

pub async fn stop(capture_id: String) -> Result<(), String> {
    let _lifecycle = LIFECYCLE.lock().await;
    let session = CURRENT
        .lock()
        .as_ref()
        .filter(|s| s.id == capture_id)
        .cloned();
    if let Some(session) = session {
        stop_session(&session).await?;
    }
    Ok(())
}

async fn stop_session(session: &Session) -> Result<(), String> {
    session.finish(CaptureState::Stopped);
    // Blocking decoders own this permit until their final cancellation check.
    let _permit = session.upload.acquire().await.map_err(|e| e.to_string())?;
    let mut closed = session.closed.subscribe();
    if !*closed.borrow() {
        let _ = closed.changed().await;
    }
    Ok(())
}

fn router(session: Arc<Session>) -> Router {
    Router::new()
        .route("/camera", get(page))
        .route("/camera.js", get(script))
        .route("/camera-qr.js", get(qr_decoder))
        .route("/camera.css", get(styles))
        .route("/camera/status", get(status))
        .route("/camera/photos/{photo_id}", post(upload))
        .layer(middleware::from_fn_with_state(session.clone(), guard))
        .with_state(session)
}

async fn guard(State(session): State<Arc<Session>>, request: Request, next: Next) -> Response {
    let valid_host = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        == Some(session.host.as_str());
    let dynamic = request.uri().path() == "/camera/status"
        || request.uri().path().starts_with("/camera/photos/");
    let response = if !valid_host {
        StatusCode::BAD_REQUEST.into_response()
    } else if dynamic {
        let token = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "));
        let authorized = token.is_some_and(|token| {
            let hash: [u8; 32] = Sha256::digest(token.as_bytes()).into();
            hash.iter()
                .zip(session.token_hash)
                .fold(0u8, |diff, (a, b)| diff | (a ^ b))
                == 0
        });
        if !authorized {
            StatusCode::UNAUTHORIZED.into_response()
        } else if !session.ip_matches() {
            session.finish(CaptureState::Stopped);
            StatusCode::GONE.into_response()
        } else if !session.active() {
            StatusCode::GONE.into_response()
        } else if request.method() != axum::http::Method::GET
            && request
                .headers()
                .get(header::ORIGIN)
                .and_then(|v| v.to_str().ok())
                != Some(session.origin.as_str())
        {
            StatusCode::FORBIDDEN.into_response()
        } else {
            next.run(request).await
        }
    } else {
        next.run(request).await
    };
    secure_headers(response)
}

fn secure_headers(mut response: Response) -> Response {
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"));
    response
}

async fn page(State(session): State<Arc<Session>>) -> impl IntoResponse {
    let page = include_str!("camera-web/index.html");
    let html = if session.language == "en-US" {
        page.replace("lang=\"zh-CN\"", "lang=\"en-US\"")
    } else {
        page.to_owned()
    };
    ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html)
}
async fn script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("camera-web/camera.js"),
    )
}
async fn qr_decoder() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        include_str!("camera-web/vendor/jsQR-1.4.0.js"),
    )
}
async fn styles() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("camera-web/camera.css"),
    )
}

#[derive(Serialize)]
struct PhonePhoto<'a> {
    id: &'a str,
    state: PhotoState,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhoneStatus<'a> {
    capture_id: &'a str,
    expires_at: &'a str,
    state: CaptureState,
    photos: Vec<PhonePhoto<'a>>,
}

async fn status(State(session): State<Arc<Session>>) -> Response {
    let mut data = session.data.lock();
    session.refresh(&mut data);
    if !data.state.active() {
        return StatusCode::GONE.into_response();
    }
    data.state = CaptureState::Connected;
    let error_message = if session.language == "en-US" {
        "Could not add the photo; retry on the computer."
    } else {
        "无法加入照片，请在电脑上重试。"
    };
    Json(PhoneStatus {
        capture_id: &session.id,
        expires_at: &session.expires_at,
        state: data.state,
        photos: data
            .photos
            .iter()
            .map(|p| PhonePhoto {
                id: &p.photo.id,
                state: p.photo.state,
                error: p.photo.error.as_ref().map(|_| error_message),
            })
            .collect(),
    })
    .into_response()
}

#[derive(Serialize)]
struct UploadResult {
    id: String,
    state: PhotoState,
}

type UploadError = (StatusCode, String);
fn upload_error(status: StatusCode, message: impl Into<String>) -> UploadError {
    (status, message.into())
}

async fn upload(
    State(session): State<Arc<Session>>,
    RoutePath(photo_id): RoutePath<String>,
    request: Request<Body>,
) -> Response {
    let result =
        tokio::time::timeout(REQUEST_TIMEOUT, upload_inner(session, photo_id, request)).await;
    match result {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err(error)) => error.into_response(),
        Err(_) => StatusCode::REQUEST_TIMEOUT.into_response(),
    }
}

async fn upload_inner(
    session: Arc<Session>,
    photo_id: String,
    request: Request<Body>,
) -> Result<UploadResult, UploadError> {
    let id = Uuid::parse_str(&photo_id)
        .map_err(|_| upload_error(StatusCode::BAD_REQUEST, "无效的照片编号"))?
        .to_string();
    let permit = session
        .upload
        .clone()
        .try_acquire_owned()
        .map_err(|_| upload_error(StatusCode::TOO_MANY_REQUESTS, "正在接收另一张照片"))?;
    if request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .is_some_and(|n| n > MAX_PHOTO as u64)
    {
        return Err(upload_error(StatusCode::PAYLOAD_TOO_LARGE, "照片过大"));
    }
    let declared_format = match request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim())
    {
        Some("image/jpeg") => ImageFormat::Jpeg,
        Some("image/png") => ImageFormat::Png,
        _ => {
            return Err(upload_error(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "只支持 JPEG 或 PNG 图片",
            ))
        }
    };
    let bytes = to_bytes(request.into_body(), MAX_PHOTO)
        .await
        .map_err(|_| upload_error(StatusCode::PAYLOAD_TOO_LARGE, "照片过大或读取失败"))?;
    let worker = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        save_photo(&session, id, &bytes, declared_format)
    });
    worker.await.map_err(|e| {
        upload_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("保存照片失败: {e}"),
        )
    })?
}

fn save_photo(
    session: &Session,
    id: String,
    bytes: &[u8],
    declared_format: ImageFormat,
) -> Result<UploadResult, UploadError> {
    let hash: [u8; 32] = Sha256::digest(bytes).into();
    {
        let mut data = session.data.lock();
        session.refresh(&mut data);
        if !data.state.active() {
            return Err(upload_error(StatusCode::GONE, "拍照连接已结束"));
        }
        if let Some(existing) = data.photos.iter().find(|p| p.photo.id == id) {
            return if existing.hash == hash && existing.size == bytes.len() {
                if image::guess_format(bytes).ok() != Some(declared_format) {
                    Err(upload_error(
                        StatusCode::UNSUPPORTED_MEDIA_TYPE,
                        "图片类型与内容不符",
                    ))
                } else {
                    Ok(UploadResult {
                        id,
                        state: existing.photo.state,
                    })
                }
            } else {
                Err(upload_error(StatusCode::CONFLICT, "照片编号已用于不同内容"))
            };
        }
        if data.photos.len() >= MAX_PHOTOS || data.bytes.saturating_add(bytes.len()) > MAX_TOTAL {
            return Err(upload_error(
                StatusCode::TOO_MANY_REQUESTS,
                "本次连接的照片数量或总大小已达上限",
            ));
        }
    }
    let format = image::guess_format(bytes).map_err(|_| {
        upload_error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "只支持 JPEG 或 PNG 图片",
        )
    })?;
    if format != declared_format {
        return Err(upload_error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "图片类型与内容不符",
        ));
    }
    let extension = match format {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
        _ => {
            return Err(upload_error(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "只支持 JPEG 或 PNG 图片",
            ))
        }
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| upload_error(StatusCode::UNPROCESSABLE_ENTITY, "图片损坏或超过解码限制"))?;
    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 20_000_000 {
        return Err(upload_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "图片尺寸超出限制",
        ));
    }
    drop(image);
    std::fs::create_dir_all(&session.images_dir).map_err(storage_error)?;
    let name = format!("{}.{}", Uuid::new_v4(), extension);
    let path = session.images_dir.join(&name);
    let temp = session
        .images_dir
        .join(format!(".camera-{}.tmp", Uuid::new_v4()));
    let write_result = write_temporary(&temp, bytes);
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp);
        return Err(storage_error(error));
    }
    let network_matches = session.network_matches();
    let mut data = session.data.lock();
    session.refresh(&mut data);
    if !data.state.active() || !network_matches {
        if data.state.active() {
            data.state = CaptureState::Stopped;
            let _ = session.shutdown.send(true);
        }
        let _ = std::fs::remove_file(&temp);
        return Err(upload_error(StatusCode::GONE, "拍照连接已结束"));
    }
    // A hard link commits without replacing any existing image, even on collision.
    if let Err(error) = std::fs::hard_link(&temp, &path) {
        let _ = std::fs::remove_file(&temp);
        return Err(storage_error(error));
    }
    let _ = std::fs::remove_file(&temp);
    let photo = CameraPhoto {
        id: id.clone(),
        path: path.to_string_lossy().into_owned(),
        name,
        width,
        height,
        state: PhotoState::Received,
        error: None,
    };
    data.bytes += bytes.len();
    data.photos.push(StoredPhoto {
        photo,
        hash,
        size: bytes.len(),
    });
    Ok(UploadResult {
        id,
        state: PhotoState::Received,
    })
}

fn write_temporary(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}
fn storage_error(error: std::io::Error) -> UploadError {
    upload_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("保存照片失败: {error}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Bytes;
    use futures_util::stream;
    use image::{DynamicImage, GrayImage};
    use tokio::sync::oneshot;

    const TOKEN: &str = "test-secret";

    fn make_session(host: String, deadline: Instant, closed: bool) -> Arc<Session> {
        let (shutdown, _) = watch::channel(false);
        let (closed_tx, _) = watch::channel(closed);
        Arc::new(Session {
            id: Uuid::new_v4().to_string(),
            origin: format!("http://{host}"),
            host,
            token_hash: Sha256::digest(TOKEN.as_bytes()).into(),
            expires_at: chrono::Utc::now().to_rfc3339(),
            deadline,
            language: "en-US",
            lan_ip: None,
            route_identity: None,
            images_dir: std::env::temp_dir().join(format!("omp-camera-test-{}", Uuid::new_v4())),
            data: Mutex::new(SessionData {
                state: CaptureState::Waiting,
                photos: Vec::new(),
                bytes: 0,
            }),
            upload: Arc::new(Semaphore::new(1)),
            shutdown,
            closed: closed_tx,
        })
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageLuma8(GrayImage::new(width, height))
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn upload_request(session: &Session, id: &str, body: Body) -> Request {
        Request::builder()
            .method("POST")
            .uri(format!("/camera/photos/{id}"))
            .header(header::HOST, &session.host)
            .header(header::ORIGIN, &session.origin)
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .header(header::CONTENT_TYPE, "image/png")
            .body(body)
            .unwrap()
    }

    async fn route(session: &Arc<Session>, request: Request) -> Response {
        router(session.clone()).oneshot(request).await.unwrap()
    }

    #[tokio::test]
    async fn camera_port_is_persisted_and_collision_or_corruption_is_explicit() {
        let dir = std::env::temp_dir().join(format!("omp-camera-port-test-{}", Uuid::new_v4()));
        let ip = Ipv4Addr::LOCALHOST;
        let first = bind_camera_listener(ip, &dir).await.unwrap();
        let port = first.local_addr().unwrap().port();
        assert_ne!(port, 0);
        assert_eq!(
            std::fs::read_to_string(dir.join("camera-port")).unwrap(),
            port.to_string()
        );
        assert!(bind_camera_listener(ip, &dir).await.is_err());
        drop(first);
        let second = bind_camera_listener(ip, &dir).await.unwrap();
        assert_eq!(second.local_addr().unwrap().port(), port);
        drop(second);
        for invalid in ["", "0", "65536", "123x"] {
            std::fs::write(dir.join("camera-port"), invalid).unwrap();
            assert!(bind_camera_listener(ip, &dir).await.is_err());
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn renewal_preserves_receipts_and_rejects_old_token() {
        let host = "127.0.0.1:12345".to_string();
        let previous = make_session(host.clone(), Instant::now() + TTL, true);
        let ids: Vec<_> = (0..3).map(|_| Uuid::new_v4().to_string()).collect();
        let image = png(2, 3);
        for id in &ids {
            assert!(save_photo(&previous, id.clone(), &image, ImageFormat::Png).is_ok());
        }
        {
            let mut data = previous.data.lock();
            data.photos[1].photo.state = PhotoState::Attached;
            data.photos[2].photo.state = PhotoState::Failed;
            data.photos[2].photo.error = Some("attach failed".into());
        }
        assert!(prepare_previous(Some(previous.clone()), Some(&previous.id))
            .await
            .is_err());
        previous.finish(CaptureState::Stopped);
        assert!(prepare_previous(None, Some(&previous.id)).await.is_err());
        assert!(prepare_previous(Some(previous.clone()), Some("other"))
            .await
            .is_err());
        let (id, data) = prepare_previous(Some(previous.clone()), Some(&previous.id))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(id, previous.id);
        assert_eq!(data.photos.len(), 3);
        assert_eq!(data.bytes, image.len() * 3);
        assert!(data.photos[0].photo.state == PhotoState::Received);
        assert!(data.photos[1].photo.state == PhotoState::Attached);
        assert!(data.photos[2].photo.state == PhotoState::Failed);
        assert_eq!(data.photos[2].photo.error.as_deref(), Some("attach failed"));

        let mut renewed = make_session(host.clone(), Instant::now() + TTL, true);
        let session = Arc::get_mut(&mut renewed).unwrap();
        session.id = id;
        session.images_dir = previous.images_dir.clone();
        session.data = Mutex::new(data);
        session.token_hash = Sha256::digest(b"renewed-secret").into();
        let status_request = |token: &str| {
            Request::builder()
                .uri("/camera/status")
                .header(header::HOST, &host)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap()
        };
        assert_eq!(
            route(&renewed, status_request(TOKEN)).await.status(),
            StatusCode::UNAUTHORIZED
        );
        let response = route(&renewed, status_request("renewed-secret")).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let status: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(status["captureId"], previous.id);
        assert_eq!(status["photos"].as_array().unwrap().len(), 3);
        assert_eq!(status["photos"][1]["state"], "attached");
        assert_eq!(status["photos"][2]["state"], "failed");
        assert!(save_photo(&renewed, ids[1].clone(), &image, ImageFormat::Png).is_ok());
        assert!(matches!(
            save_photo(&renewed, ids[1].clone(), &png(3, 2), ImageFormat::Png),
            Err((StatusCode::CONFLICT, _))
        ));
        let data = renewed.data.lock();
        assert_eq!(data.photos.len(), 3);
        assert_eq!(data.bytes, image.len() * 3);
        drop(data);
        std::fs::remove_dir_all(&previous.images_dir).unwrap();
    }

    #[tokio::test]
    async fn renewal_waits_for_upload_and_listener_shutdown() {
        let previous = make_session("127.0.0.1:12345".into(), Instant::now() + TTL, false);
        let permit = previous.upload.clone().acquire_owned().await.unwrap();
        previous.finish(CaptureState::Stopped);
        let session = previous.clone();
        let mut waiting = tokio::spawn(async move {
            let id = session.id.clone();
            prepare_previous(Some(session), Some(&id)).await
        });
        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut waiting)
                .await
                .is_err()
        );
        drop(permit);
        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut waiting)
                .await
                .is_err()
        );
        previous.closed.send_replace(true);
        assert!(waiting.await.unwrap().unwrap().is_some());
    }

    #[tokio::test]
    async fn idle_connections_timeout_and_release_listener_capacity() {
        use tokio::io::AsyncReadExt;

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let host = listener.local_addr().unwrap().to_string();
        let session = make_session(host.clone(), Instant::now() + TTL, false);
        let shutdown = session.shutdown.subscribe();
        tokio::spawn(run_server_with_timeout(
            listener,
            session.clone(),
            shutdown,
            Duration::from_millis(200),
        ));
        let mut sockets = Vec::new();
        for _ in 0..32 {
            sockets.push(tokio::net::TcpStream::connect(&host).await.unwrap());
        }
        for socket in &mut sockets {
            let mut buf = [0; 256];
            let count = tokio::time::timeout(Duration::from_secs(3), socket.read(&mut buf))
                .await
                .expect("idle connection did not time out")
                .unwrap();
            assert!(count == 0 || buf[..count].starts_with(b"HTTP/1.1 408"));
        }
        let response = tokio::time::timeout(
            Duration::from_secs(3),
            reqwest::Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .get(format!("http://{host}/camera"))
                .send(),
        )
        .await
        .expect("listener capacity not released")
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        session.finish(CaptureState::Stopped);
    }

    #[tokio::test]
    async fn network_notification_revokes_even_when_route_is_unchanged() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let session = make_session(
            listener.local_addr().unwrap().to_string(),
            Instant::now() + TTL,
            false,
        );
        assert!(session.network_matches());
        let shutdown = session.shutdown.subscribe();
        let mut closed = session.closed.subscribe();
        tokio::spawn(run_server(listener, session.clone(), shutdown));
        let (notify, receiver) = watch::channel(false);
        let monitoring = tokio::spawn(monitor(session.clone(), receiver));

        let (body_tx, body_rx) = oneshot::channel::<Vec<u8>>();
        let request = upload_request(
            &session,
            &Uuid::new_v4().to_string(),
            Body::from_stream(stream::once(async move {
                Ok::<Bytes, std::io::Error>(Bytes::from(body_rx.await.unwrap()))
            })),
        );
        let upload_session = session.clone();
        let upload = tokio::spawn(async move { route(&upload_session, request).await });
        while session.upload.available_permits() != 0 {
            tokio::task::yield_now().await;
        }
        notify.send_replace(true);
        tokio::time::timeout(Duration::from_secs(3), monitoring)
            .await
            .unwrap()
            .unwrap();
        assert!(!session.active());
        assert!(session.network_matches());
        body_tx.send(png(1, 1)).unwrap();
        assert_eq!(upload.await.unwrap().status(), StatusCode::GONE);
        if !*closed.borrow() {
            tokio::time::timeout(Duration::from_secs(3), closed.changed())
                .await
                .unwrap()
                .unwrap();
        }
        assert!(!session.images_dir.exists());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn wireless_notifications_compare_identity_before_revoking() {
        let baseline = NetworkIdentity {
            interface: "en0".into(),
            service: "service".into(),
            signature: Some("router".into()),
            wifi_profile: Some("profile".into()),
        };
        let mut snapshot = NetworkSnapshot {
            identity: baseline.clone(),
            link_active: Some(true),
            wifi_present: true,
        };
        let (changed, receiver) = watch::channel(false);
        let watcher = NetworkWatch { baseline, changed };
        let session = make_session("127.0.0.1:12345".into(), Instant::now() + TTL, true);
        let monitoring = tokio::spawn(monitor(session.clone(), receiver));

        // Repeated AirPort writes, including a temporarily omitted profile,
        // do not end a session on the same network.
        watcher.observe(Some(&snapshot));
        snapshot.identity.wifi_profile = None;
        watcher.observe(Some(&snapshot));
        snapshot.identity.wifi_profile = Some("profile".into());
        watcher.observe(Some(&snapshot));
        assert!(!*watcher.changed.borrow());
        assert!(session.active());

        // A different Wi-Fi profile still revokes when IP and route match.
        snapshot.identity.wifi_profile = Some("other-profile".into());
        watcher.observe(Some(&snapshot));
        tokio::time::timeout(Duration::from_secs(5), monitoring)
            .await
            .unwrap()
            .unwrap();
        assert!(session.network_matches());
        assert!(!session.active());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn network_identity_detects_route_and_link_changes() {
        let baseline = NetworkIdentity {
            interface: "en0".into(),
            service: "service".into(),
            signature: Some("router".into()),
            wifi_profile: Some("profile".into()),
        };
        let mut snapshot = NetworkSnapshot {
            identity: baseline.clone(),
            link_active: Some(true),
            wifi_present: true,
        };
        assert!(!network_identity_changed(&baseline, &snapshot));
        assert!(!network_identity_unavailable(&baseline, &snapshot));
        snapshot.identity.wifi_profile = None;
        assert!(network_identity_unavailable(&baseline, &snapshot));
        snapshot.identity.wifi_profile = baseline.wifi_profile.clone();
        snapshot.identity.signature = None;
        assert!(network_identity_unavailable(&baseline, &snapshot));
        snapshot.identity.signature = Some("other-router".into());
        assert!(network_identity_changed(&baseline, &snapshot));
        snapshot.identity.signature = baseline.signature.clone();
        snapshot.identity.service = "other-service".into();
        assert!(network_identity_changed(&baseline, &snapshot));
        snapshot.identity.service = baseline.service.clone();
        snapshot.identity.interface = "en1".into();
        assert!(network_identity_changed(&baseline, &snapshot));
        snapshot.identity.interface = baseline.interface.clone();
        snapshot.link_active = Some(false);
        assert!(network_identity_changed(&baseline, &snapshot));
    }

    #[tokio::test]
    async fn real_listener_security_upload_ack_and_stop() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let host = listener.local_addr().unwrap().to_string();
        let session = make_session(host.clone(), Instant::now() + TTL, false);
        *CURRENT.lock() = Some(session.clone());
        assert!(
            matches!(start(None, None).await, Err(message) if message.contains("已有拍照连接"))
        );
        assert!(start(Some("fr-FR".into()), None).await.is_err());
        let receiver = session.shutdown.subscribe();
        tokio::spawn(run_server(listener, session.clone(), receiver));
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let origin = format!("http://{host}");
        let status_url = format!("{origin}/camera/status");
        let missing = client.get(&status_url).send().await.unwrap();
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(missing.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            client
                .get(&status_url)
                .bearer_auth("wrong")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .get(&status_url)
                .header(header::HOST, "attacker.invalid")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        let html = client
            .get(format!("{origin}/camera"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(html.contains("lang=\"en-US\""));
        let id = Uuid::new_v4().to_string();
        let url = format!("{origin}/camera/photos/{id}");
        let image = png(2, 3);
        let post = |origin_header: &str, data: Vec<u8>| {
            client
                .post(&url)
                .bearer_auth(TOKEN)
                .header(header::ORIGIN, origin_header)
                .header(header::CONTENT_TYPE, "image/png")
                .body(data)
        };
        assert_eq!(
            post("http://evil.invalid", image.clone())
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            client
                .post(&url)
                .bearer_auth(TOKEN)
                .header(header::CONTENT_TYPE, "image/png")
                .body(image.clone())
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            post(&origin, image.clone()).send().await.unwrap().status(),
            StatusCode::OK
        );
        let snapshot = poll(session.id.clone()).await.unwrap();
        assert_eq!(snapshot.photos.len(), 1);
        assert_eq!(
            (snapshot.photos[0].width, snapshot.photos[0].height),
            (2, 3)
        );
        assert_eq!(std::fs::read(&snapshot.photos[0].path).unwrap(), image);
        assert_eq!(
            post(&origin, image.clone()).send().await.unwrap().status(),
            StatusCode::OK
        );
        assert_eq!(
            post(&origin, png(3, 2)).send().await.unwrap().status(),
            StatusCode::CONFLICT
        );
        assert_eq!(poll(session.id.clone()).await.unwrap().photos.len(), 1);
        let response = client
            .get(&status_url)
            .bearer_auth(TOKEN)
            .send()
            .await
            .unwrap();
        let phone_status: serde_json::Value = response.json().await.unwrap();
        assert_eq!(phone_status["state"], "connected");
        assert_eq!(phone_status["captureId"], session.id);
        assert_eq!(phone_status["photos"][0]["id"], id);
        assert!(phone_status["photos"][0].get("path").is_none());
        ack(session.id.clone(), id.clone(), Some("attach failed".into()))
            .await
            .unwrap();
        let failed = poll(session.id.clone()).await.unwrap();
        assert_eq!(
            serde_json::to_value(&failed.photos[0]).unwrap()["state"],
            "failed"
        );
        assert_eq!(failed.photos[0].error.as_deref(), Some("attach failed"));
        let phone_failed: serde_json::Value = client
            .get(&status_url)
            .bearer_auth(TOKEN)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_ne!(phone_failed["photos"][0]["error"], "attach failed");
        ack(session.id.clone(), id.clone(), None).await.unwrap();
        ack(session.id.clone(), id, Some("late error".into()))
            .await
            .unwrap();
        let attached = poll(session.id.clone()).await.unwrap();
        assert_eq!(
            serde_json::to_value(&attached.photos[0]).unwrap()["state"],
            "attached"
        );
        assert!(attached.photos[0].error.is_none());
        let mut jpeg = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(image::RgbImage::new(2, 2))
            .write_to(&mut jpeg, ImageFormat::Jpeg)
            .unwrap();
        let jpeg_id = Uuid::new_v4();
        let jpeg_url = format!("{origin}/camera/photos/{jpeg_id}");
        let jpeg_response = client
            .post(jpeg_url)
            .bearer_auth(TOKEN)
            .header(header::ORIGIN, &origin)
            .header(header::CONTENT_TYPE, "image/jpeg")
            .body(jpeg.into_inner())
            .send()
            .await
            .unwrap();
        assert_eq!(jpeg_response.status(), StatusCode::OK);
        let both = poll(session.id.clone()).await.unwrap();
        assert_eq!(both.photos.len(), 2);
        assert!(both.photos[1].name.ends_with(".jpg"));
        stop("unrelated".into()).await.unwrap();
        assert!(session.active());
        stop(session.id.clone()).await.unwrap();
        stop(session.id.clone()).await.unwrap();
        assert_eq!(
            serde_json::to_value(poll(session.id.clone()).await.unwrap()).unwrap()["state"],
            "stopped"
        );
        assert_eq!(
            route(
                &session,
                Request::builder()
                    .uri("/camera/status")
                    .header(header::HOST, &host)
                    .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
                    .body(Body::empty())
                    .unwrap()
            )
            .await
            .status(),
            StatusCode::GONE
        );
        assert!(std::path::Path::new(&attached.photos[0].path).exists());
        *CURRENT.lock() = None;
        std::fs::remove_dir_all(&session.images_dir).unwrap();
    }

    #[tokio::test]
    async fn image_validation_limits_expiry_and_busy_upload() {
        let session = make_session("127.0.0.1:12345".into(), Instant::now() + TTL, true);
        let id = Uuid::new_v4().to_string();
        let valid = png(1, 1);
        let too_big = Request::builder()
            .method("POST")
            .uri(format!("/camera/photos/{id}"))
            .header(header::HOST, &session.host)
            .header(header::ORIGIN, &session.origin)
            .header(header::AUTHORIZATION, format!("Bearer {TOKEN}"))
            .header(header::CONTENT_TYPE, "image/png")
            .header(header::CONTENT_LENGTH, (MAX_PHOTO + 1).to_string())
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            route(&session, too_big).await.status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(
            route(
                &session,
                upload_request(&session, &id, Body::from(vec![0; MAX_PHOTO + 1]))
            )
            .await
            .status(),
            StatusCode::PAYLOAD_TOO_LARGE
        );
        let mut forged = upload_request(&session, &id, Body::from(valid.clone()));
        forged
            .headers_mut()
            .insert(header::CONTENT_TYPE, HeaderValue::from_static("image/jpeg"));
        assert_eq!(
            route(&session, forged).await.status(),
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
        let mut damaged = valid.clone();
        damaged.truncate(damaged.len() / 2);
        assert_eq!(
            route(&session, upload_request(&session, &id, Body::from(damaged)))
                .await
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            route(
                &session,
                upload_request(&session, &id, Body::from(png(8193, 1)))
            )
            .await
            .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            route(
                &session,
                upload_request(&session, &id, Body::from(png(5000, 4001)))
            )
            .await
            .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let permit = session.upload.clone().acquire_owned().await.unwrap();
        assert_eq!(
            route(
                &session,
                upload_request(&session, &id, Body::from(valid.clone()))
            )
            .await
            .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        drop(permit);
        session.data.lock().bytes = MAX_TOTAL;
        assert_eq!(
            route(
                &session,
                upload_request(&session, &id, Body::from(valid.clone()))
            )
            .await
            .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        session.data.lock().bytes = 0;
        {
            let mut data = session.data.lock();
            for _ in 0..MAX_PHOTOS {
                data.photos.push(StoredPhoto {
                    photo: CameraPhoto {
                        id: Uuid::new_v4().to_string(),
                        path: String::new(),
                        name: String::new(),
                        width: 1,
                        height: 1,
                        state: PhotoState::Received,
                        error: None,
                    },
                    hash: [0; 32],
                    size: 0,
                });
            }
        }
        assert_eq!(
            route(
                &session,
                upload_request(&session, &id, Body::from(valid.clone()))
            )
            .await
            .status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        let expired = make_session(
            "127.0.0.1:12345".into(),
            Instant::now() - Duration::from_secs(1),
            true,
        );
        assert_eq!(
            route(&expired, upload_request(&expired, &id, Body::from(valid)))
                .await
                .status(),
            StatusCode::GONE
        );
        assert!(!session.images_dir.exists());
    }

    #[tokio::test]
    async fn changed_default_route_cancels_before_commit() {
        let mut session = make_session("127.0.0.1:12345".into(), Instant::now() + TTL, true);
        Arc::get_mut(&mut session).unwrap().route_identity = Some("different-route".into());
        let id = Uuid::new_v4().to_string();
        assert_eq!(
            route(
                &session,
                upload_request(&session, &id, Body::from(png(1, 1)))
            )
            .await
            .status(),
            StatusCode::GONE
        );
        assert!(session.data.lock().photos.is_empty());
        assert!(!session.active());
        assert_eq!(std::fs::read_dir(&session.images_dir).unwrap().count(), 0);
        std::fs::remove_dir(&session.images_dir).unwrap();
    }

    #[tokio::test]
    async fn stop_racing_inflight_upload_prevents_commit() {
        let session = make_session("127.0.0.1:12345".into(), Instant::now() + TTL, true);
        let (tx, rx) = oneshot::channel::<Vec<u8>>();
        let body = Body::from_stream(stream::once(async move {
            Ok::<Bytes, std::io::Error>(Bytes::from(rx.await.unwrap()))
        }));
        let request = upload_request(&session, &Uuid::new_v4().to_string(), body);
        let worker_session = session.clone();
        let worker = tokio::spawn(async move { route(&worker_session, request).await });
        while session.upload.available_permits() != 0 {
            tokio::task::yield_now().await;
        }
        let stopping_session = session.clone();
        let stopping = tokio::spawn(async move { stop_session(&stopping_session).await });
        while session.active() {
            tokio::task::yield_now().await;
        }
        assert!(!stopping.is_finished());
        tx.send(png(1, 1)).unwrap();
        assert_eq!(worker.await.unwrap().status(), StatusCode::GONE);
        stopping.await.unwrap().unwrap();
        let _permit = session.upload.acquire().await.unwrap();
        assert!(session.data.lock().photos.is_empty());
        assert!(!session.images_dir.exists());
    }
}
