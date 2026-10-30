// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskToolBlock } from "./TaskToolBlock";

const ERR = "sourceSession: must NOT have additional properties";
const args = {
	context: "C",
	tasks: [
		{ id: "A", agent: "task", task: "a" },
		{ id: "B", agent: "task", task: "b" },
		{ id: "C", agent: "task", task: "c" },
	],
};

afterEach(cleanup);

describe("TaskToolBlock failed dispatch", () => {
	it("opens by default with the full error, and keeps a summary when collapsed", () => {
		const { container } = render(
			<TaskToolBlock sessionId="s" toolCallId="t" args={args} status="error" details={null} resultText={ERR} />,
		);
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain(ERR);
		// Collapse via the header toggle: summary stays visible (with full text in title).
		fireEvent.click(container.querySelector("button")!);
		expect(screen.queryByRole("alert")).toBeNull();
		const summary = screen.getByTitle(ERR);
		expect(summary.textContent).toBe(ERR);
	});
});
