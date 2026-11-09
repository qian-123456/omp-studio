import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticAck, FrontendDiagnosticInput } from "./contracts";
import type * as DiagnosticModule from "./diagnostics";

const { rawInvoke } = vi.hoisted(() => ({ rawInvoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: rawInvoke }));

const SESSION = "11111111-1111-4111-8111-111111111111";
const OPERATION = "22222222-2222-4222-8222-222222222222";
const ACK: DiagnosticAck = { status: "accepted", accepted: 20, droppedEvents: 0, writeFailures: 0, rejectedEvents: 0 };
interface Batch { events: FrontendDiagnosticInput[]; droppedEvents: number }
interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
function deferred<T>(): Deferred<T> {
	// The application targets ES2021; Promise.withResolvers is not in its runtime contract.
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
function batches(): Batch[] {
	return rawInvoke.mock.calls.filter(([command]) => command === "diagnostics_record").map(([, args]) => args as Batch);
}
function observation(index = 0): FrontendDiagnosticInput {
	return { event: "frontend.state_reconciled", source: "state_reconcile", occurredAt: new Date().toISOString(), removedRows: index };
}
let diagnostics: typeof DiagnosticModule;
let browser: EventTarget;

beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
	vi.setSystemTime(new Date("2026-11-09T10:00:00Z"));
	browser = new EventTarget();
	vi.stubGlobal("window", browser);
	vi.stubGlobal("document", {});
	vi.stubGlobal("crypto", { randomUUID: vi.fn(() => OPERATION) });
	rawInvoke.mockReset();
	rawInvoke.mockImplementation((command: string) => Promise.resolve(command === "diagnostics_record" ? ACK : undefined));
	// A fresh module is intentional: these cases exercise the Document/HMR loading boundary.
	diagnostics = await import("./diagnostics");
});

