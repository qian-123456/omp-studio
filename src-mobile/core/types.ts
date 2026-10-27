/** Shared wire/view types of the phone app. Mirrors src-tauri `contracts.rs` (camelCase over the wire). */

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

export type PendingKind = "approval" | "answer" | string;

/** Space mode of a session (`GET /left/sessions?mode=`). */
export type SpaceMode = "code" | "work" | "study" | "research" | "chat";

/** One row of `GET /api/sessions` (MobileSession) plus optional fields merged in from session PATCH/tree responses. */
export interface MobileSession {
	id: string;
	label: string;
	title: string;
	status: SessionStatus;
	pending?: PendingKind | null;
	updatedAt: string;
	cwd: string;
	live: boolean;
	lastAssistant?: string | null;
	pinned?: boolean;
	archived?: boolean;
	customName?: string | null;
	mode?: SpaceMode;
	workspaceId?: string | null;
}

/** `mobile-draft-*` ids are process-free drafts handed off to a real id on the first prompt. */
export const DRAFT_PREFIX = "mobile-draft-";
export const isDraftId = (id: string | null | undefined): boolean => !!id && id.startsWith(DRAFT_PREFIX);

export const STATUS_LABEL: Record<string, string> = {
	working: "运行中",
	awaiting_approval: "待批准",
	awaiting_answer: "待回复",
	review: "待验收",
	idle: "空闲",
	error: "错误",
	interrupted: "已中断",
	suspended: "已挂起",
	external: "外部进程",
};

/* ---------------------------------------------------------------- transcript */

/** `ImageAttachment` (contracts.rs): a reference, never bytes. */
export interface RawImage {
	id?: string;
	marker?: string;
	path?: string;
	mimeType?: string;
	width?: number;
	height?: number;
}

export interface RawToolCall {
	id: string;
	name: string;
	args?: unknown;
	intent?: string | null;
}

export interface RawToolResult {
	toolCallId: string;
	toolName?: string;
	text?: string;
	isError?: boolean;
}

/** `TranscriptItem` as served by `GET /sessions/{id}/transcript`. `kind` is snake_case. */
export interface TranscriptItem {
	id: string;
	kind: string;
	text?: string;
	thinking?: string;
	ts?: string | null;
	hidden?: boolean;
	toolCalls?: RawToolCall[];
	toolResult?: RawToolResult | null;
	images?: RawImage[];
	usage?: unknown;
	model?: string | null;
}

export interface TranscriptPage {
	sessionId?: string;
	items: TranscriptItem[];
	nextOffset?: number;
	tailId?: string | null;
	reset?: boolean;
}

export type ItemRole = "user" | "assistant" | "system";
export type ToolStatus = "running" | "done" | "error";

export interface ToolItem {
	id: string;
	name: string;
	args: unknown;
	intent?: string | null;
	status: ToolStatus;
	result: string;
}

/** Image reference carried by a message (no bytes: the mobile API does not serve them). */
export interface ImageRef {
	id: string;
	mime: string;
	path: string;
	marker: string;
	width: number | null;
	height: number | null;
}

/** Normalized chat row (CONTRACT §4 of mobile-skins). */
export interface Item {
	id: string;
	role: ItemRole;
	kind: string;
	text: string;
	thinking: string;
	tools: ToolItem[];
	images: ImageRef[];
	ts: string | null;
	streaming: boolean;
	usage?: unknown;
	model?: string | null;
}

/* ---------------------------------------------------------------- pending ui */

/** One `GET /sessions/{id}/pending-ui` entry. */
export interface PendingEntry {
	sessionId?: string;
	request?: PendingRequest;
	receivedAt?: string;
	[k: string]: unknown;
}

export interface PendingRequest {
	id?: string;
	type?: string;
	method?: string;
	title?: string;
	message?: string;
	placeholder?: string;
	options?: unknown[];
	optionDetails?: { description?: string }[];
	required?: boolean;
	allowEmpty?: boolean;
	default?: string;
	defaultValue?: string;
	[k: string]: unknown;
}

export interface PendingOption {
	raw: string;
	label: string;
	recommended: boolean;
	isDone: boolean;
	isOther: boolean;
	description: string;
}

export interface PendingForm {
	id: string;
	method: string;
	title: string;
	message: string;
	placeholder: string;
	required: boolean;
	defaultValue: string;
	options: PendingOption[];
	/** "(N selected)" prefix of a multi-select loop. */
	selectedCount: number;
	/** "(i/n)" suffix of an ask question sequence. */
	index: number | null;
	total: number | null;
	multiple: boolean;
	/** input/editor request (free text). */
	text: boolean;
	sessionId: string | null;
}

/* ---------------------------------------------------------------- misc */

export type ConnectionPhase = "idle" | "connecting" | "open" | "closed" | "unauthorized";

/** Live RPC frame forwarded by the `rpc` SSE event. */
export interface RpcFrame {
	type: string;
	isTerminal?: boolean;
	awaitingAsyncWork?: boolean;
	message?: { role?: string; content?: unknown; text?: string } | null;
	toolCallId?: string;
	toolName?: string;
	args?: unknown;
	isError?: boolean;
	result?: { content?: { type?: string; text?: string }[] } | null;
	[k: string]: unknown;
}
