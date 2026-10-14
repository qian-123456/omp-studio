//! Shared serde contract types (docs/ARCHITECTURE.md §4).
//! Structs serialize camelCase; enums serialize snake_case.

use serde::{Deserialize, Serialize};

/// Id of the single global (通用对话) workspace row; it belongs to `SpaceMode::Chat`.
pub const GLOBAL_WORKSPACE_ID: &str = "global";

/// Sidebar space ("mode"): visually independent spaces; nothing is shared
/// across modes (§4). Sessions record their mode at creation. `Chat` (通用对话)
/// is the project-less space: it owns the single global workspace and all
/// session groups; the other modes hold only project workspaces.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpaceMode {
    #[default]
    Code,
    Work,
    Study,
    Research,
    Chat,
}

impl SpaceMode {
    /// DB/serde representation.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Code => "code",
            Self::Work => "work",
            Self::Study => "study",
            Self::Research => "research",
            Self::Chat => "chat",
        }
    }

    /// Unknown/blank strings degrade to Code (pre-migration rows, external
    /// sessions without a session_meta row).
    pub fn from_str_lossy(s: &str) -> Self {
        match s {
            "work" => Self::Work,
            "study" => Self::Study,
            "research" => Self::Research,
            "chat" => Self::Chat,
            _ => Self::Code,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    /// Agent turn running.
    Working,
    /// Pending tool approval (select "Approve"/"Deny").
    AwaitingApproval,
    /// Pending open question / other dialog.
    AwaitingAnswer,
    /// Turn finished, not yet accepted (待验收).
    Review,
    /// Accepted / nothing pending.
    #[default]
    Idle,
    /// Process crashed or turn ended with error.
    Error,
    /// Process gone but transcript tail is non-terminal.
    Interrupted,
    /// App stopped the process on idle; resumable.
    Suspended,
    /// An omp process outside the app holds the file (read-only observe).
    External,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingKind {
    Approval,
    Question,
    Review,
    Error,
    Interrupted,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBadge {
    pub branch: Option<String>,
    pub dirty: u32,
    pub worktree: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultBadge {
    /// "test" | "build"
    pub kind: String,
    pub ok: bool,
    pub at: String,
    pub summary: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    /// OMP session id (header.id).
    pub id: String,
    /// Always "omp".
    pub tool: String,
    /// Absolute jsonl path.
    pub file: String,
    pub cwd: String,
    /// custom_name ?? title slot ?? first user message (truncated) ?? "未命名".
    pub title: String,
    /// "#115" or fork label "#115.2.1".
    pub label: String,
    pub created_at: String,
    /// Last conversation message time (falls back to file mtime when the transcript has none).
    pub updated_at: String,
    /// Fork parent session id (side chats).
    pub parent_id: Option<String>,
    /// 0 main, 1..=3.
    pub fork_depth: u8,
    pub status: SessionStatus,
    /// New output not yet seen (cleared by viewing).
    pub unread: bool,
    /// Cleared ONLY by an action.
    pub pending: Option<PendingKind>,
    /// App-owned RPC process running.
    pub live: bool,
    pub external_pid: Option<u32>,
    pub pinned: bool,
    pub archived: bool,
    /// Resolved membership (explicit override or path match); None = 未归档.
    pub workspace_id: Option<String>,
    /// Main repo root (git common dir parent) for grouping.
    pub repo_root: Option<String>,
    pub git: Option<GitBadge>,
    pub result: Option<ResultBadge>,
    /// ≤200 chars snippet.
    pub last_assistant: Option<String>,
    pub model: Option<String>,
    /// Inbox attention kind (derived; time window applied by consumers via `updated_at`).
    pub attention: Option<Attention>,
    /// Space recorded at session creation (`StartOpts.mode`); rows predating
    /// spaces and external sessions with no meta row are Code.
    pub mode: SpaceMode,
    /// SessionGroup inside this mode's 无项目 area; only sessions whose
    /// resolved workspace is the mode's global workspace can be grouped.
    pub group_id: Option<String>,
}

/// Per-session inbox attention kind (sidebar status marker hub).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Attention {
    /// 待回复: awaiting approval/answer.
    Awaiting,
    /// 中断: error/interrupted not yet viewed since it happened.
    Error,
    /// 已完成未查看: unread output or pending review.
    Unread,
    /// 运行中.
    Running,
}

/// Patch for `update_session_meta` (§7 A).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetaPatch {
    pub custom_name: Option<String>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    #[default]
    Project,
    Global,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: WorkspaceKind,
    pub sort: i64,
    /// Space this workspace belongs to; the same disk directory may be a
    /// project in several modes (workspaces unique on (path, mode)).
    pub mode: SpaceMode,
}

/// User-created named category inside a mode's 无项目 area — a grouping only,
/// not a directory (`session_groups` table; §6 v10).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionGroup {
    pub id: String,
    pub mode: SpaceMode,
    pub name: String,
    pub sort: i64,
}

/// Unified observation layer: normalized transcript entries.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptKind {
    User,
    Assistant,
    ToolResult,
    Bash,
    Custom,
    Compaction,
    BranchSummary,
    ModelChange,
    System,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub args: serde_json::Value,
    pub intent: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultInfo {
    pub tool_call_id: String,
    pub tool_name: String,
    pub text: String,
    pub is_error: bool,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub total_tokens: u64,
    pub cost: f64,
}

/// Structured image reference attached to a transcript item.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachment {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marker: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptItem {
    pub id: String,
    pub parent_id: Option<String>,
    pub ts: String,
    pub kind: TranscriptKind,
    pub text: Option<String>,
    pub thinking: Option<String>,
    pub tool_calls: Vec<ToolCall>,
    pub tool_result: Option<ToolResultInfo>,
    pub usage: Option<Usage>,
    pub model: Option<String>,
    pub stop_reason: Option<String>,
    /// custom_message display:false, system reminders.
    pub hidden: bool,
    /// Attached images (blob refs, clip files, or unresolvable markers).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageAttachment>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub session_id: String,
    pub items: Vec<TranscriptItem>,
    /// Byte offset for incremental reads.
    pub next_offset: u64,
    pub reset: bool,
}

