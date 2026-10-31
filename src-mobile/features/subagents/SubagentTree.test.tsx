// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubagentTree } from "./SubagentTree";
import { buildTree, flattenTree } from "./model";

afterEach(cleanup);

describe("SubagentTree", () => {
	it("bounds deep visual indentation while preserving every agent and its true level", () => {
		const rows = Array.from({ length: 8 }, (_, depth) => ({
			id: Array.from({ length: depth + 1 }, (_, level) => `0-层级${level + 1}`).join("."),
			status: "completed", model: "provider/readable-model-name",
		}));
		const onOpen = vi.fn();
		const { container } = render(<SubagentTree rows={flattenTree(buildTree(rows))} now={0} onOpen={onOpen} />);
		const leaves = container.querySelectorAll("li");
		expect(leaves.length).toBe(8);
		const deepest = leaves[7];
		expect(deepest.firstElementChild?.children.length).toBe(3);
		expect(screen.getByText("第 8 层")).toBeTruthy();
		expect(deepest.textContent).toContain("provider/readable-model-name");
		fireEvent.click(screen.getByRole("button", { name: /层级8，完成，第 8 层/ }));
		expect(onOpen).toHaveBeenCalledWith(rows[7].id);
	});

	it("wraps unbroken agent names and model identifiers instead of overflowing the card", () => {
		const name = "Agent".repeat(30);
		const model = `provider/${"Model".repeat(30)}`;
		render(<SubagentTree rows={flattenTree(buildTree([{ id: `0-${name}`, status: "running", model }]))} now={0} onOpen={() => {}} />);
		expect(screen.getByText(name).className).toContain("[overflow-wrap:anywhere]");
		expect(screen.getByText(model).className).toContain("[overflow-wrap:anywhere]");
	});

	it("collapses descendants independently of opening the parent detail", () => {
		const parent = { id: "0-parent", status: "running" };
		const child = { id: "0-parent.0-child", status: "running" };
		const sibling = { id: "1-sibling", status: "completed" };
		const open = vi.fn();
		render(<SubagentTree rows={flattenTree(buildTree([parent, child, sibling]))} now={0} onOpen={open} />);
		const collapse = screen.getByRole("button", { name: "收起parent的子代理" });
		expect(collapse.getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(collapse);
		expect(screen.queryByRole("button", { name: /^child，/ })).toBeNull();
		expect(screen.getByRole("button", { name: /^sibling，/ })).toBeTruthy();
		expect(open).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: /^parent，/ }));
		expect(open).toHaveBeenCalledWith(parent.id);
		fireEvent.click(screen.getByRole("button", { name: "展开parent的子代理" }));
		expect(screen.getByRole("button", { name: /^child，/ })).toBeTruthy();
	});
});
