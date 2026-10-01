/**
 * TS mirror of src-tauri/src/contracts.rs (docs/ARCHITECTURE.md §4).
 * Fields are camelCase; enum values are snake_case string unions.
 */

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
	status: SessionStatus;
	unread: boolean;
	pending: PendingKind | null;
	live: boolean;
	externalPid: number | null;
	pinned: boolean;
	archived: boolean;
	/** Resolved membership; null = 未归档. */
	workspaceId: string | null;
	repoRoot: string | null;
	git: GitBadge | null;
	result: ResultBadge | null;
	lastAssistant: string | null;
	model: string | null;
}

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
}

export interface TranscriptPage {
	sessionId: string;
	items: TranscriptItem[];
	/** Byte offset for incremental reads. */
	nextOffset: number;
	reset: boolean;
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
	| "suggestion"
	| "service_left"
	/** A scheduled-task run finished; payload: {"scheduleId","runId","ok":bool}. */
	| "schedule_run";

/** `schedule` rows are always visible (not gated by system/supervisor switches). */
export type TodoSource = "system" | "supervisor" | "schedule";

export type TodoStatus = "open" | "done" | "ignored";

export interface Todo {
	id: string;
	kind: TodoKind;
	source: TodoSource;
	status: TodoStatus;
	sessionId: string | null;
	title: string;
	detail: string;
	/** Approval/Question: {uiRequest}; Suggestion: {action}. */
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

export type BacklogKind = "idea" | "bug" | "todo";

export type BacklogStatus = "inbox" | "dispatched" | "done" | "closed";

export interface BacklogRef {
	/** "session" | "file" | "annotation" */
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
	createdAt: string;
	updatedAt: string;
}

/** Patch for `backlog_update`. */
export interface BacklogPatch {
	text?: string;
	kind?: BacklogKind;
	status?: BacklogStatus;
	targetSessionId?: string;
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
	/** Files written back to their pre-turn content. */
	restored: string[];
	/** Files removed because the turn created them. */
	deleted: string[];
	/** Files changed after the turn ended; non-empty means nothing was touched (force=false). */
	conflicts: string[];
	/** HEAD moved back to headBefore (the turn's commits left the history). */
	headReset: boolean;
	/** Plain-Chinese note for the user, e.g. why history was left alone. */
	warning: string | null;
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

export interface PairingInfo {
	url: string;
	qrSvg: string;
	expiresAt: string;
}

export interface MobileStatus {
	running: boolean;
	port: number;
	lanUrl: string | null;
	tunnelUrl: string | null;
	cloudflaredInstalled: boolean;
}

export interface UsageSummary {
	available: boolean;
	tokens: number;
	cost: number;
	/** "token-tracker" | "transcript" */
	source: string;
}

export interface Settings {
	systemDetection: boolean;
	supervisorEnabled: boolean;
	/** Passed as --model. */
	supervisorModel: string;
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
	quickCaptureShortcut: string;
	/** 0 = manual refresh only. */
	supervisorIntervalMinutes: number;
	/** "HH:MM" quiet-hours window; null or half-open pair = off. */
	notifyQuietFrom: string | null;
	notifyQuietTo: string | null;
	/** Default model for new sessions (stored for future use). */
	newSessionModel: string | null;
	homeShowCompletedTodos: boolean;
	dockBadgeEnabled: boolean;
	sessionTurnAutoRefresh: boolean;
	/**
	 * Turn checkpoints for app-launched sessions (loads the checkpoints extension
	 * via `-e`). null = never asked (Git panel shows the consent card).
	 */
	turnCheckpoints: boolean | null;
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

/** Return value of `app_paths`. */
export interface AppPaths {
	dataDir: string;
	globalDir: string;
}

export interface Model {
	provider: string;
	id: string;
	name: string;
}

export interface PathCheck {
	exists: boolean;
	isDir: boolean;
}

export interface DirEntry {
	name: string;
	path: string;
	isDir: boolean;
	isSymlink: boolean;
	size: number;
	readonly: boolean;
}

/** API protocol used to talk to a provider. */
export type ProviderApi =
	| "openai_completions"
	| "openai_responses"
	| "anthropic"
	| "gemini"
	| "ollama";

/** A model specification with optional limits and display name. */
export interface ModelSpec {
	id: string;
	name?: string | null;
	contextWindow?: number | null;
	maxTokens?: number | null;
}

/** A provider model entry: bare id or a spec with per-model limits. */
export type ModelEntry = string | ModelSpec;

/** Provider metadata (non-secret). Secrets live only in the backend vault. */
export interface ProviderConfig {
	id: string;
	name: string;
	/** Stable identifier [A-Za-z0-9_-]+; the vault line key derives from it. */
	slug: string;
	/** Frontend preset this provider was created from, if any. */
	presetId: string | null;
	baseUrl: string;
	api: ProviderApi;
	/** Env var injected into child processes (e.g. ANTHROPIC_API_KEY). */
	envVar: string;
	models: ModelEntry[];
	defaultModel: string | null;
	defaultContextWindow: number | null;
	defaultMaxTokens: number | null;
	enabled: boolean;
	sort: number;
	/** True when an encrypted key exists in the vault for this slug. */
	hasKey: boolean;
	/** Last 4 chars of the key, stored at save time for display. */
	keyHint: string | null;
	notes: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Result of `provider_test`. */
export interface ProviderTestResult {
	ok: boolean;
	latencyMs: number;
	detail: string;
}

/** Provider configured in OMP's own config (~/.omp/agent/models.yml, agent.db, etc.) */
export interface OmpProviderInfo {
	id: string;
	sources: string[];
	baseUrl: string | null;
	api: string | null;
	hasApiKey: boolean;
	apiKeyEnv: string | null;
	modelIds: string[];
	credentialTypes: string[];
	accounts: string[];
	usedInRoles: string[];
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

/** Result of batch-importing OMP provider keys into workbench vault. */
export interface OmpImportResult {
	id: string;
	ok: boolean;
	error: string | null;
}

// ---- E: Schedules (定时任务) ----

export type ScheduleRunMode = "local" | "worktree";

export type ScheduleCadence =
	| { kind: "interval"; minutes: number }
	| { kind: "daily"; time: string; weekdays?: number[] };

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
	| "unreadable";


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
