# omp-workspace — Architecture & Module Contracts

Source of truth for all implementers. Product requirements live in `PLAN.md` (Chinese).
This file pins the **contracts** (types, commands, events, DB, file layout) so modules can be
built in parallel. Do not change a contract silently: if a module truly needs a contract change,
note it in your final report under "Contract changes" with the exact diff.

User decisions already made (do not re-ask):
- Only OMP is integrated (Codex/Claude Code are out of scope; keep the `tool` field = `"omp"`).
- Session row shows: status dot + name + second line `相对时间 · 分支` (+ dirty count, result badge).
- Markdown: preview + annotate-and-send-back **and** manual CodeMirror editing.
- Local git only; no remote pushes.
- UI language: Simplified Chinese labels. Code, comments, commit messages: English.

## 1. Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (macOS target), Rust backend (`src-tauri/`), React 19 + TypeScript + Vite frontend (`src/`) |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`), dark theme default, `lucide-react` icons, `clsx` |
| State | `zustand` |
| Rendering | `react-markdown` + `remark-gfm` + `rehype-highlight`; `@tanstack/react-virtual` for long lists |
| Editor | `@uiw/react-codemirror` + `@codemirror/lang-markdown` |
| Terminal | Rust `portable-pty` + `@xterm/xterm` + `@xterm/addon-fit` |
| Rust crates | `tokio` (full), `serde`/`serde_json`, `rusqlite` (bundled), `notify` + `notify-debouncer-full`, `anyhow`, `thiserror`, `chrono`, `uuid`, `base64`, `dirs`, `axum`, `qrcode`, `local-ip-address`, `parking_lot`, `regex`, `tracing` |
| Tauri plugins | `notification`, `global-shortcut`, `dialog`, `opener`, `clipboard-manager` |
| Package manager | `pnpm` |

Prefer dependency versions published ≥ 7 days ago; never use floating `latest`/`*`.

## 2. Repository layout and ownership

```
src-tauri/src/
  lib.rs            app wiring: state, plugins, invoke_handler list, background tasks  [LEAD]
  contracts.rs      shared serde types (§4)                                            [LEAD]
  state.rs          AppState + event bus (§5)                                          [LEAD]
  db.rs             SQLite open + migrations (§6)                                      [LEAD]
  paths.rs          data dirs (§3)                                                     [LEAD]
  catalog/          session scan/parse/watch/status/workspaces/usage                   [A]
  rpc/              omp --mode rpc process manager, idle suspend, takeover             [B]
  git/              git status/log/diff/worktrees/time machine                         [C]
  services/         local port/process listing, stop, reminders                        [C]
  todos/            smart todo queue, system detection, supervisor, summaries, diagnose [D]
  backlog/          backlog store + prompt assembly                                    [D]
  notify/           native notifications, dock badge, sound                            [D]
  mobile/           LAN HTTP server, pairing, QR, SSE, cloudflared tunnel              [E]
  terminal/         PTY sessions                                                       [E]
src-tauri/mobile/index.html   mobile web app (single file, vanilla JS)                 [E]
src-tauri/prompts/*.md + src/prompts.rs  prompt templates + render() ({{var}}, {{#if var}}..{{/if}}) [LEAD]
extension/omp-workspace-status.ts   OMP status-report extension (§8)                   [E]

src/
  main.tsx, App.tsx          shell, three-pane layout, top bar                          [LEAD]
  lib/contracts.ts           TS mirror of contracts.rs                                  [LEAD]
  lib/ipc.ts                 typed wrappers for EVERY command in §7                     [LEAD]
  lib/events.ts              typed `listen` helpers for §5 events                       [LEAD]
  lib/format.ts              relative time, bytes, etc.                                 [LEAD]
  stores/ui.ts               selected session, center view, right tab, modals           [LEAD]
  stores/sessions.ts         SessionMeta map, loaded via list_sessions + events         [LEAD]
  stores/composer.ts         annotations (pills) per session + side-chat requests       [LEAD]
  stores/live.ts             per-session live RPC state (streaming, pending UI, subagents, state) [B]
  features/sessions/         left column                                                [A]
  features/chat/             center session view, composer, tool cards, diff, approvals, held queue [B]
  features/sidechat/         right tab: forks                                           [B]
  features/heatmap/          right tab: minimap                                         [B]
  features/git/              right tab: changes + time machine; worktree dialogs        [C]
  features/services/         right tab: services                                        [C]
  features/editor/           center "文档" view: md preview/annotate/edit               [C]
  features/todos/            home page queue + top-right capsule + subagent strip       [D]
  features/backlog/          backlog page + quick capture modal                         [D]
  features/diagnose/         diagnose dialog                                            [D]
  features/settings/         settings page (all toggles in §6 settings)                 [D]
  features/mobile/           pairing / tunnel panel (inside settings or its own modal)  [E]
  features/terminal/         terminal view (xterm) for a session                        [E]
```

Rules for parallel work:
- Each module only edits files it owns. `[LEAD]` files are frozen after scaffold except: a module
  MAY append its own dependencies to `Cargo.toml` / `package.json`, and MAY fill in the body of the
  stub for its own commands in `lib/ipc.ts` if a signature was wrong (report it).
- Cross-module Rust calls go only through the `pub` functions listed in §9 (stubbed at scaffold time,
  so every branch compiles on its own).
- Frontend cross-feature interaction goes only through shared stores (`stores/*`) and `lib/ipc.ts`.
- Exported React entry components per feature are fixed (§10) so `App.tsx` never needs edits.

## 3. Data locations

| Path | Purpose |
|---|---|
| `~/.omp/agent/sessions/<bucket>/<ts>_<id>.jsonl` | OMP session files (read-only for us, except via omp itself) |
| `~/.omp-workspace/app.db` | SQLite (§6) |
| `~/.omp-workspace/global/` | cwd for the 🌐 global workspace |
| `~/.omp-workspace/status/<sessionId>.json` | status files written by the extension (§8) |
| `~/.omp-workspace/extension/omp-workspace-status.ts` | extension installed at startup from `include_str!` |
| `~/.omp-workspace/supervisor-sessions/` | `--session-dir` for supervisor / summarizer runs |
| `<repo>/.worktrees/<name>` | session worktrees (branch `omp/<name>`) and time-machine worktrees (`tm-<shortsha>`, detached) |

`paths.rs` exposes `data_dir()`, `db_path()`, `global_dir()`, `status_dir()`, `extension_path()`,
`supervisor_dir()`, `omp_sessions_dir()`; `ensure_dirs()` is called at startup.

