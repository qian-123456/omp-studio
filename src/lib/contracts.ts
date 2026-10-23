/**
 * TS mirror of src-tauri/src/contracts.rs (docs/ARCHITECTURE.md §4).
 * Fields are camelCase; enum values are snake_case string unions.
 */

/**
 * Sidebar space ("mode"): visually independent spaces, nothing shared across them.
 * `chat` (通用对话) is the project-less space: it owns the single global workspace
 * and the SessionGroups; the other modes only hold project directories.
 */
export type SpaceMode = "code" | "work" | "study" | "research" | "chat";


export type SessionStatus =
	| "working"
	| "awaiting_approval"
	| "awaiting_answer"
	| "review"
	| "idle"
	| "error"
	| "interrupted"
	| "suspended"
	| "external";

export type PendingKind =
	| "approval"
	| "question"
	| "review"
	| "error"
	| "interrupted";

export interface GitBadge {
	branch: string | null;
	dirty: number;
	worktree: string | null;
}

export interface ResultBadge {
	/** "test" | "build" */
	kind: string;
	ok: boolean;
	at: string;
	summary: string;
}

export interface SessionMeta {
	id: string;
	/** Always "omp". */
	tool: string;
	/** Absolute jsonl path. */
	file: string;
	cwd: string;
	title: string;
	/** "#115" or fork label "#115.2.1". */
	label: string;
	createdAt: string;
	/** File mtime. */
	updatedAt: string;
	/** Fork parent session id (side chats). */
	parentId: string | null;
	/** 0 main, 1..=3. */
	forkDepth: number;
	/** "side" = side chat, "fork" = full fork copy, null = ordinary session. */
	kind?: "side" | "fork" | null;
	status: SessionStatus;
	unread: boolean;
	pending: PendingKind | null;
	live: boolean;
	externalPid: number | null;
	pinned: boolean;
	archived: boolean;
	/** Resolved membership (explicit override or path match, same mode only); null = 未归档. */
	workspaceId: string | null;
	repoRoot: string | null;
	git: GitBadge | null;
	result: ResultBadge | null;
	lastAssistant: string | null;
	model: string | null;
	/** Derived inbox attention kind (no time window applied). */
	attention: Attention | null;
	/** Space this session belongs to; recorded at creation, default "code". */
	mode: SpaceMode;
	/** SessionGroup id inside the mode's 无项目 area; only global-workspace sessions. */
	groupId: string | null;
	/** True when this app created or opened/continued the session; false = plain-CLI session (excluded from inbox + badge). Absent = app-owned. */
	createdByApp?: boolean;
}

/** One piece of a search snippet; `hit` parts are the matched tokens. */
export interface SearchSegment {
	text: string;
	hit: boolean;
}

/** Best full-text hit of one session (`search_sessions`). */
export interface SessionSearchHit {
	sessionId: string;
	/** Transcript item id of the best matching message (same ids as TranscriptItem.id). */
	entryId: string;
	role: "user" | "assistant";
	/** ISO-8601 of that entry. */
	ts: string;
	/** ~160 chars window around the first match; concatenated text = the snippet. */
	segments: SearchSegment[];
	truncatedStart: boolean;
	truncatedEnd: boolean;
	/** Number of matching entries in this session (>= 1). */
	matchCount: number;
}

/** Full-text index build progress (`search_index_status`, `search_index:progress`). */
export interface SearchIndexStatus {
	indexed: number;
	total: number;
	building: boolean;
}

/** Inbox / sidebar attention kind, one per session (precedence top→bottom). */
export type Attention = "awaiting" | "error" | "unread" | "running";

/** Patch for `update_session_meta`. */
export interface SessionMetaPatch {
	customName?: string;
	pinned?: boolean;
	archived?: boolean;
	workspaceId?: string;
}

export type WorkspaceKind = "project" | "global";

export interface Workspace {
	id: string;
	path: string;
	name: string;
	kind: WorkspaceKind;
	sort: number;
	/** Space this workspace belongs to (same dir may be a project in several modes). */
	mode: SpaceMode;
}

/** Named group inside a mode's 无项目 area (grouping only, not a directory). */
export interface SessionGroup {
	id: string;
	mode: SpaceMode;
	name: string;
	sort: number;
}


export type TranscriptKind =
	| "user"
	| "assistant"
	| "tool_result"
	| "bash"
	| "custom"
	| "compaction"
	| "branch_summary"
	| "model_change"
	| "thinking_level_change"
	| "system"
	| "unknown";

export interface ToolCall {
	id: string;
	name: string;
	args: unknown;
	intent: string | null;
}

export interface ToolResultInfo {
	toolCallId: string;
	toolName: string;
	text: string;
	isError: boolean;
	details: unknown | null;
}

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
}

/** Structured image reference attached to a transcript item. */
export interface ImageAttachment {
	id: string;
	marker?: string | null;
	path?: string | null;
	mimeType?: string | null;
	width?: number | null;
	height?: number | null;
}

export interface TranscriptItem {
	id: string;
	parentId: string | null;
	ts: string;
	kind: TranscriptKind;
	text: string | null;
	thinking: string | null;
	toolCalls: ToolCall[];
	toolResult: ToolResultInfo | null;
	usage: Usage | null;
	model: string | null;
	stopReason: string | null;
	hidden: boolean;
	/** Structured image attachments. */
	images?: ImageAttachment[];
	/** Assistant only: total request duration in ms (omp `message.duration`). */
	duration?: number | null;
	/** Assistant only: time to first token in ms (omp `message.ttft`). */
	ttft?: number | null;
	/** Assistant only: completion time, epoch ms (omp `message.completedAt`). */
	completedAt?: number | null;
	/** Compaction only: first entry the compacted context still keeps verbatim. */
	firstKeptEntryId?: string | null;
}

export interface TranscriptPage {
	sessionId: string;
	items: TranscriptItem[];
	/** Byte offset for incremental reads. */
	nextOffset: number;
	reset: boolean;
	/** Id of the entry ending at `nextOffset`; pass it back with the next
	 * incremental read so a rewritten file (omp `/shake`) restarts from 0. */
	tailId?: string | null;
}

export type SubagentStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "aborted";

