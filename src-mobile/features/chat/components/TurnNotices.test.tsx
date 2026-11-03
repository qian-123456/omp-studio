// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { events } from "../../../core/sse";
import type { RpcFrame } from "../../../core/types";
import { TurnNotices } from "./TurnNotices";

afterEach(() => cleanup());

const rpc = (frame: Partial<RpcFrame> & { type: string }): void => {
	act(() => events.emit("rpc", { sessionId: "s1", frame: frame as RpcFrame }));
};

describe("TurnNotices", () => {
	it("renders retry, fallback and compaction lines from live rpc frames", () => {
		render(<TurnNotices sessionId="s1" />);
		// Nothing happened: no visible rows at all.
		expect(screen.queryByRole("status")).toBeNull();

		rpc({ type: "auto_retry_start", attempt: 2, maxAttempts: 5, delayMs: 4000, errorMessage: "429" });
		expect(screen.getByRole("status").textContent).toBe("模型请求失败，正在自动重试（第 2 次，最多 5 次，约 4 秒后重试）：429");

		rpc({ type: "retry_fallback_applied", from: "a/one", to: "b/two" });
		expect(screen.getByText("已切换备用模型：a/one → b/two")).toBeTruthy();

		rpc({ type: "auto_compaction_start", action: "compact" });
		expect(screen.getByText("正在压缩上下文")).toBeTruthy();
		rpc({ type: "auto_compaction_end", action: "compact", aborted: false, willRetry: false });
		expect(screen.getByText("上下文压缩完成")).toBeTruthy();

		// Turn over: detail lines collapse into one short history row.
		rpc({ type: "agent_end", isTerminal: true });
		expect(screen.getAllByRole("status")).toHaveLength(1);
		expect(screen.getByText("本轮重试 1 次 · 已切换备用模型")).toBeTruthy();

		// A new turn clears the history.
		rpc({ type: "turn_start" });
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("ignores frames of other sessions and resets on session change", () => {
		const first = render(<TurnNotices sessionId="s1" />);
		act(() => events.emit("rpc", { sessionId: "other", frame: { type: "auto_retry_start", attempt: 1 } as RpcFrame }));
		expect(screen.queryByRole("status")).toBeNull();

		rpc({ type: "auto_compaction_start", action: "compact" });
		expect(screen.getByText("正在压缩上下文")).toBeTruthy();

		first.unmount();
		render(<TurnNotices sessionId="s2" />);
		expect(screen.queryByRole("status")).toBeNull();
	});
});