## 4. Shared types (`contracts.rs` ⇄ `lib/contracts.ts`)

All structs: `#[serde(rename_all = "camelCase")]`. Enums: `#[serde(rename_all = "snake_case")]`.
Timestamps are ISO-8601 strings (UTC) unless noted.

```rust
pub enum SessionStatus {
  Working,            // agent turn running
  AwaitingApproval,   // pending tool approval (select "Approve"/"Deny")
  AwaitingAnswer,     // pending open question / other dialog
  Review,             // turn finished, not yet accepted (待验收)
  Idle,               // accepted / nothing pending
  Error,              // process crashed or turn ended with error
  Interrupted,        // process gone but transcript tail is non-terminal
  Suspended,          // app stopped the process on idle; resumable
  External,           // an omp process outside the app holds the file (read-only observe)
}

pub enum PendingKind { Approval, Question, Review, Error, Interrupted }

pub struct GitBadge { pub branch: Option<String>, pub dirty: u32, pub worktree: Option<String> }
pub struct ResultBadge { pub kind: String /* "test" | "build" */, pub ok: bool, pub at: String, pub summary: String }

pub struct SessionMeta {
  pub id: String,                 // OMP session id (header.id)
  pub tool: String,               // always "omp"
  pub file: String,               // absolute jsonl path
  pub cwd: String,
  pub title: String,              // custom_name ?? title slot ?? first user message (truncated) ?? "未命名"
  pub label: String,              // "#115" or fork label "#115.2.1"
  pub created_at: String,
  pub updated_at: String,         // file mtime
  pub parent_id: Option<String>,  // fork parent session id (side chats)
  pub fork_depth: u8,             // 0 main, 1..=3
  pub status: SessionStatus,
  pub unread: bool,               // new output not yet seen (cleared by viewing)
  pub pending: Option<PendingKind>, // cleared ONLY by an action
  pub live: bool,                 // app-owned RPC process running
  pub external_pid: Option<u32>,
  pub pinned: bool,
  pub archived: bool,
  pub workspace_id: Option<String>, // resolved membership (explicit override or path match); None = 未归档
  pub repo_root: Option<String>,  // main repo root (git common dir parent) for grouping
  pub git: Option<GitBadge>,
  pub result: Option<ResultBadge>,
  pub last_assistant: Option<String>, // ≤200 chars snippet
  pub model: Option<String>,
}

pub enum WorkspaceKind { Project, Global }
pub struct Workspace { pub id: String, pub path: String, pub name: String, pub kind: WorkspaceKind, pub sort: i64 }

// Unified observation layer: normalized transcript entries
pub enum TranscriptKind { User, Assistant, ToolResult, Bash, Custom, Compaction, BranchSummary, ModelChange, System, Unknown }
pub struct ToolCall { pub id: String, pub name: String, pub args: serde_json::Value, pub intent: Option<String> }
pub struct ToolResultInfo { pub tool_call_id: String, pub tool_name: String, pub text: String, pub is_error: bool, pub details: Option<serde_json::Value> }
pub struct Usage { pub input: u64, pub output: u64, pub cache_read: u64, pub cache_write: u64, pub total_tokens: u64, pub cost: f64 }
pub struct TranscriptItem {
  pub id: String, pub parent_id: Option<String>, pub ts: String, pub kind: TranscriptKind,
  pub text: Option<String>, pub thinking: Option<String>,
  pub tool_calls: Vec<ToolCall>, pub tool_result: Option<ToolResultInfo>,
  pub usage: Option<Usage>, pub model: Option<String>, pub stop_reason: Option<String>,
  pub hidden: bool,               // custom_message display:false, system reminders
}
pub struct TranscriptPage { pub session_id: String, pub items: Vec<TranscriptItem>, pub next_offset: u64 /* byte offset for incremental reads */, pub reset: bool }

pub struct LiveSessionInfo { pub session_id: String, pub session_file: String, pub pid: u32, pub cwd: String }
pub struct StartOpts {
  pub cwd: String,
  pub resume_file: Option<String>,     // --resume <path>
  pub model: Option<String>,           // --model
  pub approval_mode: Option<String>,   // --approval-mode; default from settings
  pub parent_session_id: Option<String>, // for side chats: send `new_session {parentSession}` after ready
  pub label: Option<String>,           // pre-assigned label (side chats)
}
pub struct PendingUiRequest { pub session_id: String, pub request: serde_json::Value /* raw extension_ui_request */, pub received_at: String }

pub enum TodoKind { Approval, Question, Error, Interrupted, Review, Suggestion, ServiceLeft }
pub enum TodoSource { System, Supervisor }
pub enum TodoStatus { Open, Done, Ignored }
pub struct Todo {
  pub id: String, pub kind: TodoKind, pub source: TodoSource, pub status: TodoStatus,
  pub session_id: Option<String>, pub title: String, pub detail: String,
  pub payload: serde_json::Value,  // Approval/Question: {"uiRequest": <raw request>}; Suggestion: {"action": ...}
  pub priority: i32,               // higher = more urgent; Approval 50, Question 40, Error 30, Interrupted 25, Review 20, Suggestion 10
  pub created_at: String, pub updated_at: String,
}
pub struct TodoCounts { pub open: u32, pub total: u32 }

pub enum BacklogKind { Idea, Bug, Todo }
pub enum BacklogStatus { Inbox, Dispatched, Done, Closed }
pub struct BacklogRef { pub kind: String /* "session" | "file" | "annotation" */, pub session_id: Option<String>, pub path: Option<String>, pub text: Option<String>, pub lines: Option<String> }
pub struct BacklogItem { pub id: String, pub text: String, pub kind: BacklogKind, pub refs: Vec<BacklogRef>, pub status: BacklogStatus, pub target_session_id: Option<String>, pub created_at: String, pub updated_at: String }

pub struct GitFileChange { pub path: String, pub status: String /* M A D R ?? */, pub added: u32, pub deleted: u32 }
pub struct GitSummary { pub is_repo: bool, pub branch: Option<String>, pub files: Vec<GitFileChange>, pub has_uncommitted: bool }
pub struct GitCommit { pub sha: String, pub short: String, pub subject: String, pub author: String, pub ts: String }
pub struct WorktreeInfo { pub path: String, pub branch: Option<String>, pub head: String, pub dirty: bool, pub session_ids: Vec<String> }
pub struct TmRun { pub id: String, pub repo: String, pub sha: String, pub worktree: String, pub command: String, pub pid: Option<u32>, pub url: Option<String>, pub log_tail: String }

pub struct ServiceInfo { pub pid: u32, pub name: String, pub port: u16, pub cwd: Option<String>, pub command: String, pub url: String, pub session_id: Option<String>, pub started_by_app: bool }

pub struct PairingInfo { pub url: String, pub qr_svg: String, pub expires_at: String }
pub struct MobileStatus { pub running: bool, pub port: u16, pub lan_url: Option<String>, pub tunnel_url: Option<String>, pub cloudflared_installed: bool }

pub struct UsageSummary { pub available: bool, pub tokens: u64, pub cost: f64, pub source: String /* "token-tracker" | "transcript" */ }

pub struct Settings {
  pub system_detection: bool,        // default true
  pub supervisor_enabled: bool,      // default false
  pub supervisor_model: String,      // default "smol" (passed as --model)
  pub smart_context_routing: bool,   // default false
  pub idle_suspend_minutes: u32,     // default 15; 0 = never
  pub default_approval_mode: String, // default "write"
  pub omp_binary: String,            // default "omp"
  pub notify_turn_end: bool, pub notify_approval: bool, pub notify_exit: bool, pub notify_sound: bool, // all default true, sound false
  pub capsule_visible: bool,         // default true
  pub mobile_enabled: bool,          // default false
  pub mobile_port: u16,              // default 7788
  pub tunnel_mode: String,           // "off" | "quick" | "named"; default "off"
  pub tunnel_name: Option<String>, pub tunnel_hostname: Option<String>,
  pub quick_capture_shortcut: String, // default "CommandOrControl+Shift+I"
}
```

