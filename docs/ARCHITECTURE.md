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
  schedules/        scheduled tasks, cadence, runner, background scheduler (§11 F)     [E]
  skills/           skills & extensions catalog, frontmatter parse, reader (§11 G)     [F]
src-tauri/mobile/index.html   mobile web app (single file, vanilla JS)                 [E]
src-tauri/prompts/*.md + src/prompts.rs  prompt templates + render() ({{var}}, {{#if var}}..{{/if}}) [LEAD]
extension/omp-workspace-status.ts   OMP status-report extension (§8)                   [E]
extension/omp-workspace-checkpoints.ts + autocommit-rule.md  turn checkpoints extension (§8.1) [C]

src/
  main.tsx, App.tsx          shell, three-pane layout, top bar                          [LEAD]
  components/FloatingLayer.tsx  stacking portal, usableViewport clamp, Z_LAYER tiers (§12) [LEAD]
  components/CenterHeader.tsx   top bar with window drag & sidebar/right toggles        [LEAD]
  components/RightAside.tsx     collapsible right tab container                         [LEAD]
  lib/contracts.ts           TS mirror of contracts.rs                                  [LEAD]
  lib/ipc.ts                 typed wrappers for EVERY command in §7                     [LEAD]
  lib/events.ts              typed `listen` helpers for §5 events                       [LEAD]
  lib/format.ts              relative time, bytes, etc.                                 [LEAD]
  stores/ui.ts               selected session, center view, right tab, modals           [LEAD]
  stores/sessions.ts         SessionMeta map, loaded via list_sessions + events         [LEAD]
  stores/composer.ts         annotations (pills) per session + side-chat requests       [LEAD]
  stores/live.ts             per-session live RPC state (streaming, pending UI, subagents, state) [B]
  stores/explorer.ts         pinned explorer workspace (Git worktree map → explorer)    [C]
  stores/turnNav.ts          chat turn ⇄ git commit jump requests (§8.1)                [C]
  stores/worktrees.ts        live git worktrees per workspace id (git_list_worktrees)   [A]
  features/home/             composer-first start screen (StartPage)                    [A]
  features/sessions/         left column, Codex-style navigation (§10)                  [A]
  features/chat/             center session view, composer, turn grouping, tool cards, answer footer (§11 B) [B]
  features/sidechat/         right tab: forks                                           [B]
  features/heatmap/          right tab: minimap                                         [B]
  features/git/              right tab: changes + time machine; worktree dialogs        [C]
  features/services/         right tab: services                                        [C]
  features/editor/           center "文档" view: md preview/annotate/edit               [C]
  features/todos/            queue store, smart detection logic, top capsule, todo row  [D]
  features/inbox/            merged queue + backlog center page, useInboxBadge (§11 D)  [D]
  features/backlog/          backlog store, quick capture modal (BacklogPanel removed)  [D]
  features/schedules/        scheduled tasks center page, cadence editor, run history (§11 F) [E]
  features/skills/           skills & extensions browser center page (§11 G)            [F]
  features/diagnose/         diagnose dialog                                            [D]
  features/settings/         settings page & overlay (categorized IA, §11 D)            [D]
  features/mobile/           pairing / tunnel panel (inside settings or its own modal)  [E]
  features/terminal/         terminal drawer & agent terminal center view               [E]
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
| `~/.omp-workspace/extension/omp-workspace-checkpoints.ts` | turn checkpoints extension (§8.1), installed at startup; loaded only when `settings.turn_checkpoints == Some(true)` |
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

pub struct SessionMeta {                // #[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
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
pub struct ImageAttachment {
  pub id: String, pub marker: Option<String>, pub path: Option<String>,
  pub mime_type: Option<String>, pub width: Option<u32>, pub height: Option<u32>,
}
pub struct TranscriptItem {
  pub id: String, pub parent_id: Option<String>, pub ts: String, pub kind: TranscriptKind,
  pub text: Option<String>, pub thinking: Option<String>,
  pub tool_calls: Vec<ToolCall>, pub tool_result: Option<ToolResultInfo>,
  pub usage: Option<Usage>, pub model: Option<String>, pub stop_reason: Option<String>,
  pub hidden: bool,               // custom_message display:false, system reminders
  pub images: Vec<ImageAttachment>, // attached images (blob refs, clip files, or unresolvable markers)
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

pub enum TodoKind { Approval, Question, Error, Interrupted, Review, Suggestion, ServiceLeft, ScheduleRun }
pub enum TodoSource { System, Supervisor, Schedule } // Schedule: always visible (not gated by system/supervisor switches)
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
pub struct WorktreeInfo { pub path: String, pub branch: Option<String>, pub head: String, pub dirty: u32 /* uncommitted change count */, pub session_ids: Vec<String> }
pub struct TurnFile { pub path: String, pub status: String /* A M D */ }
pub struct TurnCheckpoint { pub turn_id: String, pub session_id: String, pub user_item_id: Option<String>, pub prompt: String,
  pub before: String, pub after: String, pub head_before: Option<String>, pub head_after: Option<String>,
  pub commits: Vec<String> /* newest first */, pub files: Vec<TurnFile>, pub ended_at: String, pub restorable: bool, pub undone: bool }