/** `subagent_list` entry (contract C5). */
export interface SubagentSummary {
	id: string;
	status: SubagentStatus;
	model: string | null;
	thinkingLevel: string | null;
	/** omp agent type (scout / task / reviewer / ...), from `session_init.agent`. */
	agent: string | null;
	prompt: string | null;
	messageCount: number;
	toolCallCount: number;
	requestCount: number;
	tokens: number;
	cost: number;
	startedAt: string | null;
	endedAt: string | null;
	outputPath: string | null;
	filePath: string;
}

/** `subagent_transcript` payload (contract C5). */
export interface SubagentTranscript {
	agentId: string;
	file: string;
	summary: SubagentSummary;
	systemPrompt: string | null;
	prompt: string | null;
	items: TranscriptItem[];
	output: string | null;
	outputPath: string | null;
	nextByte: number;
	reset: boolean;
}

export interface LiveSessionInfo {
	sessionId: string;
	sessionFile: string;
	pid: number;
	cwd: string;
}

export interface StartOpts {
	cwd: string;
	/** --resume <path> */
	resumeFile?: string | null;
	/** --model */
	model?: string | null;
	/** --approval-mode; default from settings. */
	approvalMode?: string | null;
	/** Side chats: send `new_session {parentSession}` after ready. */
	parentSessionId?: string | null;
	/** Pre-assigned label (side chats). */
	label?: string | null;
	/** --plan-yolo: read-only plan mode, auto-approving plan into implementation. */
	planYolo?: boolean | null;
	/** --fork <path>: native fork of the parent session file. */
	forkFile?: string | null;
	/** --append-system-prompt: hidden instructions outside the visible transcript. */
	appendSystemPrompt?: string | null;
	/** Space the new session belongs to (default "code"); persisted on session_meta. */
	mode?: SpaceMode;
	/** SessionGroup to file the new session under (mode's 无项目 area only). */
	groupId?: string | null;
}

export interface PendingUiRequest {
	sessionId: string;
	/** Raw extension_ui_request. */
	request: unknown;
	receivedAt: string;
}

export type TodoKind =
	| "approval"
	| "question"
	| "error"
	| "interrupted"
	| "review"
	| "service_left"
	/** A scheduled-task run finished; payload: {"scheduleId","runId","ok":bool}. */
	| "schedule_run";

/** `schedule` rows are always visible (not gated by the system-detection switch). */
export type TodoSource = "system" | "schedule";

export type TodoStatus = "open" | "done" | "ignored";

export interface Todo {
	id: string;
	kind: TodoKind;
	source: TodoSource;
	status: TodoStatus;
	sessionId: string | null;
	title: string;
	detail: string;
	/** Approval/Question: {uiRequest}. */
	payload: unknown;
	/** Higher = more urgent. */
	priority: number;
	createdAt: string;
	updatedAt: string;
}

export interface TodoCounts {
	open: number;
	total: number;
}

export type BacklogKind = "idea" | "bug";

export type BacklogStatus = "inbox" | "dispatched" | "done" | "closed";

export interface BacklogRef {
	/** "session" | "file" | "annotation" | "image" */
	kind: string;
	sessionId: string | null;
	path: string | null;
	text: string | null;
	lines: string | null;
}

export interface BacklogItem {
	id: string;
	text: string;
	kind: BacklogKind;
	refs: BacklogRef[];
	status: BacklogStatus;
	targetSessionId: string | null;
	/** Project (cwd) the item was captured in; null = global. */
	projectDir: string | null;
	createdAt: string;
	updatedAt: string;
	/** Moved to the trash at this time (soft delete); null = live. Purged 7 days later. */
	deletedAt: string | null;
}

/** Patch for `backlog_update`. */
export interface BacklogPatch {
	text?: string;
	kind?: BacklogKind;
	status?: BacklogStatus;
	targetSessionId?: string;
	/** Replaces refs wholesale (used when image tokens are removed while editing). */
	refs?: BacklogRef[];
}

export interface GitFileChange {
	path: string;
	/** M A D R ?? */
	status: string;
	added: number;
	deleted: number;
}

export interface GitSummary {
	isRepo: boolean;
	branch: string | null;
	files: GitFileChange[];
	hasUncommitted: boolean;
}

export interface GitCommit {
	sha: string;
	short: string;
	subject: string;
	author: string;
	ts: string;
}

/** Commit page plus where this worktree branched off its base branch. */
export interface GitHistory {
	commits: GitCommit[];
	/** merge-base of HEAD with `base`; null when there is no base. */
	forkPoint: string | null;
	/** Branch the history forked from ("main" / "origin/main"); null = HEAD is the base. */
	base: string | null;
}

export interface WorktreeInfo {
	path: string;
	branch: string | null;
	head: string;
	/** Number of uncommitted changes (0 = clean). */
	dirty: number;
	sessionIds: string[];
	/** Commits on HEAD not in the local base branch (main/master). */
	ahead: number;
	/** Commits in the local base branch not in HEAD. */
	behind: number;
}

export interface BranchInfo {
	name: string;
	displayName: string;
	isRemote: boolean;
	remote?: string | null;
	upstream?: string | null;
	isCurrentWorktree: boolean;
	worktreePath?: string | null;
	lastCommitSha?: string | null;
	lastCommitMessage?: string | null;
	lastCommitTime?: string | null;
	ahead: number;
	behind: number;
	isMerged: boolean;
}

export interface BaseSyncResult {
	mergedFromBase: number;
	fastForwarded: number;
}

export interface MergePreview {
	canMerge: boolean;
	hasConflicts: boolean;
	conflictingFiles: string[];
	commitsAhead: number;
	commitsBehind: number;
	targetBranch: string;
	sourceBranch: string;
}

export interface PrUrlInfo {
	prUrl: string | null;
	remoteUrl: string | null;
	isGithub: boolean;
}

/** One file changed during an agent turn. */
export interface TurnFile {
	path: string;
	/** A = created during the turn, M = modified, D = deleted. */
	status: "A" | "M" | "D";
}

/**
 * Per-turn checkpoint recorded by the omp-workspace-checkpoints extension
 * (session entry `custom` / `omp-workspace.turn-checkpoint`), enriched by Rust.
 */
