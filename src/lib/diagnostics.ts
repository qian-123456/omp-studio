import { invoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import type {
	DiagnosticAck, DiagnosticCode, DiagnosticContext, FrontendDiagnosticInput,
	FrontendDiagnosticSource,
} from "./contracts";

export type ErrorSource = Extract<FrontendDiagnosticSource,
	"bootstrap" | "root_boundary" | "app_boundary" | "aside_boundary" |
	"window_error" | "unhandled_rejection" | "resource_error">;

const RPC_COMMANDS: Record<string, true> = {
	rpc_start: true, rpc_ensure_live: true, rpc_send: true, rpc_stop: true, rpc_restart: true,
};
const EVENTS: Record<string, true> = {
	"frontend.ipc_started": true, "frontend.ipc_finished": true, "frontend.error": true,
	"frontend.state_reconciled": true, "frontend.process_observed": true,
	"frontend.reconnect_started": true, "frontend.reconnect_finished": true,
};
const SOURCES: Record<string, true> = {
	bootstrap: true, root_boundary: true, app_boundary: true, aside_boundary: true, window_error: true,
	unhandled_rejection: true, resource_error: true, ipc: true, state_reconcile: true,
	process_observed: true, reconnect: true,
};
const CODES: Record<string, true> = {
	invalid_command: true, not_live: true, process_not_running: true, stdin_closed: true,
	command_timeout: true, response_channel_closed: true, upstream_rejected: true, spawn_failed: true,
	startup_timeout: true, protocol_invalid: true, io_permission_denied: true, io_not_found: true,
	io_other: true, cwd_missing: true, session_held: true, unexpected_error: true,
	js_error: true, promise_rejection: true, resource_load_error: true,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMAND = /^[a-z][a-z0-9_]{0,63}$/;
const RUNTIME = Symbol.for("ompws.frontend-diagnostics.v1");
interface Runtime {
	queue: FrontendDiagnosticInput[];
	dropped: number;
	inFlight: boolean;
	timer?: ReturnType<typeof setTimeout>;
	seen: WeakMap<object, number>;
	dispose?: () => void;
	closed: boolean;
}
type RuntimeHost = { [RUNTIME]?: Runtime };

function runtime(): Runtime {
	// A Document owns its queue and listeners, including across module re-evaluation.
	const host = (typeof document === "undefined" ? globalThis : document) as RuntimeHost;
	return host[RUNTIME] ??= { queue: [], dropped: 0, inFlight: false, seen: new WeakMap(), closed: false };
}

function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0xffffffff;
}

function sourceFile(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_./@+-]+$/.test(value)) return;
	if (value.split("/").some((part) => !part || part === "." || part === "..")) return;
	if ((value.startsWith("src/") && value.length > 4) || /^assets\/[^/]+$/.test(value)) return value;
}