pub struct TurnUndoResult { pub restored: Vec<String>, pub deleted: Vec<String>, pub conflicts: Vec<String>, pub head_reset: bool, pub warning: Option<String> }
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
  // … (later fields: see contracts.rs)
  pub turn_checkpoints: Option<bool>, // default None = never asked; Some(true) loads the checkpoints extension (§8.1)
}

// Schedules (定时任务)
pub enum ScheduleRunMode { Local, Worktree }
pub enum ScheduleCadence {
  Interval { minutes: u32 },
  Daily { time: String, weekdays: Vec<u32> },
}
pub enum ScheduleRunStatus { Running, Ok, Error, Skipped }
pub struct Schedule {
  pub id: String, pub name: String, pub prompt: String, pub cwd: String,
  pub run_mode: ScheduleRunMode, pub cadence: ScheduleCadence,
  pub model: Option<String>, pub thinking: Option<String>, pub approval_mode: Option<String>,
  pub enabled: bool, pub next_run_at: Option<String>, pub last_run_at: Option<String>,
  pub last_run_status: Option<ScheduleRunStatus>, // derived via subquery in store SCHEDULE_COLS
  pub created_at: String, pub updated_at: String,
}
pub struct ScheduleDraft {
  pub id: Option<String>, pub name: String, pub prompt: String, pub cwd: String,
  pub run_mode: ScheduleRunMode, pub cadence: ScheduleCadence,
  pub model: Option<String>, pub thinking: Option<String>, pub approval_mode: Option<String>,
  pub enabled: bool,
}
pub struct ScheduleRun {
  pub id: String, pub schedule_id: String, pub session_id: Option<String>,
  pub status: ScheduleRunStatus, pub started_at: String, pub finished_at: Option<String>,
  pub summary: Option<String>,
}