export interface TurnCheckpoint {
	turnId: string;
	sessionId: string;
	/** Transcript item id of the user message that started the turn. */
	userItemId: string | null;
	/** First line of that user message, at most 80 chars. */
	prompt: string;
	/** Hidden snapshot commit of the worktree before / after the turn. */
	before: string;
	after: string;
	headBefore: string | null;
	headAfter: string | null;
	/** Commits the agent created during the turn, newest first. */
	commits: string[];
	files: TurnFile[];
	/** ISO time the turn ended. */
	endedAt: string;
	/** Snapshot refs still exist (not pruned). */
	restorable: boolean;
	/** The user already undid this turn. */
	undone: boolean;
}

export interface TurnUndoResult {
	/** Files written back to their pre-turn content (deduped, final state). */
	restored: string[];
	/** Files removed because a cascaded turn created them. */
	deleted: string[];
	/** Files changed after the last cascaded turn ended; non-empty means nothing was touched (force=false). */
	conflicts: string[];
	/** HEAD moved back across the cascade (each turn resets only while its commits are still on top). */
	headReset: boolean;
	/** Plain-Chinese note for the user, e.g. why history was left alone. */
	warning: string | null;
	/** How many turns were marked undone (rolling back an older turn also rolls back every later non-undone turn). */
	turnsUndone: number;
}

export interface TmRun {
	id: string;
	repo: string;
	sha: string;
	worktree: string;
	command: string;
	pid: number | null;
	url: string | null;
	logTail: string;
}

export interface ServiceInfo {
	pid: number;
	name: string;
	port: number;
	cwd: string | null;
	command: string;
	url: string;
	sessionId: string | null;
	startedByApp: boolean;
	memoryKb: number | null;
}

export interface ProcessMemoryInfo {
	residentMb: number;
	formatted: string;
	processes: number;
}

/** One memory bucket in `perf_breakdown` (bytes null = unknown). */
export interface PerfBucket {
	bytes: number | null;
	processes: number;
}

/** One running omp-workspace instance; `label` = branch/worktree or "pid N". */
export interface AppInstance {
	pid: number;
	label: string;
	cwd: string | null;
	isThis: boolean;
}

/**
 * `perf_breakdown` result. `app` matches the bottom-bar number;
 * bar segments (barAppBytes = app.bytes, barOmpBytes, otherBytes, freeBytes)
 * are disjoint and sum to `totalBytes` when known.
 */
export interface PerfBreakdown {
	app: PerfBucket;
	ompSpawned: PerfBucket;
	ompExternal: PerfBucket;
	barOmpBytes: number | null;
	otherBytes: number | null;
	totalBytes: number | null;
	usedBytes: number | null;
	freeBytes: number | null;
	instances: AppInstance[];
	generatedAt: number;
}

export interface PairingInfo {
	url: string;
	qrSvg: string;
	expiresAt: string;
}

export type PairingTarget = "lan" | "tunnel" | "ipv6";

export interface DdnsStatus {
	enabled: boolean;
	/** API token present in the vault (value never leaves the backend). */
	tokenSet: boolean;
	hostname: string | null;
	lastIp: string | null;
	lastSyncAt: string | null;
	lastError: string | null;
	/** True after 401/403/429 or repeated failure; cleared by a manual sync. */
	halted: boolean;
}

export interface MobileStatus {
	running: boolean;
	port: number;
	lanUrl: string | null;
	tunnelUrl: string | null;
	cloudflaredInstalled: boolean;
	ipv6Running: boolean;
	ipv6Port: number;
	ipv6Address: string | null;
	/** `https://<ddns host>:<port>` when synced, else `https://[addr]:<port>`. */
	ipv6Url: string | null;
	/** Self-signed certificate SHA-256 fingerprint (AA:BB:… uppercase). */
	certSha256: string | null;
	ddns: DdnsStatus;
}

export interface UsageSummary {
	available: boolean;
	tokens: number;
	cost: number;
	/** "token-tracker" | "transcript" */
	source: string;
}

/** Last-known thinking level / context size from the transcript (no live process). */
export interface SessionSnapshot {
	thinkingLevel: string | null;
	contextTokens: number | null;
}

export interface Settings {
	systemDetection: boolean;
	smartContextRouting: boolean;
	/** 0 = never. */
	idleSuspendMinutes: number;
	defaultApprovalMode: string;
	ompBinary: string;
	notifyTurnEnd: boolean;
	notifyApproval: boolean;
	notifyExit: boolean;
	notifySound: boolean;
	capsuleVisible: boolean;
	mobileEnabled: boolean;
	mobilePort: number;
	/** "off" | "quick" | "named" */
	tunnelMode: string;
	tunnelName: string | null;
	tunnelHostname: string | null;
	/** IPv6 direct HTTPS listener (self-signed cert). Default false. */
	mobileIpv6Enabled: boolean;
	/** Default 7789. */
	mobileIpv6Port: number;
	/** Cloudflare DDNS for the IPv6 address. Default false. */
	ddnsEnabled: boolean;
	ddnsZoneId: string | null;
	ddnsHostname: string | null;
	quickCaptureShortcut: string;
	/** Hours before non-blocking inbox todos auto-hide (1..=720). */
	inboxWindowHours: number;
	/** Hours between automatic omp update checks while the app runs (1..=720). */
	ompCheckIntervalHours: number;
	/** "HH:MM" quiet-hours window; null or half-open pair = off. */
	notifyQuietFrom: string | null;
	notifyQuietTo: string | null;
	/** Default model for new sessions (stored for future use). */
	newSessionModel: string | null;
	dockBadgeEnabled: boolean;
	sessionTurnAutoRefresh: boolean;
	/** Default true: split sessions under a project by git worktree/branch; false = one flat list per project. */
	sessionGroupByWorktree: boolean;
	/**
	 * Turn checkpoints for app-launched sessions (loads the checkpoints extension
	 * via `-e`). null = never asked (Git panel shows the consent card).
	 */
	turnCheckpoints: boolean | null;
	/** Auto-send queued mid-stream messages when the turn ends (null = enabled). */
	queueAutoSend: boolean | null;
	/** Auto-run `omp update` when the startup check finds a new version (null = off). */
	ompAutoUpdate: boolean | null;
	/** Git delivery mode: "pr" (default, opens GitHub PR) or "direct" (merges locally and pushes to main). */
	gitDeliveryMode?: "pr" | "direct" | string;
	/** AI doctor (heatmap diagnosis) model; default "smol". */
	doctorModel: string;
	/** Auto diagnosis mode; default "manual" (never spends tokens without user action). */
	doctorAutoMode: "manual" | "idle" | "scheduled";
	/** Idle minutes before auto diagnosis in "idle" mode; default 30. */
	doctorIdleMinutes: number;
	/** "HH:MM" daily time for "scheduled" mode; default "23:00". */
	doctorScheduleTime: string;
	/** Show real values in privacy chips by default (null ⇒ true). */
	privacyRevealDefault: boolean | null;
	/** Default true: OS window title shows "omp-workspace · <branch>" for the worktree the app was launched from. */
	windowWorktreeTitle: boolean;
	/**
	 * Dedicated default model for new side-chat forks ("<selector>" or
	 * "<selector>:<level>"). null = inherit the parent session's model;
	 * a selector unavailable in the catalog falls back to the parent model.
	 */
	sideChatModel: string | null;
	/**
	 * Default true: app sessions are spawned with `--plugin-dir` pointing at the
	 * bundled visualize plugin (~/.omp-workspace/plugins/omp-workspace-visualize),
	 * so the model can emit ```` ```visualize ```` fragments that the chat
	 * renders in a sandboxed viewer. false = skill absent + plain code block.
	 */
	visualizeEnabled: boolean;
	/** Composer send shortcut: "enter" (Enter sends, Shift+Enter newline) or "mod-enter" (⌘/Ctrl+Enter sends). */
	sendShortcut: "enter" | "mod-enter";
	/** Follow-up when a message is sent during a running turn: steer | queue | interrupt (interrupt aborts, then sends). */
	followUpBehavior: "steer" | "queue" | "interrupt";
}

