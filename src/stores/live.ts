/**
 * Per-session live RPC state (§11 B). [B]
 * Reduces `rpc:frame` / `rpc:process` events into per-session state:
 * streaming flag, last get_state snapshot, pending UI dialogs, subagents,
 * in-flight assistant message, slash commands, live tool executions,
 * and a transcript cache shared with the heatmap.
 */

import { normalizeThinkContent } from "../lib/thinkTags";
import { isSideChatPrompt, sideChatPromptToDisplay } from "../features/chat/sideChatView";
import { resolveCurrentModel } from "../lib/models";
import {
	type FallbackInfo,
	loadRetryHistory,
	MAX_RETRY_EPISODES,
	modelLabel,
	type RetryEpisode,
	type RetryNotice,
	retryNoticeFromFrame,
	saveRetryHistory,
} from "./retryNotice";
import { createFrameBatcher, scheduleFlush } from "./frameBatch";
import {
	type PersistedRow,
	parseLocalRows,
	serializeLocalRows,
} from "../features/chat/localRows";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import type {
	ImageAttachment,
	PendingUiRequest,
	TranscriptItem,
} from "../lib/contracts";
import type {
	AgentProgress,
	SubagentInfo,
	SubagentLifecyclePayload,
	SubagentProgressPayload,
	SubagentStatus,
} from "../features/chat/subagents/types";
import type * as IpcModule from "../lib/ipc";
import {
	type RequestStat,
	requestStatFromMessage,
} from "../features/chat/requestStats";
import {
	onRpcFrame,
	onRpcProcess,
	onSessionsRemoved,
	type RpcFramePayload,
	type RpcProcessPayload,
} from "../lib/events";

/** Slash command advertised by omp via `get_available_commands` /
 * `available_commands_update` (RpcAvailableSlashCommand). */
export interface SlashCommand {
	name: string;
	aliases?: string[];
	description?: string;
	/** Real wire shape: `{input?: {hint?}}`. `hint` is a normalized mirror. */
	input?: { hint?: string };
	hint?: string;
	subcommands?: { name: string; description?: string; usage?: string }[];
	source?: string;
}

/** Slash-command output block — omp `command_output` frames or app-local
 * results (e.g. the /status card). Placed in the thread at its anchor by
 * withLocalRows and persisted per session (§6 `local_rows`); never part of
 * the transcript file. */
export interface CommandOutputEntry {
	id: number;
	/** Slash command name that produced it, when known. */
	command?: string;
	text: string;
	ts: number;
	kind: "omp" | "app";
	/** App-local command run state: a running row becomes its result in place. */
	status?: "running" | "done" | "error";
	/** Id of the last transcript item when the row was created (thread position). */
	anchorId?: string | null;
}

// Re-exported for existing consumers (TopCapsule).
export type { SubagentInfo } from "../features/chat/subagents/types";

export interface LiveTool {
	toolCallId: string;
	toolName: string;
	args: unknown;
	intent: string | null;
	status: "running" | "done" | "error";
	/** Concatenated text of the (partial) result. */
	text: string;
	details: unknown | null;
	/** Start time epoch ms */
	startedAt?: number;
	/** End time epoch ms */
	endedAt?: number;
}
/** Assistant/user message object as carried by message_* frames. */
export interface AgentMessage {
	role: string;
	customType?: string;
	content: unknown;
	display?: boolean;
	timestamp?: number;
	[key: string]: unknown;
}
/**
 * One completed model request (= one assistant message), recorded when its
 * `message_end` frame arrives. Carries the real per-request metrics omp
 * attaches to the message (`duration`, `ttft`, `usage`, `completedAt`).
 */
export interface LiveRequest {
	id: string;
	/** Ids of the toolCall parts in this message's content. */
	toolCallIds: string[];
	/** The message carried non-empty assistant text (the answer row). */
	hasText: boolean;
	/** The message's content in arrival order, so a live turn can keep the
	 * finished thinking / prose / tool rows where they happened. */
	parts: LiveRequestPart[];
	stat: RequestStat;
}

/** One ordered content part of a completed request. */
export type LiveRequestPart =
	| { kind: "thinking"; text: string; durationMs?: number }
	| { kind: "text"; text: string }
	| { kind: "tool"; id: string };

/**
 * Optimistic user bubble. `steer` marks an in-turn steer echo; `held` marks a
 * message sent while the session could not start a model request for it
 * (turn streaming, compaction/handoff running) — it counts as queued until
 * omp delivers it (`delivered`, from the user `message_start/end` frame).
 */
export type UserEcho = TranscriptItem & {
	steer?: boolean;
	held?: boolean;
	delivered?: boolean;
	/** Id of the last transcript item when the echo was sent (thread position). */
	anchorId?: string | null;
};

/** Compaction / handoff progress shown as a one-row divider in the thread. */
export type FlowNoticeKind = "compaction" | "handoff";
export interface FlowNotice {
	id: number;
	kind: FlowNoticeKind;
	status: "running" | "done" | "error";
	startedAt: number;
	endedAt?: number;
	/** Id of the last transcript item when it started: the divider sits after it. */
	anchorId: string | null;
	tokensBefore?: number;
	tokensAfter?: number;
	/** Error / "nothing to compact" explanation. */
	detail?: string;
}

/** omp's own queued user messages (`queue_update` / `get_state.queuedMessages`). */
export interface OmpQueue {
	steering: string[];
	followUp: string[];
}

export interface SessionLive {
	/** A turn is in flight. */
	streaming: boolean;
	/** Last get_state snapshot (from its `response` frame). */
	state: Record<string, unknown> | null;
	pendingUi: PendingUiRequest[];
	subagents: Record<string, SubagentInfo>;
	/** In-flight assistant message snapshot (message_update.message). */
	streamingMessage: AgentMessage | null;
	/** Optimistic user bubbles waiting for the transcript fetch to confirm
	 * them (rpc prompt accepted but not yet visible in the jsonl page). */
	pendingUserEchoes: UserEcho[];
	/** From available_commands_update / get_available_commands. */
	commands: SlashCommand[];
	/** Ephemeral slash-command outputs shown at the end of the thread. */
	commandOutputs: CommandOutputEntry[];
	/** Echoes of commands omp handled without writing a transcript item; they
	 * leave `pendingUserEchoes` and sit in the thread at their anchor (persisted). */
	localEchoes?: UserEcho[];
	/** Persisted local rows were merged into this session's state. */
	localRowsLoaded?: boolean;
	/** Retry / model-fallback rows of the turn in progress (live rows). */
	retryNotices?: RetryNotice[];
	/** Fallback switch of the turn in progress, undoable from its row. */
	retryFallback?: FallbackInfo;
	/** Finished turns' collapsed retry entries, oldest first (persisted). */
	retryHistory?: RetryEpisode[];
	retryHistoryLoaded?: boolean;
	/** Slash command last sent as a prompt; annotates command_output frames. */
	pendingCommand?: string | null;
	/** Live tool executions keyed by toolCallId (reset each turn). */
	tools: Record<string, LiveTool>;
	/** Transcript cache filled by SessionView; shared with HeatmapPanel. */
	items: TranscriptItem[];
	/** Byte offset for incremental transcript reads. */
	nextOffset: number;
	/** rpc:process liveness. */
	alive: boolean;
	/** Message scroll request queued for virtual list scrollToItem + highlight. */
	scrollRequest?: { itemId: string; timestamp: number; quote?: string } | null;
	/** Thinking timing for live turn: start/end epoch ms */
	thinkingStartedAt?: number | null;
	thinkingEndedAt?: number | null;
	/** Completed thinking durations by message/item id */
	thinkingDurations?: Record<string, { startedAt: number; endedAt: number }>;
	/** Completed model requests of the current turn, in arrival order
	 * (reset together with `tools`). */
	liveRequests: LiveRequest[];
	/** Compaction / handoff dividers, oldest first. */
	flowNotices: FlowNotice[];
	/** Messages omp itself holds back (steer / follow-up); texts only. */
	ompQueue: OmpQueue;
}
export const emptySessionLive = (): SessionLive => ({
	streaming: false,
	state: null,
	pendingUi: [],
	subagents: {},
	streamingMessage: null,
	commands: [],
	commandOutputs: [],
	pendingCommand: null,
	liveRequests: [],
	flowNotices: [],
	ompQueue: { steering: [], followUp: [] },
	tools: {},
	items: [],
	pendingUserEchoes: [],
	nextOffset: 0,
	alive: false,
	scrollRequest: null,
	thinkingStartedAt: null,
	thinkingEndedAt: null,
	thinkingDurations: {},
});