// Skills & Extensions catalog
pub enum SkillProvider { Native, Claude, Agents, Codex, Github, Managed } // snake_case
pub struct SkillItem {
  pub name: String, pub description: String, pub source: String /* "project" | "user" */,
  pub provider: SkillProvider /* ecosystem of the discovery root */,
  pub path: String /* SKILL.md */, pub dir: String,
}
pub struct ExtensionItem {
  pub name: String, pub path: String, pub source: String /* "project" | "user" */, pub enabled: bool,
}
pub struct SkillsCatalog {
  pub skills: Vec<SkillItem>, pub extensions: Vec<ExtensionItem>,
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
| `schedules:changed` | `null` | E (schedules runner/scheduler/commands) |

## 6. SQLite schema (`db.rs`, migrations v1 → v2 → v3)

```sql
CREATE TABLE workspaces(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE session_meta(
  session_id TEXT PRIMARY KEY, file_path TEXT, custom_name TEXT, label TEXT,
  pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  parent_session_id TEXT, fork_depth INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT, unread INTEGER NOT NULL DEFAULT 0, pending_kind TEXT, pending_since TEXT,
  accepted_at TEXT, last_seen_at TEXT, suspended INTEGER NOT NULL DEFAULT 0, created_by_app INTEGER NOT NULL DEFAULT 0,
  seq INTEGER);                                  -- local number when title has no "#<n>"
  -- v2 adds: session_meta.cwd_override TEXT    -- resume dir override picked after the original worktree dir was deleted
CREATE TABLE todos(id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT,
  title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', priority INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE backlog(id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
  target_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE summaries(session_id TEXT PRIMARY KEY, summary TEXT NOT NULL, upto_offset INTEGER NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);  -- single row key='settings' holding Settings JSON
CREATE TABLE mobile_devices(token_hash TEXT PRIMARY KEY, name TEXT, created_at TEXT NOT NULL, last_seen_at TEXT);
CREATE TABLE pairing_codes(code TEXT PRIMARY KEY, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  -- v3: scheduled tasks (schedules and schedule_runs tables)
CREATE TABLE schedules(
  id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL, cwd TEXT NOT NULL,
  run_mode TEXT NOT NULL DEFAULT 'local', cadence TEXT NOT NULL,
  model TEXT, thinking TEXT, approval_mode TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, next_run_at TEXT, last_run_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE schedule_runs(
  id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, session_id TEXT,
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, summary TEXT,
  FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
);
CREATE INDEX idx_schedule_runs_schedule_id ON schedule_runs(schedule_id, started_at DESC);
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
- `rpc_ensure_live(session_id, cwd: Option<String>) -> LiveSessionInfo` — start with `--resume <file>` if not live (used for suspended/interrupted/idle sessions). `cwd` overrides the transcript dir: it must exist, is persisted as `session_meta.cwd_override`, and the catalog meta is recomputed. When `cwd` is None and the located dir no longer exists, returns `Err("CWD_MISSING:<dir>")` so the frontend can offer 主目录 / 重建工作树 (`resume-missing-cwd` modal, `src/lib/ensureLive.ts`).
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
- `git_create_worktree(repo, name, branch: Option<String>, base: Option<String>) -> WorktreeInfo` — `name` becomes the
  `.worktrees/<slug>` directory; `branch` (default `omp/<slug>`) is checked out when it exists, else created from `base`
  (default: current HEAD), `git_list_worktrees(repo) -> Vec<WorktreeInfo>`, `git_remove_worktree(repo, path, delete_branch: bool, force: bool)`
- `git_scan_orphans() -> Vec<WorktreeInfo>` — `.worktrees/*` in registered workspaces with no session whose cwd is inside
- `git_reset_to(repo, sha, mode: "soft"|"hard")`
- `git_commit_suggest(cwd) -> String` — one-shot English Conventional Commit message from everything a commit would record
  (`git add -A` into a throwaway index, so new-file content is included and the real index is untouched; ≤8k chars; recent
  subjects passed as style examples)
- `git_commit(cwd, message) -> String` — `git add -A` + `git commit` (argv, no shell); always saves every change
- `git_session_turns(session_file) -> Vec<TurnCheckpoint>` (oldest first), `git_worktree_turns(cwd) -> Vec<TurnCheckpoint>` (every
  session whose cwd is this worktree) — read `omp-workspace.turn-checkpoint` entries (§8.1); `restorable`/`undone` from hidden refs
- `git_undo_turn(cwd, session_file, turn_id, force: bool) -> TurnUndoResult` — newest non-undone turn only; restores just that turn's
  files from its `before` snapshot (created files deleted); files changed since the turn → `conflicts` and nothing touched unless `force`;
  rolls HEAD back to `head_before` only while HEAD is still `head_after`; writes `refs/omp/undone/<sid>/<turnId>`
- `checkpoints_rule() -> String` — auto-commit rule text the checkpoints extension injects (consent card / settings)
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
- `terminal_set_current_session(path: Option<String>)` — writes/clears `~/.omp-workspace/current-session`; `term_open` drawer shells source generated `zdot/`/`bashrc`/`terminal-init.*` so bare `omp`/`claude`/`codex` resume that transcript (session terminals unaffected — they run `omp --resume` directly)

**Providers (added module — §2 ownership):**
- `provider_list() -> Vec<ProviderConfig>`, `provider_save(config, api_key: Option<String>) -> ProviderConfig`, `provider_delete(id)`, `provider_test(id) -> ProviderTestResult`, `provider_import_env(text) -> Vec<ProviderConfig>`, `provider_export_env_text(ids: Option<Vec<String>>) -> String`
- Provider secrets: AES-256-GCM vault (`providers/vault.rs`, master key in macOS Keychain via security-framework). `env_pairs()` injects decrypted keys only; `OMP_WORKSPACE_PROVIDERS` metadata rides only into omp spawns (rpc/process, catalog list_models, todos/omp run_print, sidechat classify_route, term_open_session). Private extension `~/.omp-workspace/extension/omp-workspace-providers.ts` registers `ompws-<slug>` providers + models with OMP at spawn — never edits `~/.omp/agent/models.yml`.
- `install_status_extension_globally() -> String` — copies the extension into `~/.omp/agent/extensions/` (opt-in button)

**E — schedules (定时任务):**
- `schedules_list() -> Vec<Schedule>`
- `schedules_save(schedule: ScheduleDraft) -> Schedule`
- `schedules_delete(id: String)`
- `schedules_set_enabled(id: String, enabled: bool) -> Schedule`
- `schedules_run_now(id: String) -> ScheduleRun`
- `schedule_runs(schedule_id: String, limit: Option<u32>) -> Vec<ScheduleRun>`

**F — skills & extensions (技能与扩展):**
- `skills_list(cwd: Option<String>) -> SkillsCatalog`
- `skills_read(path: String) -> String`
- `skills_trash(dir: String)` — moves a skill directory to the OS Trash (validated to be a direct child of a known skill root)

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

### 8.1 Turn checkpoints extension

`extension/omp-workspace-checkpoints.ts`, installed at startup to `~/.omp-workspace/extension/` and passed via `-e` only when
`settings.turn_checkpoints == Some(true)` (so only app-launched sessions; toggling affects newly started sessions). No-op outside a git
work tree and in subagent sessions; never throws; git via argv with timeouts.
- `agent_start` / `agent_end`: snapshot the whole working tree through a temp `GIT_INDEX_FILE` (real index untouched) into hidden refs
  `refs/omp/turns/<sid>/<turnId>/{before,after}` (`sid` = session id with `[^A-Za-z0-9._-]` → `_`; `turnId` = `t<epoch-ms>`). When the turn
  changed files or made commits, append session entry `custom` / `omp-workspace.turn-checkpoint`
  `{ v:1, turnId, sessionId, userItemId, prompt, before, after, headBefore, headAfter, commits, files:[{path,status}], endedAt }`;
  otherwise delete its refs. Keep the newest 50 turns per session.
- `before_agent_start`: once per session inject `extension/autocommit-rule.md` (custom_message `omp-workspace.autocommit-rule`,
  hidden); after an app undo (`refs/omp/undone/<sid>/<turnId>`), inject an undo notice once and record `omp-workspace.turn-undo-notified`.
- Frontend jumps go through `stores/turnNav.ts` (`showCommit(cwd, sha)` chat → Git 版本历史, `showTurn(sessionId, userItemId)` → chat `msg-<id>`).

## 9. Cross-module Rust API (stubbed at scaffold; signatures frozen)

```rust
// catalog (A)
pub async fn catalog::list(state: &AppState) -> Vec<SessionMeta>;
pub async fn catalog::get(state: &AppState, session_id: &str) -> Option<SessionMeta>;
pub async fn catalog::set_pending(state: &AppState, session_id: &str, pending: Option<PendingKind>);  // used by D's system detection? NO — A owns pending; D only reads
pub fn catalog::init(state: AppState);   // spawn scanner/watcher/status tasks
pub async fn catalog::set_cwd_override(state: &AppState, session_id: &str, cwd: &str); // persist cwd_override + recompute meta
// rpc (B)
pub async fn rpc::send_prompt(state: &AppState, session_id: &str, text: &str) -> Result<(), String>; // ensure_live + prompt (followUp when streaming)
pub async fn rpc::ensure_live(state: &AppState, session_id: &str, cwd: Option<String>) -> Result<LiveSessionInfo, String>; // cwd=Some: persist as cwd_override + resume there
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
// schedules (E)
pub fn schedules::init(state: AppState);    // start background scheduler & startup catch-up
// todos (D helpers)
pub fn todos::detect::reconcile_db(conn: &rusqlite::Connection, sessions: &[SessionMeta], live_pending: &[(String, Vec<PendingUiRequest>)], all_services: Vec<ServiceInfo>) -> bool; // resolves zombie & orphaned todos
pub fn todos::detect::resolve_status_leaving(conn: &rusqlite::Connection, sid: &str, new: SessionStatus) -> bool;
```
(`catalog::set_pending` is internal to A; listed only so nobody else writes `pending_kind`.)

Status/pending ownership: **A** derives `SessionStatus` + `pending` from `AppEvent::RpcFrame/RpcProcess/UiResponded/PromptSent/SessionAccepted`,
status files, lsof and transcript heuristics, persists to `session_meta`, emits `SessionStatusChanged`
and `sessions:updated`. **D** turns status changes + RPC frames into todos. **D/notify** turns status changes into notifications.

## 10. Frontend feature entry points (fixed names)

| Import | Rendered where |
|---|---|
| `features/sessions/SessionSidebar` | left column (Codex-style vertical nav on top) |
| `features/home/StartPage` | center when `ui.centerView === "home"` (default composer-first screen) |
| `features/chat/SessionView` (props `{ sessionId }`) | center when `ui.centerView === "session"` (or `StartPage` if none selected) |
| `features/editor/DocView` (props `{ path }`) | center when `centerView === "doc"` (or `StartPage` if none selected) |
| `features/inbox/InboxPage` | center when `centerView === "inbox"` (merged queue + backlog) |
| `features/schedules/SchedulesPage` | center when `centerView === "schedules"` |
| `features/skills/SkillsPage` | center when `centerView === "skills"` |
| `features/terminal/AgentTerminalPage` | center when `centerView === "agentTerminal"` |
| `features/settings/SettingsOverlay` | overlay when `centerView === "settings"`, keeps underlying center view mounted |
| `features/terminal/TerminalDrawer` | global bottom-drawer terminal (Codex-style overlay) |
| `features/todos/TopCapsule` | top bar, right |
| `features/backlog/QuickCapture` | global modal (always mounted) |
| `features/diagnose/DiagnoseDialog` | global modal (always mounted; opened via `ui.openModal("diagnose", {sessionId})`) |
| `features/git/QuickAskDialog` | global modal (opened via `ui.openModal("quick-ask")` or ⌘⇧K) |
| `features/sidechat/SideChatPanel` | right tab `sidechat` |
| `features/heatmap/HeatmapPanel` | right tab `heatmap` |
| `features/git/GitPanel` | right tab `git` |
| `features/services/ServicesPanel` | right tab `services` |
| `features/todos/TodoPanel` | right tab `todos` |
| `features/explorer/FileExplorer` | right tab `explorer` |
| `features/terminal/TerminalView` (props `{ sessionId }`) | center, when `ui.sessionViewMode[sessionId] === "terminal"` (SessionView renders it) |
| `features/mobile/MobilePanel` | inside SettingsPage (under `mobile` section) |
| `features/git/NewSessionDialog` | global modal (`ui.openModal("new-session", {workspaceId?, cwd?})`) |
| `features/sessions/ResumeMissingCwdDialog` | global modal (`ui.openModal("resume-missing-cwd", {sessionId, cwd, repoRoot, worktreeName?})`, driven by `lib/ensureLive.ts`) |

Sidebar navigation (Codex-style vertical nav list at the top of the left sidebar):
1. **新建会话** (`⌘N`): opens new session flow; right-side button **快速提问** (`⌘⇧K`) opens `QuickAskDialog`.
2. **收件箱**: `setCenter("inbox")`; unread badge via `useInboxBadge()` reading `useTodos.counts.open`.
3. **定时任务**: `setCenter("schedules")`; management for automated schedule runs.
4. **技能与扩展**: `setCenter("skills")`; browser for available skills and extension plugins.

`stores/ui.ts` shape:
```ts
type CenterView =
  | "home"
  | "session"
  | "doc"
  | "inbox"
  | "schedules"
  | "skills"
  | "settings"
  | "agentTerminal";
type RightTab = "explorer" | "sidechat" | "heatmap" | "todos" | "git" | "services";
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

`stores/worktrees.ts` shape:
```ts
interface WorktreesState {
  byWorkspace: Record<string, WorktreeInfo[]>;   // live worktrees per workspace id; first entry = main checkout
  refresh(workspaces?: Workspace[]): Promise<void>; // git_list_worktrees per project ws; errors/non-repo → []; in-flight deduped
}
```
Sidebar grouping consumes it via `GroupingOptions.worktrees`: each listed worktree yields a
subgroup (empty ones dimmed 暂无会话, main tagged 主目录), sessions attach by deepest cwd
containment, and sessions in deleted worktree dirs group under a default-collapsed
已清理的工作树 folder per project. Git worktree create/cleanup call sites must call `refresh()`.

## 11. Module specs

### A — Catalog (backend) + left column (frontend)
- Scan `~/.omp/agent/sessions/*/*.jsonl` at startup; watch with `notify-debouncer-full` (300 ms). Listing reads only
  the title slot (line 1, `type:"title"`), the header (`type:"session"`), and the last ~64 KB tail. Cache by (path, size, mtime).
  Must handle 35+ buckets and multi-MB files fast (<1s cold on this machine).
- Title: `session_meta.custom_name` > title slot > latest `title_change` > first user text (≤40 chars) > "未命名".
- Label: `#<n>` from title regex `^#(\d+)`; else `#L<seq>` from `session_meta.seq`. Side chats keep the stored label.
- Workspace membership: explicit `session_meta.workspace_id` > registered workspace whose path equals/contains `repo_root ?? cwd` >
  Global if cwd under `global_dir()` > None (未归入工作区). Global workspace row is created at startup (`kind=global`).
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
- Frontend `SessionSidebar` (`SessionSidebar.tsx` + `GroupHeader.tsx`, `sidebarStore.ts`, `sidebarShortcuts.ts`,
  `newSession.ts`, `sessionActions.ts`, `SessionDialogs.tsx`, `archiveUndo.ts`/`ArchiveUndoBar.tsx`, `visibleRows.ts`,
  `useMinuteTick.ts`, `sidebarVisibility.ts`, `grouping.ts`): pinned 🌐 全局 group on top, then 已置顶,
  registered workspaces, then 未归入工作区 (per-cwd subgroups via `unassignedGroups`); inside each workspace,
  sub-groups by live worktree (`GroupingOptions.worktrees`, `WorktreeInfo.sessionIds` first then cwd containment);
  sessions in deleted worktree dirs fold into a default-collapsed 已清理的工作树 subgroup. Forks (`parentId`) are
  flat rows with a fork icon + tooltip. Rows: fork icon → title (marquee) → status mark next to title
  (RFC palette: sky 待回复 capsule, emerald 待验收 dot, red 异常/已中断 dot, grey spinner 运行中, blue unread dot
  only on unmarked rows) → timestamp with hover time-swap `…` menu; second line only inside `SessionHoverCard`.
  Paging: `needsAttention` (working/awaiting/review/error/interrupted/unread) and the selected row stay rendered
  past the limit with a `···` gap marker; `展开 N 条` counts only rows that will appear. Collapsed group headers
  show per-status count bubbles. While the pointer is over the list, ordering freezes (`frozenOrder`/`snapshotOrder`).
  Selection/`visible` truth = the DOM (`data-sidebar-list` + `#session-row-<id>`); keyboard ⌘N/⌘⇧K/⌘F global
  (registered in `sidebarShortcuts`), list owns ↑/↓/Enter/←/→/Delete(archive)/Shift+Delete/F2/Shift+F10.
  `archiveSessions` (busy/awaiting → confirm) + `undoArchive` merge within 8 s; `requestArchive`/`requestDelete`/
  `requestAssign`/`requestRename`/`requestRowMenu` in `sessionActions.ts`; dialogs portaled in `SessionDialogs.tsx`.
  Mark-seen is centralized in the sessions store: selecting any session marks it seen.
  Selecting a row → `ui.selectSession(id)`; `SessionSidebar` reveals the selected row on selection change
  (expands group + scrolls into view).

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
  transcript incrementally). Virtualized.