/** Privacy placeholder risk tier (§4 [P]). */
export type SecretRisk = "safe" | "risky";

/** One marked secret value (§4 [P]). */
export interface SecretEntry {
	id: string;
	value: string;
	label: string | null;
	/** Current placeholder `⟦LABEL_xxxx⟧`. */
	placeholder: string;
	/** Legacy placeholders kept restorable (no new ones are created; placeholders are immutable). */
	aliases: string[];
	risk: SecretRisk;
	track: boolean;
	inLibrary: boolean;
	libraryPrompted: boolean;
	createdAt: string;
	/** Number of sessions this entry is linked to (for delete/untrack confirmation). */
	sessionCount: number;
}

/** Which part of the session history a new mark protects (§7 `privacy_mark`). */
export type PrivacyMarkScope = "future" | "all";

/** `privacy_update` patch; `label: ""` clears the label. */
export interface SecretEntryPatch {
	label?: string;
	track?: boolean;
	inLibrary?: boolean;
	libraryPrompted?: boolean;
}

export type PrivacyNativeStatus = "ok" | "conflict" | "error";

export interface PrivacySnapshot {
	entries: SecretEntry[];
	nativeStatus: PrivacyNativeStatus;
	nativeError: string | null;
}

export type SecretClassificationReason =
	| "TOO_SHORT"
	| "INVALID_VALUE"
	| "SHORT"
	| "COMMON";

export interface SecretClassification {
	level: "safe" | "risky" | "reject";
	reason: SecretClassificationReason | null;
	sessionOccurrences: number;
}

/** One `omp config list --json` entry. */
export interface OmpConfigEntry {
	key: string;
	/** Current effective value; null when unset or redacted. */
	value: unknown | null;
	/** "boolean" | "number" | "string" | "enum" | "array" | "record" */
	valueType: string;
	description: string;
	/** Credential field: write-only in the UI. */
	redacted: boolean;
	/** Official settings tab from `omp config list` (appearance/context/…). */
	tab: string;
}

/** Result of `omp config list --json`; found=false on missing binary / failure. */
export interface OmpConfigListResult {
	found: boolean;
	entries: OmpConfigEntry[];
	error: string | null;
}

/** Raw `<cwd>/.omp/config.yml` (omp project settings layer). */
export interface OmpProjectConfigFile {
	/** Absolute path of `<cwd>/.omp/config.yml`. */
	path: string;
	/** false when the file does not exist yet (content is then ""). */
	exists: boolean;
	content: string;
}

/** One scope's allowed config keys: `modelRoles` and `task.agentModelOverrides`, nothing else. */
export interface ModelRoleLayer {
	path: string;
	exists: boolean;
	modelRoles: Record<string, string>;
	agentModelOverrides: Record<string, string>;
}

/** Layer that supplied an agent's effective model. */
export type AgentEffectiveSource = "override" | "global" | "project" | "agent" | "session" | "unresolved";

/** Where an agent definition was discovered. */
export type AgentDefinitionSource = "builtin" | "user" | "project";

export interface AgentModelAssignment {
	name: string;
	source: AgentDefinitionSource;
	declaredModel: string | null;
	effectiveModel: string | null;
	effectiveSource: AgentEffectiveSource;
	reason: string;
}

export interface ModelRoleSnapshot {
	global: ModelRoleLayer;
	project: ModelRoleLayer | null;
	agents: AgentModelAssignment[];
}

// ---- D — bulk model replace (全局批量替换模型) ----
// Mirrors `src-tauri/src/model_replace.rs` (serde camelCase; tagged enums use `kind`).

export type ModelRefScope = "global" | "project";

/** Where one stored model reference lives. */
export type ModelRefLocation =
	| { kind: "role"; scope: ModelRefScope; projectPath: string | null; name: string }
	| { kind: "agentOverride"; scope: ModelRefScope; projectPath: string | null; name: string }
	| { kind: "appSetting"; field: "newSessionModel" | "sideChatModel" | "doctorModel" }
	| { kind: "schedule"; id: string; name: string };

/** One stored value (never pre-filtered by the source model). */
export interface ModelUsageRef {
	location: ModelRefLocation;
	/** Raw stored value; comma lists kept as-is, YAML sequences joined with ",". */
	value: string;
	/** Schedule only (thinking column); null otherwise. */
	thinking: string | null;
}

export interface FallbackChainsSnapshot {
	/** Global `retry.fallbackChains`; `{}` when absent. */
	chains: Record<string, string[]>;
}

export interface ScannedProject {
	path: string;
	name: string;
	status: "ok" | "missing" | "error";
	error: string | null;
}

