import { beforeEach, describe, expect, it } from "vitest";
import { emptySessionLive, useLive } from "./live";
import type { RetryNotice } from "./retryNotice";

const SID = "s1";
const frame = (f: Record<string, unknown>) =>
	useLive.getState().reduceFrame({ sessionId: SID, frame: f });
const notices = () => useLive.getState().sessions[SID].retryNotices ?? [];

beforeEach(() => useLive.setState({ sessions: {} }));


describe("live reducer retry notices", () => {
	it("moves fallback recovery out of the live tail while preserving its history and undo metadata", () => {
		frame({ type: "auto_retry_start", attempt: 1 });
		frame({ type: "retry_fallback_applied", from: "a/x", to: "b/y" });
		frame({ type: "retry_fallback_succeeded", model: "b/y" });
		expect(notices()).toEqual([]);
		const episode = useLive.getState().sessions[SID].retryHistory?.[0];
		expect(episode?.notices.some((notice: RetryNotice) => notice.tone === "ok")).toBe(true);
		expect(episode?.fallback).toMatchObject({ from: "a/x", to: "b/y" });
	});

	it("does not archive a recovered episode twice when the turn ends", () => {
		frame({ type: "auto_retry_start", attempt: 1, errorMessage: "x".repeat(300) });
		frame({ type: "retry_fallback_applied", from: "a/x", to: "b/y" });
		frame({ type: "retry_fallback_succeeded", model: "b/y" });
		frame({ type: "agent_end", timestamp: 1000 });
		expect(notices()).toHaveLength(0);
		const hist = useLive.getState().sessions[SID].retryHistory ?? [];
		expect(hist).toHaveLength(1);
		expect(hist[0].notices).toHaveLength(3);
		expect(hist[0].notices[0].text).toContain("x".repeat(300));
		expect(hist[0].fallback).toMatchObject({ from: "a/x", to: "b/y" });
		// A following turn adds its own entry; the old one stays.
		frame({ type: "auto_retry_end", success: false, attempt: 3, finalError: "boom" });
		useLive.getState().addUserEcho(SID, "hi");
		expect(useLive.getState().sessions[SID].retryHistory).toHaveLength(2);
		expect(notices()).toHaveLength(0);
	});

	it("records the original model from session state when the event omits it", () => {
		useLive.setState({
			sessions: { [SID]: { ...emptySessionLive(), state: { model: "g/gem", thinkingLevel: "high" } } as never },
		});
		frame({ type: "retry_fallback_applied", to: "b/y" });
		expect(useLive.getState().sessions[SID].retryFallback).toMatchObject({ from: "g/gem", to: "b/y", thinking: "high" });
	});

	it("anchors each row to the requests finished when it was raised", () => {
		const done = (n: number) => ({ id: `r${n}`, toolCallIds: [], parts: [], stat: {} }) as never;
		frame({ type: "auto_retry_start", attempt: 1 });
		useLive.setState({
			sessions: { [SID]: { ...useLive.getState().sessions[SID], liveRequests: [done(1), done(2)] } },
		});
		frame({ type: "auto_retry_end", success: true, attempt: 1 });
		expect(useLive.getState().sessions[SID].retryHistory?.[0].notices.map((n) => n.anchor)).toEqual([0, 2]);
	});

	it("settles live rows on a transport error", () => {
		frame({ type: "auto_retry_start", attempt: 1 });
		frame({ type: "error", message: "socket closed" });
		expect(notices()).toHaveLength(0);
		expect(useLive.getState().sessions[SID].retryHistory).toHaveLength(1);
	});

	it.each([
		{ type: "response", id: "other", command: "prompt", success: false, error: "input hook rejected" },
		{ type: "prompt_result", id: "other", agentInvoked: false, status: "completed", sessionSettled: false },
		{ type: "prompt_result", id: "other", agentInvoked: false, status: "error", error: { message: "input hook rejected", retryable: false }, sessionSettled: false },
	])("keeps an active retry and answer when another prompt completes: $type $status", (outcome) => {
		frame({ type: "agent_start" });
		const answer = { role: "assistant", content: [{ type: "text", text: "answer already received" }] };
		frame({ type: "message_update", message: answer });
		frame({ type: "auto_retry_start", attempt: 1, errorMessage: "provider unavailable" });
		frame(outcome);
		expect(notices()).toHaveLength(1);
		expect(useLive.getState().sessions[SID].retryHistory ?? []).toHaveLength(0);
		expect(useLive.getState().sessions[SID].streaming).toBe(true);
		expect(useLive.getState().sessions[SID].streamingMessage).toEqual(answer);
		frame({ type: "agent_end", isTerminal: true, yielded: true });
		expect(notices()).toHaveLength(0);
		expect(useLive.getState().sessions[SID].retryHistory).toHaveLength(1);
	});

	it.each([
		{ finalError: "Retry continuation failed locally: invalid state. Original error: provider unavailable", status: "error" },
		{ finalError: "Retry cancelled", status: "aborted" },
	])("closes a retry without a new agent_end: $finalError", ({ finalError, status }) => {
		frame({ type: "agent_start" });
		const answer = { role: "assistant", content: [{ type: "text", text: "retained answer" }] };
		frame({ type: "message_update", message: answer });
		frame({ type: "tool_execution_start", toolCallId: "active", toolName: "read" });
		frame({ type: "auto_retry_start", attempt: 1, errorMessage: "provider unavailable" });
		frame({ type: "agent_end", isTerminal: false, yielded: false });
		frame({ type: "auto_retry_end", success: false, attempt: 1, finalError });
		expect(notices()).toHaveLength(0);
		const history = useLive.getState().sessions[SID].retryHistory ?? [];
		expect(history).toHaveLength(1);
		expect(history[0].notices).toHaveLength(2);
		expect(history[0].notices[1].tone).toBe("error");
		expect(history[0].notices[1].text).toContain(finalError);
		expect(useLive.getState().sessions[SID].streaming).toBe(true);
		expect(useLive.getState().sessions[SID].streamingMessage).toEqual(answer);
		expect(useLive.getState().sessions[SID].tools.active.status).toBe("running");
		frame({ type: "agent_start" });
		const nextAnswer = { role: "assistant", content: [{ type: "text", text: "next run answer" }] };
		frame({ type: "message_update", message: nextAnswer });
		frame({ type: "tool_execution_start", toolCallId: "next", toolName: "read" });
		frame({ type: "response", id: "old", command: "prompt", success: false, error: finalError });
		frame({
			type: "prompt_result", id: "old", agentInvoked: true, status,
			...(status === "error" ? { error: { message: finalError, retryable: false } } : {}),
			sessionSettled: false,
		});
		expect(useLive.getState().sessions[SID].streaming).toBe(true);
		expect(useLive.getState().sessions[SID].streamingMessage).toEqual(nextAnswer);
		expect(useLive.getState().sessions[SID].tools.next.status).toBe("running");
		expect(notices()).toHaveLength(0);
		expect(useLive.getState().sessions[SID].retryHistory).toHaveLength(1);
	});

	it("archives exhausted retries once across the terminal agent_end and prompt result", () => {
		frame({ type: "agent_start" });
		frame({ type: "auto_retry_start", attempt: 1, errorMessage: "provider unavailable" });
		frame({ type: "auto_retry_end", success: false, attempt: 1, finalError: "provider unavailable" });
		frame({ type: "agent_end", isTerminal: true, yielded: true });
		expect(notices()).toHaveLength(0);
		expect(useLive.getState().sessions[SID].streaming).toBe(false);
		expect(useLive.getState().sessions[SID].retryHistory?.[0].notices).toHaveLength(2);
		frame({
			type: "prompt_result", id: "current", agentInvoked: true, status: "error",
			error: { message: "provider unavailable", retryable: true }, sessionSettled: true,
		});
		expect(notices()).toHaveLength(0);
		expect(useLive.getState().sessions[SID].retryHistory).toHaveLength(1);
	});

	it("settles live rows when the process exits", () => {
		frame({ type: "auto_retry_start", attempt: 1 });
		useLive.getState().reduceProcess({ sessionId: SID, running: false, exitCode: 1 });
		expect(notices()).toHaveLength(0);
		expect(useLive.getState().sessions[SID].retryHistory).toHaveLength(1);
	});
});
