import { beforeEach, describe, expect, it } from "vitest";
import { useLive } from "./live";
import { retryNoticeFromFrame } from "./retryNotice";

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
	it("accumulates and clears on next user message", () => {
		frame({ type: "auto_retry_start", attempt: 1 });
		frame({ type: "retry_fallback_applied", from: "a", to: "b" });
		frame({ type: "retry_fallback_succeeded", model: "b" });
		expect(notices()).toHaveLength(3);
		useLive.getState().addUserEcho(SID, "hi");
		expect(notices()).toHaveLength(0);
	});
});
