import { beforeEach, describe, expect, it } from "vitest";
import { makeUserEcho, useLive } from "./live";

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

	it("records thinking start and end timestamps", () => {
		frame({
			type: "message_update",
			timestamp: 1000,
			message: {
				id: "m1",
				role: "assistant",
				content: [{ type: "thinking", thinking: "analyzing..." }],
			},
		});
		expect(live().thinkingStartedAt).toBe(1000);
		expect(live().thinkingEndedAt).toBeNull();

		frame({
			type: "message_update",
			timestamp: 2500,
			message: {
				id: "m1",
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "analyzing..." },
					{ type: "text", text: "Here is the answer" },
				],
			},
		});
		expect(live().thinkingEndedAt).toBe(2500);

		frame({
			type: "message_end",
			messageId: "m1",
			timestamp: 2600,
		});
		expect(live().thinkingDurations?.m1).toEqual({
			startedAt: 1000,
			endedAt: 2500,
		});
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
	it("subagent_lifecycle/progress populate subagents from payload frames", () => {
		// Real omp frames: {type, payload:{...}}; lifecycle "started" => running.
		frame({
			type: "subagent_lifecycle",
			payload: {
				id: "sa1",
				agent: "task",
				agentSource: "user",
				description: "Explorer agent",
				status: "started",
				sessionFile: "/tmp/x/sa1.jsonl",
				parentToolCallId: "call_1",
				index: 0,
			},
		});
		expect(live().subagents.sa1.status).toBe("running");
		expect(live().subagents.sa1.label).toBe("Explorer agent");
		expect(live().subagents.sa1.parentToolCallId).toBe("call_1");
		expect(live().subagents.sa1.sessionFile).toBe("/tmp/x/sa1.jsonl");

		frame({
			type: "subagent_progress",
			payload: {
				index: 0,
				agent: "task",
				agentSource: "user",
				task: "Sweep the codebase",
				assignment: "Read everything",
				parentToolCallId: "call_1",
				sessionFile: "/tmp/x/sa1.jsonl",
				progress: {
					index: 0,
					id: "sa1",
					agent: "task",
					agentSource: "user",
					status: "running",
					task: "Sweep the codebase",
					assignment: "Read everything",
					currentTool: "read",
					currentToolIntent: "Reading live.ts",
					recentTools: [],
					recentOutput: [],
					toolCount: 7,
					requests: 3,
					tokens: 1200,
					cost: 0.04,
					durationMs: 9000,
					resolvedModel: "prov/mid:high",
					resolvedModelIdentity: "prov/mid",
					resolvedThinkingLevel: "high",
				},
			},
		});
		const sa = live().subagents.sa1;
		expect(sa.status).toBe("running");
		expect(sa.progress?.toolCount).toBe(7);
		expect(sa.progress?.currentTool).toBe("read");
		expect(sa.progress?.resolvedModelIdentity).toBe("prov/mid");
		expect(sa.task).toBe("Sweep the codebase");
		expect(sa.assignment).toBe("Read everything");

		// Terminal lifecycle maps status but keeps the agent (client-side).
		frame({
			type: "subagent_lifecycle",
			payload: {
				id: "sa1",
				agent: "task",
				agentSource: "user",
				status: "completed",
				sessionFile: "/tmp/x/sa1.jsonl",
				parentToolCallId: "call_1",
				index: 0,
			},
		});
		expect(live().subagents.sa1.status).toBe("completed");
		expect(live().subagents.sa1.progress?.toolCount).toBe(7);
	});

	it("get_subagents response seeds running agents", () => {
		frame({
			type: "response",
			command: "get_subagents",
			success: true,
			data: {
				subagents: [
					{
						id: "sa2",
						index: 1,
						agent: "scout",
						agentSource: "user",
						description: "Scout",
						status: "running",
						task: "Map code",
						sessionFile: "/tmp/x/sa2.jsonl",
						parentToolCallId: "call_9",
						lastUpdate: 5,
					},
				],
			},
		});
		const sa = live().subagents.sa2;
		expect(sa.status).toBe("running");
		expect(sa.agent).toBe("scout");
		expect(sa.parentToolCallId).toBe("call_9");
	});

	it("tool_execution_update keeps partialResult.details", () => {
		frame({
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "task",
			args: { context: "", tasks: [] },
		});
		frame({
			type: "tool_execution_update",
			toolCallId: "t1",
			partialResult: {
				content: [{ type: "text", text: "Spawned 2 agents" }],
				details: {
					projectAgentsDir: null,
					results: [],
					totalDurationMs: 1,
					progress: [
						{
							index: 0,
							id: "A",
							agent: "task",
							status: "pending",
							task: "x",
							recentTools: [],
							recentOutput: [],
							toolCount: 0,
							requests: 0,
							tokens: 0,
							cost: 0,
							durationMs: 0,
						},
					],
				},
			},
		});
		expect(live().tools.t1.text).toBe("Spawned 2 agents");
		const details = live().tools.t1.details as { progress: { id: string }[] };
		expect(details.progress[0].id).toBe("A");
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
		expect(live().tools.t1.startedAt).toBeDefined();
		expect(live().tools.t1.endedAt).toBeDefined();
		expect(live().tools.t1.endedAt!).toBeGreaterThanOrEqual(
			live().tools.t1.startedAt!,
		);
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

describe("live reducer — scrollToItem and scrollRequest", () => {
	it("scrollToItem sets scrollRequest with itemId and timestamp, clearScrollRequest resets it", () => {
		useLive.getState().scrollToItem(SID, "item-42");
		expect(live().scrollRequest).toBeTruthy();
		expect(live().scrollRequest?.itemId).toBe("item-42");
		expect(typeof live().scrollRequest?.timestamp).toBe("number");

		useLive.getState().clearScrollRequest(SID);
		expect(live().scrollRequest).toBeNull();
	});
});

describe("live reducer — pending user echoes", () => {
	const userItem = (id: string, text: string) => ({
		id,
		parentId: null,
		ts: "t",
		kind: "user" as const,
		text,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
	});

	it("addUserEcho appends a user bubble; non-user items don't consume it", () => {
		useLive.getState().addUserEcho(SID, "hello there");
		expect(live().pendingUserEchoes).toHaveLength(1);
		expect(live().pendingUserEchoes[0].kind).toBe("user");
		expect(live().pendingUserEchoes[0].text).toBe("hello there");

		useLive.getState().appendItems(SID, [], 10);
		expect(live().pendingUserEchoes).toHaveLength(1);
	});

	it("appendItems drops the echo once its user message lands", () => {
		useLive.getState().addUserEcho(SID, "hello there");
		useLive.getState().appendItems(SID, [userItem("u1", "hello there")], 20);
		expect(live().pendingUserEchoes).toHaveLength(0);
		expect(live().items).toHaveLength(1);
	});

	it("setItems reconciles echoes and tolerates [Image #N] prefixes", () => {
		useLive.getState().addUserEcho(SID, "看看这张图");
		useLive
			.getState()
			.setItems(SID, [userItem("u1", "[Image #1, 1568x984] 看看这张图")], 30);
		expect(live().pendingUserEchoes).toHaveLength(0);
	});
	it("reconciles pure image echoes with no prose text", () => {
		useLive.getState().addUserEcho(SID, "[Image #1: /tmp/a.png]");
		useLive
			.getState()
			.setItems(SID, [userItem("u1", "[Image #1, 800x600: /tmp/a.png]")], 30);
		expect(live().pendingUserEchoes).toHaveLength(0);
	});

	it("keeps echo when the arriving user item is a different text", () => {
		useLive.getState().addUserEcho(SID, "mine");
		useLive.getState().appendItems(SID, [userItem("u1", "someone else")], 20);
		expect(live().pendingUserEchoes).toHaveLength(1);
	});

	it("message_update for a user role never lands in streamingMessage", () => {
		frame({
			type: "message_update",
			message: {
				role: "user",
				content: [{ type: "text", text: "hi" }],
			},
		});
		expect(live().streamingMessage).toBeNull();
		frame({
			type: "message_update",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "ok" }],
			},
		});
		expect(live().streamingMessage?.role).toBe("assistant");
	});

	it("message_end without a tracked stream is a no-op", () => {
		frame({ type: "message_end" });
		expect(live().streamingMessage).toBeNull();
	});
});