export interface ModelUsageScan {
	refs: ModelUsageRef[];
	fallbackChains: FallbackChainsSnapshot;
	/** omp unavailable etc.; chains are `{}` when set. */
	fallbackChainsError: string | null;
	projects: ScannedProject[];
}

/** One chain-key change; null = key absent (create) / delete. */
export interface ChainChange {
	key: string;
	before: string[] | null;
	after: string[] | null;
}

export type ModelReplaceEdit =
	| {
			kind: "value";
			location: ModelRefLocation;
			before: string;
			after: string;
			/** Meaningful for schedules only; null/null elsewhere. */
			thinkingBefore: string | null;
			thinkingAfter: string | null;
	  }
	| {
			kind: "fallbackChain";
			/** Original chain key, for display. */
			label: string;
			changes: ChainChange[];
	  };

export interface ModelReplaceItemResult {
	edit: ModelReplaceEdit;
	ok: boolean;
	error: string | null;
}

export interface ModelReplaceResult {
	/** null when nothing succeeded and no record was appended to. */
	recordId: string | null;
	results: ModelReplaceItemResult[];
}

export interface ModelReplaceRecord {
	id: string;
	createdAt: string;
	fromModel: string;
	toModel: string;
	/** Successful edits only. */
	edits: ModelReplaceEdit[];
	undoneAt: string | null;
}

export interface ModelProbeResult {
	ok: boolean;
	latencyMs: number;
	/** Full, untruncated outcome text (ANSI and box-drawing frames stripped). */
	detail: string;
}

/** How `model_probe` exercises a selector: chat one-shot, web search, or judge request. */
export type ModelProbeKind = "chat" | "search" | "judge";

// ---- 系统提示词构成 (prompt_composition.rs) ----

export type PromptCategoryId = "system" | "rules" | "skills" | "tools" | "mcp" | "other";

export interface PromptItem {
	id: string;
	title: string;
	/** Secondary line (e.g. MCP server). */
	detail: string | null;
	/** Raw text as omp sends it. */
	text: string;
	/** Estimated tokens. */
	tokens: number;
}

export interface PromptCategory {
	id: PromptCategoryId;
	label: string;
	tokens: number;
	items: PromptItem[];
}

export interface PromptHint {
	id: string;
	kind:
		| "largest"
		| "duplicate"
		| "big_skill"
		| "skills_total"
		| "big_rule"
		| "rules_total"
		| "mcp_always"
		| "big_mcp_tool";
	severity: "info" | "warn";
	title: string;
	detail: string;
	itemIds: string[];
	/** Full quoted text (duplicate paragraph). */
	quote: string | null;
}

/** What a brand-new empty session in `cwd` carries in its context. */
export interface PromptComposition {
	cwd: string;
	categories: PromptCategory[];
	/** Sum of the estimated category totals. */
	totalTokens: number;
	/** omp's own `contextUsage.tokens` for the empty session (reference only). */
	reportedTokens: number | null;
	contextWindow: number | null;
	hints: PromptHint[];
	probeMs: number;
	/** How `tokens` are estimated; shown verbatim. */
	estimateNote: string;
}

/** One row of `omp models --kind all --json`. */
export interface ModelKindEntry {
	/** `provider/id`, exactly as config values reference it. */
	selector: string;
	/** omp catalog kind: chat | tiny | search | judge | image | tts | stt | embedding | rerank | video | … */
	kind: string;
	provider: string;
	name: string | null;
	/** Thinking levels the catalog says this model supports (omp `thinking`); empty = no thinking control. */
	thinking: string[];
}

/** Return value of `app_paths`. */
export interface AppPaths {
	dataDir: string;
	globalDir: string;
}

export interface Model {
	provider: string;
	id: string;
	name: string;
	/** Thinking levels this model supports (omp `thinking` array); empty when unsupported. */
	thinking?: string[];
	/** Context window in tokens from `omp models --json`; null when unknown. */
	contextWindow?: number | null;
	/** `reasoning` from `omp models --json`: can think even with no levels configured; null/absent = unknown. */
	reasoning?: boolean | null;
}

/** models.yml `providers.<providerId>.modelOverrides.<modelId>.contextWindow`; null deletes. */
export interface ModelContextWindowEdit {
	providerId: string;
	modelId: string;
	contextWindow: number | null;
}

export interface PathCheck {
	exists: boolean;
	isDir: boolean;
	/** File size in bytes (0 for directories / missing paths). */
	size: number;
}

export interface DirEntry {
	name: string;
	path: string;
	isDir: boolean;
	isSymlink: boolean;
	size: number;
	readonly: boolean;
}

/** OMP API protocol string, verbatim (e.g. openai-completions). */
export type ProviderApi = string;

/** A model specification with optional limits and display name. */
export interface ModelSpec {
	id: string;
	name?: string | null;
	contextWindow?: number | null;
	maxTokens?: number | null;
}

export interface DiscoveredModel {
	id: string;
	name?: string | null;
}

/** A provider model entry: bare id or a spec with per-model limits. */
export type ModelEntry = string | ModelSpec;

export type ProviderKeyKind =
	| "encrypted"
	| "vaultMissing"
	| "plaintext"
	| "envVar"
	| "command"
	| "oauth"
	| "loginStored"
	| "none"
	| "missing";

export interface ProviderKeyState {
	kind: ProviderKeyKind;
	envVar: string | null;
	envSet: boolean | null;
}

/** custom: models.yml block with baseUrl; override: block without baseUrl over a built-in; builtin: no block. */
export type ProviderOrigin = "custom" | "override" | "builtin";

/** One OMP provider as shown in Settings (non-secret). */
export interface ProviderRow {
	id: string;
	displayName: string | null;
	slug: string;
	origin: ProviderOrigin;
	sources: string[];
	baseUrl: string | null;
	api: string | null;
	models: ModelEntry[];
	key: ProviderKeyState;
	enabled: boolean;
	testable: boolean;
	/** Built-in default endpoint; null for custom providers. */
	defaultBaseUrl: string | null;
	/** `models` listed in this provider's models.yml block. */
	extraModels: ModelEntry[];
	/** Block has `auth: none`, or keyless local engine without a block. */
	authNone: boolean;
}

export type KeyMode = "plaintext" | "encrypted";

