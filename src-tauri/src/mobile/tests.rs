//! Router tests with a mock backend: pairing → cookie → /api, auth rejection, SSE.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt as _;
use parking_lot::Mutex;
use serde_json::{json, Value};
use tokio::sync::{broadcast, watch};
use tower::ServiceExt as _;

use super::auth;
use super::backend::Backend;
use super::server::{self, Ctx};
use crate::contracts::{PendingKind, PendingUiRequest, SessionMeta, SessionStatus, Todo};
use crate::state::AppEvent;

struct Mock {
    calls: Mutex<Vec<String>>,
    bus: broadcast::Sender<AppEvent>,
    file: String,
}

impl Backend for Mock {
    async fn sessions(&self) -> Vec<SessionMeta> {
        let mk = |id: &str, updated: &str, archived: bool| SessionMeta {
            id: id.into(),
            label: format!("#{id}"),
            title: format!("title {id}"),
            updated_at: updated.into(),
            status: SessionStatus::AwaitingAnswer,
            pending: Some(PendingKind::Question),
            archived,
            file: self.file.clone(),
            ..Default::default()
        };
        vec![
            mk("a", "2026-01-01T00:00:00Z", false),
            mk("b", "2026-02-01T00:00:00Z", false),
            mk("z", "2026-03-01T00:00:00Z", true),
        ]
    }
    async fn session(&self, id: &str) -> Option<SessionMeta> {
        self.sessions().await.into_iter().find(|s| s.id == id)
    }
    async fn todos(&self) -> Vec<Todo> {
        let todo: Todo = serde_json::from_value(json!({
            "id": "t1", "kind": "approval", "source": "system", "status": "open",
            "sessionId": "a", "title": "Allow tool: bash", "detail": "", "payload": {"uiRequest": {"id": "r1"}},
            "priority": 50, "createdAt": "x", "updatedAt": "x"
        }))
        .unwrap();
        vec![todo]
    }
    async fn todo_act(&self, id: &str, action: &str) -> Result<(), String> {
        self.calls.lock().push(format!("act {id} {action}"));
        Ok(())
    }
    async fn pending_ui(&self, id: &str) -> Vec<PendingUiRequest> {
        vec![PendingUiRequest {
            session_id: id.into(),
            request: json!({"id": "r1", "method": "input"}),
            received_at: "x".into(),
        }]
    }
    async fn ui_respond(&self, id: &str, response: Value) -> Result<(), String> {
        self.calls.lock().push(format!("respond {id} {response}"));
        Ok(())
    }
    async fn send_prompt(&self, id: &str, text: &str) -> Result<(), String> {
        self.calls.lock().push(format!("prompt {id} {text}"));
        Ok(())
    }
    async fn resume(&self, _id: &str) -> Result<Value, String> {
        Err("not implemented".into())
    }
    fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.bus.subscribe()
    }
}

struct Harness {
    ctx: Arc<Ctx<Mock>>,
    shutdown: watch::Sender<bool>,
    dir: std::path::PathBuf,
}

