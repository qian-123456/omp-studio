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
  rpc/              omp --mode rpc process manager, idle suspend, takeover; subagents.rs reads subagent transcripts [B]
  git/              git status/log/diff/worktrees/time machine                         [C]
  services/         local port/process listing, stop, reminders, memory breakdown (perf.rs)      [C]
  todos/            smart todo queue, system detection, summaries, diagnose [D]
  backlog/          backlog store + prompt assembly                                    [D]
  notify/           native notifications, dock badge, sound                            [D]
  mobile/           LAN HTTP server, pairing, QR, SSE, cloudflared tunnel, IPv6 HTTPS + DDNS [E]
  terminal/         PTY sessions                                                       [E]
  schedules/        scheduled tasks, cadence, runner, background scheduler (§11 F)     [E]
  skills/           skills & extensions catalog, frontmatter parse, reader (§11 G)     [F]
  settings_mcp.rs   OMP-managed mcp.json files: list/upsert/remove/enable servers (masked secrets, atomic writes) [D]
  settings_plugins.rs  OMP plugin roots + lockfiles: list/enable plugins                  [D]
  settings_model_roles.rs  agent discovery, model precedence, narrow lossless YAML role edits [D]
  model_replace.rs  bulk model replace: usage scan, guarded apply/undo, replace log, model probe (§7 D) [D]
  privacy/          privacy placeholders: store, classify, file writers, commands       [P]
  visualize.rs      bundled visualize plugin install + spawn `--plugin-dir` wiring      [B]
src-tauri/mobile/index.html   mobile web app (single file, vanilla JS)                 [E]
src-tauri/prompts/*.md + src/prompts.rs  prompt templates + render() ({{var}}, {{#if var}}..{{/if}}) [LEAD]
extension/omp-workspace-status.ts   OMP status-report extension (§8)                   [E]
extension/omp-workspace-checkpoints.ts + autocommit-rule.md  turn checkpoints extension (§8.1) [C]
extension/omp-workspace-privacy.ts  privacy placeholder restore/mask extension         [P]
src-tauri/resources/plugins/omp-workspace-visualize/  bundled omp plugin (visualize skill) [B]
src/
  main.tsx, App.tsx          shell, three-pane layout, top bar                          [LEAD]
  components/FloatingLayer.tsx  stacking portal, usableViewport clamp, Z_LAYER tiers (§12) [LEAD]
  components/CenterHeader.tsx   top bar with window drag & sidebar/right toggles; "终端" icon button (toggles right tab "terminal") [LEAD]
  components/RightAside.tsx     collapsible right tab container (incl. "terminal" = 终端) [LEAD]
  components/Segmented.tsx      generic pill segmented control (settings, skills)       [LEAD]
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
  features/todos/            todo queue store (`useTodos`, feeds the inbox 定时任务 rows)  [D]
  features/inbox/            session-status hub center page (tabs), attention helper, useInboxBadge (§11 D) [D]
  features/backlog/          backlog store, quick capture modal, top-bar 想法 capsule + dropdown [D]
  features/schedules/        scheduled tasks center page, cadence editor, run history (§11 F) [E]
  features/skills/           skills & extensions browser center page (§11 G)            [F]
  features/diagnose/         diagnose dialog                                            [D]
  features/settings/         settings page & overlay (categorized IA, §11 D)            [D]
    SettingsPage.tsx         shell only: nav sidebar/search (⌘F/⌘K), deep-link flash, routing
    navigation.ts            NAV_GROUPS + per-section search terms, ompCategoryOf/ompSectionId
    sections/                one component per nav id; sections/index.ts = id → component map
      AgentsMdSection.tsx    `agents-md`: edit global ~/.omp/agent/AGENTS.md or project <cwd>/AGENTS.md | <cwd>/.omp/AGENTS.md (agentsMd.ts = target/conflict helpers)
      ShortcutRecorder.tsx   key-combo recorder → Tauri accelerator string (used by 通用 「快速记录快捷键」)
    ui.tsx                   SectionHeader, SettingsCard, SettingRow, ToggleRow, CommitInput, useSaveStatus/SaveIndicator
    useAppSettings.ts        useAppSettings (settings + save), useModelCatalog, useSettingsProjectCwd
    settingsNav.ts           SettingsNavContext / useSettingsNav (search query + navigate)
    AgentModelAssignmentsPanel.tsx  `omp-roles`: page header (incl. 「批量替换模型」 button) + one card holding the 配置范围 row and the 角色分配 table (agents, effective-model reasons, global/project roles, collapsed named overrides)
    FallbackChainsSection.tsx  `model-fallback`: preserved fallback-chain and role-cycle settings; no modelRoles writes
    modelReplace/            批量替换模型 dialog: usage overview + probe, X→Y pick, per-row preview, results/retry, live-session switch, history/undo; pure value transforms in a tested module
  features/mobile/           pairing / tunnel panel (inside settings or its own modal)  [E]
  features/terminal/         right-panel command terminal & agent terminal center view  [E]
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
| `~/.omp-workspace/global/` | cwd for the 🌐 global workspace (Code space) |
| (removed in v11) `~/.omp-workspace/spaces/<mode>/global/` | per-mode globals existed briefly in v10; dirs are left on disk, rows dropped |
| `~/.omp-workspace/status/<sessionId>.json` | status files written by the extension (§8) |
| `~/.omp-workspace/extension/omp-workspace-status.ts` | extension installed at startup from `include_str!` |
| `~/.omp-workspace/extension/omp-workspace-checkpoints.ts` | turn checkpoints extension (§8.1), installed at startup; loaded only when `settings.turn_checkpoints == Some(true)` |
| `~/.omp-workspace/plugins/omp-workspace-visualize/` | bundled omp plugin (`plugin.json` + `skills/visualize/SKILL.md`) embedded via `include_str!` from `src-tauri/resources/plugins/`; installed at startup, spawned via `--plugin-dir` when `settings.visualize_enabled` (default true) |
| `~/.omp-workspace/oneshot-sessions/` | cwd / `--session-dir` for one-shot `omp -p` runs (summaries, quick ask, diagnose) |
| `~/.omp-workspace/privacy/secrets.json` | privacy entries (placeholders+aliases, value, track, wholeWord, optional `cutoffs`) + `nativeHash` (from entries without cutoffs); read live by the privacy extension (0600, dir 0700, atomic) |
| `~/.omp-workspace/privacy/omp-overlay.yml` | `secrets.enabled: true`, passed via `PI_CONFIG_FILES` when ≥1 natively tracked (tracked, cutoff-free) entry |
| `~/.omp/agent/secrets.yml` | managed block (`# >>> omp-workspace privacy …` markers) of tracked entries WITHOUT any session cutoff for OMP's native secrets layer; user bytes preserved; not created while there are no such entries; non-sequence file ⇒ not written, status `conflict` (§8.2 fail-closed) |
| `<repo>/.worktrees/<name>` | session worktrees (branch `omp/<name>`) and time-machine worktrees (`tm-<shortsha>`, detached) |

`paths.rs` exposes `data_dir()`, `db_path()`, `global_dir()`, `spaces_dir()`, `global_dir_for(mode)`, `status_dir()`, `extension_path()`,
`oneshot_dir()`, `omp_sessions_dir()`; `ensure_dirs()` is called at startup.

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

/// Sidebar space ("mode"): visually independent spaces — each has its own
/// sessions and (project modes) workspaces; `chat` (通用对话) is the project-less
/// space owning the global workspace and the session groups. Nothing is shared
/// across modes (same tables/code paths, `mode` is only a discriminator).
/// Code is the default; pre-existing rows and external sessions with no
/// `session_meta` row are Code (except global-dir sessions → chat).
pub enum SpaceMode { Code, Work, Study, Research, Chat } // lowercase serde; unknown/blank strings degrade to Code
pub const GLOBAL_WORKSPACE_ID: &str = "global";  // the single global workspace row; belongs to Chat

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
  pub mode: SpaceMode,            // space: derived (cwd under the global dir = chat) else session_meta.mode recorded at creation; no meta row = Code
  pub group_id: Option<String>,   // SessionGroup (chat space); only global-workspace sessions
}
pub enum Attention { Awaiting, Error, Unread, Running } // snake_case; precedence awaiting > error > unread > running

pub enum WorkspaceKind { Project, Global }
pub struct Workspace { pub id: String, pub path: String, pub name: String, pub kind: WorkspaceKind, pub sort: i64, pub mode: SpaceMode }
// workspaces are unique on (path, mode): the same disk directory may be a project in several spaces.

/// User-created named category inside the 通用对话 (`chat`) space — a grouping only,
/// never a directory. Only global-workspace sessions can be grouped.
pub struct SessionGroup { pub id: String, pub mode: SpaceMode, pub name: String, pub sort: i64 }

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
pub struct OmpStaleness { pub fingerprint: Option<String>, pub stale_session_ids: Vec<String> } // rpc_omp_staleness; fingerprint = canonical exe path + mtime + size
pub struct StartOpts {
  pub cwd: String,
  pub resume_file: Option<String>,     // --resume <path>
  pub model: Option<String>,           // --model
  pub approval_mode: Option<String>,   // --approval-mode; default from settings
  pub parent_session_id: Option<String>, // for side chats: send `new_session {parentSession}` after ready
  pub label: Option<String>,           // pre-assigned label (side chats)
  pub mode: Option<SpaceMode>,         // space the new session belongs to; persisted to session_meta.mode (None leaves the row untouched → Code on insert)
  pub group_id: Option<String>,        // SessionGroup (chat space only); Some(id) is validated (group exists and mode == chat), None leaves the row untouched
}
pub struct PendingUiRequest { pub session_id: String, pub request: serde_json::Value /* raw extension_ui_request */, pub received_at: String }

pub enum TodoKind { Approval, Question, Error, Interrupted, Review, ServiceLeft, ScheduleRun }
pub enum TodoSource { System, Schedule } // Schedule: always visible (not gated by the system-detection switch)
pub enum TodoStatus { Open, Done, Ignored }
pub struct Todo {
  pub id: String, pub kind: TodoKind, pub source: TodoSource, pub status: TodoStatus,
  pub session_id: Option<String>, pub title: String, pub detail: String,
  pub payload: serde_json::Value,  // Approval/Question: {"uiRequest": <raw request>}
  pub priority: i32,               // higher = more urgent; Approval 50, Question 40, Error 30, Interrupted 25, Review 20, ServiceLeft 15, ScheduleRun 12
  pub created_at: String, pub updated_at: String,
}
pub struct TodoCounts { pub open: u32, pub total: u32 }

pub enum BacklogKind { Idea, Bug, Todo }
pub enum BacklogStatus { Inbox, Dispatched, Done, Closed }
pub struct BacklogRef { pub kind: String /* "session" | "file" | "annotation" */, pub session_id: Option<String>, pub path: Option<String>, pub text: Option<String>, pub lines: Option<String> }
pub struct BacklogItem { pub id: String, pub text: String, pub kind: BacklogKind, pub refs: Vec<BacklogRef>, pub status: BacklogStatus, pub target_session_id: Option<String>, pub project_dir: Option<String> /* cwd at capture; current-project-first sort */, pub created_at: String, pub updated_at: String }