/// Inferred lifecycle of a subagent session file.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SubagentStatus {
    #[default]
    Pending,
    Running,
    Completed,
    Failed,
    Aborted,
}

/// Lightweight per-agent summary for `subagent_list` (contract C5).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSummary {
    pub id: String,
    pub status: SubagentStatus,
    /// From `model_change` (e.g. "provider/model-id").
    pub model: Option<String>,
    /// From `thinking_level_change`.
    pub thinking_level: Option<String>,
    /// First user message, whitespace-collapsed preview (≤160 chars).
    pub prompt: Option<String>,
    pub message_count: u32,
    /// toolCall blocks in assistant messages.
    pub tool_call_count: u32,
    /// Assistant messages = model requests.
    pub request_count: u32,
    /// input + output + cacheWrite (cacheRead excluded), AgentProgress.tokens style.
    pub tokens: u64,
    /// USD, summed over assistant usage.
    pub cost: f64,
    /// First / last entry timestamps in the jsonl.
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    /// `<id>.md|.json` artifact when present.
    pub output_path: Option<String>,
    /// Absolute path of `<id>.jsonl`.
    pub file_path: String,
}

/// `subagent_transcript` payload (contract C5).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentTranscript {
    pub agent_id: String,
    /// Absolute path of `<id>.jsonl`.
    pub file: String,
    pub summary: SubagentSummary,
    /// `session_init` entry, when the file carries one.
    pub system_prompt: Option<String>,
    /// First user message verbatim (the spawned assignment).
    pub prompt: Option<String>,
    /// Normalized entries at/after `fromByte` (same shape as `get_transcript`).
    pub items: Vec<TranscriptItem>,
    /// `<id>.md|.json` content, else the last assistant text.
    pub output: Option<String>,
    /// Artifact path when the output came from a file.
    pub output_path: Option<String>,
    /// Byte cursor for incremental tailing.
    pub next_byte: u64,
    /// True when `fromByte` exceeded file size and the read restarted at 0.
    pub reset: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionInfo {
    pub session_id: String,
    pub session_file: String,
    pub pid: u32,
    pub cwd: String,
}

