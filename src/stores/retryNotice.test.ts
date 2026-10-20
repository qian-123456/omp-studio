import { beforeEach, describe, expect, it } from "vitest";
import { useLive } from "./live";
import { retryNoticeFromFrame, retrySummary } from "./retryNotice";

const SID = "s1";
const frame = (f: Record<string, unknown>) =>
	useLive.getState().reduceFrame({ sessionId: SID, frame: f });
const notices = () => useLive.getState().sessions[SID].retryNotices ?? [];

beforeEach(() => useLive.setState({ sessions: {} }));

describe("retryNoticeFromFrame", () => {
	it("maps retry start/end", () => {
		const s = retryNoticeFromFrame({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "429 rate limit" });
		expect(s?.text).toBe("请求失败（429 rate limit），2 秒后自动重试（第 1/3 次）");
		expect(retryNoticeFromFrame({ type: "auto_retry_end", success: true, attempt: 2 })?.tone).toBe("ok");
		expect(retryNoticeFromFrame({ type: "auto_retry_end", success: false, attempt: 3, finalError: "boom" })?.text).toBe("重试失败（共 3 次）：boom");
	});
	it("maps fallback events and ignores others", () => {
		expect(retryNoticeFromFrame({ type: "retry_fallback_applied", from: "a/x", to: { provider: "b", id: "y" } })?.text).toBe("a/x 请求失败，已切换到备用模型 b/y");
		expect(retryNoticeFromFrame({ type: "retry_fallback_succeeded", model: "b/y" })?.text).toBe("备用模型 b/y 请求成功");
		expect(retryNoticeFromFrame({ type: "turn_end" })).toBeNull();
	});
});

describe("live reducer retry notices", () => {
	it("keeps rows after a retry/fallback success", () => {
		frame({ type: "auto_retry_start", attempt: 1 });
		frame({ type: "retry_fallback_applied", from: "a/x", to: "b/y" });
		frame({ type: "retry_fallback_succeeded", model: "b/y" });
		expect(notices()).toHaveLength(3);
		expect(notices()[2].tone).toBe("ok");
	});

	it("collapses the turn's rows into one history episode at turn end", () => {
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
		expect(retrySummary(hist[0].notices, hist[0].fallback)).toBe("本轮重试 1 次 · 已切换备用模型");
		// A following turn adds its own entry; the old one stays.
		frame({ type: "auto_retry_end", success: false, attempt: 3, finalError: "boom" });
		useLive.getState().addUserEcho(SID, "hi");
		expect(useLive.getState().sessions[SID].retryHistory).toHaveLength(2);
		expect(notices()).toHaveLength(0);
	});

	it("records the original model from session state when the event omits it", () => {
		useLive.setState({
			sessions: { [SID]: { ...useLive.getState().sessions[SID], state: { model: "g/gem", thinkingLevel: "high" } } as never },
		});
		frame({ type: "retry_fallback_applied", to: "b/y" });
		expect(useLive.getState().sessions[SID].retryFallback).toMatchObject({ from: "g/gem", to: "b/y", thinking: "high" });
	});
});