pub struct GitFileChange { pub path: String, pub status: String /* M A D R ?? */, pub added: u32, pub deleted: u32 }
pub struct GitSummary { pub is_repo: bool, pub branch: Option<String>, pub files: Vec<GitFileChange>, pub has_uncommitted: bool }
pub struct GitCommit { pub sha: String, pub short: String, pub subject: String, pub author: String, pub ts: String }
pub struct GitHistory { pub commits: Vec<GitCommit>, pub fork_point: Option<String> /* merge-base of HEAD with `base` */, pub base: Option<String> /* e.g. "main" */ }
pub struct WorktreeInfo { pub path: String, pub branch: Option<String>, pub head: String, pub dirty: u32 /* uncommitted change count */, pub session_ids: Vec<String>,
  pub ahead: u32, pub behind: u32 /* vs local base main/master via `base...HEAD`; 0 for the base checkout or when no base */ }
pub struct BaseSyncResult { pub merged_from_base: u32, pub fast_forwarded: u32 }
pub struct TurnFile { pub path: String, pub status: String /* A M D */ }
pub struct TurnCheckpoint { pub turn_id: String, pub session_id: String, pub user_item_id: Option<String>, pub prompt: String,
  pub before: String, pub after: String, pub head_before: Option<String>, pub head_after: Option<String>,
  pub commits: Vec<String> /* newest first */, pub files: Vec<TurnFile>, pub ended_at: String, pub restorable: bool, pub undone: bool }
pub struct TurnUndoResult { pub restored: Vec<String>, pub deleted: Vec<String>, pub conflicts: Vec<String>, pub head_reset: bool, pub warning: Option<String>, pub turns_undone: usize }
pub struct TmRun { pub id: String, pub repo: String, pub sha: String, pub worktree: String, pub command: String, pub pid: Option<u32>, pub url: Option<String>, pub log_tail: String }

pub struct ServiceInfo { pub pid: u32, pub name: String, pub port: u16, pub cwd: Option<String>, pub command: String, pub url: String, pub session_id: Option<String>, pub started_by_app: bool, pub memory_kb: Option<u64> }
pub struct ProcessMemoryInfo { pub resident_mb: f64, pub formatted: String, pub processes: u32 }
pub struct PerfBucket { pub bytes: Option<u64>, pub processes: u32 }        // bytes None = unknown
pub struct AppInstance { pub pid: u32, pub label: String /* branch|worktree|pid N; never argv */, pub cwd: Option<String>, pub is_this: bool }
pub struct PerfBreakdown { pub app: PerfBucket /* same footprint semantics as app_memory_usage */, pub omp_spawned: PerfBucket, pub omp_external: PerfBucket,
  pub bar_omp_bytes: Option<u64> /* spawned+external minus macOS responsibility overlap; disjoint bar segment */, pub other_bytes: Option<u64> /* used - app - bar_omp, ≥0 */,
  pub total_bytes: Option<u64>, pub used_bytes: Option<u64>, pub free_bytes: Option<u64>, pub instances: Vec<AppInstance>, pub generated_at: u64 }
pub struct PairingInfo { pub url: String, pub qr_svg: String, pub expires_at: String }
pub enum PairingTarget { Lan, Tunnel, Ipv6 }   // snake_case; default Lan
pub struct DdnsStatus { pub enabled: bool, pub token_set: bool, pub hostname: Option<String>, pub last_ip: Option<String>,
  pub last_sync_at: Option<String>, pub last_error: Option<String>, pub halted: bool /* 401/403/429 or 3 failures; manual sync clears */ }
pub struct MobileStatus { pub running: bool, pub port: u16, pub lan_url: Option<String>, pub tunnel_url: Option<String>, pub cloudflared_installed: bool,
  pub ipv6_running: bool, pub ipv6_port: u16, pub ipv6_address: Option<String>,
  pub ipv6_url: Option<String> /* https://<ddns host>:<port> when DDNS synced to current addr, else https://[addr]:<port> */,
  pub cert_sha256: Option<String> /* self-signed cert fingerprint, AA:BB:… */, pub ddns: DdnsStatus }

pub struct UsageSummary { pub available: bool, pub tokens: u64, pub cost: f64, pub source: String /* "token-tracker" | "transcript" */ }

pub struct Settings {
  pub system_detection: bool,        // default true
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
  pub mobile_ipv6_enabled: bool,     // default false; IPv6 direct HTTPS listener autostart (with mobile_enabled)
  pub mobile_ipv6_port: u16,         // default 7789; 1024..=65535, != mobile_port
  pub ddns_enabled: bool,            // default false; Cloudflare AAAA DDNS (token in vault slug `cloudflare-ddns`, never in settings)
  pub ddns_zone_id: Option<String>, pub ddns_hostname: Option<String>,
  pub quick_capture_shortcut: String, // default "CommandOrControl+Shift+I"
  pub inbox_window_hours: u32,       // default 24; 1..=720; non-awaiting sessions idle longer than this leave the inbox + badge
  pub omp_check_interval_hours: u32, // default 24; 1..=720; hours between automatic omp update checks while the app runs
  // … (later fields: see contracts.rs)
  pub turn_checkpoints: Option<bool>, // default None = never asked; Some(true) loads the checkpoints extension (§8.1)
  pub doctor_model: String,          // default "smol"; AI 会诊 model; empty → "smol"
  pub doctor_auto_mode: String,      // "manual" | "idle" | "scheduled"; default "manual" (no tokens spent without user action)
  pub doctor_idle_minutes: u32,      // default 30; 1..=10080; used in "idle" mode
  pub doctor_schedule_time: String,  // "HH:MM"; default "23:00"; used in "scheduled" mode
  pub window_worktree_title: bool,   // default true; OS window title = "omp-workspace · <app worktree branch>" (worktree dir name when HEAD detached; plain title when lookup fails/off)
  pub side_chat_model: Option<String>, // default None; dedicated model for new side chats ("<selector>" or "<selector>:<level>"), None/unavailable → inherit parent model
  pub visualize_enabled: bool,        // default true; spawn adds `--plugin-dir ~/.omp-workspace/plugins/omp-workspace-visualize` (bundled `visualize` skill) and the chat renders ```` ```visualize ```` fragments in a sandboxed viewer; false = no skill + plain code block
}

// Schedules (定时任务)
pub enum ScheduleRunMode { Local, Worktree }
pub enum ScheduleCadence {                    // #[serde(tag="kind")]
  Interval { minutes: u32 },                  // ≥5
  Daily { time: String, weekdays: Vec<u32>,   // HH:MM local; empty weekdays = every `every` days;
          every: u32, anchor: Option<String> },// weekday subset = every `every` weeks on those days;
                                              // `every` serde-default 1 (omitted in JSON when 1);
                                              // `anchor` local date YYYY-MM-DD fixes the phase when every>1
  Once { at: String },                        // RFC3339 absolute instant, one-shot
  Monthly { day: u32, time: String,           // day 1-31 clamped to month length; HH:MM local;
            every: u32, anchor: Option<String> }, // every `every` months counted from anchor's month
}
pub enum ScheduleLifecycle { Active, Paused, Completed } // derived, not stored
pub enum ScheduleRunStatus { Running, Ok, Error, Skipped }
pub enum ScheduleNotify { All, Important, None }        // lowercase; inbox policy per run:
                                                      //   all = every finished run; important = failed runs +
                                                      //   runs that hit AwaitingApproval/AwaitingAnswer; none = never