## 5. AppState and events

`state.rs`:
```rust
pub struct AppState {
  pub app: tauri::AppHandle,
  pub db: Arc<parking_lot::Mutex<rusqlite::Connection>>,
  pub bus: tokio::sync::broadcast::Sender<AppEvent>,   // capacity 1024
  pub settings: Arc<parking_lot::RwLock<Settings>>,
  // modules keep their own private state in OnceLock/Arc inside their module
}
pub enum AppEvent {
  RpcFrame { session_id: String, frame: serde_json::Value },       // every stdout frame except `ready`
  RpcProcess { session_id: String, running: bool, exit_code: Option<i32> },
  UiResponded { session_id: String, request_id: String },          // after a UI response was written
  PromptSent { session_id: String },                               // user sent prompt/steer/follow_up
  SessionAccepted { session_id: String },
  SessionStatusChanged { session_id: String, old: SessionStatus, new: SessionStatus },
  SessionsChanged { ids: Vec<String> },
  TodosChanged, BacklogChanged, ServicesChanged,
}
```
`AppState` is managed by Tauri (`app.manage(state)`), cloneable (`Arc` inside). Background tasks
subscribe with `state.bus.subscribe()`.

Frontend events (`app.emit`), names are exact:

| Event | Payload | Emitted by |
|---|---|---|
| `sessions:updated` | `SessionMeta[]` (changed rows only) | A |
| `sessions:removed` | `string[]` | A |
| `rpc:frame` | `{ sessionId, frame }` | B |
| `rpc:process` | `{ sessionId, running, exitCode }` | B |
| `todos:changed` | `TodoCounts` | D |
| `backlog:changed` | `null` | D |
| `services:changed` | `ServiceInfo[]` | C |
| `terminal:data` | `{ termId, data }` (base64) | E |
| `terminal:exit` | `{ termId, code }` | E |
| `tm:log` | `{ runId, line }` | C |
| `quick-capture` | `null` (global shortcut fired) | D |

## 6. SQLite schema (`db.rs`, migration v1)

```sql
CREATE TABLE workspaces(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE session_meta(
  session_id TEXT PRIMARY KEY, file_path TEXT, custom_name TEXT, label TEXT,
  pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  parent_session_id TEXT, fork_depth INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT, unread INTEGER NOT NULL DEFAULT 0, pending_kind TEXT, pending_since TEXT,
  accepted_at TEXT, last_seen_at TEXT, suspended INTEGER NOT NULL DEFAULT 0, created_by_app INTEGER NOT NULL DEFAULT 0,
  seq INTEGER);                                  -- local number when title has no "#<n>"
CREATE TABLE todos(id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT,
  title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', priority INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE backlog(id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
  target_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE summaries(session_id TEXT PRIMARY KEY, summary TEXT NOT NULL, upto_offset INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- single row key='settings' holding Settings JSON
CREATE TABLE mobile_devices(token_hash TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL, last_seen_at TEXT);
CREATE TABLE pairing_codes(code TEXT PRIMARY KEY, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
```
Use a `user_version` pragma for migrations. `db.rs` also provides `load_settings`/`save_settings`.

## 7. Tauri commands (exact names; all `async`, return `Result<T, String>`)

JS calls use camelCase argument keys (Tauri maps to snake_case).

**LEAD (lib.rs / state):** `get_settings() -> Settings`, `save_settings(settings: Settings) -> Settings`, `app_paths() -> {dataDir, globalDir}`

**A — catalog:**
- `list_sessions() -> Vec<SessionMeta>`
- `get_transcript(session_id, from_offset: Option<u64>) -> TranscriptPage` — full parse from 0 or incremental from byte offset
- `update_session_meta(session_id, patch: {customName?, pinned?, archived?, workspaceId?})  -> SessionMeta`
- `mark_seen(session_id)` — clears `unread`
- `accept_session(session_id, archive: bool)` — clears `pending=Review`, sets Idle, emits `SessionAccepted`
- `list_workspaces() -> Vec<Workspace>`, `add_workspace(path) -> Workspace`, `remove_workspace(id)`, `reorder_workspaces(ids: Vec<String>)`
- `session_usage(session_id) -> UsageSummary`
- `rescan_sessions()`

**A — catalog (added):**
- `session_export_html(session_id) -> String` — runs `omp --export <file>`, returns the produced HTML path
- `quick_ask(prompt: String) -> String` — one-shot `omp -p --no-tools --no-session` (supervisor/smol model)


