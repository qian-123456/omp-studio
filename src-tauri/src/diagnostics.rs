//! Content-free, bounded local evidence. Queue acceptance is not a durability promise.
#[cfg(test)]
use std::borrow::Cow;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, OnceLock};
use std::time::Duration;

use parking_lot::{Mutex, MutexGuard};
use serde::Deserialize;
use tracing_appender::non_blocking::{ErrorCounter, NonBlocking, NonBlockingBuilder, WorkerGuard};
use tracing_subscriber::filter::filter_fn;
use tracing_subscriber::prelude::*;
use uuid::Uuid;

use crate::contracts::{
    DiagnosticAck, DiagnosticAckStatus, DiagnosticCode, DiagnosticContext, DiagnosticExitIntent,
    DiagnosticOutcome, FrontendDiagnosticEvent, FrontendDiagnosticInput, FrontendDiagnosticSource,
};

const TARGET: &str = "ompws.diagnostics";
const FILE_BYTES: u64 = 2 * 1024 * 1024;
const LINE_BYTES: usize = 8 * 1024;
const INVALID_BATCH: &str = "diagnostics_invalid_batch";
#[cfg(test)]
const NIL_UUID: &str = "00000000-0000-0000-0000-000000000000";

/// Every field is a scalar from the approved schema, never a message or payload.
#[derive(Debug)]
pub struct DiagnosticEvent {
    pub event: &'static str,
    pub source: &'static str,
    pub origin: &'static str,
    pub occurred_at: Option<String>,
    pub session_id: Option<String>,
    pub child_pid: Option<u32>,
    pub request_id: Option<String>,
    pub command: Option<String>,
    pub phase: Option<String>,
    pub outcome: Option<String>,
    pub code: Option<String>,
    pub upstream_code: Option<String>,
    pub duration_ms: Option<f64>,
    pub source_file: Option<String>,
    pub source_line: Option<u32>,
    pub source_column: Option<u32>,
    pub frames: Option<String>,
    pub exit_code: Option<i32>,
    pub exit_signal: Option<i32>,
    pub exit_intent: Option<String>,
    pub alive: Option<bool>,
    pub streaming: Option<bool>,
    pub settled: Option<bool>,
    pub async_work: Option<bool>,
    pub subagents: Option<u64>,
    pub pending_ui: Option<u64>,
    pub pending_commands: Option<u64>,
    pub shutdown_requested: Option<bool>,
    pub removed_rows: Option<u32>,
    pub dropped_events: Option<u64>,
    pub write_failures: Option<u64>,
    pub rejected_events: Option<u64>,
    pub app_version: Option<String>,
    pub debug_build: Option<bool>,
    pub executable_modified_at: Option<String>,
}

impl Default for DiagnosticEvent {
    fn default() -> Self {
        Self {
            event: "",
            source: "",
            origin: "backend",
            occurred_at: None,
            session_id: None,
            child_pid: None,
            request_id: None,
            command: None,
            phase: None,
            outcome: None,
            code: None,
            upstream_code: None,
            duration_ms: None,
            source_file: None,
            source_line: None,
            source_column: None,
            frames: None,
            exit_code: None,
            exit_signal: None,
            exit_intent: None,
            alive: None,
            streaming: None,
            settled: None,
            async_work: None,
            subagents: None,
            pending_ui: None,
            pending_commands: None,
            shutdown_requested: None,
            removed_rows: None,
            dropped_events: None,
            write_failures: None,
            rejected_events: None,
            app_version: None,
            debug_build: None,
            executable_modified_at: None,
        }
    }
}

impl DiagnosticEvent {
    pub fn new(event: &'static str, source: &'static str) -> Self {
        Self {
            event,
            source,
            origin: "backend",
            ..Self::default()
        }
    }
}

#[derive(Default)]
struct Counters {
    frontend_dropped: AtomicU64,
    write_failures: AtomicU64,
    rejected_events: AtomicU64,
}

fn increment(counter: &AtomicU64, count: u64) {
    let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
        Some(value.saturating_add(count))
    });
}

fn counters() -> &'static Arc<Counters> {
    static COUNTERS: LazyLock<Arc<Counters>> = LazyLock::new(|| Arc::new(Counters::default()));
    &COUNTERS
}

#[derive(Clone)]
struct Metadata {
    app_run_id: String,
    app_pid: u32,
}

struct HealthTask {
    stop: std::sync::mpsc::Sender<()>,
    thread: std::thread::JoinHandle<()>,
}

struct Admission {
    enabled: bool,
    stopped: bool,
    worker: Option<WorkerGuard>,
    queue_errors: Option<ErrorCounter>,
    retired_dropped: u64,
    #[cfg(unix)]
    output: Option<Arc<Mutex<Option<BoundedWriter>>>>,
}

#[derive(Clone, Default)]
struct RoutingWriter(Arc<Mutex<Option<NonBlocking>>>);

struct RoutedWriter<'a>(MutexGuard<'a, Option<NonBlocking>>);

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for RoutingWriter {
    type Writer = RoutedWriter<'a>;

    fn make_writer(&'a self) -> Self::Writer {
        RoutedWriter(self.0.lock())
    }
}

impl Write for RoutedWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        match self.0.as_mut() {
            Some(writer) => writer.write(bytes),
            None => Ok(bytes.len()),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self.0.as_mut() {
            Some(writer) => writer.flush(),
            None => Ok(()),
        }
    }
}

#[cfg(unix)]
struct GenerationWriter(Arc<Mutex<Option<BoundedWriter>>>);

#[cfg(unix)]
impl Write for GenerationWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        match self.0.lock().as_mut() {
            Some(writer) => writer.write(bytes),
            None => Ok(bytes.len()),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self.0.lock().as_mut() {
            Some(writer) => writer.flush(),
            None => Ok(()),
        }
    }
}

struct Runtime {
    metadata: Metadata,
    root: PathBuf,
    admission: Mutex<Admission>,
    writer: RoutingWriter,
    counters: Arc<Counters>,
    health: Mutex<Option<HealthTask>>,
}

impl Runtime {
    fn new(
        root: &Path,
        enabled: bool,
        counters: Arc<Counters>,
    ) -> Result<Self, DiagnosticInitError> {
        let runtime = Self {
            metadata: Metadata {
                app_run_id: Uuid::new_v4().to_string(),
                app_pid: std::process::id(),
            },
            root: root.to_path_buf(),
            admission: Mutex::new(Admission {
                enabled: false,
                stopped: false,
                worker: None,
                queue_errors: None,
                retired_dropped: 0,
                #[cfg(unix)]
                output: None,
            }),
            writer: RoutingWriter::default(),
            counters,
            health: Mutex::new(None),
        };
        // Disabled startup does not open or create any diagnostic storage.
        if enabled {
            runtime.open(&mut runtime.admission.lock())?;
        }
        Ok(runtime)
    }

    #[cfg(not(unix))]
    fn open(&self, _admission: &mut Admission) -> Result<(), DiagnosticInitError> {
        Err(DiagnosticInitError::UnsupportedPlatform)
    }

    #[cfg(unix)]
    fn open(&self, admission: &mut Admission) -> Result<(), DiagnosticInitError> {
        let output = Arc::new(Mutex::new(Some(
            BoundedWriter::new(&self.root, self.counters.clone(), FILE_BYTES, LINE_BYTES)
                .map_err(|_| DiagnosticInitError::StorageUnavailable)?,
        )));
        let (writer, guard) = NonBlockingBuilder::default()
            .buffered_lines_limit(1024)
            .lossy(true)
            .thread_name("ompws-diagnostics")
            .finish(GenerationWriter(output.clone()));
        admission.queue_errors = Some(writer.error_counter());
        admission.worker = Some(guard);
        admission.output = Some(output);
        *self.writer.0.lock() = Some(writer);
        admission.enabled = true;
        Ok(())
    }

    fn close(&self, admission: &mut Admission) {
        admission.enabled = false;
        self.writer.0.lock().take();
        // Keep admission locked through the official bounded drain. No producer
        // or re-enable can race this generation's retirement.
        drop(admission.worker.take());
        #[cfg(unix)]
        if let Some(output) = admission.output.take() {
            // WorkerGuard may time out. Revoke its storage under the same lock
            // used for actual writes, so even a late old worker cannot replay.
            output.lock().take();
        }
        if let Some(errors) = admission.queue_errors.take() {
            admission.retired_dropped = admission
                .retired_dropped
                .saturating_add(errors.dropped_lines() as u64);
        }
    }

    fn emit(&self, event: DiagnosticEvent) {
        let admission = self.admission.lock();
        if !admission.enabled || admission.stopped {
            return;
        }
        if !valid_event(&event) {
            increment(&self.counters.rejected_events, 1);
            return;
        }
        emit_with_metadata(event, &self.metadata);
    }

    fn set_enabled(&self, enabled: bool) {
        let mut admission = self.admission.lock();
        if admission.stopped || admission.enabled == enabled {
            return;
        }
        if enabled {
            if self.open(&mut admission).is_err() {
                increment(&self.counters.write_failures, 1);
            }
        } else {
            self.close(&mut admission);
        }
    }

    fn ack(&self, admission: &Admission, accepted: u16) -> DiagnosticAck {
        let dropped = admission.retired_dropped.saturating_add(
            admission
                .queue_errors
                .as_ref()
                .map_or(0, |errors| errors.dropped_lines() as u64),
        );
        make_ack(
            &self.counters,
            admission.enabled && !admission.stopped,
            accepted,
            dropped,
        )
    }

    fn record(&self, body: &tauri::ipc::InvokeBody) -> Result<DiagnosticAck, String> {
        let admission = self.admission.lock();
        if !admission.enabled || admission.stopped {
            return Ok(self.ack(&admission, 0));
        }
        let result = record_request_body(body, true, &self.counters, |event| {
            emit_with_metadata(event, &self.metadata)
        })?;
        Ok(self.ack(&admission, result.accepted))
    }

    fn health_event(&self, admission: &Admission) -> DiagnosticEvent {
        let health = self.ack(admission, 0);
        let mut event = DiagnosticEvent::new("diagnostics.health", "startup");
        event.dropped_events = Some(health.dropped_events);
        event.write_failures = Some(health.write_failures);
        event.rejected_events = Some(health.rejected_events);
        event
    }

    fn record_health(&self) {
        let admission = self.admission.lock();
        if admission.enabled && !admission.stopped {
            emit_with_metadata(self.health_event(&admission), &self.metadata);
        }
    }