pub struct Schedule {
  pub id: String, pub name: String, pub prompt: String, pub cwd: String,
  pub run_mode: ScheduleRunMode, pub cadence: ScheduleCadence,
  pub model: Option<String>, pub thinking: Option<String>, pub approval_mode: Option<String>,
  pub enabled: bool, pub next_run_at: Option<String>, pub last_run_at: Option<String>,
  pub last_run_status: Option<ScheduleRunStatus>, // derived via subquery in store SCHEDULE_COLS
  pub created_at: String, pub updated_at: String,
  pub end_at: Option<String>,           // recurring-only stop instant (RFC3339); NULL = never
  pub lifecycle: ScheduleLifecycle,     // derived: completed = once already ran | recurring past end_at |
                                        //           at max_runs cap; paused = !enabled & !completed; else active
  pub notify: ScheduleNotify,           // stored, default All; which finished runs create an inbox todo
  pub new_chat_each_run: bool,          // stored, default true; false = resume previous run's session (local mode only)
  pub max_runs: Option<u32>,          // recurring-only run cap; NULL = unlimited; `once` ignores it
  pub runs_done: u32,                 // runs started so far (counts toward `max_runs`)
}
pub struct ScheduleDraft {
  pub id: Option<String>, pub name: String, pub prompt: String, pub cwd: String,
  pub run_mode: ScheduleRunMode, pub cadence: ScheduleCadence,
  pub model: Option<String>, pub thinking: Option<String>, pub approval_mode: Option<String>,
  pub end_at: Option<String>,           // ignored for Once
  pub max_runs: Option<u32>,          // ignored for Once; absent = unlimited; serde default None
  pub enabled: bool,
  pub notify: ScheduleNotify,           // serde default All when absent
  pub new_chat_each_run: bool,          // serde default true when absent
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

// Subagents (B) — read from `<parent session file without .jsonl>/<AgentId>.jsonl` (+ `<AgentId>.md|.json` output)
pub enum SubagentStatus { Pending, Running, Completed, Failed, Aborted } // snake_case
pub struct SubagentSummary {
  pub id: String, pub status: SubagentStatus, pub model: Option<String>, pub thinking_level: Option<String>,
  pub prompt: Option<String> /* first user message preview */, pub message_count: u32, pub tool_call_count: u32,
  pub request_count: u32, pub tokens: u64 /* input+output+cacheWrite */, pub cost: f64,
  pub started_at: Option<String>, pub ended_at: Option<String>, pub output_path: Option<String>, pub file_path: String,
}
pub struct SubagentTranscript {
  pub agent_id: String, pub file: String, pub summary: SubagentSummary, pub system_prompt: Option<String> /* session_init */,
  pub prompt: Option<String>, pub items: Vec<TranscriptItem>, pub output: Option<String>, pub output_path: Option<String>,
  pub next_byte: u64 /* incremental tail cursor */, pub reset: bool,
}
// Catalog model (A); context_window comes from `omp models --json` `contextWindow` (None when unknown)
pub struct Model { pub provider: String, pub id: String, pub name: String, pub thinking: Vec<String>, pub context_window: Option<u64> }
// models.yml contextWindow override edit; context_window None = delete the override
pub struct ModelContextWindowEdit { pub provider_id: String, pub model_id: String, pub context_window: Option<u64> }
// MCP / plugin settings types (McpConfigSnapshot, McpServerItem, McpFileInfo, McpKv, PluginCatalog, PluginItem,
// PluginRootInfo) live in settings_mcp.rs / settings_plugins.rs, mirrored in lib/contracts.ts.
// Privacy (P): SecretRisk = safe|risky; PrivacyMarkScope = future|all (serde lowercase, default all); SecretEntry { id, value, label: Option<String>, placeholder, aliases: Vec<String> (legacy),
// risk, track, in_library, library_prompted, created_at, session_count: u32, cutoffs: BTreeMap<String,i64> (backend-only, not serialized to the frontend) }; SecretEntryPatch { label? (Some("") clears), track?, in_library?,
// library_prompted? }; PrivacySnapshot { entries, native_status: "ok"|"conflict"|"error", native_error };
// SecretClassification { level: safe|risky|reject, reason: TOO_SHORT|INVALID_VALUE|SHORT|COMMON, session_occurrences }.
// Settings.privacy_reveal_default: Option<bool> (None ⇒ show real values).
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
  TodosChanged, BacklogChanged, ServicesChanged, PrivacyChanged,
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
| `session_groups:changed` | `null` | A (after any session-group create/rename/delete/reorder/assign) |
| `privacy_changed` | `null` | P (after every privacy mutation) |

## 6. SQLite schema (`db.rs`, migrations v1 → … → v13)

```sql
CREATE TABLE workspaces(id TEXT PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL DEFAULT 'code', created_at TEXT NOT NULL, UNIQUE(path, mode));  -- v10 rebuilt: uniqueness moved from path to (path, mode); pre-v10 rows keep mode='code'
CREATE TABLE session_meta(
  session_id TEXT PRIMARY KEY, file_path TEXT, custom_name TEXT, label TEXT,
  pinned INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  parent_session_id TEXT, fork_depth INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT, unread INTEGER NOT NULL DEFAULT 0, pending_kind TEXT, pending_since TEXT,
  accepted_at TEXT, last_seen_at TEXT, suspended INTEGER NOT NULL DEFAULT 0, created_by_app INTEGER NOT NULL DEFAULT 0,
  seq INTEGER);                                  -- local number when title has no "#<n>"
  -- v2 adds: session_meta.cwd_override TEXT    -- resume dir override picked after the original worktree dir was deleted
  -- v10 adds: session_meta.mode TEXT NOT NULL DEFAULT 'code'   -- space recorded at creation; pre-existing rows are 'code'
  -- v10 adds: session_meta.group_id TEXT      -- SessionGroup id inside the mode's 无项目 area (global-workspace sessions only)
CREATE TABLE session_groups(                    -- v10: per-mode 无项目 categories (grouping only, never directories)
  id TEXT PRIMARY KEY, mode TEXT NOT NULL, name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE todos(id TEXT PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT,
  title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', priority INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE backlog(id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT NOT NULL, refs TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL,
  target_session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);  -- later migration adds: backlog.project_dir TEXT
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
  end_at TEXT,                              -- v7: recurring stop instant (RFC3339); NULL = never
  notify TEXT NOT NULL DEFAULT 'all',       -- v8: 'all' | 'important' | 'none'
  new_chat_each_run INTEGER NOT NULL DEFAULT 1, -- v8: 0 = resume previous run's session (local mode)
  max_runs INTEGER,                           -- v9: recurring-only run cap; NULL = unlimited
  runs_done INTEGER NOT NULL DEFAULT 0,       -- v9: runs started so far
);
CREATE TABLE schedule_runs(
  id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, session_id TEXT,
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, summary TEXT,
  FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE
);
CREATE INDEX idx_schedule_runs_schedule_id ON schedule_runs(schedule_id, started_at DESC);
-- v5: privacy placeholders
CREATE TABLE secret_entries(id TEXT PRIMARY KEY, value TEXT NOT NULL UNIQUE, label TEXT, placeholder TEXT NOT NULL UNIQUE,
  risk TEXT NOT NULL /* safe|risky */, track INTEGER NOT NULL DEFAULT 1, in_library INTEGER NOT NULL DEFAULT 0,
  library_prompted INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE secret_aliases(placeholder TEXT PRIMARY KEY, entry_id TEXT NOT NULL);
CREATE TABLE session_secrets(session_id TEXT NOT NULL, entry_id TEXT NOT NULL, since_ms INTEGER, PRIMARY KEY(session_id, entry_id));
-- since_ms (v6): epoch-ms cutoff for "protect only future content"; NULL = whole history. Set once when the link is created.
-- v13: bulk model replace log (newest 10 kept); edits = JSON ModelReplaceEdit[] of successful edits only
CREATE TABLE model_replace_log(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, from_model TEXT NOT NULL, to_model TEXT NOT NULL,
  edits TEXT NOT NULL, undone_at TEXT);
```
Use a `user_version` pragma for migrations (current: v13; v12 deletes legacy `suggestion`/`supervisor` todo rows; v13 adds `model_replace_log`). `db.rs` also provides `load_settings`/`save_settings` and
`ensure_global_workspace(conn)` (creates the single global workspace row `global`/`~/.omp-workspace/global`, owned by
the `chat` space). v11 moves the global row and every session group (and grouped sessions) to `chat` and drops the
v10 per-mode `global:<mode>` rows (their dirs stay on disk).

## 7. Tauri commands (exact names; all `async`, return `Result<T, String>`)

JS calls use camelCase argument keys (Tauri maps to snake_case).

**LEAD (lib.rs / state):** `get_settings() -> Settings`, `save_settings(settings: Settings) -> Settings` (also re-applies the OS window title via `settings::apply_window_title`), `app_paths() -> {dataDir, globalDir}`

**A — catalog:**
- `list_sessions() -> Vec<SessionMeta>`
- `get_transcript(session_id, from_offset: Option<u64>) -> TranscriptPage` — full parse from 0 or incremental from byte offset
- `update_session_meta(session_id, patch: {customName?, pinned?, archived?, workspaceId?})  -> SessionMeta`
- `mark_seen(session_id)` — clears `unread`, stamps `session_meta.last_seen_at`; if pending is Review, also runs the `accept_session(id, false)` logic (view = accept; emits `SessionAccepted`). The frontend calls it after every 2 s dwell on a session
- `accept_session(session_id, archive: bool)` — clears `pending=Review`, sets Idle, emits `SessionAccepted`
- `list_workspaces() -> Vec<Workspace>` (all modes), `add_workspace(path, mode: Option<SpaceMode>) -> Workspace` (default code; `chat` rejected — it has no project directories), `remove_workspace(id)` (global rows refuse; clears `session_meta.workspace_id` overrides pointing at it), `reorder_workspaces(ids: Vec<String>)`
- `list_session_groups() -> Vec<SessionGroup>` (all modes), `create_session_group(mode, name) -> SessionGroup`, `rename_session_group(id, name) -> SessionGroup`, `delete_session_group(id)` (its sessions become ungrouped, never deleted), `reorder_session_groups(ids: Vec<String>)` — every mutation emits `session_groups:changed`
- `set_session_group(session_id, group_id: Option<String>)` — file a 通用对话 session under a group or ungroup it (null). Validates: group exists, group and session are `chat`, and the session resolves to the global workspace (else `仅通用对话会话可以加入分组` / `会话与分组不属于同一空间`)
- `session_usage(session_id) -> UsageSummary`
- `session_snapshot(session_id) -> SessionSnapshot` — `{thinkingLevel, contextTokens}` recovered from the transcript (last `thinking_level_change`, last assistant prompt tokens unless a compaction follows); the composer shows it while no live `get_state` exists
- `rescan_sessions()`

**A — catalog (added):**
- `session_export_html(session_id) -> String` — runs `omp --export <file>`, returns the produced HTML path
- `session_share(session_id) -> String` — runs `omp share <file>` (same as `/share`: E2E-encrypted snapshot uploaded to the configured share store), returns the share link
- `heatmap_diagnose(prompt: String, model: Option<String>) -> String` — AI 会诊: one-shot `omp -p` (120s) on the distilled session skeleton prompt (never raw transcripts); model = `model` → `doctor_model` → "smol"; returns raw model text (frontend parses JSON); never writes files


**B — rpc:**
- `rpc_start(opts: StartOpts) -> LiveSessionInfo` — `opts.mode`/`opts.group_id` (new sessions) are persisted to `session_meta` after the child reports its sessionId; the group must exist in the same mode (else `会话分组不存在或与空间不匹配`), and the mode's global workspace row/dir is created lazily before spawn
- `rpc_ensure_live(session_id, cwd: Option<String>) -> LiveSessionInfo` — start with `--resume <file>` if not live (used for suspended/interrupted/idle sessions). `cwd` overrides the transcript dir: it must exist, is persisted as `session_meta.cwd_override`, and the catalog meta is recomputed. When `cwd` is None and the located dir no longer exists, returns `Err("CWD_MISSING:<dir>")` so the frontend can offer 主目录 / 重建工作树 (`resume-missing-cwd` modal, `src/lib/ensureLive.ts`). Any `--resume` spawn (`rpc_start` with `resumeFile`, `rpc_ensure_live`, restart) first checks lsof holders + status files (§8, excluding this app's children) and returns `Err("SESSION_HELD:<pid>")` without spawning when another process holds the file (two writers corrupt the JSONL); `errMsg` (`src/lib/dialogs.ts`) renders it in Chinese. ensure_live/restart also refuse while this session's `omp` terminal (`term_open_session`) is open.
- `rpc_send(session_id, command: Value) -> Value` — writes the command with a generated `id`, awaits the matching `response`, returns it (`success:false` → Err(error))
- `rpc_ui_respond(session_id, response: Value)` — writes an `extension_ui_response`, emits `UiResponded`
- `rpc_pending_ui(session_id) -> Vec<PendingUiRequest>` — outstanding dialog requests (select/confirm/input/editor)
- `rpc_stop(session_id)` — close stdin, wait ≤5s, then kill
- `rpc_restart(session_id) -> LiveSessionInfo` — stop + `--resume` (the `/fresh` equivalent; resets provider/stream state, keeps history)

- `rpc_list_live() -> Vec<LiveSessionInfo>`
- `rpc_omp_staleness() -> OmpStaleness` — stat-only (never runs omp): `fingerprint` identifies the binary a new spawn would exec (settings `omp_binary` resolved against the spawn PATH, canonicalized, + mtime + size; None if unresolvable); `stale_session_ids` = live sessions whose spawn-time fingerprint (stored on `SessionHandle`) differs. Unknown spawn fingerprint or None current → not stale. Detects `omp update` run outside the app; fix with `rpc_restart`.
- `subagent_list(parent_file: String) -> Vec<SubagentSummary>` — scans the parent session's subagent dir; status inferred
  (output file → completed; fresh lock/jsonl ≤5 min → running; last stopReason error/aborted → failed/aborted)
- `subagent_transcript(parent_file: String, agent_id: String, from_byte: Option<u64>) -> SubagentTranscript` — `parent_file`
  must be an existing `.jsonl` under `~/.omp/agent/sessions`; `agent_id` rejects separators/leading dot
- `takeover_external(session_id) -> LiveSessionInfo` — SIGTERM external pid, wait ≤5s (SIGKILL after), then `rpc_start` with resume
- `create_side_chat(parent_session_id, selection: Option<String>, question: String, model: Option<String>) -> LiveSessionInfo` — §B spec;
  `model` is an omp `--model` value (`<selector>` or `<selector>:<level>`), None = inherit the parent session's model; the fork records the parent's space (`session_meta.mode`)

**C — git / services:**
- `git_summary(cwd) -> GitSummary`, `git_log(cwd, limit: u32) -> GitHistory` (commits + `fork_point`/`base` for the timeline's "inherited from base" divider), `git_diff(cwd, path: Option<String>, sha: Option<String>) -> String`
- `git_create_worktree(repo, name, branch: Option<String>, base: Option<String>) -> WorktreeInfo` — `name` becomes the
  `.worktrees/<slug>` directory; `branch` (default `omp/<slug>`) is checked out when it exists, else created from `base`
  (default: current HEAD), `git_list_worktrees(repo) -> Vec<WorktreeInfo>`, `git_remove_worktree(repo, path, delete_branch: bool, force: bool)`
- `git_scan_orphans() -> Vec<WorktreeInfo>` — `.worktrees/*` in registered workspaces with no session whose cwd is inside
- Local base-branch ops (base = local `main`, else `master`, same resolver as `git_log`; never touch remotes):
  `git_diff_base(cwd) -> String` (committed patch `base...HEAD`), `git_rebase_onto_base(cwd) -> String`,
  `git_sync_with_base(cwd) -> BaseSyncResult` (merge base into the branch, then fast-forward local base — ff-only merge in the
  worktree that has base checked out, else `update-ref`). Rebase/sync refuse dirty, detached, or base-itself worktrees; on
  conflict they `--abort` and reject with `CONFLICT:\n<path>\n…`. `git_discard_all(cwd)` — `reset --hard HEAD` + `clean -fd`
  (ignored files survive)
- `git_reset_to(repo, sha, mode: "soft"|"hard")`
- `git_commit_suggest(cwd) -> String` — one-shot English Conventional Commit message from everything a commit would record
  (`git add -A` into a throwaway index, so new-file content is included and the real index is untouched; ≤8k chars; recent
  subjects passed as style examples)
- `git_commit(cwd, message) -> String` — `git add -A` + `git commit` (argv, no shell); always saves every change
- `git_session_turns(session_file) -> Vec<TurnCheckpoint>` (oldest first), `git_worktree_turns(cwd) -> Vec<TurnCheckpoint>` (every
  session whose cwd is this worktree) — read `omp-workspace.turn-checkpoint` entries (§8.1); `restorable`/`undone` from hidden refs
- `git_undo_turn(cwd, session_file, turn_id, force: bool) -> TurnUndoResult` — any turn may be undone: the target AND every
  later non-undone turn cascade newest→oldest (workspace returns to its state before the target started). Pre-flight before any
  write: every cascaded turn must be `restorable` (else refuse — a missing snapshot cannot be crossed), and each touched file's
  worktree blob must match the `after` snapshot of the newest cascaded turn that touched it, else `conflicts` and nothing touched
  unless `force`. Per turn: HEAD resets to `head_before` only while HEAD is still `head_after`, files restore from `before`
  (created files deleted), `refs/omp/undone/<sid>/<turnId>` written last; `turns_undone` counts how many were marked
- `checkpoints_rule() -> String` — auto-commit rule text the checkpoints extension injects (consent card / settings)
- `tm_run(repo, sha, command: Option<String>) -> TmRun`, `tm_list() -> Vec<TmRun>`, `tm_stop(run_id, remove_worktree: bool)`
- `services_list(all: bool) -> Vec<ServiceInfo>`, `services_stop(pid)`
- `read_text_file(path) -> String`, `write_text_file(path, content)` (for the md editor; reject paths > 5 MB)
- `save_clipboard_image(base64_png) -> String` — writes pasted image PNG bytes to `$APPCACHE/ompws-clip/<ts>.png` (asset-protocol scoped); `save_clipboard_file(base64_data, file_name?) -> String` — the non-image analogue for pasted/dropped File bytes with no filesystem path (`$APPCACHE/ompws-clip-files/<ts>-<name>`)
- `clipboard_file_paths() -> Vec<String>` — macOS-only JXA/NSPasteboard read resolving real POSIX paths of files on the pasteboard (`NSFilenamesPboardType` then per-item `public.file-url`); `[]` elsewhere or when no file URLs exist. Composer paste/drop uses it so Finder-copied files attach by real path
- `save_share_image(base64_png, path)` — chat share-as-image export: decodes a (optionally `data:`-prefixed) PNG and writes it to the absolute `.png` path chosen in the save dialog; never creates parent dirs. Clipboard copy of the image goes through `plugin-clipboard-manager` `writeImage` (needs the tauri `image-png` feature)
- `app_memory_usage() -> ProcessMemoryInfo` — footprint attributed to this app (macOS responsibility API / Linux self RSS); ~2.5 s cache, powers the bottom-bar 性能 indicator
- `perf_breakdown() -> PerfBreakdown` — system memory split for the perf popover: app tree / omp spawned-by-us vs external (ppid ancestry + responsibility set over `ps pid,ppid,rss,comm` rows — no argv) / other / free, plus omp-workspace instances labelled by worktree branch (lsof cwd + git rev-parse); `spawn_blocking`, ~3 s cache, fields `None` when a probe fails

**D — todos / backlog / notify:**
- `todos_list(include_closed: bool) -> Vec<Todo>`, `todos_act(id, action: "done"|"ignore"|"reopen")`, `todos_counts() -> TodoCounts`
- `summary_get(session_id, ensure: bool) -> Option<String>`
- `diagnose_build_prompt(target_session_id) -> String`
- `backlog_list() -> Vec<BacklogItem>`, `backlog_add(text, kind, refs: Vec<BacklogRef>, project_dir: Option<String>) -> BacklogItem`, `backlog_update(id, patch: {text?, kind?, status?, targetSessionId?, refs?}) -> BacklogItem`, `backlog_delete(id)`, `backlog_build_prompt(id) -> String`
- `notify_test()`

**E — mobile / terminal:**
- `mobile_start() -> MobileStatus`, `mobile_stop()` (also stops the IPv6 listener and persists `mobile_ipv6_enabled=false`), `mobile_status() -> MobileStatus`,
  `mobile_create_pairing(target: Option<PairingTarget>) -> PairingInfo` (default `lan`), `mobile_revoke_all()`
- `tunnel_start() -> MobileStatus`, `tunnel_stop()`
- `mobile_ipv6_start() -> MobileStatus` (persists `mobile_ipv6_enabled=true`), `mobile_ipv6_stop()` (persists false)
- `mobile_ddns_set_token(token) -> DdnsStatus` (verifies, stores in vault), `mobile_ddns_clear_token() -> DdnsStatus`, `mobile_ddns_sync() -> DdnsStatus`
- `term_open(cwd, command: Vec<String>, cols: u16, rows: u16) -> String /* termId */`, `term_write(term_id, data: String /* utf8 */)`, `term_resize(term_id, cols, rows)`, `term_close(term_id)`
- `term_open_session(session_id, agent: String /* "omp"|"claude"|"codex" */, cols, rows) -> String` — one agent terminal per session (reopening, even with another agent, replaces the PTY); unknown agent → `Err("未知的 Agent: …")`. `omp`: stops the RPC process for that session if live, then runs `omp --resume <file> -e <extension_path> [-e <providers ext>]`; `claude`: `claude --continue`; `codex`: `codex resume --last` (RPC process untouched). All run in the session cwd (fallback home) with provider extra env; claude/codex are resolved against the login-shell-augmented PATH first and a missing CLI returns a Chinese `Err` before anything is torn down
- `terminal_set_current_session(path: Option<String>)` — writes/clears `~/.omp-workspace/current-session`; `term_open` command-terminal shells (right panel) source generated `zdot/`/`bashrc`/`terminal-init.*` so bare `omp`/`claude`/`codex` resume that transcript (session terminals unaffected — they run `term_open_session` directly)

**Providers (added module — §2 ownership):**
- `provider_list() -> Vec<ProviderConfig>`, `provider_save(config, api_key: Option<String>) -> ProviderConfig`, `provider_delete(id)`, `provider_test(id) -> ProviderTestResult`, `provider_import_env(text) -> Vec<ProviderConfig>`, `provider_export_env_text(ids: Option<Vec<String>>) -> String`
- Provider secrets: AES-256-GCM vault (`providers/vault.rs`, master key in macOS Keychain via security-framework). `env_pairs()` injects decrypted keys only; `OMP_WORKSPACE_PROVIDERS` metadata rides only into omp spawns (rpc/process, catalog list_models, todos/omp run_print, sidechat classify_route, term_open_session). Private extension `~/.omp-workspace/extension/omp-workspace-providers.ts` registers `ompws-<slug>` providers + models with OMP at spawn (context window fallback: model spec → `defaultContextWindow` → 250000; maxTokens fallback 4096) — skips providers whose slug is defined in `~/.omp/agent/models.yml` (OMP registers those natively). For such providers models.yml is the source of truth: `provider_list` overlays their `models` from it and `provider_save` writes the edited list back into `providers.<slug>.models` (`providers/models_yml_providers.rs`: line-level replace of the `models:` block only, other fields of existing models kept, backup + read-back verify + restore; OMP re-fingerprints the file so no `models.db` invalidation is needed). App-only providers never touch models.yml.
- `omp_models_set_context_windows(entries: Vec<ModelContextWindowEdit>)` (`providers/models_yml_write.rs`) — the only writer of `~/.omp/agent/models.yml`: line-level edit of `providers.<id>.modelOverrides.<modelId>.contextWindow` (None deletes; empty model/`modelOverrides` maps are dropped), all other bytes preserved, `models.yml.bak-<timestamp>` backup alongside, re-parse + verify after write, original restored on failure; never returns file contents. Takes effect in new OMP sessions.
- `omp_models_context_window_overrides() -> Vec<ModelContextWindowEdit>` (`providers/models_yml_write.rs`) — read-only: returns only existing `providers.*.modelOverrides.*.contextWindow` as providerId/modelId/contextWindow (missing file → empty); nothing else from models.yml leaves the backend. Lets the context-window page distinguish catalog defaults from overrides so undo deletes an override that did not exist before.
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

**D — MCP servers & plugins (settings):**
- `mcp_config_list(cwd: Option<String>) -> McpConfigSnapshot` — servers across project `.omp/mcp.json`/`.mcp.json` and user mcp files
- `mcp_server_upsert(cwd, path, name, patch: Value)` — merge patch (null deletes; env/headers merge per key; masked values preserved)
- `mcp_server_remove(cwd, path, name)`, `mcp_server_set_enabled(cwd, name, enabled: bool)`
- `plugins_list(cwd: Option<String>) -> PluginCatalog`, `plugin_set_enabled(cwd, name, enabled: bool)` — writes `plugins.<name>.enabled` in the scope lockfile
- `omp_config_list() -> OmpConfigListResult`, `omp_config_set(key, value)`, `omp_config_reset(key)` — shell out to `omp config` in a neutral empty cwd (`$TMPDIR/ompws-omp-config-cwd`, no `.omp/`) so they reflect global settings only
- `omp_project_config_read(cwd) -> OmpProjectConfigFile { path, exists, content }` — reads fixed `<cwd>/.omp/config.yml` (cwd must be an existing absolute dir); missing file → `exists: false, content: ""`
- `omp_model_roles_read(cwd: Option<String>, session_model: Option<String>) -> ModelRoleSnapshot` — returns only `modelRoles` and `task.agentModelOverrides` per config layer plus discovered agent assignments; never returns configuration source text or other keys.
  Discovery may additionally project extension paths (`extensions`), provider enablement (`enabledProviders` / `disabledProviders`), and Claude `enabledPlugins` booleans solely to locate enabled plugin agents (user-approved read-only metadata). These values never enter the IPC snapshot and are never edited by this feature; no credential fields or raw config text are returned or logged.
- `omp_model_roles_set(cwd: Option<String>, scope: "global" | "project", table: "modelRoles" | "agentModelOverrides", name: String, value: Option<String>, session_model: Option<String>) -> ModelRoleSnapshot` — single-entry lossless YAML edit; `None` removes the entry (project removal restores inheritance). Preserves unrelated bytes, comments, order, permissions and symlinks; rejects unsafe structures without writing.
- `ModelRoleLayer = { path, exists, modelRoles: Record<string,string>, agentModelOverrides: Record<string,string> }`; `ModelRoleSnapshot = { global: ModelRoleLayer, project: ModelRoleLayer | null, agents: AgentModelAssignment[] }`.
- `AgentModelAssignment = { name, source: "builtin" | "user" | "project", declaredModel: string | null, effectiveModel: string | null, effectiveSource: "override" | "global" | "project" | "agent" | "session" | "unresolved", reason: string }`. Named global overrides win even over project settings; otherwise agent declaration → `modelRoles.task` → current session model. Roles merge per key (project > global), aliases resolve recursively, and missing/cyclic aliases are explicitly unresolved. Builtin scout/sonic declare `@smol`.
- Bulk model replace (`model_replace.rs`; types mirrored in `lib/contracts.ts`): scope = global + every registered project workspace's `modelRoles` / `task.agentModelOverrides`, global `retry.fallbackChains` (keys and items), settings `newSessionModel` / `sideChatModel` / `doctorModel`, and `schedules.model` (+ `thinking`). Agent `.md` frontmatter, providers.json, models.yml and session history are never touched; `@role` aliases are never rewritten.
  - `model_usage_scan() -> ModelUsageScan { refs: ModelUsageRef[], fallbackChains: { chains: Record<string,string[]> }, fallbackChainsError, projects: ScannedProject[] }` — `ModelUsageRef = { location: ModelRefLocation, value, thinking }`; `ModelRefLocation` is tagged by `kind`: `role` / `agentOverride` `{ scope, projectPath, name }`, `appSetting { field }`, `schedule { id, name }`. Missing/unreadable project dirs are reported per project (`status: ok | missing | error`), never fail the scan.
  - `model_replace_apply(fromModel, toModel, edits: ModelReplaceEdit[], recordId: Option<String>) -> ModelReplaceResult { recordId, results: { edit, ok, error }[] }` — `ModelReplaceEdit` is `{ kind: "value", location, before, after, thinkingBefore, thinkingAfter }` or `{ kind: "fallbackChain", label, changes: { key, before: string[] | null, after: string[] | null }[] }`. Every edit re-reads the current value and fails without writing unless it equals `before`; YAML edits reuse the lossless role writer. `retry.fallbackChains` is read straight from the global config file (scan and apply) and all chain edits of one call become one guarded, comment-preserving byte-splice write (item replace/delete/append, in-place key rename, block and flow sequences); it never goes through `omp config set`, which rewrites the whole file and drops comments. Other edits still apply when one fails. Successful edits are logged (new record, or appended to `recordId` for retries); newest 10 records kept.
  - `model_replace_history() -> ModelReplaceRecord[]` (newest first; `{ id, createdAt, fromModel, toModel, edits, undoneAt }`), `model_replace_undo(recordId) -> ModelReplaceResult` — applies inverse edits with the same verification; a location changed since the replace is skipped (「当前值已被修改，已跳过」); sets `undoneAt`.
  - `model_probe(model) -> ModelProbeResult { ok, latencyMs, detail }` — one real one-shot call with `todos::omp::run_print`'s flags plus `--config <dataDir>/omp-probe.yml` (`retry.modelFallback: false`, so omp's own fallback chains cannot answer for a dead model); manual only (overview 「测试」 button). Overview flags 「可能失效」 only once the model catalogue has entries.
- `omp_info() -> OmpInfo { found, resolvedPath, version, agentDir, configPath, configExists }` — resolves `settings.ompBinary` on the augmented PATH, runs `omp --version` (first line; null on failure), reports the omp agent dir (honors `PI_CODING_AGENT_DIR` / profile env) and `<agentDir>/config.yml`; used by Settings ▸ 通用 「OMP 环境」
- `omp_update_check() -> OmpUpdateStatus { current, latest, updateAvailable, output }` — runs `omp update --check` (30s timeout, neutral cwd, augmented PATH, ANSI stripped); parses `Current version:` / `New version available:` / `Already up to date`; non-zero exit → Err with output (GitHub rate-limit hint appended when applicable); used by Settings ▸ 版本与更新 and the BottomBar omp chip
- `omp_update_run() -> OmpUpdateResult { success, output, versionAfter }` — runs `omp update` (300s timeout), then re-probes `omp --version`; frontend then refreshes omp info, update status and the model catalog, and `stores/ompUpdateSessions.beginSwitch` moves sessions live at that moment to the new binary via `rpc_restart` (idle ones immediately, busy ones as soon as they go idle; one aggregate toast). `settings.ompAutoUpdate` (null = off) runs the update automatically when a check finds a new version. Settings ▸ 版本与更新 「立即重启所有会话」 force-restarts every live session.
  Check timing (`stores/ompUpdate.ts`): the startup check runs only when `settings.ompCheckIntervalHours` (default 24) has elapsed since the last completed check, and a periodic check (`watchOmpUpdateChecks`, 60 s tick) applies the same interval while the app is open. The last completed check time is persisted in localStorage key `ompws:omp-update-last-check`; failed checks count as checks. Auto-install behaviour is unchanged.
- Privacy (`privacy/commands.rs`, [P]): `privacy_list() -> PrivacySnapshot`, `privacy_classify(session_id: Option<String>, value) -> SecretClassification` (sessionOccurrences = whole-word hits in the session jsonl strings; > 0 means the value was already sent upstream), `privacy_mark(session_id: Option<String>, value, label: Option<String>, track, scope: Option<PrivacyMarkScope> = all) -> SecretEntry` (re-marking an existing value links the session and returns it; `scope` `future` records `since_ms` = now(ms) on a NEW link only — an existing link always wins, `all` never clears a cutoff; the label is replaced by a new non-empty label but the placeholder never changes; reject levels error with `TOO_SHORT`/`INVALID_VALUE`/`LABEL_CONTAINS_VALUE`), `privacy_update(id, patch: SecretEntryPatch) -> SecretEntry` (label change only edits the display label, placeholder is immutable), `privacy_delete(id)`, `privacy_session_entry_ids(session_id) -> Vec<String>`. `SecretEntry.sessionCount` = number of linked sessions (UI confirms delete/untrack when > 0: later requests of those sessions lose protection and their request prefix changes). Every mutation rewrites the §3 privacy files and emits `privacy_changed`.

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
  hidden); after an app undo (`refs/omp/undone/<sid>/<turnId>`), inject one undo notice per pending undone turn (a cascade undo
  produces one notice each), once, and record `omp-workspace.turn-undo-notified` per turn.
- Frontend jumps go through `stores/turnNav.ts` (`showCommit(cwd, sha)` chat → Git 版本历史, `showTurn(sessionId, userItemId)` → chat `msg-<id>`).

### 8.2 Privacy placeholder extension

`extension/omp-workspace-privacy.ts`, installed at startup to `~/.omp-workspace/extension/` and ALWAYS passed via `-e` to app RPC spawns
and the OMP terminal. Mapping file: `$OMPWS_PRIVACY_FILE` (set by `privacy::spawn_env()`, honors `OMPWS_DATA_DIR`), fallback
`~/.omp-workspace/privacy/secrets.json`; re-read on mtime change; missing/invalid ⇒ no-op.
- `tool_call`: restore every placeholder (current + aliases) in the tool input to the real value. OMP persists the rewritten call,
  so real values live in the local transcript.
- `context`: before every normal provider request, replace values of `track` entries with their current placeholder (whole-word for
  risky). This also covers persisted tool calls/outputs and raw values sent unmarked (e.g. from mobile).
- LLM compaction summaries bypass extension hooks; OMP's native secrets layer covers them (managed `secrets.yml` block in `replace`
  mode + overlay `secrets.enabled`), which OMP reads only at process start. `session_before_compact` therefore cancels compaction when
  `secrets.json.nativeHash != $OMPWS_PRIVACY_NATIVE_HASH`; `rpc::refresh_privacy` restarts an idle session whose spawn hash is stale
  before writing a `prompt` frame.
