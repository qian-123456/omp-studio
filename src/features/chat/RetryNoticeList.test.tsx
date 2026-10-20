// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpcSend = vi.fn();
vi.mock("../../lib/ipc", () => ({
	rpcSend: (...a: unknown[]) => rpcSend(...a),
}));
vi.mock("../../lib/ensureLive", () => ({
	ensureLive: vi.fn(),
	isResumeCancelled: () => false,
}));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import type { TranscriptItem } from "../../lib/contracts";
import { useLive } from "../../stores/live";
import type { RetryEpisode } from "../../stores/retryNotice";
import { RetryEpisodeRow, RetryNoticeList } from "./RetryNoticeList";
import { withRetryEpisodes } from "./retryEpisodes";

const SID = "s1";
const r = (frame: Record<string, unknown>) =>
	act(() => useLive.getState().reduceFrame({ sessionId: SID, frame }));

beforeEach(() => {
	rpcSend.mockReset();
	rpcSend.mockResolvedValue({});
	useLive.setState({ sessions: {} });
});
afterEach(cleanup);

function fallbackTurn() {
	r({ type: "config_update", model: "g/gem", thinkingLevel: "high" });
	r({ type: "auto_retry_start", attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "429" });
	r({ type: "retry_fallback_applied", from: "g/gem", to: "m/mimo" });
	r({ type: "config_update", model: "m/mimo" });
}

it("keeps rows after the retry succeeds", () => {
	render(<RetryNoticeList sessionId={SID} />);
	fallbackTurn();
	r({ type: "retry_fallback_succeeded", model: "m/mimo" });
	expect(screen.getByText(/自动重试/)).toBeTruthy();
	expect(screen.getByText(/已切换到备用模型 m\/mimo/)).toBeTruthy();
	expect(screen.getByText(/备用模型 m\/mimo 请求成功/)).toBeTruthy();
});

it("keeps the history after the turn ends as one expandable entry", () => {
	fallbackTurn();
	r({ type: "retry_fallback_succeeded", model: "m/mimo" });
	r({ type: "agent_end", timestamp: 5000 });
	const episodes = useLive.getState().sessions[SID].retryHistory ?? [];
	render(<RetryEpisodeRow sessionId={SID} episode={episodes[0]} />);
	expect(screen.getByText("本轮重试 1 次 · 已切换备用模型")).toBeTruthy();
	expect(screen.queryByText(/自动重试/)).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: /本轮重试/ }));
	expect(screen.getByText(/自动重试/)).toBeTruthy();
	expect(screen.getByText(/备用模型 m\/mimo 请求成功/)).toBeTruthy();
});

it("splices the entry into the thread at the turn's position", () => {
	fallbackTurn();
	r({ type: "agent_end", timestamp: Date.parse("2026-10-20T10:00:05Z") });
	const item = (id: string, ts: string): TranscriptItem =>
		({ id, ts, kind: "assistant", hidden: false, toolCalls: [] }) as unknown as TranscriptItem;
	const out = withRetryEpisodes(
		[item("a", "2026-10-20T10:00:04Z"), item("b", "2026-10-20T10:01:00Z")],
		useLive.getState().sessions[SID].retryHistory ?? [],
	);
	expect(out.map((i) => i.id)[0]).toBe("a");
	expect(out[1].id).toMatch(/^retry-episode-/);
	expect(out[2].id).toBe("b");
});

it("undo switches back to the original model and thinking level", async () => {
	fallbackTurn();
	r({ type: "agent_end", timestamp: 5000 });
	const ep = useLive.getState().sessions[SID].retryHistory?.[0];
	if (!ep) throw new Error("no episode");
	const first: RetryEpisode = ep;
	// The thread re-derives the entry from the store, as MessageList does.
	function Live() {
		const cur = useLive((s) => s.sessions[SID].retryHistory?.[0]) ?? first;
		return <RetryEpisodeRow sessionId={SID} episode={cur} />;
	}
	render(<Live />);
	fireEvent.click(screen.getByRole("button", { name: "切回原模型" }));
	await waitFor(() => expect(screen.queryByRole("button", { name: "切回原模型" })).toBeNull());
	expect(rpcSend).toHaveBeenCalledWith(SID, { type: "set_model", provider: "g", modelId: "gem" });
	expect(rpcSend).toHaveBeenCalledWith(SID, { type: "set_thinking_level", level: "high" });
	expect(useLive.getState().sessions[SID].retryHistory?.[0].fallback?.undone).toBe(true);
});

it("undo is available on the live row too", () => {
	render(<RetryNoticeList sessionId={SID} />);
	fallbackTurn();
	expect(screen.getByRole("button", { name: "切回原模型" })).toBeTruthy();
});

it("hides undo once the user changed the model manually", () => {
	render(<RetryNoticeList sessionId={SID} />);
	fallbackTurn();
	expect(screen.getByRole("button", { name: "切回原模型" })).toBeTruthy();
	r({ type: "config_update", model: "z/other" });
	expect(screen.queryByRole("button", { name: "切回原模型" })).toBeNull();
});