    fn shutdown(&self) {
        {
            let mut admission = self.admission.lock();
            if admission.stopped {
                return;
            }
            if admission.enabled {
                // Final health must be admitted before closing the gate.
                emit_with_metadata(self.health_event(&admission), &self.metadata);
            }
            admission.stopped = true;
            self.close(&mut admission);
        }
        if let Some(health) = self.health.lock().take() {
            let _ = health.stop.send(());
            let _ = health.thread.join();
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

static RUNTIME: OnceLock<Runtime> = OnceLock::new();
static INIT_ATTEMPTED: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
fn metadata() -> Cow<'static, Metadata> {
    #[cfg(test)]
    if let Some(value) = test_support::metadata_override() {
        return Cow::Owned(value);
    }
    static FALLBACK: LazyLock<Metadata> = LazyLock::new(|| Metadata {
        app_run_id: NIL_UUID.into(),
        app_pid: std::process::id(),
    });
    Cow::Borrowed(
        RUNTIME
            .get()
            .map_or(&*FALLBACK, |runtime| &runtime.metadata),
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticInitError {
    #[cfg(not(unix))]
    UnsupportedPlatform,
    StorageUnavailable,
    SubscriberConflict,
    AlreadyInitialized,
}

impl DiagnosticInitError {
    pub fn as_str(self) -> &'static str {
        match self {
            #[cfg(not(unix))]
            Self::UnsupportedPlatform => "unsupported_platform",
            Self::StorageUnavailable => "storage_unavailable",
            Self::SubscriberConflict => "subscriber_conflict",
            Self::AlreadyInitialized => "already_initialized",
        }
    }
}

impl std::fmt::Display for DiagnosticInitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}
impl std::error::Error for DiagnosticInitError {}

pub struct DiagnosticsGuard {
    _private: (),
}
impl Drop for DiagnosticsGuard {
    fn drop(&mut self) {
        shutdown();
    }
}

pub fn init(root: &Path, enabled: bool) -> Result<DiagnosticsGuard, DiagnosticInitError> {
    if INIT_ATTEMPTED.swap(true, Ordering::AcqRel) {
        return Err(DiagnosticInitError::AlreadyInitialized);
    }
    let result = init_inner(root, enabled);
    if enabled {
        if let Err(error) = result.as_ref() {
            // No paths, OS messages, or recursive tracing on this failure path.
            eprintln!("diagnostics_disabled:{}", error.as_str());
        }
    }
    result
}

#[cfg(not(unix))]
fn init_inner(_root: &Path, _enabled: bool) -> Result<DiagnosticsGuard, DiagnosticInitError> {
    Err(DiagnosticInitError::UnsupportedPlatform)
}

#[cfg(unix)]
fn init_inner(root: &Path, enabled: bool) -> Result<DiagnosticsGuard, DiagnosticInitError> {
    let runtime = Runtime::new(root, enabled, counters().clone())?;
    let subscriber = tracing_subscriber::registry().with(json_layer(runtime.writer.clone()));
    tracing::subscriber::set_global_default(subscriber)
        .map_err(|_| DiagnosticInitError::SubscriberConflict)?;
    // INIT_ATTEMPTED serializes the only writer to this cell.
    let _ = RUNTIME.set(runtime);
    Ok(DiagnosticsGuard { _private: () })
}

fn json_layer<S, W>(writer: W) -> impl tracing_subscriber::Layer<S>
where
    S: tracing::Subscriber + for<'a> tracing_subscriber::registry::LookupSpan<'a>,
    W: for<'a> tracing_subscriber::fmt::MakeWriter<'a> + Send + Sync + 'static,
{
    tracing_subscriber::fmt::layer()
        .json()
        .with_ansi(false)
        .with_thread_names(false)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .with_current_span(true)
        .with_span_list(false)
        .with_writer(writer)
        .with_filter(filter_fn(|metadata| metadata.target() == TARGET))
}

/// A fresh root span, never an inherited startup span. Invalid IDs cannot break RPC.
pub fn operation_span(operation_id: Option<&str>) -> tracing::Span {
    let generated;
    let id = if let Some(id) = operation_id.filter(|id| valid_uuid(id)) {
        id
    } else {
        generated = Uuid::new_v4().to_string();
        &generated
    };
    tracing::info_span!(target: TARGET, parent: None, "operation", operationId = id)
}

pub fn emit(event: DiagnosticEvent) {
    if let Some(runtime) = RUNTIME.get() {
        runtime.emit(event);
        #[cfg(test)]
        return;
    }
    // Existing scoped subscriber fixtures never install the process singleton.
    #[cfg(test)]
    if valid_event(&event) {
        emit_with_metadata(event, &metadata());
    }
}

/// Called only after the settings transaction succeeds under SAVE_LOCK.
pub fn set_enabled(enabled: bool) {
    if let Some(runtime) = RUNTIME.get() {
        runtime.set_enabled(enabled);
    }
}

fn emit_with_metadata(event: DiagnosticEvent, metadata: &Metadata) {
    let event_id = Uuid::new_v4();
    // tracing::event! supports 32 fields. Keep event-specific scalar groups
    // separate rather than encoding them as an object or replacing its formatter.
    macro_rules! record {
        ($level:expr; $($extra:tt)*) => {{
            tracing::event!(target: TARGET, $level,
                schemaVersion = 1u64, eventId = %event_id,
                appRunId = metadata.app_run_id.as_str(), appPid = metadata.app_pid,
                event = event.event, origin = event.origin, source = event.source,
                sessionId = event.session_id.as_deref(), childPid = event.child_pid,
                requestId = event.request_id.as_deref(), command = event.command.as_deref(),
                phase = event.phase.as_deref(), outcome = event.outcome.as_deref(),
                code = event.code.as_deref(), upstreamCode = event.upstream_code.as_deref(),
                durationMs = event.duration_ms, sourceFile = event.source_file.as_deref(),
                sourceLine = event.source_line, sourceColumn = event.source_column,
                exitCode = event.exit_code, exitSignal = event.exit_signal,
                exitIntent = event.exit_intent.as_deref(), alive = event.alive,
                streaming = event.streaming, $($extra)*
            );
        }};
        ($level:expr) => {
            match event.event {
                "app.started" => record!($level;
                    appVersion = event.app_version.as_deref(), debugBuild = event.debug_build,
                    executableModifiedAt = event.executable_modified_at.as_deref()),
                "diagnostics.health" => record!($level;
                    droppedEvents = event.dropped_events, writeFailures = event.write_failures,
                    rejectedEvents = event.rejected_events),
                "rpc.lifecycle" => record!($level;
                    settled = event.settled, asyncWork = event.async_work, subagents = event.subagents,
                    pendingUi = event.pending_ui, pendingCommands = event.pending_commands,
                    shutdownRequested = event.shutdown_requested),
                _ => record!($level;
                    occurredAt = event.occurred_at.as_deref(), frames = event.frames.as_deref(),
                    removedRows = event.removed_rows),
            }
        };
    }
    let warning = event.event == "rpc.protocol_invalid"
        || event.event == "frontend.state_reconciled"
        || matches!(event.code.as_deref(), Some("cwd_missing" | "session_held"));
    let failure = event.outcome.as_deref() == Some("error")
        || event.code.is_some()
        || matches!(
            event.event,
            "app.panic"
                | "app.startup_failed"
                | "frontend.error"
                | "rpc.spawn_failed"
                | "rpc.io_failed"
        );
    if warning {
        record!(tracing::Level::WARN);
    } else if failure {
        record!(tracing::Level::ERROR);
    } else if event.duration_ms.is_some_and(|duration| duration >= 2000.0) {
        record!(tracing::Level::WARN);
    } else {
        record!(tracing::Level::INFO);
    }
}

fn make_ack(
    counters: &Counters,
    enabled: bool,
    accepted: u16,
    queue_dropped: u64,
) -> DiagnosticAck {
    DiagnosticAck {
        status: if enabled {
            DiagnosticAckStatus::Accepted
        } else {
            DiagnosticAckStatus::Disabled
        },
        accepted,
        dropped_events: counters
            .frontend_dropped
            .load(Ordering::Relaxed)
            .saturating_add(queue_dropped),
        write_failures: counters.write_failures.load(Ordering::Relaxed),
        rejected_events: counters.rejected_events.load(Ordering::Relaxed),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrontendDiagnosticBatch {
    events: Vec<FrontendDiagnosticInput>,
    dropped_events: u64,
}

#[tauri::command]
pub async fn diagnostics_record(request: tauri::ipc::Request<'_>) -> Result<DiagnosticAck, String> {
    let Some(runtime) = RUNTIME.get() else {
        return Ok(make_ack(counters(), false, 0, 0));
    };
    runtime.record(request.body())
}

fn record_request_body(
    body: &tauri::ipc::InvokeBody,
    enabled: bool,
    counters: &Counters,
    sink: impl FnMut(DiagnosticEvent),
) -> Result<DiagnosticAck, String> {
    // Decode the entire envelope here, never through Tauri's typed arguments:
    // serde errors can contain untrusted field names, enum values, or scalars.
    let batch = match body {
        tauri::ipc::InvokeBody::Json(value)
            if value
                .get("events")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|events| {
                    events.len() <= 20
                        && events.iter().all(|event| {
                            let mut count = ByteCounter(0);
                            serde_json::to_writer(&mut count, event).is_ok() && count.0 <= 4096
                        })
                }) =>
        {
            FrontendDiagnosticBatch::deserialize(value).ok()
        }
        tauri::ipc::InvokeBody::Json(_) | tauri::ipc::InvokeBody::Raw(_) => None,
    };
    let Some(batch) = batch else {
        let rejected = match body {
            tauri::ipc::InvokeBody::Json(value) => value
                .get("events")
                .and_then(serde_json::Value::as_array)
                .map_or(1, |events| events.len().max(1) as u64),
            tauri::ipc::InvokeBody::Raw(_) => 1,
        };
        increment(&counters.rejected_events, rejected);
        return Err(INVALID_BATCH.into());
    };
    record_batch(batch.events, batch.dropped_events, enabled, counters, sink)
}

fn record_batch(
    events: Vec<FrontendDiagnosticInput>,
    dropped_events: u64,
    enabled: bool,
    counters: &Counters,
    mut sink: impl FnMut(DiagnosticEvent),
) -> Result<DiagnosticAck, String> {
    // Validate everything before observing dropped counts or emitting any member.
    if events.len() > 20 || events.iter().any(|event| !valid_frontend(event)) {
        increment(&counters.rejected_events, events.len().max(1) as u64);
        return Err(INVALID_BATCH.into());
    }
    increment(&counters.frontend_dropped, dropped_events);
    let accepted = if enabled { events.len() as u16 } else { 0 };
    if enabled {
        for input in events {
            let (operation_id, event) = frontend_event(input);
            // No fabricated operation ID on uncorrelated frontend observations.
            if let Some(id) = operation_id.as_deref() {
                let span = operation_span(Some(id));
                let _entered = span.enter();
                sink(event);
            } else {
                let _root = tracing::span!(target: TARGET, parent: None, tracing::Level::INFO, "observation").entered();
                sink(event);
            }
        }
    }
    Ok(make_ack(counters, enabled, accepted, 0))
}

fn frontend_event(input: FrontendDiagnosticInput) -> (Option<String>, DiagnosticEvent) {
    // Move the validated optional context without cloning its owned strings.
    // The closed wire input remains separate: serde flatten would weaken it.
    let context = DiagnosticContext {
        operation_id: input.operation_id,
        session_id: input.session_id,
        command: input.command,
        code: input.code,
        outcome: input.outcome,
        duration_ms: input.duration_ms,
        source_file: input.source_file,
        source_line: input.source_line,
        source_column: input.source_column,
        alive: input.alive,
        streaming: input.streaming,
        removed_rows: input.removed_rows,
        exit_code: input.exit_code,
        exit_intent: input.exit_intent,
    };
    let mut event = DiagnosticEvent::new(
        frontend_event_name(input.event),
        frontend_source_name(input.source),
    );
    event.origin = "frontend";
    event.occurred_at = Some(input.occurred_at);
    event.session_id = context.session_id;
    event.command = context.command;
    event.code = context.code.map(|v| code_name(v).into());
    event.outcome = context.outcome.map(|v| outcome_name(v).into());
    event.duration_ms = context.duration_ms;
    event.source_file = context.source_file;
    event.source_line = context.source_line;
    event.source_column = context.source_column;
    event.frames = input.frames;
    event.alive = context.alive;
    event.streaming = context.streaming;
    event.removed_rows = context.removed_rows;
    event.exit_code = context.exit_code;
    event.exit_intent = context.exit_intent.map(|v| {
        match v {
            DiagnosticExitIntent::Stop => "stop",
            DiagnosticExitIntent::Restart => "restart",
            DiagnosticExitIntent::Other => "other",
        }
        .into()
    });
    (context.operation_id, event)
}

fn frontend_event_name(value: FrontendDiagnosticEvent) -> &'static str {
    match value {
        FrontendDiagnosticEvent::IpcStarted => "frontend.ipc_started",
        FrontendDiagnosticEvent::IpcFinished => "frontend.ipc_finished",
        FrontendDiagnosticEvent::Error => "frontend.error",
        FrontendDiagnosticEvent::StateReconciled => "frontend.state_reconciled",
        FrontendDiagnosticEvent::ProcessObserved => "frontend.process_observed",
        FrontendDiagnosticEvent::ReconnectStarted => "frontend.reconnect_started",
        FrontendDiagnosticEvent::ReconnectFinished => "frontend.reconnect_finished",
    }
}

fn frontend_source_name(value: FrontendDiagnosticSource) -> &'static str {
    match value {
        FrontendDiagnosticSource::Bootstrap => "bootstrap",
        FrontendDiagnosticSource::RootBoundary => "root_boundary",
        FrontendDiagnosticSource::AppBoundary => "app_boundary",
        FrontendDiagnosticSource::AsideBoundary => "aside_boundary",
        FrontendDiagnosticSource::WindowError => "window_error",
        FrontendDiagnosticSource::UnhandledRejection => "unhandled_rejection",
        FrontendDiagnosticSource::ResourceError => "resource_error",
        FrontendDiagnosticSource::Ipc => "ipc",
        FrontendDiagnosticSource::StateReconcile => "state_reconcile",
        FrontendDiagnosticSource::ProcessObserved => "process_observed",
        FrontendDiagnosticSource::Reconnect => "reconnect",
    }
}

fn code_name(value: DiagnosticCode) -> &'static str {
    match value {
        DiagnosticCode::InvalidCommand => "invalid_command",
        DiagnosticCode::NotLive => "not_live",
        DiagnosticCode::ProcessNotRunning => "process_not_running",
        DiagnosticCode::StdinClosed => "stdin_closed",
        DiagnosticCode::CommandTimeout => "command_timeout",
        DiagnosticCode::ResponseChannelClosed => "response_channel_closed",
        DiagnosticCode::UpstreamRejected => "upstream_rejected",
        DiagnosticCode::SpawnFailed => "spawn_failed",
        DiagnosticCode::StartupTimeout => "startup_timeout",
        DiagnosticCode::ProtocolInvalid => "protocol_invalid",
        DiagnosticCode::IoPermissionDenied => "io_permission_denied",
        DiagnosticCode::IoNotFound => "io_not_found",
        DiagnosticCode::IoOther => "io_other",
        DiagnosticCode::CwdMissing => "cwd_missing",
        DiagnosticCode::SessionHeld => "session_held",
        DiagnosticCode::UnexpectedError => "unexpected_error",
        DiagnosticCode::JsError => "js_error",
        DiagnosticCode::PromiseRejection => "promise_rejection",
        DiagnosticCode::ResourceLoadError => "resource_load_error",
    }
}

