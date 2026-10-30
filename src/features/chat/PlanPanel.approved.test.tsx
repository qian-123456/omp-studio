// @vitest-environment jsdom
/** Approved-plan state, diff availability after a reload, and approval arguments. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import { emptySessionLive, useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import { approvePlan } from "./plan/planActions";
import { parsePlanStatus, PLAN_OFF, type PlanStatus } from "./plan/planStatus";
import { PlanPanel } from "./PlanPanel";

const h = vi.hoisted(() => ({ rpcSend: vi.fn() }));
vi.mock("../../lib/ipc", async (original) => ({ ...(await original<typeof IpcModule>()), rpcSend: h.rpcSend }));

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

let SID = "plan-approved-session";
let seq = 0;
const review: PlanStatus = {
	enabled: true, phase: "review", planFile: "/tmp/a-plan.md", planUrl: "local://a-plan.md",
	title: "Plan A", content: "# Plan A\n\n## Step\n\nnew text", prevContent: "# Plan A\n\n## Step\n\nold text", version: 2,
	planModel: null, tiers: [], defaultRole: "default", contextPercent: 10, keepDisabled: false,
};

const show = (plan: PlanStatus) =>
	act(() => {
		useUi.setState({ selectedSessionId: SID });
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, plan } } });
	});

beforeEach(() => {
	SID = `plan-approved-session-${++seq}`;
	h.rpcSend.mockReset().mockResolvedValue({});
});
afterEach(() => {
	cleanup();
	act(() => {
		useLive.setState({ sessions: {} });
		useUi.setState({ selectedSessionId: null });
	});
});

describe("approved plan status", () => {
	const approvedFrame = (status: string, error: string | null = null) =>
		JSON.stringify({
			v: 1,
			enabled: false,
			approved: { planFile: "/tmp/a-plan.md", planUrl: "local://a-plan.md", title: "Plan A", content: "# Plan A\n\nbody", prevContent: null, version: 2, status, error },
		});

	it("keeps the approved plan on an off status and rejects unknown statuses", () => {
		expect(parsePlanStatus(approvedFrame("executing"))?.approved).toMatchObject({ status: "executing", content: "# Plan A\n\nbody", version: 2 });
		expect(parsePlanStatus(approvedFrame("bogus"))).toEqual(PLAN_OFF);
		expect(parsePlanStatus(JSON.stringify({ v: 1, enabled: false, approved: null }))).toEqual(PLAN_OFF);
	});

	it.each([
		["executing", "已批准计划 · 正在执行"],
		["completed", "已批准计划 · 执行完成"],
		["failed", "已批准计划 · 执行失败"],
		["handoff", "已批准计划 · 已在新会话中执行"],
	])("shows the real %s state without the approval dock or the not-enabled hint", (status, label) => {
		show(parsePlanStatus(approvedFrame(status, status === "failed" ? "error" : null))!);
		render(<PlanPanel />);
		expect(screen.getByText(label)).toBeTruthy();
		expect(screen.queryByRole("button", { name: "批准并执行" })).toBeNull();
		expect(screen.queryByText("当前未开启规划模式")).toBeNull();
	});

	it("reports an aborted run as stopped", () => {
		show(parsePlanStatus(approvedFrame("failed", "aborted"))!);
		render(<PlanPanel />);
		expect(screen.getByText("已批准计划 · 执行已中止")).toBeTruthy();
	});
});

describe("plan diff", () => {
	it("after a reload the reported prevContent opens a diff with the removed and added lines", () => {
		show(review);
		render(<PlanPanel />);
		fireEvent.click(screen.getByRole("button", { name: /对比/ }));
		const removed = screen.getByText("old text");
		const added = screen.getByText("new text");
		expect(removed.className).toContain("line-through");
		expect(added.className).toContain("emerald");
	});

	it("diffs against the previous body even when the extension reported no prevContent", () => {
		show({ ...review, prevContent: null, version: 1, content: "# Plan A\n\n## Step\n\nfirst" });
		const { rerender } = render(<PlanPanel />);
		expect(screen.queryByRole("button", { name: /对比/ })).toBeNull();
		show({ ...review, prevContent: null, version: 1, content: "# Plan A\n\n## Step\n\nsecond" });
		rerender(<PlanPanel />);
		fireEvent.click(screen.getByRole("button", { name: /对比/ }));
		expect(screen.getByText("first").className).toContain("line-through");
		expect(screen.getByText("second").className).toContain("emerald");
	});
});

describe("approvePlan arguments", () => {
	beforeEach(() => {
		useUi.setState({ selectedSessionId: SID });
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } });
	});

	it.each(["keep", "compact"] as const)("%s continues in the session and forwards a direct model spec", async (mode) => {
		await expect(approvePlan(SID, review, mode, "anthropic/claude-x:high")).resolves.toBe(SID);
		expect(h.rpcSend.mock.calls).toEqual([[SID, { type: "prompt", message: `/plan-action approve ${mode} anthropic/claude-x:high` }]]);
	});

	it("keeps preset roles as role names", async () => {
		await approvePlan(SID, review, "keep", "slow");
		expect(h.rpcSend).toHaveBeenCalledWith(SID, { type: "prompt", message: "/plan-action approve keep slow" });
	});
});