fn harness() -> Harness {
    let dir = std::env::temp_dir().join(format!("ompws-mobile-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("s.jsonl");
    std::fs::write(
        &file,
        r#"{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"full last answer"}]}}"#,
    )
    .unwrap();
    let (bus, _) = broadcast::channel(16);
    let (tx, rx) = watch::channel(false);
    let ctx = Arc::new(Ctx {
        backend: Mock {
            calls: Mutex::new(Vec::new()),
            bus,
            file: file.to_string_lossy().to_string(),
        },
        db: Arc::new(parking_lot::Mutex::new(auth::test_db())),
        shutdown: rx,
    });
    Harness {
        ctx,
        shutdown: tx,
        dir,
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

async fn call(h: &Harness, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, String) {
    let res = server::router(h.ctx.clone()).oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res.headers().clone();
    let body = res.into_body().collect().await.unwrap().to_bytes();
    (status, headers, String::from_utf8_lossy(&body).to_string())
}

fn get(uri: &str, cookie: Option<&str>) -> Request<Body> {
    let mut b = Request::get(uri);
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    b.body(Body::empty()).unwrap()
}

fn post(uri: &str, cookie: &str, body: Value) -> Request<Body> {
    Request::post(uri)
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

/// Pair via /pair and return the `name=value` cookie pair.
async fn pair(h: &Harness) -> String {
    let (code, _) = auth::create_pairing(&h.ctx.db.lock(), chrono::Utc::now()).unwrap();
    let (status, headers, _) = call(h, get(&format!("/pair?code={code}"), None)).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    assert_eq!(headers[header::LOCATION], "/");
    let set = headers[header::SET_COOKIE].to_str().unwrap().to_string();
    assert!(set.contains("HttpOnly"));
    // Code is one-time.
    let (again, _, _) = call(h, get(&format!("/pair?code={code}"), None)).await;
    assert_eq!(again, StatusCode::FORBIDDEN);
    set.split(';').next().unwrap().to_string()
}

#[tokio::test]
async fn index_is_public_and_api_requires_auth() {
    let h = harness();
    let (s, _, body) = call(&h, get("/", None)).await;
    assert_eq!(s, StatusCode::OK);
    assert!(body.contains("<html"));
    let (s, _, _) = call(&h, get("/api/sessions", None)).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _, _) = call(&h, get("/api/sessions", Some("ompws_token=bogus"))).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let (s, _, _) = call(&h, get("/pair?code=nope", None)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn paired_device_uses_api() {
    let h = harness();
    let cookie = pair(&h).await;

    let (s, _, body) = call(&h, get("/api/sessions", Some(&cookie))).await;
    assert_eq!(s, StatusCode::OK);
    let list: Vec<Value> = serde_json::from_str(&body).unwrap();
    let ids: Vec<&str> = list.iter().map(|v| v["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["b", "a"], "archived hidden, newest first");
    assert_eq!(list[0]["status"], "awaiting_answer");
    assert_eq!(list[0]["pending"], "question");
    assert!(list[0].get("updatedAt").is_some());

    let (s, _, body) = call(&h, get("/api/todos", Some(&cookie))).await;
    assert_eq!(s, StatusCode::OK);
    assert!(body.contains("\"t1\""));

    let (s, _, _) = call(
        &h,
        post("/api/todos/t1/act", &cookie, json!({"action": "done"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _, _) = call(
        &h,
        post("/api/todos/t1/act", &cookie, json!({"action": "nuke"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (s, _, body) = call(&h, get("/api/sessions/a/pending-ui", Some(&cookie))).await;
    assert_eq!(s, StatusCode::OK);
    assert!(body.contains("\"r1\""));

    let (s, _, _) = call(
        &h,
        post(
            "/api/sessions/a/ui-respond",
            &cookie,
            json!({"response": {"id": "r1", "value": "Approve"}}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _, _) = call(
        &h,
        post(
            "/api/sessions/a/ui-respond",
            &cookie,
            json!({"response": {}}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (s, _, _) = call(
        &h,
        post("/api/sessions/a/prompt", &cookie, json!({"text": " 继续 "})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _, _) = call(
        &h,
        post("/api/sessions/a/prompt", &cookie, json!({"text": "  "})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let (s, _, body) = call(&h, post("/api/sessions/a/resume", &cookie, json!({}))).await;
    assert_eq!(s, StatusCode::BAD_GATEWAY);
    assert!(body.contains("not implemented"));

    let (s, _, body) = call(&h, get("/api/sessions/a/last", Some(&cookie))).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        serde_json::from_str::<Value>(&body).unwrap()["text"],
        "full last answer"
    );
    let (s, _, _) = call(&h, get("/api/sessions/missing/last", Some(&cookie))).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let calls = h.ctx.backend.calls.lock().clone();
    assert_eq!(calls[0], "act t1 done");
    assert!(calls[1].starts_with("respond a "));
    assert!(calls[1].contains("\"type\":\"extension_ui_response\""));
    assert_eq!(calls[2], "prompt a 继续");

    // Bearer works too; revocation locks the device out.
    let token = cookie.split_once('=').unwrap().1.to_string();
    let req = Request::get("/api/todos")
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap();
    assert_eq!(call(&h, req).await.0, StatusCode::OK);
    auth::revoke_all(&h.ctx.db.lock()).unwrap();
    assert_eq!(
        call(&h, get("/api/todos", Some(&cookie))).await.0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn sse_streams_bus_events_until_shutdown() {
    let h = harness();
    let cookie = pair(&h).await;
    let res = server::router(h.ctx.clone())
        .oneshot(get("/api/events", Some(&cookie)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "text/event-stream");
    let mut body = res.into_body();

    let bus = h.ctx.backend.bus.clone();
    let _ = bus.send(AppEvent::ServicesChanged); // ignored
    let _ = bus.send(AppEvent::TodosChanged);
    let _ = bus.send(AppEvent::SessionStatusChanged {
        session_id: "a".into(),
        old: SessionStatus::Working,
        new: SessionStatus::Review,
    });

    let mut text = String::new();
    while !text.contains("event: session") {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(5), body.frame())
            .await
            .expect("sse frame")
            .unwrap()
            .unwrap();
        if let Ok(data) = frame.into_data() {
            text.push_str(&String::from_utf8_lossy(&data));
        }
    }
    assert!(text.contains("event: hello"));
    assert!(text.contains("event: todos"));
    assert!(text.contains("\"new\":\"review\""));
    assert!(!text.contains("services"));

    h.shutdown.send(true).unwrap();
    let end = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while let Some(Ok(_)) = body.frame().await {}
    })
    .await;
    assert!(end.is_ok(), "stream ends on shutdown");
}

/// Real TCP server exercised with curl: pair → cookie jar → /api.
#[tokio::test]
async fn curl_end_to_end() {
    if std::process::Command::new("curl")
        .arg("--version")
        .output()
        .is_err()
    {
        return;
    }
    let h = harness();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server_task = tokio::spawn(server::serve(listener, h.ctx.clone()));
    let (code, _) = auth::create_pairing(&h.ctx.db.lock(), chrono::Utc::now()).unwrap();
    let jar = h.dir.join("jar.txt");
    let base = format!("http://127.0.0.1:{port}");

    let curl = |args: Vec<String>| async move {
        tokio::process::Command::new("curl")
            .args(["-s", "-S", "--max-time", "5"])
            .args(args)
            .output()
            .await
            .unwrap()
    };
    let jar_s = jar.to_string_lossy().to_string();
    let out = curl(vec![
        "-c".into(),
        jar_s.clone(),
        "-L".into(),
        "-o".into(),
        "/dev/null".into(),
        "-w".into(),
        "%{http_code} %{url_effective}".into(),
        format!("{base}/pair?code={code}"),
    ])
    .await;
    let summary = String::from_utf8_lossy(&out.stdout).to_string();
    assert_eq!(summary, format!("200 {base}/"), "followed redirect to /");

    let out = curl(vec![
        "-b".into(),
        jar_s.clone(),
        format!("{base}/api/sessions"),
    ])
    .await;
    let list: Vec<Value> = serde_json::from_slice(&out.stdout).expect("json sessions");
    assert_eq!(list.len(), 2);

    let out = curl(vec![
        "-b".into(),
        jar_s,
        "-X".into(),
        "POST".into(),
        "-H".into(),
        "content-type: application/json".into(),
        "-d".into(),
        r#"{"text":"hello from curl"}"#.into(),
        format!("{base}/api/sessions/b/prompt"),
    ])
    .await;
    assert_eq!(String::from_utf8_lossy(&out.stdout), r#"{"ok":true}"#);

    let out = curl(vec![
        "-o".into(),
        "/dev/null".into(),
        "-w".into(),
        "%{http_code}".into(),
        format!("{base}/api/sessions"),
    ])
    .await;
    assert_eq!(String::from_utf8_lossy(&out.stdout), "401");

    h.shutdown.send(true).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), server_task)
        .await
        .expect("server stops")
        .unwrap();
    assert!(h
        .ctx
        .backend
        .calls
        .lock()
        .contains(&"prompt b hello from curl".to_string()));
}

#[tokio::test]
async fn csrf_rejects_cross_site_requests() {
    let h = harness();
    let cookie = pair(&h).await;

    // Cross-site Origin on a mutation → 403.
    let req = Request::post("/api/sessions/a/prompt")
        .header(header::COOKIE, &cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::HOST, "192.168.1.5:7788")
        .header(header::ORIGIN, "https://evil.example")
        .body(Body::from(json!({"text":"hi"}).to_string()))
        .unwrap();
    assert_eq!(call(&h, req).await.0, StatusCode::FORBIDDEN);

    // Sec-Fetch-Site: cross-site → 403.
    let req = Request::post("/api/sessions/a/prompt")
        .header(header::COOKIE, &cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .header("sec-fetch-site", "cross-site")
        .body(Body::from(json!({"text":"hi"}).to_string()))
        .unwrap();
    assert_eq!(call(&h, req).await.0, StatusCode::FORBIDDEN);

    // Same-origin Origin matching Host → allowed.
    let req = Request::post("/api/sessions/a/prompt")
        .header(header::COOKIE, &cookie)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::HOST, "192.168.1.5:7788")
        .header(header::ORIGIN, "http://192.168.1.5:7788")
        .body(Body::from(json!({"text":"hi"}).to_string()))
        .unwrap();
    assert_eq!(call(&h, req).await.0, StatusCode::OK);

    // GETs are not CSRF-checked.
    let req = Request::get("/api/sessions")
        .header(header::COOKIE, &cookie)
        .header(header::ORIGIN, "https://evil.example")
        .body(Body::empty())
        .unwrap();
    assert_eq!(call(&h, req).await.0, StatusCode::OK);
}

#[tokio::test]
async fn rejects_invalid_or_archived_session_targets() {
    let h = harness();
    let cookie = pair(&h).await;

    // Illegal characters / traversal in the session id → 400.
    for bad in ["bad%20id", "..%2F..%2Fetc", "a!b"] {
        let (s, _, _) = call(&h, get(&format!("/api/sessions/{bad}/last"), Some(&cookie))).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "id {bad}");
    }

    // Unknown session → 404 on mutations and reads.
    let (s, _, _) = call(&h, get("/api/sessions/ghost/pending-ui", Some(&cookie))).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _, _) = call(
        &h,
        post("/api/sessions/ghost/prompt", &cookie, json!({"text": "hi"})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    // Archived session → 400 on mutations.
    let (s, _, _) = call(
        &h,
        post("/api/sessions/z/prompt", &cookie, json!({"text": "hi"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _, _) = call(&h, post("/api/sessions/z/resume", &cookie, json!({}))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // ui-respond must reference a live pending request id.
    let (s, _, _) = call(
        &h,
        post(
            "/api/sessions/a/ui-respond",
            &cookie,
            json!({"response": {"id": "not-pending"}}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn sse_ends_when_device_revoked() {
    let h = harness();
    let cookie = pair(&h).await;
    let res = server::router(h.ctx.clone())
        .oneshot(get("/api/events", Some(&cookie)))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let mut body = res.into_body();

    auth::revoke_all(&h.ctx.db.lock()).unwrap();
    // Any bus event triggers the revocation check and ends the stream.
    let _ = h.ctx.backend.bus.send(AppEvent::TodosChanged);

    let end = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while let Some(Ok(_)) = body.frame().await {}
    })
    .await;
    assert!(end.is_ok(), "stream ends after revocation");
}

#[test]
fn qr_svg_renders() {
    let svg = super::qr_svg("http://192.168.1.2:7788/pair?code=abc").unwrap();
    assert!(svg.starts_with("<?xml") || svg.contains("<svg"));
}

#[test]
fn test_ipv6_address_selection() {
    use super::ipv6::{is_eligible_global_unicast, select_best_address, CandidateAddress};
    use std::net::Ipv6Addr;
    use std::str::FromStr;

    // Rejection of non-global unicast
    assert!(!is_eligible_global_unicast(
        &Ipv6Addr::from_str("::1").unwrap()
    ));
    assert!(!is_eligible_global_unicast(
        &Ipv6Addr::from_str("fe80::1").unwrap()
    ));
    assert!(!is_eligible_global_unicast(
        &Ipv6Addr::from_str("fd00::1").unwrap()
    ));
    assert!(!is_eligible_global_unicast(
        &Ipv6Addr::from_str("fc00::1").unwrap()
    ));
    assert!(!is_eligible_global_unicast(
        &Ipv6Addr::from_str("2001:db8::1").unwrap()
    ));
    assert!(!is_eligible_global_unicast(
        &Ipv6Addr::from_str("2001:0:1234::1").unwrap()
    ));
    assert!(!is_eligible_global_unicast(
        &Ipv6Addr::from_str("2002:1234::1").unwrap()
    ));

    // Acceptance of global unicast (2000::/3)
    let addr_temp = Ipv6Addr::from_str("2408:4005:1000::1").unwrap();
    let addr_stable = Ipv6Addr::from_str("2408:4005:1000::2").unwrap();
    assert!(is_eligible_global_unicast(&addr_temp));
    assert!(is_eligible_global_unicast(&addr_stable));

    // Prefers stable global over temporary
    let candidates = vec![
        CandidateAddress {
            addr: addr_temp,
            is_temporary: true,
            is_deprecated: false,
        },
        CandidateAddress {
            addr: addr_stable,
            is_temporary: false,
            is_deprecated: false,
        },
    ];
    let selected = select_best_address(candidates).unwrap();
    assert_eq!(selected, addr_stable);

    // Prefers non-deprecated over deprecated
    let addr_dep = Ipv6Addr::from_str("2408:4005:1000::3").unwrap();
    let candidates = vec![
        CandidateAddress {
            addr: addr_dep,
            is_temporary: false,
            is_deprecated: true,
        },
        CandidateAddress {
            addr: addr_temp,
            is_temporary: true,
            is_deprecated: false,
        },
    ];
    let selected = select_best_address(candidates).unwrap();
    assert_eq!(selected, addr_temp);

    // All rejected when only non-eligible addresses present
    let candidates = vec![
        CandidateAddress {
            addr: Ipv6Addr::from_str("fe80::1").unwrap(),
            is_temporary: false,
            is_deprecated: false,
        },
        CandidateAddress {
            addr: Ipv6Addr::from_str("fd00::1").unwrap(),
            is_temporary: false,
            is_deprecated: false,
        },
    ];
    assert!(select_best_address(candidates).is_none());
}

#[test]
fn test_csrf_origin_host_matching() {
    use axum::http::HeaderMap;

    let check = |origin: Option<&str>, host: Option<&str>, tls: bool, xfp: Option<&str>| -> bool {
        let mut headers = HeaderMap::new();
        if let Some(o) = origin {
            headers.insert(header::ORIGIN, o.parse().unwrap());
        }
        if let Some(h) = host {
            headers.insert(header::HOST, h.parse().unwrap());
        }
        if let Some(p) = xfp {
            headers.insert("x-forwarded-proto", p.parse().unwrap());
        }
        server::verify_csrf(&headers, tls).is_ok()
    };

    // LAN: explicit port on both sides, plain HTTP.
    assert!(check(
        Some("http://192.168.1.10:7788"),
        Some("192.168.1.10:7788"),
        false,
        None
    ));
    assert!(check(
        Some("http://localhost:7788"),
        Some("localhost:7788"),
        false,
        None
    ));

    // cloudflared tunnel: https implied on both sides (x-forwarded-proto, no port).
    assert!(check(
        Some("https://foo.trycloudflare.com"),
        Some("foo.trycloudflare.com"),
        false,
        Some("https")
    ));

    // IPv6 direct: bracketed literal over TLS with explicit port.
    assert!(check(
        Some("https://[2408:4005:1000::1]:7789"),
        Some("[2408:4005:1000::1]:7789"),
        true,
        None
    ));

    // Reject: origin's implicit https port (443) vs explicit Host port 7789.
    assert!(!check(
        Some("https://home.example.com"),
        Some("home.example.com:7789"),
        false,
        None
    ));
    assert!(!check(
        Some("https://[2408:4005:1000::1]"),
        Some("[2408:4005:1000::1]:7789"),
        true,
        None
    ));

    // Reject: scheme mismatch (https origin over plain-HTTP host).
    assert!(!check(
        Some("https://192.168.1.10:7788"),
        Some("192.168.1.10:7788"),
        false,
        None
    ));

    // Reject: different IPv6 host.
    assert!(!check(
        Some("https://[2408:4005:2000::2]:7789"),
        Some("[2408:4005:1000::1]:7789"),
        true,
        None
    ));

    // Reject: different port.
    assert!(!check(
        Some("https://[2408:4005:1000::1]:8888"),
        Some("[2408:4005:1000::1]:7789"),
        true,
        None
    ));

    // Reject: different IPv4 host.
    assert!(!check(
        Some("http://192.168.1.11:7788"),
        Some("192.168.1.10:7788"),
        false,
        None
    ));

    // Reject: Origin without a scheme.
    assert!(!check(
        Some("192.168.1.10:7788"),
        Some("192.168.1.10:7788"),
        false,
        None
    ));
}

#[test]
fn test_csrf_ignores_x_forwarded_host() {
    let mut headers = axum::http::HeaderMap::new();
    headers.insert(header::ORIGIN, "http://evil.com".parse().unwrap());
    headers.insert(header::HOST, "192.168.1.10:7788".parse().unwrap());
    headers.insert("x-forwarded-host", "evil.com".parse().unwrap());
    assert!(server::verify_csrf(&headers, false).is_err());
}

#[tokio::test]
async fn test_tls_pairing_sets_secure_cookie() {
    let h = harness();

    // Plain HTTP pairing does NOT set Secure
    let (code1, _) = auth::create_pairing(&h.ctx.db.lock(), chrono::Utc::now()).unwrap();
    let (status, headers, _) = call(&h, get(&format!("/pair?code={code1}"), None)).await;
    assert_eq!(status, StatusCode::SEE_OTHER);
    let cookie = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(!cookie.contains("Secure"));

    // Pairing over TLS (via TlsConnection extension layer) sets Secure
    let (code2, _) = auth::create_pairing(&h.ctx.db.lock(), chrono::Utc::now()).unwrap();
    let tls_router = server::router(h.ctx.clone()).layer(axum::Extension(server::TlsConnection));
    let res = tls_router
        .oneshot(get(&format!("/pair?code={code2}"), None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::SEE_OTHER);
    let cookie = res.headers()[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.contains("; Secure"));

    // Pairing behind reverse proxy with x-forwarded-proto: https also sets Secure
    let (code3, _) = auth::create_pairing(&h.ctx.db.lock(), chrono::Utc::now()).unwrap();
    let req = Request::get(format!("/pair?code={code3}"))
        .header("x-forwarded-proto", "https")
        .body(Body::empty())
        .unwrap();
    let res = server::router(h.ctx.clone()).oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::SEE_OTHER);
    let cookie = res.headers()[header::SET_COOKIE].to_str().unwrap();
    assert!(cookie.contains("; Secure"));
}