function location(value: string): { sourceFile: string; sourceLine: number; sourceColumn: number } | undefined {
	const match = /^(.*):(\d+):(\d+)$/.exec(value);
	if (!match) return;
	let path = match[1];
	if (path.split(/[?#]/, 1)[0].split("/").some((part) => part === ".." || part === ".")) return;
	// Only application-root URL paths are useful. Never salvage src/ from a home path.
	if (/^(https?|tauri|asset):\/\//.test(path)) {
		try {
			const pathname = new URL(path).pathname;
			if (!pathname.startsWith("/src/") && !pathname.startsWith("/assets/")) return;
			path = pathname.slice(1);
		} catch { return; }
	} else {
		path = path.split(/[?#]/, 1)[0];
	}
	const file = sourceFile(path);
	const line = Number(match[2]);
	const column = Number(match[3]);
	if (file && positive(line) && positive(column)) return { sourceFile: file, sourceLine: line, sourceColumn: column };
}

function safeFrames(stack: unknown, stackSyntax: boolean, message = "", name = "Error"): string | undefined {
	if (typeof stack !== "string") return;
	const frames: string[] = [];
	let bytes = 0;
	// Bound work as well as output, even for an adversarial Error.stack.
	for (const line of stack.slice(0, 32768).split("\n").slice(0, 128)) {
		let candidate = line;
		if (stackSyntax) {
			// A message can contain frame-shaped text, including complete multiline
			// Chromium/WebKit frames. Exclude it before interpreting stack syntax.
			const text = line.trim();
			if (!text || message.includes(text) || text === name || text.startsWith(`${name}:`)
				|| /^(?:[\w$.]*Error|Exception)(?::|$)/.test(text)) continue;
			const frame = /^\s*at (?:[^()]* \()?(.+?:\d+:\d+)\)?\s*$/.exec(line)
				?? /^(?:[^\s@:]+|global code|module code)?@(.+?:\d+:\d+)\s*$/.exec(line);
			if (!frame) continue;
			candidate = frame[1];
		}
		const parsed = location(candidate);
		if (!parsed) continue;
		const frame = `${parsed.sourceFile}:${parsed.sourceLine}:${parsed.sourceColumn}`;
		if (bytes + frame.length + (frames.length ? 1 : 0) > 2048) break;
		frames.push(frame);
		bytes += frame.length + (frames.length > 1 ? 1 : 0);
		if (frames.length === 8) break;
	}
	return frames.length ? frames.join("\n") : undefined;
}

function safeContext(input: DiagnosticContext): DiagnosticContext {
	const result: DiagnosticContext = {};
	for (const key of ["operationId", "sessionId"] as const) {
		const value = input[key];
		if (typeof value === "string" && UUID.test(value)) result[key] = value;
	}
	if (typeof input.command === "string" && COMMAND.test(input.command)) result.command = input.command;
	if (input.code && CODES[input.code] === true) result.code = input.code;
	if (input.outcome && ["ok", "error", "reused", "resumed", "observed"].includes(input.outcome)) result.outcome = input.outcome;
	if (typeof input.durationMs === "number" && Number.isFinite(input.durationMs) && input.durationMs >= 0 && input.durationMs <= 18446744073709551615) result.durationMs = input.durationMs;
	const file = sourceFile(input.sourceFile);
	if (file) {
		result.sourceFile = file;
		if (positive(input.sourceLine)) result.sourceLine = input.sourceLine;
		if (positive(input.sourceColumn)) result.sourceColumn = input.sourceColumn;
	}
	for (const key of ["alive", "streaming"] as const) {
		if (typeof input[key] === "boolean") result[key] = input[key];
	}
	if (typeof input.removedRows === "number" && Number.isInteger(input.removedRows) && input.removedRows >= 0 && input.removedRows <= 0xffffffff) result.removedRows = input.removedRows;
	if (typeof input.exitCode === "number" && Number.isInteger(input.exitCode) && input.exitCode >= -2147483648 && input.exitCode <= 2147483647) result.exitCode = input.exitCode;
	if (input.exitIntent && ["stop", "restart", "other"].includes(input.exitIntent)) result.exitIntent = input.exitIntent;
	return result;
}

function schedule(state: Runtime): void {
	if (state.closed || state.inFlight || state.timer !== undefined || !state.queue.length) return;
	state.timer = setTimeout(() => {
		state.timer = undefined;
		flush(state);
	}, state.queue.length >= 20 ? 0 : 250);
}

function flush(state: Runtime): void {
	if (state.closed || state.inFlight || !state.queue.length) return;
	clearTimeout(state.timer);
	state.timer = undefined;
	const events = state.queue.splice(0, 20);
	const reportedDrops = state.dropped;
	state.inFlight = true;
	const finish = (acknowledged: boolean) => {
		// Subtract only the snapshot: overflow may have added drops during this invoke.
		if (acknowledged) state.dropped = Math.max(0, state.dropped - reportedDrops);
		else state.dropped += events.length;
		state.inFlight = false;
		schedule(state);
	};
	try {
		void invoke<DiagnosticAck>("diagnostics_record", { events, droppedEvents: reportedDrops }).then(
			(ack) => finish(ack?.status === "accepted" || ack?.status === "disabled"),
			() => finish(false),
		).catch(() => { /* Reporting must never become an unhandled rejection. */ });
	} catch {
		finish(false);
	}
}

/** Copies only the approved scalar schema; arbitrary input properties never reach IPC. */
export function recordDiagnostic(input: FrontendDiagnosticInput): void {
	try {
		if (EVENTS[input.event] !== true || SOURCES[input.source] !== true) return;
		if (typeof input.occurredAt !== "string" || input.occurredAt.length > 40 || !input.occurredAt.endsWith("Z") || !/^\d{4}-\d\d-\d\dT/.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt))) return;
		const event: FrontendDiagnosticInput = {
			...safeContext(input), event: input.event, occurredAt: input.occurredAt, source: input.source,
		};
		const frames = safeFrames(input.frames, false);
		if (frames) event.frames = frames;
		const state = runtime();
		if (new TextEncoder().encode(JSON.stringify(event)).byteLength > 4096) { state.dropped++; return; }
		if (state.queue.length === 100) { state.queue.shift(); state.dropped++; }
		state.queue.push(event);
		if (state.queue.length >= 20) flush(state);
		else schedule(state);
	} catch { /* Diagnostics cannot alter a business operation. */ }
}

function classify(error: unknown): DiagnosticCode {
	let message: unknown;
	try { message = typeof error === "string" ? error : error instanceof Error ? error.message : undefined; }
	catch { return "unexpected_error"; }
	if (typeof message !== "string") return "unexpected_error";
	if (message?.startsWith("CWD_MISSING:")) return "cwd_missing";
	if (message?.startsWith("SESSION_HELD:")) return "session_held";
	switch (message) {
		case "command must be a JSON object": return "invalid_command";
		case "session is not live": case "session not live after restart": return "not_live";
		case "session process is not running": return "process_not_running";
		case "session stdin closed": return "stdin_closed";
		case "command timed out": return "command_timeout";
		case "response channel dropped": return "response_channel_closed";
		default: return "unexpected_error";
	}
}

export function captureDiagnosticError(source: ErrorSource, error: unknown, context: DiagnosticContext = {}): void {
	try {
		// Importing ensureLive here would pull the UI/store graph into the capture boundary.
		try {
			if (error instanceof Error && error.name === "ResumeCancelledError") return;
		} catch { /* A hostile name getter does not make an error unreportable. */ }
		const state = runtime();
		if ((typeof error === "object" && error !== null) || typeof error === "function") {
			const last = state.seen.get(error);
			const now = performance.now();
			if (last !== undefined && now - last < 1000) return;
			state.seen.set(error, now);
		}
		const code = source === "resource_error" ? "resource_load_error"
			: source === "unhandled_rejection" ? "promise_rejection" : "js_error";
		let frames: string | undefined;
		try { frames = error instanceof Error ? safeFrames(error.stack, true, error.message, error.name) : undefined; }
		catch { /* Keep the event even when its source location is unavailable. */ }
		const first = frames ? location(frames.split("\n", 1)[0]) : undefined;
		recordDiagnostic({ ...safeContext(context), ...first, event: "frontend.error", source,
			occurredAt: new Date().toISOString(), code, outcome: "error", ...(frames ? { frames } : {}) });
	} catch { /* Do not inspect/stringify arbitrary rejection objects. */ }
}

/** Preserves the original promise, arguments/options, fulfilled value and rejection identity. */
export const invokeWithDiagnostics: typeof invoke = <T>(command: string, args?: InvokeArgs, options?: InvokeOptions) => {
	let context: DiagnosticContext | undefined;
	let quietPoll = false;
	let correlated = false;
	let started = 0;
	let forwarded = args;
	try {
		// The diagnostic transport never diagnoses itself, even if called through this export.
		if (command !== "diagnostics_record") {
			const operationId = crypto.randomUUID();
			correlated = RPC_COMMANDS[command] === true;
			context = { operationId, command };
			started = performance.now();
			if (args && typeof args === "object" && !(args instanceof ArrayBuffer) && !ArrayBuffer.isView(args)) {
				const object = args as Record<string, unknown>;
				if (typeof object.sessionId === "string" && UUID.test(object.sessionId)) context.sessionId = object.sessionId;
				if (command === "rpc_send") {
					const type = (object.command as { type?: unknown } | null)?.type;
					quietPoll = type === "get_state" || type === "get_subagents";
				}
				if (correlated) forwarded = { ...object, diagnosticOperationId: operationId };
			} else if (correlated && args === undefined) forwarded = { diagnosticOperationId: operationId };
			if (correlated && !quietPoll) recordDiagnostic({ ...context, event: "frontend.ipc_started", source: "ipc", occurredAt: new Date().toISOString() });
		}
	} catch { /* Metadata failure must still invoke the original business command. */ }
	const finish = (failed: boolean, error?: unknown) => {
		try {
			if (!context || (error instanceof Error && error.name === "ResumeCancelledError")) return;
			const durationMs = Math.max(0, performance.now() - started);
			if (failed || (correlated && !quietPoll) || durationMs >= 2000) {
				recordDiagnostic({ ...context, event: "frontend.ipc_finished", source: "ipc", occurredAt: new Date().toISOString(),
					durationMs, outcome: failed ? "error" : "ok", ...(failed ? { code: classify(error) } : {}) });
			}
		} catch { /* Preserve the original result, even for hostile Error getters. */ }
	};
	let result: Promise<T>;
	try {
		result = invoke<T>(command, forwarded, options);
	} catch (error) {
		finish(true, error);
		throw error;
	}
	try {
		void result.then(() => finish(false), (error: unknown) => finish(true, error)).catch(() => {});
	} catch { /* A failed observer must not replace the original promise. */ }
	return result;
};

export function installGlobalDiagnostics(): () => void {
	try {
		const state = runtime();
		if (state.dispose) return state.dispose;
		if (typeof window === "undefined") return () => {};
		const target = window;
		const host = (typeof document === "undefined" ? globalThis : document) as RuntimeHost;
		const captureOptions = { capture: true };
		const onError = (event: Event) => {
			if (state.closed) return;
			if (event.target && event.target !== target) {
				// Resource URLs/element attributes can contain credentials; inspect neither.
				captureDiagnosticError("resource_error", event);
				return;
			}
			const error = event as ErrorEvent;
			let context: DiagnosticContext = {};
			try {
				const file = location(`${error.filename}:${error.lineno}:${error.colno}`);
				if (file) context = file;
			} catch { /* Untrusted source location. */ }
			captureDiagnosticError("window_error", error.error ?? event, context);
		};
		const onRejection = (event: PromiseRejectionEvent) => {
			if (!state.closed) captureDiagnosticError("unhandled_rejection", event.reason);
		};
		target.addEventListener("error", onError, captureOptions);
		target.addEventListener("unhandledrejection", onRejection);
		const dispose = () => {
			if (state.closed) return;
			state.closed = true;
			target.removeEventListener("error", onError, captureOptions);
			target.removeEventListener("unhandledrejection", onRejection);
			clearTimeout(state.timer);
			state.queue.length = 0;
			if (host[RUNTIME] === state) delete host[RUNTIME];
		};
		state.dispose = dispose;
		return dispose;
	} catch { return () => {}; }
}

if (import.meta.hot) import.meta.hot.dispose(() => {
	const host = (typeof document === "undefined" ? globalThis : document) as RuntimeHost;
	host[RUNTIME]?.dispose?.();
});
