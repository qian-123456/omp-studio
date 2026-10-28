import { describe, expect, it } from "vitest";
import type { Attention, SessionMeta, SessionStatus, Todo } from "../../lib/contracts";
import { groupInbox } from "./attention";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const H = 3_600_000;

function meta(
	id: string,
	attention: Attention | null,
	hoursAgo: number,
	archived = false,
	status: SessionStatus = "idle",
): SessionMeta {
	return {
		id,
		tool: "omp",
		file: `/tmp/${id}.jsonl`,
		cwd: "/repo",
		title: id,
		label: id,
		createdAt: new Date(NOW - 100 * H).toISOString(),
		updatedAt: new Date(NOW - hoursAgo * H).toISOString(),
		parentId: null,
		forkDepth: 0,
		status,
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		pinned: false,
		archived,
		workspaceId: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention,
		mode: "code",
		groupId: null,
	};
}

function todo(id: string, kind: Todo["kind"] = "schedule_run", status: Todo["status"] = "open", ageH = 1): Todo {
	return {
		id,
		kind,
		source: "schedule",
		status,
		sessionId: null,
		title: id,
		detail: "",
		payload: null,
		priority: 0,
		createdAt: new Date(NOW - ageH * H).toISOString(),
		updatedAt: new Date(NOW - ageH * H).toISOString(),
	};
}

describe("groupInbox", () => {
	it("excludes plain-CLI sessions from list and badge", () => {
		const cli = { ...meta("cli", "unread", 1), createdByApp: false };
		const app = { ...meta("app", "unread", 1), createdByApp: true };
		const g = groupInbox([cli, app, meta("legacy", "awaiting", 1)], NOW, 24);
		expect(g.byKind.unread.map((s) => s.id)).toEqual(["app"]);
		expect(g.byKind.question.map((s) => s.id)).toEqual(["legacy"]);
		expect(g.badge).toBe(2);
	});

	it("drops error/unread older than the window but keeps the boundary", () => {
		const g = groupInbox(
			[meta("inside", "unread", 24), meta("outside", "unread", 24.01), meta("oldErr", "error", 30)],
			NOW,
			24,
		);
		expect(g.byKind.unread.map((s) => s.id)).toEqual(["inside"]);
		expect(g.byKind.error).toEqual([]);
		expect(g.badge).toBe(1);
	});

	it("never expires awaiting or running", () => {
		const g = groupInbox(
			[meta("a", "awaiting", 500, false, "awaiting_approval"), meta("r", "running", 500)],
			NOW,
			1,
		);
		expect(g.byKind.approval.map((s) => s.id)).toEqual(["a"]);
		expect(g.byKind.running.map((s) => s.id)).toEqual(["r"]);
	});

	it("splits awaiting into approval/question and error into error/interrupted by status", () => {
		const g = groupInbox(
			[
				meta("ap", "awaiting", 1, false, "awaiting_approval"),
				meta("q", "awaiting", 1, false, "awaiting_answer"),
				meta("e", "error", 1, false, "error"),
				meta("i", "error", 1, false, "interrupted"),
			],
			NOW,
			24,
		);
		expect(g.byKind.approval.map((s) => s.id)).toEqual(["ap"]);
		expect(g.byKind.question.map((s) => s.id)).toEqual(["q"]);
		expect(g.byKind.error.map((s) => s.id)).toEqual(["e"]);
		expect(g.byKind.interrupted.map((s) => s.id)).toEqual(["i"]);
	});

	it("counts actionable kinds and schedule todos in the badge but not running or none", () => {
		const g = groupInbox(
			[
				meta("a", "awaiting", 1, false, "awaiting_approval"),
				meta("e", "error", 1),
				meta("u", "unread", 1),
				meta("r", "running", 1),
				meta("n", null, 1),
			],
			NOW,
			24,
			[todo("s1"), todo("s2")],
		);
		expect(g.badge).toBe(5);
		expect(g.all.map((e) => e.kind)).toEqual(["approval", "error", "unread", "schedule", "schedule", "running"]);
	});

	it("only includes open schedule_run todos, newest first, ignoring the window", () => {
		const g = groupInbox(
			[],
			NOW,
			1,
			[
				todo("old", "schedule_run", "open", 500),
				todo("new", "schedule_run", "open", 2),
				todo("done", "schedule_run", "done"),
				todo("other", "review"),
			],
		);
		expect(g.schedule.map((t) => t.id)).toEqual(["new", "old"]);
		expect(g.badge).toBe(2);
	});

	it("excludes archived sessions everywhere", () => {
		const g = groupInbox([meta("x", "awaiting", 1, true), meta("y", "running", 1, true)], NOW, 24);
		expect(g.all).toEqual([]);
		expect(g.badge).toBe(0);
	});

	it("orders each kind by most recent updatedAt", () => {
		const g = groupInbox([meta("old", "unread", 5), meta("new", "unread", 1)], NOW, 24);
		expect(g.byKind.unread.map((s) => s.id)).toEqual(["new", "old"]);
	});

	it.each(["unread", "error"] as const)("shows one result entry instead of duplicate %s session", (attention) => {
		const result = { ...todo("result"), sessionId: "run-session", payload: { runId: "run-1" } };
		const g = groupInbox([meta("run-session", attention, 2)], NOW, 24, [result]);
		expect(g.all).toEqual([{ type: "schedule", kind: "schedule", todo: result }]);
		expect(g.badge).toBe(1);
	});

	it("keeps new activity in a reused session separate from an older run result", () => {
		const result = { ...todo("result", "schedule_run", "open", 2), sessionId: "reused", payload: { runId: "old-run" } };
		const g = groupInbox([meta("reused", "unread", 1)], NOW, 24, [result]);
		expect(g.byKind.unread.map((s) => s.id)).toEqual(["reused"]);
		expect(g.badge).toBe(2);
	});

	it.each(["awaiting_approval", "awaiting_answer", "working"] as const)("does not hide actionable %s behind a result", (status) => {
		const result = { ...todo("result"), sessionId: "reused", payload: { runId: "old-run" } };
		const attention = status === "working" ? "running" : "awaiting";
		const g = groupInbox([meta("reused", attention, 2, false, status)], NOW, 24, [result]);
		expect(g.all.filter((e) => e.type === "session")).toHaveLength(1);
	});

	it("result-only notification policies do not suppress independent session attention", () => {
		// None/quiet Important runs emit no result todo, not a session mute.
		const g = groupInbox([meta("approval", "awaiting", 1, false, "awaiting_approval"), meta("quiet", "unread", 1)], NOW, 24, []);
		expect(g.byKind.approval).toHaveLength(1);
		expect(g.byKind.unread).toHaveLength(1);
		expect(g.badge).toBe(2);
	});

	it("closed results and todos without a run identity never hide sessions", () => {
		const g = groupInbox([meta("s", "unread", 2)], NOW, 24, [
			{ ...todo("closed", "schedule_run", "done"), sessionId: "s", payload: { runId: "r" } },
			{ ...todo("unknown"), sessionId: "s" },
		]);
		expect(g.byKind.unread).toHaveLength(1);
	});
});
