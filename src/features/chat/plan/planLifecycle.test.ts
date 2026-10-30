/** Plan extension lifecycle: persisted versions, approved states, direct model specs. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import planMode from "../../../../extension/omp-workspace-plan";

type PlanApi = Parameters<typeof planMode>[0];
type PlanHandler = Parameters<PlanApi["on"]>[1];
type PlanCommand = Parameters<PlanApi["registerCommand"]>[1]["handler"];
type Entry = { type: string; customType: string; data: unknown };

const asst = (stopReason: string) => ({ role: "assistant", stopReason });
const TARGET = { provider: "p", id: "m" };

describe("plan extension lifecycle", () => {
	let originalArgv: string[];
	const roots: string[] = [];

	beforeEach(() => {
		originalArgv = process.argv;
		process.argv = [...originalArgv, "--mode=rpc"];
	});
	afterEach(() => {
		process.argv = originalArgv;
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});

	/** One extension instance; `saved` replays persisted state entries like a session resume. */
	async function boot(root: string, saved: Entry[] = []) {
		const handlers = new Map<string, PlanHandler>();
		const commands = new Map<string, PlanCommand>();
		const pi = {
			on: (event, handler) => { handlers.set(event, handler); },
			registerCommand: (name, command) => { commands.set(name, command.handler); },
			getActiveTools: () => ["read"],
			getAllTools: () => [{ name: "read" }],
			setActiveTools: vi.fn(async () => {}),
			setModel: vi.fn(async () => true),
			getThinkingLevel: () => undefined,
			setThinkingLevel: vi.fn(),
			sendMessage: vi.fn<PlanApi["sendMessage"]>(),
			sendUserMessage: vi.fn(),
			appendEntry: vi.fn(),
			pi: { Settings: { instance: { get: () => undefined, getModelRole: () => undefined } } },
		} satisfies PlanApi;
		const ctx = {
			cwd: root,
			model: { provider: "q", id: "n" },
			models: { resolve: (spec: string) => (spec === "p/m" ? TARGET : undefined) },
			ui: { setStatus: vi.fn(), notify: vi.fn() },
			sessionManager: { getEntries: () => saved, getArtifactsDir: () => root },
		} satisfies Parameters<PlanHandler>[1];
		planMode(pi);
		await handlers.get("session_start")!({ type: "session_start" } as never, ctx);
		const action = (args: string) => commands.get("plan-action")!(args, ctx);
		const status = () => {
			const calls = ctx.ui.setStatus.mock.calls;
			return JSON.parse(calls[calls.length - 1][1] as string);
		};
		const lastState = (): Entry => {
			const calls = pi.appendEntry.mock.calls as unknown as [string, unknown][];
			const last = calls[calls.length - 1];
			return { type: "custom", customType: last[0], data: JSON.parse(JSON.stringify(last[1])) };
		};
		return {
			pi,
			ctx,
			action,
			status,
			lastState,
			fire: (event: string, payload: object) => handlers.get(event)!({ type: event, ...payload } as never, ctx),
		};
	}

	function newRoot() {
		const root = mkdtempSync(join(tmpdir(), "ompws-plan-life-"));
		roots.push(root);
		mkdirSync(join(root, "local"));
		return root;
	}
	const writePlan = (root: string, text: string) => writeFileSync(join(root, "local", "a-plan.md"), text);

	/** A reviewed plan ready to approve. */
	async function reviewed(root: string) {
		const t = await boot(root);
		await t.action("enable");
		writePlan(root, "# A\n\nbody one\n");
		await t.fire("agent_end", { messages: [asst("stop")] });
		return t;
	}

	it("persists each changed plan file as a version via tool_result and restores it after reload", async () => {
		const root = newRoot();
		const t = await boot(root);
		await t.action("enable");
		writePlan(root, "# A\n\nv1\n");
		await t.fire("tool_result", { toolName: "write" });
		expect(t.lastState().data).toMatchObject({ version: 1, lastContent: "# A\n\nv1\n" });
		writePlan(root, "# A\n\nv2\n");
		await t.fire("tool_result", { toolName: "edit" });
		expect(t.lastState().data).toMatchObject({ version: 2, lastContent: "# A\n\nv2\n", prevContent: "# A\n\nv1\n" });

		const reloaded = await boot(root, [t.lastState()]);
		expect(reloaded.status()).toMatchObject({ enabled: true, version: 2, content: "# A\n\nv2\n", prevContent: "# A\n\nv1\n" });
	});

	it("bumps the version when status finds an edited file (user editor) and persists it", async () => {
		const root = newRoot();
		const t = await reviewed(root);
		writePlan(root, "# A\n\nedited\n");
		await t.action("status");
		expect(t.status()).toMatchObject({ version: 2, content: "# A\n\nedited\n", prevContent: "# A\n\nbody one\n" });
		expect(t.lastState().data).toMatchObject({ version: 2 });
	});

	it.each(["keep", "compact"])("approve %s applies a direct model spec and reports executing then completed", async (how) => {
		const root = newRoot();
		const t = await reviewed(root);
		await t.action(`approve ${how} p/m:high`);
		expect(t.pi.setModel).toHaveBeenCalledWith(TARGET);
		expect(t.pi.setThinkingLevel).toHaveBeenCalledWith("high");
		expect(t.pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(t.status()).toMatchObject({ enabled: false, approved: { status: "executing", content: "# A\n\nbody one\n", version: 1 } });
		await t.fire("agent_end", { messages: [asst("stop")] });
		expect(t.status().approved).toMatchObject({ status: "completed", error: null });
	});

	it("reports aborted and errored execution as failed with the reason", async () => {
		for (const [reason, error] of [["aborted", "aborted"], ["error", "error"]] as const) {
			const t = await reviewed(newRoot());
			await t.action("approve keep");
			await t.fire("agent_end", { messages: [asst(reason)] });
			expect(t.status().approved).toMatchObject({ status: "failed", error });
		}
	});

	it("keeps the approved state across a reload and then completes it", async () => {
		const root = newRoot();
		const t = await reviewed(root);
		await t.action("approve compact");
		const reloaded = await boot(root, [t.lastState()]);
		expect(reloaded.status()).toMatchObject({ enabled: false, approved: { status: "executing" } });
		await reloaded.fire("agent_end", { messages: [asst("stop")] });
		expect(reloaded.status().approved.status).toBe("completed");
	});

	it("an unavailable explicit model blocks approval: nothing dispatched, plan mode stays on, retry works", async () => {
		const t = await reviewed(newRoot());
		await t.action("approve keep nope/missing");
		expect(t.pi.setModel).not.toHaveBeenCalled();
		expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
		expect(t.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("not approved"), "error");
		expect(t.status()).toMatchObject({ enabled: true, phase: "review" });
		await t.action("approve keep p/m:low");
		expect(t.pi.setModel).toHaveBeenCalledWith(TARGET);
		expect(t.pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(t.status().approved).toMatchObject({ status: "executing" });
	});

	it("an explicit model whose setModel is refused also blocks approval", async () => {
		const t = await reviewed(newRoot());
		t.pi.setModel.mockResolvedValueOnce(false);
		await t.action("approve compact p/m");
		expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
		expect(t.status()).toMatchObject({ enabled: true });
	});

	it("run with an unavailable explicit model reports failed and never sends the prompt", async () => {
		const root = newRoot();
		writePlan(root, "# A\n\nbody one\n");
		const t = await boot(root);
		await t.action(`run @nope/missing ${join(root, "local", "a-plan.md")}`);
		expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
		expect(t.status().approved).toMatchObject({ status: "failed", error: "model-unavailable" });
		expect(t.ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("not executed"), "error");
	});

	it("fresh-session approve hands off without an execution turn in the source", async () => {
		const t = await reviewed(newRoot());
		await t.action("approve execute p/m");
		expect(t.pi.sendUserMessage).not.toHaveBeenCalled();
		expect(t.status().approved).toMatchObject({ status: "handoff" });
		await t.fire("agent_end", { messages: [asst("stop")] });
		expect(t.status().approved.status).toBe("handoff");
	});

	it("run publishes the approved plan before switching model or sending the prompt", async () => {
		const root = newRoot();
		writePlan(root, "# A\n\nbody one\n");
		const t = await boot(root);
		await t.action(`run @p/m:low ${join(root, "local", "a-plan.md")}`);
		const statusOrder = t.ctx.ui.setStatus.mock.invocationCallOrder;
		const approvedAt = statusOrder[statusOrder.length - 1];
		expect(approvedAt).toBeLessThan(t.pi.setModel.mock.invocationCallOrder[0]);
		expect(approvedAt).toBeLessThan(t.pi.sendUserMessage.mock.invocationCallOrder[0]);
		expect(t.status()).toMatchObject({ enabled: false, approved: { status: "executing", title: "A" } });
		await t.fire("agent_end", { messages: [asst("stop")] });
		expect(t.status().approved.status).toBe("completed");
	});

	it("leaves no stale approved state after disable or when a new plan starts", async () => {
		const t = await reviewed(newRoot());
		await t.action("approve keep");
		expect(t.status().approved).not.toBeNull();
		await t.action("enable");
		expect(t.status()).toMatchObject({ enabled: true, content: null });
		expect(t.status().approved).toBeUndefined();
		await t.action("disable");
		expect(t.status()).toEqual({ v: 1, enabled: false, approved: null });
	});

	it("a late agent_end of the old run does not complete a newly started plan", async () => {
		const t = await reviewed(newRoot());
		await t.action("approve keep");
		await t.action("enable");
		await t.fire("agent_end", { messages: [asst("stop")] });
		expect(t.status()).toMatchObject({ enabled: true });
		expect(t.status().approved).toBeUndefined();
	});
});