/** True once the session has seen any user/assistant activity: a transcript
 * item, an unconfirmed optimistic echo, a turn in flight, or a streaming
 * assistant snapshot. Used to tell a blank draft from a live session. */
export const hasLiveUserActivity = (live: SessionLive | undefined | null): boolean =>
	live != null &&
	(live.items.length > 0 ||
		live.pendingUserEchoes.length > 0 ||
		live.streaming ||
		live.streamingMessage !== null);

type Frame = Record<string, unknown>;

const asFrame = (v: unknown): Frame =>
	typeof v === "object" && v !== null ? (v as Frame) : {};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const resultText = (result: unknown): string => {
	const content = asFrame(result).content;
	if (!Array.isArray(content)) return "";
	return content
		.map((c) => str(asFrame(c).text))
		.filter(Boolean)
		.join("\n");
};

let nextOutputId = 1;

/** omp ships the arg hint under `input.hint`; mirror it onto `hint`. */
function normalizeCommand(raw: unknown): SlashCommand | null {
	const c = asFrame(raw);
	const name = str(c.name);
	if (!name) return null;
	const input = asFrame(c.input);
	return {
		name,
		aliases: Array.isArray(c.aliases)
			? c.aliases.map(str).filter(Boolean)
			: undefined,
		description: str(c.description) || undefined,
		input: input.hint != null ? { hint: str(input.hint) } : undefined,
		hint: str(input.hint) || str(c.hint) || undefined,
		subcommands: Array.isArray(c.subcommands)
			? c.subcommands.map(asFrame).map((s) => ({
					name: str(s.name),
					description: str(s.description) || undefined,
					usage: str(s.usage) || undefined,
				}))
			: undefined,
		source: str(c.source) || undefined,
	};
}

function normalizeCommands(list: unknown): SlashCommand[] {
	if (!Array.isArray(list)) return [];
	const out: SlashCommand[] = [];
	for (const raw of list) {
		const c = normalizeCommand(raw);
		if (c) out.push(c);
	}
	return out;
}

/** Human label for a subagent row: description, else agent type, else task
 * first line, else the id. Kept populated for TopCapsule consumers. */
function subagentLabel(
	id: string,
	parts: { description?: string; agent?: string; task?: string },
): string {
	const desc = parts.description?.trim();
	if (desc) return desc;
	const taskLine = parts.task?.split("\n")[0]?.trim();
	if (taskLine) return taskLine.length > 80 ? `${taskLine.slice(0, 80)}…` : taskLine;
	return parts.agent?.trim() || id;
}

/** Normalize lifecycle/progress status strings ("started" = running); unknown
 * values fall back so UI lookups never crash. */
const SUB_STATUSES = new Set<SubagentStatus>([
	"pending",
	"running",
	"completed",
	"failed",
	"aborted",
]);
function subStatus(v: unknown, fallback: SubagentStatus): SubagentStatus {
	if (v === "started") return "running";
	return SUB_STATUSES.has(v as SubagentStatus)
		? (v as SubagentStatus)
		: fallback;
}

/** Finished agents live as long as the session's state (omp's `get_subagents`
 * drops terminal entries), so they shed what only the running view reads:
 * `recentOutput`, the nested dispatch tree, raw tool args, old recent tools. */
function slimSubagent(info: SubagentInfo): SubagentInfo {
	const p = info.progress;
	if (!p || info.status === "pending" || info.status === "running") return info;
	return {
		...info,
		progress: {
			...p,
			recentOutput: [],
			recentTools: Array.isArray(p.recentTools) ? p.recentTools.slice(-8) : [],
			currentToolArgs: undefined,
			inflightTaskDetails: undefined,
		},
	};
}
let nextEchoId = 1;