/// `rpc_omp_staleness`: current omp binary identity vs live sessions' spawn identity.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpStaleness {
    /// Canonical exe path + mtime + size of the binary a new spawn would exec; None if unresolvable.
    pub fingerprint: Option<String>,
    /// Live sessions spawned from a different binary identity.
    pub stale_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOpts {
    pub cwd: String,
    /// --resume <path>
    pub resume_file: Option<String>,
    /// --model
    pub model: Option<String>,
    /// --approval-mode; default from settings.
    pub approval_mode: Option<String>,
    /// For side chats: send `new_session {parentSession}` after ready.
    pub parent_session_id: Option<String>,
    /// Pre-assigned label (side chats).
    pub label: Option<String>,
    /// --plan-yolo: read-only plan mode, auto-approving plan into implementation.
    pub plan_yolo: Option<bool>,
    /// --fork <path>: native fork of the parent session file (keeps prefix cache).
    pub fork_file: Option<String>,
    /// --append-system-prompt: hidden instructions kept out of the visible
    /// transcript (side chats use it for the reference-only boundary).
    pub append_system_prompt: Option<String>,
    /// Space the new session belongs to; persisted to `session_meta.mode`
    /// (None leaves the row untouched → defaults to Code on insert).
    pub mode: Option<SpaceMode>,
    /// SessionGroup in the mode's 无项目 area; `Some(id)` assigns it (validated:
    /// group must exist in the same mode), `None` leaves the row untouched.
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUiRequest {
    pub session_id: String,
    /// Raw extension_ui_request.
    pub request: serde_json::Value,
    pub received_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoKind {
    Approval,
    Question,
    Error,
    Interrupted,
    Review,
    Suggestion,
    ServiceLeft,
    /// A scheduled-task run finished; payload: {"scheduleId","runId","ok":bool}.
    ScheduleRun,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoSource {
    System,
    Supervisor,
    /// Always visible (not gated by system/supervisor switches).
    Schedule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Open,
    Done,
    Ignored,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub kind: TodoKind,
    pub source: TodoSource,
    pub status: TodoStatus,
    pub session_id: Option<String>,
    pub title: String,
    pub detail: String,
    /// Approval/Question: {"uiRequest": <raw request>}; Suggestion: {"action": ...}.
    pub payload: serde_json::Value,
    /// Higher = more urgent; Approval 50, Question 40, Error 30, Interrupted 25, Review 20, Suggestion 10.
    pub priority: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoCounts {
    pub open: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BacklogKind {
    Idea,
    Bug,
    Todo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BacklogStatus {
    Inbox,
    Dispatched,
    Done,
    Closed,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklogRef {
    /// "session" | "file" | "annotation"
    pub kind: String,
    pub session_id: Option<String>,
    pub path: Option<String>,
    pub text: Option<String>,
    pub lines: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklogItem {
    pub id: String,
    pub text: String,
    pub kind: BacklogKind,
    pub refs: Vec<BacklogRef>,
    pub status: BacklogStatus,
    pub target_session_id: Option<String>,
    /// Project directory the item belongs to (None = global).
    pub project_dir: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Patch for `backlog_update` (§7 D).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklogPatch {
    pub text: Option<String>,
    pub kind: Option<BacklogKind>,
    pub status: Option<BacklogStatus>,
    pub target_session_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    pub path: String,
    /// M A D R ??
    pub status: String,
    pub added: u32,
    pub deleted: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSummary {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub files: Vec<GitFileChange>,
    pub has_uncommitted: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub sha: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub ts: String,
}

/// Commit log page plus where this worktree branched off its base.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHistory {
    pub commits: Vec<GitCommit>,
    /// merge-base of HEAD with `base`; None when there is no base or it fails.
    pub fork_point: Option<String>,
    /// The branch the timeline forked from (e.g. "main" or "origin/main");
    /// None means HEAD is the base / could not be resolved.
    pub base: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    /// Number of uncommitted changes (0 = clean).
    pub dirty: u32,
    pub session_ids: Vec<String>,
    /// Commits on HEAD not in the local base branch (main/master).
    pub ahead: u32,
    /// Commits in the local base branch not in HEAD.
    pub behind: u32,
}

/// Detailed information about a local or remote Git branch.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    /// Full ref-derived name (e.g. "main", "dev", "origin/main").
    pub name: String,
    /// Short display name without remote prefix.
    pub display_name: String,
    /// Whether this is a remote tracking branch.
    pub is_remote: bool,
    /// Remote name (e.g. "origin") if is_remote or tracking.
    pub remote: Option<String>,
    /// Upstream tracking branch name if local (e.g. "origin/main").
    pub upstream: Option<String>,
    /// Whether this branch is currently checked out in a worktree.
    pub is_current_worktree: bool,
    /// Absolute path of the worktree checking this branch out (if any).
    pub worktree_path: Option<String>,
    /// Last commit SHA (short, ~7 chars).
    pub last_commit_sha: Option<String>,
    /// Last commit subject.
    pub last_commit_message: Option<String>,
    /// Relative commit time (e.g. "10 minutes ago", "3 days ago").
    pub last_commit_time: Option<String>,
    /// Number of commits ahead of upstream.
    pub ahead: u32,
    /// Number of commits behind upstream.
    pub behind: u32,
    /// Whether this branch is merged into default base (main/master).
    pub is_merged: bool,
}

/// Result of `git_sync_with_base`: commits merged in from base, and commits
/// the local base branch was fast-forwarded by.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseSyncResult {
    pub merged_from_base: u32,
    pub fast_forwarded: u32,
}

/// Preview of a branch merge operation without touching the working tree.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    pub can_merge: bool,
    pub has_conflicts: bool,
    pub conflicting_files: Vec<String>,
    pub commits_ahead: u32,
    pub commits_behind: u32,
    pub target_branch: String,
    pub source_branch: String,
}

/// GitHub PR URL info.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrUrlInfo {
    pub pr_url: Option<String>,
    pub remote_url: Option<String>,
    pub is_github: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnFile {
    pub path: String,
    /// "A" created during the turn, "M" modified, "D" deleted.
    pub status: String,
}

/// Per-turn checkpoint written by the omp-workspace-checkpoints extension,
/// enriched with `restorable` / `undone` from the repo's hidden refs.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCheckpoint {
    pub turn_id: String,
    pub session_id: String,
    pub user_item_id: Option<String>,
    pub prompt: String,
    pub before: String,
    pub after: String,
    pub head_before: Option<String>,
    pub head_after: Option<String>,
    /// Newest first.
    pub commits: Vec<String>,
    pub files: Vec<TurnFile>,
    pub ended_at: String,
    pub restorable: bool,
    pub undone: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnUndoResult {
    pub restored: Vec<String>,
    pub deleted: Vec<String>,
    pub conflicts: Vec<String>,
    pub head_reset: bool,
    pub warning: Option<String>,
    /// How many turns the cascade actually marked undone (older turns roll
    /// back every later non-undone turn too).
    pub turns_undone: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmRun {
    pub id: String,
    pub repo: String,
    pub sha: String,
    pub worktree: String,
    pub command: String,
    pub pid: Option<u32>,
    pub url: Option<String>,
    pub log_tail: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub pid: u32,
    pub name: String,
    pub port: u16,
    pub cwd: Option<String>,
    pub command: String,
    pub url: String,
    pub session_id: Option<String>,
    pub started_by_app: bool,
    /// Resident set size in KiB, captured at scan time.
    pub memory_kb: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryInfo {
    pub resident_mb: f64,
    pub formatted: String,
    pub processes: u32,
}

/// One memory bucket in `perf_breakdown`: byte total + process count.
/// `bytes` is None when the value is unknown (e.g. `ps` scan failed).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfBucket {
    pub bytes: Option<u64>,
    pub processes: u32,
}

/// One running omp-workspace app instance (one window per git worktree).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInstance {
    pub pid: u32,
    /// Short safe label: git branch of its cwd, else cwd basename, else "pid N".
    /// Never contains process arguments.
    pub label: String,
    pub cwd: Option<String>,
    /// True for the process serving this window.
    pub is_this: bool,
}

/// Result of `perf_breakdown`: where physical memory goes + active windows.
/// `app` shares `app_memory_usage`'s footprint semantics (so the popover matches
/// the bottom bar); `omp_spawned`/`omp_external` split `omp` agent processes by
/// whether this instance spawned them. Bar segments are `bar_app_bytes`,
/// `bar_omp_bytes`, `other.bytes`, `free_bytes` and are disjoint (spawned omp
/// already attributed to the app on macOS is counted only inside `app`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfBreakdown {
    pub app: PerfBucket,
    pub omp_spawned: PerfBucket,
    pub omp_external: PerfBucket,
    /// OMP legend segment: spawned + external, minus any spawned footprint
    /// already included in `app` on macOS.
    pub bar_omp_bytes: Option<u64>,
    /// Other processes/system: used - app - bar_omp (floored at 0).
    pub other_bytes: Option<u64>,
    /// Total physical RAM; None when the OS probe failed.
    pub total_bytes: Option<u64>,
    /// Physical RAM used; None when the OS probe failed.
    pub used_bytes: Option<u64>,
    /// `total - used`; shown as 空闲.
    pub free_bytes: Option<u64>,
    /// Running omp-workspace instances including this window.
    pub instances: Vec<AppInstance>,
    /// Milliseconds since Unix epoch at collection time.
    pub generated_at: u64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInfo {
    pub url: String,
    pub qr_svg: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileStatus {
    pub running: bool,
    pub port: u16,
    pub lan_url: Option<String>,
    pub tunnel_url: Option<String>,
    pub cloudflared_installed: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub available: bool,
    pub tokens: u64,
    pub cost: f64,
    /// "token-tracker" | "transcript"
    pub source: String,
}

/// Last-known config of a session recovered from its transcript, for the
/// composer while no RPC process is alive (a live `get_state` supersedes it).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    /// Last `thinking_level_change` (`configured` when present).
    pub thinking_level: Option<String>,
    /// Prompt tokens of the last assistant request; None when unknown
    /// (no assistant usage yet, or a compaction happened after it).
    pub context_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Default true.
    pub system_detection: bool,
    /// Default false.
    pub supervisor_enabled: bool,
    /// Default "smol" (passed as --model).
    pub supervisor_model: String,
    /// Default false.
    pub smart_context_routing: bool,
    /// Default 15; 0 = never.
    pub idle_suspend_minutes: u32,
    /// Default "write".
    pub default_approval_mode: String,
    /// Default "omp".
    pub omp_binary: String,
    /// Defaults: turn_end/approval/exit true, sound false.
    pub notify_turn_end: bool,
    pub notify_approval: bool,
    pub notify_exit: bool,
    pub notify_sound: bool,
    /// Default true.
    pub capsule_visible: bool,
    /// Default false.
    pub mobile_enabled: bool,
    /// Default 7788.
    pub mobile_port: u16,
    /// "off" | "quick" | "named"; default "off".
    pub tunnel_mode: String,
    pub tunnel_name: Option<String>,
    pub tunnel_hostname: Option<String>,
    /// Default "CommandOrControl+Shift+I".
    pub quick_capture_shortcut: String,
    /// Debounced supervisor trigger interval; default 30, 0 = manual refresh only.
    pub supervisor_interval_minutes: u32,
    /// "HH:MM" quiet-hours window for notifications; None or half-open pair = off.
    pub notify_quiet_from: Option<String>,
    pub notify_quiet_to: Option<String>,
    /// Default model for new sessions (stored for future use, not yet consumed).
    pub new_session_model: Option<String>,
    /// Default false: expand completed todos on the home page queue.
    pub home_show_completed_todos: bool,
    /// Default true: dock badge shows the open todo count.
    pub dock_badge_enabled: bool,
    /// Default true: background refresh of session summaries.
    pub session_turn_auto_refresh: bool,
    /// Default true: split sessions under a project by git worktree/branch.
    #[serde(default = "default_true")]
    pub session_group_by_worktree: bool,
    /// Turn checkpoints for app-launched sessions (spawn adds `-e` with the
    /// checkpoints extension). None = never asked; Some(false) = declined/off.
    #[serde(default)]
    pub turn_checkpoints: Option<bool>,
    /// Auto-send queued mid-stream messages one-by-one when the turn ends
    /// (None = never set → treated as enabled).
    #[serde(default)]
    pub queue_auto_send: Option<bool>,
    /// Run `omp update` automatically when the startup check finds a new
    /// version (None = never set → treated as off).
    #[serde(default)]
    pub omp_auto_update: Option<bool>,
    /// Inbox window in hours (default 24, valid 1..=720): non-blocking todos older
    /// than this are hidden from the inbox.
    #[serde(default = "default_inbox_window_hours")]
    pub inbox_window_hours: u32,
    /// Hours between automatic omp update checks while the app runs (default 24, valid 1..=720).
    #[serde(default = "default_omp_check_interval_hours")]
    pub omp_check_interval_hours: u32,
    /// Git delivery mode for main branch: "pr" (default, opens GitHub PR) or "direct" (merges locally and pushes to main).
    #[serde(default = "default_git_delivery_mode")]
    pub git_delivery_mode: String,
    /// AI doctor (heatmap diagnosis) model; default "smol"; empty falls back to supervisor_model.
    #[serde(default = "default_doctor_model")]
    pub doctor_model: String,
    /// "manual" (default) | "idle" | "scheduled".
    #[serde(default = "default_doctor_auto_mode")]
    pub doctor_auto_mode: String,
    /// Idle minutes before auto diagnosis (idle mode); default 30.
    #[serde(default = "default_doctor_idle_minutes")]
    pub doctor_idle_minutes: u32,
    /// "HH:MM" daily diagnosis time (scheduled mode); default "23:00".
    #[serde(default = "default_doctor_schedule_time")]
    pub doctor_schedule_time: String,
    /// Show real values in privacy chips by default (None ⇒ true).
    #[serde(default)]
    pub privacy_reveal_default: Option<bool>,
    /// Default true: append the app worktree's git branch to the OS window title
    /// ("omp-workspace · <branch>") so parallel instances are distinguishable.
    /// serde default covers stored settings predating this key.
    #[serde(default = "default_true")]
    pub window_worktree_title: bool,
    /// Dedicated default model for new side-chat forks (`<selector>` or
    /// `<selector>:<thinking-level>`). None = inherit the parent session's model.
    #[serde(default)]
    pub side_chat_model: Option<String>,
    /// Default true: bundle the visualize skill into app sessions
    /// (`--plugin-dir ~/.omp-workspace/plugins/omp-workspace-visualize`) so the
    /// model can emit ```` ```visualize ```` fragments the chat renders inline.
    /// serde default covers stored settings predating this key.
    #[serde(default = "default_true")]
    pub visualize_enabled: bool,
    /// Composer send shortcut: "enter" (default; Enter sends, Shift+Enter newline) or
    /// "mod-enter" (⌘/Ctrl+Enter sends, Enter newline). serde default covers older stored settings.
    #[serde(default = "default_send_shortcut")]
    pub send_shortcut: String,
    /// Follow-up behavior when a message is sent while a turn is running: "steer" (default),
    /// "queue" (held until the turn ends), or "interrupt" (abort the turn, then send).
    #[serde(default = "default_follow_up_behavior")]
    pub follow_up_behavior: String,
}

fn default_true() -> bool {
    true
}

fn default_doctor_model() -> String {
    "smol".to_string()
}

fn default_doctor_auto_mode() -> String {
    "manual".to_string()
}

fn default_doctor_idle_minutes() -> u32 {
    30
}

fn default_doctor_schedule_time() -> String {
    "23:00".to_string()
}

fn default_git_delivery_mode() -> String {
    "pr".to_string()
}

fn default_send_shortcut() -> String {
    "enter".to_string()
}

fn default_follow_up_behavior() -> String {
    "steer".to_string()
}

fn default_inbox_window_hours() -> u32 {
    24
}

fn default_omp_check_interval_hours() -> u32 {
    24
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            system_detection: true,
            supervisor_enabled: false,
            supervisor_model: "smol".to_string(),
            smart_context_routing: false,
            idle_suspend_minutes: 15,
            default_approval_mode: "yolo".to_string(),
            omp_binary: "omp".to_string(),
            notify_turn_end: true,
            notify_approval: true,
            notify_exit: true,
            notify_sound: false,
            capsule_visible: true,
            mobile_enabled: false,
            mobile_port: 7788,
            tunnel_mode: "off".to_string(),
            tunnel_name: None,
            tunnel_hostname: None,
            quick_capture_shortcut: "CommandOrControl+Shift+I".to_string(),
            supervisor_interval_minutes: 30,
            notify_quiet_from: None,
            notify_quiet_to: None,
            new_session_model: None,
            home_show_completed_todos: false,
            dock_badge_enabled: true,
            session_turn_auto_refresh: true,
            session_group_by_worktree: true,
            turn_checkpoints: None,
            queue_auto_send: None,
            omp_auto_update: None,
            inbox_window_hours: default_inbox_window_hours(),
            omp_check_interval_hours: default_omp_check_interval_hours(),
            git_delivery_mode: default_git_delivery_mode(),
            doctor_model: default_doctor_model(),
            doctor_auto_mode: default_doctor_auto_mode(),
            doctor_idle_minutes: default_doctor_idle_minutes(),
            doctor_schedule_time: default_doctor_schedule_time(),
            privacy_reveal_default: None,
            window_worktree_title: true,
            side_chat_model: None,
            visualize_enabled: true,
            send_shortcut: default_send_shortcut(),
            follow_up_behavior: default_follow_up_behavior(),
        }
    }
}

/// Privacy placeholder risk tier (§4 [P]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SecretRisk {
    Safe,
    Risky,
}

/// One marked secret value (§4 [P]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretEntry {
    pub id: String,
    pub value: String,
    pub label: Option<String>,
    /// Current placeholder `⟦LABEL_xxxx⟧`.
    pub placeholder: String,
    /// Legacy placeholders kept restorable (rows from before placeholders became
    /// immutable; no new rows are created).
    pub aliases: Vec<String>,
    pub risk: SecretRisk,
    pub track: bool,
    pub in_library: bool,
    pub library_prompted: bool,
    pub created_at: String,
    /// Number of sessions this entry is linked to (delete/untrack confirmation).
    pub session_count: u32,
    /// Per-session "protect only from here" cutoffs (epoch ms). Backend-only:
    /// feeds `secrets.json`, never serialized to the frontend.
    #[serde(default, skip_serializing)]
    pub cutoffs: std::collections::BTreeMap<String, i64>,
}

/// Which part of the session history a new mark protects (§7 `privacy_mark`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrivacyMarkScope {
    /// Only messages from now on; earlier history stays untouched.
    Future,
    /// The whole session history (default).
    #[default]
    All,
}

/// Partial update for `privacy_update`; `label: Some("")` clears the label.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretEntryPatch {
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub track: Option<bool>,
    #[serde(default)]
    pub in_library: Option<bool>,
    #[serde(default)]
    pub library_prompted: Option<bool>,
}

