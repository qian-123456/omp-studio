/**
 * OMP turn-checkpoint extension for omp-workspace.
 * Installed at startup to ~/.omp-workspace/extension/omp-workspace-checkpoints.ts
 * and loaded with `omp -e <path>` for app-launched sessions only.
 *
 * For every agent turn it records a hidden before/after snapshot of the
 * worktree under refs/omp/turns/<sid>/<turnId>/{before,after} — built with a
 * TEMP index (GIT_INDEX_FILE) so the real index and working tree are never
 * touched — and appends an "omp-workspace.turn-checkpoint" custom entry to the
 * session file so the app can offer 撤回这一轮 / per-turn metadata.
 *
 * It also injects the auto-commit rule below once per session, and a notice
 * after the app undoes a turn (refs/omp/undone/<sid>/<turnId> present).
 *
 * The rule text is embedded VERBATIM inside the block comment below; the Rust
 * side asserts EXT_SOURCE.contains(RULE.trim()) — keep it byte-identical to
 * extension/autocommit-rule.md.
 *
 * Robustness contract: this runs in-process over RPC, so it never writes to
 * stdout (JSON frames live there), never throws out of a handler, and every
 * git call is bounded by a timeout. Any failure silently no-ops that turn.
 *
 * Subagent/task sessions (ctx.agent.kind === "sub") and directories outside a
 * git work tree are ignored entirely.
 */

/*
RULE (verbatim copy of extension/autocommit-rule.md — do not edit one without the other):

## Auto-commit on accepted work (omp-workspace)
- After this task's acceptance checks pass, commit it — never mid-task, never before verification.
- Stage only files this task changed (`git add <paths>`), never `git add -A`: other sessions may share this worktree.
- Use an English Conventional Commit message (e.g. `fix(git): handle empty repo`). Never push without explicit approval.
- The desktop app snapshots every turn so the user can undo it; do not make your own backup copies.
*/

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Same text as the verbatim block above. The assertion needs the literal bytes
// in source, so the comment is authoritative and this constant is what runs.
const RULE =
	"## Auto-commit on accepted work (omp-workspace)\n" +
	"- After this task's acceptance checks pass, commit it — never mid-task, never before verification.\n" +
	"- Stage only files this task changed (`git add <paths>`), never `git add -A`: other sessions may share this worktree.\n" +
	"- Use an English Conventional Commit message (e.g. `fix(git): handle empty repo`). Never push without explicit approval.\n" +
	"- The desktop app snapshots every turn so the user can undo it; do not make your own backup copies.\n";

const CHECKPOINT_TYPE = "omp-workspace.turn-checkpoint";
const UNDO_NOTIFIED_TYPE = "omp-workspace.turn-undo-notified";
const RULE_TYPE = "omp-workspace.autocommit-rule";
const NOTICE_TYPE = "omp-workspace.turn-undo-notice";
const KEEP_TURNS = 50;
const CAP_COMMITS = 50;
const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

interface SessionManagerLike {
	getSessionId?(): string | undefined;
	getBranch?(): unknown[] | undefined;
}

interface ContextLike {
	cwd?: string;
	hasUI?: boolean;
	agent?: { kind?: string };
	sessionManager?: SessionManagerLike;
}

interface ExtensionApiLike {
	on(
		event: string,
		handler: (event: unknown, ctx: ContextLike) => unknown,
	): void;
	appendEntry?(customType: string, data: unknown): unknown;
}

interface TurnState {
	sid: string;
	cwd: string;
	turnId: string;
	headBefore: string | null;
	before: string;
}

interface TurnFile {
	path: string;
	status: "A" | "M" | "D";
}

