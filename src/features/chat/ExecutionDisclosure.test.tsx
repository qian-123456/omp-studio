// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s, invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import type { ToolResultInfo, TranscriptItem } from "../../lib/contracts";
import { TurnSteps } from "./ExecutionDisclosure";
import type { TurnStep } from "./turnGrouping";

afterEach(cleanup);

const item = { id: "a1", kind: "assistant" } as TranscriptItem;

function toolStep(id: string, name: string, args: unknown = {}): TurnStep {
	return { id: `call-${id}`, kind: "tool", item, call: { id, name, args, intent: null } };
}

describe("TurnSteps status", () => {
	it("marks a failed call from toolResultsByCallId as 运行失败 (results are absorbed by the transcript filter)", () => {
		const results = new Map<string, ToolResultInfo>([
			["c1", { toolCallId: "c1", toolName: "bash", text: "boom", isError: true } as ToolResultInfo],
		]);
		render(
			<TurnSteps
				sessionId="s"
				steps={[toolStep("c1", "bash", { command: "false" })]}
				toolResultsByCallId={results}
			/>,
		);
		expect(screen.getByText("运行失败")).toBeTruthy();
		expect(screen.queryByText("已运行")).toBeNull();
	});
});

describe("TurnSteps forceExpanded", () => {
	const steps = [toolStep("c1", "bash", { command: "echo hi" })];
	const results = new Map<string, ToolResultInfo>([
		["c1", { toolCallId: "c1", toolName: "bash", text: "hi-output", isError: false } as ToolResultInfo],
	]);

	it("true → null keeps the card open instead of collapsing it", () => {
		const { rerender } = render(
			<TurnSteps sessionId="s" steps={steps} toolResultsByCallId={results} forceExpanded />,
		);
		expect(screen.getByText("hi-output")).toBeTruthy();
		act(() => {
			rerender(
				<TurnSteps sessionId="s" steps={steps} toolResultsByCallId={results} forceExpanded={null} />,
			);
		});
		expect(screen.getByText("hi-output")).toBeTruthy();
	});

	it("a highlighted target opens only its own card", () => {
		const two = [
			toolStep("h1", "bash", { command: "echo one" }),
			toolStep("h2", "read", { path: "x.ts" }),
		];
		const res = new Map<string, ToolResultInfo>([
			["h1", { toolCallId: "h1", toolName: "bash", text: "one-out", isError: false } as ToolResultInfo],
			["h2", { toolCallId: "h2", toolName: "read", text: "two-out", isError: false } as ToolResultInfo],
		]);
		render(
			<TurnSteps
				sessionId="s"
				steps={two}
				toolResultsByCallId={res}
				forceExpanded
				highlightedStepId="h2"
			/>,
		);
		expect(screen.getByText("two-out")).toBeTruthy();
		expect(screen.queryByText("one-out")).toBeNull();
	});
});