/// Return value of `privacy_list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacySnapshot {
    pub entries: Vec<SecretEntry>,
    /// "ok" | "conflict" | "error" (OMP global secrets.yml write status).
    pub native_status: String,
    pub native_error: Option<String>,
}

/// Return value of `privacy_classify`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretClassification {
    /// "safe" | "risky" | "reject".
    pub level: String,
    /// TOO_SHORT | INVALID_VALUE | SHORT | COMMON.
    pub reason: Option<String>,
    pub session_occurrences: u32,
}

/// Return value of `app_paths` (§7 LEAD).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub data_dir: String,
    pub global_dir: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub provider: String,
    pub id: String,
    pub name: String,
    /// Thinking levels this model supports (omp `thinking` array), e.g.
    /// ["low","medium","high","xhigh","max"]. Empty when unknown/unsupported.
    #[serde(default)]
    pub thinking: Vec<String>,
    /// Context window in tokens from `omp models --json`; `None` when unknown.
    #[serde(default)]
    pub context_window: Option<u64>,
}

/// One `models.yml` `providers.<providerId>.modelOverrides.<modelId>.contextWindow`
/// edit; `context_window: None` deletes the override.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelContextWindowEdit {
    pub provider_id: String,
    pub model_id: String,
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCheck {
    pub exists: bool,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub size: u64,
    pub readonly: bool,
}