const ECHO_IMAGE_RE =
	/\[(?:Image|图片)\s*#\d+(?:,\s*\d+x\d+)?(?::\s*([^\]]+))?\]|\[图片:\s*([^\]]+)\]|!\[[^\]]*\]\(([^)\s]+)\)/g;
/** Attachments of a user message: the given ones plus any image whose path only
 * appears as an inline marker in the text (deduped by path). */
export function collectUserImages(
	text: string,
	images?: ImageAttachment[],
): ImageAttachment[] {
	const all: ImageAttachment[] = [...(images ?? [])];
	const known = new Set(all.map((img) => img.path).filter(Boolean));
	let i = all.length;
	for (const m of text.matchAll(ECHO_IMAGE_RE)) {
		const path = (m[1] ?? m[2] ?? m[3])?.trim() || null;
		if (path && known.has(path)) continue;
		if (path) known.add(path);
		all.push({ id: `pending-img-${i++}`, path, marker: m[0] });
	}
	return all;
}
/** Build the optimistic user bubble for a just-accepted prompt. */
export function makeUserEcho(
	text: string,
	images?: ImageAttachment[],
): TranscriptItem {
	const all = collectUserImages(text, images);
	return {
		id: `pending-echo-${nextEchoId++}`,
		parentId: null,
		ts: new Date().toISOString(),
		kind: "user",
		text,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		...(all.length > 0 ? { images: all } : {}),
	};
}

const stripMarkers = (t: string) =>
	t.replace(
		/\[(?:Image|图片)\s*#\d+(?:,\s*\d+x\d+)?(?::\s*[^\]]+)?\]|\[图片(?::\s*[^\]]+)?\]/gi,
		"",
	);

const flat = (t: string) => stripMarkers(t).replace(/\s+/g, " ").trim();

/** An echo is confirmed once the transcript carries a user item with
 * matching text. `includes` both ways because the agent may prepend
 * `[Image #N]` markers or drop annotation blocks. */
export const echoMatches = (echoText: string, itemText: string): boolean => {
	const e = flat(echoText);
	const u = flat(itemText);
	if (e !== "" && u !== "") {
		return e === u || u.includes(e) || e.includes(u);
	}
	if (e === "" && u === "") {
		const markerRe = /\[(?:Image|图片)\s*#\d+|🖼️\s*#\d+/i;
		return markerRe.test(echoText) && markerRe.test(itemText);
	}
	return false;
};

/** Items of `next` whose ids were not already in `prev`. An echo can only be
 * confirmed by a user item that arrived after it was sent; an older item whose
 * text merely contains the echo text (e.g. a short "继续") must not consume it,
 * or the message vanishes before its own transcript item exists. */
function newItemsOnly(prev: TranscriptItem[], next: TranscriptItem[]): TranscriptItem[] {
	if (!prev.length) return next;
	const known = new Set(prev.map((i) => i.id));
	return next.filter((i) => !known.has(i.id));
}

/** Consume one pending echo per confirmed user transcript item (FIFO). */
function reconcileEchoes(
	pending: TranscriptItem[],
	items: TranscriptItem[],
): TranscriptItem[] {
	if (!pending.length) return pending;
	let rest = pending;
	for (const it of items) {
		if (it.kind !== "user") continue;
		const raw = it.text ?? "";
		const shown = isSideChatPrompt(raw) ? sideChatPromptToDisplay(raw) : raw;
		const i = rest.findIndex(
			(e) => echoMatches(e.text ?? "", raw) || echoMatches(e.text ?? "", shown),
		);
		if (i < 0) continue;
		rest = [...rest.slice(0, i), ...rest.slice(i + 1)];
	}
	return rest;
}

const queueTexts = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Parse omp's `{steering, followUp}` queue snapshot (queue_update / get_state). */
export const ompQueueFrom = (v: unknown): OmpQueue => {
	const o = asFrame(v);
	return { steering: queueTexts(o.steering), followUp: queueTexts(o.followUp) };
};

/** A compaction or handoff is running: no model request starts until it ends. */
export const isFlowBusy = (live: Pick<SessionLive, "flowNotices" | "state">): boolean =>
	live.flowNotices.some((n) => n.status === "running") || live.state?.isCompacting === true;

/**
 * Ids of optimistic user bubbles that are queued, i.e. not yet part of any
 * model request. An echo is queued while omp still lists its text in its
 * steering/follow-up queue (`queue_update`), or when it was sent while the
 * session was busy (`held`) and omp has not delivered it yet (`delivered` is
 * set by the user `message_start/end` frame). Confirmed echoes leave
 * `pendingUserEchoes` entirely (reconcileEchoes), so "sent" = not in the set.
 */
export function queuedEchoIds(
	live: Pick<SessionLive, "pendingUserEchoes" | "ompQueue">,
): Set<string> {
	const remaining = [...live.ompQueue.steering, ...live.ompQueue.followUp];
	const ids = new Set<string>();
	for (const echo of live.pendingUserEchoes) {
		const i = remaining.findIndex((t) => echoMatches(echo.text ?? "", t));
		if (i >= 0) {
			remaining.splice(i, 1);
			ids.add(echo.id);
		} else if (echo.held && !echo.delivered) {
			ids.add(echo.id);
		}
	}
	return ids;
}

/** Plain text of a `message_*` frame's user message. */
function userMessageText(msg: Frame): string {
	if (typeof msg.content === "string") return msg.content;
	if (!Array.isArray(msg.content)) return "";
	return msg.content
		.map((p) => (asFrame(p).type === "text" ? str(asFrame(p).text) : ""))
		.filter(Boolean)
		.join("\n");
}

/** Mark the first undelivered held echo matching `text` as delivered. */
function markEchoDelivered(echoes: UserEcho[], text: string): UserEcho[] {
	const i = echoes.findIndex((e) => e.held && !e.delivered && echoMatches(e.text ?? "", text));
	if (i < 0) return echoes;
	return echoes.map((e, j) => (j === i ? { ...e, delivered: true } : e));
}

/** Id of the last transcript item: where a new local row is anchored. */
export const lastItemId = (live: Pick<SessionLive, "items">): string | null =>
	live.items[live.items.length - 1]?.id ?? null;

/**
 * omp handled `/command` itself (command_output / not agent-invoked / error)
 * and never writes it to the transcript, so its echo would wait for a user
 * item forever. Move the latest matching echo out of `pendingUserEchoes` into
 * `localEchoes`: it stays in the thread at its anchor and is persisted.
 */
export function moveLocalEcho(live: SessionLive, command: string | null | undefined): SessionLive {
	if (!command) return live;
	const prefix = `/${command}`;
	let idx = -1;
	live.pendingUserEchoes.forEach((e, i) => {
		const t = (e.text ?? "").trimStart();
		if (t === prefix || t.startsWith(`${prefix} `)) idx = i;
	});
	if (idx < 0) return live;
	const { held: _held, delivered: _delivered, steer: _steer, ...echo } = live.pendingUserEchoes[idx];
	return {
		...live,
		pendingUserEchoes: live.pendingUserEchoes.filter((_, i) => i !== idx),
		localEchoes: [...(live.localEchoes ?? []), echo].slice(-50),
	};
}

/** Move the turn's retry rows into the persisted history (one entry per turn). */
export function archiveRetry(live: SessionLive, now: number): Partial<SessionLive> {
	const notices = live.retryNotices;
	if (!notices || notices.length === 0) return {};
	const episode: RetryEpisode = {
		id: `rt-${now}-${nextOutputId++}`,
		endedAt: now,
		notices,
		...(live.retryFallback ? { fallback: live.retryFallback } : {}),
	};
	return {
		retryNotices: [],
		retryFallback: undefined,
		retryHistory: [...(live.retryHistory ?? []), episode].slice(-MAX_RETRY_EPISODES),
	};
}

/** Add a running compaction/handoff divider anchored after the last transcript item. */
export function beginFlowNotice(
	live: SessionLive,
	kind: FlowNoticeKind,
	id: number,
	now: number,
): SessionLive {
	const notice: FlowNotice = {
		id,
		kind,
		status: "running",
		startedAt: now,
		anchorId: live.items[live.items.length - 1]?.id ?? null,
	};
	return { ...live, flowNotices: [...live.flowNotices, notice].slice(-20) };
}

/** Settle a divider in place; a missing id is ignored. */
export function finishFlowNotice(
	live: SessionLive,
	id: number,
	patch: Pick<FlowNotice, "status"> &
		Partial<Pick<FlowNotice, "tokensBefore" | "tokensAfter" | "detail">>,
	now: number,
): SessionLive {
	if (!live.flowNotices.some((n) => n.id === id)) return live;
	return {
		...live,
		flowNotices: live.flowNotices.map((n) =>
			n.id === id ? { ...n, ...patch, endedAt: now } : n,
		),
	};
}

/** One finished model request from an assistant `message_end` message. */
function liveRequestFromMessage(
	msg: AgentMessage,
	fallbackTs: number,
	existing: LiveRequest[],
	thinkingMs?: number,
): LiveRequest {
	const content = normalizeThinkContent(
		Array.isArray(msg.content) ? msg.content : [],
	);
	const toolCallIds: string[] = [];
	const parts: LiveRequestPart[] = [];
	let hasText = false;
	let thinkingTimed = false;
	for (const part of content) {
		const o = asFrame(part);
		if (o.type === "tool_use" || o.type === "toolCall") {
			const id = str(o.id);
			if (id) {
				toolCallIds.push(id);
				parts.push({ kind: "tool", id });
			}
		} else if (o.type === "thinking" || o.type === "thought") {
			const text = str(o.thinking ?? o.text);
			if (!text) continue;
			// The store tracks one thinking span per request: it belongs to
			// the first thinking part.
			parts.push({
				kind: "thinking",
				text,
				durationMs: thinkingTimed ? undefined : thinkingMs,
			});
			thinkingTimed = true;
		} else if (
			o.type === "text" &&
			typeof o.text === "string" &&
			o.text.length > 0
		) {
			hasText = true;
			if (o.text.trim()) parts.push({ kind: "text", text: o.text });
		}
	}
	// Prefer the provider's response id; fall back to the message id and
	// finally to a stable per-turn sequence number.
	const id =
		str(msg.responseId) ||
		str(msg.id) ||
		`req-${existing.length + 1}`;
	return {
		id,
		toolCallIds,
		hasText,
		parts,
		stat: requestStatFromMessage(
			msg as unknown as Record<string, unknown>,
			fallbackTs,
		),
	};
}

/** Dialog methods that wait for a host answer (mirrors the Rust side). */
const INTERACTIVE_METHODS = new Set(["select", "confirm", "input", "editor"]);

function requestId(req: unknown): string {
	return str(asFrame(req).id);
}

function reduce(
	live: SessionLive,
	frame: Frame,
	sessionId: string,
): SessionLive {
	switch (frame.type) {
		case "agent_start":
		case "turn_start":
			return {
				...live,
				streaming: true,
				thinkingStartedAt: null,
				thinkingEndedAt: null,
			};
		case "message_update": {
			const msg = asFrame(frame.message) as AgentMessage;
			// Only assistant messages stream; a `user` echo (or toolResult with
			// role "user") must not occupy streamingMessage — it would render as
			// an assistant bubble and then vanish on message_end.
			if (msg.role && msg.role !== "assistant") return live;
			const ts =
				typeof frame.timestamp === "number"
					? frame.timestamp
					: typeof msg.timestamp === "number"
						? msg.timestamp
						: Date.now();
			let thinkingStartedAt = live.thinkingStartedAt ?? null;
			let thinkingEndedAt = live.thinkingEndedAt ?? null;
			const content = normalizeThinkContent(
				Array.isArray(msg.content) ? msg.content : [],
				{ streaming: true },
			);
			const hasThinking = content.some((p) => {
				const o = asFrame(p);
				return o.type === "thinking" || o.type === "thought";
			});
			const hasText = content.some((p) => {
				const o = asFrame(p);
				return (
					o.type === "text" &&
					typeof o.text === "string" &&
					o.text.length > 0
				);
			});
			if (hasThinking && !thinkingStartedAt) {
				thinkingStartedAt = ts;
			}
			if (hasText && thinkingStartedAt && !thinkingEndedAt) {
				thinkingEndedAt = ts;
			}
			return {
				...live,
				streamingMessage: msg,
				thinkingStartedAt,
				thinkingEndedAt,
			};
		}
		case "message_end": {
			const ts =
				typeof frame.timestamp === "number" ? frame.timestamp : Date.now();
			// The completed message carries the real per-request metrics
			// (duration / ttft / usage / completedAt).
			const ended = asFrame(frame.message) as AgentMessage;
			const isAssistant = !ended.role || ended.role === "assistant";
			if (ended.role === "user") {
				return live.pendingUserEchoes.length
					? {
							...live,
							pendingUserEchoes: markEchoDelivered(
								live.pendingUserEchoes,
								userMessageText(ended as Frame),
							),
						}
					: live;
			}
			// Skip ends for messages we never tracked (e.g. user echoes).
			if (!live.streamingMessage && !isAssistant) return live;
			const thinkingEndedAt =
				live.thinkingStartedAt && !live.thinkingEndedAt
					? ts
					: live.thinkingEndedAt;
			const msgId =
				str(frame.messageId) ||
				(typeof live.streamingMessage?.id === "string"
					? live.streamingMessage.id
					: "");
			const thinkingDurations = { ...(live.thinkingDurations ?? {}) };
			if (msgId && live.thinkingStartedAt && thinkingEndedAt) {
				thinkingDurations[msgId] = {
					startedAt: live.thinkingStartedAt,
					endedAt: thinkingEndedAt,
				};
			}
			// Record the finished model request even when we never saw its
			// streaming snapshot (no message_update for this message).
			const liveRequests = isAssistant
				? [
						...live.liveRequests,
						liveRequestFromMessage(
							ended,
							ts,
							live.liveRequests,
							live.thinkingStartedAt && thinkingEndedAt
								? thinkingEndedAt - live.thinkingStartedAt
								: undefined,
						),
					]
				: live.liveRequests;
			return {
				...live,
				streamingMessage: null,
				thinkingEndedAt,
				thinkingDurations,
				liveRequests,
			};
		}
		case "tool_execution_start": {
			const id = str(frame.toolCallId);
			if (!id) return live;
			const startTs =
				typeof frame.timestamp === "number" ? frame.timestamp : Date.now();
			return {
				...live,
				tools: {
					...live.tools,
					[id]: {
						toolCallId: id,
						toolName: str(frame.toolName),
						args: frame.args,
						intent: typeof frame.intent === "string" ? frame.intent : null,
						status: "running",
						text: "",
						details: null,
						startedAt: startTs,
					},
				},
			};
		}
		case "tool_execution_update": {
			const id = str(frame.toolCallId);
			const tool = live.tools[id];
			if (!tool) return live;
			const partial = asFrame(frame.partialResult);
			return {
				...live,
				tools: {
					...live.tools,
					[id]: {
						...tool,
						text: resultText(partial),
						// TaskToolDetails arrive here (progress/results), keep them.
						details: partial.details ?? tool.details,
					},
				},
			};
		}
		case "tool_execution_end": {
			const id = str(frame.toolCallId);
			const tool = live.tools[id];
			if (!tool) return live;
			const endTs =
				typeof frame.timestamp === "number" ? frame.timestamp : Date.now();
			return {
				...live,
				tools: {
					...live.tools,
					[id]: {
						...tool,
						status: frame.isError === true ? "error" : "done",
						text: resultText(frame.result) || tool.text,
						details: asFrame(frame.result).details ?? null,
						endedAt: endTs,
					},
				},
			};
		}
		case "turn_end": {
			const ts =
				typeof frame.timestamp === "number" ? frame.timestamp : Date.now();
			const thinkingEndedAt =
				live.thinkingStartedAt && !live.thinkingEndedAt
					? ts
					: live.thinkingEndedAt;
			// Tool results are persisted to the transcript; live tool map clears
			// on the next turn_start implicitly via tool_execution ids.
			const terminal = frame.isTerminal === true;
			return terminal
				? { ...live, thinkingEndedAt, streaming: false, streamingMessage: null }
				: { ...live, thinkingEndedAt };
		}
		case "agent_end": {
			if (frame.isTerminal === false) return live;
			return {
				...live,
				streaming: false,
				streamingMessage: null,
				tools: {},
				liveRequests: [],
				// Turn finished: collapse its retry rows into a history entry.
				...archiveRetry(live, typeof frame.timestamp === "number" ? frame.timestamp : Date.now()),
			};
		}
		case "auto_compaction_start": {
			if (live.flowNotices.some((n) => n.status === "running")) return live;
			const kind = str(frame.action) === "handoff" ? "handoff" : "compaction";
			return beginFlowNotice(live, kind, nextOutputId++, Date.now());
		}
		case "auto_compaction_end": {
			const running = [...live.flowNotices].reverse().find((n) => n.status === "running");
			if (!running) return live;
			const now = Date.now();
			if (frame.skipped === true) {
				return { ...live, flowNotices: live.flowNotices.filter((n) => n.id !== running.id) };
			}
			const error = str(frame.errorMessage);
			if (frame.aborted === true || error) {
				return finishFlowNotice(
					live,
					running.id,
					{ status: "error", detail: error || "已取消" },
					now,
				);
			}
			const before = asFrame(frame.result).tokensBefore;
			return finishFlowNotice(
				live,
				running.id,
				{ status: "done", ...(typeof before === "number" ? { tokensBefore: before } : {}) },
				now,
			);
		}
		case "queue_update":
			return { ...live, ompQueue: ompQueueFrom(frame) };
		case "message_start": {
			// A user message entering the conversation = a held echo got delivered.
			const msg = asFrame(frame.message);
			if (msg.role !== "user" || !live.pendingUserEchoes.length) return live;
			return {
				...live,
				pendingUserEchoes: markEchoDelivered(live.pendingUserEchoes, userMessageText(msg)),
			};
		}
		case "extension_ui_request": {
			const method = str(frame.method);
			if (method === "cancel") {
				const target = str(frame.targetId) || str(frame.id);
				return {
					...live,
					pendingUi: live.pendingUi.filter(
						(r) => requestId(r.request) !== target,
					),
				};
			}
			if (!INTERACTIVE_METHODS.has(method)) return live;
			return {
				...live,
				pendingUi: [
					...live.pendingUi,
					{
						sessionId,
						request: frame,
						receivedAt: new Date().toISOString(),
					},
				],
			};
		}
		case "available_commands_update": {
			return { ...live, commands: normalizeCommands(frame.commands) };
		}
		case "auto_retry_start":
		case "auto_retry_end":
		case "retry_fallback_applied":
		case "retry_fallback_succeeded": {
			const n = retryNoticeFromFrame(frame);
			if (!n) return live;
			// History is kept: rows stay until the turn ends, then collapse into
			// one thread entry (see archiveRetry).
			const next: SessionLive = {
				...live,
				retryNotices: [...(live.retryNotices ?? []), { ...n, id: nextOutputId++ }].slice(-20),
			};
			if (frame.type !== "retry_fallback_applied") return next;
			const to = modelLabel(frame.to);
			// Original model: from the event, else the session state at fallback time.
			const from = modelLabel(frame.from) || resolveCurrentModel(live.state?.model).value;
			if (!from || !to) return next;
			const thinking = typeof live.state?.thinkingLevel === "string" ? live.state.thinkingLevel : undefined;
			return {
				...next,
				retryFallback: {
					id: `fb-${Date.now()}-${nextOutputId++}`,
					from,
					to,
					...(thinking ? { thinking } : {}),
				},
			};
		}
		case "command_output": {
			// Slash commands executed by omp emit their text here instead of as a
			// normal message. Surface it as an ephemeral block in the thread.
			const text = str(frame.text);
			if (!text.trim()) return live;
			return moveLocalEcho(
				{
					...live,
					commandOutputs: [
						...live.commandOutputs,
						{
							id: nextOutputId++,
							command: live.pendingCommand ?? undefined,
							text,
							ts: Date.now(),
							kind: "omp",
							anchorId: lastItemId(live),
						} satisfies CommandOutputEntry,
					].slice(-50),
				},
				live.pendingCommand,
			);
		}
		case "config_update": {
			// `{model?, thinkingLevel?}` — refresh the cached get_state fields.
			const state = { ...(live.state ?? {}) };
			if ("model" in frame && frame.model !== undefined)
				state.model = frame.model;
			if (typeof frame.thinkingLevel === "string")
				state.thinkingLevel = frame.thinkingLevel;
			return { ...live, state };
		}
		case "session_info_update": {
			// `{title?, sessionId?}` from e.g. `set_session_name`.
			const sessionName =
				str(frame.sessionName) || str(frame.title) || undefined;
			if (!sessionName || !live.state) return live;
			return { ...live, state: { ...live.state, sessionName } };
		}
		case "goal_updated": {
			// `{goal, state}` — `state` is the same GoalModeState get_state.goal
			// carries (it is null after a drop); refresh the cached snapshot.
			const goal =
				"state" in frame ? frame.state : (frame.goal ?? null);
			return {
				...live,
				state: { ...(live.state ?? {}), goal: goal ?? null },
			};
		}
		case "prompt_result": {
			const pendingCommand = live.pendingCommand ?? null;
			if (/already processing/i.test(str(frame.error))) {
				return { ...live, streaming: true, pendingCommand: null };
			}
			if (
				pendingCommand &&
				frame.status === "error" &&
				str(frame.error).trim()
			) {
				return moveLocalEcho(
					{
						...live,
						streaming: false,
						streamingMessage: null,
						tools: {},
						liveRequests: [],
						pendingCommand: null,
						commandOutputs: [
							...live.commandOutputs,
							{
								id: nextOutputId++,
								command: pendingCommand,
								text: str(frame.error),
								ts: Date.now(),
								kind: "omp",
								anchorId: lastItemId(live),
							} satisfies CommandOutputEntry,
						].slice(-50),
					},
					pendingCommand,
				);
			}
			return {
				...live,
				streaming: false,
				streamingMessage: null,
				tools: {},
				liveRequests: [],
				pendingCommand: null,
			};
		}
		case "error": {
			// Transport/process errors (e.g. socket closed) must not leave a turn stuck.
			return { ...live, streaming: false, streamingMessage: null, tools: {}, liveRequests: [] };
		}
		case "subagent_lifecycle": {
			// Frame: {type, payload:{id, agent, agentSource, description?, status,
			// sessionFile?, parentToolCallId?, index, detached?}}; "started" = running.
			// Finished agents are kept client-side: omp's get_subagents snapshot
			// drops terminal entries.
			const p = asFrame(frame.payload) as unknown as SubagentLifecyclePayload;
			const id = typeof p.id === "string" ? p.id : "";
			if (!id) return live;
			const prev = live.subagents[id];
			const status = subStatus(p.status, prev?.status ?? "pending");
			return {
				...live,
				subagents: {
					...live.subagents,
					[id]: slimSubagent({
						...prev,
						status,
						index: p.index ?? prev?.index,
						agent: p.agent ?? prev?.agent,
						agentSource: p.agentSource ?? prev?.agentSource,
						description: p.description ?? prev?.description,
						sessionFile: p.sessionFile ?? prev?.sessionFile,
						parentToolCallId:
							p.parentToolCallId ?? prev?.parentToolCallId,
						label: subagentLabel(id, { ...prev, description: p.description ?? prev?.description, agent: p.agent ?? prev?.agent, task: prev?.task }),
						lastUpdate: Date.now(),
					}),
				},
			};
		}
		case "subagent_progress": {
			// Frame: {type, payload:{index, agent, agentSource, task,
			// parentToolCallId?, assignment?, progress: AgentProgress, sessionFile?}}.
			const p = asFrame(frame.payload) as unknown as SubagentProgressPayload;
			const prog = asFrame(p.progress) as unknown as AgentProgress;
			const id =
				typeof prog.id === "string"
					? prog.id
					: typeof p.id === "string"
						? p.id
						: "";
			if (!id) return live;
			const prev = live.subagents[id];
			const status = subStatus(prog.status, prev?.status ?? "running");
			const desc = prog.description ?? p.description ?? prev?.description;
			return {
				...live,
				subagents: {
					...live.subagents,
					[id]: slimSubagent({
						...prev,
						status,
						index: p.index ?? prog.index ?? prev?.index,
						agent: p.agent ?? prog.agent ?? prev?.agent,
						agentSource:
							p.agentSource ?? prog.agentSource ?? prev?.agentSource,
						description: desc,
						task: p.task ?? prog.task ?? prev?.task,
						assignment:
							p.assignment ?? prog.assignment ?? prev?.assignment,
						sessionFile: p.sessionFile ?? prev?.sessionFile,
						parentToolCallId:
							p.parentToolCallId ?? prev?.parentToolCallId,
						progress: prog,
						label: subagentLabel(id, {
							description: desc,
							agent: p.agent ?? prog.agent ?? prev?.agent,
							task: p.task ?? prog.task ?? prev?.task,
						}),
						lastUpdate: Date.now(),
					}),
				},
			};
		}
		case "response": {
			if (frame.command === "prompt") {
				const pendingCommand = live.pendingCommand ?? null;
				if (frame.success !== true) {
					// omp rejected the prompt because a turn is running: the turn is still
					// live, so mark it streaming instead of wiping the live turn state.
					if (/already processing/i.test(str(frame.error))) {
						return { ...live, streaming: true, pendingCommand: null };
					}
					const failed: SessionLive = {
						...live,
						streaming: false,
						streamingMessage: null,
						tools: {},
						liveRequests: [],
						pendingCommand: null,
					};
					if (!pendingCommand || !str(frame.error).trim()) return failed;
					return moveLocalEcho(
						{
							...failed,
							commandOutputs: [
								...live.commandOutputs,
								{
									id: nextOutputId++,
									command: pendingCommand,
									text: str(frame.error),
									ts: Date.now(),
									kind: "omp",
									anchorId: lastItemId(live),
								} satisfies CommandOutputEntry,
							].slice(-50),
						},
						pendingCommand,
					);
				}
				const data = asFrame(frame.data);
				if (data.agentInvoked === false && pendingCommand) {
					return moveLocalEcho({ ...live, pendingCommand: null }, pendingCommand);
				}
				return live;
			}
			const data = asFrame(frame.data);
			if (frame.success !== true) return live;
			switch (frame.command) {
				case "get_state":
					return {
						...live,
						state: data,
						streaming: data.isStreaming === true,
						ompQueue:
							data.queuedMessages !== undefined
								? ompQueueFrom(data.queuedMessages)
								: live.ompQueue,
					};
				case "get_available_commands":
					return {
						...live,
						commands:
							normalizeCommands(data.commands).length > 0
								? normalizeCommands(data.commands)
								: live.commands,
					};
				case "get_subagents": {
					// Only running agents are listed; finished ones stay client-side.
					if (!Array.isArray(data.subagents)) return live;
					const subagents = { ...live.subagents };
					for (const raw of data.subagents) {
						const sa = asFrame(raw);
						const id = str(sa.id);
						if (!id) continue;
						const prev = subagents[id];
						const prog =
							typeof sa.progress === "object" && sa.progress !== null
								? (sa.progress as AgentProgress)
								: prev?.progress;
						subagents[id] = slimSubagent({
							...prev,
							status: subStatus(sa.status, prev?.status ?? "running"),
							index:
								typeof sa.index === "number"
									? sa.index
									: prev?.index,
							agent: str(sa.agent) || prev?.agent,
							agentSource: str(sa.agentSource) || prev?.agentSource,
							description:
								str(sa.description) || prev?.description,
							task: str(sa.task) || prev?.task,
							assignment: str(sa.assignment) || prev?.assignment,
							sessionFile:
								str(sa.sessionFile) || prev?.sessionFile,
							parentToolCallId:
								str(sa.parentToolCallId) ||
								prev?.parentToolCallId,
							progress: prog ?? prev?.progress,
							label: subagentLabel(id, {
								description:
									str(sa.description) || prev?.description,
								agent: str(sa.agent) || prev?.agent,
								task: str(sa.task) || prev?.task,
							}),
							lastUpdate:
								typeof sa.lastUpdate === "number"
									? sa.lastUpdate
									: Date.now(),
						});
					}
					return { ...live, subagents };
				}
				default:
					return live;
			}
		}
		default:
			return live;
	}
}

export interface LiveState {
	sessions: Record<string, SessionLive>;
	/** Reduce one rpc:frame event into session state. */
	reduceFrame(payload: RpcFramePayload): void;
	/** Reduce one rpc:process event into session state. */
	reduceProcess(payload: RpcProcessPayload): void;
	/** Optimistically drop a dialog after rpc_ui_respond succeeds. */
	dismissUi(sessionId: string, requestId: string): void;
	/** Seed pendingUi from rpc_pending_ui when opening a live session. */
	setPendingUi(sessionId: string, list: PendingUiRequest[]): void;
	/** Replace/extend the transcript cache for a session. Pending user echoes
	 * are reconciled against the incoming page (FIFO per user item). */
	setItems(sessionId: string, items: TranscriptItem[], nextOffset: number): void;
	appendItems(sessionId: string, items: TranscriptItem[], nextOffset: number): void;
	/** Optimistically append a user bubble after rpc_send accepts a prompt;
	 * dropped once a transcript page confirms a matching user item. */
	addUserEcho(
		sessionId: string,
		text: string,
		images?: ImageAttachment[],
		/** Sent with streamingBehavior "steer" (lands inside the running turn). */
		steer?: boolean,
	): string | null;
	/** Drop a pending echo by id (its send failed or was cancelled). */
	removeUserEcho(sessionId: string, echoId: string): void;
	/** Scroll the message stream to a transcript item (used by HeatmapPanel). With
	 * `quote`, only that text is highlighted (whole item if it can't be found). */
	scrollToItem(sessionId: string, itemId: string, quote?: string): void;
	/** Consume/clear the scroll request for a session. */
	clearScrollRequest(sessionId: string): void;
	/** Remember the slash command just sent as a prompt so the following
	 * `command_output` frames can be labelled with it. */
	noteCommandSent(sessionId: string, name: string): void;
	/** Push an app-local command result (/status card, action confirmations). */
	addCommandOutput(sessionId: string, command: string, text: string): void;
	/** Dismiss one ephemeral command output block. */
	dismissCommandOutput(sessionId: string, id: number): void;
	/** Add a running status row for a local slash command; returns its id. */
	beginCommandRun(sessionId: string, command: string, text: string): number;
	/** Turn a running row into its final result (done / error) in place. */
	finishCommandRun(
		sessionId: string,
		id: number,
		status: "done" | "error",
		text: string,
	): void;
	/** Add a running compaction/handoff divider to the thread; returns its id. */
	beginFlowNotice(sessionId: string, kind: FlowNoticeKind): number;
	/** Settle a divider (done / error) in place. */
	finishFlowNotice(
		sessionId: string,
		id: number,
		patch: Pick<FlowNotice, "status"> &
			Partial<Pick<FlowNotice, "tokensBefore" | "tokensAfter" | "detail">>,
	): void;
	/** Remove a divider (cancelled before anything happened). */
	dismissFlowNotice(sessionId: string, id: number): void;
	/** Load this session's persisted retry history (once). */
	hydrateRetryHistory(sessionId: string): void;
	/** Load this session's persisted local rows (once). */
	hydrateLocalRows(sessionId: string): void;
	/** Mark a fallback as undone everywhere it is shown. */
	markFallbackUndone(sessionId: string, fallbackId: string): void;
}

export const useLive = create<LiveState>((set) => ({
	sessions: {},
	reduceFrame: ({ sessionId, frame }) => {
		const f = asFrame(frame);
		set((s) => ({
			sessions: {
				...s.sessions,
				[sessionId]: reduce(
					s.sessions[sessionId] ?? { ...emptySessionLive(), alive: true },
					f,
					sessionId,
				),
			},
		}));
		// `session_info_update` carries a new title from /rename —
		// patch the session list optimistically; the file watcher follows.
		if (f.type === "session_info_update") {
			const title = str(f.sessionName) || str(f.title);
			if (title) {
				void import("./sessions")
					.then(({ useSessions }) => {
						const meta = useSessions.getState().sessions[sessionId];
						if (meta && meta.title !== title) {
							useSessions
								.getState()
								.upsert([{ ...meta, title }]);
						}
					})
					.catch(() => {});
			}
		}
	},
	reduceProcess: ({ sessionId, running, exitCode }) =>
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			const next = running
				? { ...live, alive: true }
				: {
						...live,
						alive: false,
						streaming: false,
						streamingMessage: null,
						pendingUi: [],
						tools: {},
						liveRequests: [],
					};
			void exitCode;
			return { sessions: { ...s.sessions, [sessionId]: next } };
		}),
	dismissUi: (sessionId, reqId) =>
		set((s) => {
			const live = s.sessions[sessionId];
			if (!live) return s;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						pendingUi: live.pendingUi.filter(
							(r) => requestId(r.request) !== reqId,
						),
					},
				},
			};
		}),
	setPendingUi: (sessionId, list) =>
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			return {
				sessions: {
					...s.sessions,
					[sessionId]: { ...live, pendingUi: list, alive: true },
				},
			};
		}),
	setItems: (sessionId, items, nextOffset) =>
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						items,
						nextOffset,
						pendingUserEchoes: reconcileEchoes(
							live.pendingUserEchoes,
							newItemsOnly(live.items, items),
						),
					},
				},
			};
		}),
	appendItems: (sessionId, items, nextOffset) =>
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			const known = new Set(live.items.map((i) => i.id));
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						items: [
							...live.items,
							...items.filter((i) => !known.has(i.id)),
						],
						nextOffset,
						pendingUserEchoes: reconcileEchoes(
							live.pendingUserEchoes,
							items.filter((i) => !known.has(i.id)),
						),
					},
				},
			};
		}),
	addUserEcho: (sessionId, text, images, steer) => {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const echo: UserEcho = makeUserEcho(trimmed, images);
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			echo.anchorId = lastItemId(live);
			// Only a steer into an in-flight turn is in-turn; anything else is a
			// next-turn bubble.
			if (steer && live.streaming) echo.steer = true;
			// Sent while a turn streams or a compaction/handoff runs: queued
			// until omp actually delivers it.
			if (live.streaming || isFlowBusy(live)) echo.held = true;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						pendingUserEchoes: [...live.pendingUserEchoes, echo],
						...(steer ? {} : archiveRetry(live, Date.now())),
					},
				},
			};
		});
		return echo.id;
	},
	removeUserEcho: (sessionId, echoId) =>
		set((s) => {
			const live = s.sessions[sessionId];
			if (!live || !live.pendingUserEchoes.some((e) => e.id === echoId)) return s;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						pendingUserEchoes: live.pendingUserEchoes.filter((e) => e.id !== echoId),
					},
				},
			};
		}),
	scrollToItem: (sessionId, itemId, quote) => {
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						scrollRequest: { itemId, timestamp: Date.now(), quote },
					},
				},
			};
		});
	},
	clearScrollRequest: (sessionId) => {
		set((s) => {
			const live = s.sessions[sessionId];
			if (!live || !live.scrollRequest) return s;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						scrollRequest: null,
					},
				},
			};
		});
	},
	noteCommandSent: (sessionId, name) =>
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			return {
				sessions: {
					...s.sessions,
					[sessionId]: { ...live, pendingCommand: name },
				},
			};
		}),
	addCommandOutput: (sessionId, command, text) =>
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			if (!text.trim()) return s;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						commandOutputs: [
							...live.commandOutputs,
							{
								id: nextOutputId++,
								command,
								text,
								ts: Date.now(),
								kind: "app",
								anchorId: lastItemId(live),
						} satisfies CommandOutputEntry,
						].slice(-50),
					},
				},
			};
		}),
	beginCommandRun: (sessionId, command, text) => {
		const id = nextOutputId++;
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						commandOutputs: [
							...live.commandOutputs,
							{
								id,
								command,
								text,
								ts: Date.now(),
								kind: "app",
								anchorId: lastItemId(live),
								status: "running",
							} satisfies CommandOutputEntry,
						].slice(-50),
					},
				},
			};
		});
		return id;
	},
	finishCommandRun: (sessionId, id, status, text) =>
		set((s) => {
			const live = s.sessions[sessionId];
			if (!live) return s;
			const exists = live.commandOutputs.some((o) => o.id === id);
			const outputs = exists
				? live.commandOutputs.map((o) =>
						o.id === id ? { ...o, status, text, ts: Date.now() } : o,
					)
				: [
						...live.commandOutputs,
						{
							id,
							text,
							ts: Date.now(),
							kind: "app",
							status,
							anchorId: lastItemId(live),
						} satisfies CommandOutputEntry,
					].slice(-50);
			return {
				sessions: { ...s.sessions, [sessionId]: { ...live, commandOutputs: outputs } },
			};
		}),
	beginFlowNotice: (sessionId, kind) => {
		const id = nextOutputId++;
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			return {
				sessions: {
					...s.sessions,
					[sessionId]: beginFlowNotice(live, kind, id, Date.now()),
				},
			};
		});
		return id;
	},
	finishFlowNotice: (sessionId, id, patch) =>
		set((s) => {
			const live = s.sessions[sessionId];
			if (!live) return s;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: finishFlowNotice(live, id, patch, Date.now()),
				},
			};
		}),
	dismissFlowNotice: (sessionId, id) =>
		set((s) => {
			const live = s.sessions[sessionId];
			if (!live) return s;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						flowNotices: live.flowNotices.filter((n) => n.id !== id),
					},
				},
			};
		}),
	dismissCommandOutput: (sessionId, id) =>
		set((s) => {
			const live = s.sessions[sessionId];
			if (!live) return s;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						commandOutputs: live.commandOutputs.filter(
							(o) => o.id !== id,
						),
					},
				},
			};
		}),
	hydrateLocalRows: (sessionId) => {
		if (!useLive.getState().sessions[sessionId]?.localRowsLoaded) loadLocalRows(sessionId);
	},
	hydrateRetryHistory: (sessionId) =>
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			if (live.retryHistoryLoaded) return s;
			const stored = loadRetryHistory(sessionId);
			const have = new Set((live.retryHistory ?? []).map((e) => e.id));
			const merged = [...stored.filter((e) => !have.has(e.id)), ...(live.retryHistory ?? [])];
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						retryHistoryLoaded: true,
						retryHistory: merged.slice(-MAX_RETRY_EPISODES),
					},
				},
			};
		}),
	markFallbackUndone: (sessionId, fallbackId) =>
		set((s) => {
			const live = s.sessions[sessionId];
			if (!live) return s;
			const mark = (f: FallbackInfo | undefined): FallbackInfo | undefined =>
				f && f.id === fallbackId ? { ...f, undone: true } : f;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						retryFallback: mark(live.retryFallback),
						retryHistory: live.retryHistory?.map((e) => ({ ...e, fallback: mark(e.fallback) })),
					},
				},
			};
		}),
}));

