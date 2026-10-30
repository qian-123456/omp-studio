// @vitest-environment jsdom
/** Opening the panel with an unknown plan state reads status read-only, even for an idle (not alive) session. */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import { emptySessionLive, useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import { PLAN_OFF, type ApprovedPlan, type PlanStatus } from "./plan/planStatus";
import { PlanPanel } from "./PlanPanel";

const h = vi.hoisted(() => ({ rpcSend: vi.fn(), ensureLive: vi.fn() }));
vi.mock("../../lib/ipc", async (original) => ({ ...(await original<typeof IpcModule>()), rpcSend: h.rpcSend }));
vi.mock("../../lib/ensureLive", () => ({ ensureLive: h.ensureLive }));

vi.stubGlobal(
	"ResizeObserver",
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

let SID = "plan-cold-session";
let seq = 0;

const approved: ApprovedPlan = {
	planFile: "/tmp/a-plan.md",
	planUrl: "local://a-plan.md",
	title: "Plan A",
	content: "# Plan A\n\nbody",
	prevContent: null,
	version: 2,
	status: "failed",
	error: "model-unavailable",
};
const approvedOff: PlanStatus = { ...PLAN_OFF, approved };

const open = (live: { alive: boolean; plan?: PlanStatus; streaming?: boolean }) =>
	act(() => {
		useUi.setState({ selectedSessionId: SID });
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), ...live } } });
	});

const statusCalls = () => h.rpcSend.mock.calls.filter((c) => JSON.stringify(c).includes("status"));

beforeEach(() => {
	SID = `plan-cold-session-${++seq}`;
	h.rpcSend.mockReset().mockResolvedValue({});
	h.ensureLive.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	act(() => {
		useLive.setState({ sessions: {} });
		useUi.setState({ selectedSessionId: null });
	});
});

describe("PlanPanel unknown plan state", () => {
	it("wakes a cold session, requests status, and never shows the Enable hint while unknown", async () => {
		open({ alive: false });
		render(<PlanPanel />);
		await waitFor(() => expect(statusCalls()).toHaveLength(1));
		expect(h.ensureLive).toHaveBeenCalledWith(SID);
		expect(screen.queryByText("开启规划模式")).toBeNull();
		expect(screen.queryByText("当前未开启规划模式")).toBeNull();
	});

	it("shows the persisted approved plan once the status arrives", async () => {
		open({ alive: false });
		render(<PlanPanel />);
		await waitFor(() => expect(statusCalls()).toHaveLength(1));
		act(() => {
			useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, plan: approvedOff } } });
		});
		expect(screen.getAllByText(/body/).length).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: "批准并执行" })).toBeNull();
		expect(screen.queryByRole("button", { name: "开启规划模式" })).toBeNull();
		expect(statusCalls()).toHaveLength(1);
	});

	it("shows a read failure, not the Enable hint, when the status request fails", async () => {
		h.ensureLive.mockRejectedValue(new Error("spawn failed"));
		open({ alive: false });
		render(<PlanPanel />);
		expect(await screen.findByText(/读取计划状态失败：.*spawn failed/)).toBeTruthy();
		expect(screen.queryByText("开启规划模式")).toBeNull();
		expect(h.rpcSend).not.toHaveBeenCalled();
	});

	it("does not query while streaming, nor when the state is already known", async () => {
		open({ alive: false, streaming: true });
		const { unmount } = render(<PlanPanel />);
		unmount();
		open({ alive: false, plan: approvedOff });
		render(<PlanPanel />);
		expect(screen.getAllByText(/body/).length).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: "批准并执行" })).toBeNull();
		expect(screen.queryByRole("button", { name: "开启规划模式" })).toBeNull();
		expect(h.rpcSend).not.toHaveBeenCalled();
		expect(h.ensureLive).not.toHaveBeenCalled();
	});

	it("keeps the Enable button for a known-off plan without querying", () => {
		open({ alive: false, plan: PLAN_OFF });
		render(<PlanPanel />);
		expect(screen.getByRole("button", { name: "开启规划模式" })).toBeTruthy();
		expect(h.rpcSend).not.toHaveBeenCalled();
	});

	it("ignores a late failure from a session the panel has switched away from", async () => {
		let rejectWake: (reason: Error) => void = () => {};
		const wake = new Promise<void>((_, reject) => {
			rejectWake = reject;
		});
		h.ensureLive.mockImplementationOnce(() => wake);
		const first = SID;
		open({ alive: false });
		render(<PlanPanel />);
		await waitFor(() => expect(h.ensureLive).toHaveBeenCalledWith(first));
		SID = `${first}-other`;
		open({ alive: true, plan: PLAN_OFF });
		await act(async () => rejectWake(new Error("late")));
		expect(screen.queryByText(/读取计划状态失败/)).toBeNull();
		expect(screen.getByRole("button", { name: "开启规划模式" })).toBeTruthy();
	});
});