/// API protocol used to talk to a provider.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderApi {
    /// OpenAI-compatible endpoints (`/models`, `/chat/completions`).
    #[default]
    OpenaiCompletions,
    /// OpenAI Responses API (`/responses`) — distinct wire format from chat completions.
    OpenaiResponses,
    /// Anthropic Messages API.
    Anthropic,
    /// Google Gemini API.
    Gemini,
    /// Local Ollama engine (no API key needed).
    Ollama,
}

/// A provider model entry: bare id or a spec with per-model limits.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ModelEntry {
    /// Simple form — just the model id (keeps existing providers.json data valid).
    Id(String),
    Spec(ModelSpec),
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
}

impl ModelEntry {
    pub fn id(&self) -> &str {
        match self {
            ModelEntry::Id(id) => id,
            ModelEntry::Spec(spec) => &spec.id,
        }
    }
}

impl From<String> for ModelEntry {
    fn from(id: String) -> Self {
        ModelEntry::Id(id)
    }
}

impl From<&str> for ModelEntry {
    fn from(id: &str) -> Self {
        ModelEntry::Id(id.to_string())
    }
}

/// Provider metadata (non-secret). Secrets live only in the encrypted vault
/// (`providers::vault`); `hasKey`/`keyHint` are the only key-derived fields.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    /// Stable identifier `[A-Za-z0-9_-]+`; the vault line key derives from it.
    pub slug: String,
    /// Frontend preset this provider was created from, if any.
    pub preset_id: Option<String>,
    pub base_url: String,
    pub api: ProviderApi,
    /// Env var injected into child processes (e.g. ANTHROPIC_API_KEY).
    pub env_var: String,
    pub models: Vec<ModelEntry>,
    pub default_model: Option<String>,
    #[serde(default)]
    pub default_context_window: Option<u32>,
    #[serde(default)]
    pub default_max_tokens: Option<u32>,
    pub enabled: bool,
    pub sort: i64,
    /// True when an encrypted key exists in the vault for this slug.
    pub has_key: bool,
    /// Last 4 chars of the key, stored at save time for display.
    pub key_hint: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Result of `provider_test`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub detail: String,
}

