import { beforeEach, describe, expect, it } from "vitest";
import { useLive } from "./live";

const SID = "s1";

const frame = (f: Record<string, unknown>) =>
	useLive.getState().reduceFrame({ sessionId: SID, frame: f });

const live = () => useLive.getState().sessions[SID];

beforeEach(() => {
	useLive.setState({ sessions: {} });
});

describe("live reducer — streaming lifecycle", () => {
	it("agent_start / turn_start set streaming", () => {
		frame({ type: "agent_start" });
		expect(live().streaming).toBe(true);
		frame({ type: "agent_end", isTerminal: true });
		expect(live().streaming).toBe(false);
		frame({ type: "turn_start" });
		expect(live().streaming).toBe(true);
	});

	it("non-terminal agent_end keeps streaming", () => {
		frame({ type: "agent_start" });
		frame({ type: "agent_end", isTerminal: false });
		expect(live().streaming).toBe(true);
		frame({ type: "agent_end", isTerminal: true });
		expect(live().streaming).toBe(false);
	});

	it("message_update stores the in-flight snapshot; message_end clears it", () => {
		const msg = { role: "assistant", content: [{ type: "text", text: "hi" }] };
		frame({ type: "message_update", message: msg });
		expect(live().streamingMessage).toEqual(msg);
		frame({ type: "message_end", message: msg });
		expect(live().streamingMessage).toBeNull();
	});
});

describe("live reducer — pending UI", () => {
	it("tracks select/confirm/input/editor, ignores setWidget", () => {
		frame({
			type: "extension_ui_request",
			id: "w1",
			method: "setWidget",
			widgetKey: "autoresearch",
		});
		expect(live().pendingUi).toHaveLength(0);
		frame({
			type: "extension_ui_request",
			id: "u1",
			method: "select",
			title: "Allow tool: bash",
			options: ["Approve", "Deny"],
		});
		frame({ type: "extension_ui_request", id: "u2", method: "confirm" });
		expect(live().pendingUi).toHaveLength(2);
		expect(live().pendingUi[0].sessionId).toBe(SID);
	});

	it("cancel removes the matching request; dismissUi removes after respond", () => {
		frame({ type: "extension_ui_request", id: "u1", method: "input" });
		frame({ type: "extension_ui_request", id: "u2", method: "confirm" });
		frame({ type: "extension_ui_request", id: "u1", method: "cancel" });
		expect(live().pendingUi).toHaveLength(1);
		useLive.getState().dismissUi(SID, "u2");
		expect(live().pendingUi).toHaveLength(0);
	});
});

describe("live reducer — subagents + commands + tools", () => {
	it("subagent_lifecycle/progress populate subagents", () => {
		frame({
			type: "subagent_lifecycle",
			subagentId: "sa1",
			event: "start",
			label: "explorer",
		});
		expect(live().subagents.sa1.status).toBe("start");
		expect(live().subagents.sa1.label).toBe("explorer");
		frame({
			type: "subagent_progress",
			subagentId: "sa1",
			status: "running",
			progress: 0.5,
		});
		expect(live().subagents.sa1.status).toBe("running");
		expect(live().subagents.sa1.label).toBe("explorer");
	});

	it("available_commands_update fills commands", () => {
		frame({
			type: "available_commands_update",
			commands: [{ name: "compact", description: "Compact" }],
		});
		expect(live().commands.map((c) => c.name)).toContain("compact");
	});

	it("tool execution lifecycle tracks status and result text", () => {
		frame({
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "bash",
			args: { command: "echo hi" },
			intent: "Run echo",
		});
		expect(live().tools.t1.status).toBe("running");
		frame({
			type: "tool_execution_end",
			toolCallId: "t1",
			toolName: "bash",
			isError: false,
			result: { content: [{ type: "text", text: "hi\n" }], details: {} },
		});
		expect(live().tools.t1.status).toBe("done");
		expect(live().tools.t1.text).toBe("hi\n");
	});

	it("get_state response fills state", () => {
		frame({
			type: "response",
			command: "get_state",
			success: true,
			data: { sessionId: SID, isStreaming: true, contextUsage: { percent: 0.5 } },
		});
		expect(live().state?.contextUsage).toEqual({ percent: 0.5 });
		expect(live().streaming).toBe(true);
	});
});

describe("live reducer — process events", () => {
	it("rpc:process running=false clears streaming + pending", () => {
		frame({ type: "agent_start" });
		frame({ type: "extension_ui_request", id: "u1", method: "confirm" });
		useLive.getState().reduceProcess({
			sessionId: SID,
			running: false,
			exitCode: 0,
		});
		expect(live().alive).toBe(false);
		expect(live().streaming).toBe(false);
		expect(live().pendingUi).toHaveLength(0);
	});
});
