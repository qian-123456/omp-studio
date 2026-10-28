// @vitest-environment jsdom
/** Exercise the real approval handoff through the review panel, not a mocked approvePlan. */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import type * as IpcModule from "../../lib/ipc";
import type * as CreateSessionModule from "../../lib/createSession";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import type { PlanStatus } from "./plan/planStatus";
import { PlanPanel } from "./PlanPanel";

const h = vi.hoisted(() => ({ createSession: vi.fn(), rpcSend: vi.fn(), error: vi.fn() }));
vi.mock("../../lib/createSession", async (original) => ({
	...(await original<typeof CreateSessionModule>()), createSession: h.createSession,
}));
vi.mock("../../lib/ipc", async (original) => ({
	...(await original<typeof IpcModule>()), rpcSend: h.rpcSend,
}));
vi.mock("../../lib/toast", () => ({ toast: { error: h.error, info: vi.fn(), success: vi.fn() } }));

class NoopResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const review: PlanStatus = {
	enabled: true, phase: "review", planFile: "/tmp/retry-plan.md", planUrl: "local://retry-plan.md",
	title: "Retryable plan", content: "## Step\n\nImplement the plan.", prevContent: null, version: 1,
	planModel: null, tiers: [], defaultRole: "default", contextPercent: 10, keepDisabled: false,
};
function session(id: string): SessionMeta {
	return {
		id, tool: "omp", file: `/tmp/${id}.jsonl`, cwd: "/repo", title: "", label: "",
		createdAt: "", updatedAt: "", parentId: null, forkDepth: 0, status: "idle", unread: false,
		pending: null, live: true, externalPid: null, pinned: false, archived: false, workspaceId: null,
		repoRoot: null, git: null, result: null, lastAssistant: null, model: null, attention: null, mode: "code", groupId: null,
	};
}
let sequence = 0;
let source: string;
let next: string;
const approve = () => screen.getByRole("button", { name: "批准并执行" });

beforeEach(() => {
	vi.resetAllMocks();
	source = `panel-approval-source-${++sequence}`;
	next = `panel-approval-next-${sequence}`;
	act(() => {
		useUi.setState({ selectedSessionId: source });
		useSessions.setState({ sessions: { [source]: session(source) } });
		useLive.setState({ sessions: { [source]: { ...emptySessionLive(), alive: true, plan: review } } });
	});
	vi.spyOn(useUi.getState(), "selectSession").mockImplementation((id) => {
		useUi.setState({ selectedSessionId: id });
	});
	h.createSession.mockResolvedValue({ sessionId: next, stub: { ...session(next), status: "working", attention: "running" } });
	h.rpcSend.mockImplementation(async (id: string) => {
		if (id === source) {
			useLive.setState((state) => ({ sessions: {
				...state.sessions, [source]: { ...state.sessions[source], plan: { ...review, enabled: false } },
			} }));
		}
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	act(() => {
		useLive.setState({ sessions: {} });
		useSessions.setState({ sessions: {} });
		useUi.setState({ selectedSessionId: null });
	});
});

describe("PlanPanel fresh execution approval", () => {
	it.each(["create", "send"] as const)("keeps review and retry enabled after destination %s failure", async (failure) => {
		if (failure === "create") h.createSession.mockRejectedValueOnce(new Error("create failed"));
		else h.rpcSend.mockRejectedValueOnce(new Error("send failed"));
		render(<PlanPanel />);
		fireEvent.click(approve());
		await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
		expect(useUi.getState().selectedSessionId).toBe(source);
		expect(useLive.getState().sessions[source].plan).toMatchObject({ enabled: true, phase: "review" });
		expect((approve() as HTMLButtonElement).disabled).toBe(false);
		expect(h.rpcSend.mock.calls.some(([id]) => id === source)).toBe(false);
		fireEvent.click(approve());
		await waitFor(() => expect(useUi.getState().selectedSessionId).toBe(next));
		expect(useLive.getState().sessions[source].plan?.enabled).toBe(false);
		expect(h.createSession).toHaveBeenCalledTimes(failure === "create" ? 2 : 1);
		expect(h.rpcSend.mock.calls.filter(([id]) => id === source)).toEqual([
			[source, { type: "prompt", message: "/plan-action approve execute" }],
		]);
	});

	it("stays on review during destination send and ignores repeated approval clicks", async () => {
		// The project's ES2021 Promise API does not include withResolvers.
		let accept!: () => void;
		const accepted = new Promise<void>((resolve) => { accept = resolve; });
		h.rpcSend.mockReturnValueOnce(accepted);
		render(<PlanPanel />);
		fireEvent.click(approve());
		await waitFor(() => expect(h.rpcSend).toHaveBeenCalledTimes(1));
		fireEvent.click(approve());
		expect((approve() as HTMLButtonElement).disabled).toBe(true);
		expect(useUi.getState().selectedSessionId).toBe(source);
		expect(useLive.getState().sessions[source].plan?.enabled).toBe(true);
		expect(h.createSession).toHaveBeenCalledTimes(1);
		await act(async () => { accept(); });
		await waitFor(() => expect(useUi.getState().selectedSessionId).toBe(next));
		expect(h.rpcSend.mock.calls).toEqual([
			[next, { type: "prompt", message: "/plan-action run /tmp/retry-plan.md" }],
			[source, { type: "prompt", message: "/plan-action approve execute" }],
		]);
	});
});
