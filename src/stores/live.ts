/**
 * Per-session live RPC state (§11 B). [B]
 * Shape is fixed at scaffold time; module B fills the reducers.
 */

import { create } from "zustand";
import type { PendingUiRequest } from "../lib/contracts";
import type { RpcFramePayload, RpcProcessPayload } from "../lib/events";

export interface SubagentInfo {
	status: string;
	label: string;
	[key: string]: unknown;
}

export interface SessionLive {
	/** A turn is in flight. */
	streaming: boolean;
	/** Last get_state snapshot. */
	state: Record<string, unknown> | null;
	pendingUi: PendingUiRequest[];
	subagents: Record<string, SubagentInfo>;
	/** In-flight assistant message snapshot (message_update.message). */
	streamingMessage: unknown | null;
	/** From available_commands_update. */
	commands: string[];
}

export const emptySessionLive = (): SessionLive => ({
	streaming: false,
	state: null,
	pendingUi: [],
	subagents: {},
	streamingMessage: null,
	commands: [],
});

export interface LiveState {
	sessions: Record<string, SessionLive>;
	/** Reduce one rpc:frame event into session state. */
	reduceFrame(payload: RpcFramePayload): void;
	/** Reduce one rpc:process event into session state. */
	reduceProcess(payload: RpcProcessPayload): void;
	/** Scroll the message stream to a transcript item (used by HeatmapPanel). */
	scrollToItem(sessionId: string, itemId: string): void;
}

export const useLive = create<LiveState>(() => ({
	sessions: {},
	// TODO(module B): implement reducers over rpc:frame / rpc:process.
	reduceFrame: () => {},
	reduceProcess: () => {},
	scrollToItem: () => {},
}));