// Persist each session's retry history whenever it changes.
useLive.subscribe((s, prev) => {
	for (const [sid, live] of Object.entries(s.sessions)) {
		if (live.retryHistory && live.retryHistory !== prev.sessions[sid]?.retryHistory) {
			saveRetryHistory(sid, live.retryHistory);
		}
	}
});

// ---- Transcript retention ----
//
// `items` holds a session's whole transcript (every tool result and its
// details). Without a bound each session the user ever opened keeps it for
// the lifetime of the app. SessionView always re-reads the transcript on
// mount, so a session that is no longer shown can drop its items; the few
// most recently left ones stay so switching back is instant.

const RETAINED_IDLE_TRANSCRIPTS = 3;
const shownTranscripts = new Map<string, number>();
/** Least recently left first. */
let leftTranscripts: string[] = [];

/**
 * Mark a session's transcript as on screen; call the returned function when the
 * view goes away. Only sessions with an on-disk transcript that are not
 * running are ever evicted (drafts/echoes have no file to reload from).
 */
export function holdTranscript(sessionId: string): () => void {
	shownTranscripts.set(sessionId, (shownTranscripts.get(sessionId) ?? 0) + 1);
	leftTranscripts = leftTranscripts.filter((id) => id !== sessionId);
	return () => {
		const n = (shownTranscripts.get(sessionId) ?? 1) - 1;
		if (n > 0) {
			shownTranscripts.set(sessionId, n);
			return;
		}
		shownTranscripts.delete(sessionId);
		leftTranscripts.push(sessionId);
		void evictLeftTranscripts();
	};
}