- Fail closed: if the native block could not be written (`conflict`, `error`, or an isolated `OMPWS_DATA_DIR` instance, which never
  touches the global file), `secrets.json.nativeHash` is `unprotected:<hash>` so compaction stays cancelled.
- Cutoffs (future-only marks): an entry may carry `cutoffs: { [sessionId]: epochMs }` in `secrets.json` (omitted when empty). In that
  session, messages older than the cutoff are never rewritten (their bytes keep matching the already-sent, cached prefix; a value
  already sent cannot be un-sent); messages at/after the cutoff are masked as usual. A message with a missing/unparseable
  timestamp is masked (leaking is worse than a cache miss). Sessions without a cutoff for an entry mask it fully.
- The native `secrets.yml` layer is global and cannot honor per-session cutoffs, so entries with a cutoff in ANY session are excluded
  from the managed block and from `nativeHash`/the overlay's tracked count. Compaction summaries bypass extension hooks, so the
  extension cancels compaction (`session_before_compact` → `{cancel:true}`) in EVERY session while any tracked entry has a cutoff in any
  session (the entry is missing from the global native block, so other sessions lose native coverage too), in addition to the
  stale/unprotected hash guard. Tradeoff: no session auto-compacts until the cutoff entry is deleted (re-marking with `all` never clears a cutoff).
