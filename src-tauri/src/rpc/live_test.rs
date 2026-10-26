//! Live integration test — spawns a real `omp --mode rpc` process.
//! Not run by default: `cargo test -- --ignored live_rpc`.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::contracts::{Settings, StartOpts};
use crate::rpc::process::{self, OutEvent};

const CHEAP_MODEL: &str = "google-antigravity/gemini-3.8-flash";
const TEST_CWD: &str = "/tmp/ompws-test-b";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "spawns a real omp process; run explicitly"]
async fn live_rpc_prompt_with_approval() {
    std::fs::create_dir_all(TEST_CWD).unwrap();

    let settings = Settings {
        default_approval_mode: "always-ask".into(),
        ..Default::default()
    };
    let opts = StartOpts {
        cwd: TEST_CWD.into(),
        model: Some(CHEAP_MODEL.into()),
        approval_mode: Some("always-ask".into()),
        ..Default::default()
    };

    let (tx, mut rx) = mpsc::unbounded_channel::<(String, Value)>();
    let sink: process::OutSink = Arc::new(move |ev: OutEvent| match ev {
        OutEvent::Frame { session_id, frame } => {
            let _ = tx.send((session_id, frame));
        }
        OutEvent::Process {
            session_id,
            running,
            exit_code,
        } => {
            let _ = tx.send((
                session_id,
                json!({"type": "__process", "running": running, "exitCode": exit_code}),
            ));
        }
    });

    let handle = process::spawn_with_sink(&opts, &settings, sink)
        .await
        .expect("spawn + handshake");
    let session_id = handle.session_id.read().clone();
    assert!(!session_id.is_empty(), "get_state must yield a sessionId");
    assert!(
        !handle.session_file.read().is_empty(),
        "get_state must yield a sessionFile"
    );
    eprintln!(
        "live session: id={session_id} file={}",
        handle.session_file.read()
    );

    // RAII safety net: guarantee child process is terminated on any panic/early return.
    struct DropCleanup(Arc<process::SessionHandle>);
    impl Drop for DropCleanup {
        fn drop(&mut self) {
            if self.0.alive.load(std::sync::atomic::Ordering::SeqCst) {
                let pid = self.0.pid;
                let _ = self.0.shutdown.send(true);
                if pid > 0 {
                    let _ = std::process::Command::new("kill")
                        .args(["-9", &pid.to_string()])
                        .status();
                }
            }
        }
    }
    let _cleanup_guard = DropCleanup(handle.clone());

    let prompt_res = process::send_command(
        &handle,
        json!({
            "type": "prompt",
            "message": "Use the bash tool to run exactly `echo hello-rpc`, then reply with one word: done.",
        }),
    )
    .await;

    let mut handled_ids = std::collections::HashSet::new();
    let mut approved_ids = std::collections::HashSet::new();
    let mut denied_ids = std::collections::HashSet::new();
    let mut saw_tool_exec = false;
    let mut terminal_end = false;

    if prompt_res.is_ok() {
        let deadline = Instant::now() + Duration::from_secs(240);
        while Instant::now() < deadline && !terminal_end {
            let pending: Vec<(String, Value)> = handle
                .pending_ui
                .lock()
                .iter()
                .filter_map(|r| {
                    let id = r.request.get("id").and_then(Value::as_str)?;
                    Some((id.to_string(), r.request.clone()))
                })
                .collect();
            for (id, req) in pending {
                if handled_ids.insert(id.clone()) {
                    let title = req.get("title").and_then(Value::as_str).unwrap_or("");
                    let message = req.get("message").and_then(Value::as_str).unwrap_or("");
                    let req_str = req.to_string();
                    let is_exact_bash = title.starts_with("Allow tool: bash")
                        && (title.contains("echo hello-rpc")
                            || message.contains("echo hello-rpc")
                            || req_str.contains("echo hello-rpc"));
                    let method = req.get("method").and_then(Value::as_str).unwrap_or("");
                    let val = if method == "confirm" {
                        if is_exact_bash {
                            approved_ids.insert(id.clone());
                            json!(true)
                        } else {
                            denied_ids.insert(id.clone());
                            json!(false)
                        }
                    } else if is_exact_bash {
                        approved_ids.insert(id.clone());
                        json!("Approve")
                    } else {
                        denied_ids.insert(id.clone());
                        json!("Deny")
                    };
                    let _ = process::send_raw(
                        &handle,
                        json!({"type": "extension_ui_response", "id": id, "value": val}),
                    )
                    .await;
                    handle.pending_ui.lock().retain(|r| {
                        r.request.get("id").and_then(Value::as_str) != Some(id.as_str())
                    });
                    eprintln!("handled ui request {id}: approved={is_exact_bash}");
                }
            }
            if let Ok(Some((_sid, frame))) =
                tokio::time::timeout(Duration::from_millis(200), rx.recv()).await
            {
                let ty = frame.get("type").and_then(Value::as_str).unwrap_or("");
                match ty {
                    "tool_execution_start" => saw_tool_exec = true,
                    "agent_end"
                        if frame.get("isTerminal").and_then(Value::as_bool) != Some(false) =>
                    {
                        terminal_end = true;
                    }
                    _ => {}
                }
            }
        }
    }

    // Always clean up handle before final assertions even on prompt-ack failure
    let stop_res = process::stop_handle(&handle).await;

    prompt_res.expect("prompt ack");
    stop_res.expect("graceful stop");
    assert!(!handle.alive.load(std::sync::atomic::Ordering::SeqCst));
    eprintln!(
        "approved={} denied={} saw_tool_exec={saw_tool_exec} terminal_end={terminal_end}",
        !approved_ids.is_empty(),
        !denied_ids.is_empty()
    );
    assert!(
        !approved_ids.is_empty(),
        "expected an approval select request"
    );
    assert!(terminal_end, "expected a terminal agent_end frame");
}
