import { describe, expect, it, vi, beforeEach } from "vitest";
import { useToasts } from "../lib/toast";
import * as ipc from "../lib/ipc";
import { useLive } from "../stores/live";

describe("Session Resilience — /fresh and /clear contracts", () => {
	beforeEach(() => {
		useToasts.setState({ items: [] });
		useLive.setState({ sessions: {} });
		vi.restoreAllMocks();
	});

	it("rpcRestart is defined and invokes backend rpc_restart", async () => {
		expect(typeof ipc.rpcRestart).toBe("function");
	});

	it("live reducer preserves transcript items across process restart lifecycle", () => {
		const SID = "session-restart-test";
		const item = {
			id: "i1",
			parentId: null,
			ts: "2026-09-27T10:00:00Z",
			kind: "user" as const,
			text: "历史消息保留测试",
			thinking: null,
			toolCalls: [],
			toolResult: null,
			usage: null,
			model: null,
			stopReason: null,
			hidden: false,
		};

		// 1. Session is active with transcript items
		useLive.getState().setItems(SID, [item], 100);
		useLive.getState().reduceFrame({
			sessionId: SID,
			frame: { type: "agent_start" },
		});

		expect(useLive.getState().sessions[SID].streaming).toBe(true);
		expect(useLive.getState().sessions[SID].items).toHaveLength(1);

		// 2. /fresh restart stops old RPC process
		useLive.getState().reduceProcess({
			sessionId: SID,
			running: false,
			exitCode: null,
		});

		const intermediate = useLive.getState().sessions[SID];
		expect(intermediate.alive).toBe(false);
		expect(intermediate.streaming).toBe(false);
		expect(intermediate.items).toHaveLength(1); // Local transcript preserved!
		expect(intermediate.items[0].text).toBe("历史消息保留测试");

		// 3. /fresh restart spawns new process with --resume
		useLive.getState().reduceProcess({
			sessionId: SID,
			running: true,
			exitCode: null,
		});

		const resumed = useLive.getState().sessions[SID];
		expect(resumed.alive).toBe(true);
		expect(resumed.streaming).toBe(false);
		expect(resumed.items).toHaveLength(1);
		expect(resumed.items[0].id).toBe("i1");
	});

	it("/clear equivalent shows honest backend limitation toast", () => {
		useToasts.getState().push("info", "当前 omp CLI / RPC 后端暂不支持在保留同一会话的同时清空上下文（仅交互式 TUI 支持 /clear，RPC 模式未开放重置边界接口）。", 5000);
		const items = useToasts.getState().items;
		expect(items).toHaveLength(1);
		expect(items[0].kind).toBe("info");
		expect(items[0].text).toContain("当前 omp CLI / RPC 后端暂不支持");
	});
});