afterEach(() => {
	diagnostics.installGlobalDiagnostics()();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("business invoke transparency", () => {
	it("preserves promise, fulfilled object, ArrayBuffer/Uint8Array and InvokeOptions identity", async () => {
		const value = { transcript: "PROMPT_SECRET", audio: "AUDIO_SECRET" };
		const result = Promise.resolve(value);
		rawInvoke.mockImplementation((command: string) => command === "diagnostics_record" ? Promise.resolve(ACK) : result);
		const options = { headers: { authorization: "TOKEN_SECRET" } };
		for (const audio of [new Uint8Array([1, 2]), new ArrayBuffer(4)]) {
			const returned = diagnostics.invokeWithDiagnostics("voice_transcribe", audio, options);
			expect(returned).toBe(result);
			const lastCall = rawInvoke.mock.calls[rawInvoke.mock.calls.length - 1];
			expect(lastCall).toEqual(["voice_transcribe", audio, options]);
			expect(lastCall[1]).toBe(audio);
			expect(lastCall[2]).toBe(options);
			expect(await returned).toBe(value);
		}
		await vi.runAllTimersAsync();
		expect(batches()).toHaveLength(0);
	});

	it.each(["rpc_start", "rpc_ensure_live", "rpc_send", "rpc_stop", "rpc_restart"])("shallow-copies only %s and never mutates its caller", async (command) => {
		const nested = Object.freeze({ type: "prompt", message: "PROMPT_SECRET" });
		const args = Object.freeze({ sessionId: SESSION, command: nested, diagnosticOperationId: "caller-owned" });
		await diagnostics.invokeWithDiagnostics(command, args);
		const forwarded = rawInvoke.mock.calls.find(([name]) => name === command)?.[1];
		expect(forwarded).not.toBe(args);
		expect(forwarded).toEqual({ ...args, diagnosticOperationId: OPERATION });
		expect(forwarded.command).toBe(nested);
		expect(args.diagnosticOperationId).toBe("caller-owned");
		await vi.runAllTimersAsync();
		expect(batches().flatMap((batch) => batch.events).map((event) => event.event)).toEqual(["frontend.ipc_started", "frontend.ipc_finished"]);
	});

	it("does not copy unrelated object arguments and records only their slow result", async () => {
		const pending = deferred<object>();
		const args = { settings: { token: "TOKEN_SECRET" } };
		rawInvoke.mockImplementation((command: string) => command === "diagnostics_record" ? Promise.resolve(ACK) : pending.promise);
		const result = diagnostics.invokeWithDiagnostics("save_settings", args);
		expect(rawInvoke.mock.calls[0][1]).toBe(args);
		await vi.advanceTimersByTimeAsync(2000);
		const value = {};
		pending.resolve(value);
		expect(await result).toBe(value);
		await vi.runAllTimersAsync();
		expect(batches()[0].events).toEqual([expect.objectContaining({ command: "save_settings", outcome: "ok", durationMs: 2000 })]);
		expect(JSON.stringify(batches())).not.toContain("TOKEN_SECRET");
	});

	it("keeps the same rejection even when diagnostic transport fails without recursion or business retry", async () => {
		const error = new Error("TOKEN_SECRET");
		const business = Promise.reject(error);
		rawInvoke.mockImplementation((command: string) => command === "diagnostics_record" ? Promise.reject(new Error("transport")) : business);
		const returned = diagnostics.invokeWithDiagnostics("rpc_send", { sessionId: SESSION, command: { type: "prompt", text: "PROMPT_SECRET" } });
		expect(returned).toBe(business);
		await expect(returned).rejects.toBe(error);
		await vi.runAllTimersAsync();
		expect(rawInvoke.mock.calls.filter(([command]) => command === "rpc_send")).toHaveLength(1);
		expect(batches()).toHaveLength(1);
		const events = batches()[0].events;
		expect(events[events.length - 1]).toMatchObject({ code: "unexpected_error", outcome: "error" });
		expect(JSON.stringify(batches())).not.toMatch(/TOKEN_SECRET|PROMPT_SECRET|transport/);
	});

	it("preserves successful RPC results when the diagnostic channel rejects", async () => {
		const value = { sessionId: SESSION };
		const business = Promise.resolve(value);
		rawInvoke.mockImplementation((command: string) => command === "diagnostics_record"
			? Promise.reject(new Error("DIAGNOSTIC_SECRET")) : business);
		const result = diagnostics.invokeWithDiagnostics("rpc_start", { opts: { prompt: "PROMPT_SECRET" } });
		expect(result).toBe(business);
		expect(await result).toBe(value);
		await vi.runAllTimersAsync();
		expect(rawInvoke.mock.calls.filter(([command]) => command === "rpc_start")).toHaveLength(1);
		expect(batches()).toHaveLength(1);
		expect(batches()[0].events[1]).toMatchObject({ outcome: "ok" });
		expect(JSON.stringify(batches())).not.toMatch(/DIAGNOSTIC_SECRET|PROMPT_SECRET/);
	});

	it("preserves synchronous throws and tolerates throwing metadata/error getters", () => {
		const thrown = { get message() { throw new Error("secret getter"); } };
		const args = Object.defineProperty({}, "sessionId", { enumerable: true, get() { throw thrown; } });
		rawInvoke.mockImplementation(() => { throw thrown; });
		try { diagnostics.invokeWithDiagnostics("rpc_send", args); expect.fail("expected business throw"); }
		catch (error) { expect(error).toBe(thrown); }
		expect(rawInvoke.mock.calls[0][1]).toBe(args);
		expect(() => diagnostics.captureDiagnosticError("root_boundary", thrown)).not.toThrow();
		const hostile = new Error();
		Object.defineProperty(hostile, "name", { get() { throw thrown; } });
		expect(() => diagnostics.captureDiagnosticError("root_boundary", hostile)).not.toThrow();
	});

	it.each(["get_state", "get_subagents"])("keeps successful fast %s polls quiet while still injecting operation context", async (type) => {
		await diagnostics.invokeWithDiagnostics("rpc_send", { sessionId: SESSION, command: { type } });
		await vi.runAllTimersAsync();
		expect(batches()).toHaveLength(0);
		expect(rawInvoke.mock.calls[0][1]).toMatchObject({ diagnosticOperationId: OPERATION });
	});

	it("reports only the finished event for slow or failed polls", async () => {
		const pending = deferred<unknown>();
		rawInvoke.mockImplementation((command: string) => command === "diagnostics_record" ? Promise.resolve(ACK) : pending.promise);
		const result = diagnostics.invokeWithDiagnostics("rpc_send", { sessionId: SESSION, command: { type: "get_state" } });
		await vi.advanceTimersByTimeAsync(2000);
		pending.resolve({ secret: "RESULT_SECRET" });
		await result;
		await vi.runAllTimersAsync();
		const failure = "session is not live";
		rawInvoke.mockImplementation((command: string) => command === "diagnostics_record" ? Promise.resolve(ACK) : Promise.reject(failure));
		await expect(diagnostics.invokeWithDiagnostics("rpc_send", { command: { type: "get_subagents" } })).rejects.toBe(failure);
		await vi.runAllTimersAsync();
		const events = batches().flatMap((batch) => batch.events);
		expect(events.map((event) => event.event)).toEqual(["frontend.ipc_finished", "frontend.ipc_finished"]);
		expect(events[1]).toMatchObject({ code: "not_live", outcome: "error" });
		expect(JSON.stringify(events)).not.toContain("RESULT_SECRET");
	});

	it.each([
		["CWD_MISSING:/Users/secret", "cwd_missing"], ["SESSION_HELD:123", "session_held"],
		["command must be a JSON object", "invalid_command"], ["session process is not running", "process_not_running"],
		["session stdin closed", "stdin_closed"], ["command timed out", "command_timeout"],
		["response channel dropped", "response_channel_closed"], ["permission denied TOKEN_SECRET", "unexpected_error"],
	])("classifies only the known failure %s", async (error, code) => {
		rawInvoke.mockImplementation((command: string) => command === "diagnostics_record" ? Promise.resolve(ACK) : Promise.reject(error));
		await expect(diagnostics.invokeWithDiagnostics("get_settings")).rejects.toBe(error);
		await vi.runAllTimersAsync();
		expect(batches()[0].events[0]).toMatchObject({ code, outcome: "error" });
	});

	it("does not turn normal directory selection cancellation into a failure", async () => {
		const cancelled = new Error("resume cancelled");
		cancelled.name = "ResumeCancelledError";
		diagnostics.captureDiagnosticError("app_boundary", cancelled);
		rawInvoke.mockImplementation((command: string) => command === "diagnostics_record" ? Promise.resolve(ACK) : Promise.reject(cancelled));
		await expect(diagnostics.invokeWithDiagnostics("rpc_ensure_live", { sessionId: SESSION })).rejects.toBe(cancelled);
		await vi.runAllTimersAsync();
		expect(batches().flatMap((batch) => batch.events).filter((event) => event.outcome === "error")).toEqual([]);
	});

	it("uses raw invoke for the diagnostic transport even when explicitly called through the wrapper", async () => {
		await diagnostics.invokeWithDiagnostics("diagnostics_record", { events: [], droppedEvents: 0 });
		await vi.runAllTimersAsync();
		expect(rawInvoke).toHaveBeenCalledTimes(1);
	});
});

describe("bounded queue and acknowledged loss", () => {
	it("flushes at 250ms and batches at most twenty without retrying a failed batch", async () => {
		diagnostics.recordDiagnostic(observation(1));
		await vi.advanceTimersByTimeAsync(249);
		expect(batches()).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(1);
		expect(batches()[0].events).toHaveLength(1);
		rawInvoke.mockRejectedValueOnce(new Error("disk unavailable"));
		for (let i = 0; i < 20; i++) diagnostics.recordDiagnostic(observation(i));
		await vi.advanceTimersByTimeAsync(1000);
		expect(batches()).toHaveLength(2);
		diagnostics.recordDiagnostic(observation(99));
		await vi.runAllTimersAsync();
		expect(batches()).toHaveLength(3);
		expect(batches()[2]).toMatchObject({ droppedEvents: 20, events: [expect.objectContaining({ removedRows: 99 })] });
		expect(batches().every((batch) => batch.events.length <= 20)).toBe(true);
	});

	it("drops the oldest beyond one hundred and preserves new drops across in-flight acknowledgments", async () => {
		const first = deferred<DiagnosticAck>();
		const second = deferred<DiagnosticAck>();
		rawInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		for (let i = 0; i < 140; i++) diagnostics.recordDiagnostic(observation(i));
		expect(batches()).toHaveLength(1);
		expect(batches()[0].events.map((event) => event.removedRows)).toEqual(Array.from({ length: 20 }, (_, i) => i));
		first.resolve(ACK);
		await vi.advanceTimersByTimeAsync(0);
		expect(batches()[1].droppedEvents).toBe(20);
		expect(batches()[1].events[0].removedRows).toBe(40);
		for (let i = 140; i < 170; i++) diagnostics.recordDiagnostic(observation(i));
		second.resolve(ACK);
		await vi.runAllTimersAsync();
		expect(batches()[2].droppedEvents).toBe(10);
		expect(batches()[2].events[0].removedRows).toBe(70);
		expect(batches().slice(3).every((batch) => batch.droppedEvents === 0)).toBe(true);
		expect(batches().flatMap((batch) => batch.events)).toHaveLength(140);
	});

	it("retains an unacknowledged drop snapshot plus the failed batch, then consumes a disabled acknowledgment", async () => {
		const first = deferred<DiagnosticAck>();
		const second = deferred<DiagnosticAck>();
		rawInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		for (let i = 0; i < 140; i++) diagnostics.recordDiagnostic(observation(i));
		first.resolve(ACK);
		await vi.advanceTimersByTimeAsync(0);
		expect(batches()[1].droppedEvents).toBe(20);
		rawInvoke.mockResolvedValue({ ...ACK, status: "disabled", accepted: 0 });
		second.reject("transport failure");
		await vi.runAllTimersAsync();
		expect(batches()[2].droppedEvents).toBe(40);
		expect(batches().slice(3).every((batch) => batch.droppedEvents === 0)).toBe(true);
		const count = batches().length;
		await vi.advanceTimersByTimeAsync(10000);
		expect(batches()).toHaveLength(count);
	});
});

describe("safe capture and singleton listeners", () => {
	it("stores only bounded application locations, never messages, arguments, absolute paths or URL secrets", async () => {
		const error = new Error("MESSAGE_SECRET TOKEN_SECRET");
		error.stack = [
			"Error: MESSAGE_SECRET src/forged.ts:1:2", "    at unsafe (/Users/private/src/secret.ts:4:5)",
			"    at unsafe (file:///Users/private/src/secret.ts:4:5)",
			"    at unsafe (https://localhost/src/../src/bad.ts:4:5)",
			"    at unsafe (https://localhost/src/%2e%2e/private.ts:4:5)",
			"    at fn(PROMPT_SECRET) (https://localhost/src/rejected.ts:4:5)",
			"    at load (https://localhost/src/App.tsx?token=TOKEN_SECRET#PRIVATE:12:34)",
			"render@tauri://localhost/assets/app-a1.js?prompt=PROMPT_SECRET:5:6",
			...Array.from({ length: 20 }, (_, i) => `    at next (src/view${i}.tsx:7:8)`),
		].join("\n");
		diagnostics.captureDiagnosticError("root_boundary", error, {
			sessionId: SESSION, command: "get_settings", sourceFile: "/Users/private/file", token: "TOKEN_SECRET",
			payload: { prompt: "PROMPT_SECRET", audio: "AUDIO_SECRET" },
		} as never);
		await vi.runAllTimersAsync();
		const event = batches()[0].events[0];
		expect(event).toMatchObject({ sourceFile: "src/App.tsx", sourceLine: 12, sourceColumn: 34, sessionId: SESSION, code: "js_error" });
		expect(event.frames?.split("\n")).toHaveLength(8);
		expect(event.frames).toContain("assets/app-a1.js:5:6");
		expect(new TextEncoder().encode(event.frames).length).toBeLessThanOrEqual(2048);
		expect(new TextEncoder().encode(JSON.stringify(event)).length).toBeLessThanOrEqual(4096);
		expect(JSON.stringify(batches())).not.toMatch(/MESSAGE_SECRET|TOKEN_SECRET|PROMPT_SECRET|AUDIO_SECRET|Users|PRIVATE|bad\.ts|private\.ts|rejected\.ts|payload/);
	});

	it.each([
		["WebKit", "render@tauri://localhost/src/Legitimate.tsx:12:34"],
		["Chromium", "    at render (https://localhost/src/Legitimate.tsx:12:34)"],
	])("excludes error headers and multiline message bait before capturing %s frames", async (_engine, legitimateFrame) => {
		const message = [
			"failed@src/HEADER_SECRET.ts:1:2",
			"continue@src/WEBKIT_MESSAGE_SECRET.ts:3:4",
			"    at continue (src/CHROMIUM_MESSAGE_SECRET.ts:5:6)",
			"src/BARE_MESSAGE_SECRET.ts:7:8",
		].join("\n");
		const error = new Error(message);
		error.stack = [
			`Error: ${message}`,
			"untrusted continuation@src/CONTINUATION_SECRET.ts:9:10",
			legitimateFrame,
		].join("\n");
		diagnostics.captureDiagnosticError("root_boundary", error);
		await vi.runAllTimersAsync();
		expect(batches()[0].events).toEqual([{
			event: "frontend.error", source: "root_boundary", occurredAt: "2026-11-09T10:00:00.000Z",
			code: "js_error", outcome: "error", sourceFile: "src/Legitimate.tsx", sourceLine: 12, sourceColumn: 34,
			frames: "src/Legitimate.tsx:12:34",
		}]);
		const transport = JSON.stringify(rawInvoke.mock.calls);
		for (const bait of ["HEADER_SECRET", "WEBKIT_MESSAGE_SECRET", "CHROMIUM_MESSAGE_SECRET", "BARE_MESSAGE_SECRET", "CONTINUATION_SECRET"]) {
			expect(transport).not.toContain(bait);
		}
	});

	it("whitelists direct records rather than forwarding unknown properties or unsafe locations", async () => {
		diagnostics.recordDiagnostic({ ...observation(), frames: "src/ok.ts:1:2\n/Users/private/no.ts:3:4\nsrc/../no.ts:5:6", sourceFile: "src/../../secret", sourceLine: 2, sessionId: "SECRET", command: "TOKEN SECRET", code: "SECRET", message: "MESSAGE_SECRET", error: { token: "TOKEN_SECRET" }, exitIntent: "USER_SECRET" } as never);
		diagnostics.recordDiagnostic({ ...observation(), event: "SECRET" } as never);
		await vi.runAllTimersAsync();
		expect(batches()[0].events).toEqual([{
			...observation(), occurredAt: "2026-11-09T10:00:00.000Z", frames: "src/ok.ts:1:2",
		}]);
	});

	it("bounds long paths/frames and never throws for primitive or hostile capture inputs", async () => {
		const error = new Error("SECRET");
		error.stack = Array.from({ length: 30 }, () => `    at fn (src/${"a".repeat(240)}.ts:1:2)`).join("\n");
		for (const value of [null, undefined, 1, "TOKEN_SECRET", Symbol("TOKEN_SECRET"), Object.create(null), error]) {
			expect(() => diagnostics.captureDiagnosticError("app_boundary", value)).not.toThrow();
		}
		const hostile = Object.defineProperty({}, "event", { get() { throw "SECRET"; } });
		expect(() => diagnostics.recordDiagnostic(hostile as never)).not.toThrow();
		await vi.runAllTimersAsync();
		for (const event of batches().flatMap((batch) => batch.events)) {
			expect(new TextEncoder().encode(event.frames ?? "").length).toBeLessThanOrEqual(2048);
		}
		expect(JSON.stringify(batches())).not.toContain("TOKEN_SECRET");
	});

	it("deduplicates the same object across boundaries for one second, not permanently", async () => {
		const error = new Error("SECRET");
		diagnostics.captureDiagnosticError("root_boundary", error);
		diagnostics.captureDiagnosticError("app_boundary", error);
		await vi.advanceTimersByTimeAsync(999);
		diagnostics.captureDiagnosticError("window_error", error);
		expect(batches().flatMap((batch) => batch.events)).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		diagnostics.captureDiagnosticError("window_error", error);
		await vi.runAllTimersAsync();
		expect(batches().flatMap((batch) => batch.events)).toHaveLength(2);
	});

	it("installs once across module reinstall, preserves default handlers, and disposes/reinstalls cleanly", async () => {
		const add = vi.spyOn(browser, "addEventListener");
		const remove = vi.spyOn(browser, "removeEventListener");
		const dispose = diagnostics.installGlobalDiagnostics();
		expect(diagnostics.installGlobalDiagnostics()).toBe(dispose);
		vi.resetModules();
		// Re-evaluation without disposal must reuse the existing Document singleton.
		const reinstalled = await import("./diagnostics");
		expect(reinstalled.installGlobalDiagnostics()).toBe(dispose);
		expect(add).toHaveBeenCalledTimes(2);
		const thrown = new Error("MESSAGE_SECRET");
		const errorEvent = Object.assign(new Event("error", { cancelable: true }), { error: thrown, filename: "https://localhost/src/main.tsx?token=TOKEN_SECRET", lineno: 3, colno: 4 });
		const rejection = Object.assign(new Event("unhandledrejection", { cancelable: true }), { reason: new Error("PROMISE_SECRET") });
		expect(browser.dispatchEvent(errorEvent)).toBe(true);
		expect(browser.dispatchEvent(rejection)).toBe(true);
		expect(errorEvent.defaultPrevented).toBe(false);
		expect(rejection.defaultPrevented).toBe(false);
		await vi.runAllTimersAsync();
		expect(batches().flatMap((batch) => batch.events).map((event) => event.code)).toEqual(["js_error", "promise_rejection"]);
		expect(JSON.stringify(batches())).not.toMatch(/MESSAGE_SECRET|PROMISE_SECRET|TOKEN_SECRET/);
		dispose();
		dispose();
		expect(remove).toHaveBeenCalledTimes(2);
		browser.dispatchEvent(Object.assign(new Event("error"), { error: new Error("after dispose") }));
		await vi.runAllTimersAsync();
		expect(batches()).toHaveLength(1);
		const newDispose = reinstalled.installGlobalDiagnostics();
		expect(newDispose).not.toBe(dispose);
		browser.dispatchEvent(Object.assign(new Event("error"), { error: new Error("new install") }));
		await vi.runAllTimersAsync();
		expect(batches()).toHaveLength(2);
		newDispose();
	});

	it("captures resource failures without reading sensitive element URLs", async () => {
		let handler!: EventListener;
		vi.spyOn(browser, "addEventListener").mockImplementation((type, callback) => {
			if (type === "error") handler = callback as EventListener;
		});
		diagnostics.installGlobalDiagnostics();
		const target = Object.defineProperty({}, "src", { get() { throw new Error("URL_TOKEN_SECRET"); } });
		const event = Object.defineProperty(new Event("error"), "target", { value: target });
		expect(() => handler(event)).not.toThrow();
		await vi.runAllTimersAsync();
		expect(batches()[0].events[0]).toMatchObject({ source: "resource_error", code: "resource_load_error" });
		expect(JSON.stringify(batches())).not.toContain("URL_TOKEN_SECRET");
	});
});