/// Provider info discovered from OMP global configs (`models.yml`, `config.yml`, `agent.db`).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OmpProviderInfo {
    pub id: String,
    pub sources: Vec<String>,
    pub base_url: Option<String>,
    pub api: Option<String>,
    pub has_api_key: bool,
    pub api_key_env: Option<String>,
    pub model_ids: Vec<String>,
    pub credential_types: Vec<String>,
    pub accounts: Vec<String>,
    pub used_in_roles: Vec<String>,
}

/// Event payload emitted during OAuth/RPC login flow (`providers:oauth`).
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OauthUiEvent {
    pub kind: String,
    pub provider_id: String,
    pub url: Option<String>,
    pub launch_url: Option<String>,
    pub instructions: Option<String>,
    pub request_id: Option<String>,
    pub method: Option<String>,
    pub title: Option<String>,
    pub placeholder: Option<String>,
    pub timeout_ms: Option<u64>,
    pub message: Option<String>,
    pub ok: Option<bool>,
    pub error: Option<String>,
}

/// Result of importing an OMP provider configuration into the vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpImportResult {
    pub id: String,
    pub ok: bool,
    pub error: Option<String>,
}

// ---- E: Schedules (定时任务) ----

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScheduleNotify {
    /// Every finished run creates an inbox todo.
    #[default]
    All,
    /// Only failed runs and runs that stopped for approval/an answer.
    Important,
    /// Never create an inbox todo.
    None,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleRunMode {
    #[default]
    Local,
    Worktree,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScheduleCadence {
    Interval {
        minutes: u32,
    },
    /// `weekdays` empty: every `every` days (default 1) at local `time`.
    /// `weekdays` non-empty: every `every` weeks (default 1) on those weekdays
    /// (0 = Sunday … 6 = Saturday). `anchor` is a local date `YYYY-MM-DD` that
    /// fixes the day/week phase when `every` > 1; the store fills today's local
    /// date when missing.
    Daily {
        time: String,
        #[serde(default)]
        weekdays: Vec<u32>,
        #[serde(
            default = "default_schedule_every",
            skip_serializing_if = "schedule_every_is_one"
        )]
        every: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor: Option<String>,
    },
    /// One-shot at an absolute instant (RFC3339 UTC).
    Once {
        at: String,
    },
    /// Every `every` months (default 1) on `day` (1-31, clamped to the month's
    /// length) at local `time` (HH:MM). `anchor` (local date `YYYY-MM-DD`)
    /// fixes the month phase when `every` > 1.
    Monthly {
        day: u32,
        time: String,
        #[serde(
            default = "default_schedule_every",
            skip_serializing_if = "schedule_every_is_one"
        )]
        every: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        anchor: Option<String>,
    },
}

