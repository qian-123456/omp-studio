import { describe, expect, it } from "vitest";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import {
	gitDirOf,
	isBlankComposerSession,
	resolveSessionLocation,
} from "./sessionWorkspace";

const ws = (partial: Partial<Workspace> & Pick<Workspace, "id" | "path" | "kind">): Workspace => ({
	name: partial.name ?? partial.id,
	sort: 0,
	mode: partial.mode ?? "code",
	...partial,
});

const meta = (partial: Partial<SessionMeta>): SessionMeta =>
	({
		id: "s1",
		tool: "omp",
		file: "/tmp/s1.jsonl",
		cwd: "",
		title: "",
		label: "",
		createdAt: "2026-10-23T00:00:00Z",
		updatedAt: "2026-10-23T00:00:00Z",
		parentId: null,
		forkDepth: 0,
		status: "idle",
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		pinned: false,
		archived: false,
		workspaceId: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention: null,
		mode: "code",
		groupId: null,
		...partial,
	}) as SessionMeta;

const PROJECT = ws({ id: "proj", path: "/repo/app", kind: "project", name: "app" });
const GLOBAL = ws({ id: "global", path: "/data/global", kind: "global", mode: "chat", name: "🌐 全局" });

describe("resolveSessionLocation", () => {
	it("uses the stored workspace id for a project session", () => {
		const loc = resolveSessionLocation(
			meta({ cwd: "/repo/app", workspaceId: "proj" }),
			[PROJECT, GLOBAL],
		);
		expect(loc).toMatchObject({ kind: "project", label: "app" });
	});

	it("resolves a workspace from cwd/repoRoot when the stored id is missing", () => {
		const byCwd = resolveSessionLocation(meta({ cwd: "/repo/app/src" }), [PROJECT]);
		expect(byCwd).toMatchObject({ kind: "project", label: "app" });
		// A worktree cwd lives outside the workspace path but its repoRoot does not.
		const byRoot = resolveSessionLocation(
			meta({ cwd: "/repo/app/.worktrees/feat", repoRoot: "/repo/app" }),
			[PROJECT],
		);
		expect(byRoot).toMatchObject({ kind: "project", label: "app" });
	});

	it("picks the deepest matching project and ignores other modes", () => {
		const nested = ws({ id: "nested", path: "/repo/app/pkg", kind: "project", name: "pkg" });
		expect(resolveSessionLocation(meta({ cwd: "/repo/app/pkg/x" }), [PROJECT, nested])).toMatchObject({
			label: "pkg",
		});
		const study = ws({ id: "study", path: "/repo/app", kind: "project", mode: "study" });
		expect(
			resolveSessionLocation(meta({ cwd: "/repo/app", mode: "code" }), [study]),
		).toMatchObject({ kind: "location", label: "app" });
	});

	it("only reports 全局 for a cwd inside the global workspace", () => {
		expect(
			resolveSessionLocation(meta({ cwd: "/data/global/x", workspaceId: "global" }), [PROJECT, GLOBAL]),
		).toMatchObject({ kind: "global" });
		// A stale global id on a real project directory must not keep claiming 全局.
		expect(
			resolveSessionLocation(meta({ cwd: "/repo/app", workspaceId: "global" }), [PROJECT, GLOBAL]),
		).toMatchObject({ kind: "project", label: "app" });
	});

	it("shows the location when the cwd is outside every workspace", () => {
		expect(
			resolveSessionLocation(meta({ cwd: "/Users/me/Documents/omp-workspace/.worktrees/bug-fix" }), [
				PROJECT,
			]),
		).toEqual({ kind: "location", path: "/Users/me/Documents/omp-workspace/.worktrees/bug-fix", label: "bug-fix" });
	});

	it("never guesses 全局 while the workspace list is empty", () => {
		expect(resolveSessionLocation(meta({ cwd: "/repo/app" }), [])).toMatchObject({
			kind: "location",
			label: "app",
		});
		expect(resolveSessionLocation(meta({ cwd: "" }), [])).toMatchObject({ kind: "unknown" });
		expect(resolveSessionLocation(undefined, [])).toMatchObject({ kind: "unknown" });
	});
});

describe("gitDirOf", () => {
	it("prefers cwd, falls back to repoRoot, else null", () => {
		expect(gitDirOf(meta({ cwd: "/a", repoRoot: "/b" }))).toBe("/a");
		expect(gitDirOf(meta({ cwd: "", repoRoot: "/b" }))).toBe("/b");
		expect(gitDirOf(meta({ cwd: "", repoRoot: null }))).toBeNull();
		expect(gitDirOf(undefined)).toBeNull();
	});
});

describe("isBlankComposerSession", () => {
	const live = (partial: Partial<Record<string, unknown>> = {}) => ({
		items: [],
		pendingUserEchoes: [],
		streaming: false,
		streamingMessage: null,
		...partial,
	});

	it("is blank for a fresh session with no messages", () => {
		expect(isBlankComposerSession(meta({ cwd: "/repo/app" }), live())).toBe(true);
	});

	it("is not blank once the transcript has a message", () => {
		expect(isBlankComposerSession(meta({}), live({ items: [{}] }))).toBe(false);
		expect(isBlankComposerSession(meta({}), live({ streaming: true }))).toBe(false);
		expect(isBlankComposerSession(meta({}), live({ pendingUserEchoes: [{}] }))).toBe(false);
	});

	it("is not blank for an existing session while its transcript is still loading", () => {
		expect(isBlankComposerSession(meta({ title: "修复侧栏" }), undefined)).toBe(false);
		expect(isBlankComposerSession(meta({ title: "修复侧栏" }), live())).toBe(false);
		expect(isBlankComposerSession(meta({ lastAssistant: "结论…" }), undefined)).toBe(false);
		expect(isBlankComposerSession(meta({ label: "#115" }), undefined)).toBe(false);
		// A session with no transcript activity but a stored model is still blank.
		expect(isBlankComposerSession(meta({ model: "p/m" }), undefined)).toBe(true);
	});

	it("is never blank without catalog meta (fork drafts inherit their parent)", () => {
		expect(isBlankComposerSession(undefined, live())).toBe(false);
	});
});
