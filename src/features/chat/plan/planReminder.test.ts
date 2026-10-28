import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import planMode, { endedByAbort, shouldRemind } from "../../../../extension/omp-workspace-plan";

const asst = (stopReason: string) => ({ role: "assistant", stopReason });

describe("plan reminder", () => {
	it("skips the reminder after a user abort", () => {
		expect(shouldRemind(false, 0, [asst("aborted")])).toBe(false);
	});
	it("reminds on a normal end without a plan file", () => {
		expect(shouldRemind(false, 0, [asst("stop")])).toBe(true);
	});
	it("does not remind when reminders are spent or a plan exists", () => {
		expect(shouldRemind(false, 1, [asst("stop")])).toBe(false);
		expect(shouldRemind(true, 0, [asst("stop")])).toBe(false);
	});
	it("ignores non-assistant tail messages and missing lists", () => {
		expect(endedByAbort([asst("aborted"), { role: "toolResult" }])).toBe(true);
		expect(endedByAbort([asst("stop"), { role: "user" }])).toBe(false);
		expect(endedByAbort(undefined)).toBe(false);
		expect(shouldRemind(false, 0, undefined)).toBe(true);
	});
});

type PlanApi = Parameters<typeof planMode>[0];
type PlanHandler = Parameters<PlanApi["on"]>[1];
type PlanContext = Parameters<PlanHandler>[1];
type PlanCommand = Parameters<PlanApi["registerCommand"]>[1]["handler"];

describe("plan extension registered agent_end handler", () => {
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

	async function setup() {
		const root = mkdtempSync(join(tmpdir(), "ompws-plan-reminder-"));
		roots.push(root);
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
			// In-memory settings only: never consult the developer's OMP configuration.
			pi: { Settings: { instance: { get: () => undefined, getModelRole: () => undefined } } },
		} satisfies PlanApi;
		const ctx = {
			cwd: root,
			ui: { setStatus: vi.fn(), notify: vi.fn() },
			sessionManager: { getEntries: () => [], getArtifactsDir: () => root },
		} satisfies PlanContext;

		// Register the shipped default extension, not a copy of its reminder logic.
		planMode(pi);
		const start = handlers.get("session_start");
		const end = handlers.get("agent_end");
		const input = handlers.get("input");
		const action = commands.get("plan-action");
		if (!start || !end || !input || !action) throw new Error("Plan extension handlers were not registered");
		await start({ type: "session_start" } as never, ctx);
		await action("enable", ctx);
		pi.sendMessage.mockClear();
		pi.appendEntry.mockClear();
		ctx.ui.setStatus.mockClear();
		return {
			pi,
			ctx,
			root,
			end: (messages: unknown[]) => end({ type: "agent_end", messages } as never, ctx),
			input: () => input({ type: "input", text: "Continue planning" } as never, ctx),
		};
	}

	it("does not queue a reminder after the latest assistant is aborted, but still publishes status", async () => {
		const t = await setup();
		await t.end([asst("aborted"), { role: "toolResult", isError: true }]);
		expect(t.pi.sendMessage).not.toHaveBeenCalled();
		expect(t.pi.appendEntry).toHaveBeenCalledWith("ompws-plan-state", expect.objectContaining({ enabled: true }));
		expect(t.ctx.ui.setStatus).toHaveBeenCalledWith("ompws-plan", expect.any(String));
		expect(JSON.parse(t.ctx.ui.setStatus.mock.calls[0][1])).toMatchObject({ enabled: true, phase: "planning", content: null });
	});

	it.each(["stop", "toolUse"])("queues one hidden continuation for a normal %s end without a plan", async (reason) => {
		const t = await setup();
		await t.end([asst(reason)]);
		expect(t.pi.sendMessage).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ customType: "ompws-plan-reminder", content: expect.any(String), display: false }),
			{ triggerTurn: true },
		);
	});

	it.each(["stop", "toolUse"])("uses latest %s over an earlier aborted assistant", async (reason) => {
		const t = await setup();
		await t.end([asst("aborted"), { role: "user", content: "Continue" }, asst(reason), { role: "toolResult" }]);
		expect(t.pi.sendMessage).toHaveBeenCalledTimes(1);
	});

	it.each(["stop", "toolUse"])("uses latest aborted over an earlier %s assistant", async (reason) => {
		const t = await setup();
		await t.end([asst(reason), { role: "toolResult" }, asst("aborted"), { role: "custom", customType: "status" }]);
		expect(t.pi.sendMessage).not.toHaveBeenCalled();
	});

	it("does not spend the reminder budget on abort and resets it only on input", async () => {
		const t = await setup();
		await t.end([asst("aborted")]);
		await t.end([asst("stop")]);
		await t.end([asst("stop")]);
		expect(t.pi.sendMessage).toHaveBeenCalledTimes(1);
		await t.input();
		await t.end([asst("stop")]);
		expect(t.pi.sendMessage).toHaveBeenCalledTimes(2);
	});

	it("publishes a discovered plan for review without queuing a reminder", async () => {
		const t = await setup();
		const local = join(t.root, "local");
		mkdirSync(local);
		const content = "# Stop boundary plan\n\n- Preserve the abort contract.\n";
		writeFileSync(join(local, "boundary-plan.md"), content);
		await t.end([asst("stop")]);
		expect(t.pi.sendMessage).not.toHaveBeenCalled();
		expect(JSON.parse(t.ctx.ui.setStatus.mock.calls[0][1])).toMatchObject({ enabled: true, phase: "review", content, version: 1 });
	});
});