fn default_schedule_every() -> u32 {
    1
}

/// `every` defaults to 1 and is omitted from JSON when it has the default
/// value, keeping legacy cadence documents byte-identical.
fn schedule_every_is_one(every: &u32) -> bool {
    *every == 1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleLifecycle {
    Active,
    Paused,
    Completed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleRunStatus {
    Running,
    Ok,
    Error,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub cwd: String,
    pub run_mode: ScheduleRunMode,
    pub cadence: ScheduleCadence,
    pub model: Option<String>,
    pub thinking: Option<String>,
    pub approval_mode: Option<String>,
    pub enabled: bool,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    /// Status of the most recent run (derived from schedule_runs).
    pub last_run_status: Option<ScheduleRunStatus>,
    /// Inbox policy per finished run (stored; default `all`).
    pub notify: ScheduleNotify,
    /// false = reuse the previous run's session when resumable (local mode only).
    pub new_chat_each_run: bool,
    pub created_at: String,
    pub updated_at: String,
    /// Stop repeating after this instant (RFC3339 UTC); null = never.
    pub end_at: Option<String>,
    /// Derived, not stored: `completed` = a `once` schedule that already ran, or a
    /// recurring one past `end_at` or at its `max_runs` cap; `paused` = disabled
    /// but not completed; else `active`.
    pub lifecycle: ScheduleLifecycle,
    /// Stop after this many runs (recurring only; `once` ignores it); NULL = unlimited.
    pub max_runs: Option<u32>,
    /// Runs started so far (counts toward `max_runs`).
    pub runs_done: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDraft {
    pub id: Option<String>,
    pub name: String,
    pub prompt: String,
    pub cwd: String,
    #[serde(default)]
    pub run_mode: ScheduleRunMode,
    pub cadence: ScheduleCadence,
    pub model: Option<String>,
    pub thinking: Option<String>,
    pub approval_mode: Option<String>,
    /// Inbox policy; absent = `all` (backend default).
    #[serde(default)]
    pub notify: ScheduleNotify,
    /// false = reuse the previous run's session when resumable; absent = true.
    #[serde(default = "default_schedule_new_chat")]
    pub new_chat_each_run: bool,
    /// Stop repeating after this instant (RFC3339 UTC); null/absent = never.
    /// Ignored for `once` cadences.
    pub end_at: Option<String>,
    /// Stop after this many runs (>= 1); null/absent = unlimited.
    /// Ignored for `once` cadences.
    pub max_runs: Option<u32>,
    #[serde(default = "default_schedule_enabled")]
    pub enabled: bool,
}

fn default_schedule_enabled() -> bool {
    true
}

fn default_schedule_new_chat() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRun {
    pub id: String,
    pub schedule_id: String,
    pub session_id: Option<String>,
    pub status: ScheduleRunStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub summary: Option<String>,
}

// ---- Skills & Extensions catalog ----

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillIssue {
    /// Frontmatter parsed but contains no description.
    MissingDescription,
    /// Description exceeds the 1024-char Agent Skills spec limit.
    DescriptionTooLong,
    /// SKILL.md missing, unreadable, non-UTF-8, or the skill dir is a dangling symlink.
    Unreadable,
}

/// Which agent ecosystem provided the discovery root this skill was found in.
/// Classified from the root path, independent of `source` (project vs user).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillProvider {
    /// ~/.omp/agent/skills or <proj>/.omp/skills
    Native,
    /// ~/.claude/skills or <proj>/.claude/skills
    Claude,
    /// ~/.agents|~/.agent/skills or <proj>/.agents|.agent/skills
    Agents,
    /// ~/.codex/skills or <proj>/.codex/skills
    Codex,
    /// <proj>/.github/skills
    Github,
    /// ~/.omp/agent/managed-skills
    Managed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillItem {
    pub name: String,
    pub description: String,
    pub source: String,
    /// Agent ecosystem of the discovery root (e.g. "native", "claude").
    pub provider: SkillProvider,
    pub path: String,
    pub dir: String,
    /// Display install root: home-abbreviated (`~/.omp/agent/skills`) or
    /// project-relative (`./.omp/skills`).
    pub root: String,
    /// Number of discovery roots containing a skill with this same name (>= 1).
    pub copies: u32,
    /// Health issues; empty means healthy.
    pub issues: Vec<SkillIssue>,
    /// Estimated resident system-prompt cost: name + description chars + 4.
    pub prompt_chars: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsage {
    pub name: String,
    pub count: u64,
    /// ISO-8601 timestamp of the most recent in-window trigger.
    pub last_used_at: Option<String>,
}

/// Result of `skills_usage`: per-skill trigger counts over `days` days.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageReport {
    pub days: u32,
    pub total_triggers: u64,
    pub scanned_files: u64,
    pub usage: Vec<SkillUsage>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionItem {
    pub name: String,
    pub path: String,
    pub source: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsCatalog {
    pub skills: Vec<SkillItem>,
    pub extensions: Vec<ExtensionItem>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_entry_untagged_roundtrip() {
        // Old format: array of strings
        let old_json = r#"["gpt-4o", "claude-3-5-sonnet"]"#;
        let entries: Vec<ModelEntry> = serde_json::from_str(old_json).unwrap();
        assert_eq!(
            entries,
            vec![
                ModelEntry::Id("gpt-4o".into()),
                ModelEntry::Id("claude-3-5-sonnet".into())
            ]
        );
        assert_eq!(entries[0].id(), "gpt-4o");
        assert_eq!(entries[1].id(), "claude-3-5-sonnet");

        // New format: objects with spec
        let new_json =
            r#"[{"id":"m","contextWindow":200000},{"id":"m2","maxTokens":8192,"name":"M2"}]"#;
        let spec_entries: Vec<ModelEntry> = serde_json::from_str(new_json).unwrap();
        assert_eq!(
            spec_entries,
            vec![
                ModelEntry::Spec(ModelSpec {
                    id: "m".into(),
                    name: None,
                    context_window: Some(200000),
                    max_tokens: None,
                }),
                ModelEntry::Spec(ModelSpec {
                    id: "m2".into(),
                    name: Some("M2".into()),
                    context_window: None,
                    max_tokens: Some(8192),
                }),
            ]
        );
        assert_eq!(spec_entries[0].id(), "m");
        assert_eq!(spec_entries[1].id(), "m2");

        // Mixed format
        let mixed_json = r#"["bare-id", {"id":"spec-id","contextWindow":128000}]"#;
        let mixed: Vec<ModelEntry> = serde_json::from_str(mixed_json).unwrap();
        assert_eq!(mixed[0], ModelEntry::Id("bare-id".into()));
        assert_eq!(
            mixed[1],
            ModelEntry::Spec(ModelSpec {
                id: "spec-id".into(),
                name: None,
                context_window: Some(128000),
                max_tokens: None,
            })
        );
    }

    #[test]
    fn test_provider_config_missing_option_fields_default_to_none() {
        let json = r#"{
            "id": "p1",
            "name": "Provider",
            "slug": "p1",
            "baseUrl": "https://api.openai.com/v1",
            "api": "openai_responses",
            "envVar": "OPENAI_API_KEY",
            "models": ["gpt-4o"],
            "enabled": true,
            "sort": 1,
            "hasKey": true,
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z"
        }"#;
        let config: ProviderConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.api, ProviderApi::OpenaiResponses);
        assert_eq!(config.default_context_window, None);
        assert_eq!(config.default_max_tokens, None);
        assert_eq!(config.models, vec![ModelEntry::Id("gpt-4o".into())]);
    }
}
