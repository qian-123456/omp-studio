import { beforeEach, describe, expect, it, vi } from "vitest";
import { isFlowBusy, makeUserEcho, pruneRemovedSessions, queuedEchoIds, useLive } from "./live";
import { useComposer } from "./composer";
import { useHeldQueue } from "../features/chat/heldQueue";

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

	it("awaitingAsyncWork agent_end idles the turn and clears its live rows but keeps running children; turn_end never settles", () => {
		frame({ type: "agent_start" });
		frame({ type: "subagent_lifecycle", payload: { id: "a1", status: "started", index: 0 } });
		frame({ type: "tool_execution_start", toolCallId: "c1", toolName: "task", args: {} });
		frame({
			type: "message_update",
			message: { role: "assistant", content: [{ type: "text", text: "old" }] },
		});
		frame({
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "old" }], responseId: "r1", usage: null },
		});
		frame({ type: "turn_end", isTerminal: true });
		expect(live().streaming).toBe(true);
		frame({ type: "agent_end", isTerminal: false, yielded: false });
		expect(live().streaming).toBe(true);
		expect(Object.keys(live().tools)).toEqual(["c1"]);
		expect(live().liveRequests).toHaveLength(1);
		// omp ends every tool call before the idle agent_end (detached task included).
		frame({ type: "tool_execution_end", toolCallId: "c1", result: {} });
		frame({ type: "agent_end", isTerminal: false, yielded: true, awaitingAsyncWork: true });
		expect(live().streaming).toBe(false);
		expect(live().tools).toEqual({});
		expect(live().liveRequests).toEqual([]);
		expect(live().streamingMessage).toBeNull();
		expect(live().subagents.a1.status).toBe("running");
		// Wake-up: nothing of the old turn replays.
		frame({ type: "agent_start" });
		expect(live().streaming).toBe(true);
		expect(live().tools).toEqual({});
		expect(live().liveRequests).toEqual([]);
		expect(live().subagents.a1.status).toBe("running");
	});

	it("turnStartedAt: one clock per turn, kept across requests and the turn's end", () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(1_000);
			frame({ type: "agent_start" });
			expect(live().turnStartedAt).toBe(1_000);
			// Later requests and tool rounds of the same turn keep the start.
			vi.setSystemTime(6_000);
			frame({ type: "turn_start" });
			frame({ type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} });
			frame({ type: "turn_end", isTerminal: false });
			expect(live().turnStartedAt).toBe(1_000);
			// Kept after the end: subagents the turn dispatched still tick on it.
			frame({ type: "agent_end", isTerminal: true });
			expect(live().turnStartedAt).toBe(1_000);
			// The next turn restarts the clock.
			vi.setSystemTime(9_000);
			frame({ type: "agent_start" });
			expect(live().turnStartedAt).toBe(9_000);
		} finally {
			vi.useRealTimers();
		}
	});

	it("turnStartedAt is unknown when the turn was already running on attach", () => {
		frame({ type: "agent_start" });
		frame({ type: "agent_end", isTerminal: true });
		frame({ type: "response", command: "get_state", success: true, data: { isStreaming: true } });
		expect(live().streaming).toBe(true);
		expect(live().turnStartedAt).toBeNull();
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

describe("live reducer — liveRequests", () => {
	// Real omp assistant `message_end` payload (session #65): 306 output
	// tokens over 6967 ms with two parallel tool calls.
	const assistantMessage = {
		id: "msg_65",
		role: "assistant",
		responseId: "resp_abc",
		content: [
			{ type: "toolCall", id: "call_1", name: "grep", arguments: {} },
			{ type: "toolCall", id: "call_2", name: "read", arguments: {} },
		],
		usage: {
			input: 2,
			output: 306,
			cacheRead: 27100,
			cacheWrite: 3592,
			totalTokens: 31000,
			cost: { input: 0, output: 0.06, cacheRead: 0.009, cacheWrite: 0, total: 0.069 },
		},
		duration: 6967,
		ttft: 2400,
		completedAt: 1770000000000,
	};

	it("appends one LiveRequest per assistant message_end", () => {
		frame({
			type: "message_update",
			message: { ...assistantMessage, content: [] },
		});
		frame({
			type: "message_end",
			messageId: "msg_65",
			timestamp: assistantMessage.completedAt,
			message: assistantMessage,
		});
		const reqs = live().liveRequests;
		expect(reqs).toHaveLength(1);
		expect(reqs[0].id).toBe("resp_abc");
		expect(reqs[0].toolCallIds).toEqual(["call_1", "call_2"]);
		expect(reqs[0].hasText).toBe(false);
		expect(reqs[0].parts).toEqual([
			{ kind: "tool", id: "call_1" },
			{ kind: "tool", id: "call_2" },
		]);
		expect(reqs[0].stat.durationMs).toBe(6967);
		expect(reqs[0].stat.ttftMs).toBe(2400);
		expect(reqs[0].stat.completedAt).toBe(assistantMessage.completedAt);
		expect(reqs[0].stat.startedAt).toBe(assistantMessage.completedAt - 6967);
		expect(reqs[0].stat.usage).toEqual({
			input: 2,
			output: 306,
			cacheRead: 27100,
			cacheWrite: 3592,
			totalTokens: 31000,
			cost: 0.069,
		});
	});

	it("records requests seen without a streaming snapshot, in order", () => {
		frame({ type: "agent_start" });
		frame({
			type: "message_end",
			timestamp: 1,
			message: { ...assistantMessage, content: [{ type: "text", text: "done" }] },
		});
		frame({
			type: "message_end",
			timestamp: 2,
			message: { ...assistantMessage, responseId: "resp_def", id: "msg_66" },
		});
		expect(live().liveRequests.map((r) => r.id)).toEqual(["resp_abc", "resp_def"]);
		expect(live().liveRequests[0].hasText).toBe(true);
	});

	it("ignores non-assistant message_end and falls back to messageId/index ids", () => {
		frame({ type: "message_end", message: { role: "user", content: [] } });
		expect(live().liveRequests).toHaveLength(0);
		frame({
			type: "message_end",
			message: { ...assistantMessage, responseId: undefined },
		});
		expect(live().liveRequests[0].id).toBe("msg_65");
		frame({
			type: "message_end",
			message: { role: "assistant", content: [], usage: null },
		});
		expect(live().liveRequests[1].id).toBe("req-2");
	});

	it("resets at turn start together with the tool map", () => {
		frame({ type: "agent_start" });
		frame({ type: "tool_execution_start", toolCallId: "call_1", toolName: "grep" });
		frame({ type: "message_end", message: assistantMessage });
		expect(live().liveRequests).toHaveLength(1);
		expect(Object.keys(live().tools)).toHaveLength(1);
		frame({ type: "agent_end", isTerminal: true });
		expect(live().liveRequests).toHaveLength(0);
	});

	it("resets on process exit", () => {
		frame({ type: "message_end", message: assistantMessage });
		expect(live().liveRequests).toHaveLength(1);
		useLive.getState().reduceProcess({ sessionId: SID, running: false, exitCode: 0 });
		expect(live().liveRequests).toHaveLength(0);
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

	it("an older user item containing the echo text does not consume the echo on reload", () => {
		useLive.getState().appendItems(SID, [userItem("u0", "请继续完成这个任务")], 10);
		useLive.getState().addUserEcho(SID, "继续", undefined, true);
		// Full reload mid-turn: the new message is not persisted yet.
		useLive.getState().setItems(SID, [userItem("u0", "请继续完成这个任务")], 10);
		expect(live().pendingUserEchoes).toHaveLength(1);
		useLive.getState().appendItems(SID, [userItem("u0", "请继续完成这个任务")], 10);
		expect(live().pendingUserEchoes).toHaveLength(1);
		useLive.getState().appendItems(SID, [userItem("u1", "继续")], 20);
		expect(live().pendingUserEchoes).toHaveLength(0);
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

describe("live reducer — queued messages", () => {
	const queued = () => queuedEchoIds(live());

	it("an echo sent while a turn streams is queued until omp delivers it", () => {
		frame({ type: "agent_start" });
		useLive.getState().addUserEcho(SID, "follow up", undefined, true);
		const id = live().pendingUserEchoes[0].id;
		expect(queued().has(id)).toBe(true);
		// The user message entering the conversation = sent.
		frame({ type: "message_start", message: { role: "user", content: "follow up" } });
		expect(queued().has(id)).toBe(false);
		expect(live().pendingUserEchoes).toHaveLength(1); // still awaiting transcript confirmation
	});

	it("queue_update keeps an echo queued while omp lists it, array content delivers too", () => {
		useLive.getState().addUserEcho(SID, "later");
		const id = live().pendingUserEchoes[0].id;
		expect(queued().has(id)).toBe(false); // idle send: not queued
		frame({ type: "queue_update", steering: [], followUp: ["later"], liveSteered: 0 });
		expect(queued().has(id)).toBe(true);
		frame({ type: "queue_update", steering: [], followUp: [], liveSteered: 0 });
		expect(queued().has(id)).toBe(false);
	});

	it("get_state.queuedMessages seeds the omp queue", () => {
		frame({
			type: "response",
			command: "get_state",
			success: true,
			data: { isStreaming: true, queuedMessages: { steering: ["a"], followUp: ["b"], liveSteered: 0 } },
		});
		expect(live().ompQueue).toEqual({ steering: ["a"], followUp: ["b"] });
	});

	it("a message sent during compaction is queued until delivered, in send order", () => {
		frame({ type: "auto_compaction_start", reason: "threshold", action: "context-full" });
		expect(isFlowBusy(live())).toBe(true);
		useLive.getState().addUserEcho(SID, "one");
		useLive.getState().addUserEcho(SID, "two");
		const [a, b] = live().pendingUserEchoes.map((e) => e.id);
		expect([...queued()]).toEqual([a, b]);
		frame({ type: "auto_compaction_end", action: "context-full", result: { tokensBefore: 9000 } });
		expect(isFlowBusy(live())).toBe(false);
		// Still undelivered → still queued; delivery flips them one at a time.
		expect(queued().size).toBe(2);
		frame({
			type: "message_end",
			message: { role: "user", content: [{ type: "text", text: "one" }] },
		});
		expect([...queued()]).toEqual([b]);
	});

	it("a confirmed transcript item removes the echo entirely", () => {
		frame({ type: "agent_start" });
		useLive.getState().addUserEcho(SID, "x y", undefined, true);
		useLive.getState().appendItems(
			SID,
			[
				{
					id: "u9",
					parentId: null,
					ts: "t",
					kind: "user",
					text: "x y",
					thinking: null,
					toolCalls: [],
					toolResult: null,
					usage: null,
					model: null,
					stopReason: null,
					hidden: false,
				},
			],
			5,
		);
		expect(live().pendingUserEchoes).toHaveLength(0);
		expect(queued().size).toBe(0);
	});
});

describe("live reducer — compaction / handoff dividers", () => {
	it("auto compaction runs then settles in place with tokens", () => {
		frame({ type: "auto_compaction_start", reason: "threshold", action: "context-full" });
		expect(live().flowNotices).toMatchObject([{ kind: "compaction", status: "running" }]);
		frame({ type: "auto_compaction_end", action: "context-full", result: { tokensBefore: 123_000 } });
		expect(live().flowNotices).toMatchObject([
			{ kind: "compaction", status: "done", tokensBefore: 123_000 },
		]);
		expect(live().flowNotices[0].endedAt).toBeTypeOf("number");
	});

	it("handoff action, abort, error and skipped end", () => {
		frame({ type: "auto_compaction_start", reason: "x", action: "handoff" });
		frame({ type: "auto_compaction_end", action: "handoff", aborted: true });
		expect(live().flowNotices).toMatchObject([{ kind: "handoff", status: "error" }]);
		frame({ type: "auto_compaction_start", reason: "x", action: "context-full" });
		frame({ type: "auto_compaction_end", action: "context-full", skipped: true });
		expect(live().flowNotices).toHaveLength(1);
	});

	it("is anchored after the last transcript item and a second start while running is ignored", () => {
		useLive.getState().appendItems(
			SID,
			[
				{
					id: "i1",
					parentId: null,
					ts: "t",
					kind: "assistant",
					text: "a",
					thinking: null,
					toolCalls: [],
					toolResult: null,
					usage: null,
					model: null,
					stopReason: null,
					hidden: false,
				},
			],
			1,
		);
		const id = useLive.getState().beginFlowNotice(SID, "compaction");
		frame({ type: "auto_compaction_start", reason: "x", action: "context-full" });
		expect(live().flowNotices).toHaveLength(1);
		expect(live().flowNotices[0]).toMatchObject({ id, anchorId: "i1" });
	});
});

describe("live retention", () => {
	it("finished subagents shed running-only progress fields", () => {
		const progress = {
			index: 0,
			id: "sa1",
			agent: "explore",
			status: "running",
			task: "t",
			recentTools: Array.from({ length: 20 }, (_, i) => ({ tool: `t${i}`, args: { big: "x" } })),
			recentOutput: ["a", "b"],
			toolCount: 20,
			requests: 1,
			tokens: 1,
			cost: 0,
			durationMs: 1,
			currentToolArgs: { big: "y" },
		};
		frame({ type: "subagent_progress", payload: { index: 0, agent: "explore", task: "t", progress } });
		expect(live().subagents.sa1.progress?.recentOutput).toEqual(["a", "b"]);
		frame({
			type: "subagent_lifecycle",
			payload: { id: "sa1", agent: "explore", status: "completed", index: 0 },
		});
		const p = live().subagents.sa1.progress;
		expect(p?.toolCount).toBe(20);
		expect(p?.recentOutput).toEqual([]);
		expect(p?.recentTools).toHaveLength(8);
		expect(p?.currentToolArgs).toBeUndefined();
	});

	it("pruneRemovedSessions drops only the removed sessions", () => {
		useLive.getState().reduceFrame({ sessionId: "a", frame: { type: "agent_start" } });
		useLive.getState().reduceFrame({ sessionId: "b", frame: { type: "agent_start" } });
		useLive.getState().reduceFrame({ sessionId: "c", frame: { type: "agent_start" } });
		pruneRemovedSessions(["a", "c", "unknown"]);
		expect(Object.keys(useLive.getState().sessions)).toEqual(["b"]);
	});

	it("pruneRemovedSessions clears the held queue (memory and localStorage)", () => {
		const store = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v),
			removeItem: (k: string) => void store.delete(k),
		});
		useHeldQueue.getState().push("gone", "queued text");
		useHeldQueue.getState().push("kept", "other");
		expect(store.has("ompws-held:gone")).toBe(true);
		pruneRemovedSessions(["gone"]);
		expect(useHeldQueue.getState().queues["gone"]).toBeUndefined();
		expect(store.has("ompws-held:gone")).toBe(false);
		expect(useHeldQueue.getState().queues["kept"]).toHaveLength(1);
		vi.unstubAllGlobals();
	});
});

describe("live reducer — echo reconcile, stop and skill prompts", () => {
	const userItem = (id: string, text: string) =>
		({
			id,
			parentId: null,
			ts: "t",
			kind: "user",
			text,
			thinking: null,
			toolCalls: [],
			toolResult: null,
			usage: null,
			model: null,
			stopReason: null,
			hidden: false,
		}) as never;

	it("reconcile prefers the exact echo over an earlier substring echo", () => {
		frame({ type: "agent_start" });
		useLive.getState().addUserEcho(SID, "通过", undefined, true);
		useLive.getState().addUserEcho(SID, "我们要核对一下事实信息: 通过", undefined, true);
		const [stale, full] = live().pendingUserEchoes.map((e) => e.id);
		useLive.getState().appendItems(SID, [userItem("u1", "我们要核对一下事实信息: 通过")], 1);
		expect(live().pendingUserEchoes.map((e) => e.id)).toEqual([stale]);
		expect(live().pendingUserEchoes.map((e) => e.id)).not.toContain(full);
	});

	it("a held echo omp no longer lists is dropped and restored to the draft on aborted agent_end", () => {
		useComposer.setState({ drafts: {} });
		frame({ type: "agent_start" });
		useLive.getState().addUserEcho(SID, "steer me", undefined, true);
		useLive.getState().addUserEcho(SID, "still queued", undefined, true);
		frame({ type: "queue_update", steering: ["still queued"], followUp: [], liveSteered: 0 });
		frame({
			type: "agent_end",
			isTerminal: true,
			messages: [{ role: "assistant", stopReason: "aborted" }],
		});
		expect(live().pendingUserEchoes.map((e) => e.text)).toEqual(["still queued"]);
		expect(useComposer.getState().drafts[SID]).toBe("steer me");
	});

	it("a normal agent_end keeps held echoes", () => {
		frame({ type: "agent_start" });
		useLive.getState().addUserEcho(SID, "later", undefined, true);
		frame({
			type: "agent_end",
			isTerminal: true,
			messages: [{ role: "assistant", stopReason: "stop" }],
		});
		expect(live().pendingUserEchoes).toHaveLength(1);
	});

	it("a custom skill-prompt message marks the held echo delivered", () => {
		frame({ type: "agent_start" });
		useLive.getState().addUserEcho(SID, "/skill:grill-me check facts", undefined, true);
		const id = live().pendingUserEchoes[0].id;
		expect(queuedEchoIds(live()).has(id)).toBe(true);
		frame({
			type: "message_start",
			message: {
				role: "custom",
				customType: "skill-prompt",
				content: "skill body",
				details: { prompt: "/skill:grill-me check facts" },
			},
		});
		expect(queuedEchoIds(live()).has(id)).toBe(false);
	});
});

describe("live reducer — retry event sequence", () => {
	it("tracks failed request and retry notices across auto-retry cycle", () => {
		frame({ type: "turn_start" });
		frame({
			type: "message_update",
			message: {
				role: "assistant",
				id: "msg-err",
				content: [{ type: "thinking", text: "connecting..." }],
			},
		});
		frame({
			type: "message_end",
			message: {
				role: "assistant",
				id: "msg-err",
				stopReason: "error",
				errorMessage: "ECONNRESET",
				content: [{ type: "thinking", text: "connecting..." }],
			},
		});
		expect(live().liveRequests).toHaveLength(1);
		expect(live().liveRequests[0].stat.error).toBe("ECONNRESET");
		expect(live().liveRequests[0].parts).toHaveLength(1);
		expect(live().liveRequests[0].parts[0].kind).toBe("thinking");

		frame({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 1000,
			errorMessage: "ECONNRESET",
		});
		expect(live().retryNotices).toHaveLength(1);
		expect(live().retryNotices?.[0].text).toContain("自动重试");

		frame({
			type: "auto_retry_end",
			attempt: 1,
			success: true,
		});
		expect(live().retryNotices).toHaveLength(2);

		frame({
			type: "message_end",
			message: {
				role: "assistant",
				id: "msg-ok",
				stopReason: "stop",
				content: [{ type: "text", text: "success" }],
			},
		});
		expect(live().liveRequests).toHaveLength(2);
		expect(live().liveRequests[1].stat.error).toBeNull();

		// On turn end, retry notices archive into retryHistory
		frame({ type: "agent_end", isTerminal: true });
		expect(live().retryNotices).toEqual([]);
		expect(live().retryHistory).toHaveLength(1);
	});
});