fn outcome_name(value: DiagnosticOutcome) -> &'static str {
    match value {
        DiagnosticOutcome::Ok => "ok",
        DiagnosticOutcome::Error => "error",
        DiagnosticOutcome::Reused => "reused",
        DiagnosticOutcome::Resumed => "resumed",
        DiagnosticOutcome::Observed => "observed",
    }
}

pub fn command_name(command: &str) -> &'static str {
    match command {
        "prompt" => "prompt",
        "steer" => "steer",
        "follow_up" => "follow_up",
        "abort" => "abort",
        "abort_and_prompt" => "abort_and_prompt",
        "abort_and_restore_queue" => "abort_and_restore_queue",
        "compact" => "compact",
        "handoff" => "handoff",
        "get_state" => "get_state",
        "get_subagents" => "get_subagents",
        "negotiate" | "negotiate_protocol" => "negotiate",
        "new_session" => "new_session",
        _ => "other",
    }
}

/// Only established fixed texts/prefixes; arbitrary error prose is never persisted or guessed.
pub fn classify_error(error: &str) -> &'static str {
    match error {
        "command must be a JSON object" => "invalid_command",
        "session is not live" => "not_live",
        "session process is not running" => "process_not_running",
        "session stdin closed" => "stdin_closed",
        "command timed out" => "command_timeout",
        "response channel dropped" => "response_channel_closed",
        value if value.starts_with("CWD_MISSING:") => "cwd_missing",
        value if value.starts_with("SESSION_HELD:") => "session_held",
        _ => "unexpected_error",
    }
}

fn valid_uuid(value: &str) -> bool {
    value.len() == 36
        && [8, 13, 18, 23].iter().all(|&i| value.as_bytes()[i] == b'-')
        && Uuid::parse_str(value).is_ok()
}

fn valid_timestamp(value: &str) -> bool {
    value.len() <= 40
        && value.ends_with('Z')
        && value.as_bytes().get(10) == Some(&b'T')
        && chrono::DateTime::parse_from_rfc3339(value)
            .is_ok_and(|time| time.offset().local_minus_utc() == 0)
}

fn valid_command(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_source_file(value: &str, backend: bool) -> bool {
    if value.len() > 256
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_./@+-".contains(&b))
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return false;
    }
    if backend {
        value.starts_with("src-tauri/") && value.len() > 10
    } else {
        (value.starts_with("src/") && value.len() > 4)
            || (value.starts_with("assets/") && value.len() > 7 && !value[7..].contains('/'))
    }
}

fn valid_frames(value: &str) -> bool {
    if value.is_empty() || value.len() > 2048 || value.lines().count() > 8 {
        return false;
    }
    value.split('\n').all(|line| {
        let mut parts = line.rsplitn(3, ':');
        let positive = |part: Option<&str>| {
            part.is_some_and(|v| {
                !v.is_empty()
                    && v.bytes().all(|b| b.is_ascii_digit())
                    && v.parse::<u32>().is_ok_and(|n| n > 0)
            })
        };
        positive(parts.next())
            && positive(parts.next())
            && parts
                .next()
                .is_some_and(|path| valid_source_file(path, false))
    })
}

fn valid_duration(value: f64) -> bool {
    value.is_finite() && value >= 0.0 && value <= u64::MAX as f64
}

struct ByteCounter(usize);
impl Write for ByteCounter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0 = self.0.saturating_add(bytes.len());
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn valid_frontend(event: &FrontendDiagnosticInput) -> bool {
    if !valid_timestamp(&event.occurred_at)
        || event
            .operation_id
            .as_deref()
            .is_some_and(|id| !valid_uuid(id))
        || event
            .session_id
            .as_deref()
            .is_some_and(|id| !valid_uuid(id))
        || event
            .command
            .as_deref()
            .is_some_and(|command| !valid_command(command))
        || event
            .duration_ms
            .is_some_and(|value| !valid_duration(value))
        || event
            .source_file
            .as_deref()
            .is_some_and(|path| !valid_source_file(path, false))
        || event.source_line == Some(0)
        || event.source_column == Some(0)
        || ((event.source_line.is_some() || event.source_column.is_some())
            && event.source_file.is_none())
        || event
            .frames
            .as_deref()
            .is_some_and(|frames| !valid_frames(frames))
    {
        return false;
    }
    let mut count = ByteCounter(0);
    serde_json::to_writer(&mut count, event).is_ok() && count.0 <= 4096
}

