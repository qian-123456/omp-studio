// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const subagentTranscript = vi.fn();
vi.mock("../../../lib/ipc", async (orig) => ({
	...(await orig<object>()),
	subagentTranscript: (...a: unknown[]) => subagentTranscript(...a),
}));

import { SubagentSheet } from "./SubagentSheet";
import type { AgentRow } from "./merge";

const row = (id: string): AgentRow =>
	({
		id,
		status: "completed",
		label: id,
		filePath: `/s/parent/${id}.jsonl`,
	}) as unknown as AgentRow;

const transcript = (output: string) => ({
	systemPrompt: null,
	prompt: "p",
	output,
	outputPath: null,
	items: [],
	nextByte: 1,
	reset: false,
});

afterEach(cleanup);

describe("SubagentSheet", () => {
	it("drops the previous subagent's output when stepping to one that fails to load", async () => {
		subagentTranscript.mockResolvedValueOnce(transcript("OUTPUT-A"));
		const props = { parentFile: "/s/parent.jsonl", onClose: () => {} };
		const { rerender } = render(<SubagentSheet {...props} row={row("a")} />);
		fireEvent.click(screen.getByRole("button", { name: "输出" }));
		expect(await screen.findByText(/OUTPUT-A/)).toBeTruthy();

		subagentTranscript.mockRejectedValueOnce(new Error("no file yet"));
		rerender(<SubagentSheet {...props} row={row("b")} />);
		fireEvent.click(screen.getByRole("button", { name: "过程" }));
		expect(await screen.findByText(/no file yet/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "输出" }));
		expect(screen.queryByText(/OUTPUT-A/)).toBeNull();
	});

	it("updates stale running row to completed using transcript summary, showing duration and completion time", async () => {
		const runningRow = {
			...row("ios-draft"),
			status: "running" as const,
			durationMs: 22000, // Stale 22s
			cost: 0, // Zero cost placeholder
		};
		subagentTranscript.mockResolvedValueOnce({
			...transcript("DONE"),
			summary: {
				id: "ios-draft",
				status: "completed",
				startedAt: "2026-10-26T22:15:34.000Z",
				endedAt: "2026-10-26T22:16:54.000Z", // 80s later
				toolCallCount: 42,
				requestCount: 5,
				tokens: 252000,
				cost: 0.045,
				filePath: "/s/parent/ios-draft.jsonl",
			},
		});
		render(<SubagentSheet parentFile="/s/parent.jsonl" row={runningRow} onClose={() => {}} />);

		// Should reflect completed status and 80s (1分20秒) in header chip and overview card
		const durationEls = await screen.findAllByText(/1分20秒/);
		expect(durationEls.length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText(/已完成/).length).toBeGreaterThanOrEqual(1);
		expect(screen.queryByText(/22秒/)).toBeNull();
		// Should show completion time in Overview stat card
		expect(screen.getByText("完成时间")).toBeTruthy();
		// Should show non-zero cost formatted, not $0.00
		expect(screen.getByText("$0.045")).toBeTruthy();
	});

	it("hides cost when zero/unknown and avoids showing bogus 0秒", async () => {
		const pendingRow = {
			...row("zero-cost"),
			status: "pending" as const,
			durationMs: 0,
			cost: 0,
		};
		subagentTranscript.mockResolvedValueOnce({
			...transcript(""),
			summary: {
				id: "zero-cost",
				status: "pending",
				cost: 0,
				filePath: "/s/parent/zero-cost.jsonl",
			},
		});
		render(<SubagentSheet parentFile="/s/parent.jsonl" row={pendingRow} onClose={() => {}} />);

		// Neither $0.00 nor 0秒 should appear
		expect(screen.queryByText("$0.00")).toBeNull();
		expect(screen.queryByText("$0.000")).toBeNull();
		expect(screen.queryByText("0秒")).toBeNull();
		expect(screen.queryByText("用时")).toBeNull();
	});

	it("overview shows failure reason, solution space and shared context from the row alone", async () => {
		subagentTranscript.mockRejectedValueOnce(new Error("n/a"));
		const r = {
			...row("x"),
			status: "failed" as const,
			error: "sourceSession: must NOT have additional properties",
			solutionSpace: "SOLSPACE-TEXT",
			sharedContext: "CTX-TEXT",
		};
		render(<SubagentSheet parentFile="/s/parent.jsonl" onClose={() => {}} row={r} />);
		expect(screen.getByText(/must NOT have additional properties/)).toBeTruthy();
		expect(screen.getByText("SOLSPACE-TEXT")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /共享上下文/ }));
		expect(screen.getByText("CTX-TEXT")).toBeTruthy();
	});

	it("explicit context prop is used when passed (stream entry point)", async () => {
		subagentTranscript.mockRejectedValueOnce(new Error("n/a"));
		render(<SubagentSheet parentFile="/s/parent.jsonl" onClose={() => {}} row={row("y")} context="PROP-CTX" />);
		fireEvent.click(screen.getByRole("button", { name: /共享上下文/ }));
		expect(screen.getByText("PROP-CTX")).toBeTruthy();
	});
});