describe("live reducer — command_output / config_update / session_info_update", () => {
	it("command_output becomes an ephemeral entry tagged with the sent command", () => {
		useLive.getState().noteCommandSent(SID, "context");
		frame({ type: "command_output", text: "上下文占用 42%" });
		expect(live().commandOutputs).toHaveLength(1);
		expect(live().commandOutputs[0].command).toBe("context");
		expect(live().commandOutputs[0].kind).toBe("omp");
		expect(live().commandOutputs[0].text).toContain("42%");
	});

	it("command_output without a known command stays anonymous; blank is dropped", () => {
		frame({ type: "command_output", text: "   " });
		frame({ type: "command_output", text: "plain" });
		expect(live().commandOutputs).toHaveLength(1);
		expect(live().commandOutputs[0].command).toBeUndefined();
	});

	it("config_update refreshes model and thinkingLevel on state", () => {
		frame({
			type: "response",
			command: "get_state",
			success: true,
			data: { sessionId: SID, model: "a/one", thinkingLevel: "low" },
		});
		frame({
			type: "config_update",
			model: "b/two",
			thinkingLevel: "high",
		});
		expect(live().state?.model).toBe("b/two");
		expect(live().state?.thinkingLevel).toBe("high");
	});

	it("session_info_update refreshes sessionName on state", () => {
		frame({
			type: "response",
			command: "get_state",
			success: true,
			data: { sessionId: SID, sessionName: "old" },
		});
		frame({ type: "session_info_update", title: "新名字", sessionId: SID });
		expect(live().state?.sessionName).toBe("新名字");
	});

	it("prompt_result error is surfaced as an output for a pending command", () => {
		useLive.getState().noteCommandSent(SID, "compact");
		frame({
			type: "prompt_result",
			agentInvoked: false,
			status: "error",
			error: "压缩失败",
		});
		expect(live().pendingCommand).toBeNull();
		expect(live().commandOutputs).toHaveLength(1);
		expect(live().commandOutputs[0].text).toBe("压缩失败");
	});

	it("prompt_result clears the pending command on success", () => {
		useLive.getState().noteCommandSent(SID, "retry");
		frame({ type: "prompt_result", agentInvoked: true, status: "completed" });
		expect(live().pendingCommand).toBeNull();
		expect(live().commandOutputs).toHaveLength(0);
	});

	it("prompt response clears pending command for handled slash commands (agentInvoked: false)", () => {
		useLive.getState().noteCommandSent(SID, "context");
		frame({
			type: "response",
			command: "prompt",
			success: true,
			data: { agentInvoked: false },
		});
		expect(live().pendingCommand).toBeNull();
	});

	it("prompt response surfaces error and clears pending command on failure", () => {
		useLive.getState().noteCommandSent(SID, "model");
		frame({
			type: "response",
			command: "prompt",
			success: false,
			error: "未知模型",
		});
		expect(live().pendingCommand).toBeNull();
		expect(live().commandOutputs).toHaveLength(1);
		expect(live().commandOutputs[0].command).toBe("model");
		expect(live().commandOutputs[0].text).toBe("未知模型");
	});

	it("addCommandOutput appends app entries; dismissCommandOutput removes", () => {
		useLive.getState().addCommandOutput(SID, "status", "模型: x");
		const id = live().commandOutputs[0].id;
		expect(live().commandOutputs[0].kind).toBe("app");
		expect(live().commandOutputs[0].command).toBe("status");
		useLive.getState().dismissCommandOutput(SID, id);
		expect(live().commandOutputs).toHaveLength(0);
	});

	it("commands normalize input.hint into hint", () => {
		frame({
			type: "available_commands_update",
			commands: [
				{
					name: "translator",
					description: "翻译",
					input: { hint: "<文本>" },
					source: "file",
				},
			],
		});
		const c = live().commands[0];
		expect(c.hint).toBe("<文本>");
		expect(c.input?.hint).toBe("<文本>");
		expect(c.source).toBe("file");
	});

	it("get_available_commands response normalizes and keeps old list when empty", () => {
		frame({
			type: "available_commands_update",
			commands: [{ name: "compact" }],
		});
		frame({
			type: "response",
			command: "get_available_commands",
			success: true,
			data: { commands: [] },
		});
		expect(live().commands.map((c) => c.name)).toEqual(["compact"]);
	});
});

describe("makeUserEcho images", () => {
	it("parses image paths from text and keeps passed attachments without duplicates", () => {
		const item = makeUserEcho(
			"look [图片: /tmp/a.png] and ![x](/tmp/b.jpg) [Image #3]",
			[{ id: "given", path: "/tmp/a.png", marker: "[图片: /tmp/a.png]" }],
		);
		expect(item.images?.map((i) => i.path)).toEqual(["/tmp/a.png", "/tmp/b.jpg", null]);
		expect(item.images?.[0].id).toBe("given");
		expect(item.images?.[2].marker).toBe("[Image #3]");
	});

	it("omits images when the text has none", () => {
		expect(makeUserEcho("plain").images).toBeUndefined();
	});

	it("addUserEcho forwards attachments to the pending echo", () => {
		useLive.getState().addUserEcho("img-s", "hi", [{ id: "p", path: "/tmp/c.png" }]);
		const echoes = useLive.getState().sessions["img-s"].pendingUserEchoes;
		expect(echoes[echoes.length - 1]?.images).toEqual([{ id: "p", path: "/tmp/c.png" }]);
	});
});
