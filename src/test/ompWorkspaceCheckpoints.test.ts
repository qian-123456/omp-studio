// @vitest-environment node
import type * as ChildProcess from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import checkpoints from "../../extension/omp-workspace-checkpoints";

const failures = vi.hoisted(() => ({
	git: null as ((args: readonly string[]) => boolean) | null,
}));

vi.mock("node:child_process", async () => {
	const actual = await vi.importActual<typeof ChildProcess>("node:child_process");
	return {
		...actual,
		execFileSync: (file: string, args: readonly string[], options: unknown) => {
			if (file === "git" && failures.git?.(args)) throw new Error("injected git failure");
			return actual.execFileSync(file, args, options as ChildProcess.ExecFileSyncOptions);
		},
	};
});

const { execFileSync } = await vi.importActual<typeof ChildProcess>("node:child_process");
const roots: string[] = [];
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, {
	cwd,
	encoding: "utf8",
	env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
}).trim();

function repository() {
	const cwd = mkdtempSync(join(tmpdir(), "omp-checkpoint-test-"));
	roots.push(cwd);
	git(cwd, "init", "-q", "-b", "main");
	git(cwd, "config", "user.email", "checkpoint@test.invalid");
	git(cwd, "config", "user.name", "Checkpoint test");
	writeFileSync(join(cwd, "f.txt"), "base\n");
	git(cwd, "add", "f.txt");
	git(cwd, "commit", "-q", "-m", "initial");
	return cwd;
}

function fixture() {
	const cwd = repository();
	type Api = Parameters<typeof checkpoints>[0];
	type Handler = Parameters<Api["on"]>[1];
	const handlers = new Map<string, Handler>();
	const entries: { customType: string; data: Record<string, unknown> }[] = [];
	const appendEntry = vi.fn((customType: string, data: unknown): void => {
		entries.push({ customType, data: data as Record<string, unknown> });
	});
	const api: Api = { on: (event, handler) => void handlers.set(event, handler), appendEntry };
	checkpoints(api);
	const ctx = {
		cwd,
		agent: { kind: "main" },
		sessionManager: {
			getSessionId: () => "sess1",
			getBranch: () => [{ type: "message", id: "user1", message: { role: "user", content: "edit file" } }],
		},
	};
	const fire = (event: string, context = ctx) => {
		const handler = handlers.get(event);
		expect(handler, `registered ${event} handler`).toBeDefined();
		return handler!({}, context);
	};
	const edit = (text = "changed\n") => writeFileSync(join(cwd, "f.txt"), text);
	return { cwd, ctx, api, fire, edit, appendEntry, entries };
}

const refs = (cwd: string) => git(cwd, "for-each-ref", "--format=%(refname)", "refs/omp/").split("\n").filter(Boolean);