fn valid_event(event: &DiagnosticEvent) -> bool {
    const EVENTS: &[&str] = &[
        "app.started",
        "app.exit",
        "app.startup_failed",
        "app.panic",
        "diagnostics.health",
        "rpc.lifecycle",
        "rpc.command_started",
        "rpc.command_finished",
        "rpc.spawn_started",
        "rpc.spawn_ready",
        "rpc.spawn_failed",
        "rpc.io_failed",
        "rpc.protocol_invalid",
        "rpc.stdout_closed",
        "rpc.resume_started",
        "rpc.resume_finished",
        "rpc.invoke_started",
        "rpc.invoke_finished",
        "frontend.ipc_started",
        "frontend.ipc_finished",
        "frontend.error",
        "frontend.state_reconciled",
        "frontend.process_observed",
        "frontend.reconnect_started",
        "frontend.reconnect_finished",
    ];
    const SOURCES: &[&str] = &[
        "startup",
        "rpc",
        "stdin",
        "stdout",
        "other",
        "explicit_stop",
        "app_shutdown",
        "startup_missing_session_id",
        "registration_replacement",
        "external_writer_conflict",
        "explicit_restart",
        "privacy_refresh",
        "idle_suspension",
        "unused_draft_release",
        "spawn_aborted",
        "process_exit",
        "bootstrap",
        "root_boundary",
        "app_boundary",
        "aside_boundary",
        "window_error",
        "unhandled_rejection",
        "resource_error",
        "ipc",
        "state_reconcile",
        "process_observed",
        "reconnect",
    ];
    const CODES: &[&str] = &[
        "invalid_command",
        "not_live",
        "process_not_running",
        "stdin_closed",
        "command_timeout",
        "response_channel_closed",
        "upstream_rejected",
        "spawn_failed",
        "startup_timeout",
        "protocol_invalid",
        "io_permission_denied",
        "io_not_found",
        "io_other",
        "cwd_missing",
        "session_held",
        "unexpected_error",
        "js_error",
        "promise_rejection",
        "resource_load_error",
    ];
    EVENTS.contains(&event.event)
        && SOURCES.contains(&event.source)
        && matches!(event.origin, "frontend" | "backend")
        && (event.event.starts_with("frontend.") == (event.origin == "frontend"))
        && event.occurred_at.as_deref().is_none_or(valid_timestamp)
        && event.session_id.as_deref().is_none_or(valid_uuid)
        && event.request_id.as_deref().is_none_or(|value| {
            value.strip_prefix("req_").is_some_and(|digits| {
                !digits.is_empty()
                    && digits.len() <= 20
                    && digits.bytes().all(|b| b.is_ascii_digit())
            })
        })
        && event.command.as_deref().is_none_or(|value| {
            if event.origin == "frontend" {
                valid_command(value)
            } else {
                command_name(value) == value
                    || [
                        "rpc_start",
                        "rpc_ensure_live",
                        "rpc_send",
                        "rpc_stop",
                        "rpc_restart",
                    ]
                    .contains(&value)
            }
        })
        && event.phase.as_deref().is_none_or(|value| {
            [
                "validate",
                "dispatch",
                "response",
                "spawn",
                "ready",
                "negotiate",
                "get_state",
                "subscription",
                "new_session",
                "ensure_dirs",
                "database",
                "global_workspace",
                "tauri_setup",
                "tauri_build",
                "read",
                "write",
                "eof",
            ]
            .contains(&value)
        })
        && event
            .outcome
            .as_deref()
            .is_none_or(|value| ["ok", "error", "reused", "resumed", "observed"].contains(&value))
        && event
            .code
            .as_deref()
            .is_none_or(|value| CODES.contains(&value))
        && event
            .upstream_code
            .as_deref()
            .is_none_or(|value| ["session_busy", "other"].contains(&value))
        && event.duration_ms.is_none_or(valid_duration)
        && event
            .source_file
            .as_deref()
            .is_none_or(|value| valid_source_file(value, event.origin == "backend"))
        && event.source_line != Some(0)
        && event.source_column != Some(0)
        && ((event.source_line.is_none() && event.source_column.is_none())
            || event.source_file.is_some())
        && event.frames.as_deref().is_none_or(valid_frames)
        && event
            .exit_intent
            .as_deref()
            .is_none_or(|value| ["stop", "restart", "other"].contains(&value))
        && (event.event == "app.started"
            || (event.app_version.is_none()
                && event.debug_build.is_none()
                && event.executable_modified_at.is_none()))
        && (event.event == "diagnostics.health"
            || (event.dropped_events.is_none()
                && event.write_failures.is_none()
                && event.rejected_events.is_none()))
        && (event.event == "rpc.lifecycle"
            || (event.settled.is_none()
                && event.async_work.is_none()
                && event.subagents.is_none()
                && event.pending_ui.is_none()
                && event.pending_commands.is_none()
                && event.shutdown_requested.is_none()))
        && (!["app.started", "diagnostics.health", "rpc.lifecycle"].contains(&event.event)
            || (event.occurred_at.is_none()
                && event.frames.is_none()
                && event.removed_rows.is_none()))
        && event
            .app_version
            .as_deref()
            .is_none_or(|value| value == env!("CARGO_PKG_VERSION"))
        && event
            .executable_modified_at
            .as_deref()
            .is_none_or(valid_timestamp)
}

pub fn record_app_started() {
    let mut event = DiagnosticEvent::new("app.started", "startup");
    event.app_version = Some(env!("CARGO_PKG_VERSION").into());
    event.debug_build = Some(cfg!(debug_assertions));
    event.executable_modified_at = std::env::current_exe()
        .ok()
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|m| m.modified().ok())
        .map(|time| {
            chrono::DateTime::<chrono::Utc>::from(time)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        });
    emit(event);
}

pub fn record_startup_failure(phase: &'static str) {
    let mut event = DiagnosticEvent::new("app.startup_failed", "startup");
    event.phase = Some(phase.into());
    event.outcome = Some("error".into());
    emit(event);
    shutdown();
}

fn panic_location(file: &str) -> Option<String> {
    let path = file.replace('\\', "/");
    let relative = path
        .strip_prefix("src-tauri/")
        .or_else(|| path.strip_prefix("src/"))
        .or_else(|| {
            path.rsplit_once("/src-tauri/src/")
                .map(|(_, suffix)| suffix)
        })?;
    let relative = relative.strip_prefix("src/").unwrap_or(relative);
    let value = format!("src-tauri/src/{relative}");
    valid_source_file(&value, true).then_some(value)
}

pub fn install_panic_hook() {
    static INSTALLED: AtomicBool = AtomicBool::new(false);
    if INSTALLED.swap(true, Ordering::AcqRel) {
        return;
    }
    let original = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let mut event = DiagnosticEvent::new("app.panic", "startup");
        if let Some(location) = info.location() {
            event.source_file = panic_location(location.file());
            if event.source_file.is_some() {
                event.source_line = Some(location.line());
                event.source_column = Some(location.column());
            }
        }
        emit(event);
        original(info);
    }));
}

fn record_health() {
    if let Some(runtime) = RUNTIME.get() {
        runtime.record_health();
    }
}

pub fn start_health_task() {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    let mut health = runtime.health.lock();
    if health.is_some() || runtime.admission.lock().stopped {
        return;
    }
    if let Ok(task) = spawn_health_task(Duration::from_secs(30), record_health) {
        *health = Some(task);
    }
}

fn spawn_health_task(
    interval: Duration,
    mut tick: impl FnMut() + Send + 'static,
) -> io::Result<HealthTask> {
    let (stop, receiver) = std::sync::mpsc::channel();
    // std::thread does not inherit the setup task's tracing span/dispatcher.
    let thread = std::thread::Builder::new()
        .name("ompws-diagnostic-health".into())
        .spawn(move || {
            while receiver.recv_timeout(interval) == Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            {
                tick();
            }
        })?;
    Ok(HealthTask { stop, thread })
}

pub fn shutdown() {
    if let Some(runtime) = RUNTIME.get() {
        runtime.shutdown();
    }
}

#[cfg(unix)]
mod storage {
    use super::*;
    use std::ffi::{CStr, CString};
    use std::fs::File;
    use std::os::fd::{AsRawFd, FromRawFd, RawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::PermissionsExt;

    const CURRENT: &CStr = c"events.jsonl";
    const PREVIOUS: &CStr = c"events.previous.jsonl";
    const LOCK: &CStr = c".writer.lock";

    fn cvt(result: libc::c_int) -> io::Result<libc::c_int> {
        if result < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(result)
        }
    }

    fn open_at(
        dir: RawFd,
        name: &CStr,
        flags: libc::c_int,
        mode: libc::mode_t,
    ) -> io::Result<File> {
        // O_NOFOLLOW applies to the final component; dir is an already verified directory FD.
        let fd = cvt(unsafe {
            libc::openat(
                dir,
                name.as_ptr(),
                flags | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
                libc::c_uint::from(mode),
            )
        })?;
        // SAFETY: a successful openat transfers a fresh owned descriptor.
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    fn regular(file: &File) -> io::Result<()> {
        if !file.metadata()?.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "diagnostics_non_regular",
            ));
        }
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
    }

    struct Lock<'a>(&'a File);
    impl<'a> Lock<'a> {
        fn acquire(file: &'a File) -> io::Result<Self> {
            loop {
                if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
                    return Ok(Self(file));
                }
                let error = io::Error::last_os_error();
                if error.kind() != io::ErrorKind::Interrupted {
                    return Err(error);
                }
            }
        }
    }
    impl Drop for Lock<'_> {
        fn drop(&mut self) {
            unsafe {
                libc::flock(self.0.as_raw_fd(), libc::LOCK_UN);
            }
        }
    }

    pub(super) struct BoundedWriter {
        directory: File,
        lock: File,
        pending: Vec<u8>,
        discarding: bool,
        counters: Arc<Counters>,
        file_bytes: u64,
        line_bytes: usize,
    }

    impl BoundedWriter {
        pub(super) fn new(
            root: &Path,
            counters: Arc<Counters>,
            file_bytes: u64,
            line_bytes: usize,
        ) -> io::Result<Self> {
            if line_bytes == 0 || line_bytes as u64 > file_bytes {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "diagnostics_limits",
                ));
            }
            let root = CString::new(root.as_os_str().as_bytes())
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "diagnostics_root"))?;
            let root = open_at(libc::AT_FDCWD, &root, libc::O_RDONLY | libc::O_DIRECTORY, 0)?;
            let result = unsafe { libc::mkdirat(root.as_raw_fd(), c"diagnostics".as_ptr(), 0o700) };
            if result < 0 && io::Error::last_os_error().kind() != io::ErrorKind::AlreadyExists {
                return Err(io::Error::last_os_error());
            }
            let directory = open_at(
                root.as_raw_fd(),
                c"diagnostics",
                libc::O_RDONLY | libc::O_DIRECTORY,
                0,
            )?;
            directory.set_permissions(std::fs::Permissions::from_mode(0o700))?;
            let lock = open_at(
                directory.as_raw_fd(),
                LOCK,
                libc::O_RDWR | libc::O_CREAT,
                0o600,
            )?;
            regular(&lock)?;
            let writer = Self {
                directory,
                lock,
                pending: Vec::with_capacity(line_bytes),
                discarding: false,
                counters,
                file_bytes,
                line_bytes,
            };
            {
                let _lock = Lock::acquire(&writer.lock)?;
                writer.open_current()?;
                writer.validate_previous()?;
            }
            Ok(writer)
        }

        fn open_current(&self) -> io::Result<File> {
            let file = open_at(
                self.directory.as_raw_fd(),
                CURRENT,
                libc::O_WRONLY | libc::O_APPEND | libc::O_CREAT,
                0o600,
            )?;
            self.validate_file(&file)?;
            Ok(file)
        }

        fn validate_file(&self, file: &File) -> io::Result<()> {
            regular(file)?;
            if file.metadata()?.len() > self.file_bytes {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "diagnostics_file_limit",
                ));
            }
            Ok(())
        }

        fn validate_previous(&self) -> io::Result<()> {
            match open_at(self.directory.as_raw_fd(), PREVIOUS, libc::O_RDONLY, 0) {
                Ok(file) => self.validate_file(&file),
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error),
            }
        }

        fn append(&self, line: &[u8]) -> io::Result<()> {
            let _lock = Lock::acquire(&self.lock)?;
            let mut file = self.open_current()?;
            if file.metadata()?.len().saturating_add(line.len() as u64) > self.file_bytes {
                self.validate_previous()?;
                cvt(unsafe {
                    libc::renameat(
                        self.directory.as_raw_fd(),
                        CURRENT.as_ptr(),
                        self.directory.as_raw_fd(),
                        PREVIOUS.as_ptr(),
                    )
                })?;
                file = self.open_current()?;
            }
            file.write_all(line)
        }

        fn sync(&self) -> io::Result<()> {
            let _lock = Lock::acquire(&self.lock)?;
            self.open_current()?.sync_data()
        }
    }

    impl Write for BoundedWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            let mut first_error = None;
            for segment in bytes.split_inclusive(|byte| *byte == b'\n') {
                let complete = segment.last() == Some(&b'\n');
                if self.discarding {
                    if complete {
                        self.discarding = false;
                    }
                    continue;
                }
                if self.pending.len().saturating_add(segment.len()) > self.line_bytes {
                    self.pending.clear();
                    increment(&self.counters.rejected_events, 1);
                    self.discarding = !complete;
                    continue;
                }
                self.pending.extend_from_slice(segment);
                if complete {
                    if let Err(error) = self.append(&self.pending) {
                        increment(&self.counters.write_failures, 1);
                        if first_error.is_none() {
                            first_error = Some(error);
                        }
                    }
                    self.pending.clear();
                }
            }
            first_error.map_or(Ok(bytes.len()), Err)
        }

        fn flush(&mut self) -> io::Result<()> {
            if let Err(error) = self.sync() {
                increment(&self.counters.write_failures, 1);
                return Err(error);
            }
            Ok(())
        }
    }
}
#[cfg(unix)]
use storage::BoundedWriter;