export interface ProviderUpsert {
	originalId: string | null;
	id: string;
	displayName: string | null;
	baseUrl: string;
	api: string;
	models: ModelEntry[];
	authNone: boolean;
}

export interface BuiltinOverride {
	id: string;
	baseUrl: string | null;
	authNone: boolean;
	extraModels: ModelEntry[];
}

export interface ProviderBulkResult {
	id: string;
	ok: boolean;
	error: string | null;
}

/** Result of `provider_test`. */
export interface ProviderTestResult {
	ok: boolean;
	latencyMs: number;
	detail: string;
}


/** Provider supported for OAuth/account login via `omp --mode rpc`. */
export interface OauthLoginProvider {
	id: string;
	name: string;
	available: boolean;
	authenticated: boolean;
}

export type OauthUiEventKind =
	| "started"
	| "openUrl"
	| "needsInput"
	| "notify"
	| "ui"
	| "cancelledRequest"
	| "completed";

/** Event emitted during OAuth login flow via `providers:oauth`. */
export interface OauthUiEvent {
	kind: OauthUiEventKind;
	providerId: string;
	url?: string | null;
	launchUrl?: string | null;
	instructions?: string | null;
	requestId?: string | null;
	method?: string | null;
	title?: string | null;
	placeholder?: string | null;
	timeoutMs?: number | null;
	message?: string | null;
	ok?: boolean | null;
	error?: string | null;
}

/** Snapshot returned by `oauth_login_status`. */
export interface OauthLoginStatus {
	active: boolean;
	providerId?: string;
	kind?: string;
	url?: string | null;
	launchUrl?: string | null;
	instructions?: string | null;
	requestId?: string | null;
	method?: string | null;
	title?: string | null;
	placeholder?: string | null;
	timeoutMs?: number | null;
	message?: string | null;
	ok?: boolean | null;
	error?: string | null;
	[key: string]: unknown;
}


export interface OmpUsageLimit {
	id: string;
	label: string;
	scope?: {
		provider?: string;
		projectId?: string;
		accountId?: string;
		orgId?: string;
		tier?: string;
		windowId?: string;
		shared?: boolean;
		sharedGroup?: string;
	};
	window?: {
		id: string;
		label: string;
		durationMs: number;
		resetsAt: number;
	};
	amount: {
		unit: string;
		used?: number;
		limit?: number;
		remaining?: number;
		usedFraction?: number;
		remainingFraction?: number;
	};
	status?: string;
}

export interface OmpUsageResetCredit {
	id: string;
	title: string;
	program?: string;
	remainingCount: number;
	usable: boolean;
	expiresAt?: string;
	status?: string;
}

export interface OmpUsageProviderReport {
	provider: string;
	fetchedAt: number;
	limits: OmpUsageLimit[];
	notes?: string[];
	metadata?: {
		email?: string;
		accountId?: string;
		orgId?: string;
		orgName?: string;
		planType?: string;
		planEnd?: number;
		overageBalanceUsd?: number;
		projectId?: string;
		source?: string;
		endpoint?: string;
	};
	resetCredits?: {
		availableCount: number;
		redeemableCount?: number;
		nextCreditId?: string;
		eligible?: boolean;
		credits?: OmpUsageResetCredit[];
	};
}

export interface OmpUsageAccountWithoutUsage {
	provider: string;
	type?: string;
	enterpriseUrl?: string;
	authorizedAt?: number;
}

export interface OmpUsageCapacityWindow {
	window: string;
	durationMs: number;
	accounts: number;
	usedAccounts: number;
	remainingAccounts: number;
}

export interface OmpUsageReportData {
	generatedAt: number;
	reports: OmpUsageProviderReport[];
	accountsWithoutUsage?: OmpUsageAccountWithoutUsage[];
	disabledCredentials?: unknown[];
	capacity?: Record<string, OmpUsageCapacityWindow[]>;
}

// ---- D: model templates + quota switching (角色模板与额度自动切换) ----

/** `"global"` or the absolute path of a project directory (`<project>/.omp/config.yml`). */
export type ModelTemplateScope = string;

/** Role -> selector; `null` = delete that role on apply (restore inheritance). */
export type ModelTemplateRoles = Record<string, string | null>;