afterEach(() => {
	failures.git = null;
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checkpoint extension registered handlers", () => {
	it("persists a changed turn and keeps both snapshots after lifecycle reset", async () => {
		const f = fixture();
		f.fire("agent_start");
		f.edit();
		await f.fire("agent_end");
		expect(f.entries).toHaveLength(1);
		expect(f.entries[0]).toMatchObject({ customType: "omp-workspace.turn-checkpoint", data: {
			sessionId: "sess1", userItemId: "user1", prompt: "edit file", files: [{ path: "f.txt", status: "M" }],
		} });
		const saved = refs(f.cwd);
		expect(saved).toHaveLength(2);
		f.fire("session_shutdown");
		expect(refs(f.cwd)).toEqual(saved);
	});

	it.each(["session_start", "session_switch", "session_shutdown"])("cleans the originating ref pair on %s", async (event) => {
		const f = fixture();
		f.fire("agent_start");
		const before = refs(f.cwd)[0];
		// A partially written after ref must be discarded with the before ref.
		git(f.cwd, "update-ref", before.replace(/before$/, "after"), git(f.cwd, "rev-parse", before));
		const other = repository();
		f.fire(event, { ...f.ctx, cwd: other });
		await f.fire("agent_end");
		expect(refs(f.cwd)).toEqual([]);
		expect(refs(other)).toEqual([]);
		expect(f.entries).toEqual([]);
	});

	it.each(["agent_start", "before_agent_start", "agent_end"])("abandons the old cwd before %s uses another repository", async (event) => {
		const f = fixture();
		f.fire("agent_start");
		const other = repository();
		await f.fire(event, { ...f.ctx, cwd: other });
		expect(refs(f.cwd)).toEqual([]);
		expect(f.entries).toEqual([]);
		expect(refs(other)).toHaveLength(event === "agent_start" ? 1 : 0);
		f.fire("session_shutdown");
		expect(refs(other)).toEqual([]);
	});

	it("cleans an abandoned turn even when the replacement cwd is not a repository", () => {
		const f = fixture();
		f.fire("agent_start");
		const other = mkdtempSync(join(tmpdir(), "omp-checkpoint-nonrepo-"));
		roots.push(other);
		f.fire("agent_start", { ...f.ctx, cwd: other });
		expect(refs(f.cwd)).toEqual([]);
		expect(f.entries).toEqual([]);
	});

	it("does not consume a top-level turn for subagent lifecycle events", async () => {
		const f = fixture();
		f.fire("agent_start");
		const before = refs(f.cwd);
		const sub = { ...f.ctx, cwd: repository(), agent: { kind: "sub" } };
		f.fire("agent_start", sub);
		await f.fire("agent_end", sub);
		for (const event of ["session_start", "session_switch", "session_shutdown"]) f.fire(event, sub);
		expect(refs(f.cwd)).toEqual(before);
		f.edit();
		await f.fire("agent_end");
		expect(f.entries).toHaveLength(1);
	});

	it("cleans the turn if the ending session differs", async () => {
		const f = fixture();
		f.fire("agent_start");
		f.edit();
		await f.fire("agent_end", { ...f.ctx, sessionManager: { ...f.ctx.sessionManager, getSessionId: () => "other" } });
		expect(refs(f.cwd)).toEqual([]);
		expect(f.entries).toEqual([]);
	});

	it.each(["read-tree", "add", "write-tree", "commit-tree", "after-ref"])("cleans both refs after %s failure", async (failure) => {
		const f = fixture();
		f.fire("agent_start");
		f.edit();
		failures.git = (args) => failure === "after-ref"
			? args[0] === "update-ref" && args[1].endsWith("/after")
			: args[0] === failure;
		await f.fire("agent_end");
		expect(refs(f.cwd)).toEqual([]);
		expect(f.entries).toEqual([]);
	});

	it.each(["snapshot", "before-ref"])("abandons the previous turn when replacement %s fails", async (failure) => {
		const f = fixture();
		f.fire("agent_start");
		failures.git = (args) => failure === "snapshot"
			? args[0] === "commit-tree"
			: args[0] === "update-ref" && args[1].endsWith("/before");
		f.fire("agent_start");
		failures.git = null;
		f.edit();
		await f.fire("agent_end");
		expect(refs(f.cwd)).toEqual([]);
		expect(f.entries).toEqual([]);
	});

	it.each(["throw", "reject", "missing"])("removes both refs when checkpoint append fails: %s", async (failure) => {
		const f = fixture();
		if (failure === "missing") delete f.api.appendEntry;
		else f.appendEntry.mockImplementation(() => {
			if (failure === "throw") throw new Error("append failed");
			return Promise.reject(new Error("append rejected"));
		});
		f.fire("agent_start");
		f.edit();
		await f.fire("agent_end");
		expect(refs(f.cwd)).toEqual([]);
		expect(f.entries).toEqual([]);
	});

	it("removes both snapshots for an unchanged turn", async () => {
		const f = fixture();
		f.fire("agent_start");
		await f.fire("agent_end");
		expect(refs(f.cwd)).toEqual([]);
		expect(f.entries).toEqual([]);
	});

	it("prunes expired snapshot pairs but preserves undone history and pending notices", async () => {
		const f = fixture();
		let clock = 1000;
		vi.spyOn(Date, "now").mockImplementation(() => clock++);
		let first = "";
		let before = "";
		for (let i = 0; i < 51; i++) {
			f.fire("agent_start");
			f.edit(`turn ${i}\n`);
			await f.fire("agent_end");
			if (i === 0) {
				first = String(f.entries[0].data.turnId);
				before = String(f.entries[0].data.before);
				git(f.cwd, "update-ref", `refs/omp/undone/sess1/${first}`, before);
			}
		}
		const retained = refs(f.cwd);
		expect(f.entries).toHaveLength(51);
		expect(retained.filter((ref) => ref.startsWith("refs/omp/turns/"))).toHaveLength(100);
		expect(retained).not.toContain(`refs/omp/turns/sess1/${first}/before`);
		expect(retained).not.toContain(`refs/omp/turns/sess1/${first}/after`);
		expect(git(f.cwd, "rev-parse", `refs/omp/undone/sess1/${first}`)).toBe(before);
		const notice = f.fire("before_agent_start") as { message: { content: string } };
		expect(notice.message.content).toContain(`The user undid your turn ${first}`);
		expect(f.entries[f.entries.length - 1]).toEqual({ customType: "omp-workspace.turn-undo-notified", data: { v: 1, turnId: first } });
	}, 30_000);
});