**B — rpc:**
- `rpc_start(opts: StartOpts) -> LiveSessionInfo`
- `rpc_ensure_live(session_id) -> LiveSessionInfo` — start with `--resume <file>` if not live (used for suspended/interrupted/idle sessions)
- `rpc_send(session_id, command: Value) -> Value` — writes the command with a generated `id`, awaits the matching `response`, returns it (`success:false` → Err(error))
- `rpc_ui_respond(session_id, response: Value)` — writes an `extension_ui_response`, emits `UiResponded`
- `rpc_pending_ui(session_id) -> Vec<PendingUiRequest>` — outstanding dialog requests (select/confirm/input/editor)
- `rpc_stop(session_id)` — close stdin, wait ≤5s, then kill
- `rpc_restart(session_id) -> LiveSessionInfo` — stop + `--resume` (the `/fresh` equivalent; resets provider/stream state, keeps history)

- `rpc_list_live() -> Vec<LiveSessionInfo>`
- `takeover_external(session_id) -> LiveSessionInfo` — SIGTERM external pid, wait ≤5s (SIGKILL after), then `rpc_start` with resume
- `create_side_chat(parent_session_id, selection: Option<String>, question: String) -> LiveSessionInfo` — §B spec

**C — git / services:**
- `git_summary(cwd) -> GitSummary`, `git_log(cwd, limit: u32) -> Vec<GitCommit>`, `git_diff(cwd, path: Option<String>, sha: Option<String>) -> String`
- `git_create_worktree(repo, name) -> WorktreeInfo`, `git_list_worktrees(repo) -> Vec<WorktreeInfo>`, `git_remove_worktree(repo, path, delete_branch: bool, force: bool)`
- `git_scan_orphans() -> Vec<WorktreeInfo>` — `.worktrees/*` in registered workspaces with no session whose cwd is inside
- `git_reset_to(repo, sha, mode: "soft"|"hard")`
- `git_commit_suggest(cwd) -> String` — one-shot AI commit message from staged/unstaged diff (≤8k chars)
- `git_commit(cwd, message, stage_all: Option<bool>) -> String` — real `git commit` (argv, no shell)
- `tm_run(repo, sha, command: Option<String>) -> TmRun`, `tm_list() -> Vec<TmRun>`, `tm_stop(run_id, remove_worktree: bool)`
- `services_list(all: bool) -> Vec<ServiceInfo>`, `services_stop(pid)`
- `read_text_file(path) -> String`, `write_text_file(path, content)` (for the md editor; reject paths > 5 MB)

**D — todos / backlog / notify:**
- `todos_list(include_closed: bool) -> Vec<Todo>`, `todos_act(id, action: "done"|"ignore"|"reopen")`, `todos_counts() -> TodoCounts`
- `supervisor_refresh()`
- `summary_get(session_id, ensure: bool) -> Option<String>`
- `diagnose_build_prompt(target_session_id) -> String`
- `backlog_list() -> Vec<BacklogItem>`, `backlog_add(text, kind, refs: Vec<BacklogRef>) -> BacklogItem`, `backlog_update(id, patch: {text?, kind?, status?, targetSessionId?}) -> BacklogItem`, `backlog_delete(id)`, `backlog_build_prompt(id) -> String`
- `notify_test()`

**E — mobile / terminal:**
- `mobile_start() -> MobileStatus`, `mobile_stop()`, `mobile_status() -> MobileStatus`, `mobile_create_pairing() -> PairingInfo`, `mobile_revoke_all()`
- `tunnel_start() -> MobileStatus`, `tunnel_stop()`
- `term_open(cwd, command: Vec<String>, cols: u16, rows: u16) -> String /* termId */`, `term_write(term_id, data: String /* utf8 */)`, `term_resize(term_id, cols, rows)`, `term_close(term_id)`
- `term_open_session(session_id, cols, rows) -> String` — stops the RPC process for that session if live, then runs `omp --resume <file> -e <extension_path> [-e <providers ext>]` in a PTY (provider keys + `OMP_WORKSPACE_PROVIDERS` via extra env)

**Providers (added module — §2 ownership):**
- `provider_list() -> Vec<ProviderConfig>`, `provider_save(config, api_key: Option<String>) -> ProviderConfig`, `provider_delete(id)`, `provider_test(id) -> ProviderTestResult`, `provider_import_env(text) -> Vec<ProviderConfig>`, `provider_export_env_text(ids: Option<Vec<String>>) -> String`
- Provider secrets: AES-256-GCM vault (`providers/vault.rs`, master key in macOS Keychain via security-framework). `env_pairs()` injects decrypted keys only; `OMP_WORKSPACE_PROVIDERS` metadata rides only into omp spawns (rpc/process, catalog list_models, todos/omp run_print, sidechat classify_route, term_open_session). Private extension `~/.omp-workspace/extension/omp-workspace-providers.ts` registers `ompws-<slug>` providers + models with OMP at spawn — never edits `~/.omp/agent/models.yml`.
- `install_status_extension_globally() -> String` — copies the extension into `~/.omp/agent/extensions/` (opt-in button)

## 8. Status extension file format

`extension/omp-workspace-status.ts` (OMP extension, default-export factory `(pi) => {...}`), hooks
`session_start`, `agent_start`, `agent_end`, `tool_approval_requested`, `tool_approval_resolved`,
`session_shutdown`. Writes atomically (`write tmp + rename`) to `~/.omp-workspace/status/<sessionId>.json`:
```json
{ "sessionId": "...", "sessionFile": "...", "pid": 123, "state": "working|idle|awaiting_approval|exited", "updatedAt": "ISO" }
```
Session id/file come from `ctx.sessionManager` (probe `getSessionId?.()`/`getSessionFile?.()`/`getHeader?.()`
defensively; see `~/.omp/agent/extensions/session-autoname.ts` for the API style). Never throws.
Catalog (A) treats a status file as authoritative for External sessions when its `pid` is alive.

## 9. Cross-module Rust API (stubbed at scaffold; signatures frozen)