async function evictLeftTranscripts(): Promise<void> {
	if (leftTranscripts.length <= RETAINED_IDLE_TRANSCRIPTS) return;
	// Dynamic: ./sessions imports this module (cycle), as in reduceFrame above.
	const { useSessions } = await import("./sessions");
	const stale = leftTranscripts.slice(0, -RETAINED_IDLE_TRANSCRIPTS);
	leftTranscripts = leftTranscripts.slice(-RETAINED_IDLE_TRANSCRIPTS);
	useLive.setState((s) => {
		let sessions = s.sessions;
		for (const id of stale) {
			const live = sessions[id];
			if (!live || live.items.length === 0) continue;
			if (shownTranscripts.has(id) || live.alive || live.streaming) continue;
			if (!useSessions.getState().sessions[id]?.file) continue;
			if (sessions === s.sessions) sessions = { ...sessions };
			sessions[id] = {
				...live,
				items: [],
				nextOffset: 0,
				streamingMessage: null,
				tools: {},
				liveRequests: [],
			};
		}
		return sessions === s.sessions ? s : { sessions };
	});
}

/** Grace before a removed session's composer state is dropped: a catalog
 * rebuild can report a session gone and bring it back moments later, and a
 * typed draft must survive that. */
const COMPOSER_PRUNE_GRACE_MS = 30_000;