- Placeholders are immutable once generated: editing a label changes only `SecretEntry.label`; no alias is created (existing `secret_aliases`
  rows stay readable and are still restored by `tool_call`).

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
// settings plugin discovery (D helpers; shared within the settings module)
pub(crate) fn settings_plugins::user_plugins_root() -> PathBuf;
pub(crate) fn settings_plugins::scan_plugins(user_root: &Path, cwd: Option<&Path>) -> PluginCatalog; // synchronous metadata discovery; no nested async runtime
// settings window identity (D helper; called from lib.rs setup + save_settings)
pub fn settings::apply_window_title(state: &AppState); // sets/restores main window title per `window_worktree_title` (never errors)
// privacy (P)
pub fn privacy::spawn_env() -> Vec<(String, String)>; // OMPWS_PRIVACY_NATIVE_HASH=<hash>, OMPWS_PRIVACY_FILE=<secrets.json>; + PI_CONFIG_FILES=<overlay> (':'-appended) when ≥1 natively tracked (tracked, cutoff-free) entry
pub fn privacy::native_hash() -> String;             // in-memory, updated on every file sync
pub fn privacy::inherit_session(db: &rusqlite::Connection, parent_session_id: &str, child_session_id: &str) -> Result<(), String>; // copy session_secrets links incl. since_ms cutoffs (absolute timestamps; existing child links win); re-syncs secrets.json when the child has a cutoff
```
(`catalog::set_pending` is internal to A; listed only so nobody else writes `pending_kind`.)

Spaces (modes) notes (§3, §4, §6 v10/v11):
- `SpaceMode` is only a discriminator on existing tables/code paths: `workspaces.mode`, `session_meta.mode`,
  `session_groups.mode`. Nothing else is shared across modes — a session's workspace resolution only considers
  workspaces of its own mode (`scan::resolve_workspace` takes the mode + `paths::global_dir()`).
- `chat` (通用对话) is a standalone space: it owns the single global workspace (`global`, `~/.omp-workspace/global`,
  created by `db::ensure_global_workspace(conn)` at startup/rebuild/`rpc::start`) and all session groups. Code/Work/
  Study/Research hold only project workspaces; `add_workspace(mode=chat)` is rejected.
- `build_meta` derives the mode: a cwd under the global dir is always `chat` (legacy rows, rows without a meta row);
  a stale `chat` row outside the global dir falls back to `code`; otherwise `session_meta.mode`.
- Groups live only in the app DB (`session_groups` + `session_meta.group_id`), only in `chat`; `build_meta` keeps
  `group_id` only while the session resolves to the global workspace, and deleting a group ungroups its sessions.
- Mode/group are persisted at creation via `catalog::store::set_mode_group` (`None` leaves a column untouched, so
  resume/restart spawns never clobber the stored values); side chats inherit the parent's mode.

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
| `features/inbox/InboxPage` | center when `centerView === "inbox"` (session status hub) |
| `features/schedules/SchedulesPage` | center when `centerView === "schedules"` |
| `features/skills/SkillsPage` | center when `centerView === "skills"` |
| `features/settings/SettingsOverlay` | overlay when `centerView === "settings"`, keeps underlying center view mounted |
| `features/terminal/CommandTerminalPanel` | 终端: body of RightTab `"terminal"` in `RightAside` (multi-tab login shells; tab strip — tabs, status, "+" new tab (added synchronously, cwd resolved at spawn), close kills PTY, fold to background service — lives in `terminalTabs.ts` (`addTerminalTab`/`closeTerminalTab`/`detachTerminalTab`); `RightPanelHeader` renders each visible terminal as its own Chrome-style tab while the terminal panel tab is active, so there is a single header row; agent ops: quote selection to composer annotation ⌘⇧A, send selection to side chat; search ⌘F; context menu). xterm/PTY instances live in `drawerRegistry` and are re-attached + re-fitted when the panel remounts, so processes and scrollback survive right-panel tab switches, closing the panel and session switches. Showing the tab with zero visible command tabs spawns one; closing/folding the last one closes the panel tab. Tab metas in `drawerStore` (persisted `ompws:drawer-tabs`). Entry: header 终端图标按钮 or ⌘` (toggles the right panel on this tab). Right-panel badge = live command tabs. |
| `components/CenterHeader` 终端图标按钮 | Toggles RightTab `"terminal"` in the right panel (`setRightTab("terminal")`, or closes right panel if already showing). No badge. Shortcut ⌘`. |
| `features/chat/subagents/TopCapsule` | top bar, right |
| `features/backlog/IdeasCapsule` | top bar, right (next to TopCapsule) |
| `features/backlog/QuickCapture` | global modal (always mounted) |
| `features/diagnose/DiagnoseDialog` | global modal (always mounted; opened via `ui.openModal("diagnose", {sessionId})`) |
| `features/sidechat/SideChatPanel` | right tab `sidechat` |
| `features/heatmap/HeatmapPanel` | right tab `heatmap` |
| `features/git/GitPanel` | right tab `git` |
| `features/services/ServicesPanel` | right tab `services` |
| `features/explorer/FileExplorer` | right tab `explorer` |
| `features/mobile/MobilePanel` | inside SettingsPage (under `mobile` section) |
| `features/git/NewSessionDialog` | global modal (`ui.openModal("new-session", {workspaceId?, cwd?, branch?, useWorktree?})`) |
| `features/sessions/ResumeMissingCwdDialog` | global modal (`ui.openModal("resume-missing-cwd", {sessionId, cwd, repoRoot, worktreeName?})`, driven by `lib/ensureLive.ts`) |

Sidebar navigation (Codex-style vertical nav list at the top of the left sidebar):
1. **新建会话** (`⌘N`): `startNewSession()` (`features/sessions/newSession.ts`) resolves the sidebar's active workspace via `resolveStartPageWorkspaceId` ("all"/stale → first project workspace, "__global" → global workspace) and calls `startSessionInDir`, which opens or reuses an empty draft there — the real Composer is the only place a task is started. With no workspace it clears the selection and `StartPage` (the launcher shown while no session is selected) asks for a project directory. Per-workspace/worktree "+" controls still create drafts directly (`startSessionInDir`/`startSessionAt`/`startSessionInWorktree`).
2. **收件箱**: `setCenter("inbox")`; badge via `useInboxBadge()` (awaiting + error + unread sessions within the window).
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
  | "settings";
type RightTab = "explorer" | "sidechat" | "heatmap" | "git" | "services" | "terminal";
interface UiState {
  centerView: CenterView; selectedSessionId: string | null; docPath: string | null;
  rightTab: RightTab | null; openRightTabs: RightTab[]; rightOpen: boolean;  // Chrome-style open tabs, persisted (ompws:right-tabs / ompws:right-tab)
  sessionViewMode: Record<string, "chat" | "terminal">;
  modal: { name: string; props: Record<string, unknown> } | null;
  selectSession(id: string | null): void; openDoc(path: string): void; setCenter(v: CenterView): void;
  setRightTab(t: RightTab | null): void;  // opens (appends) + activates, never replaces
  closeRightTab(t: RightTab): void;  // activates right neighbour, else left, else null (empty state) toggleRight(): void; setSessionViewMode(id: string, m: "chat" | "terminal"): void;
  openModal(name: string, props?: Record<string, unknown>): void; closeModal(): void;
}
```
`stores/composer.ts` shape:
```ts
interface Annotation { id: string; source: "message" | "diff" | "doc" | "terminal"; text: string; file?: string; lines?: string; comment?: string; }
interface ComposerState {
  annotations: Record<string, Annotation[]>;           // by sessionId; side-chat staged quotes use sideChatAnnKey(parentId) = "sidechat:<parentId>"
  addAnnotation(sessionId: string, a: Omit<Annotation, "id">): void;
  removeAnnotation(sessionId: string, id: string): void; clearAnnotations(sessionId: string): void;
  moveAnnotation(fromKey: string, toKey: string, id: string): void;  // main ⇄ side-chat, preserves fields, fresh id
  annotationTarget: "main" | "sidechat";               // selection comment-box destination (persisted, default "main")
  setAnnotationTarget(target): void;
}
export const sideChatAnnKey: (parentId: string) => string;
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
- Workspace membership (per space): explicit `session_meta.workspace_id` (ignored when it belongs to another mode) > registered
  workspace of the session's mode whose path equals/contains `repo_root ?? cwd` > that mode's Global if cwd under
  `paths::global_dir_for(mode)` > None (未归入工作区). Each mode's global workspace row is created lazily (§6, §9).
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
  flat rows with a fork icon + tooltip; a fork only appears once it has real content — a blank unsent stub
  (`isEmptySideChat` in `grouping.ts`, enforced inside `filterSessions`) never lists. Rows: fork icon → title (marquee) → status mark next to title
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
  Setting `sessionGroupByWorktree` (default true; Settings → 会话; applies to the `code` mode only — work/study/research/chat always use the flat layout): when false, each workspace yields one flat
  `default`/`isMain` subgroup (`GroupingOptions.groupByWorktree: false`) — no worktree/branch headers, no
  已清理的工作树 folder, no 「在独立工作树创建」 entry; the "+" button starts a session in the project dir directly.
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
- `ask` tool over RPC (frontend-only; no backend change): omp emits plain `select`/`editor` requests per question (title = question,
  ` (i/N)` suffix when N>1, `(k selected) ` prefix in multi loops; options = labels with ` (Recommended)` on the recommended one,
  `<glyph> Done selecting` only for single-question multi, then `Other (type your own)` → follow-up `editor`). `src/features/chat/ask/askDriver.ts`
  matches such requests to the open `ask` tool call (live `tools` or unanswered transcript `toolCalls`); `AskPanel` replaces the composer,
  shows every question with local ←/→ / 上一题/下一题 navigation (nothing sent to omp), and only on final 提交 (all questions answered) the
  driver replays every answer in order, one response per request omp sends (label | per-label toggles + Done | Other + editor text).
  Multi-select going through Other (custom note, empty selection, or any multi inside a multi-question ask, which has no Done entry) sends
  editor text `Selected: A, B` / `Selected: none`, plus `; note: <text>` — omp's result keeps only customInput on that path.
  `跳过`/Esc responds `{cancelled:true}` (cancels the whole ask). Unmatched/out-of-sync requests fall back to `PendingUiCard`.
- Idle suspend: every 60 s, live sessions not streaming, no pending UI, no activity for `idle_suspend_minutes` → `rpc_stop`, set `session_meta.suspended=1`.
  `rpc_ensure_live` clears it.
- Side chat: parent must have `fork_depth < 3`. Label = parent label + "." + (count of existing children + 1). Start with
  `StartOpts{cwd: parent cwd, parent_session_id, label}`, store `session_meta` (parent, depth, label, created_by_app), then send the first
  prompt rendered from `src-tauri/prompts/side_chat.md` (guard rules: this is a side chat forked from the main session; do not modify files
  the main session is working on unless asked; if context is missing, read the parent transcript at `<parent jsonl path>`), containing:
  parent summary (`todos::summary(state, parent, true)`, fallback: project path + `git status --short` output) + selection (if any) + question.
  When `settings.smart_context_routing` is on, classify the question with a quick `omp -p --no-session --no-tools --model smol` call using
  `prompts/context_route.md` into `selection_only | fork_continue | global` and pick context accordingly (low confidence → default).
  `settings.side_chat_model` (侧聊专属模型, Settings ▸ 通用; `"<selector>"` or `"<selector>:<level>"`) supplies the fork's `--model` when
  the side-chat composer picker is left at its default; a per-panel picker choice still wins, and a selector unavailable in the
  catalog falls back to inheriting the parent model.
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
  turn as a `notice` step. Labels come from `noticeLabel` (Chinese, never the raw kind). Durations: `formatDurationChinese`
  ("12 秒") and `formatDurationCompact` ("2分3秒"); model strings are cleaned via `formatShortModel`. `groupActivityUnits` folds
  consecutive read/search/list/find/grep/glob tools into one exploration unit ("已浏览 3 个文件、2 次搜索").
- Visual language is Codex-like (tokens in `index.css`: `--text-60/40/30`, `--line`, `--ghost-hover`, `--chat-user-bg`,
  `.shimmer-text`, `.thread-fade-mask`): user = right bubble (max 70%, radius 22px); assistant = plain prose; activity =
  single muted rows with hover chevron; no gradients/glows/colored cards; color only on small status icons.
- Execution disclosure (`ExecutionDisclosure.tsx`): `TurnSteps` renders activity rows for finished turns and live streaming
  (ThinkingRow, ToolCard rows, ExplorationGroupRow, NoticeStep); finished turns collapse under a "已处理 2分3秒" ghost divider.
  `task`/`agent` tool calls render `subagents/TaskToolBlock` and are never folded into groups.
- Subagents (`features/chat/subagents/`): `TaskToolBlock {sessionId, toolCallId, args, status, details, resultText?, startedAt?, endedAt?}`
  merges task args < `details.progress/results` < `subagent_list` summaries < live `subagents` (by `parentToolCallId`), renders an
  omp-TUI-style tree (├─/└─, status icon, id, agent badge, current tool, model·thinking·tools·tokens·duration·cost).
  Clicking a row opens `SubagentSheet` (right slide-over, `Z_LAYER.modal`): 概览 / 提示词 / 过程 / 输出, tailing
  `subagent_transcript` every 1.5 s while running.
- Answer footer (`AnswerFooter.tsx`): one quiet row — ghost icon buttons left (changed-files list toggle, saved commit jumping to
  `TopCapsule` uses `useSessionSubagents(sessionId)`: on-disk `subagent_list` summaries (re-polled every 3 s while the session is `external`/`working`) merged with live RPC subagents (live wins per id), so sessions driven by an external `omp` CLI show their subagents in the capsule popover, with a 「查看详情」 button opening `SubagentSheet`. `TaskToolBlock` polls the same way for unfinished calls of external sessions. No IPC change.
  git timeline via `useTurnNav.showCommit`, "撤回这一轮" rollback with cascade conflict detection, copy, side-chat fork) and the
  answer time on hover at the right end (opacity-reserved, never shifts); hover-only on older turns, always visible on the latest.
- Image attachments: `ImageAttachment` (blob refs, clip files, mimeType, width, height) rendered via `ImageChips.tsx` with Tauri asset
  protocol (`protocol-asset` feature, scope `$HOME/.omp/agent/blobs/**`, `$APPCACHE/ompws-clip/**`) and full preview portaled at `Z_LAYER.modal`.
  User bubbles; assistant markdown; hidden items not shown (toggle).
- Diff view component: line numbers, +/- colors; select lines → "批注" → comment textarea → adds Annotation `{source:"diff", file, lines, comment, text}`.
- Text selection anywhere in the stream → floating toolbar "批注" (inline optional-comment input + destination segmented control 主对话|辅助对话 + ✓; Enter/✓ → addAnnotation under the session id or `sidechat:<parentId>`; numbered markers (`AnnotationMarkers`, distinct colour for side-chat) sit in the stream margin next to the quoted text) / "记到收集箱" (open
  QuickCapture via `ui.openModal("quick-capture", {text, sessionId})`). "辅助对话" is disabled once the parent reaches the 3-level fork cap.
- Slash commands (`features/chat/slash/`): `registry.ts` defines app commands (会话 /new /fork /rename /compact /handoff /export /copy
  /retry; 模型 /model /thinking /fast /advisor; 状态 /status /context /usage /tools /jobs /todo /stats; 集成 /mcp /plugins /memory
  /browser /computer /extended-context; 设置 /agents /approvals /login /settings), each with optional `settingsTarget`. `menu.ts`
  merges them with omp `available_commands_update` entries (`{name, aliases?, description?, input?:{hint?}, subcommands?, source}`;
  skill → 技能, custom/file → 自定义命令, extension/mcp_prompt → 扩展, other builtins → 更多 OMP 命令). `SlashMenu` is the Codex-style
  popup (gear "去设置" → `openSettingsTarget`). Unknown `/x` is sent to omp as a prompt; `command_output` frames render in
  `CommandOutputList` at the end of the thread.
- Side chats: `/btw [问题]` and `/fork <问题>` both open the real forked side chat (`createSideChat`, then select the child and open the `sidechat` right tab); `/btw` with no question only opens the 辅助对话 tab. Mobile maps `/btw` to the same fork path.
- Composer: Codex-style single container; one "N 条批注" chip above the input (hover/focus opens a popover listing every quote with its comment, edit ✎ / delete 🗑 / locate), textarea, bottom
  toolbar (attach, model picker, thinking level, held pill, context ring, round send/stop). Model picker (`get_available_models`/`set_model`), thinking
  level (`set_thinking_level`). If session not live → `rpc_ensure_live` first. Two settings (`sendShortcut`, `followUpBehavior`; in the settings JSON, defaults
  `enter` / `steer`) drive the keys. `sendShortcut = enter`: Enter sends, Shift+Enter newline, ⌘/Ctrl+Enter sends. `mod-enter`: ⌘/Ctrl+Enter sends, Enter
  and Shift+Enter newline. ⌥ (Alt) + send = the alternate follow-up. `features/chat/sendKeys.ts` (pure, vitest) maps the keydown to send/alternate/newline and
  maps (`followUpBehavior`, alternate, streaming) to `send | steer | queue | interrupt`; IME composition never sends. Not streaming: every send is a plain
  `sendPrompt`. While streaming: `steer` = `sendPrompt(..., {steer: true})` (`streamingBehavior: steer`); `queue` = **held queue** (zustand, persisted to
  localStorage per session); `interrupt` = `abortTurn`, then wait until `live.streaming` is false (≤15 s, `interruptAndWait` in `send.ts`), then send normally;
  on timeout the message goes to the held queue with an error toast. Alternate: steer↔queue, interrupt→queue. The round button shows Stop (`abort`) while
  streaming; when the composer has text or quotes, a send button sits beside it performing the default follow-up (引导当前回合 / 本回合结束后发送 / 打断并发送; its title names the ⌥ chord).
  Codex-style popover list above the composer (text + image count, × remove; no reorder). When the turn ends and `settings.queueAutoSend`
  is on (default; `undefined` = on) items auto-send one at a time (each send restarts streaming; next turn-end sends the next). With it off,
  show the manual bar "有 N 条暂存" with 立即发送(合并为一条)/继续暂存/逐条确认; items editable, deletable, reorderable (↑↓).
  External sessions: composer disabled with "只读观察 — 接管后可操作".
- Pending dialogs: render approval card (Approve/Deny, show title body), select (options + optionDetails), confirm, input/editor
  (textarea) inline at the stream bottom; respond via `rpc_ui_respond`. Also load `rpc_pending_ui` on open.
- `stores/live.ts`: per session `{ streaming, state (last get_state), pendingUi[], subagents: Record<id, SubagentInfo>, streamingMessage,
  commands[], commandOutputs[], pendingCommand }` reducing `rpc:frame`/`rpc:process`. Subagent frames are `{type, payload}`:
  `subagent_lifecycle` (payload.id; `started` → running) and `subagent_progress` (payload.progress: AgentProgress) feed `subagents`
  (kept after completion; seeded via `get_subagents` on attach). `tool_execution_update` keeps `partialResult.details`.
  `command_output` → `commandOutputs` (tagged with `pendingCommand`), `config_update` → model/thinking, `session_info_update` → title,
  `prompt_result` errors → output entry.
- `SideChatPanel`: lists children of the selected session (label, title, status); "新建侧聊" composer; staged annotations (`sidechat:<parentId>`) show as an "N 条批注" chip (move-to-main via `moveAnnotation`); send formats them via `formatWithAnnotations` and appends to the open thread (`sendPrompt`) or creates a new side chat (`createSideChat`, quote blocks passed as `selection`); a slim staged bar under the open thread's header accepts the same send; the selected child shows as a compact embedded `SessionView` (prop `compact`). Depth > 3 → "请开新主会话".
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
- `GitPanel` (selected session's repo): the first successful worktree load opens 分支 when exactly one worktree exists,
  otherwise 工作树. Manual mode selection survives refreshes; explicit commit/worktree navigation opens 工作树.
  The branch page keeps its controls visible and lets its list scroll through the full remaining panel height.
  Worktree rows separate branch identity from metadata and session controls; a single-worktree list stays compact,
  while multiple worktrees keep the adjustable list/detail split. Clicking a worktree focuses it; below,
  a 提交改动 | 版本历史 tab pane shows that worktree (auto-picks 版本历史 when the loaded change count is 0,
  提交改动 when dirty; a manual pick wins until the selection changes or the count crosses empty/non-empty): 提交改动 =
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
  With `{cwd, useWorktree: true, branch?}` it is the compact 「新建工作树会话」 form instead: read-only repo line, then either
  base branch + branch prefix + worktree dir name (new `prefix+name` branch), or — when `branch` is passed — only the worktree
  dir name, checking out that existing branch → `git_create_worktree` + `rpc_start` (Settings default model), then select the
  session and focus its composer. Opening a session in an *existing* worktree skips the dialog
  (`startSessionInWorktree(cwd)` in `features/sessions/newSession.ts`).

### D — Inbox (smart todos + backlog), summaries, diagnose, notifications, settings (backend + frontend)
- System detection (when `settings.system_detection`): subscribe to bus. Create/refresh todos with `dedupe_key`:
  approval/question `ui:<sessionId>:<requestId>` (payload `{uiRequest}`), review `review:<sessionId>`, error `error:<sessionId>`,
  interrupted `interrupted:<sessionId>`. Resolve automatically (status Done) when: `UiResponded` for that request; `SessionAccepted` or
  `PromptSent` for review/question; session status leaves Error/Interrupted (`resolve_status_leaving`). Emit `todos:changed` with counts.
- Reconcile safety net (`todos::detect::reconcile_db`): periodically and on session rescan, resolves zombie todos whose sessions
  were deleted or are missing from the catalog, resolves orphaned UI todos when the session is not live or the pending request was dismissed,
  and syncs absent status todos.
- `todos_act(done)` on a Review todo → call the same logic as `accept_session` (emit `SessionAccepted`; A reacts). On Approval todo the
  frontend shows Approve/Deny inline and calls `rpc_ui_respond`; the todo resolves via `UiResponded`.
- Summaries: `todos::summary` returns the latest `compaction` summary from the transcript if present, else a cached `summaries` row if
  `upto_offset` is recent enough, else (if `ensure`) generates with `omp -p --no-tools --no-session --model smol` from a condensed transcript
  (last ~40 user/assistant texts, truncated) using `prompts/summary.md`. Background refresh: every 3 min for sessions active in the last hour
  whose file grew ≥ 20 KB since the last summary.
- `diagnose_build_prompt`: `prompts/diagnose.md` with target label/title/status, summary, last 10 errors (tool results with isError, error
  stop reasons, session_exit records), last assistant text. `DiagnoseDialog`: choose diagnoser: existing session (list) or new session
  (model input; cwd = target cwd) → send via `rpc_start` + `rpc_send prompt`; then navigate to the diagnoser session.
- Backlog: CRUD + `backlog_build_prompt` (`prompts/backlog_dispatch.md`: item text + kind + each ref: session → label/title/summary,
  file → path (+ first 200 lines if small), annotation → quoted text). Dispatched items (shown as 进行中) stay until the user marks them done manually.
- `QuickCapture`: global shortcut (`global-shortcut` plugin, `settings.quick_capture_shortcut`) shows+focuses window, emits `quick-capture`;
  modal also opened via `ui.openModal("quick-capture", {text?, sessionId?})`. One line + kind + auto-ref to current session.
- Notifications: on `SessionStatusChanged` → Review (turn end), AwaitingApproval/AwaitingAnswer, Error/Interrupted (exit), per settings;
  skip when the main window is focused AND that session is selected. Dock badge = sessions with attention awaiting/error/unread within
  `inbox_window_hours` (pure fn `inbox_badge_count`, refreshed on `SessionsChanged` and a 60 s tick). Optional sound (`sound: "default"`). `notify_test` command.
- Inbox (status hub): `SessionMeta.attention` is derived by A — `awaiting` (awaiting_approval/answer; leaves when answered), `error`
  (error/interrupted not viewed since `pending_since`; viewing hides it from the inbox only, the sidebar red marker stays), `unread`
  (unread or pending Review — one concept, one blue dot everywhere; viewing clears it globally via `mark_seen`), `running` (working).
  Consumers drop non-awaiting sessions whose `updated_at` is older than `inbox_window_hours`; archived sessions excluded. Open `schedule_run` todos (定时任务, from `todos_list`) are also shown by the inbox page and counted in the sidebar 收件箱 badge — frontend only; the Dock badge (`inbox_badge_count`) stays sessions-only.
- `InboxPage`: tabs 全部 / 未读 / 中断 / 待回复 with counts; 全部 groups 待回复 → 报错 / 中断 → 已完成，未查看 → 运行中. Compact two-line
  rows (symbol, title, project · branch, time; one-line snippet), click opens the session, no inline actions; gear → Settings `"inbox"`.
- `IdeasCapsule`: top-bar pill 「想法」 with the count of `inbox`-status backlog items; dropdown: quick add, all non-closed items
  (current project first by `project_dir` vs selected session cwd), 填入当前会话, 派发 (existing/new session), 进行中 items show the
  linked session's status and a done checkbox, collapsed 已完成 section.
- `useInboxBadge()`: sidebar 收件箱 badge from `useSessions` via the same attention + window rule as the Dock badge, plus open `schedule_run` todos.
- `TopCapsule`: subagent capsule; shows the selected session's subagents from `stores/live.ts` (运行中/完成/失败 counts, click → details list).
- `SettingsPage`: navigation organized into 5 top-level groups:
  - 常规: `general` (通用), `appearance` (外观), `notifications` (通知)
  - 模型: `providers` (API 供应商), `omp-roles` (模型角色: effective agents, global/project roles, named overrides), `model-fallback` (回退链与切换), `omp-model` (模型与目录), `omp-thinking` (思考与采样), `omp-retry` (重试与回退)
  - Agent: `sessions` (会话), `inbox` (收件箱; legacy `todos` callers migrated), `omp-context` (记忆与对话; context-window keys live on 模型 ▸ `context-window` 上下文窗口), `agents-md` (规则文件 AGENTS.md), `omp-tools` (工具与审批), `omp-tasks` (任务与子代理)
  - 连接: `mobile` (手机访问; renders `MobilePanel`), `omp-providers` (网络与扩展), `mcp` (MCP 服务器), `plugins` (插件)
  - 高级: `advanced` (高级), `omp-advanced` (其他 OMP 配置)
- Deep links: `ui.openSettings(section?, opts?: { focusKey?: string })` scrolls to and briefly highlights `[data-field-id]` (native)
  or `[data-omp-key]` (omp config rows; clears search/group filter). `settingsTargets.ts` maps `SettingsTarget`
(models, thinking, fastMode, advisor, extendedContext, browser, computerUse, memory, mcp, plugins, subagents, approvals,
  providers, compaction, modelContext) to section + focus key via `openSettingsTarget(target)`.

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
  局域网直连 / Cloudflare Tunnel（有域名绑子域名、无域名用临时隧道；建议配 Cloudflare Access）/ IPv6 直连.
- IPv6 direct: second listener on `[::]:<mobile_ipv6_port>` (IPV6_V6ONLY, no SO_REUSEPORT), same router over TLS with a self-signed cert persisted
  under `data_dir()/mobile-tls/` (dir 0700, key created 0600; SANs `localhost` + `ddns_hostname`; regenerated only in `mobile_ipv6_start`;
  `cert_sha256` is the fingerprint of the cert being served); pairing cookie is `Secure` over TLS. Public-facing hardening: TLS handshake
  runs per connection with a timeout (never inside the accept loop), header-read timeout, capped concurrent connections, connections
  force-closed after a grace period on stop. Address = stable global unicast (2000::/3, no ULA/link-local/doc; prefer non-temporary).
  CSRF compares exact host+port (bracket-aware for IPv6; missing port = scheme default, scheme from TLS or `x-forwarded-proto`).
  DDNS (`mobile/ddns.rs`): Cloudflare API v4 AAAA upsert, `proxied=false`, called only when the address or configured host/zone changes
  (loop ~5 min) or on manual sync; single in-flight API call (token verify included); 401/403/429 or 3 consecutive failures → `halted`
  until `mobile_ddns_sync`. Token never logged or returned.
- Terminal: `portable-pty`, reader thread → `terminal:data` (base64); multi-tab command terminal runs in `RightAside` as RightTab `"terminal"` (`CommandTerminalPanel`). Processes persist when panel/tab is hidden.
  Quote capture: Cmd+Shift+A (and floating/context buttons) adds the current selection as an Annotation `{source:"terminal"}` to the composer, or sends to side chat.
- Extension (§8) + install at startup to `extension_path()` (overwrite when content differs) + `install_status_extension_globally`.

### F — Scheduled tasks (backend + frontend)
- Cadence semantics: `ScheduleCadence::Interval { minutes }` (pure interval math), `Daily { time, weekdays, every, anchor }` (local-time, DST-safe; empty weekdays = every `every` days counted from `anchor`, weekday subset = every `every` weeks — Monday-start weeks — counted from the anchor's week, on the listed days; `every`=1/absent ignores `anchor` = legacy daily/weekly), `Once { at: RFC3339 }` (absolute one-shot instant), `Monthly { day, time, every, anchor }` (every `every` months counted from the anchor's month; `day` clamps to the month's length — day 31 in Feb runs on the 28th/29th). On save (`upsert`), a missing `anchor` is filled with today's local date when `every`>1, and any `anchor` is dropped when `every`<=1.
- Validation (`schedules_save`): `once.at` must be a future RFC3339 instant on create/new-time ("请选择未来的时间"; an unchanged past instant stays valid); `endAt` must be in the future ("结束时间需晚于现在"); monthly `day` 1-31; `time` HH:MM; interval ≥ 5 min; `every` 1-999 ("重复间隔需在 1-999 之间"); `anchor` parses as YYYY-MM-DD when present ("重复起始日期格式需为 YYYY-MM-DD"); `maxRuns` ≥ 1 when present ("运行次数需至少为 1").
- Lifecycle (derived in `row_to_schedule`, never stored): `completed` = a `once` that already ran (a run row exists or `last_run_at` set) or a recurring schedule past `end_at` or at its `max_runs` cap (`runs_done >= max_runs`); `paused` = `!enabled` and not completed; else `active`. When a `once` fires or an `end_at`/cap is passed, `advance_after_run`/`record_run_start` sets `enabled=0, next_run_at=NULL` so the scheduler stops considering it.
- Run counting (DB v9): `record_run_start` (renamed `stamp_last_run`) stamps `last_run_at` and increments `runs_done` where a run actually starts — scheduled dispatches and manual "run now" alike; `skipped` runs don't count. Reaching `max_runs` completes the schedule; editing `maxRuns`/`cadence` keeps `runs_done` (raising/clearing the cap re-activates, lowering to ≤ `runs_done` completes again); `schedules_set_enabled` refuses while capped ("已达到运行次数上限，请先编辑任务").
- Background scheduler (`schedules::scheduler`): calculates earliest `next_run_at` across enabled schedules; sleeps via `tokio::select!` with `tokio::sync::Notify` wakeups on mutations (`schedules_save`, `schedules_delete`, `schedules_set_enabled`).
- Catch-up: on startup and sleep-wake loop, checks all enabled schedules where `next_run_at <= now`; executes them immediately and advances `next_run_at` to prevent missed runs (a missed `once` runs once, then completes).
- Skip-if-running: if a schedule's previous run is still `Running`, automated triggers mark the run `Skipped` ("上一次运行仍在进行中，已跳过") and advance `next_run_at` without duplicate executions; manual `schedules_run_now` returns an explicit error.
- Re-enable guards (`schedules_set_enabled` / re-enable via save): `once` that already ran → Err "一次性任务已执行，请复制或重新创建"; recurring past `end_at` → Err "结束时间已过，请先修改结束时间".
- Execution options: spawned RPC session gets `--model`/`--approval-mode`/`label` from the schedule and applies the stored `thinking` level via the `set_thinking_level` RPC (same command as the interactive composer) before the prompt is sent.
- Isolated execution: supports `local` cwd or `worktree` mode (creates isolated worktree `.worktrees/sched-<slug>-<id8>` via git).
- Completion detection: spawns RPC session with label `⏰ <name>`, subscribes to bus; turn completion detected by transition to `SessionStatus::Review` or `Idle` (after work started) → `Ok`; `Error` / `Interrupted` / non-zero process exit → `Error`. Timeout cap 1 hour.
- Todo write: writes `ScheduleRun` record with status and last assistant text summary, updates schedule's `last_run_at` (and derives `last_run_status` via `SCHEDULE_COLS` subquery), and writes a `Todo` with kind `schedule_run`, source `schedule` (always visible, not gated by the system-detection switch), dedupe key `sched:<run_id>`, payload `{"scheduleId","runId","ok":bool}`. Emits `schedules:changed`.
- Notify policy (`Schedule.notify`, DB v8): the `sched:<run_id>` todo is gated by `should_create_inbox_todo` —
  `all` = always (legacy behavior), `important` = only failed runs (`!ok`, incl. `finish_with_error` early exits)
  or runs observed in `AwaitingApproval`/`AwaitingAnswer`, `none` = never (the `schedule_runs` row is still written).
- Session reuse (`Schedule.new_chat_each_run == false`, local mode only): the runner looks up the newest
  `schedule_runs` row with a `session_id`, resolves its `session_meta.file_path` and starts the RPC session with
  `StartOpts.resume_file`; a missing file or failed resume (incl. `SESSION_HELD:`) logs a warning and falls back
  to a fresh session. The run row records the session id actually used. Worktree mode always starts fresh.
- Frontend `SchedulesPage` (`centerView === "schedules"`): lists scheduled tasks with toggle switches, human-readable cadence descriptions (`humanCadence.ts`), last run status badges (运行中/成功/失败/跳过), expandable run histories with log snippets, manual "立即运行" trigger, inline rename (row pencil / 更多 ▸ 重命名; saves the full draft with only `name` changed, so `next_run_at` is kept), and `ScheduleEditorPage` (full-page editor replacing the list) for creating/editing drafts. The editor's composer toolbar has a Worktree chip (git repos only): pick an existing worktree of the repo as `cwd` (`runMode: "local"`) or "每次新建独立 Worktree" (`runMode: "worktree"`); the workspace chip resolves a linked-worktree `cwd` to its project via `gitRepoRoot`. The model chip shows the model only; the thinking level lives in the separate thinking picker.

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
  - `drawer`: 40 (`--z-drawer: 40`) — e.g. `SkillsPage` detail drawer
  - `modal`: 50 (`--z-modal: 50`) — e.g. `NewSessionDialog`, `DiagnoseDialog`, `ResumeMissingCwdDialog`, `ImageChip` full preview
  - `popover`: 60 (`--z-popover: 60`) — e.g. `PerfPopover`, `SessionStatsPopover`, filter popovers
  - `menu`: 65 (`--z-menu: 65`) — e.g. context menus, dropdown action menus (`plusMenu`, `wsMenu`, `ModelSelect`, `ThemeMenu`)
  - `hovercard`: 70 (`--z-hovercard: 70`) — e.g. `SessionHoverCard`, `WorktreeHoverCard`, heatmap tooltips
  - `toast`: 100 (`--z-toast: 100`) — global notification toasts
- **No `position: fixed` inside `.vibrancy-chrome`**: Surfaces styled with `.vibrancy-chrome` apply `backdrop-filter: blur(20px) saturate(190%)`. By CSS specification, `backdrop-filter` creates a new containing block for `position: fixed` elements and a local stacking context, trapping any descendant with `position: fixed` or `z-index` and causing it to be clipped or painted over by sibling layout columns. Floating surfaces must always portal to `document.body` via `FloatingLayer`.
- **Asset protocol & image preview**: Tauri asset protocol is enabled (`features = ["macos-private-api", "protocol-asset"]` in `Cargo.toml`, scopes `["$HOME/.omp/agent/blobs/**", "$APPCACHE/ompws-clip/**"]` in `tauri.conf.json`). Attached images (`ImageAttachment`) are rendered via `ImageChips.tsx`, and click-to-preview is portaled at `Z_LAYER.modal`.
