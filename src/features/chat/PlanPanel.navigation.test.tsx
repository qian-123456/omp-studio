// @vitest-environment jsdom
/** Section navigation uses the document scroller, not its positioned ancestors. */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposer } from "../../stores/composer";
import { emptySessionLive, useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import type { PlanStatus } from "./plan/planStatus";
import { PlanPanel } from "./PlanPanel";

vi.mock("./plan/planActions", () => ({
	approvePlan: vi.fn(async () => {}),
	runPlanAction: vi.fn(async () => {}),
}));
vi.mock("../../stores/modelCatalog", () => ({ useModelOptions: () => CATALOG }));
const CATALOG = vi.hoisted(() => []);

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

const APPROACH = "Approach | 按行为执行";
const CONTENT = `# Plan\n\n## Context\n\nBackground.\n\n## ${APPROACH}\n\nDo it.`;
let sid: string;
let seq = 0;

function show(content = CONTENT) {
	const plan: PlanStatus = {
		enabled: false,
		phase: "review",
		planFile: "/tmp/navigation-plan.md",
		planUrl: "local://navigation-plan.md",
		title: "Plan",
		content,
		prevContent: null,
		version: 1,
		planModel: null,
		tiers: [],
		defaultRole: "default",
		contextPercent: 10,
		keepDisabled: false,
		approved: {
			planFile: "/tmp/navigation-plan.md",
			planUrl: "local://navigation-plan.md",
			title: "Plan",
			content,
			prevContent: null,
			version: 1,
			status: "completed",
			error: null,
		},
	};
	act(() => {
		useUi.setState({ selectedSessionId: sid });
		useLive.setState({ sessions: { [sid]: { ...emptySessionLive(), alive: true, plan } } });
	});
}

function navigation() {
	return within(screen.getByRole("navigation", { name: "目录" }));
}

function geometry() {
	const first = screen.getByRole("heading", { level: 2, name: "Context" });
	const second = screen.getByRole("heading", { level: 2, name: APPROACH });
	const scroller = second.closest("[data-plan-body]")!.parentElement!;
	vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 180, 300, 400));
	vi.spyOn(first, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 190, 240, 20));
	const secondBounds = vi.spyOn(second, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 500, 240, 20));
	// offsetTop is deliberately relative to a different positioned ancestor.
	Object.defineProperty(second, "offsetTop", { configurable: true, value: 900 });
	Object.defineProperty(scroller, "clientTop", { configurable: true, value: 2 });
	scroller.scrollTop = 120;
	const scrollTo = vi.fn();
	scroller.scrollTo = scrollTo;
	fireEvent.scroll(scroller);
	return { scroller, secondBounds, scrollTo };
}

beforeEach(() => {
	sid = `plan-navigation-${++seq}`;
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	act(() => {
		useLive.setState({ sessions: {} });
		useUi.setState({ selectedSessionId: null });
		useComposer.setState({ annotations: {} });
	});
});

describe("PlanPanel section navigation", () => {
	it("jumps using the section's position inside the already-scrolled document", () => {
		show();
		render(<PlanPanel />);
		const { scrollTo } = geometry();
		fireEvent.click(navigation().getByRole("button", { name: (name) => name.includes(APPROACH) }));
		expect(scrollTo).toHaveBeenCalledWith({ top: 430, behavior: "smooth" });
	});

	it("keeps the full current heading and accessible section selection in sync with scrolling", () => {
		show();
		render(<PlanPanel />);
		const { scroller, secondBounds } = geometry();
		expect(navigation().getByRole("button", { current: "location" }).textContent).toContain("Context");
		expect(screen.getByRole("button", { name: /^目录/ }).textContent).toContain("01");
		secondBounds.mockReturnValue(new DOMRect(0, 188, 240, 20));
		fireEvent.scroll(scroller);
		expect(navigation().getByRole("button", { current: "location" }).textContent).toContain(APPROACH);
		const trigger = screen.getByRole("button", { name: /^目录/ });
		expect(trigger.textContent).toContain("02");
		expect(trigger.textContent).toContain(APPROACH);
	});

	it("closes the contents popup after jumping and can reopen and dismiss it", () => {
		show();
		render(<PlanPanel />);
		const { scrollTo } = geometry();
		const trigger = screen.getByRole("button", { name: /^目录/ });
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		const choices = screen.getAllByRole("button", { name: (name) => name.includes(APPROACH) });
		fireEvent.click(choices[choices.length - 1]);
		expect(scrollTo).toHaveBeenCalledWith({ top: 430, behavior: "smooth" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
	});

	it.each([`## ${APPROACH}`, APPROACH])("assigns a quote beginning with %s to its own section", (text) => {
		show();
		act(() => useComposer.getState().addAnnotation(sid, {
			source: "doc", file: "local://navigation-plan.md", text,
		}));
		render(<PlanPanel />);
		const first = navigation().getByRole("button", { name: /Context/ });
		const second = navigation().getByRole("button", { name: (name) => name.includes(APPROACH) });
		expect(first.textContent).not.toContain("条批注");
		expect(second.textContent).toContain("1 条批注");
	});

	it("binds every mixed CommonMark directory entry to the matching rendered heading", () => {
		const content = [
			"# Plan", "", "## Before", "", "````markdown", "```", "## Fenced", "~~~",
			"## Still fenced", "````", "", "Setext", "---", "",
			"> ## Quoted", "", "- ## Listed", "", "Outside the list.", "", "   ## Three spaces", "",
			"    ## Indented code", "", "## After",
		].join("\n");
		show(content);
		render(<PlanPanel />);
		const titles = ["Before", "Setext", "Quoted", "Listed", "Three spaces", "After"];
		const headings = screen.getAllByRole("heading", { level: 2 });
		expect(headings.map((heading) => heading.textContent)).toEqual(titles);
		const choices = navigation().getAllByRole("button");
		expect(choices).toHaveLength(titles.length);
		const scroller = headings[0].closest("[data-plan-body]")!.parentElement!;
		scroller.scrollTop = 120;
		const scrollTo = vi.fn();
		scroller.scrollTo = scrollTo;
		vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 180, 300, 400));
		headings.forEach((heading, i) => {
			vi.spyOn(heading, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 400 + i * 80, 240, 20));
		});
		choices.forEach((choice, i) => {
			expect(choice.textContent).toContain(titles[i]);
			fireEvent.click(choice);
			expect(scrollTo).toHaveBeenLastCalledWith({ top: 332 + i * 80, behavior: "smooth" });
		});
	});

	it("attributes a quote after fenced fake headings and a Setext heading using the same section index", () => {
		const content = [
			"## Before", "", "````", "```", "## Not a section", "````", "",
			"Setext", "---", "", "Quoted body.", "", "> ## Quoted", "", "Last body.",
		].join("\n");
		show(content);
		act(() => {
			useComposer.getState().addAnnotation(sid, {
				source: "doc", file: "local://navigation-plan.md", text: "Quoted body.",
			});
			useComposer.getState().addAnnotation(sid, {
				source: "doc", file: "local://navigation-plan.md", text: "> ## Quoted",
			});
		});
		render(<PlanPanel />);
		const choices = navigation().getAllByRole("button");
		expect(choices).toHaveLength(3);
		expect(choices[0].textContent).not.toContain("条批注");
		expect(choices[1].textContent).toContain("Setext");
		expect(choices[1].textContent).toContain("1 条批注");
		expect(choices[2].textContent).toContain("Quoted");
		expect(choices[2].textContent).toContain("1 条批注");
	});
});