- Turn grouping (`turnGrouping.ts`): normalizes linear transcript items into `DisplayBlock[]` (`TurnBlock` vs `ProtocolBlock`).
  Each `TurnBlock` starts at a `user` item — or, for agent activity with no preceding visible user message, has `userItem = null`
  (render no user bubble) — aggregates intermediate `TurnStep`s (collapsible `thinking` blocks, `tool` calls paired with
  their `tool_result`, intermediate `text` updates, `notice` steps), and terminates on the final assistant `answerItem`,
  computing `stepCount` and total `durationMs`. Protocol items (`model_change`, `compaction`, `custom`, `system`) form
  standalone `ProtocolBlock`s only between turns; one that arrives mid-run (assistant/tool activity follows before the
  next user message — e.g. `async-result` background-job notices, `launch-completion`, auto-compaction) stays inside the
  turn as a `notice` step. Labels come from `noticeLabel` (Chinese, never the raw kind). Duration is formatted in Chinese
  via `formatDurationChinese` (e.g. "12 秒", "1 分 23 秒"); model strings are cleaned to display names via `formatShortModel`.
- Execution disclosure (`ExecutionDisclosure.tsx`): collapsible drawer displaying intermediate thinking processes, tool call cards
  (with command, args, status, and inline diffs from `toolResult.details.diff`), and execution step counts.
