import { describe, expect, it } from "vitest";
import type { RpcFrame } from "../../../core/types";
import { emptyTurnNotices, modelLabel, reduceTurnNotice, retrySummary } from "./turnNotices";

const frame = (f: Partial<RpcFrame> & { type: string }): RpcFrame => f;

describe("reduceTurnNotice", () => {
	it("shows the retry attempt count and keeps the full error text", () => {
		const s = reduceTurnNotice(emptyTurnNotices, frame({
			type: "auto_retry_start",
			attempt: 2,
			maxAttempts: 5,
			delayMs: 4000,
			errorMessage: "429 too many\nrequests   for model",
		}));
		expect(s.retries).toHaveLength(1);
		expect(s.retries[0]).toMatchObject({ tone: "warn" });
		expect(s.retries[0].text).toBe("模型请求失败，正在自动重试（第 2 次，最多 5 次，约 4 秒后重试）：429 too many requests for model");
		expect(s.retryCount).toBe(1);
	});

	it("a second retry attempt replaces the running line and counts up", () => {
		const a = reduceTurnNotice(emptyTurnNotices, frame({ type: "auto_retry_start", attempt: 1, delayMs: 500, errorMessage: "boom" }));
		const b = reduceTurnNotice(a, frame({ type: "auto_retry_start", attempt: 2, delayMs: 500, errorMessage: "boom" }));
		expect(b.retries).toHaveLength(1);
		expect(b.retryCount).toBe(2);
	});

	it("auto_retry_end success settles into one ok line, failure keeps the full final error", () => {
		const a = reduceTurnNotice(emptyTurnNotices, frame({ type: "auto_retry_start", attempt: 1, errorMessage: "x" }));
		const ok = reduceTurnNotice(a, frame({ type: "auto_retry_end", success: true, attempt: 3 }));
		expect(ok.retries[0]).toMatchObject({ tone: "ok", text: "模型重试成功（共尝试 3 次）" });
		const fail = reduceTurnNotice(a, frame({ type: "auto_retry_end", success: false, attempt: 5, finalError: "all providers down" }));
		expect(fail.retries[0]).toMatchObject({ tone: "error", text: "自动重试失败（共尝试 5 次）：all providers down" });
		expect(fail.hadFailure).toBe(true);
	});

	it("fallback lines keep both model labels and mark the turn history", () => {
		let s = reduceTurnNotice(emptyTurnNotices, frame({ type: "retry_fallback_applied", from: "a/one", to: "b/two" }));
		expect(s.retries[0]).toMatchObject({ tone: "warn", text: "已切换备用模型：a/one → b/two" });
		expect(s.hadFallback).toBe(true);
		s = reduceTurnNotice(s, frame({ type: "retry_fallback_succeeded", model: "b/two" }));
		expect(s.retries[1]).toMatchObject({ tone: "ok", text: "备用模型请求成功：b/two" });
	});

	it("compaction shows running, then done / failure / skipped", () => {
		const run = reduceTurnNotice(emptyTurnNotices, frame({ type: "auto_compaction_start", action: "compact" }));
		expect(run.compaction).toEqual({ status: "running", text: "正在压缩上下文" });
		const done = reduceTurnNotice(run, frame({ type: "auto_compaction_end", action: "compact", aborted: false, willRetry: false }));
		expect(done.compaction).toEqual({ status: "done", text: "上下文压缩完成" });
		const fail = reduceTurnNotice(run, frame({ type: "auto_compaction_end", action: "compact", aborted: false, willRetry: false, errorMessage: "quota exhausted" }));
		expect(fail.compaction).toEqual({ status: "error", text: "上下文压缩失败：quota exhausted" });
		const aborted = reduceTurnNotice(run, frame({ type: "auto_compaction_end", action: "compact", aborted: true, willRetry: false }));
		expect(aborted.compaction).toEqual({ status: "error", text: "上下文压缩失败：已中止" });
		const skipped = reduceTurnNotice(run, frame({ type: "auto_compaction_end", action: "compact", aborted: false, willRetry: false, skipped: true }));
		expect(skipped.compaction).toBeNull();
		expect(reduceTurnNotice(emptyTurnNotices, frame({ type: "auto_compaction_start", action: "handoff" })).compaction?.text).toBe("正在整理上下文");
	});

	it("a terminal agent_end collapses the turn into one history line, non-terminal keeps everything", () => {
		let s = reduceTurnNotice(emptyTurnNotices, frame({ type: "auto_retry_start", attempt: 1, errorMessage: "x" }));
		s = reduceTurnNotice(s, frame({ type: "auto_retry_start", attempt: 2, errorMessage: "x" }));
		s = reduceTurnNotice(s, frame({ type: "retry_fallback_applied", from: "a/one", to: "b/two" }));
		const cont = reduceTurnNotice(s, frame({ type: "agent_end", isTerminal: false }));
		expect(cont.retries).toHaveLength(2);
		const ended = reduceTurnNotice(s, frame({ type: "agent_end", isTerminal: true }));
		expect(ended.retries).toHaveLength(0);
		expect(ended.compaction).toBeNull();
		expect(ended.summary).toBe("本轮重试 2 次 · 已切换备用模型");
		// No retry activity: no history line at all.
		const quiet = reduceTurnNotice(emptyTurnNotices, frame({ type: "agent_end", isTerminal: true }));
		expect(quiet.summary).toBeNull();
	});

	it("a new turn start clears the previous turn's history", () => {
		const s = reduceTurnNotice(emptyTurnNotices, frame({ type: "agent_end", isTerminal: true }));
		expect(reduceTurnNotice({ ...s, summary: "本轮重试 1 次" }, frame({ type: "turn_start" }))).toEqual(emptyTurnNotices);
	});

	it("ignores unrelated frames", () => {
		const s = reduceTurnNotice(emptyTurnNotices, frame({ type: "message_update", message: { role: "assistant", content: [] } }));
		expect(s).toBe(emptyTurnNotices);
	});

	it("retrySummary builds the chip text from counters", () => {
		expect(retrySummary({ ...emptyTurnNotices, retryCount: 3, hadFailure: true })).toBe("本轮重试 3 次 · 重试未成功");
		expect(retrySummary({ ...emptyTurnNotices, hadFallback: true })).toBe("已切换备用模型");
		expect(retrySummary(emptyTurnNotices)).toBeNull();
	});
});

describe("modelLabel", () => {
	it("accepts provider/id strings and {provider, id} objects", () => {
		expect(modelLabel("p/m")).toBe("p/m");
		expect(modelLabel({ provider: "p", id: "m" })).toBe("p/m");
		expect(modelLabel({ id: "m" })).toBe("m");
		expect(modelLabel(42)).toBe("");
	});
});
