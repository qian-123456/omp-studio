// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useLive } from "../../stores/live";
import { RetryNoticeList } from "./RetryNoticeList";

beforeEach(() => useLive.setState({ sessions: {} }));
afterEach(cleanup);

it("renders rows for a simulated retry + fallback sequence", () => {
	render(<RetryNoticeList sessionId="s1" />);
	act(() => {
		const r = useLive.getState().reduceFrame;
		r({ sessionId: "s1", frame: { type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "429" } });
		r({ sessionId: "s1", frame: { type: "retry_fallback_applied", from: "a/x", to: "b/y" } });
		r({ sessionId: "s1", frame: { type: "retry_fallback_succeeded", model: "b/y" } });
	});
	expect(screen.getByText(/自动重试/)).toBeTruthy();
	expect(screen.getByText(/已切换到备用模型 b\/y/)).toBeTruthy();
	expect(screen.getByText(/备用模型 b\/y 请求成功/)).toBeTruthy();
});
