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
});