export interface ModelTemplate {
	id: string;
	name: string;
	/** `"global"` or an absolute project directory. */
	scope: ModelTemplateScope;
	roles: ModelTemplateRoles;
	isBottomLine: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface ModelTemplateInput {
	/** `null` = create. */
	id: string | null;
	name: string;
	/** Required on create; ignored on update (a template never changes scope). */
	scope: ModelTemplateScope;
	roles: ModelTemplateRoles;
	isBottomLine: boolean;
}

export interface ModelSwitchRule {
	id: string;
	name: string;
	enabled: boolean;
	/** `"global"` or an absolute project directory; the target template has the same scope. */
	scope: ModelTemplateScope;
	/** Usage-side slug, e.g. `anthropic`. */
	provider: string;
	/** Window key as reported, e.g. `5h`. */
	windowKey: string;
	/** 0..=100. */
	thresholdPct: number;
	templateId: string;
	autoRevert: boolean;
	revertThresholdPct: number | null;
	sort: number;
	createdAt: string;
	updatedAt: string;
}

export interface ModelSwitchRuleInput {
	id: string | null;
	name: string;
	enabled: boolean;
	scope: ModelTemplateScope;
	provider: string;
	windowKey: string;
	thresholdPct: number;
	templateId: string;
	autoRevert: boolean;
	revertThresholdPct: number | null;
}

export interface TemplateRoleEdit {
	role: string;
	before: string | null;
	after: string | null;
}

export interface SessionSwitchResult {
	sessionId: string;
	title: string;
	ok: boolean;
	reason: string;
}

export interface ModelSwitchLogEntry {
	id: string;
	createdAt: string;
	ruleId: string | null;
	ruleName: string | null;
	templateId: string;
	templateName: string;
	/** Scope the switch wrote to. */
	scope: ModelTemplateScope;
	/** applied | partial | refused | skipped | reverted | undone | failed */
	status: string;
	reason: string;
	edits: TemplateRoleEdit[];
	previousTemplateId: string | null;
	sessionResults: SessionSwitchResult[];
	undoneAt: string | null;
}

export interface ProjectOverride {
	path: string;
	name: string;
	roles: string[];
}

export interface PreflightVerdict {
	/** ok | partial | blocked */
	level: string;
	defaultProvider: string | null;
	/** available | exhausted | unmapped | unknown */
	providerState: string;
	degradedRoles: string[];
	message: string;
}

export interface TemplatePreview {
	scope: ModelTemplateScope;
	/** Absolute path of the config file that would be written. */
	configPath: string;
	/** The file (and its `.omp/` directory) does not exist yet and apply creates it. */
	willCreateFile: boolean;
	edits: TemplateRoleEdit[];
	unchanged: string[];
	/** Roles present in the layer but not declared by the template (kept as-is on apply). */
	notInTemplate: string[];
	/** Project configs that shadow the template; only filled for the global scope. */
	projectOverrides: ProjectOverride[];
	preflight: PreflightVerdict;
}

export interface SwitchResult {
	logId: string;
	status: string;
	reason: string;
	edits: TemplateRoleEdit[];
	sessionResults: SessionSwitchResult[];
}

export interface RuleValidation {
	errors: string[];
	warnings: string[];
}

/** Poll interval in seconds; 600 by default, clamped to 60..=86400. */
export interface SwitchSettings {
	pollIntervalSecs: number;
}

export interface CurrentTemplateState {
	scope: ModelTemplateScope;
	templateId: string | null;
	templateName: string | null;
	/** Roles whose current config value differs from what the template wrote. */
	driftedRoles: string[];
	logId: string | null;
}

export interface WindowStatus {
	key: string;
	label: string;
	usedPct: number;
	resetsAt: number | null;
}

export interface ProviderStatus {
	usageSlug: string;
	modelProvider: string | null;
	/** available | exhausted | unmapped */
	state: string;
	windows: WindowStatus[];
	accounts: number;
	exhaustedAccounts: number;
}

export interface BlockedNotice {
	scope: ModelTemplateScope;
	at: number;
	message: string;
	providers: string[];
}

export interface SwitchStatus {
	lastCheckAt: number | null;
	lastError: string | null;
	checking: boolean;
	pollIntervalSecs: number;
	nextCheckAt: number | null;
	providers: ProviderStatus[];
	blocked: BlockedNotice | null;
}

export interface TemplateStoreSnapshot {
	templates: ModelTemplate[];
	rules: ModelSwitchRule[];
	log: ModelSwitchLogEntry[];
	settings: SwitchSettings;
	/** One entry per scope that has a template, rule or log row, plus `global`. */
	currents: CurrentTemplateState[];
	conflicts: RuleConflict[];
}

export interface RuleConflict {
	scope: ModelTemplateScope;
	/** self-eating | mutual-escape | no-bottom-line */
	kind: string;
	message: string;
	ruleIds: string[];
}

// ---- E: Schedules (定时任务) ----

export type ScheduleRunMode = "local" | "worktree";

export type ScheduleCadence =
	/** Every `minutes` minutes (UI offers minute/hour units). */
	| { kind: "interval"; minutes: number }
	/**
	 * `weekdays` empty/absent: every `every` days (default 1) at local `time`.
	 * `weekdays` non-empty: every `every` weeks (default 1) on those weekdays (same
	 * numbering as before) at `time`. `anchor` = local date YYYY-MM-DD that fixes the
	 * day/week phase when `every` > 1; backend fills today's local date when missing.
	 */
	| { kind: "daily"; time: string; weekdays?: number[]; every?: number; anchor?: string }
	/** One-shot at an absolute instant (RFC3339 UTC). */
	| { kind: "once"; at: string }
	/**
	 * Every `every` months (default 1) on `day` (1-31, clamped to the month's length) at
	 * local `time` (HH:MM). `anchor` (local date) fixes the month phase when `every` > 1.
	 */
	| { kind: "monthly"; day: number; time: string; every?: number; anchor?: string };

export type ScheduleLifecycle = "active" | "paused" | "completed";

/**
 * Which runs create an inbox entry: `all` = every finished run; `important` = failed
 * runs and runs that stopped to ask for approval/an answer; `none` = never.
 */
export type ScheduleNotify = "all" | "important" | "none";

export type ScheduleRunStatus = "running" | "ok" | "error" | "skipped";

export interface Schedule {
	id: string;
	name: string;
	prompt: string;
	cwd: string;
	runMode: ScheduleRunMode;
	cadence: ScheduleCadence;
	model: string | null;
	thinking: string | null;
	approvalMode: string | null;
	enabled: boolean;
	nextRunAt: string | null;
	lastRunAt: string | null;
	/** Status of the most recent run (derived from schedule_runs). */
	lastRunStatus: ScheduleRunStatus | null;
	createdAt: string;
	updatedAt: string;
	/** Stop repeating after this instant (RFC3339 UTC); null = never. */
	endAt: string | null;
	/**
	 * Derived by the backend: `completed` = a `once` schedule that already ran, or a
	 * recurring one past `endAt`; `paused` = disabled but not completed; else `active`.
	 */
	lifecycle: ScheduleLifecycle;
	/** Stop after this many runs; null = unlimited. */
	maxRuns: number | null;
	/** Runs started so far (counts toward `maxRuns`). */
	runsDone: number;
	notify: ScheduleNotify;
	newChatEachRun: boolean;
}

export interface ScheduleDraft {
	id?: string;
	name: string;
	prompt: string;
	cwd: string;
	runMode?: ScheduleRunMode;
	cadence: ScheduleCadence;
	model?: string | null;
	thinking?: string | null;
	approvalMode?: string | null;
	enabled?: boolean;
	/** Stop repeating after this instant (RFC3339 UTC); null/absent = never. Ignored for `once`. */
	endAt?: string | null;
	/** Stop after this many runs (>=1); null/absent = unlimited. Ignored for `once`. */
	maxRuns?: number | null;
	/** Inbox policy per run; absent = backend default `all`. */
	notify?: ScheduleNotify;
	/** false = reuse the previous run's session when resumable; absent = true. */
	newChatEachRun?: boolean;
}

export interface ScheduleRun {
	id: string;
	scheduleId: string;
	sessionId: string | null;
	status: ScheduleRunStatus;
	startedAt: string;
	finishedAt: string | null;
	summary: string | null;
}

// ---- Skills & Extensions ----

export type SkillIssue =
	| "missing_description"
	| "description_too_long"
	| "unreadable"
	| "missing_skill_md";


/** Which agent ecosystem's discovery root the skill was found in. */
export type SkillProvider =
	| "native"
	| "claude"
	| "agents"
	| "codex"
	| "github"
	| "managed";
export interface SkillItem {
	name: string;
	description: string;
	source: string;
	path: string;
	dir: string;
	/** Display install root, home-abbreviated (e.g. "~/.omp/agent/skills", "./.omp/skills"). */
	root: string;
	/** How many discovery roots contain a skill with this same name (>=1); the listed one wins by precedence. */
	copies: number;
	/** Agent ecosystem of the discovery root (independent of `source`). */
	provider: SkillProvider;
	/** Empty = healthy. */
	issues: SkillIssue[];
	/** name + description char count (+4): estimate of resident system-prompt cost. */
	promptChars: number;
}

export interface SkillUsage {
	name: string;
	count: number;
	/** ISO-8601 timestamp of the last trigger, null when never triggered. */
	lastUsedAt: string | null;
}

export interface SkillUsageReport {
	days: number;
	totalTriggers: number;
	scannedFiles: number;
	usage: SkillUsage[];
}

export interface ExtensionItem {
	name: string;
	path: string;
	source: string;
	enabled: boolean;
}

export interface SkillsCatalog {
	skills: SkillItem[];
	extensions: ExtensionItem[];
}

// ---- D — MCP server + plugin settings (omp-managed config files) ----

/** env/header entry; `value` is null when masked as a likely secret. */
export interface McpKv {
	key: string;
	value: string | null;
	masked: boolean;
}

export interface McpServerItem {
	name: string;
	transport: "stdio" | "http" | "sse" | string;
	command: string | null;
	args: string[];
	url: string | null;
	cwd: string | null;
	timeoutMs: number | null;
	instructions: boolean;
	enabled: boolean;
	shadowed: boolean;
	denylisted: boolean;
	allowlisted: boolean;
	env: McpKv[];
	headers: McpKv[];
	hasAuth: boolean;
	hasOauth: boolean;
	sourceFile: string;
	scope: "user" | "project" | string;
	error: string | null;
}

export interface McpFileInfo {
	path: string;
	scope: "user" | "project" | string;
	exists: boolean;
	parseError: string | null;
	disabledServers: string[];
	enabledServers: string[];
}

export interface McpConfigSnapshot {
	/** Where "add server" writes by default (user-level mcp.json). */
	defaultWritePath: string;
	files: McpFileInfo[];
	servers: McpServerItem[];
}

/** Add/update payload for `mcp_server_upsert`; `null` deletes a key, env/headers merge per key. */
export type McpServerPatch = Record<string, unknown>;

export interface PluginItem {
	name: string;
	spec: string | null;
	version: string | null;
	description: string | null;
	hasManifest: boolean;
	kind: "npm" | "link" | "marketplace" | "unknown" | string;
	scope: "user" | "project" | string;
	enabled: boolean;
	projectDisabled: boolean;
	enabledFeatures: string[] | null;
	dir: string | null;
}

export interface PluginRootInfo {
	dir: string;
	scope: string;
	lockPath: string;
	lockExists: boolean;
}

export interface PluginCatalog {
	roots: PluginRootInfo[];
	plugins: PluginItem[];
}

/** Return value of `omp_info`: resolved omp binary, `omp --version`, agent dir paths. */
export interface OmpInfo {
	found: boolean;
	resolvedPath: string;
	/** First line of `omp --version` (e.g. "omp/18.4.4"); null when unavailable. */
	version: string | null;
	agentDir: string;
	/** `<agentDir>/config.yml` */
	configPath: string;
	configExists: boolean;
}

/** Return value of `omp_update_check`: parsed `omp update --check`. */
export interface OmpUpdateStatus {
	current: string | null;
	latest: string | null;
	updateAvailable: boolean;
	/** ANSI-stripped command output. */
	output: string;
}

/** Return value of `rpc_omp_staleness`: which live sessions run an outdated omp binary. */
export interface OmpStaleness {
	/** Opaque identity (path + mtime + size) of the omp binary new spawns would use; null if unresolvable. */
	fingerprint: string | null;
	/** Live sessions whose spawn-time fingerprint differs from `fingerprint`. */
	staleSessionIds: string[];
}

/** Return value of `omp_update_run`. */
export interface OmpUpdateResult {
	success: boolean;
	output: string;
	/** First line of `omp --version` after the update. */
	versionAfter: string | null;
}

/** Return value of `omp_install_run`: official installer run, `info` re-probed afterwards. */
export interface OmpInstallResult {
	success: boolean;
	/** ANSI-stripped full log; on failure ends with a plain Chinese hint. */
	output: string;
	info: OmpInfo;
}

/** Event `omp:install` payload while the installer runs. */
export interface OmpInstallProgress {
	/** One ANSI-stripped output line. */
	line: string | null;
	/** Size of the in-progress `.omp.download.*` file in the install dir. */
	downloadedBytes: number | null;
}

// --- storage (设置 ▸ 存储空间) ---
export interface StorageGcSummary {
	count: number;
	bytes: number;
}
export interface StorageStatusUsage {
	count: number;
	bytes: number;
	expiredCount: number;
	expiredBytes: number;
}
export interface StorageOverview {
	images: StorageGcSummary;
	webCacheBytes: number;
	status: StorageStatusUsage;
	dbBytes: number;
	imageDirs: string[];
}
export interface StorageCompactResult {
	beforeBytes: number;
	afterBytes: number;
}
export interface StorageSessionRow {
	id: string;
	title: string;
	updatedAt: string;
	bytes: number;
	pinned: boolean;
	/** Non-null ⇒ cannot be deleted from the storage page. */
	skipReason: string | null;
}
export interface StorageProjectRow {
	dir: string;
	name: string;
	cwd: string | null;
	bytes: number;
	sessions: StorageSessionRow[];
}
export interface StorageSessionsOverview {
	root: string;
	totalBytes: number;
	sessionCount: number;
	projects: StorageProjectRow[];
}
export interface StorageStalePreview {
	count: number;
	bytes: number;
	ids: string[];
}
export interface StorageTrashReport {
	trashed: number;
	freedBytes: number;
	skipped: { id: string; reason: string }[];
}
