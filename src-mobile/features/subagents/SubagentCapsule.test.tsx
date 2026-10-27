// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nav, paths } from "../../core/nav";
import { SubagentCapsule, getAncestryChain } from "./SubagentCapsule";
import type { SubagentSummary } from "./model";
import { useSubagentStore } from "./store";

vi.mock("./settings", () => ({
	useCapsuleVisible: () => true,
}));

describe("getAncestryChain", () => {
	const rows: SubagentSummary[] = [
		{ id: "0-task", status: "completed", prompt: "Root task prompt" },
		{ id: "0-task.0-scout", status: "running", prompt: "Scout search prompt" },
		{ id: "0-task.0-scout.0-eval", status: "pending", prompt: "Eval prompt" },
	];

	it("returns single element for root agent", () => {
		expect(getAncestryChain("0-task", rows)).toEqual(["task"]);
	});

	it("returns full ancestry path for nested subagents (A > B > C)", () => {
		const chain = getAncestryChain("0-task.0-scout.0-eval", rows);
		expect(chain).toEqual(["task", "scout", "eval"]);
		expect(chain.join(" > ")).toBe("task > scout > eval");
	});
});

describe("SubagentCapsule component", () => {
	const sessionId = "sess-capsule-test";

	beforeEach(() => {
		useSubagentStore.setState({ bySession: {} });
		vi.spyOn(nav, "push").mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders nothing when session has no subagents", () => {
		const { container } = render(<SubagentCapsule sessionId={sessionId} />);
		expect(container.firstChild).toBeNull();
	});

	it("renders counts + progress at top-right and stays visible when subagents are completed", () => {
		useSubagentStore.setState({
			bySession: {
				[sessionId]: {
					rows: [
						{ id: "0-task", status: "completed", prompt: "Task 1" },
						{ id: "1-scout", status: "completed", prompt: "Scout 2" },
					],
					loaded: true,
					error: null,
				},
			},
		});

		const { container } = render(<SubagentCapsule sessionId={sessionId} />);
		expect(container.querySelector(".justify-end")).toBeTruthy();
		expect(screen.getByText(/完成 2/)).toBeTruthy();
		expect(screen.getByText(/\(2\/2\)/)).toBeTruthy();
	});

	it("renders running and queued counts with spinner and progress", () => {
		useSubagentStore.setState({
			bySession: {
				[sessionId]: {
					rows: [
						{ id: "0-task", status: "running", prompt: "Task 1" },
						{ id: "1-scout", status: "pending", prompt: "Scout 2" },
						{ id: "2-eval", status: "completed", prompt: "Eval 3" },
					],
					loaded: true,
					error: null,
				},
			},
		});

		render(<SubagentCapsule sessionId={sessionId} />);
		expect(screen.getByText(/运行中 1/)).toBeTruthy();
		expect(screen.getByText(/等待 1/)).toBeTruthy();
		expect(screen.getByText(/完成 1/)).toBeTruthy();
		expect(screen.getByText(/\(1\/3\)/)).toBeTruthy();
	});

	it("tap opens BottomSheet with nested tree and tapping agent navigates to detail page", async () => {
		useSubagentStore.setState({
			bySession: {
				[sessionId]: {
					rows: [
						{ id: "0-task", status: "completed", prompt: "Parent task" },
						{ id: "0-task.0-scout", status: "running", prompt: "Child scout" },
					],
					loaded: true,
					error: null,
				},
			},
		});

		render(<SubagentCapsule sessionId={sessionId} />);
		const pillButton = screen.getByRole("button", { name: "打开子代理摘要" });
		fireEvent.click(pillButton);

		// BottomSheet should show tree and breadcrumbs
		expect(await screen.findByText(/task > scout/)).toBeTruthy();
		expect(screen.getByText("打开完整子代理列表")).toBeTruthy();

		// Clicking child agent navigates to SubagentDetailPage
		const childAgentBtn = screen.getByRole("button", { name: /scout/i });
		fireEvent.click(childAgentBtn);

		expect(nav.push).toHaveBeenCalledWith(paths.subagent(sessionId, "0-task.0-scout"));
	});
});
