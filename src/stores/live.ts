/**
 * Per-session live RPC state (§11 B). [B]
 * Reduces `rpc:frame` / `rpc:process` events into per-session state:
 * streaming flag, last get_state snapshot, pending UI dialogs, subagents,
 * in-flight assistant message, slash commands, live tool executions,
 * and a transcript cache shared with the heatmap.
 */

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
	onRpcFrame,
	onRpcProcess,
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

/** Ephemeral output block produced by a slash command — omp `command_output`
 * frames or app-local results (e.g. the /status card). Rendered inline by
 * CommandOutputList, not persisted to the transcript. */
export interface CommandOutputEntry {
	id: number;
	/** Slash command name that produced it, when known. */
	command?: string;
	text: string;
	ts: number;
	kind: "omp" | "app";
}

// Re-exported for existing consumers (todos/logic.ts, TopCapsule).
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

/** Optimistic user bubble; `steer` marks an in-turn steer echo. */
export type UserEcho = TranscriptItem & { steer?: boolean };

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
	scrollRequest?: { itemId: string; timestamp: number } | null;
	/** Thinking timing for live turn: start/end epoch ms */
	thinkingStartedAt?: number | null;
	thinkingEndedAt?: number | null;
	/** Completed thinking durations by message/item id */
	thinkingDurations?: Record<string, { startedAt: number; endedAt: number }>;
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
let nextEchoId = 1;