function sanitizeSid(id: string): string {
	return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

function turnNum(turnId: string): number {
	const n = Number(turnId.slice(1));
	return Number.isFinite(n) ? n : 0;
}

function note(msg: string): void {
	try {
		process.stderr.write(`[omp-workspace-checkpoints] ${msg}\n`);
	} catch {
		// ignore
	}
}

export default function ompWorkspaceCheckpoints(pi: ExtensionApiLike): void {
	let current: TurnState | null = null;
	let isRepo: boolean | null = null;
	let repoCwd = "";
	let notified = new Set<string>();

	const git = (
		cwd: string,
		args: string[],
		env?: Record<string, string>,
	): string | null => {
		try {
			return execFileSync("git", args, {
				cwd,
				env: { ...process.env, ...env },
				timeout: GIT_TIMEOUT_MS,
				maxBuffer: GIT_MAX_BUFFER,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		} catch (e) {
			note(`git ${args[0] ?? "?"} failed: ${String(e).slice(0, 200)}`);
			return null;
		}
	};

	const guard = (ctx: ContextLike | undefined): { cwd: string } | null => {
		// Only the top-level session may snapshot: registries are process-wide
		// and factories are rebound into subagent runners.
		if (ctx?.agent?.kind === "sub") return null;
		const cwd = ctx?.cwd ?? process.cwd();
		if (current && current.cwd !== cwd) abandonTurn();
		if (isRepo === null || repoCwd !== cwd) {
			repoCwd = cwd;
			isRepo =
				git(cwd, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
		}
		return isRepo ? { cwd } : null;
	};

	/** HEAD sha or null when unborn/failure. */
	const head = (cwd: string): string | null =>
		git(cwd, ["rev-parse", "--verify", "HEAD"])?.trim() || null;

	/**
	 * Snapshot the full worktree (incl. untracked-not-ignored) into a commit
	 * using a throwaway index. Returns the commit sha or null on failure.
	 * `parent`/`readTreeFrom` follow the contract: read-tree HEAD when born
	 * (skip when unborn); after-snapshot's parent is the before commit.
	 */
	const snapshot = (
		cwd: string,
		readTreeFrom: string | null,
		parent: string | null,
		message: string,
	): string | null => {
		const dir = mkdtempSync(join(tmpdir(), "omp-turn-index-"));
		const idx = join(dir, "index");
		const env = {
			GIT_INDEX_FILE: idx,
			// Snapshot commits must not depend on user config existing.
			GIT_AUTHOR_NAME: "omp-workspace",
			GIT_AUTHOR_EMAIL: "omp-workspace@localhost",
			GIT_COMMITTER_NAME: "omp-workspace",
			GIT_COMMITTER_EMAIL: "omp-workspace@localhost",
		};
		try {
			if (readTreeFrom) {
				if (git(cwd, ["read-tree", readTreeFrom], env) === null) return null;
			}
			if (git(cwd, ["add", "-A"], env) === null) return null;
			const tree = git(cwd, ["write-tree"], env)?.trim();
			if (!tree) return null;
			const cArgs = ["commit-tree", tree, "-m", message];
			if (parent) cArgs.splice(2, 0, "-p", parent);
			return git(cwd, cArgs, env)?.trim() || null;
		} finally {
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	};

	const updateRef = (cwd: string, ref: string, sha: string): boolean =>
		git(cwd, ["update-ref", ref, sha]) !== null;

	const deleteRef = (cwd: string, ref: string): void => {
		git(cwd, ["update-ref", "-d", ref]);
	};

	const cleanupTurn = (turn: TurnState): void => {
		const base = `refs/omp/turns/${turn.sid}/${turn.turnId}`;
		deleteRef(turn.cwd, `${base}/before`);
		deleteRef(turn.cwd, `${base}/after`);
	};

	const abandonTurn = (): void => {
		const turn = current;
		current = null;
		if (turn) cleanupTurn(turn);
	};

	const listRefs = (cwd: string, prefix: string): string[] => {
		const out = git(cwd, [
			"for-each-ref",
			"--format=%(refname)",
			`refs/omp/${prefix}`,
		]);
		return out ? out.split("\n").filter(Boolean) : [];
	};

	/** diff-tree -z emits STATUS\0PATH\0 tokens; keep A/M/D (+T→M). */
	const diffFiles = (
		cwd: string,
		before: string,
		after: string,
	): TurnFile[] => {
		const out = git(cwd, [
			"diff-tree",
			"-r",
			"--no-renames",
			"--name-status",
			"-z",
			before,
			after,
		]);
		const files: TurnFile[] = [];
		if (!out) return files;
		const toks = out.split("\0").filter((t) => t.length > 0);
		for (let i = 0; i + 1 < toks.length; i += 2) {
			const s = toks[i];
			const path = toks[i + 1];
			if (s === "A" || s === "M" || s === "D")
				files.push({ path, status: s });
			else if (s === "T") files.push({ path, status: "M" });
		}
		return files;
	};

	const newCommits = (
		cwd: string,
		headBefore: string | null,
		headAfter: string | null,
	): string[] => {
		if (!headAfter) return [];
		const range = headBefore ? `${headBefore}..${headAfter}` : headAfter;
		const out = git(cwd, [
			"rev-list",
			`--max-count=${CAP_COMMITS}`,
			range,
		]);
		return out ? out.split("\n").filter(Boolean) : [];
	};

	const lastUser = (ctx: ContextLike): { id: string; prompt: string } | null => {
		try {
			const branch = ctx.sessionManager?.getBranch?.() ?? [];
			for (let i = branch.length - 1; i >= 0; i--) {
				const e = branch[i] as {
					type?: string;
					id?: string;
					message?: { role?: string; content?: unknown };
				};
				if (e?.type !== "message" || e.message?.role !== "user") continue;
				const c = e.message.content;
				let text = "";
				if (typeof c === "string") text = c;
				else if (Array.isArray(c)) {
					for (const b of c as { type?: string; text?: unknown }[]) {
						if (b?.type === "text" && typeof b.text === "string") {
							text = b.text;
							break;
						}
					}
				}
				const prompt = (text.split("\n")[0] ?? "").trim().slice(0, 80);
				return { id: String(e.id ?? ""), prompt };
			}
		} catch {
			// ignore
		}
		return null;
	};

	const branchHas = (
		ctx: ContextLike,
		pred: (e: {
			type?: string;
			customType?: string;
			data?: unknown;
		}) => boolean,
	): boolean => {
		try {
			const branch = ctx.sessionManager?.getBranch?.() ?? [];
			for (const raw of branch) {
				if (pred(raw as { type?: string; customType?: string })) return true;
			}
		} catch {
			// ignore
		}
		return false;
	};

	const appendEntry = (customType: string, data: unknown): void => {
		try {
			pi.appendEntry?.(customType, data);
		} catch (e) {
			note(`appendEntry ${customType} failed: ${String(e).slice(0, 160)}`);
		}
	};

	/** Expire snapshot refs only: undone markers are durable history state. */
	const pruneTurns = (cwd: string, sid: string): void => {
		const refs = listRefs(cwd, `turns/${sid}/`);
		const byTurn = new Map<string, string[]>();
		for (const ref of refs) {
			const m = ref.match(/^refs\/omp\/turns\/[^/]+\/([^/]+)\/(before|after)$/);
			if (!m) continue;
			const arr = byTurn.get(m[1]) ?? [];
			arr.push(ref);
			byTurn.set(m[1], arr);
		}
		const turnIds = [...byTurn.keys()].sort((a, b) => turnNum(b) - turnNum(a));
		for (const turnId of turnIds.slice(KEEP_TURNS)) {
			for (const ref of byTurn.get(turnId) ?? []) deleteRef(cwd, ref);
		}
	};

	/** Undo notices pending for this session (undone refs lacking a notified entry). */
	const pendingUndone = (ctx: ContextLike, cwd: string, sid: string): string[] => {
		const turnIds: string[] = [];
		for (const ref of listRefs(cwd, `undone/${sid}/`)) {
			const m = ref.match(/^refs\/omp\/undone\/[^/]+\/([^/]+)$/);
			if (!m) continue;
			const turnId = m[1];
			if (notified.has(turnId)) continue;
			const seen = branchHas(
				ctx,
				(e) =>
					e.type === "custom" &&
					e.customType === UNDO_NOTIFIED_TYPE &&
					(e.data as { turnId?: string } | undefined)?.turnId === turnId,
			);
			if (!seen) turnIds.push(turnId);
		}
		return turnIds.sort((a, b) => turnNum(a) - turnNum(b));
	};

	const checkpointFor = (ctx: ContextLike, turnId: string) => {
		try {
			const branch = ctx.sessionManager?.getBranch?.() ?? [];
			for (let i = branch.length - 1; i >= 0; i--) {
				const e = branch[i] as {
					type?: string;
					customType?: string;
					data?: { turnId?: string; prompt?: string; files?: TurnFile[]; commits?: string[] };
				};
				if (
					e?.type === "custom" &&
					e.customType === CHECKPOINT_TYPE &&
					e.data?.turnId === turnId
				)
					return e.data;
			}
		} catch {
			// ignore
		}
		return null;
	};

	const undoNoticeText = (
		ctx: ContextLike,
		cwd: string,
		turnId: string,
	): string => {
		const cp = checkpointFor(ctx, turnId);
		const prompt = cp?.prompt ? ` ("${cp.prompt}")` : "";
		const files = (cp?.files ?? []).map((f) => f.path);
		const filePart = files.length
			? `these files were restored to their state before that turn: ${files.join(", ")}`
			: "its file changes were restored";
		let commitPart = "";
		const dropped = (cp?.commits ?? []).filter((sha) => {
			// Keep only commits no longer reachable from HEAD.
			try {
				execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
					cwd,
					timeout: GIT_TIMEOUT_MS,
					stdio: ["ignore", "ignore", "ignore"],
				});
				return false; // still an ancestor
			} catch {
				return true; // not an ancestor (or check failed → mention it)
			}
		});
		if (dropped.length) {
			const list = dropped.map((s) => s.slice(0, 12)).join(", ");
			commitPart = `; commits ${list} are no longer on the branch`;
		}
		return (
			`The user undid your turn ${turnId}${prompt}: ${filePart}${commitPart}. ` +
			`Re-read files before editing them.`
		);
	};

	const on = (
		event: string,
		handler: (ctx: ContextLike) => unknown,
	): void => {
		try {
			pi.on(event, (_event, ctx) => {
				try {
					return handler(ctx ?? {});
				} catch (e) {
					note(`${event} handler failed: ${String(e).slice(0, 200)}`);
					return undefined;
				}
			});
		} catch {
			// Unknown event name on an older host — ignore.
		}
	};

	for (const event of ["session_start", "session_switch", "session_shutdown"]) {
		on(event, (ctx) => {
			if (ctx.agent?.kind === "sub") return;
			abandonTurn();
			notified = new Set();
		});
	}

	// Inject the auto-commit rule once per session, plus any pending undo
	// notices — merged into ONE returned message.
	on("before_agent_start", (ctx) => {
		const g = guard(ctx);
		if (!g) return undefined;
		const sid = sanitizeSid(ctx.sessionManager?.getSessionId?.() ?? "");
		if (!sid) return undefined;

		const needRule = !branchHas(
			ctx,
			(e) => e.type === "custom_message" && e.customType === RULE_TYPE,
		);
		const undoneTurnIds = pendingUndone(ctx, g.cwd, sid);

		if (!needRule && undoneTurnIds.length === 0) return undefined;

		const parts: string[] = [];
		if (needRule) parts.push(RULE.trim());
		for (const turnId of undoneTurnIds) {
			parts.push(undoNoticeText(ctx, g.cwd, turnId));
		}
		// Mark notified BEFORE returning: before_agent_start handlers may be
		// re-entered (policy retries) and must not re-append for the same turn.
		for (const turnId of undoneTurnIds) {
			notified.add(turnId);
			appendEntry(UNDO_NOTIFIED_TYPE, { v: 1, turnId });
		}
		return {
			message: {
				customType: needRule ? RULE_TYPE : NOTICE_TYPE,
				content: parts.join("\n\n"),
				display: false,
				attribution: "agent",
			},
		};
	});

	on("agent_start", (ctx) => {
		if (ctx.agent?.kind === "sub") return;
		// Discard the previous turn before checking the new repository/session.
		abandonTurn();
		const g = guard(ctx);
		if (!g) return;
		const sid = sanitizeSid(ctx.sessionManager?.getSessionId?.() ?? "");
		if (!sid) return;
		const turnId = `t${Date.now()}`;
		const headBefore = head(g.cwd);
		const before = snapshot(
			g.cwd,
			headBefore,
			headBefore,
			`omp turn snapshot ${turnId} before`,
		);
		if (!before) return;
		current = { sid, cwd: g.cwd, turnId, headBefore, before };
		if (!updateRef(g.cwd, `refs/omp/turns/${sid}/${turnId}/before`, before))
			abandonTurn();
	});

	on("agent_end", async (ctx) => {
		if (ctx.agent?.kind === "sub") return;
		const turn = current;
		current = null;
		if (!turn) return;
		let recorded = false;
		try {
			const g = guard(ctx);
			const sid = sanitizeSid(ctx.sessionManager?.getSessionId?.() ?? "");
			if (!g || g.cwd !== turn.cwd || sid !== turn.sid) return;
			const headAfter = head(turn.cwd);
			const after = snapshot(
				turn.cwd,
				headAfter,
				turn.before,
				`omp turn snapshot ${turn.turnId} after`,
			);
			if (!after) return;
			const base = `refs/omp/turns/${turn.sid}/${turn.turnId}`;
			if (!updateRef(turn.cwd, `${base}/after`, after)) return;

			const files = diffFiles(turn.cwd, turn.before, after);
			const commits = newCommits(turn.cwd, turn.headBefore, headAfter);
			if (files.length === 0 && commits.length === 0) return;
			if (!pi.appendEntry) return;
			const user = lastUser(ctx);
			await pi.appendEntry(CHECKPOINT_TYPE, {
				v: 1,
				turnId: turn.turnId,
				sessionId: turn.sid,
				userItemId: user?.id ?? null,
				prompt: user?.prompt ?? "",
				before: turn.before,
				after,
				headBefore: turn.headBefore,
				headAfter,
				commits,
				files,
				endedAt: new Date().toISOString(),
			});
			recorded = true;
			pruneTurns(turn.cwd, turn.sid);
		} catch (e) {
			note(`agent_end checkpoint failed: ${String(e).slice(0, 200)}`);
		} finally {
			if (!recorded) cleanupTurn(turn);
		}
	});
}
