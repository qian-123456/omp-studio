// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubagentSummary } from "../../../lib/contracts";

const subagentList = vi.fn<(file: string) => Promise<SubagentSummary[]>>();
vi.mock("../../../lib/ipc", () => ({
	subagentList: (file: string) => subagentList(file),
}));

import { DISK_POLL_MS, subscribeDiskSubagents } from "./diskPoller";

const agent = (status: SubagentSummary["status"]): SubagentSummary =>
	({ id: "A", status }) as SubagentSummary;

/** Flush promise callbacks without advancing timers. */
const flush = () => vi.advanceTimersByTimeAsync(0);
const tick = () => vi.advanceTimersByTimeAsync(DISK_POLL_MS);

describe("subscribeDiskSubagents", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		subagentList.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("two consumers share one subagentList call per tick", async () => {
		subagentList.mockResolvedValue([agent("running")]);
		const a = vi.fn();
		const b = vi.fn();
		const s1 = subscribeDiskSubagents("/p1.jsonl", a, true);
		const s2 = subscribeDiskSubagents("/p1.jsonl", b, true);
		await flush();
		expect(subagentList).toHaveBeenCalledTimes(1);
		// The late consumer still receives the shared result.
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledWith([agent("running")]);
		await tick();
		expect(subagentList).toHaveBeenCalledTimes(2);
		expect(a).toHaveBeenCalledTimes(2);
		expect(b).toHaveBeenCalledTimes(2);
		s1.unsubscribe();
		s2.unsubscribe();
	});

	it("keeps polling while a subagent runs after the parent turn ended", async () => {
		subagentList.mockResolvedValue([agent("running")]);
		const s = subscribeDiskSubagents("/p2.jsonl", vi.fn(), false);
		await flush();
		await tick();
		await tick();
		expect(subagentList).toHaveBeenCalledTimes(3);
		s.unsubscribe();
	});

	it("stops when nothing runs and the parent is idle", async () => {
		subagentList.mockResolvedValue([agent("completed")]);
		const s = subscribeDiskSubagents("/p3.jsonl", vi.fn(), false);
		await flush();
		await tick();
		await tick();
		expect(subagentList).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		s.unsubscribe();
	});

	it("polls while the parent is working, then stops once it ends and subagents finish", async () => {
		subagentList.mockResolvedValue([agent("completed")]);
		const s = subscribeDiskSubagents("/p4.jsonl", vi.fn(), true);
		await flush();
		await tick();
		expect(subagentList).toHaveBeenCalledTimes(2);
		s.setParentActive(false); // one final refresh, then no more timers
		await flush();
		expect(subagentList).toHaveBeenCalledTimes(3);
		await tick();
		await tick();
		expect(subagentList).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
		s.unsubscribe();
	});

	it("clears the timer when the last consumer leaves", async () => {
		subagentList.mockResolvedValue([agent("running")]);
		const s1 = subscribeDiskSubagents("/p5.jsonl", vi.fn(), true);
		const s2 = subscribeDiskSubagents("/p5.jsonl", vi.fn(), true);
		await flush();
		s1.unsubscribe();
		expect(vi.getTimerCount()).toBe(1);
		s2.unsubscribe();
		expect(vi.getTimerCount()).toBe(0);
	});
});
