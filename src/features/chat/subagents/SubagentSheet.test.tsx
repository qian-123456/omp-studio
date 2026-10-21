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
});
