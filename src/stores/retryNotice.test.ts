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

	it.each([
		["a transport error", { type: "error", message: "socket closed" }],
		["a failed prompt response", { type: "response", command: "prompt", success: false, error: "boom" }],
		["a prompt_result", { type: "prompt_result", status: "ok" }],
	])("settles live rows when %s ends the turn", (_name, f) => {
		frame({ type: "auto_retry_start", attempt: 1 });
		frame(f);
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
