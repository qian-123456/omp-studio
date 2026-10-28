// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nav, paths } from "../../core/nav";
import { SubagentCapsule, capsuleText } from "./SubagentCapsule";
import type { SubagentSummary } from "./model";
import { useSubagentStore } from "./store";

vi.mock("./settings", () => ({
	useCapsuleVisible: () => true,
}));

describe("capsuleText", () => {
	it("lists only non-zero states in a fixed order", () => {
		expect(capsuleText({ running: 2, queued: 0, done: 5, failed: 0 })).toBe("2 运行 · 5 完成");
		expect(capsuleText({ running: 0, queued: 1, done: 0, failed: 3 })).toBe("1 排队 · 3 失败");
	});
});

describe("SubagentCapsule", () => {
	const sessionId = "sess-capsule-test";
	const seed = (rows: SubagentSummary[]) =>
		useSubagentStore.setState({ bySession: { [sessionId]: { rows, loaded: true, error: null } } });

	beforeEach(() => {
		useSubagentStore.setState({ bySession: {} });
		vi.spyOn(nav, "push").mockImplementation(() => {});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("renders nothing when the session has no subagents", () => {
		const { container } = render(<SubagentCapsule sessionId={sessionId} />);
		expect(container.firstChild).toBeNull();
	});

	it("stays visible after every subagent finished", () => {
		seed([
			{ id: "0-task", status: "completed" },
			{ id: "1-scout", status: "completed" },
		]);
		render(<SubagentCapsule sessionId={sessionId} />);
		expect(screen.getByRole("button", { name: "子代理：2 完成" })).toBeTruthy();
	});

	it("opens the nested overview and navigates to an agent's detail page", async () => {
		seed([
			{ id: "0-task", status: "completed", prompt: "Parent task" },
			{ id: "0-task.0-scout", status: "running", prompt: "Child scout" },
		]);
		render(<SubagentCapsule sessionId={sessionId} />);
		const capsule = screen.getByRole("button", { name: "子代理：1 运行 · 1 完成" });
		expect(capsule.getAttribute("aria-expanded")).toBe("false");
		expect(capsule.className).toContain("min-h-11");
		fireEvent.click(capsule);
		expect(capsule.getAttribute("aria-expanded")).toBe("true");

		fireEvent.click(await screen.findByRole("button", { name: /^scout，/ }));
		expect(nav.push).toHaveBeenCalledWith(paths.subagent(sessionId, "0-task.0-scout"));
	});

	it("keeps mixed status counts bounded and makes every count readable in the sheet", async () => {
		seed([
			{ id: "0-task", status: "running" },
			{ id: "1-task", status: "pending" },
			{ id: "2-task", status: "completed" },
			{ id: "3-task", status: "failed" },
		]);
		render(<SubagentCapsule sessionId={sessionId} />);
		const capsule = screen.getByRole("button", { name: "子代理：1 运行 · 1 排队 · 1 完成 · 1 失败" });
		expect(capsule.className).toContain("max-w-full");
		expect(capsule.className).toContain("min-w-0");
		expect(capsule.className).not.toContain("shrink-0");
		fireEvent.click(capsule);
		for (const count of ["1 运行", "1 排队", "1 完成", "1 失败"]) {
			expect(await screen.findByText(count)).toBeTruthy();
		}
		fireEvent.click(screen.getByRole("button", { name: "查看全部子代理" }));
		expect(nav.push).toHaveBeenCalledWith(paths.subagents(sessionId));
	});
});
