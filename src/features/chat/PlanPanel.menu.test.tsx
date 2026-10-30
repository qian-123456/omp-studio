// @vitest-environment jsdom
/**
 * Approval dock options menu: the first click opens it and it stays open across
 * plan/streaming store updates; the trigger toggles it closed, and an outside
 * press or Escape closes it.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionLive, useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import type { PlanStatus } from "./plan/planStatus";
import { approvePlan } from "./plan/planActions";
import { PlanPanel } from "./PlanPanel";

vi.mock("./plan/planActions", () => ({
	approvePlan: vi.fn(async () => {}),
	runPlanAction: vi.fn(async () => {}),
}));
vi.mock("../../components/ModelSelect", () => ({
	ModelMenuContent: ({ onSelect }: { onSelect: (key: string) => void }) => (
		<button type="button" onClick={() => onSelect("p/m")}>
			pick p/m
		</button>
	),
}));
vi.mock("../../stores/modelCatalog", () => ({
	useModelOptions: () => CATALOG,
}));
const CATALOG = vi.hoisted(() => [{ provider: "p", id: "m", name: "Model M", thinking: ["low", "high"] }]);

const SID = "plan-menu-1";

class NoopResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const plan = (over: Partial<PlanStatus> = {}): PlanStatus => ({
	enabled: true,
	phase: "review",
	planFile: "/tmp/p.md",
	planUrl: "local://p.md",
	title: "P",
	content: "## Step\n\nDo it.",
	prevContent: null,
	version: 1,
	planModel: null,
	tiers: [
		{ role: "smol", spec: "p/m:low" },
		{ role: "default", spec: "p/m:high" },
	],
	defaultRole: "default",
	contextPercent: 10,
	keepDisabled: false,
	...over,
});

const setLive = (p: PlanStatus, streaming = false) =>
	act(() => {
		useLive.setState((s) => ({
			sessions: { ...s.sessions, [SID]: { ...emptySessionLive(), alive: true, plan: p, streaming } },
		}));
	});

const trigger = () => screen.getByTitle("选择执行方式和模型");
const menu = () => document.querySelector('[role="menu"]');
const press = (el: Element) => {
	fireEvent.mouseDown(el);
	fireEvent.mouseUp(el);
	fireEvent.click(el);
};

describe("PlanPanel approval dock menu", () => {
	beforeEach(() => {
		act(() => useUi.setState({ selectedSessionId: SID }));
		setLive(plan());
		render(<PlanPanel />);
	});
	afterEach(() => {
		cleanup();
		act(() => useLive.setState({ sessions: {} }));
	});

	it("opens on the first click and survives plan/streaming updates", () => {
		expect(menu()).toBeNull();
		press(trigger());
		expect(menu()).not.toBeNull();
		expect(trigger().getAttribute("aria-expanded")).toBe("true");
		setLive(plan({ contextPercent: 42 }), true);
		setLive(plan({ contextPercent: 42 }), false);
		expect(menu()).not.toBeNull();
	});

	it("closes on a second trigger click", () => {
		press(trigger());
		press(trigger());
		expect(menu()).toBeNull();
	});

	it("closes on an outside press", () => {
		press(trigger());
		press(document.body);
		expect(menu()).toBeNull();
	});

	it("closes on Escape and keeps working afterwards", () => {
		press(trigger());
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(menu()).toBeNull();
		press(trigger());
		expect(menu()).not.toBeNull();
	});

	it("keeps the menu open while picking a run mode inside it", () => {
		press(trigger());
		const radios = screen.getAllByRole("menuitemradio");
		press(radios[1]);
		expect(menu()).not.toBeNull();
		expect(radios[1].getAttribute("aria-checked")).toBe("true");
	});

	it("picks a free model plus a thinking level and approves with that direct spec", async () => {
		press(trigger());
		press(screen.getByRole("radio", { name: "自选模型" }));
		press(screen.getByRole("button", { name: "pick p/m" }));
		// The picker closes and the model's own thinking levels appear.
		expect(screen.queryByRole("button", { name: "pick p/m" })).toBeNull();
		const levels = screen.getAllByRole("radio", { name: /^(auto|low|high|off)$/ }).map((el) => el.textContent);
		expect(levels).toEqual(["auto", "off", "low", "high"]);
		press(screen.getByRole("radio", { name: "high" }));
		expect(trigger().textContent).toContain("Model M");
		// A preset role goes back to role semantics.
		press(screen.getByRole("radio", { name: "smol" }));
		expect(trigger().textContent).not.toContain("Model M");
		press(screen.getByRole("radio", { name: "自选模型" }));
		press(screen.getByRole("button", { name: "pick p/m" }));
		press(screen.getByRole("radio", { name: "high" }));
		press(trigger());
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "批准并执行" }));
		});
		expect(vi.mocked(approvePlan)).toHaveBeenLastCalledWith(SID, expect.anything(), "execute", "p/m:high");
	});
});