/**
 * A session left the catalog (deleted): drop everything the stores and
 * module-level caches keep for it. Its transcript is gone with it, nothing
 * has to be refetched.
 */
export function pruneRemovedSessions(ids: readonly string[]): void {
	if (ids.length === 0) return;
	const gone = new Set(ids);
	leftTranscripts = leftTranscripts.filter((id) => !gone.has(id));
	for (const id of gone) {
		localRowsLoading.delete(id);
		localRowsReadOnly.delete(id);
		localRowsSavedJson.delete(id);
		clearTimeout(localRowsTimers.get(id));
		localRowsTimers.delete(id);
		try {
			// Same key as retryNotice.saveRetryHistory.
			globalThis.localStorage?.removeItem(`omp.retryHistory.${id}`);
		} catch {
			/* storage unavailable */
		}
	}
	useLive.setState((s) => {
		let sessions = s.sessions;
		for (const id of gone) {
			if (!(id in sessions)) continue;
			if (sessions === s.sessions) sessions = { ...sessions };
			delete sessions[id];
		}
		return sessions === s.sessions ? s : { sessions };
	});
	setTimeout(() => {
		void Promise.all([import("./sessions"), import("./composer")]).then(
			([{ useSessions }, { useComposer }]) => {
				const known = useSessions.getState().sessions;
				const still = [...gone].filter((id) => !(id in known));
				if (still.length > 0) useComposer.getState().pruneSessions(still);
			},
		);
	}, COMPOSER_PRUNE_GRACE_MS);
}

