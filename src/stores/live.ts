/**
 * Per-session live RPC state (§11 B). [B]
 * Reduces `rpc:frame` / `rpc:process` events into per-session state:
 * streaming flag, last get_state snapshot, pending UI dialogs, subagents,
 * in-flight assistant message, slash commands, live tool executions,
 * and a transcript cache shared with the heatmap.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { PendingUiRequest, TranscriptItem } from "../lib/contracts";
import {
	onRpcFrame,
	onRpcProcess,
	type RpcFramePayload,
	type RpcProcessPayload,
} from "../lib/events";

export interface SlashCommand {
	name: string;
	description?: string;
	hint?: string;
	source?: string;
	aliases?: string[];
}

export interface SubagentInfo {
	status: string;
	label: string;
	[key: string]: unknown;
}

export interface LiveTool {
	toolCallId: string;
	toolName: string;
	args: unknown;
	intent: string | null;
	status: "running" | "done" | "error";
	/** Concatenated text of the (partial) result. */
	text: string;
	details: unknown | null;
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

export interface SessionLive {
	/** A turn is in flight. */
	streaming: boolean;
	/** Last get_state snapshot (from its `response` frame). */
	state: Record<string, unknown> | null;
	pendingUi: PendingUiRequest[];
	subagents: Record<string, SubagentInfo>;
	/** In-flight assistant message snapshot (message_update.message). */
	streamingMessage: AgentMessage | null;
	/** From available_commands_update. */
	commands: SlashCommand[];
	/** Live tool executions keyed by toolCallId (reset each turn). */
	tools: Record<string, LiveTool>;
	/** Transcript cache filled by SessionView; shared with HeatmapPanel. */
	items: TranscriptItem[];
	/** Byte offset for incremental transcript reads. */
	nextOffset: number;
	/** rpc:process liveness. */
	alive: boolean;
}

export const emptySessionLive = (): SessionLive => ({
	streaming: false,
	state: null,
	pendingUi: [],
	subagents: {},
	streamingMessage: null,
	commands: [],
	tools: {},
	items: [],
	nextOffset: 0,
	alive: false,
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
			return { ...live, streaming: true };
		case "message_update":
			return { ...live, streamingMessage: asFrame(frame.message) as AgentMessage };
		case "message_end":
			return { ...live, streamingMessage: null };
		case "tool_execution_start": {
			const id = str(frame.toolCallId);
			if (!id) return live;
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
					},
				},
			};
		}
		case "tool_execution_update": {
			const id = str(frame.toolCallId);
			const tool = live.tools[id];
			if (!tool) return live;
			return {
				...live,
				tools: {
					...live.tools,
					[id]: { ...tool, text: resultText(frame.partialResult) },
				},
			};
		}
		case "tool_execution_end": {
			const id = str(frame.toolCallId);
			const tool = live.tools[id];
			if (!tool) return live;
			return {
				...live,
				tools: {
					...live.tools,
					[id]: {
						...tool,
						status: frame.isError === true ? "error" : "done",
						text: resultText(frame.result) || tool.text,
						details: asFrame(frame.result).details ?? null,
					},
				},
			};
		}
		case "turn_end":
			// Tool results are persisted to the transcript; live tool map clears
			// on the next turn_start implicitly via tool_execution ids.
			return live;
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
			const commands = Array.isArray(frame.commands)
				? (frame.commands as SlashCommand[])
				: [];
			return { ...live, commands };
		}
		case "subagent_lifecycle":
		case "subagent_progress": {
			const id = str(frame.subagentId ?? frame.id);
			if (!id) return live;
			const prev = live.subagents[id] ?? { status: "", label: "" };
			return {
				...live,
				subagents: {
					...live.subagents,
					[id]: {
						...prev,
						...frame,
						status: str(frame.status ?? frame.event ?? prev.status),
						label: str(frame.label ?? frame.task ?? prev.label),
					},
				},
			};
		}
		case "response": {
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
						commands: Array.isArray(data.commands)
							? (data.commands as SlashCommand[])
							: live.commands,
					};
				case "get_subagents": {
					if (!Array.isArray(data.subagents)) return live;
					const subagents = { ...live.subagents };
					for (const raw of data.subagents) {
						const sa = asFrame(raw);
						const id = str(sa.id ?? sa.subagentId);
						if (!id) continue;
						subagents[id] = {
							...(subagents[id] ?? { status: "", label: "" }),
							...sa,
							status: str(sa.status),
							label: str(sa.label ?? sa.task),
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
	/** Replace/extend the transcript cache for a session. */
	setItems(sessionId: string, items: TranscriptItem[], nextOffset: number): void;
	appendItems(sessionId: string, items: TranscriptItem[], nextOffset: number): void;
	/** Scroll the message stream to a transcript item (used by HeatmapPanel). */
	scrollToItem(sessionId: string, itemId: string): void;
}

export const useLive = create<LiveState>((set) => ({
	sessions: {},
	reduceFrame: ({ sessionId, frame }) =>
		set((s) => ({
			sessions: {
				...s.sessions,
				[sessionId]: reduce(
					s.sessions[sessionId] ?? { ...emptySessionLive(), alive: true },
					asFrame(frame),
					sessionId,
				),
			},
		})),
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
					[sessionId]: { ...live, items, nextOffset },
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
					},
				},
			};
		}),
	scrollToItem: (_sessionId, itemId) => {
		if (typeof document === "undefined") return;
		document
			.getElementById(`msg-${itemId}`)
			?.scrollIntoView({ block: "center", behavior: "smooth" });
	},
}));

let unlisteners: Promise<UnlistenFn>[] | null = null;

/** Wire `rpc:frame`/`rpc:process` once; safe to call at app start. */
export function startLiveEvents(): void {
	if (unlisteners) return;
	const { reduceFrame, reduceProcess } = useLive.getState();
	unlisteners = [onRpcFrame(reduceFrame), onRpcProcess(reduceProcess)];
}

// Auto-wire inside the Tauri webview so module B doesn't touch main.tsx.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
	startLiveEvents();
}