const ECHO_IMAGE_RE =
	/\[(?:Image|图片)\s*#\d+(?:,\s*\d+x\d+)?(?::\s*([^\]]+))?\]|\[图片:\s*([^\]]+)\]|!\[[^\]]*\]\(([^)\s]+)\)/g;
/** Build the optimistic user bubble for a just-accepted prompt. */
export function makeUserEcho(
	text: string,
	images?: ImageAttachment[],
): TranscriptItem {
	const all: ImageAttachment[] = [...(images ?? [])];
	const known = new Set(all.map((img) => img.path).filter(Boolean));
	let i = all.length;
	for (const m of text.matchAll(ECHO_IMAGE_RE)) {
		const path = (m[1] ?? m[2] ?? m[3])?.trim() || null;
		if (path && known.has(path)) continue;
		if (path) known.add(path);
		all.push({ id: `pending-img-${i++}`, path, marker: m[0] });
	}
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

/** Consume one pending echo per confirmed user transcript item (FIFO). */
function reconcileEchoes(
	pending: TranscriptItem[],
	items: TranscriptItem[],
): TranscriptItem[] {
	if (!pending.length) return pending;
	let rest = pending;
	for (const it of items) {
		if (it.kind !== "user") continue;
		const i = rest.findIndex((e) => echoMatches(e.text ?? "", it.text ?? ""));
		if (i < 0) continue;
		rest = [...rest.slice(0, i), ...rest.slice(i + 1)];
	}
	return rest;
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
			const content = Array.isArray(msg.content) ? msg.content : [];
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
			// Skip ends for messages we never tracked (e.g. user echoes).
			if (!live.streamingMessage) return live;
			const ts =
				typeof frame.timestamp === "number" ? frame.timestamp : Date.now();
			const thinkingEndedAt =
				live.thinkingStartedAt && !live.thinkingEndedAt
					? ts
					: live.thinkingEndedAt;
			const msgId =
				str(frame.messageId) ||
				(live.streamingMessage && typeof live.streamingMessage.id === "string"
					? live.streamingMessage.id
					: "");
			const thinkingDurations = { ...(live.thinkingDurations ?? {}) };
			if (msgId && live.thinkingStartedAt && thinkingEndedAt) {
				thinkingDurations[msgId] = {
					startedAt: live.thinkingStartedAt,
					endedAt: thinkingEndedAt,
				};
			}
			return {
				...live,
				streamingMessage: null,
				thinkingEndedAt,
				thinkingDurations,
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
			return { ...live, streaming: false, streamingMessage: null, tools: {} };
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
		case "command_output": {
			// Slash commands executed by omp emit their text here instead of as a
			// normal message. Surface it as an ephemeral block in the thread.
			const text = str(frame.text);
			if (!text.trim()) return live;
			return {
				...live,
				commandOutputs: [
					...live.commandOutputs,
					{
						id: nextOutputId++,
						command: live.pendingCommand ?? undefined,
						text,
						ts: Date.now(),
						kind: "omp",
					} satisfies CommandOutputEntry,
				].slice(-50),
			};
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
		case "prompt_result": {
			const pendingCommand = live.pendingCommand ?? null;
			if (
				pendingCommand &&
				frame.status === "error" &&
				str(frame.error).trim()
			) {
				return {
					...live,
					streaming: false,
					streamingMessage: null,
					tools: {},
					pendingCommand: null,
					commandOutputs: [
						...live.commandOutputs,
						{
							id: nextOutputId++,
							command: pendingCommand,
							text: str(frame.error),
							ts: Date.now(),
							kind: "omp",
						} satisfies CommandOutputEntry,
					].slice(-50),
				};
			}
			return {
				...live,
				streaming: false,
				streamingMessage: null,
				tools: {},
				pendingCommand: null,
			};
		}
		case "error": {
			// Transport/process errors (e.g. socket closed) must not leave a turn stuck.
			return { ...live, streaming: false, streamingMessage: null, tools: {} };
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
					[id]: {
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
					},
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
					[id]: {
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
					},
				},
			};
		}
		case "response": {
			if (frame.command === "prompt") {
				const pendingCommand = live.pendingCommand ?? null;
				if (frame.success !== true) {
					return {
						...live,
						streaming: false,
						streamingMessage: null,
						tools: {},
						pendingCommand: null,
						commandOutputs:
							pendingCommand && str(frame.error).trim()
								? [
										...live.commandOutputs,
										{
											id: nextOutputId++,
											command: pendingCommand,
											text: str(frame.error),
											ts: Date.now(),
											kind: "omp",
										} satisfies CommandOutputEntry,
									].slice(-50)
								: live.commandOutputs,
					};
				}
				const data = asFrame(frame.data);
				if (data.agentInvoked === false && pendingCommand) {
					return { ...live, pendingCommand: null };
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
						subagents[id] = {
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
						};
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
	): void;
	/** Scroll the message stream to a transcript item (used by HeatmapPanel). */
	scrollToItem(sessionId: string, itemId: string): void;
	/** Consume/clear the scroll request for a session. */
	clearScrollRequest(sessionId: string): void;
	/** Remember the slash command just sent as a prompt so the following
	 * `command_output` frames can be labelled with it. */
	noteCommandSent(sessionId: string, name: string): void;
	/** Push an app-local command result (/status card, action confirmations). */
	addCommandOutput(sessionId: string, command: string, text: string): void;
	/** Dismiss one ephemeral command output block. */
	dismissCommandOutput(sessionId: string, id: number): void;
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
							items,
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
							items,
						),
					},
				},
			};
		}),
	addUserEcho: (sessionId, text, images, steer) =>
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			const trimmed = text.trim();
			if (!trimmed) return s;
			const echo: UserEcho = makeUserEcho(trimmed, images);
			// Only a steer into an in-flight turn is in-turn; anything else is a
			// next-turn bubble.
			if (steer && live.streaming) echo.steer = true;
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						pendingUserEchoes: [
							...live.pendingUserEchoes,
							echo,
						],
					},
				},
			};
		}),
	scrollToItem: (sessionId, itemId) => {
		set((s) => {
			const live = s.sessions[sessionId] ?? emptySessionLive();
			return {
				sessions: {
					...s.sessions,
					[sessionId]: {
						...live,
						scrollRequest: { itemId, timestamp: Date.now() },
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
						} satisfies CommandOutputEntry,
						].slice(-50),
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
}));

let ipcMod: Promise<typeof IpcModule> | null = null;

let unlisteners: Promise<UnlistenFn>[] | null = null;

/** Wire `rpc:frame`/`rpc:process` once; safe to call at app start. */
export function startLiveEvents(): void {
	if (unlisteners) return;
	const { reduceFrame, reduceProcess } = useLive.getState();
	unlisteners = [
		onRpcFrame((payload) => {
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
		}),
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
			}
		}),
	];
}

// Auto-wire inside the Tauri webview so module B doesn't touch main.tsx.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
	startLiveEvents();
}
