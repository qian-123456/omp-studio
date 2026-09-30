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
}

export interface TranscriptPage {
	sessionId: string;
	items: TranscriptItem[];
	/** Byte offset for incremental reads. */
	nextOffset: number;
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
	| "service_left";

export type TodoSource = "system" | "supervisor";

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

export interface WorktreeInfo {
	path: string;
	branch: string | null;
	head: string;
	/** Number of uncommitted changes (0 = clean). */
	dirty: number;
	sessionIds: string[];
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