```rust
// catalog (A)
pub async fn catalog::list(state: &AppState) -> Vec<SessionMeta>;
pub async fn catalog::get(state: &AppState, session_id: &str) -> Option<SessionMeta>;
pub async fn catalog::set_pending(state: &AppState, session_id: &str, pending: Option<PendingKind>);  // used by D's system detection? NO — A owns pending; D only reads
pub fn catalog::init(state: AppState);   // spawn scanner/watcher/status tasks
// rpc (B)
pub async fn rpc::send_prompt(state: &AppState, session_id: &str, text: &str) -> Result<(), String>; // ensure_live + prompt (followUp when streaming)
pub async fn rpc::ui_respond(state: &AppState, session_id: &str, response: serde_json::Value) -> Result<(), String>;
pub async fn rpc::ensure_live(state: &AppState, session_id: &str) -> Result<LiveSessionInfo, String>;
pub async fn rpc::pending_ui(state: &AppState, session_id: &str) -> Vec<PendingUiRequest>;
pub fn rpc::is_live(session_id: &str) -> bool;
pub async fn rpc::stop(state: &AppState, session_id: &str) -> Result<(), String>; // E uses it before terminal view
pub fn rpc::init(state: AppState);       // idle-suspend loop
// git (C)
pub fn git::badge(cwd: &Path) -> Option<GitBadge>;                   // fast (cached ≤5s)
pub fn git::repo_root(cwd: &Path) -> Option<String>;                 // main repo root, resolves worktrees via git-common-dir
pub fn services::init(state: AppState);
pub async fn services::list(all: bool) -> Vec<ServiceInfo>;
// todos (D)
pub async fn todos::list(state: &AppState, include_closed: bool) -> Vec<Todo>;
pub async fn todos::act(state: &AppState, id: &str, action: &str) -> Result<(), String>;
pub async fn todos::counts(state: &AppState) -> TodoCounts;
pub async fn todos::summary(state: &AppState, session_id: &str, ensure: bool) -> Option<String>;
pub fn todos::init(state: AppState); pub fn notify::init(state: AppState); pub fn backlog::init(state: AppState);
// mobile/terminal (E)
pub fn mobile::init(state: AppState);    // autostart when settings.mobile_enabled
```
(`catalog::set_pending` is internal to A; listed only so nobody else writes `pending_kind`.)

Status/pending ownership: **A** derives `SessionStatus` + `pending` from `AppEvent::RpcFrame/RpcProcess/UiResponded/PromptSent/SessionAccepted`,
status files, lsof and transcript heuristics, persists to `session_meta`, emits `SessionStatusChanged`
and `sessions:updated`. **D** turns status changes + RPC frames into todos. **D/notify** turns status changes into notifications.

## 10. Frontend feature entry points (fixed names)

| Import | Rendered where |
|---|---|
| `features/sessions/SessionSidebar` | left column |
| `features/chat/SessionView` (props `{ sessionId }`) | center when `ui.centerView === "session"` |
| `features/editor/DocView` (props `{ path }`) | center when `centerView === "doc"` |
| `features/todos/TodoHome` | center when `centerView === "home"` (default) |
| `features/backlog/BacklogPage` | center when `centerView === "backlog"` |
| `features/settings/SettingsPage` | center when `centerView === "settings"` |
| `features/todos/TopCapsule` | top bar, right |
| `features/backlog/QuickCapture` | global modal (always mounted) |
| `features/diagnose/DiagnoseDialog` | global modal (always mounted; opened via `ui.openModal("diagnose", {sessionId})`) |
| `features/sidechat/SideChatPanel` | right tab `sidechat` |
| `features/heatmap/HeatmapPanel` | right tab `heatmap` |
| `features/git/GitPanel` | right tab `git` |
| `features/services/ServicesPanel` | right tab `services` |
| `features/todos/TodoPanel` | right tab `todos` |
| `features/terminal/TerminalView` (props `{ sessionId }`) | center, when `ui.sessionViewMode[sessionId] === "terminal"` (SessionView renders it) |
| `features/mobile/MobilePanel` | inside SettingsPage (D imports it) |
| `features/git/NewSessionDialog` | global modal (`ui.openModal("new-session", {workspaceId?, cwd?})`) |

`stores/ui.ts` shape:
```ts
type CenterView = "home" | "session" | "doc" | "backlog" | "settings";
type RightTab = "sidechat" | "heatmap" | "todos" | "git" | "services";
interface UiState {
  centerView: CenterView; selectedSessionId: string | null; docPath: string | null;
  rightTab: RightTab; rightOpen: boolean;
  sessionViewMode: Record<string, "chat" | "terminal">;
  modal: { name: string; props: Record<string, unknown> } | null;
  selectSession(id: string | null): void; openDoc(path: string): void; setCenter(v: CenterView): void;
  setRightTab(t: RightTab): void; toggleRight(): void; setSessionViewMode(id: string, m: "chat" | "terminal"): void;
  openModal(name: string, props?: Record<string, unknown>): void; closeModal(): void;
}
```
`stores/composer.ts` shape:
```ts
interface Annotation { id: string; source: "message" | "diff" | "doc" | "terminal"; text: string; file?: string; lines?: string; comment?: string; }
interface ComposerState {
  annotations: Record<string, Annotation[]>;           // by sessionId
  addAnnotation(sessionId: string, a: Omit<Annotation, "id">): void;
  removeAnnotation(sessionId: string, id: string): void; clearAnnotations(sessionId: string): void;
  sideChatRequest: { parentSessionId: string; selection?: string } | null;  // set by any feature, consumed by SideChatPanel
  requestSideChat(parentSessionId: string, selection?: string): void; clearSideChatRequest(): void;
}
export function formatWithAnnotations(text: string, anns: Annotation[]): string; // markdown quote blocks, numbered [1]..[n], diff comments as "文件 path 第 lines 行：comment"
```
`stores/sessions.ts`: `{ sessions: Record<string, SessionMeta>; workspaces: Workspace[]; load(): Promise<void>; upsert(list); remove(ids) }`, wired to `sessions:updated/removed` at app start.

## 11. Module specs

### A — Catalog (backend) + left column (frontend)
- Scan `~/.omp/agent/sessions/*/*.jsonl` at startup; watch with `notify-debouncer-full` (300 ms). Listing reads only
  the title slot (line 1, `type:"title"`), the header (`type:"session"`), and the last ~64 KB tail. Cache by (path, size, mtime).
  Must handle 35+ buckets and multi-MB files fast (<1s cold on this machine).
- Title: `session_meta.custom_name` > title slot > latest `title_change` > first user text (≤40 chars) > "未命名".
- Label: `#<n>` from title regex `^#(\d+)`; else `#L<seq>` from `session_meta.seq`. Side chats keep the stored label.
- Workspace membership: explicit `session_meta.workspace_id` > registered workspace whose path equals/contains `repo_root ?? cwd` >
  Global if cwd under `global_dir()` > None (未归档). Global workspace row is created at startup (`kind=global`).
- External detection: every 5 s run `lsof -c omp -F pn` (names ending `.jsonl` under sessions dir) → pid per file.
  Files held by an app-owned pid are not External.
