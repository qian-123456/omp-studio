import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateSessionResult } from "../../../lib/createSession";
import { approvePlan } from "./planActions";

const h = vi.hoisted(() => ({
	createSession: vi.fn(),
	rpcSend: vi.fn(),
	upsert: vi.fn(),
	selectSession: vi.fn(),
	events: [] as string[],
	sessions: {} as Record<string, { cwd: string; workspaceId: string; mode: string; groupId: string }>,
}));
vi.mock("../../../lib/createSession", () => ({ createSession: h.createSession }));
vi.mock("../../../lib/ipc", () => ({ rpcSend: h.rpcSend }));
vi.mock("../../../stores/sessions", () => ({ useSessions: { getState: () => ({ sessions: h.sessions, upsert: h.upsert }) } }));
vi.mock("../../../stores/ui", () => ({ useUi: { getState: () => ({ selectSession: h.selectSession }) } }));

function destination(id: string): CreateSessionResult {
	return {
		sessionId: id,
		stub: {
			id, tool: "omp", file: `/tmp/${id}.jsonl`, cwd: "/repo", title: "", label: "",
			createdAt: "", updatedAt: "", parentId: null, forkDepth: 0, status: "working",
			unread: false, pending: null, live: true, externalPid: null, pinned: false,
			archived: false, workspaceId: "workspace", repoRoot: null, git: null,
			result: null, lastAssistant: null, model: null, attention: "running", mode: "code", groupId: "group",
		},
	};
}

let sequence = 0;
let source: string;
let next: string;
const plan = { planFile: "/tmp/approved-plan.md" };
const runMessage = "/plan-action run @default /tmp/approved-plan.md";

beforeEach(() => {
	vi.resetAllMocks();
	source = `approval-source-${++sequence}`;
	next = `approval-destination-${sequence}`;
	h.events.length = 0;
	h.sessions = { [source]: { cwd: "/repo", workspaceId: "workspace", mode: "code", groupId: "group" } };
	h.createSession.mockImplementation(async () => {
		h.events.push("create");
		return destination(next);
	});
	h.rpcSend.mockImplementation(async (id: string, cmd: { message: string }) => {
		h.events.push(`${id}:${cmd.message}`);
	});
	h.upsert.mockImplementation(() => h.events.push("upsert"));
	h.selectSession.mockImplementation(() => h.events.push("select"));
});

describe("approvePlan fresh execution", () => {
	it("accepts the destination run before exiting the source and selecting the destination", async () => {
		// The project's ES2021 Promise API does not include withResolvers.
		let accept!: () => void;
		const accepted = new Promise<void>((resolve) => { accept = resolve; });
		h.rpcSend.mockImplementationOnce((id: string, cmd: { message: string }) => {
			h.events.push(`${id}:${cmd.message}`);
			return accepted;
		});
		const approval = approvePlan(source, plan, "execute", "default");
		await Promise.resolve();
		expect(h.events).toEqual(["create", `${next}:${runMessage}`]);
		expect(h.upsert).not.toHaveBeenCalled();
		expect(h.selectSession).not.toHaveBeenCalled();
		accept();
		await expect(approval).resolves.toBe(next);
		expect(h.events).toEqual(["create", `${next}:${runMessage}`, "upsert", `${source}:/plan-action approve execute`, "select"]);
		expect(h.createSession).toHaveBeenCalledWith({
			cwd: "/repo", workspaceId: "workspace", mode: "code", groupId: "group", prompt: runMessage,
		});
		expect(h.upsert).toHaveBeenCalledWith([destination(next).stub]);
		expect(h.selectSession).toHaveBeenCalledWith(next);
	});

	it("keeps the source review untouched when creation fails and allows an immediate retry", async () => {
		h.createSession.mockRejectedValueOnce(new Error("cannot create"));
		await expect(approvePlan(source, plan, "execute", "default")).rejects.toThrow("cannot create");
		expect(h.rpcSend).not.toHaveBeenCalled();
		expect(h.upsert).not.toHaveBeenCalled();
		expect(h.selectSession).not.toHaveBeenCalled();
		await expect(approvePlan(source, plan, "execute", "default")).resolves.toBe(next);
		expect(h.createSession).toHaveBeenCalledTimes(2);
		expect(h.rpcSend.mock.calls).toEqual([
			[next, { type: "prompt", message: runMessage }],
			[source, { type: "prompt", message: "/plan-action approve execute" }],
		]);
	});

	it("reuses the destination after send failure without leaving the source review", async () => {
		h.rpcSend.mockRejectedValueOnce(new Error("cannot send"));
		await expect(approvePlan(source, plan, "execute", "default")).rejects.toThrow("cannot send");
		expect(h.rpcSend.mock.calls).toEqual([[next, { type: "prompt", message: runMessage }]]);
		expect(h.upsert).not.toHaveBeenCalled();
		expect(h.selectSession).not.toHaveBeenCalled();
		await expect(approvePlan(source, plan, "execute", "default")).resolves.toBe(next);
		expect(h.createSession).toHaveBeenCalledTimes(1);
		expect(h.rpcSend.mock.calls).toEqual([
			[next, { type: "prompt", message: runMessage }],
			[next, { type: "prompt", message: runMessage }],
			[source, { type: "prompt", message: "/plan-action approve execute" }],
		]);
	});

	it("retries source finalization without executing again even if retry changes mode", async () => {
		h.rpcSend.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("cannot exit"));
		await expect(approvePlan(source, plan, "execute", "default")).rejects.toThrow("cannot exit");
		expect(h.selectSession).not.toHaveBeenCalled();
		await expect(approvePlan(source, plan, "keep", "smol")).resolves.toBe(next);
		expect(h.createSession).toHaveBeenCalledTimes(1);
		expect(h.rpcSend.mock.calls).toEqual([
			[next, { type: "prompt", message: runMessage }],
			[source, { type: "prompt", message: "/plan-action approve execute" }],
			[source, { type: "prompt", message: "/plan-action approve execute" }],
		]);
	});

	it("coalesces simultaneous approvals into one destination and one execution", async () => {
		let created!: (result: CreateSessionResult) => void;
		const creation = new Promise<CreateSessionResult>((resolve) => { created = resolve; });
		h.createSession.mockReturnValueOnce(creation);
		const first = approvePlan(source, plan, "execute", "default");
		const second = approvePlan(source, plan, "execute", "default");
		expect(h.createSession).toHaveBeenCalledTimes(1);
		created(destination(next));
		await expect(Promise.all([first, second])).resolves.toEqual([next, next]);
		expect(h.rpcSend).toHaveBeenCalledTimes(2);
		expect(h.selectSession).toHaveBeenCalledTimes(1);
	});

	it.each(["compact", "keep"] as const)("preserves %s execution in the source session", async (mode) => {
		await expect(approvePlan(source, plan, mode, "default")).resolves.toBe(source);
		expect(h.createSession).not.toHaveBeenCalled();
		expect(h.selectSession).not.toHaveBeenCalled();
		expect(h.rpcSend.mock.calls).toEqual([[source, { type: "prompt", message: `/plan-action approve ${mode} default` }]]);
	});
});
