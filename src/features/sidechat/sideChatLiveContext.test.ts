// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta, TranscriptItem } from "../../lib/contracts";
import type * as Ipc from "../../lib/ipc";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { ownsTarget, useTypeToFocus } from "../chat/useTypeToFocus";
import { useHandback } from "./handbackRun";
import { liveTurnContext, openHandback, sendFirstMessage } from "./sideChatActions";
import { useSideChatView } from "./viewStore";

const rpc = vi.hoisted(() => ({
	create: vi.fn(),
	ask: vi.fn(),
	sendPrompt: vi.fn(),
	transcript: vi.fn(),
}));
vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof Ipc>()),
	createSideChat: rpc.create,
	sideChatAsk: rpc.ask,
	getTranscript: rpc.transcript,
	setQuietTurn: vi.fn(async () => {}),
}));
vi.mock("../chat/send", () => ({ sendPrompt: rpc.sendPrompt }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const item = (id: string, kind: "user" | "assistant", text: string): TranscriptItem => ({
	id,
	parentId: null,
	ts: "2026-09-25T00:00:01Z",
	kind,
	text,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
});

describe("side chat live context, images, focus and handback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useLive.setState({ sessions: {} });
		useHandback.setState({ runs: {} });
		useUi.setState({ selectedSessionId: null });
		useSessions.setState({ sessions: {}, load: vi.fn(async () => {}) });
		useSideChatView.setState({ openChild: {}, openTabs: {}, pending: {} });
		rpc.create.mockResolvedValue({ sessionId: "child" });
		rpc.ask.mockResolvedValue(undefined);
	});

	it("shares streamed prose, running and finished unflushed tools in full, never reasoning", () => {
		const long = "x".repeat(5000);
		useLive.setState({
			sessions: {
				p: {
					...emptySessionLive(),
					streaming: true,
					streamingMessage: {
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "HIDDEN" },
							{ type: "text", text: long },
						],
					},
					tools: {
						t1: { toolCallId: "t1", toolName: "bash", args: { cmd: "ls" }, intent: null, status: "running", text: "", details: null },
						t2: { toolCallId: "t2", toolName: "read", args: {}, intent: null, status: "done", text: "file body", details: null },
					},
				},
			},
		});
		const ctx = liveTurnContext("p") ?? "";
		expect(ctx).toContain(long);
		expect(ctx).toContain("尚无最终结果");
		expect(ctx).toContain("[工具结果 read] file body");
		expect(ctx).not.toContain("HIDDEN");
		expect(ctx).not.toContain("已截断");
	});

	it("is undefined for an idle parent", () => {
		expect(liveTurnContext("none")).toBeUndefined();
	});

	it("first send creates the fork once and forwards the live turn", async () => {
		useLive.setState({
			sessions: { p: { ...emptySessionLive(), streaming: true, streamingMessage: { role: "assistant", content: [{ type: "text", text: "so far" }] } } },
		});
		expect(rpc.create).not.toHaveBeenCalled();
		await sendFirstMessage({ parentId: "p", tabId: "blank-1", text: "hi" });
		expect(rpc.create).toHaveBeenCalledTimes(1);
		expect(rpc.ask.mock.calls[0]?.[3]).toContain("so far");
	});

	it("sends composer and annotation image paths with the first ask", async () => {
		await sendFirstMessage({
			parentId: "p",
			tabId: "blank-2",
			text: "look",
			annotations: [{ id: "a1", source: "message", text: "quoted", images: ["/tmp/ann.png"] }],
			images: [{ id: "i1", path: "/tmp/own.png" }],
		});
		expect(rpc.ask.mock.calls[0]?.[4]).toEqual(["/tmp/own.png", "/tmp/ann.png"]);
	});

	it("keeps the draft path: a failed ask rejects and is not reported as sent", async () => {
		rpc.ask.mockRejectedValueOnce(new Error("unsupported image"));
		await expect(
			sendFirstMessage({ parentId: "p", tabId: "blank-3", text: "x", images: [{ id: "i", path: "/tmp/a.bmp" }] }),
		).rejects.toThrow("unsupported image");
		expect(useSideChatView.getState().pending["blank-3"] ?? null).toBeNull();
	});

	it("unclaimed typing goes to the side-chat input only while its panel is open", () => {
		const side = document.createElement("div");
		side.setAttribute("data-session-view", "blank");
		const sideTa = document.createElement("textarea");
		side.append(sideTa);
		const main = document.createElement("div");
		main.setAttribute("data-session-view", "main");
		const mainTa = document.createElement("textarea");
		main.append(mainTa);
		document.body.append(side, main);
		const { unmount } = renderHook(() => useTypeToFocus({ current: sideTa }, true));

		useUi.setState({ rightOpen: true, rightTab: "sidechat" });
		expect(ownsTarget(null, sideTa, true)).toBe(true);
		expect(ownsTarget(null, mainTa, false)).toBe(false);

		useUi.setState({ rightOpen: false });
		expect(ownsTarget(null, sideTa, true)).toBe(false);
		expect(ownsTarget(null, mainTa, false)).toBe(true);

		unmount();
		useUi.setState({ rightOpen: true });
		expect(ownsTarget(null, mainTa, false)).toBe(true);
		side.remove();
		main.remove();
	});

	it("opening the handback dialog prefills the last reply and sends no prompt", async () => {
		useSessions.setState({ sessions: { c: { id: "c", parentId: "p" } as SessionMeta } });
		rpc.transcript.mockResolvedValue({
			sessionId: "c",
			nextOffset: 0,
			reset: false,
			items: [item("1", "user", "q"), item("2", "assistant", "the summary")],
		});
		await openHandback("c");
		expect(rpc.sendPrompt).not.toHaveBeenCalled();
		expect(useHandback.getState().runs.c).toMatchObject({ phase: "ready", draft: "the summary" });
	});

	it("opening with no reply stays empty and still sends nothing", async () => {
		useSessions.setState({ sessions: { c: { id: "c", parentId: "p" } as SessionMeta } });
		rpc.transcript.mockResolvedValue({ sessionId: "c", nextOffset: 0, reset: false, items: [] });
		await openHandback("c");
		expect(rpc.sendPrompt).not.toHaveBeenCalled();
		expect(useHandback.getState().runs.c).toMatchObject({ phase: "ready", draft: "" });
	});
});
