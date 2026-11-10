//! Local subscribers and fake processes only: never initialize the production logger.
use super::*;
use crate::diagnostics::test_support::{capture, CapturedEvents};

const SESSION: &str = "50000000-0000-4000-8000-000000000001";
const START_OPERATION: &str = "50000000-0000-4000-8000-000000000002";
const SEND_OPERATION: &str = "50000000-0000-4000-8000-000000000003";

fn export_fixture(name: &str, captured: &CapturedEvents) {
    // Opt-in test output, not a production endpoint or a process-global mutation.
    let Some(root) = std::env::var_os("OMPWS_DIAGNOSTIC_FIXTURE_DIR") else {
        return;
    };
    let root = PathBuf::from(root);
    assert!(root.is_absolute());
    assert!(std::fs::symlink_metadata(&root).unwrap().is_dir());
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(std::env::temp_dir().canonicalize().unwrap()));
    let root = root.join(name);
    std::fs::create_dir(&root).unwrap();
    let logs = root.join("diagnostics");
    std::fs::create_dir(&logs).unwrap();
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(logs.join("events.jsonl"))
        .unwrap();
    file.write_all(&captured.bytes()).unwrap();
}

fn event<'a>(events: &'a [Value], name: &str, code: Option<&str>) -> &'a Value {
    events
        .iter()
        .find(|record| {
            record["fields"]["event"] == name
                && code.is_none_or(|code| record["fields"]["code"] == code)
        })
        .unwrap_or_else(|| panic!("missing {name}/{code:?}: {events:?}"))
}

fn diagnostic_handle(tx: mpsc::UnboundedSender<String>) -> Arc<SessionHandle> {
    let handle = Arc::new(SessionHandle {
        pid: 4242,
        stdin_tx: tx,
        ..SessionHandle::for_test()
    });
    *handle.session_id.write() = SESSION.into();
    handle
}

