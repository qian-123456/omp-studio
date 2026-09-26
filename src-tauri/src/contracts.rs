//! Shared serde contract types (docs/ARCHITECTURE.md §4).
//! Structs serialize camelCase; enums serialize snake_case.

use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
    /// File mtime.
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSessionInfo {
    pub session_id: String,
    pub session_file: String,
    pub pid: u32,
    pub cwd: String,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoSource {
    System,
    Supervisor,
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

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub dirty: bool,
    pub session_ids: Vec<String>,
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
        }
    }
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
