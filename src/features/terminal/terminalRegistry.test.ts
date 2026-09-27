import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	destroySessionTerminal,
	terminalRegistry,
	type TerminalSessionEntry,
} from "./terminalRegistry";

vi.mock("../../lib/ipc", () => ({
	termClose: vi.fn().mockResolvedValue(undefined),
}));

describe("terminalRegistry", () => {
	beforeEach(() => {
		terminalRegistry.clear();
		vi.clearAllMocks();
	});

	it("destroys and cleans up terminal entry properly", () => {
		const unlistener1 = vi.fn();
		const unlistener2 = vi.fn();
		const dataDispose = vi.fn();
		const termDispose = vi.fn();

		const entry = {
			termId: "term-1",
			term: { dispose: termDispose } as unknown,
			fit: {} as unknown,
			search: {} as unknown,
			phase: "ready",
			exitCode: null,
			error: null,
			unlisteners: [unlistener1, unlistener2],
			dataSub: { dispose: dataDispose },
		} as TerminalSessionEntry;

		terminalRegistry.set("session-1", entry);
		expect(terminalRegistry.has("session-1")).toBe(true);

		destroySessionTerminal("session-1");

		expect(unlistener1).toHaveBeenCalledTimes(1);
		expect(unlistener2).toHaveBeenCalledTimes(1);
		expect(dataDispose).toHaveBeenCalledTimes(1);
		expect(termDispose).toHaveBeenCalledTimes(1);
		expect(terminalRegistry.has("session-1")).toBe(false);
	});

	it("no-ops safely if session is not in registry", () => {
		expect(() => destroySessionTerminal("non-existent")).not.toThrow();
	});

	it("handles throwing unlisteners and disposal errors gracefully", () => {
		const faultyUnlistener = vi.fn().mockImplementation(() => {
			throw new Error("unlisten failed");
		});
		const faultyDispose = vi.fn().mockImplementation(() => {
			throw new Error("dispose failed");
		});

		const entry = {
			termId: "term-2",
			term: { dispose: faultyDispose } as unknown,
			fit: {} as unknown,
			search: {} as unknown,
			phase: "ready",
			exitCode: null,
			error: null,
			unlisteners: [faultyUnlistener],
			dataSub: {
				dispose: () => {
					throw new Error("dataSub failed");
				},
			},
		} as TerminalSessionEntry;

		terminalRegistry.set("session-2", entry);
		expect(() => destroySessionTerminal("session-2")).not.toThrow();
		expect(terminalRegistry.has("session-2")).toBe(false);
	});
});