#[cfg(unix)]
struct FakeShell {
    root: PathBuf,
    opts: StartOpts,
    settings: Settings,
}
#[cfg(unix)]
impl FakeShell {
    fn new(body: &str) -> Self {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("ompws-diagnostic-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let executable = root.join("fake-omp");
        std::fs::write(&executable, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self {
            opts: StartOpts {
                cwd: root.to_string_lossy().into_owned(),
                ..Default::default()
            },
            settings: Settings {
                omp_binary: executable.to_string_lossy().into_owned(),
                ..Default::default()
            },
            root,
        }
    }
    fn responding() -> Self {
        Self::new(&format!(
            r#"printf '%s\n' '{{"type":"ready"}}'
while IFS= read -r line; do
    id=${{line#*\"id\":\"}}
    id=${{id%%\"*}}
    case "$line" in
        *'"type":"get_state"'*) printf '%s\n' '{{"type":"response","id":"'"$id"'","success":true,"data":{{"sessionId":"{SESSION}","sessionFile":"/tmp/diagnostic.jsonl"}}}}' ;;
        *'"type":"prompt"'*) printf '%s\n' '{{"type":"response","id":"'"$id"'","success":false,"code":"session_busy","error":"DIAG_SECRET_SENTINEL"}}' ;;
        *) printf '%s\n' '{{"type":"response","id":"'"$id"'","success":true}}' ;;
    esac
done"#
        ))
    }
}
#[cfg(unix)]
impl Drop for FakeShell {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[cfg(unix)]
#[tokio::test]
async fn diagnostic_exit42_retains_original_error_without_stderr_capture() {
    let shell = FakeShell::new("printf 'DIAG_SECRET_SENTINEL\\n' >&2\nexit 42");
    let (dispatch, captured) = capture();
    let result = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
        .instrument(tracing::dispatcher::with_default(&dispatch, || {
            diagnostics::operation_span(Some(START_OPERATION))
        }))
        .with_subscriber(dispatch.clone())
        .await;
    let error = result.err().expect("startup must fail");
    assert!(error.contains("42") && error.contains("DIAG_SECRET_SENTINEL"));
    let events = captured.events();
    let failed = event(&events, "rpc.spawn_failed", Some("spawn_failed"));
    assert_eq!(failed["fields"]["exitCode"], 42);
    assert_eq!(failed["fields"]["phase"], "ready");
    assert_eq!(failed["span"]["operationId"], START_OPERATION);
    let exited = event(&events, "rpc.lifecycle", None);
    assert_eq!(exited["fields"]["source"], "process_exit");
    assert!(exited.get("span").is_none());
    let aborted = events
        .iter()
        .find(|record| {
            record["fields"]["event"] == "rpc.lifecycle"
                && record["fields"]["source"] == "spawn_aborted"
        })
        .expect("failed handshake retains abort lifecycle evidence");
    assert_eq!(aborted["fields"]["childPid"], failed["fields"]["childPid"]);
    assert!(aborted["fields"]["childPid"].as_u64().unwrap() > 1);
    assert_eq!(aborted["fields"]["alive"], false);
    assert_eq!(aborted["fields"]["shutdownRequested"], true);
    assert_eq!(aborted["fields"]["streaming"], false);
    assert!(aborted["fields"].get("sessionId").is_none());
    assert!(!String::from_utf8(captured.bytes())
        .unwrap()
        .contains("DIAG_SECRET_SENTINEL"));
    export_fixture("exit42", &captured);
}

#[cfg(unix)]
#[tokio::test]
async fn resume_model_recovery_preserves_transcript_and_requires_explicit_override() {
    let mut shell = FakeShell::new(
        r#"printf '%s\n' "$@" > actual-args
resume=
model=
while [ "$#" -gt 0 ]; do
    case "$1" in
        --resume) resume=$2; shift 2 ;;
        --model) model=$2; shift 2 ;;
        *) shift ;;
    esac
done
[ -f "$resume" ] || { printf '%s\n' 'Error: missing resume file' >&2; exit 43; }
IFS= read -r header < "$resume"
session=${header#*\"id\":\"}
session=${session%%\"*}
if [ -z "$model" ]; then
    while IFS= read -r entry; do
        case "$entry" in
            *'"type":"model_change","provider":"anthropic","modelId":"claude-sonnet"'*) model=anthropic/claude-sonnet ;;
        esac
    done < "$resume"
fi
if [ -z "$model" ]; then
    printf '%s\n' '57630 | throw new see(Xn[0]);' 'SessionModelRestoreError: Could not restore model removed/old-model' '    at IQ (/$bunfs/root/omp:57630:123)' >&2
    exit 42
fi
[ "$model" = 'anthropic/claude-sonnet' ] || { printf '%s\n' 'Error: unexpected override' >&2; exit 44; }
printf '%s\n' '{"type":"ready","supportedProtocolVersions":[2]}'
while IFS= read -r line; do
    printf '%s\n' "$line" >> rpc-requests
    id=${line#*\"id\":\"}
    id=${id%%\"*}
    case "$line" in
        *'"type":"get_state"'*) printf '%s\n' '{"type":"response","id":"'"$id"'","success":true,"data":{"sessionId":"'"$session"'","sessionFile":"'"$resume"'","model":{"provider":"anthropic","id":"claude-sonnet"}}}' ;;
        *'"type":"set_model"'*)
            case "$line" in
                *'"modelId":"claude-sonnet"'*'"provider":"anthropic"'*) ;;
                *) exit 45 ;;
            esac
            printf '%s\n' '{"type":"model_change","provider":"anthropic","modelId":"claude-sonnet"}' >> "$resume"
            printf '%s\n' '{"type":"response","id":"'"$id"'","success":true}'
            ;;
        *) printf '%s\n' '{"type":"response","id":"'"$id"'","success":true}' ;;
    esac
done"#,
    );
    let transcript = format!(
        "{{\"type\":\"session\",\"id\":\"{SESSION}\"}}\n\
         {{\"type\":\"model_change\",\"provider\":\"removed\",\"modelId\":\"old-model\"}}\n\
         {{\"type\":\"message\",\"message\":{{\"role\":\"user\",\"content\":\"keep my history\"}}}}\n"
    );
    let file = shell.root.join("original session.jsonl");
    std::fs::write(&file, &transcript).unwrap();
    shell.opts.resume_file = Some(file.to_string_lossy().into_owned());
    shell.settings.new_session_model = Some("openai/not-a-resume-default".into());
    let error = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
        .await
        .err()
        .expect("unavailable saved model must not silently fall back");
    let original = error
        .strip_prefix("SESSION_MODEL_UNAVAILABLE:")
        .expect("the precise restore error must be recoverable");
    assert!(original.starts_with("omp stdout closed before ready; exit status: "));
    assert!(original.contains("42"));
    assert!(original.ends_with(
        "\n57630 | throw new see(Xn[0]);\nSessionModelRestoreError: Could not restore model removed/old-model\n    at IQ (/$bunfs/root/omp:57630:123)\n"
    ));
    assert_eq!(std::fs::read(&file).unwrap(), transcript.as_bytes());
    let args = std::fs::read_to_string(shell.root.join("actual-args")).unwrap();
    assert!(!args.lines().any(|arg| arg == "--model"));
    let args: Vec<_> = args.lines().collect();
    let resume = args.iter().position(|arg| *arg == "--resume").unwrap();
    assert_eq!(args[resume + 1], file.to_str().unwrap());
    assert!(!shell.root.join("rpc-requests").exists());

    shell.opts.model = Some("anthropic/claude-sonnet".into());
    let handle = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
        .await
        .expect("the explicitly chosen model must permit the original resume");
    assert_eq!(&*handle.session_id.read(), SESSION);
    assert_eq!(&*handle.session_file.read(), file.to_str().unwrap());
    stop_handle(&handle).await.unwrap();
    handle.wait_stdout_closed(Duration::from_secs(2)).await;
    let persisted = format!(
        "{transcript}{{\"type\":\"model_change\",\"provider\":\"anthropic\",\"modelId\":\"claude-sonnet\"}}\n"
    );
    assert_eq!(std::fs::read(&file).unwrap(), persisted.as_bytes());
    let args = std::fs::read_to_string(shell.root.join("actual-args")).unwrap();
    let args: Vec<_> = args.lines().collect();
    let model = args.iter().position(|arg| *arg == "--model").unwrap();
    assert_eq!(args[model + 1], "anthropic/claude-sonnet");
    let resume = args.iter().position(|arg| *arg == "--resume").unwrap();
    assert_eq!(args[resume + 1], file.to_str().unwrap());
    let requests = std::fs::read_to_string(shell.root.join("rpc-requests")).unwrap();
    let commands: Vec<Value> = requests
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let types: Vec<_> = commands
        .iter()
        .map(|command| command["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        types,
        [
            "negotiate_protocol",
            "get_state",
            "set_model",
            "get_state",
            "set_subagent_subscription"
        ]
    );
    assert_eq!(commands[2]["provider"], "anthropic");
    assert_eq!(commands[2]["modelId"], "claude-sonnet");
    assert!(commands[2].get("persist").is_none());
    assert!(!types.contains(&"prompt"));

    // Simulate a later idle wake: omp must now restore the model it appended,
    // without another override or a second model-change record.
    shell.opts.model = None;
    let handle = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
        .await
        .expect("the next ordinary resume must use the persisted recovery choice");
    stop_handle(&handle).await.unwrap();
    handle.wait_stdout_closed(Duration::from_secs(2)).await;
    assert_eq!(std::fs::read(&file).unwrap(), persisted.as_bytes());
    let args = std::fs::read_to_string(shell.root.join("actual-args")).unwrap();
    assert!(!args.lines().any(|arg| arg == "--model"));
    let requests = std::fs::read_to_string(shell.root.join("rpc-requests")).unwrap();
    assert_eq!(requests.matches("\"type\":\"set_model\"").count(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn resume_model_persistence_failure_never_completes_handshake() {
    for (model, expected, should_set) in [
        (json!({"id": "claude-sonnet"}), "model provider", false),
        (json!({"provider": "anthropic"}), "model id", false),
        (
            json!({"provider": "anthropic", "id": "claude-sonnet"}),
            "model persistence rejected",
            true,
        ),
    ] {
        let mut shell = FakeShell::new(&format!(
            r#"printf '%s\n' '{{"type":"ready"}}'
while IFS= read -r line; do
    printf '%s\n' "$line" >> rpc-requests
    id=${{line#*\"id\":\"}}
    id=${{id%%\"*}}
    case "$line" in
        *'"type":"get_state"'*) printf '%s\n' '{{"type":"response","id":"'"$id"'","success":true,"data":{{"sessionId":"{SESSION}","model":{model}}}}}' ;;
        *'"type":"set_model"'*) printf '%s\n' '{{"type":"response","id":"'"$id"'","success":false,"error":"model persistence rejected"}}' ;;
        *) printf '%s\n' '{{"type":"response","id":"'"$id"'","success":true}}' ;;
    esac
done"#
        ));
        let file = shell.root.join("original.jsonl");
        let transcript = format!("{{\"type\":\"session\",\"id\":\"{SESSION}\"}}\n");
        std::fs::write(&file, &transcript).unwrap();
        shell.opts.resume_file = Some(file.to_string_lossy().into_owned());
        shell.opts.model = Some("anthropic/claude-sonnet".into());
        let error = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
            .await
            .err()
            .expect("a recovery without confirmed persistence must fail");
        assert!(error.contains(expected), "{error}");
        assert!(!error.starts_with("SESSION_MODEL_UNAVAILABLE:"));
        let requests = std::fs::read_to_string(shell.root.join("rpc-requests")).unwrap();
        assert_eq!(requests.contains("\"type\":\"set_model\""), should_set);
        assert!(!requests.contains("\"type\":\"set_subagent_subscription\""));
        assert!(!requests.contains("\"type\":\"prompt\""));
        assert_eq!(std::fs::read(&file).unwrap(), transcript.as_bytes());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn startup_recovery_signal_accepts_named_fatal_formats_without_changing_diagnostic() {
    for label in ["error: ", "[Uncaught Exception] ", "[Unhandled Rejection] "] {
        let diagnostic =
            format!("{label}SessionModelRestoreError: Could not restore model removed/old-model");
        let shell = FakeShell::new(&format!("printf '%s\\n' '{diagnostic}' >&2\nexit 42"));
        let error = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
            .await
            .err()
            .expect("the fixture must fail before ready");
        let original = error.strip_prefix("SESSION_MODEL_UNAVAILABLE:").unwrap();
        assert!(original.starts_with("omp stdout closed before ready; exit status: "));
        assert!(original.ends_with(&format!("\n{diagnostic}\n")));
    }
}

#[cfg(unix)]
#[tokio::test]
async fn startup_recovery_signal_rejects_unrelated_model_and_class_mentions() {
    for diagnostic in [
        "Error: provider unavailable for removed/old-model",
        "Error: Could not restore model registry",
        "SessionModelRestoreErrorExtra: not the upstream error",
        "at new SessionModelRestoreError (sdk.ts:123:4)",
        "error: Could not restore model removed/old-model",
        "SessionModelRestoreError: a different failure",
        "SessionModelRestoreError: Could not restore model ",
        "throw new SessionModelRestoreError(modelSelector)",
    ] {
        let shell = FakeShell::new(&format!("printf '%s\\n' '{diagnostic}' >&2\nexit 42"));
        let error = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
            .await
            .err()
            .expect("the fixture must fail before ready");
        assert!(error.starts_with("omp stdout closed before ready; exit status: "));
        assert!(error.ends_with(&format!("\n{diagnostic}\n")));
        assert!(!error.contains("SESSION_MODEL_UNAVAILABLE:"));
    }
}

#[cfg(unix)]
#[tokio::test]
async fn diagnostic_ready_timeout_is_distinct_from_exit() {
    // Resolve the existing login PATH cache before pausing; no environment mutation.
    let _ = augmented_path().await;
    let shell = FakeShell::new("while IFS= read -r line; do :; done");
    let (dispatch, captured) = capture();
    tokio::time::pause();
    let result = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
        .with_subscriber(dispatch)
        .await;
    assert!(result
        .err()
        .unwrap()
        .contains("omp did not emit a ready frame"));
    let events = captured.events();
    let failed = event(&events, "rpc.spawn_failed", Some("startup_timeout"));
    assert_eq!(failed["fields"]["phase"], "ready");
    assert!(failed["fields"].get("exitCode").is_none());
    let aborted = events
        .iter()
        .find(|record| {
            record["fields"]["event"] == "rpc.lifecycle"
                && record["fields"]["source"] == "spawn_aborted"
        })
        .expect("ready timeout retains abort lifecycle evidence");
    assert_eq!(aborted["fields"]["childPid"], failed["fields"]["childPid"]);
    assert!(aborted["fields"]["childPid"].as_u64().unwrap() > 1);
    assert_eq!(aborted["fields"]["alive"], true);
    assert_eq!(aborted["fields"]["shutdownRequested"], false);
    assert_eq!(aborted["fields"]["streaming"], false);
    assert!(aborted["fields"].get("sessionId").is_none());
    export_fixture("ready-timeout", &captured);
}

#[tokio::test(start_paused = true)]
async fn diagnostic_command_timeout_cleans_pending_and_keeps_identity() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let handle = diagnostic_handle(tx);
    let (dispatch, captured) = capture();
    let result = send_command(
        &handle,
        json!({"type":"prompt","message":"DIAG_SECRET_SENTINEL"}),
    )
    .instrument(tracing::dispatcher::with_default(&dispatch, || {
        diagnostics::operation_span(Some(SEND_OPERATION))
    }))
    .with_subscriber(dispatch)
    .await;
    assert_eq!(result.unwrap_err(), "command timed out");
    assert!(handle.pending.is_empty());
    let events = captured.events();
    let started = event(&events, "rpc.command_started", None);
    let finished = event(&events, "rpc.command_finished", Some("command_timeout"));
    assert_eq!(
        started["fields"]["requestId"],
        finished["fields"]["requestId"]
    );
    assert!(finished["fields"]["requestId"]
        .as_str()
        .unwrap()
        .starts_with("req_"));
    assert_eq!(finished["fields"]["sessionId"], SESSION);
    assert_eq!(finished["fields"]["childPid"], 4242);
    assert_eq!(finished["fields"]["phase"], "response");
    assert_eq!(finished["span"]["operationId"], SEND_OPERATION);
    assert!(!String::from_utf8(captured.bytes())
        .unwrap()
        .contains("DIAG_SECRET_SENTINEL"));
    export_fixture("command-timeout", &captured);
}

#[tokio::test]
async fn diagnostic_stdin_failure_preserves_dispatch_phase_and_original_error() {
    let (tx, rx) = mpsc::unbounded_channel();
    drop(rx);
    let handle = diagnostic_handle(tx);
    let (dispatch, captured) = capture();
    let error = send_command(&handle, json!({"type":"prompt"}))
        .with_subscriber(dispatch)
        .await
        .unwrap_err();
    assert_eq!(error, "session stdin closed");
    let events = captured.events();
    let finished = event(&events, "rpc.command_finished", Some("stdin_closed"));
    assert_eq!(finished["fields"]["phase"], "dispatch");
    assert!(finished["fields"].get("requestId").is_some());
}

#[tokio::test]
async fn diagnostic_polling_success_is_silent_and_failure_is_not() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let handle = diagnostic_handle(tx);
    let (dispatch, captured) = capture();
    let responder = handle.clone();
    let task = tokio::spawn(
        async move {
            for _ in 0..2 {
                let command: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
                apply_frame(
                    &responder,
                    &json!({"type":"response","id":command["id"],"success":true}),
                );
            }
        }
        .instrument(tracing::Span::none())
        .with_subscriber(dispatch.clone()),
    );
    for name in ["get_state", "get_subagents"] {
        send_command(&handle, json!({"type":name}))
            .with_subscriber(dispatch.clone())
            .await
            .unwrap();
    }
    task.await.unwrap();
    assert!(captured.events().is_empty());
    handle.alive.store(false, Ordering::SeqCst);
    assert_eq!(
        send_command(&handle, json!({"type":"get_state"}))
            .with_subscriber(dispatch)
            .await
            .unwrap_err(),
        "session process is not running"
    );
    let events = captured.events();
    let finished = event(&events, "rpc.command_finished", Some("process_not_running"));
    assert_eq!(finished["fields"]["phase"], "validate");
    assert!(finished["fields"].get("requestId").is_none());
    assert_eq!(events.len(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn diagnostic_upstream_rejection_stop_and_replacement_keep_process_identity() {
    let shell = FakeShell::responding();
    let (dispatch, captured) = capture();
    let output = Arc::new(parking_lot::Mutex::new(Vec::new()));
    let capture_output = output.clone();
    let sink: OutSink = Arc::new(move |event| capture_output.lock().push(event));
    let old = spawn_with_sink(&shell.opts, &shell.settings, sink.clone())
        .instrument(tracing::dispatcher::with_default(&dispatch, || {
            diagnostics::operation_span(Some(START_OPERATION))
        }))
        .with_subscriber(dispatch.clone())
        .await
        .unwrap();
    assert_eq!(&*old.session_id.read(), SESSION);
    let error = send_command(
        &old,
        json!({"type":"prompt","message":"DIAG_SECRET_SENTINEL"}),
    )
    .instrument(tracing::dispatcher::with_default(&dispatch, || {
        diagnostics::operation_span(Some(SEND_OPERATION))
    }))
    .with_subscriber(dispatch.clone())
    .await
    .unwrap_err();
    assert_eq!(error, "session_busy: DIAG_SECRET_SENTINEL");
    let replacement = spawn_with_sink(&shell.opts, &shell.settings, sink)
        .with_subscriber(dispatch.clone())
        .await
        .unwrap();
    rpc::registry()
        .write()
        .insert(SESSION.into(), replacement.clone());
    stop_handle_with_source(&old, "registration_replacement")
        .with_subscriber(dispatch.clone())
        .await
        .unwrap();
    old.wait_stdout_closed(Duration::from_secs(2)).await;
    assert!(Arc::ptr_eq(&rpc::registry().read()[SESSION], &replacement));
    assert!(!output
        .lock()
        .iter()
        .any(|event| matches!(event, OutEvent::Process { running: false, .. })));
    stop_handle(&replacement)
        .with_subscriber(dispatch)
        .await
        .unwrap();
    replacement.wait_stdout_closed(Duration::from_secs(2)).await;
    let events = captured.events();
    let rejected = event(&events, "rpc.command_finished", Some("upstream_rejected"));
    assert_eq!(rejected["fields"]["upstreamCode"], "session_busy");
    assert_eq!(rejected["fields"]["sessionId"], SESSION);
    assert_eq!(rejected["fields"]["childPid"], old.pid);
    assert_eq!(rejected["span"]["operationId"], SEND_OPERATION);
    let request = &rejected["fields"]["requestId"];
    assert!(events
        .iter()
        .any(|record| record["fields"]["event"] == "rpc.command_started"
            && record["fields"]["requestId"] == *request
            && record["fields"]["childPid"] == old.pid));
    let exits: Vec<_> = events
        .iter()
        .filter(|record| {
            record["fields"]["event"] == "rpc.lifecycle"
                && record["fields"]["source"] == "process_exit"
        })
        .collect();
    assert_eq!(exits.len(), 2);
    for exited in exits {
        assert!(exited.get("span").is_none());
        assert_eq!(exited["fields"]["exitCode"], 0);
    }
    assert!(events
        .iter()
        .any(|record| record["fields"]["source"] == "registration_replacement"));
    assert!(events
        .iter()
        .any(|record| record["fields"]["source"] == "explicit_stop"));
    assert!(!String::from_utf8(captured.bytes())
        .unwrap()
        .contains("DIAG_SECRET_SENTINEL"));
    export_fixture("upstream-replacement", &captured);
}

#[tokio::test]
async fn diagnostic_locked_rejection_keeps_unprefixed_error_and_cancellation_is_observed() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let handle = diagnostic_handle(tx);
    let (dispatch, captured) = capture();
    let responder = handle.clone();
    let task = tokio::spawn(
        async move {
            let command: Value = serde_json::from_str(&rx.recv().await.unwrap()).unwrap();
            apply_frame(
                &responder,
                &json!({
                    "type":"response", "id":command["id"], "success":false,
                    "code":"session_busy", "error":"DIAG_SECRET_SENTINEL"
                }),
            );
            let _ = rx.recv().await.unwrap();
            responder.shutdown.send_replace(true);
            responder.pending.fail_all("session is stopping");
        }
        .instrument(tracing::Span::none())
        .with_subscriber(dispatch.clone()),
    );
    let guard = handle.dispatch_lock.lock().await;
    let result = send_command_locked(&handle, json!({"type":"prompt"}))
        .with_subscriber(dispatch.clone())
        .await;
    drop(guard);
    assert_eq!(result.unwrap_err(), "DIAG_SECRET_SENTINEL");
    let cancelled = send_command(&handle, json!({"type":"prompt"}))
        .with_subscriber(dispatch)
        .await;
    assert_eq!(cancelled.unwrap_err(), "session is stopping");
    task.await.unwrap();
    let events = captured.events();
    let rejected = event(&events, "rpc.command_finished", Some("upstream_rejected"));
    assert_eq!(rejected["fields"]["upstreamCode"], "session_busy");
    let completed = events
        .iter()
        .rfind(|record| record["fields"]["event"] == "rpc.command_finished")
        .unwrap();
    assert_eq!(completed["fields"]["outcome"], "observed");
    assert!(completed["fields"].get("code").is_none());
    assert!(!String::from_utf8(captured.bytes())
        .unwrap()
        .contains("DIAG_SECRET_SENTINEL"));
}

#[cfg(unix)]
#[tokio::test]
async fn diagnostic_protocol_invalid_and_stdout_eof_are_not_io_errors() {
    let (dispatch, captured) = capture();
    let mut child = tokio::process::Command::new("/bin/sh")
        .args(["-c", "printf 'DIAG_SECRET_SENTINEL\\n'"])
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let handle = diagnostic_handle(mpsc::unbounded_channel().0);
    let (ready, _) = oneshot::channel();
    read_loop(
        Arc::new(|_| {}),
        handle,
        child.stdout.take().unwrap(),
        ready,
    )
    .with_subscriber(dispatch)
    .await;
    assert!(child.wait().await.unwrap().success());
    let events = captured.events();
    event(&events, "rpc.protocol_invalid", Some("protocol_invalid"));
    let closed = event(&events, "rpc.stdout_closed", None);
    assert_eq!(closed["fields"]["phase"], "eof");
    assert_eq!(closed["fields"]["outcome"], "observed");
    assert!(!events
        .iter()
        .any(|record| record["fields"]["event"] == "rpc.io_failed"));
    assert!(!String::from_utf8(captured.bytes())
        .unwrap()
        .contains("DIAG_SECRET_SENTINEL"));
}

#[cfg(unix)]
#[tokio::test]
async fn diagnostic_stdout_invalid_utf8_reports_read_failure_not_eof() {
    let (dispatch, captured) = capture();
    let mut child = tokio::process::Command::new("/bin/sh")
        .args(["-c", r"printf '\377\n'"])
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let handle = diagnostic_handle(mpsc::unbounded_channel().0);
    let (ready, _) = oneshot::channel();
    read_loop(
        Arc::new(|_| {}),
        handle,
        child.stdout.take().unwrap(),
        ready,
    )
    .with_subscriber(dispatch)
    .await;
    assert!(child.wait().await.unwrap().success());
    let events = captured.events();
    event(&events, "rpc.io_failed", Some("io_other"));
    let closed = event(&events, "rpc.stdout_closed", Some("io_other"));
    assert_eq!(closed["fields"]["phase"], "read");
    assert_eq!(closed["fields"]["outcome"], "error");
}

#[tokio::test]
async fn diagnostic_invalid_commands_finish_without_allocating_request_identity() {
    let (tx, _rx) = mpsc::unbounded_channel();
    let handle = diagnostic_handle(tx);
    let (dispatch, captured) = capture();
    assert_eq!(
        send_command(&handle, Value::Null)
            .with_subscriber(dispatch.clone())
            .await
            .unwrap_err(),
        "command must be a JSON object"
    );
    let guard = handle.dispatch_lock.lock().await;
    assert_eq!(
        send_command_locked(&handle, Value::Null)
            .with_subscriber(dispatch)
            .await
            .unwrap_err(),
        "command must be a JSON object"
    );
    drop(guard);
    let events = captured.events();
    assert_eq!(events.len(), 2);
    for record in events {
        assert_eq!(record["fields"]["event"], "rpc.command_finished");
        assert_eq!(record["fields"]["phase"], "validate");
        assert_eq!(record["fields"]["code"], "invalid_command");
        assert!(record["fields"].get("requestId").is_none());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn diagnostic_normal_stop_records_observation_without_failure() {
    let shell = FakeShell::responding();
    let (dispatch, captured) = capture();
    let handle = spawn_with_sink(&shell.opts, &shell.settings, Arc::new(|_| {}))
        .instrument(tracing::dispatcher::with_default(&dispatch, || {
            diagnostics::operation_span(Some(START_OPERATION))
        }))
        .with_subscriber(dispatch.clone())
        .await
        .unwrap();
    stop_handle(&handle)
        .with_subscriber(dispatch)
        .await
        .unwrap();
    handle.wait_stdout_closed(Duration::from_secs(2)).await;
    let events = captured.events();
    assert!(!events.iter().any(|record| record["level"] == "ERROR"));
    let stopped = events
        .iter()
        .find(|record| record["fields"]["source"] == "explicit_stop")
        .unwrap();
    assert_eq!(stopped["fields"]["sessionId"], SESSION);
    assert_eq!(stopped["fields"]["childPid"], handle.pid);
    let exited = events
        .iter()
        .find(|record| record["fields"]["source"] == "process_exit")
        .unwrap();
    assert_eq!(exited["fields"]["exitCode"], 0);
    assert!(exited.get("span").is_none());
    export_fixture("normal-stop", &captured);
}
