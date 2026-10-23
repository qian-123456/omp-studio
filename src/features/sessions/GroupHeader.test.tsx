// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupHeader } from "./GroupHeader";

function renderHeader() {
	const onToggle = vi.fn();
	const onAction = vi.fn();
	const { container } = render(
		<GroupHeader
			groupKey="ws1"
			title="omp-workspace"
			icon={<span />}
			isOpen={false}
			onToggle={onToggle}
			actionButton={
				<button type="button" onClick={onAction}>
					新建
				</button>
			}
		/>,
	);
	const row = container.querySelector<HTMLElement>('[data-group-key="ws1"]');
	if (!row) throw new Error("header row not rendered");
	return { row, onToggle, onAction };
}

describe("GroupHeader hit area", () => {
	afterEach(cleanup);

	it("toggles when the row padding outside the title button is clicked", () => {
		const { row, onToggle } = renderHeader();
		fireEvent.click(row);
		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it("toggles exactly once when the title button is clicked", () => {
		const { onToggle } = renderHeader();
		fireEvent.click(screen.getByRole("button", { expanded: false }));
		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it("does not toggle when an action control is clicked", () => {
		const { onToggle, onAction } = renderHeader();
		fireEvent.click(screen.getByRole("button", { name: "新建" }));
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(onToggle).not.toHaveBeenCalled();
	});
});