- Answer footer (`AnswerFooter.tsx`): rendered below each assistant message; displays duration, model badge, Git checkpoint status
  (`TurnCheckpoint`: saved commit badge jumping to git timeline via `useTurnNav.showCommit`, modified files count toggle, single-click "撤回这一轮"
  undo with conflict detection), copy button, and side-chat fork button.
- Image attachments: `ImageAttachment` (blob refs, clip files, mimeType, width, height) rendered via `ImageChips.tsx` with Tauri asset
  protocol (`protocol-asset` feature, scope `$HOME/.omp/agent/blobs/**`, `$APPCACHE/ompws-clip/**`) and full preview portaled at `Z_LAYER.modal`.
  User bubbles; assistant markdown; hidden items not shown (toggle).
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
- Worktrees: `git worktree add <repo>/.worktrees/<slug>` checking out `branch` (default `omp/<slug>`; when the branch doesn't
  exist it is created from `base`, default HEAD); ensure `.worktrees/` is ignored via `<repo>/.git/info/exclude`
  (do not edit the repo's .gitignore). Remove: refuse when dirty unless `force`; optionally delete branch.
- Orphans: for each registered workspace repo, `.worktrees/*` with no session (via `catalog::list`) whose cwd is inside.
  Frontend: on app start, if orphans exist, show a dismissible banner in GitPanel/Home "发现 N 个孤儿 worktree" with 回收 buttons.
- Time machine: `tm_run` → `git worktree add --detach <repo>/.worktrees/tm-<short> <sha>`; command = given or detected
  (package.json `scripts.dev` → `pnpm dev`/`npm run dev` by lockfile, else `cargo run`, else none → just open folder); install deps if
  `node_modules` missing (`pnpm install --frozen-lockfile` etc.) before running; stream output via `tm:log`; detect URL `http://localhost:\d+`
  from output. `tm_stop` kills the process group and optionally removes the worktree. `git_reset_to` soft/hard (frontend double-confirm on hard,
  warn on uncommitted changes).
- `GitPanel` (selected session's repo): worktree map on top — every worktree with its uncommitted-change count, sessions, 清理; idle
  branches with 建工作树. Clicking a worktree focuses it; below, a 提交改动 | 版本历史 tab pane shows that worktree: 提交改动 =
  one-click 存档 (AI-written message by default; hand-written message behind a pencil toggle; warns while a session in the
  worktree is `working`) + files with +/- (click → diff modal, or `DocView` for md); 版本历史 = commit timeline grouped by day (time
  gutter + rail); an expanded commit offers 看看 (diff) / 试试 (▶ run this version: live log + URL + 停止/丢弃) / 回到 (keep later
  changes, or discard everything after it). Refreshes every 10 s while visible, on focus and on session activity.
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

### D — Inbox (smart todos + backlog), supervisor, summaries, diagnose, notifications, settings (backend + frontend)
- System detection (when `settings.system_detection`): subscribe to bus. Create/refresh todos with `dedupe_key`:
  approval/question `ui:<sessionId>:<requestId>` (payload `{uiRequest}`), review `review:<sessionId>`, error `error:<sessionId>`,
  interrupted `interrupted:<sessionId>`. Resolve automatically (status Done) when: `UiResponded` for that request; `SessionAccepted` or
  `PromptSent` for review/question; session status leaves Error/Interrupted (`resolve_status_leaving`). Emit `todos:changed` with counts.
- Reconcile safety net (`todos::detect::reconcile_db`): periodically and on session rescan, resolves zombie todos whose sessions
  were deleted or are missing from the catalog, resolves orphaned UI todos when the session is not live or the pending request was dismissed,
  and syncs absent status todos.
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
  file → path (+ first 200 lines if small), annotation → quoted text). Auto-mark Done when target session is accepted (`SessionAccepted`).
- `QuickCapture`: global shortcut (`global-shortcut` plugin, `settings.quick_capture_shortcut`) shows+focuses window, emits `quick-capture`;
  modal also opened via `ui.openModal("quick-capture", {text?, sessionId?})`. One line + kind + auto-ref to current session.
- Notifications: on `SessionStatusChanged` → Review (turn end), AwaitingApproval/AwaitingAnswer, Error/Interrupted (exit), per settings;
  skip when the main window is focused AND that session is selected. Dock badge = open todo count (`window.set_badge_count`). Optional sound (`sound: "default"`). `notify_test` command.
- `InboxPage` (center when `centerView === "inbox"`): unified center page replacing separate TodoHome and BacklogPage.
  Combines 智能待办 (system & supervisor todos + `schedule_run`, with direct actions: 审批, 验收, 恢复, 查看定时任务) and
  需求与想法 (BacklogItems: idea/bug/todo, with dispatch to new/existing session); gear button navigates to Settings section `"inbox"`.
- `useInboxBadge()`: reactive hook returning `useTodos((s) => s.counts.open)` for the sidebar 收件箱 unread badge.
- `TopCapsule`: pill `待处理 open/total` (hidden if `!capsule_visible`), click → popover with the compact queue; second segment shows the selected
  session's subagents from `stores/live.ts` (运行中/完成/失败 counts, click → details list).
- `TodoPanel` (right tab): same queue filtered to the selected session.
- `SettingsPage`: navigation organized into 5 top-level groups:
  - 常规: `general` (通用), `appearance` (外观), `notifications` (通知)
  - 模型: `providers` (API 供应商), `omp-roles` (模型角色), `omp-model` (模型与目录), `omp-thinking` (思考与采样), `omp-retry` (重试与回退)
  - Agent: `sessions` (会话), `inbox` (收件箱; legacy `todos` callers migrated), `omp-context` (上下文与记忆), `omp-tools` (工具与审批), `omp-tasks` (任务与子代理)
  - 连接: `mobile` (手机访问; renders `MobilePanel`), `omp-providers` (网络与扩展)
  - 高级: `advanced` (高级), `omp-advanced` (其他 OMP 配置)

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

### F — Scheduled tasks (backend + frontend)
- Cadence semantics: `ScheduleCadence::Interval { minutes }` (pure interval math) and `Daily { time: "HH:MM", weekdays: Vec<u32> }` (local-time, DST-safe search over next 14 days; empty weekdays = run every day).
- Background scheduler (`schedules::scheduler`): calculates earliest `next_run_at` across enabled schedules; sleeps via `tokio::select!` with `tokio::sync::Notify` wakeups on mutations (`schedules_save`, `schedules_delete`, `schedules_set_enabled`).
- Catch-up: on startup and sleep-wake loop, checks all enabled schedules where `next_run_at <= now`; executes them immediately and advances `next_run_at` to prevent missed runs.
- Skip-if-running: if a schedule's previous run is still `Running`, automated triggers mark the run `Skipped` ("上一次运行仍在进行中，已跳过") and advance `next_run_at` without duplicate executions; manual `schedules_run_now` returns an explicit error.
- Isolated execution: supports `local` cwd or `worktree` mode (creates isolated worktree `.worktrees/sched-<slug>-<id8>` via git).
- Completion detection: spawns RPC session with label `⏰ <name>`, subscribes to bus; turn completion detected by transition to `SessionStatus::Review` or `Idle` (after work started) → `Ok`; `Error` / `Interrupted` / non-zero process exit → `Error`. Timeout cap 1 hour.
- Todo write: writes `ScheduleRun` record with status and last assistant text summary, updates schedule's `last_run_at` (and derives `last_run_status` via `SCHEDULE_COLS` subquery), and writes a `Todo` with kind `schedule_run`, source `schedule` (always visible, not gated by system/supervisor switches), dedupe key `sched:<run_id>`, payload `{"scheduleId","runId","ok":bool}`. Emits `schedules:changed`.
- Frontend `SchedulesPage` (`centerView === "schedules"`): lists scheduled tasks with toggle switches, human-readable cadence descriptions (`humanCadence.ts`), last run status badges (运行中/成功/失败/跳过), expandable run histories with log snippets, manual "立即运行" trigger, and `ScheduleEditorModal` for creating/editing drafts.

### G — Skills & extensions catalog (backend + frontend)
- Discovery roots:
  - Project roots (walking up from `cwd` up to 5 levels or `.git`): `.omp/skills`, `.agents/skills`, `.agent/skills`, `.claude/skills`, `.codex/skills`, `.github/skills`; extensions in `.omp/extensions`.
  - User global roots: `~/.omp/agent/skills`, `~/.omp/agent/managed-skills`, `~/.agents/skills`, `~/.agent/skills`, `~/.claude/skills`, `~/.codex/skills`; extensions in `~/.omp/agent/extensions`.
- Cheap scanning: frontmatter parsing extracts `name` and `description` from the YAML header of `SKILL.md` without loading entire files; fallback to directory name when name is missing.
- Invocation syntax: slash command `/skill:<name> [arguments]` (registered in omp) or `skill://<name>` URI. UI button inserts `/skill:<name> ` directly into active session composer draft and auto-focuses it.
- Read path restriction: `skills_read` strictly verifies `is_path_allowed`: target must be a `.md` file, strictly contained within recognized project skill directory structures or standard user home skill roots. Rejects directory traversal (`..`) and paths outside allowed skill roots.
- Extension disablement: checks `disabledExtensions` array in global/project config (`config.yml` / `settings.json`) matching extension names, module IDs (`extension-module:<name>`), or file paths; files ending in `.disabled` are also treated as disabled. Toggled via `omp_config_set`.
- Frontend `SkillsPage` (`centerView === "skills"`): single-column "Skills 管理" center page — stat cards (全部/近期活跃/在吃灰/有问题), resident-context budget meter (~15k chars), source/status segmented filters plus sort menu, a table (name+issues+copies badges, install root, `N 天触发`, last used, row actions), a right-side detail drawer with rendered `skills_read` markdown, and an extensions tab with enable toggles. Usage stats come from `skills_usage`; the page degrades to `—` when it is unavailable. The right dock is hidden on this view (see `CENTER_WITHOUT_RIGHT_PANEL`).
- Enablement: the page loads `skills.*` + `disabledExtensions` via `omp_config_list` into `skillConfig` and mirrors OMP's session-start filter (`resolveSkillEnablement` in store.ts): `skills.enabled` → `disabledExtensions` `skill:<name>` → per-source `skills.enable*` toggle (mapped from `SkillProvider` + source scope) → `skills.ignoredSkills` globs (`*`/`?`, single-segment, anchored, case-sensitive) → `skills.includeSkills` allowlist. The table's 启用 switch writes via `omp_config_set` with optimistic update + rollback; enable also removes an exact-name ignoredSkills entry. Disabled rows render dimmed with a reason badge; the budget meter counts enabled skills only; the status filter gains 已停用.
- `skills_trash(dir)`: `validate_skill_dir_for_trash` accepts only absolute paths that are a direct child of a known skill root (the `is_path_allowed` root list or any `<x>/.omp|.agents|.agent|.claude|.codex|.github/skills`), never the root itself; `symlink_metadata` gates existence so symlinks are trashed as the link (the `trash` crate canonicalizes the parent only). Runs in `spawn_blocking`; UI confirms via FloatingLayer popover (row) / inline panel (drawer) and notes surviving same-name copies when `copies > 1`.

## 12. UI layering and overlay rules

All floating and layered surfaces throughout the desktop app MUST adhere to the following rules:

- **FloatingLayer portal**: All floating surfaces (menus, popovers, hovercards, context menus, tooltips, dialogs) MUST use `FloatingLayer` portaled to `document.body`, never inline absolute positioning.
- **Viewport containment**: `FloatingLayer` automatically computes placement, flips to the opposite side when the preferred side lacks space, and clamps within `usableViewport()`. The usable viewport explicitly excludes the app bottom status bar (`[data-app-bottombar]`), ensuring floating surfaces never slide underneath it.
- **Stacking tiers (`Z_LAYER`)**: Stacking order is strictly governed by `Z_LAYER` (mirrored as `--z-*` CSS variables in `index.css`), never ad-hoc integers:
  - `drawer`: 40 (`--z-drawer: 40`) — e.g. global `TerminalDrawer`
  - `modal`: 50 (`--z-modal: 50`) — e.g. `NewSessionDialog`, `QuickAskDialog`, `DiagnoseDialog`, `ResumeMissingCwdDialog`, `ScheduleEditorModal`, `ImageChip` full preview
  - `popover`: 60 (`--z-popover: 60`) — e.g. `PerfPopover`, `SessionStatsPopover`, filter popovers
  - `menu`: 65 (`--z-menu: 65`) — e.g. context menus, dropdown action menus (`plusMenu`, `wsMenu`, `ModelSelect`, `ThemeMenu`)
  - `hovercard`: 70 (`--z-hovercard: 70`) — e.g. `SessionHoverCard`, `WorktreeHoverCard`, heatmap tooltips
  - `toast`: 100 (`--z-toast: 100`) — global notification toasts
- **No `position: fixed` inside `.vibrancy-chrome`**: Surfaces styled with `.vibrancy-chrome` apply `backdrop-filter: blur(20px) saturate(190%)`. By CSS specification, `backdrop-filter` creates a new containing block for `position: fixed` elements and a local stacking context, trapping any descendant with `position: fixed` or `z-index` and causing it to be clipped or painted over by sibling layout columns. Floating surfaces must always portal to `document.body` via `FloatingLayer`.
- **Asset protocol & image preview**: Tauri asset protocol is enabled (`features = ["macos-private-api", "protocol-asset"]` in `Cargo.toml`, scopes `["$HOME/.omp/agent/blobs/**", "$APPCACHE/ompws-clip/**"]` in `tauri.conf.json`). Attached images (`ImageAttachment`) are rendered via `ImageChips.tsx`, and click-to-preview is portaled at `Z_LAYER.modal`.