// ---- Local rows persistence (docs/ARCHITECTURE.md §6 `local_rows`) ----

const localRowsLoading = new Set<string>();
/** Sessions whose stored rows could not be read: never overwrite them. */
const localRowsReadOnly = new Set<string>();
/** Dedup digest of the last persisted rows per session (the JSON itself is not kept). */
const localRowsSavedJson = new Map<string, string>();

/** Length + 53-bit cyrb53 hash: enough to tell "unchanged" from "changed". */
function jsonDigest(json: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < json.length; i++) {
		const ch = json.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return `${json.length}:${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`;
}
const localRowsTimers = new Map<string, Parameters<typeof clearTimeout>[0]>();

function mergeLocalRows(sessionId: string, stored: PersistedRow[], readable: boolean): void {
	localRowsLoading.delete(sessionId);
	if (readable) localRowsReadOnly.delete(sessionId);
	else localRowsReadOnly.add(sessionId);
	localRowsSavedJson.set(sessionId, jsonDigest(JSON.stringify(stored)));
	const echoes: UserEcho[] = [];
	const outputs: CommandOutputEntry[] = [];
	const flows: FlowNotice[] = [];
	for (const r of stored) {
		if (r.t === "echo") {
			echoes.push({
				...makeUserEcho(r.text, r.images),
				id: `local-echo-h${nextEchoId++}`,
				ts: r.ts,
				anchorId: r.anchorId,
			});
		} else if (r.t === "output") {
			outputs.push({
				id: nextOutputId++,
				ts: r.ts,
				anchorId: r.anchorId,
				text: r.text,
				kind: r.kind,
				...(r.command ? { command: r.command } : {}),
				...(r.status ? { status: r.status } : {}),
			});
		} else {
			flows.push({
				id: nextOutputId++,
				kind: r.kind,
				status: r.status,
				startedAt: r.startedAt,
				anchorId: r.anchorId,
				...(r.endedAt !== undefined ? { endedAt: r.endedAt } : {}),
				...(r.tokensBefore !== undefined ? { tokensBefore: r.tokensBefore } : {}),
				...(r.tokensAfter !== undefined ? { tokensAfter: r.tokensAfter } : {}),
				...(r.detail ? { detail: r.detail } : {}),
			});
		}
	}
	useLive.setState((s) => {
		const live = s.sessions[sessionId] ?? emptySessionLive();
		return {
			sessions: {
				...s.sessions,
				[sessionId]: {
					...live,
					localRowsLoaded: true,
					localEchoes: [...echoes, ...(live.localEchoes ?? [])].slice(-50),
					commandOutputs: [...outputs, ...live.commandOutputs].slice(-50),
					flowNotices: [...flows, ...live.flowNotices].slice(-20),
				},
			},
		};
	});
}

