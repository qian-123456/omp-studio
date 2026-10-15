// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AddMenuPopover } from "./AddMenuPopover";

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
});

afterEach(cleanup);

function renderMenu(planMode = false) {
	// A div, so it doesn't count as one of the menu's buttons.
	const anchor = document.createElement("div");
	document.body.appendChild(anchor);
	const handlers = {
		onClose: vi.fn(),
		onAddFiles: vi.fn(),
		onAttachFinder: vi.fn(),
		onPickProject: vi.fn(),
		onGoal: vi.fn(),
		onTogglePlan: vi.fn(),
		onSketch: vi.fn(),
	};
	render(<AddMenuPopover anchor={anchor} ignoreRef={{ current: anchor }} planMode={planMode} {...handlers} />);
	return handlers;
}

describe("AddMenuPopover", () => {
	it("renders every title in Chinese", () => {
		renderMenu();
		for (const title of ["添加", "文件和文件夹", "Finder 选中项", "在项目中工作", "目标", "规划模式", "草图"]) {
			expect(screen.getByText(title)).toBeTruthy();
		}
		// No leftover English labels from the Codex menu this was modeled on.
		for (const en of ["Files and folders", "Attach Finder", "Work in a project", "Plan mode", "Sketch"]) {
			expect(screen.queryByText(en)).toBeNull();
		}
	});

	it("flips the plan-mode description and shows the check only when on", () => {
		renderMenu(false);
		expect(screen.getByText("开启规划模式")).toBeTruthy();
		expect(screen.queryByText("关闭规划模式")).toBeNull();
		cleanup();
		renderMenu(true);
		expect(screen.getByText("关闭规划模式")).toBeTruthy();
		expect(screen.queryByText("开启规划模式")).toBeNull();
	});

	it("gives every item its own icon color", () => {
		renderMenu();
		const colors = screen
			.getAllByRole("button")
			.map((b) => (b.querySelector("span") as HTMLElement).style.color);
		expect(colors).toHaveLength(6);
		expect(colors.every(Boolean)).toBe(true);
		expect(new Set(colors).size).toBe(6);
	});

	it("closes the menu, then fires the chosen action", () => {
		const h = renderMenu();
		fireEvent.click(screen.getByText("草图"));
		expect(h.onClose).toHaveBeenCalledTimes(1);
		expect(h.onSketch).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByText("目标"));
		expect(h.onGoal).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByText("Finder 选中项"));
		expect(h.onAttachFinder).toHaveBeenCalledTimes(1);
	});
});
