// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SubagentInfo } from "./types";

const info = (status: string, agent = "task"): SubagentInfo =>
	({ status, agent, description: "", index: 0 }) as unknown as SubagentInfo;

const subagents: Record<string, SubagentInfo> = {
	A: info("running"),
	"A.B": info("running", "scout"),
	"A.B.C": info("completed"),
	D: info("completed"),
};

vi.mock("./useSessionSubagents", () => ({
	useSessionSubagents: () => ({ parentFile: null, subagents, rows: {} }),
}));
import { useUi } from "../../../stores/ui";
import { TopCapsule } from "./TopCapsule";

useUi.setState({ selectedSessionId: "s1" });

afterEach(cleanup);

const rowIds = () =>
	[...document.querySelectorAll("[data-subagent-row]")].map((e) => e.getAttribute("data-subagent-row"));

describe("TopCapsule nested subagents", () => {
	it("nests A > B > C under connectors, keeps D at top level, counts all", () => {
		render(<TopCapsule />);
		const root = document.querySelector("ul.sa-tree-root") as HTMLElement;
		const depth = (id: string) => {
			let d = 0;
			for (let el = document.querySelector(`[data-subagent-row="${id}"]`)?.parentElement; el && el !== root; el = el.parentElement) {
				if (el.tagName === "UL") d += 1;
			}
			return d;
		};
		expect(rowIds()).toEqual(["A", "A.B", "A.B.C", "D"]);
		expect([depth("A"), depth("A.B"), depth("A.B.C"), depth("D")]).toEqual([0, 1, 2, 0]);
		// header counts: 2 running (A and nested A.B), 4 total
		expect(screen.getAllByText(/2 运行中/).length).toBeGreaterThan(0);
	});

	it("chip shows direct children count consistently when expanded and collapsed", () => {
		render(<TopCapsule />);
		const open = screen.getByRole("button", { name: /收起 A 的 1 个子代理/ });
		expect(open.textContent).toBe("1 个子代理");
		fireEvent.click(open);
		expect(rowIds()).toEqual(["A", "D"]);
		const chip = screen.getByRole("button", { name: /展开 A 的 1 个子代理/ });
		expect(chip.textContent).toBe("1 个子代理");
		fireEvent.click(chip);
		expect(rowIds()).toEqual(["A", "A.B", "A.B.C", "D"]);
	});
});