/** Read a session's stored local rows once and merge them into its live state. */
function loadLocalRows(sessionId: string): void {
	if (localRowsLoading.has(sessionId)) return;
	localRowsLoading.add(sessionId);
	ipcMod ??= import("../lib/ipc");
	void ipcMod
		.then((m) => m.localRowsGet(sessionId))
		.then(
			(raw) => mergeLocalRows(sessionId, parseLocalRows(raw), true),
			// Command missing (app not restarted since the update) or DB error:
			// keep working in memory, leave the stored rows untouched.
			() => mergeLocalRows(sessionId, [], false),
		);
}

function saveLocalRows(sessionId: string): void {
	const live = useLive.getState().sessions[sessionId];
	if (!live || localRowsReadOnly.has(sessionId)) return;
	const rows = serializeLocalRows(
		live.localEchoes ?? [],
		live.commandOutputs ?? [],
		live.flowNotices ?? [],
	);
	const digest = jsonDigest(JSON.stringify(rows));
	if (digest === localRowsSavedJson.get(sessionId)) return;
	localRowsSavedJson.set(sessionId, digest);
	ipcMod ??= import("../lib/ipc");
	void ipcMod.then((m) => m.localRowsSet(sessionId, rows)).catch(() => {});
}

// Persist each session's local rows whenever they change (debounced); a
// session with settled rows but no stored copy read yet is hydrated first.
useLive.subscribe((s, prev) => {
	for (const [sid, live] of Object.entries(s.sessions)) {
		const before = prev.sessions[sid];
		if (
			live.localEchoes === before?.localEchoes &&
			live.commandOutputs === before?.commandOutputs &&
			live.flowNotices === before?.flowNotices
		) {
			continue;
		}
		if (!live.localRowsLoaded) {
			const settled = serializeLocalRows(
				live.localEchoes ?? [],
				live.commandOutputs ?? [],
				live.flowNotices ?? [],
			);
			if (settled.length > 0) {
				loadLocalRows(sid);
			}
			continue;
		}
		clearTimeout(localRowsTimers.get(sid));
		localRowsTimers.set(
			sid,
			setTimeout(() => saveLocalRows(sid), 300),
		);
	}
});

let ipcMod: Promise<typeof IpcModule> | null = null;

let unlisteners: Promise<UnlistenFn>[] | null = null;

/** Wire `rpc:frame`/`rpc:process` once; safe to call at app start. */
export function startLiveEvents(): void {
	if (unlisteners) return;
	const { reduceFrame, reduceProcess } = useLive.getState();
	unlisteners = [
		onRpcFrame(
			(() => {
				const batcher = createFrameBatcher((payload) => {
					reduceFrame(payload);
					const frame = payload.frame;
					const ty =
						frame && typeof frame === "object" && "type" in frame && typeof frame.type === "string"
							? frame.type
							: undefined;
					if (
						ty === "model_changed" ||
						ty === "thinking_level_changed" ||
						ty === "turn_end" ||
						ty === "auto_compaction_end"
					) {
						ipcMod ??= import("../lib/ipc");
						void ipcMod
							.then((m) => m.rpcSend(payload.sessionId, { type: "get_state" }))
							.catch(() => {});
					}
				}, scheduleFlush);
				return batcher.push;
			})(),
		),
		onRpcProcess((payload) => {
			reduceProcess(payload);
			// On (re)attach, seed the subagent map: lifecycle frames before our
			// attach are missed and get_subagents lists the running ones.
			if (payload.running) {
				ipcMod ??= import("../lib/ipc");
				void ipcMod
					.then((m) =>
						m.rpcSend(payload.sessionId, { type: "get_subagents" }),
					)
					.catch(() => {});
				void ipcMod
					.then((m) =>
						m.rpcSend(payload.sessionId, { type: "get_state" }),
					)
					.catch(() => {});
			}
		}),
		onSessionsRemoved(pruneRemovedSessions),
	];
}

// Auto-wire inside the Tauri webview so module B doesn't touch main.tsx.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
	startLiveEvents();
}
