/**
 * Typed `listen` helpers for frontend events (docs/ARCHITECTURE.md §5).
 * Event names are exact.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ServiceInfo, SessionMeta, TodoCounts } from "./contracts";

/** { sessionId, frame } */
export interface RpcFramePayload {
	sessionId: string;
	frame: unknown;
}

/** { sessionId, running, exitCode } */
export interface RpcProcessPayload {
	sessionId: string;
	running: boolean;
	exitCode: number | null;
}

/** { termId, data } — data is base64. */
export interface TerminalDataPayload {
	termId: string;
	data: string;
}

/** { termId, code } */
export interface TerminalExitPayload {
	termId: string;
	code: number | null;
}

/** { runId, line } */
export interface TmLogPayload {
	runId: string;
	line: string;
}

export const onSessionsUpdated = (
	cb: (sessions: SessionMeta[]) => void,
): Promise<UnlistenFn> =>
	listen<SessionMeta[]>("sessions:updated", (e) => cb(e.payload));

export const onSessionsRemoved = (
	cb: (ids: string[]) => void,
): Promise<UnlistenFn> =>
	listen<string[]>("sessions:removed", (e) => cb(e.payload));

export const onRpcFrame = (
	cb: (payload: RpcFramePayload) => void,
): Promise<UnlistenFn> =>
	listen<RpcFramePayload>("rpc:frame", (e) => cb(e.payload));

export const onRpcProcess = (
	cb: (payload: RpcProcessPayload) => void,
): Promise<UnlistenFn> =>
	listen<RpcProcessPayload>("rpc:process", (e) => cb(e.payload));

export const onTodosChanged = (
	cb: (counts: TodoCounts) => void,
): Promise<UnlistenFn> =>
	listen<TodoCounts>("todos:changed", (e) => cb(e.payload));

export const onBacklogChanged = (cb: () => void): Promise<UnlistenFn> =>
	listen<null>("backlog:changed", () => cb());

export const onServicesChanged = (
	cb: (services: ServiceInfo[]) => void,
): Promise<UnlistenFn> =>
	listen<ServiceInfo[]>("services:changed", (e) => cb(e.payload));

export const onTerminalData = (
	cb: (payload: TerminalDataPayload) => void,
): Promise<UnlistenFn> =>
	listen<TerminalDataPayload>("terminal:data", (e) => cb(e.payload));

export const onTerminalExit = (
	cb: (payload: TerminalExitPayload) => void,
): Promise<UnlistenFn> =>
	listen<TerminalExitPayload>("terminal:exit", (e) => cb(e.payload));

export const onTmLog = (
	cb: (payload: TmLogPayload) => void,
): Promise<UnlistenFn> => listen<TmLogPayload>("tm:log", (e) => cb(e.payload));

/** Global quick-capture shortcut fired. */
export const onQuickCapture = (cb: () => void): Promise<UnlistenFn> =>
	listen<null>("quick-capture", () => cb());