- Status derivation (live sessions, from bus): `agent_start`→Working; dialog `extension_ui_request` (`select|confirm|input|editor`)
  → AwaitingApproval if `title` starts with `Allow tool` else AwaitingAnswer (pending Approval/Question); `UiResponded`→Working;
  `agent_end` with `isTerminal !== false` → Review (pending Review, unread if not selected); last assistant `stopReason:"error"` → Error;
  `RpcProcess running=false` with exit≠0 → Error; exit 0 while pending Review keeps Review. `PromptSent` clears pending Review/Question.
  `SessionAccepted` → Idle. Suspended flag from `session_meta.suspended` when not live.
- Non-live, non-external: Interrupted when transcript tail is non-terminal (last message is user / toolResult / assistant with toolCalls,
  or latest `custom` `session_exit` has kind ≠ normal or pendingToolCalls) and no later accept; pending Interrupted.
- Result badge: scan recent `bash` toolCalls whose command matches test/build patterns (`test|vitest|jest|pytest|cargo (test|build|check)|tsc|build`)
  and their results (exit code / "failed"/"error" / "passed") → latest ResultBadge.
- `get_transcript`: full normalization to `TranscriptItem` (skip title/session header lines; map `message` roles; `custom_message`
  → Custom with `hidden = !display`; `compaction` → Compaction with summary text; `model_change` → ModelChange; ignore `custom`
  except it is used for status). Incremental reads from `from_offset` must only return complete lines.
- `session_usage`: try Token Tracker on `http://localhost:7680` (discover the API; e.g. inspect its HTML/JS bundle for `/api/...`
  routes); on failure sum `usage` from the transcript (`source:"transcript"`). Never error.
- Frontend `SessionSidebar`: 🌐 全局 group fixed on top; registered workspaces; inside each group, sub-groups by worktree/branch
  (`git.worktree` / branch) when more than one; side chats indented under their parent (`parent_id`) with labels `#3.1`;
  "未归档" bucket collapsed by default, grouped by cwd with an "添加为工作区" button and per-session "归入工作区…".
  Row: status dot (Working green pulse, AwaitingApproval 🟡, AwaitingAnswer 💬, Review 🟠, Error red, Interrupted grey-red,
  Suspended hollow, External purple outline) + 🔵 unread dot + name + second line `3分钟前 · branch` + dirty `●N` + ✅/❌ badge.
  Pinned first. Context menu: 重命名, 置顶, 归档 (if session has a worktree → ask whether to clean it via `git_remove_worktree`,
  refuse silent delete when dirty), 归入工作区, 诊断此会话 (`ui.openModal("diagnose",{sessionId})`), 接管 (External, double confirm
  with "可能丢失未落盘状态"), 恢复 (Interrupted/Suspended → `rpc_ensure_live`), 终端视图. Header: "+ 新会话" per workspace →
  `ui.openModal("new-session", {workspaceId, cwd})`, "添加工作区" via dialog plugin folder picker, search box, 显示归档 toggle.
  Selecting a row → `ui.selectSession(id)` + `mark_seen`.

### B — RPC channel (backend) + chat, side chat, heatmap (frontend)
- Spawn `settings.omp_binary --mode rpc --approval-mode <mode> [--model m] [--resume file] --cwd <cwd>` with `current_dir(cwd)`.
  PATH: macOS GUI apps get a minimal PATH — prepend `~/.local/bin`, `~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin` and pass the user's
  login-shell PATH if obtainable (`$SHELL -lc 'echo $PATH'`, cached once).
- Protocol (see `/tmp/oh-my-pi-src/docs/rpc.md`; verified live): wait for `ready`, send `negotiate_protocol` v2, implement `rpc_chunk`
  reassembly with validation; then `get_state` to learn `sessionId`/`sessionFile`; `set_subagent_subscription {level:"progress"}`.
  If `parent_session_id` set: `new_session {parentSession}` then `get_state` again. Correlate responses by id with a oneshot map.
  Emit every frame (except ready/chunks) as `rpc:frame` + `AppEvent::RpcFrame`. Track outstanding dialog requests for `rpc_pending_ui`
  (remove on response, or on `extension_ui_request method:"cancel"` with matching target). Emit `rpc:process` + `AppEvent::RpcProcess` on start/exit.
- Approval verified shape: `{"type":"extension_ui_request","id":"…","method":"select","title":"Allow tool: bash\nCommand: echo hi","options":["Approve","Deny"]}`
  → respond `{"type":"extension_ui_response","id":"…","value":"Approve"}`.
- Idle suspend: every 60 s, live sessions not streaming, no pending UI, no activity for `idle_suspend_minutes` → `rpc_stop`, set `session_meta.suspended=1`.
  `rpc_ensure_live` clears it.
- Side chat: parent must have `fork_depth < 3`. Label = parent label + "." + (count of existing children + 1). Start with
  `StartOpts{cwd: parent cwd, parent_session_id, label}`, store `session_meta` (parent, depth, label, created_by_app), then send the first
  prompt rendered from `src-tauri/prompts/side_chat.md` (guard rules: this is a side chat forked from the main session; do not modify files
  the main session is working on unless asked; if context is missing, read the parent transcript at `<parent jsonl path>`), containing:
  parent summary (`todos::summary(state, parent, true)`, fallback: project path + `git status --short` output) + selection (if any) + question.
  When `settings.smart_context_routing` is on, classify the question with a quick `omp -p --no-session --no-tools --model smol` call using
  `prompts/context_route.md` into `selection_only | fork_continue | global` and pick context accordingly (low confidence → default).
- `SessionView`: header (label, title, status, model, context usage from `get_state.contextUsage`, usage chip from `session_usage`,
  ✅ 验收 / ✅ 验收并归档 when pending Review, 恢复 for interrupted/suspended, 接管 for external, 聊天/终端 toggle). Message stream from
  `get_transcript` + live frames (use `message_update.message` snapshots for the in-flight assistant message; on terminal `agent_end` re-fetch
  transcript incrementally). Virtualized. User bubbles; assistant markdown; collapsible thinking; tool cards collapsed by default showing
  intent/`i` + tool name + status; bash shows command+output; read/grep/glob show path/pattern; edit shows the diff from
  `toolResult.details.diff` (format: lines like ` 38|text`, `+40|text`, `-41|text`); write shows content. Hidden items not shown (toggle).
- Diff view component: line numbers, +/- colors; select lines → "批注" → comment textarea → adds Annotation `{source:"diff", file, lines, comment, text}`.
- Text selection anywhere in the stream → floating toolbar "引用" (addAnnotation) / "在侧聊中提问" (`requestSideChat`) / "记到收集箱" (open
  QuickCapture via `ui.openModal("quick-capture", {text, sessionId})`).