/// Local subscribers for RPC fixtures: no global initialization, HOME, or disk access.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use std::cell::RefCell;

    thread_local! { static METADATA: RefCell<Option<Metadata>> = const { RefCell::new(None) }; }
    pub(super) fn metadata_override() -> Option<Metadata> {
        METADATA.with(|value| value.borrow().clone())
    }

    pub(crate) fn with_metadata<T>(run: &str, pid: u32, f: impl FnOnce() -> T) -> T {
        struct Reset(Option<Metadata>);
        impl Drop for Reset {
            fn drop(&mut self) {
                METADATA.with(|value| *value.borrow_mut() = self.0.take());
            }
        }
        let old = METADATA.with(|value| {
            value.replace(Some(Metadata {
                app_run_id: run.into(),
                app_pid: pid,
            }))
        });
        let _reset = Reset(old);
        f()
    }

    #[derive(Clone, Default)]
    pub(crate) struct CapturedEvents(Arc<Mutex<Vec<u8>>>);
    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CapturedEvents {
        type Writer = Self;
        fn make_writer(&'a self) -> Self {
            self.clone()
        }
    }
    impl Write for CapturedEvents {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            self.0.lock().extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl CapturedEvents {
        pub(crate) fn events(&self) -> Vec<serde_json::Value> {
            self.0
                .lock()
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.is_empty())
                .map(|line| serde_json::from_slice(line).expect("complete diagnostic JSON"))
                .collect()
        }
        pub(crate) fn bytes(&self) -> Vec<u8> {
            self.0.lock().clone()
        }
    }
    pub(crate) fn capture() -> (tracing::Dispatch, CapturedEvents) {
        let events = CapturedEvents::default();
        let subscriber = tracing_subscriber::registry().with(json_layer(events.clone()));
        (tracing::Dispatch::new(subscriber), events)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use test_support::capture;

    const RUN: &str = "17e13ebe-7b27-4bc4-b112-96f86c4d7b77";
    const OPERATION: &str = "08339de2-71cc-40dc-ad32-332e95cce5f1";

    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("ompws-diagnostics-test-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn diagnostic(&self, name: &str) -> PathBuf {
            self.0.join("diagnostics").join(name)
        }
    }
    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(unix)]
    fn runtime_dispatch(runtime: &Runtime) -> tracing::Dispatch {
        tracing::Dispatch::new(
            tracing_subscriber::registry().with(json_layer(runtime.writer.clone())),
        )
    }

    #[cfg(unix)]
    fn runtime_rows(root: &TempRoot) -> Vec<serde_json::Value> {
        fs::read_to_string(root.diagnostic("events.jsonl"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[cfg(unix)]
    #[test]
    fn runtime_toggle_disabled_initialization_writes_and_counts_nothing() {
        let root = TempRoot::new();
        let counters = Arc::new(Counters::default());
        let runtime = Runtime::new(&root.0, false, counters.clone()).unwrap();
        let dispatch = runtime_dispatch(&runtime);
        tracing::dispatcher::with_default(&dispatch, || {
            runtime.emit(DiagnosticEvent::new("app.started", "startup"));
            runtime.emit(DiagnosticEvent::new("app.panic", "startup"));
            runtime.emit(DiagnosticEvent::default());
            runtime.record_health();
            let ack = runtime
                .record(&tauri::ipc::InvokeBody::Raw(vec![0]))
                .unwrap();
            assert_eq!(ack.status, DiagnosticAckStatus::Disabled);
            assert_eq!(ack.accepted, 0);
            assert_eq!(ack.rejected_events, 0);
            assert_eq!(ack.dropped_events, 0);
            runtime.shutdown();
        });
        assert_eq!(counters.write_failures.load(Ordering::Relaxed), 0);
        assert_eq!(counters.rejected_events.load(Ordering::Relaxed), 0);
        assert!(!root.0.join("diagnostics").exists());
    }

    #[cfg(unix)]
    #[test]
    fn runtime_toggle_off_on_retains_history_and_only_records_future_events() {
        let root = TempRoot::new();
        let runtime = Runtime::new(&root.0, false, Arc::default()).unwrap();
        let dispatch = runtime_dispatch(&runtime);
        tracing::dispatcher::with_default(&dispatch, || {
            runtime.emit(DiagnosticEvent::new("app.started", "startup"));
            runtime.set_enabled(true);
            runtime.emit(DiagnosticEvent::new("rpc.spawn_started", "rpc"));
            runtime.set_enabled(false);
            let before = fs::read(root.diagnostic("events.jsonl")).unwrap();
            assert_eq!(runtime_rows(&root).len(), 1);
            runtime.emit(DiagnosticEvent::new("app.panic", "startup"));
            runtime.emit(DiagnosticEvent::new("app.exit", "startup"));
            runtime.record_health();
            let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
                "events": [input()], "droppedEvents": 9
            }));
            assert_eq!(runtime.record(&body).unwrap().accepted, 0);
            assert_eq!(fs::read(root.diagnostic("events.jsonl")).unwrap(), before);
            runtime.set_enabled(true);
            assert_eq!(runtime.record(&body).unwrap().accepted, 1);
            runtime.set_enabled(false);
            let rows = runtime_rows(&root);
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0]["fields"]["event"], "rpc.spawn_started");
            assert_eq!(rows[1]["fields"]["event"], "frontend.ipc_finished");
            let before_exit = fs::read(root.diagnostic("events.jsonl")).unwrap();
            runtime.shutdown();
            assert_eq!(
                fs::read(root.diagnostic("events.jsonl")).unwrap(),
                before_exit
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn runtime_toggle_retired_generation_cannot_replay_after_reenable() {
        let root = TempRoot::new();
        let runtime = Runtime::new(&root.0, true, Arc::default()).unwrap();
        let dispatch = runtime_dispatch(&runtime);
        let mut old_queue = runtime.writer.0.lock().as_ref().unwrap().clone();
        let mut old_output =
            GenerationWriter(runtime.admission.lock().output.as_ref().unwrap().clone());
        tracing::dispatcher::with_default(&dispatch, || {
            runtime.emit(DiagnosticEvent::new("rpc.spawn_started", "rpc"));
            runtime.set_enabled(false);
            assert_eq!(runtime_rows(&root).len(), 1);
            runtime.set_enabled(true);
            // Model both a retained sender and a worker still holding its sink
            // after WorkerGuard's bounded drain deadline.
            old_queue.write_all(b"{\"staleQueue\":true}\n").unwrap();
            old_output.write_all(b"{\"staleWorker\":true}\n").unwrap();
            old_output.flush().unwrap();
            runtime.emit(DiagnosticEvent::new("rpc.resume_started", "rpc"));
            runtime.set_enabled(false);
        });
        let rows = runtime_rows(&root);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["fields"]["event"], "rpc.spawn_started");
        assert_eq!(rows[1]["fields"]["event"], "rpc.resume_started");
    }

    #[cfg(unix)]
    #[test]
    fn runtime_toggle_admission_waiter_observes_completed_disable() {
        let root = TempRoot::new();
        let runtime = Runtime::new(&root.0, true, Arc::default()).unwrap();
        let dispatch = runtime_dispatch(&runtime);
        let mut admission = runtime.admission.lock();
        std::thread::scope(|scope| {
            let (ready, started) = std::sync::mpsc::channel();
            let runtime = &runtime;
            let producer = scope.spawn(move || {
                tracing::dispatcher::with_default(&dispatch, || {
                    ready.send(()).unwrap();
                    runtime.emit(DiagnosticEvent::new("app.panic", "startup"));
                });
            });
            started.recv().unwrap();
            runtime.close(&mut admission);
            drop(admission);
            producer.join().unwrap();
        });
        assert!(runtime_rows(&root).is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn runtime_toggle_enabled_shutdown_keeps_final_health_once() {
        let root = TempRoot::new();
        let runtime = Runtime::new(&root.0, true, Arc::default()).unwrap();
        let dispatch = runtime_dispatch(&runtime);
        tracing::dispatcher::with_default(&dispatch, || {
            runtime.emit(DiagnosticEvent::new("app.exit", "startup"));
            runtime.shutdown();
            runtime.shutdown();
            runtime.set_enabled(true);
            runtime.emit(DiagnosticEvent::new("app.started", "startup"));
        });
        let rows = runtime_rows(&root);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["fields"]["event"], "app.exit");
        assert_eq!(rows[1]["fields"]["event"], "diagnostics.health");
    }

    #[test]
    fn frontend_conversion_moves_context_without_copying_owned_strings() {
        let mut input = input();
        input.code = Some(DiagnosticCode::JsError);
        input.source_file = Some("src/main.ts".into());
        input.source_line = Some(12);
        input.source_column = Some(3);
        input.frames = Some("src/main.ts:12:3".into());
        input.alive = Some(true);
        input.streaming = Some(false);
        input.removed_rows = Some(2);
        input.exit_code = Some(1);
        input.exit_intent = Some(DiagnosticExitIntent::Stop);
        let operation_ptr = input.operation_id.as_ref().unwrap().as_ptr();
        let session_ptr = input.session_id.as_ref().unwrap().as_ptr();
        let command_ptr = input.command.as_ref().unwrap().as_ptr();
        let source_ptr = input.source_file.as_ref().unwrap().as_ptr();
        let frames_ptr = input.frames.as_ref().unwrap().as_ptr();
        let (operation_id, event) = frontend_event(input);
        assert_eq!(operation_id.as_ref().unwrap().as_ptr(), operation_ptr);
        assert_eq!(event.session_id.as_ref().unwrap().as_ptr(), session_ptr);
        assert_eq!(event.command.as_ref().unwrap().as_ptr(), command_ptr);
        assert_eq!(event.source_file.as_ref().unwrap().as_ptr(), source_ptr);
        assert_eq!(event.frames.as_ref().unwrap().as_ptr(), frames_ptr);
        assert_eq!(event.code.as_deref(), Some("js_error"));
        assert_eq!(event.outcome.as_deref(), Some("ok"));
        assert_eq!(event.duration_ms, Some(12.5));
        assert_eq!(event.source_line, Some(12));
        assert_eq!(event.source_column, Some(3));
        assert_eq!(event.alive, Some(true));
        assert_eq!(event.streaming, Some(false));
        assert_eq!(event.removed_rows, Some(2));
        assert_eq!(event.exit_code, Some(1));
        assert_eq!(event.exit_intent.as_deref(), Some("stop"));
    }

    #[test]
    fn request_decoding_bounds_batch_length_and_serialized_event_bytes() {
        let valid = serde_json::to_value(input()).unwrap();
        let oversized_batch = tauri::ipc::InvokeBody::Json(serde_json::json!({
            "events": vec![valid.clone(); 21], "droppedEvents": 7
        }));
        let mut oversized_event = valid.clone();
        oversized_event["frames"] = serde_json::json!("SECRET_TOKEN".repeat(4096));
        let oversized_item = tauri::ipc::InvokeBody::Json(serde_json::json!({
            "events": [valid, oversized_event], "droppedEvents": 7
        }));
        let counters = Counters::default();
        let mut emitted = 0;
        for (body, rejected) in [(oversized_batch, 21), (oversized_item, 23)] {
            let error = record_request_body(&body, true, &counters, |_| emitted += 1).unwrap_err();
            assert_eq!(error, INVALID_BATCH);
            assert!(!error.contains("SECRET_TOKEN"));
            assert_eq!(emitted, 0);
            let health = make_ack(&counters, true, 0, 0);
            assert_eq!(health.rejected_events, rejected);
            assert_eq!(health.dropped_events, 0);
        }
    }

    fn input() -> FrontendDiagnosticInput {
        serde_json::from_value(serde_json::json!({
            "event": "frontend.ipc_finished", "occurredAt": "2026-11-09T02:03:04.123Z",
            "source": "ipc", "operationId": OPERATION, "sessionId": RUN,
            "command": "rpc_send", "outcome": "ok", "durationMs": 12.5
        }))
        .unwrap()
    }

    #[test]
    fn scoped_formatter_keeps_only_target_metadata_and_controlled_operation() {
        let (dispatch, output) = capture();
        tracing::dispatcher::with_default(&dispatch, || {
            test_support::with_metadata(RUN, 1234, || {
                let unrelated = tracing::info_span!("unrelated", secret = "DIAG_SECRET");
                let _unrelated = unrelated.enter();
                tracing::error!(target: "omp-stderr", "DIAG_SECRET");
                tracing::warn!("DIAG_SECRET");
                let operation = operation_span(Some(OPERATION));
                let _operation = operation.enter();
                let mut event = DiagnosticEvent::new("rpc.command_finished", "rpc");
                event.command = Some("prompt".into());
                event.request_id = Some("req_17".into());
                event.session_id = Some(RUN.into());
                event.child_pid = Some(42);
                event.outcome = Some("ok".into());
                event.duration_ms = Some(12.5);
                emit(event);
            });
        });
        let events = output.events();
        assert_eq!(events.len(), 1);
        let row = &events[0];
        assert_eq!(row["target"], TARGET);
        assert_eq!(row["level"], "INFO");
        assert!(chrono::DateTime::parse_from_rfc3339(row["timestamp"].as_str().unwrap()).is_ok());
        assert_eq!(row["fields"]["schemaVersion"], 1);
        assert_eq!(row["fields"]["appRunId"], RUN);
        assert_eq!(row["fields"]["appPid"], 1234);
        assert!(valid_uuid(row["fields"]["eventId"].as_str().unwrap()));
        assert_eq!(row["fields"]["origin"], "backend");
        assert_eq!(row["fields"]["requestId"], "req_17");
        assert_eq!(row["fields"]["childPid"], 42);
        assert_eq!(row["fields"]["durationMs"], 12.5);
        assert_eq!(row["span"]["operationId"], OPERATION);
        assert!(row.get("spans").is_none());
        assert!(row["fields"].get("operationId").is_none());
        assert!(row["fields"].get("session_id").is_none());
        assert!(row["fields"].get("message").is_none());
        assert!(!String::from_utf8(output.bytes())
            .unwrap()
            .contains("DIAG_SECRET"));
    }

    #[test]
    fn operation_ids_are_valid_and_root_spans_do_not_inherit() {
        let (dispatch, output) = capture();
        tracing::dispatcher::with_default(&dispatch, || {
            let startup = operation_span(Some(RUN));
            let _startup = startup.enter();
            let operation = operation_span(Some("DIAG_SECRET"));
            operation.in_scope(|| emit(DiagnosticEvent::new("rpc.spawn_started", "rpc")));
        });
        let events = output.events();
        let operation = events[0]["span"]["operationId"].as_str().unwrap();
        assert!(valid_uuid(operation));
        assert_ne!(operation, RUN);
        assert!(!String::from_utf8(output.bytes())
            .unwrap()
            .contains("DIAG_SECRET"));
    }

    #[test]
    fn uninitialized_emit_uses_nil_metadata_without_creating_directory() {
        let root = TempRoot::new();
        let (dispatch, output) = capture();
        tracing::dispatcher::with_default(&dispatch, || {
            emit(DiagnosticEvent::new("rpc.resume_started", "rpc"))
        });
        let events = output.events();
        assert_eq!(events[0]["fields"]["appRunId"], NIL_UUID);
        assert_eq!(events[0]["fields"]["appPid"], std::process::id());
        assert!(!root.0.join("diagnostics").exists());
        assert_eq!(
            record_batch(vec![input()], 2, false, &Counters::default(), |_| panic!(
                "disabled sink"
            ))
            .unwrap()
            .accepted,
            0
        );
        assert!(!root.0.join("diagnostics").exists());
    }

    #[test]
    fn batch_validation_is_atomic_and_counts_rejections_without_counting_drops() {
        let counters = Counters::default();
        let mut invalid = input();
        invalid.command = Some("secret token".into());
        let mut emitted = 0;
        assert_eq!(
            record_batch(vec![input(), invalid], 7, true, &counters, |_| emitted += 1),
            Err(INVALID_BATCH.into())
        );
        assert_eq!(emitted, 0);
        let health = make_ack(&counters, true, 0, 0);
        assert_eq!(health.rejected_events, 2);
        assert_eq!(health.dropped_events, 0);
        let accepted =
            record_batch(vec![input(); 20], 7, true, &counters, |_| emitted += 1).unwrap();
        assert_eq!(accepted.accepted, 20);
        assert_eq!(accepted.status, DiagnosticAckStatus::Accepted);
        assert_eq!(accepted.dropped_events, 7);
        assert_eq!(accepted.rejected_events, 2);
        assert_eq!(emitted, 20);
        let next = record_batch(Vec::new(), 0, true, &counters, |_| unreachable!()).unwrap();
        assert_eq!(next.dropped_events, 7);
        assert_eq!(
            record_batch(vec![input(); 21], 0, true, &counters, |_| unreachable!()),
            Err(INVALID_BATCH.into())
        );
        assert_eq!(counters.rejected_events.load(Ordering::Relaxed), 23);
    }

    #[test]
    fn request_decoding_rejects_invalid_event_fields_without_echo_or_partial_emit() {
        let valid = serde_json::to_value(input()).unwrap();
        let invalid_fields = [
            ("exitCode", serde_json::json!("SECRET_TOKEN")),
            ("event", serde_json::json!("SECRET_TOKEN")),
            ("source", serde_json::json!("SECRET_TOKEN")),
            ("code", serde_json::json!("SECRET_TOKEN")),
            ("outcome", serde_json::json!("SECRET_TOKEN")),
            ("exitIntent", serde_json::json!("SECRET_TOKEN")),
            ("SECRET_TOKEN", serde_json::json!("SECRET_TOKEN")),
            ("exitCode", serde_json::json!(i64::from(i32::MAX) + 1)),
            ("sourceLine", serde_json::json!(u64::from(u32::MAX) + 1)),
            ("alive", serde_json::json!("SECRET_TOKEN")),
        ];
        for (field, value) in invalid_fields {
            let mut invalid = valid.clone();
            invalid[field] = value;
            let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
                "events": [valid.clone(), invalid],
                "droppedEvents": 7
            }));
            let counters = Counters::default();
            let mut emitted = 0;
            let error = record_request_body(&body, true, &counters, |_| emitted += 1).unwrap_err();
            assert_eq!(error, INVALID_BATCH);
            assert!(!error.contains("SECRET_TOKEN"));
            assert_eq!(emitted, 0);
            let health = make_ack(&counters, true, 0, 0);
            assert_eq!(health.rejected_events, 2);
            assert_eq!(health.dropped_events, 0);
        }
    }

    #[test]
    fn request_decoding_controls_dropped_events_and_the_entire_envelope() {
        let valid = serde_json::to_value(input()).unwrap();
        let invalid_drops = [
            serde_json::json!("SECRET_TOKEN"),
            serde_json::json!(-1),
            serde_json::json!(0.5),
            serde_json::json!(1e30),
            serde_json::json!(true),
            serde_json::Value::Null,
            serde_json::json!([]),
            serde_json::json!({"SECRET_TOKEN": 1}),
        ];
        let mut bodies: Vec<_> = invalid_drops
            .into_iter()
            .map(|dropped| {
                tauri::ipc::InvokeBody::Json(serde_json::json!({
                    "events": [valid.clone()],
                    "droppedEvents": dropped
                }))
            })
            .collect();
        bodies.extend([
            tauri::ipc::InvokeBody::Json(serde_json::json!({
                "events": [valid.clone()]
            })),
            tauri::ipc::InvokeBody::Json(serde_json::json!({
                "events": [valid],
                "droppedEvents": 7,
                "SECRET_TOKEN": "SECRET_TOKEN"
            })),
            tauri::ipc::InvokeBody::Json(serde_json::json!({
                "events": "SECRET_TOKEN", "droppedEvents": 7
            })),
            tauri::ipc::InvokeBody::Json(serde_json::json!({"droppedEvents": 7})),
            tauri::ipc::InvokeBody::Json(serde_json::json!("SECRET_TOKEN")),
            tauri::ipc::InvokeBody::Json(serde_json::json!([])),
            tauri::ipc::InvokeBody::Json(serde_json::Value::Null),
            tauri::ipc::InvokeBody::Raw(b"SECRET_TOKEN".to_vec()),
        ]);
        let counters = Counters::default();
        for (index, body) in bodies.iter().enumerate() {
            let mut emitted = 0;
            let error = record_request_body(body, true, &counters, |_| emitted += 1).unwrap_err();
            assert_eq!(error, INVALID_BATCH);
            assert!(!error.contains("SECRET_TOKEN"));
            assert_eq!(emitted, 0);
            let health = make_ack(&counters, true, 0, 0);
            assert_eq!(health.rejected_events, index as u64 + 1);
            assert_eq!(health.dropped_events, 0);
        }
    }

    #[test]
    fn request_decoding_preserves_the_wire_shape_and_full_validation() {
        let valid = serde_json::to_value(input()).unwrap();
        let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
            "events": [valid.clone()], "droppedEvents": 7
        }));
        let counters = Counters::default();
        let mut emitted = 0;
        let accepted = record_request_body(&body, true, &counters, |_| emitted += 1).unwrap();
        assert_eq!(accepted.status, DiagnosticAckStatus::Accepted);
        assert_eq!(accepted.accepted, 1);
        assert_eq!(accepted.dropped_events, 7);
        assert_eq!(accepted.rejected_events, 0);
        assert_eq!(emitted, 1);

        let mut invalid = valid.clone();
        invalid["command"] = serde_json::json!("SECRET_TOKEN");
        let body = tauri::ipc::InvokeBody::Json(serde_json::json!({
            "events": [valid, invalid], "droppedEvents": 11
        }));
        assert_eq!(
            record_request_body(&body, true, &counters, |_| emitted += 1),
            Err(INVALID_BATCH.into())
        );
        assert_eq!(emitted, 1);
        let health = make_ack(&counters, true, 0, 0);
        assert_eq!(health.rejected_events, 2);
        assert_eq!(health.dropped_events, 7);
    }

    #[test]
    fn batch_frontend_observation_time_and_operation_are_preserved() {
        let (dispatch, output) = capture();
        tracing::dispatcher::with_default(&dispatch, || {
            let _parent = operation_span(Some(RUN)).entered();
            let mut observation = input();
            observation.operation_id = None;
            record_batch(
                vec![input(), observation],
                0,
                true,
                &Counters::default(),
                emit,
            )
            .unwrap();
        });
        let events = output.events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["span"]["operationId"], OPERATION);
        assert!(events[1]["span"].get("operationId").is_none());
        assert_eq!(
            events[0]["fields"]["occurredAt"],
            "2026-11-09T02:03:04.123Z"
        );
        assert_eq!(events[0]["fields"]["origin"], "frontend");
    }

    #[test]
    fn frontend_rejects_unbounded_or_sensitive_locations_and_numbers() {
        let mut cases = Vec::new();
        let mut value = input();
        value.operation_id = Some("not-uuid".into());
        cases.push(value);
        let mut value = input();
        value.session_id = Some("secret".into());
        cases.push(value);
        let mut value = input();
        value.occurred_at = "2026-11-09T02:03:04+00:00".into();
        cases.push(value);
        let mut value = input();
        value.occurred_at = "2026-13-40T02:03:04Z".into();
        cases.push(value);
        let mut value = input();
        value.command = Some("a".repeat(65));
        cases.push(value);
        for duration in [f64::NAN, f64::INFINITY, -1.0] {
            let mut value = input();
            value.duration_ms = Some(duration);
            cases.push(value);
        }
        for path in [
            "/Users/secret/src/main.ts",
            "src/../secret.ts",
            "src/a.ts?token=secret",
            "assets/nested/file.js",
            "src/./a.ts",
            "src//a.ts",
            "src-tauri/src/lib.rs",
        ] {
            let mut value = input();
            value.source_file = Some(path.into());
            cases.push(value);
        }
        let mut value = input();
        value.source_line = Some(1);
        cases.push(value);
        for frames in [
            "Error: secret",
            "src/a.ts:0:1",
            "src/a.ts:1:0",
            "src/a.ts:1:1\n",
            "src/a.ts:1:1\r\nsrc/b.ts:1:1",
        ] {
            let mut value = input();
            value.frames = Some(frames.into());
            cases.push(value);
        }
        let mut value = input();
        value.frames = Some(["src/a.ts:1:1"; 9].join("\n"));
        cases.push(value);
        let mut value = input();
        value.frames = Some("a".repeat(2049));
        cases.push(value);
        for value in cases {
            assert!(!valid_frontend(&value), "{value:?}");
        }
        let mut valid = input();
        valid.source_file = Some("assets/main-123.js".into());
        valid.source_line = Some(u32::MAX);
        valid.source_column = Some(1);
        valid.frames = Some("src/features/chat.tsx:12:2\nassets/main-123.js:1:23".into());
        assert!(valid_frontend(&valid));
        assert!(valid_frontend(&input()));
        assert!(serde_json::from_value::<FrontendDiagnosticInput>(serde_json::json!({
            "event":"frontend.error", "occurredAt":"2026-11-09T02:03:04Z", "source":"window_error", "message":"secret"
        })).is_err());
    }

    #[test]
    fn error_classification_never_guesses_from_arbitrary_prose() {
        assert_eq!(classify_error("command timed out"), "command_timeout");
        assert_eq!(classify_error("session stdin closed"), "stdin_closed");
        assert_eq!(classify_error("CWD_MISSING:/secret"), "cwd_missing");
        assert_eq!(classify_error("SESSION_HELD:secret"), "session_held");
        assert_eq!(
            classify_error("secret says command timed out"),
            "unexpected_error"
        );
        assert_eq!(command_name("secret prompt"), "other");
        assert_eq!(
            command_name("abort_and_restore_queue"),
            "abort_and_restore_queue"
        );
        assert_eq!(command_name("negotiate_protocol"), "negotiate");
        assert_eq!(
            panic_location("/Users/private/repo/src-tauri/src/rpc/mod.rs").as_deref(),
            Some("src-tauri/src/rpc/mod.rs")
        );
        assert_eq!(
            panic_location("src/lib.rs").as_deref(),
            Some("src-tauri/src/lib.rs")
        );
        assert_eq!(panic_location("/rustc/private/lib.rs"), None);
    }

    #[test]
    fn severity_distinguishes_failure_slow_completion_and_normal_exit() {
        let (dispatch, output) = capture();
        tracing::dispatcher::with_default(&dispatch, || {
            let mut failed = DiagnosticEvent::new("rpc.command_finished", "rpc");
            failed.outcome = Some("error".into());
            failed.duration_ms = Some(3000.0);
            emit(failed);
            let mut slow = DiagnosticEvent::new("rpc.command_finished", "rpc");
            slow.outcome = Some("ok".into());
            slow.duration_ms = Some(3000.0);
            emit(slow);
            let mut recoverable = DiagnosticEvent::new("rpc.resume_finished", "rpc");
            recoverable.outcome = Some("error".into());
            recoverable.code = Some("cwd_missing".into());
            emit(recoverable);
            let mut exited = DiagnosticEvent::new("rpc.lifecycle", "process_exit");
            exited.exit_code = Some(42);
            emit(exited);
        });
        let levels: Vec<_> = output
            .events()
            .iter()
            .map(|v| v["level"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(levels, ["ERROR", "WARN", "WARN", "INFO"]);
    }

    #[test]
    fn counters_saturate_and_queue_drops_are_included_once() {
        let counters = Counters::default();
        increment(&counters.frontend_dropped, 7);
        increment(&counters.write_failures, 2);
        increment(&counters.rejected_events, 3);
        let first = make_ack(&counters, true, 4, 5);
        let second = make_ack(&counters, true, 4, 5);
        assert_eq!(first, second);
        assert_eq!(first.dropped_events, 12);
        assert_eq!(first.write_failures, 2);
        assert_eq!(first.rejected_events, 3);
        increment(&counters.frontend_dropped, u64::MAX);
        assert_eq!(make_ack(&counters, false, 0, 5).dropped_events, u64::MAX);
    }

    #[test]
    fn health_thread_is_cancellable_without_inheriting_an_operation() {
        let (dispatch, output) = capture();
        let (sent, received) = std::sync::mpsc::channel();
        let task = tracing::dispatcher::with_default(&dispatch, || {
            let _operation = operation_span(Some(OPERATION)).entered();
            let child_dispatch = dispatch.clone();
            spawn_health_task(Duration::from_millis(1), move || {
                tracing::dispatcher::with_default(&child_dispatch, || {
                    emit(DiagnosticEvent::new("diagnostics.health", "startup"))
                });
                let _ = sent.send(());
            })
            .unwrap()
        });
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        task.stop.send(()).unwrap();
        task.thread.join().unwrap();
        assert!(!output.events().is_empty());
        assert!(output.events().iter().all(|row| row.get("span").is_none()));
    }

    #[cfg(unix)]
    fn writer(
        root: &TempRoot,
        file_bytes: u64,
        line_bytes: usize,
    ) -> (BoundedWriter, Arc<Counters>) {
        let counters = Arc::new(Counters::default());
        (
            BoundedWriter::new(&root.0, counters.clone(), file_bytes, line_bytes).unwrap(),
            counters,
        )
    }

    #[cfg(unix)]
    #[test]
    fn writer_handles_split_coalesced_and_unterminated_records() {
        let root = TempRoot::new();
        let (mut writer, _) = writer(&root, 128, 32);
        writer.write_all(b"{\"n\":").unwrap();
        writer.flush().unwrap();
        assert!(fs::read(root.diagnostic("events.jsonl"))
            .unwrap()
            .is_empty());
        writer.write_all(b"1}\n{\"n\":2}\n{\"n").unwrap();
        writer.write_all(b"\":3}\npartial").unwrap();
        writer.flush().unwrap();
        assert_eq!(
            fs::read(root.diagnostic("events.jsonl")).unwrap(),
            b"{\"n\":1}\n{\"n\":2}\n{\"n\":3}\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn writer_discards_oversized_rows_until_lf_then_recovers() {
        let root = TempRoot::new();
        let (mut writer, counters) = writer(&root, 128, 8);
        writer.write_all(b"1234567\n").unwrap();
        writer.write_all(b"12345678").unwrap();
        writer.write_all(b"9secret").unwrap();
        writer.write_all(b"tail\nok\n123456789\nhi\n").unwrap();
        writer.flush().unwrap();
        assert_eq!(
            fs::read(root.diagnostic("events.jsonl")).unwrap(),
            b"1234567\nok\nhi\n"
        );
        assert_eq!(counters.rejected_events.load(Ordering::Relaxed), 2);
        assert_eq!(counters.write_failures.load(Ordering::Relaxed), 0);
    }

    #[cfg(unix)]
    #[test]
    fn writer_rotates_only_before_crossing_boundary_and_retains_two_files() {
        let root = TempRoot::new();
        let (mut writer, _) = writer(&root, 12, 8);
        writer.write_all(b"one\ntwo\ntri\n").unwrap();
        assert_eq!(
            fs::metadata(root.diagnostic("events.jsonl")).unwrap().len(),
            12
        );
        assert!(!root.diagnostic("events.previous.jsonl").exists());
        writer.write_all(b"four\n").unwrap();
        assert_eq!(
            fs::read(root.diagnostic("events.previous.jsonl")).unwrap(),
            b"one\ntwo\ntri\n"
        );
        assert_eq!(
            fs::read(root.diagnostic("events.jsonl")).unwrap(),
            b"four\n"
        );
        writer.write_all(b"five\nsix\nseven\n").unwrap();
        writer.flush().unwrap();
        assert_eq!(
            fs::read(root.diagnostic("events.previous.jsonl")).unwrap(),
            b"four\nfive\n"
        );
        assert_eq!(
            fs::read(root.diagnostic("events.jsonl")).unwrap(),
            b"six\nseven\n"
        );
        assert_eq!(fs::read_dir(root.0.join("diagnostics")).unwrap().count(), 3);
    }

    #[cfg(unix)]
    #[test]
    fn production_constants_enforce_two_mib_and_eight_kib_exactly() {
        assert_eq!(FILE_BYTES, 2 * 1024 * 1024);
        assert_eq!(LINE_BYTES, 8192);
        let root = TempRoot::new();
        let (mut writer, counters) = writer(&root, FILE_BYTES, LINE_BYTES);
        let mut row = vec![b'x'; LINE_BYTES];
        row[LINE_BYTES - 1] = b'\n';
        for _ in 0..256 {
            writer.write_all(&row).unwrap();
        }
        assert_eq!(
            fs::metadata(root.diagnostic("events.jsonl")).unwrap().len(),
            FILE_BYTES
        );
        writer.write_all(b"ok\n").unwrap();
        assert_eq!(
            fs::metadata(root.diagnostic("events.previous.jsonl"))
                .unwrap()
                .len(),
            FILE_BYTES
        );
        assert_eq!(fs::read(root.diagnostic("events.jsonl")).unwrap(), b"ok\n");
        row.insert(0, b'x');
        writer.write_all(&row).unwrap();
        assert_eq!(counters.rejected_events.load(Ordering::Relaxed), 1);
    }

    #[cfg(unix)]
    #[test]
    fn private_permissions_do_not_change_root_or_historical_files() {
        use std::os::unix::fs::PermissionsExt;
        let root = TempRoot::new();
        fs::set_permissions(&root.0, fs::Permissions::from_mode(0o755)).unwrap();
        let historical = root.0.join("rpc-lifecycle.jsonl");
        fs::write(&historical, b"legacy").unwrap();
        fs::set_permissions(&historical, fs::Permissions::from_mode(0o644)).unwrap();
        let (mut writer, _) = writer(&root, 8, 8);
        writer.write_all(b"1234567\na\n").unwrap();
        writer.flush().unwrap();
        let mode = |path: PathBuf| fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(root.0.clone()), 0o755);
        assert_eq!(mode(historical), 0o644);
        assert_eq!(mode(root.0.join("diagnostics")), 0o700);
        for name in ["events.jsonl", "events.previous.jsonl", ".writer.lock"] {
            assert_eq!(mode(root.diagnostic(name)), 0o600);
        }
    }

    #[cfg(unix)]
    #[test]
    fn writer_rejects_symlinks_and_nonregular_files_without_touching_targets() {
        use std::os::unix::fs::symlink;
        for name in [
            "diagnostics",
            ".writer.lock",
            "events.jsonl",
            "events.previous.jsonl",
        ] {
            let root = TempRoot::new();
            let outside = TempRoot::new();
            let target = outside.0.join("untouched");
            fs::write(&target, b"secret").unwrap();
            if name == "diagnostics" {
                symlink(&outside.0, root.0.join("diagnostics")).unwrap();
            } else {
                fs::create_dir(root.0.join("diagnostics")).unwrap();
                symlink(&target, root.diagnostic(name)).unwrap();
            }
            assert!(
                BoundedWriter::new(&root.0, Arc::default(), 128, 32).is_err(),
                "{name}"
            );
            assert_eq!(fs::read(target).unwrap(), b"secret");
        }
        let root = TempRoot::new();
        fs::create_dir_all(root.diagnostic("events.jsonl")).unwrap();
        assert!(BoundedWriter::new(&root.0, Arc::default(), 128, 32).is_err());
        let root = TempRoot::new();
        fs::create_dir(root.0.join("diagnostics")).unwrap();
        use std::os::unix::ffi::OsStrExt;
        let path =
            std::ffi::CString::new(root.diagnostic(".writer.lock").as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
        assert!(BoundedWriter::new(&root.0, Arc::default(), 128, 32).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn writer_counts_append_and_flush_failures_and_recovers() {
        use std::os::unix::fs::symlink;
        let root = TempRoot::new();
        let (mut writer, counters) = writer(&root, 128, 32);
        fs::remove_file(root.diagnostic("events.jsonl")).unwrap();
        symlink(
            root.0.join("must-not-create"),
            root.diagnostic("events.jsonl"),
        )
        .unwrap();
        assert!(writer.write_all(b"{\"n\":1}\n").is_err());
        assert!(writer.flush().is_err());
        assert_eq!(counters.write_failures.load(Ordering::Relaxed), 2);
        assert!(!root.0.join("must-not-create").exists());
        fs::remove_file(root.diagnostic("events.jsonl")).unwrap();
        writer.write_all(b"{\"n\":2}\n").unwrap();
        writer.flush().unwrap();
        assert_eq!(
            fs::read(root.diagnostic("events.jsonl")).unwrap(),
            b"{\"n\":2}\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn official_nonblocking_guard_drains_complete_json_to_bounded_writer() {
        let root = TempRoot::new();
        let (writer, _) = writer(&root, 8192, 4096);
        let (nonblocking, guard) = NonBlockingBuilder::default()
            .buffered_lines_limit(1024)
            .lossy(true)
            .finish(writer);
        let dispatch =
            tracing::Dispatch::new(tracing_subscriber::registry().with(json_layer(nonblocking)));
        tracing::dispatcher::with_default(&dispatch, || {
            for _ in 0..4 {
                emit(DiagnosticEvent::new("app.exit", "startup"));
            }
        });
        drop(guard);
        let data = fs::read(root.diagnostic("events.jsonl")).unwrap();
        assert_eq!(data.iter().filter(|&&byte| byte == b'\n').count(), 4);
        for row in data
            .split(|byte| *byte == b'\n')
            .filter(|row| !row.is_empty())
        {
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(row).unwrap()["fields"]["event"],
                "app.exit"
            );
        }
    }

    #[test]
    fn official_nonblocking_lossy_queue_exposes_dropped_count() {
        #[derive(Clone)]
        struct Blocked {
            gate: Arc<(Mutex<bool>, parking_lot::Condvar)>,
            started: std::sync::mpsc::Sender<()>,
        }
        impl Write for Blocked {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                let _ = self.started.send(());
                let (lock, ready) = &*self.gate;
                let mut open = lock.lock();
                while !*open {
                    ready.wait(&mut open);
                }
                Ok(bytes.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let (started, received) = std::sync::mpsc::channel();
        let gate = Arc::new((Mutex::new(false), parking_lot::Condvar::new()));
        let (mut writer, guard) = NonBlockingBuilder::default()
            .buffered_lines_limit(1)
            .lossy(true)
            .finish(Blocked {
                gate: gate.clone(),
                started,
            });
        writer.write_all(b"first\n").unwrap();
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        for _ in 0..10 {
            writer.write_all(b"queued\n").unwrap();
        }
        assert_eq!(writer.error_counter().dropped_lines(), 9);
        *gate.0.lock() = true;
        gate.1.notify_all();
        drop(guard);
    }

    #[cfg(unix)]
    #[test]
    #[ignore = "invoked only as a subprocess by concurrent_processes_share_rotation_lock"]
    fn writer_child() {
        let root = PathBuf::from(std::env::var_os("OMPWS_DIAGNOSTIC_TEST_ROOT").unwrap());
        let worker = std::env::var("OMPWS_DIAGNOSTIC_TEST_WORKER").unwrap();
        let mut writer = BoundedWriter::new(&root, Arc::default(), 256, 64).unwrap();
        for row in 0..80 {
            let line = format!("{{\"worker\":{worker},\"row\":{row}}}\n");
            writer.write_all(line.as_bytes()).unwrap();
        }
        writer.flush().unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn concurrent_processes_share_rotation_lock() {
        let root = TempRoot::new();
        let mut children = Vec::new();
        for worker in 0..4 {
            children.push(
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "diagnostics::tests::writer_child",
                        "--ignored",
                        "--nocapture",
                    ])
                    .env("OMPWS_DIAGNOSTIC_TEST_ROOT", &root.0)
                    .env("OMPWS_DIAGNOSTIC_TEST_WORKER", worker.to_string())
                    .stdout(std::process::Stdio::null())
                    .spawn()
                    .unwrap(),
            );
        }
        for mut child in children {
            assert!(child.wait().unwrap().success());
        }
        for name in ["events.jsonl", "events.previous.jsonl"] {
            let bytes = fs::read(root.diagnostic(name)).unwrap();
            assert!(!bytes.is_empty() && bytes.len() <= 256);
            assert_eq!(bytes.last(), Some(&b'\n'));
            for line in bytes
                .split(|byte| *byte == b'\n')
                .filter(|line| !line.is_empty())
            {
                let value: serde_json::Value = serde_json::from_slice(line).unwrap();
                assert!(value["worker"].as_u64().unwrap() < 4);
                assert!(value["row"].as_u64().unwrap() < 80);
            }
        }
    }
    #[test]
    fn startup_health_and_lifecycle_scalar_groups_are_not_dropped() {
        let (dispatch, output) = test_support::capture();
        tracing::dispatcher::with_default(&dispatch, || {
            record_app_started();
            let mut health = DiagnosticEvent::new("diagnostics.health", "startup");
            health.dropped_events = Some(7);
            health.write_failures = Some(3);
            health.rejected_events = Some(2);
            emit(health);
            let mut lifecycle = DiagnosticEvent::new("rpc.lifecycle", "process_exit");
            lifecycle.child_pid = Some(42);
            lifecycle.alive = Some(false);
            lifecycle.streaming = Some(false);
            lifecycle.settled = Some(true);
            lifecycle.async_work = Some(false);
            lifecycle.subagents = Some(2);
            lifecycle.pending_ui = Some(3);
            lifecycle.pending_commands = Some(4);
            lifecycle.shutdown_requested = Some(true);
            emit(lifecycle);
        });
        let rows = output.events();
        assert_eq!(rows.len(), 3);
        assert_eq!(DiagnosticEvent::default().origin, "backend");
        assert_eq!(rows[0]["fields"]["appVersion"], env!("CARGO_PKG_VERSION"));
        assert_eq!(rows[0]["fields"]["debugBuild"], cfg!(debug_assertions));
        assert_eq!(rows[1]["fields"]["droppedEvents"], 7);
        assert_eq!(rows[1]["fields"]["writeFailures"], 3);
        assert_eq!(rows[1]["fields"]["rejectedEvents"], 2);
        assert_eq!(rows[2]["fields"]["asyncWork"], false);
        assert_eq!(rows[2]["fields"]["settled"], true);
        assert_eq!(rows[2]["fields"]["subagents"], 2);
        assert_eq!(rows[2]["fields"]["pendingUi"], 3);
        assert_eq!(rows[2]["fields"]["pendingCommands"], 4);
        assert_eq!(rows[2]["fields"]["shutdownRequested"], true);
        assert!(rows[1]["fields"].get("appVersion").is_none());
        assert!(rows[2]["fields"].get("appVersion").is_none());
    }
}
