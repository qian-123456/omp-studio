import { describe, expect, it, vi } from "vitest";
import { createThinkingLevelDeferrer } from "./thinkingLevelSelection";

function setup() {
	const compacting = new Set<string>();
	const listeners = new Set<() => void>();
	const rpcSend = vi.fn();
	const apply = (sessionId: string, level: string) =>
		rpcSend(sessionId, { type: "set_thinking_level", level });
	const select = createThinkingLevelDeferrer(
		(sessionId) => compacting.has(sessionId),
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	);
	const setCompacting = (sessionId: string, active: boolean) => {
		if (active) compacting.add(sessionId);
		else compacting.delete(sessionId);
		for (const listener of listeners) listener();
	};
	return { select, setCompacting, rpcSend, apply };
}

describe("thinking-level selection during compaction", () => {
	it("does not send the thinking-level RPC before compaction ends", () => {
		const { select, setCompacting, rpcSend, apply } = setup();
		setCompacting("s1", true);

		select("s1", "high", apply);

		expect(rpcSend).not.toHaveBeenCalled();
	});

	it("applies only the latest staged selection once after compaction", () => {
		const { select, setCompacting, rpcSend, apply } = setup();
		setCompacting("s1", true);

		select("s1", "high", apply);
		select("s1", "max", apply);
		expect(rpcSend).not.toHaveBeenCalled();

		setCompacting("s1", false);
		setCompacting("s1", false);

		expect(rpcSend).toHaveBeenCalledTimes(1);
		expect(rpcSend).toHaveBeenCalledWith("s1", { type: "set_thinking_level", level: "max" });
	});

	it("sends immediately while the session is idle", () => {
		const { select, rpcSend, apply } = setup();

		select("s1", "low", apply);

		expect(rpcSend).toHaveBeenCalledTimes(1);
		expect(rpcSend).toHaveBeenCalledWith("s1", { type: "set_thinking_level", level: "low" });
	});

	it("keeps pending selections isolated by session", () => {
		const { select, setCompacting, rpcSend, apply } = setup();
		setCompacting("s1", true);
		setCompacting("s2", true);

		select("s1", "high", apply);
		select("s2", "low", apply);
		expect(rpcSend).not.toHaveBeenCalled();

		setCompacting("s1", false);

		expect(rpcSend).toHaveBeenCalledTimes(1);
		expect(rpcSend).toHaveBeenCalledWith("s1", { type: "set_thinking_level", level: "high" });

		setCompacting("s2", false);

		expect(rpcSend).toHaveBeenCalledTimes(2);
		expect(rpcSend).toHaveBeenLastCalledWith("s2", { type: "set_thinking_level", level: "low" });
	});
});