- Composer: annotation pills above input (remove ×), textarea (Enter send, Shift+Enter newline), slash-command autocomplete from
  `available_commands_update`, `/fork <question>` intercepted → side chat. Model picker (`get_available_models`/`set_model`), thinking
  level (`set_thinking_level`). If session not live → `rpc_ensure_live` first. While streaming: Enter puts the message in the **held queue**
  (zustand, persisted to localStorage per session), Cmd+Enter = steer now, Stop button = `abort`. When a turn ends and held items exist, show a
  bar "有 N 条暂存" with 立即发送(合并为一条)/继续暂存/逐条确认; items editable, deletable, reorderable (drag or ↑↓).
  External sessions: composer disabled with "只读观察 — 接管后可操作".
- Pending dialogs: render approval card (Approve/Deny, show title body), select (options + optionDetails), confirm, input/editor
  (textarea) inline at the stream bottom; respond via `rpc_ui_respond`. Also load `rpc_pending_ui` on open.
- `stores/live.ts`: per session `{ streaming, state (last get_state), pendingUi[], subagents: Record<id,{status,label,…}>, streamingMessage, commands[] }`
  reducing `rpc:frame`/`rpc:process`. Subagent frames (`subagent_lifecycle`/`subagent_progress`) feed `subagents` (D's capsule reads it).
- `SideChatPanel`: lists children of the selected session (label, title, status); "新建侧聊" input; consumes `composer.sideChatRequest`;
  shows the selected child as a compact embedded `SessionView` (prop `compact`). Depth > 3 → "请开新主会话".
- `HeatmapPanel`: one cell per transcript message (grid, ~10px squares), user=blue, assistant brightness ∝ log(total tokens),
  toolResult grey, error red; tooltip with tokens/time; click scrolls the stream to that message (expose `scrollToItem(id)` via a small
  event in `stores/live.ts` or a DOM id `msg-<id>`).

### C — Git, worktrees, time machine, services (backend) + Git/Services panels, md editor, new-session dialog (frontend)
- Run `git` via `std::process::Command` with `-C <dir>`, `GIT_OPTIONAL_LOCKS=0`, timeouts. `git::badge` cached 5 s per cwd.
- `git_summary`: `status --porcelain=v1 -z` + `diff --numstat` (staged+unstaged) + untracked line counts (cap). No branch/rebase/stash concepts in UI.
- Worktrees: `git worktree add -b omp/<name> <repo>/.worktrees/<name>`; ensure `.worktrees/` is ignored via `<repo>/.git/info/exclude`
  (do not edit the repo's .gitignore). Remove: refuse when dirty unless `force`; optionally delete branch.
- Orphans: for each registered workspace repo, `.worktrees/*` with no session (via `catalog::list`) whose cwd is inside.
  Frontend: on app start, if orphans exist, show a dismissible banner in GitPanel/Home "发现 N 个孤儿 worktree" with 回收 buttons.
- Time machine: `tm_run` → `git worktree add --detach <repo>/.worktrees/tm-<short> <sha>`; command = given or detected
  (package.json `scripts.dev` → `pnpm dev`/`npm run dev` by lockfile, else `cargo run`, else none → just open folder); install deps if
  `node_modules` missing (`pnpm install --frozen-lockfile` etc.) before running; stream output via `tm:log`; detect URL `http://localhost:\d+`
  from output. `tm_stop` kills the process group and optionally removes the worktree. `git_reset_to` soft/hard (frontend double-confirm on hard,
  warn on uncommitted changes).
- `GitPanel` (selected session's cwd): 变更 section — files with +/- and click → diff in a modal or `DocView` for md; 时光机 section — commit
  timeline with relative timestamps, uncommitted changes on top, per commit: 查看 diff, ▶ 运行此版本 (shows live log + URL + 停止/丢弃),
  回退到此版本 (软/硬). Worktree section: list worktrees of the repo with dirty flags + 清理.
- Services: every 10 s `lsof -iTCP -sTCP:LISTEN -P -n -F pcn` + cwd `lsof -a -p <pid> -d cwd -Fn`; default filter dev-like processes
  (node, bun, deno, python, ruby, java, go, cargo/rust binaries, vite, next, `tokentracker`), `all=true` shows everything. Map to sessions
  when cwd is inside a session cwd. Emit `services:changed` on diff. When a session's process exits (RpcProcess running=false) or the session
  is archived and a service with that session remains → emit a todo? No — C only exposes the mapping; D creates `ServiceLeft` todos by calling
  `services::list(false)` on `SessionStatusChanged`/archive. `ServicesPanel`: rows with port, name, pid, cwd, 打开 (opener), 复制地址, 停止 (confirm).
- `DocView`: tabs 预览 / 编辑. Preview renders markdown; selecting text → "批注" → comment → annotation `{source:"doc", file, text, comment}` added
  to the selected session (or ask which session). Edit uses CodeMirror, Cmd+S saves via `write_text_file`, dirty indicator, reload-on-change prompt.
  Open docs from GitPanel file clicks (md) and from `ui.openDoc(path)` anywhere (chat tool cards call it for .md paths).
- `NewSessionDialog`: pick workspace/cwd (default from props; global workspace allowed), model (optional), approval mode, "在独立 worktree 中运行"
  checkbox + name (default slug) → `git_create_worktree` then `rpc_start({cwd: worktree.path, ...})`, optional first prompt → send `prompt`
  via `rpc_send`, then select the session. Warn "同仓库已有 N 个会话在跑，建议开 worktree" when applicable.

### D — Smart todos, supervisor, summaries, diagnose, backlog, notifications, settings (backend + frontend)
- System detection (when `settings.system_detection`): subscribe to bus. Create/refresh todos with `dedupe_key`:
  approval/question `ui:<sessionId>:<requestId>` (payload `{uiRequest}`), review `review:<sessionId>`, error `error:<sessionId>`,
  interrupted `interrupted:<sessionId>`. Resolve automatically (status Done) when: `UiResponded` for that request; `SessionAccepted` or
  `PromptSent` for review/question; session status leaves Error/Interrupted. Emit `todos:changed` with counts.
- `todos_act(done)` on a Review todo → call the same logic as `accept_session` (emit `SessionAccepted`; A reacts). On Approval todo the
  frontend shows Approve/Deny inline and calls `rpc_ui_respond`; the todo resolves via `UiResponded`.
- Supervisor (when enabled): triggered by `supervisor_refresh` or debounced status changes (≥5 min apart). Builds a digest of recent sessions
  (label, title, status, summary) + open backlog, runs `omp -p --no-tools --no-session --model <supervisor_model>` with
  `prompts/supervisor.md`, expects a JSON array `[{title, detail, sessionId?, action?: {type:"dispatch_backlog", backlogId, targetSessionId}}]`;
  inserts Suggestion todos (`source: supervisor`). Parse defensively (extract first JSON array).
- Summaries: `todos::summary` returns the latest `compaction` summary from the transcript if present, else a cached `summaries` row if
  `upto_offset` is recent enough, else (if `ensure`) generates with `omp -p --no-tools --no-session --model smol` from a condensed transcript
  (last ~40 user/assistant texts, truncated) using `prompts/summary.md`. Background refresh: every 3 min for sessions active in the last hour
  whose file grew ≥ 20 KB since the last summary.
- `diagnose_build_prompt`: `prompts/diagnose.md` with target label/title/status, summary, last 10 errors (tool results with isError, error
  stop reasons, session_exit records), last assistant text. `DiagnoseDialog`: choose diagnoser: existing session (list) or new session
  (model input; cwd = target cwd) → send via `rpc_start` + `rpc_send prompt`; then navigate to the diagnoser session.
- Backlog: CRUD + `backlog_build_prompt` (`prompts/backlog_dispatch.md`: item text + kind + each ref: session → label/title/summary,
  file → path (+ first 200 lines if small), annotation → quoted text). `BacklogPage`: capture input with kind chips (idea/bug/todo) and
  optional refs; list grouped by status (inbox / 已派发 with link to target session and its status / 完成 / 关闭); "派给 Agent" → choose
  新会话 (workspace + model) or 现有会话 → send prompt → `backlog_update(status=dispatched, targetSessionId)`. Hint text (small, grey):
  "额度用完/报错中断时先存进来；模型太贵时先攒着；会话正忙不想打断时先记下". Auto-mark Done when target session is accepted (SessionAccepted).
- `QuickCapture`: global shortcut (`global-shortcut` plugin, `settings.quick_capture_shortcut`) shows+focuses window, emits `quick-capture`;
  modal also opened via `ui.openModal("quick-capture", {text?, sessionId?})`. One line + kind + auto-ref to current session.
- Notifications: on `SessionStatusChanged` → Review (turn end), AwaitingApproval/AwaitingAnswer, Error/Interrupted (exit), per settings;
  skip when the main window is focused AND that session is selected (frontend reports focus/selection via... keep simple: skip only when window focused).
  Dock badge = open todo count (`window.set_badge_count`). Optional sound (`sound: "default"`). `notify_test` command.
- `TodoHome` (default center page): queue sorted by priority desc then time; most urgent highlighted; each row [处理] [忽略] [跳转会话];
  处理: Approval → inline Approve/Deny; Question → inline answer (options or text); Review → 验收 / 验收并归档; Error/Interrupted → 恢复 (`rpc_ensure_live`)
  / 诊断; Suggestion → run its action or 跳转; ServiceLeft → 停止服务. Done items collapsed at the bottom. Two switches shown at top
  (系统检测 / 监工建议) bound to settings + 刷新监工 button.
- `TopCapsule`: pill `待处理 open/total` (hidden if `!capsule_visible`), click → popover with the compact queue; second segment shows the selected
  session's subagents from `stores/live.ts` (运行中/完成/失败 counts, click → details list).
- `TodoPanel` (right tab): same queue filtered to the selected session.
- `SettingsPage`: all Settings fields grouped (通用 / 待办与监工 / 会话 / 通知 / 手机访问 (renders `MobilePanel`) / 高级 (omp binary,
  install status extension button)).

### E — Mobile access, terminal, status extension
- `mobile`: axum server bound to `0.0.0.0:<mobile_port>` on `mobile_start`. Pairing: `mobile_create_pairing` makes a random 32-byte code
  (5 min, one-time) → URL `http://<lan-ip>:<port>/pair?code=…`, QR as SVG (`qrcode` crate). `/pair` exchanges the code for a device token
  (random, stored hashed in `mobile_devices`), sets an HttpOnly cookie, redirects to `/`. All `/api/*` require the cookie or `Authorization: Bearer`.
  API: `GET /api/sessions` (id,label,title,status,pending,updatedAt,cwd), `GET /api/todos`, `POST /api/todos/:id/act {action}`,
  `GET /api/sessions/:id/pending-ui`, `POST /api/sessions/:id/ui-respond {response}`, `POST /api/sessions/:id/prompt {text}`,
  `POST /api/sessions/:id/resume`, `GET /api/sessions/:id/last` (last assistant text), `GET /api/events` (SSE: todos changed, session status changed).
  Serves `src-tauri/mobile/index.html` at `/`. No full message stream, no annotations, no code editing.
- Mobile page: mobile-first vanilla JS; tabs 待办 / 会话; approve/deny buttons, answer box for questions, reply box for sessions awaiting answer,
  一键恢复 for interrupted, status dots; SSE auto-refresh; in-page Notification API + vibration when a new todo arrives (when permitted).
- Tunnel: `tunnel_start`: `quick` → spawn `cloudflared tunnel --url http://localhost:<port>` and parse the `https://*.trycloudflare.com` URL from
  stderr; `named` → `cloudflared tunnel run --url http://localhost:<port> <tunnel_name>` with public URL `https://<tunnel_hostname>`.
  If `cloudflared` is missing, return an error explaining `brew install cloudflared`. `MobilePanel` UI: start/stop server, LAN URL, "生成配对二维码"
  (render SVG), tunnel mode selector + start/stop + public URL + pairing QR for the public URL, 撤销所有设备, and a short guide text:
  局域网直连 / Cloudflare Tunnel（有域名绑子域名、无域名用临时隧道；建议配 Cloudflare Access）.
- Terminal: `portable-pty`, reader thread → `terminal:data` (base64); `TerminalView` with xterm + fit addon, resize → `term_resize`.
  `term_open_session`: if the session is live, `rpc_stop` it first (warn in UI "切换到终端会挂起结构化通道"), then run
  `omp --resume <file> -e <extension_path>` in the session cwd with the same PATH augmentation as B. Leaving terminal view → close PTY
  (confirm) and switch back to chat (structured view re-reads the transcript).
  Quote capture: in `TerminalView`, Cmd+Shift+A (and a toolbar button) adds the current xterm selection as an Annotation `{source:"terminal"}`.
- Extension (§8) + install at startup to `extension_path()` (overwrite when content differs) + `install_status_extension_globally`.
```
