/**
 * OMP status-report extension for omp-workspace (docs/ARCHITECTURE.md §8).
 * Installed at startup to ~/.omp-workspace/extension/omp-workspace-status.ts.
 *
 * Writes ~/.omp-workspace/status/<sessionId>.json atomically (tmp + rename):
 *   { sessionId, sessionFile, pid, state, updatedAt }
 * state: "working" | "idle" | "awaiting_approval" | "exited".
 *
 * Every handler is wrapped so the extension never throws into the host.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type StatusState = "working" | "idle" | "awaiting_approval" | "exited";

interface SessionManagerLike {
	getSessionId?(): string | undefined;
	getSessionFile?(): string | undefined;
	getHeader?(): { id?: string } | undefined;
}

interface ContextLike {
	sessionManager?: SessionManagerLike;
}

interface ExtensionApiLike {
	on(event: string, handler: (event: unknown, ctx: ContextLike) => unknown): void;
}

const STATUS_DIR = join(homedir(), ".omp-workspace", "status");

function call<T>(fn: (() => T) | undefined): T | undefined {
	try {
		return fn ? fn() : undefined;
	} catch {
		return undefined;
	}
}

function sessionInfo(ctx: ContextLike | undefined): { id?: string; file?: string } {
	const sm = ctx?.sessionManager;
	if (!sm) return {};
	const id = call(sm.getSessionId?.bind(sm)) ?? call(sm.getHeader?.bind(sm))?.id;
	const file = call(sm.getSessionFile?.bind(sm));
	return {
		id: typeof id === "string" && id ? id : undefined,
		file: typeof file === "string" && file ? file : undefined,
	};
}

function writeStatus(id: string, file: string | undefined, state: StatusState): void {
	try {
		// Session ids are uuid-like; refuse anything that could escape the dir.
		if (!/^[A-Za-z0-9._-]+$/.test(id)) return;
		mkdirSync(STATUS_DIR, { recursive: true });
		const target = join(STATUS_DIR, `${id}.json`);
		const tmp = `${target}.${process.pid}.tmp`;
		const body = {
			sessionId: id,
			sessionFile: file ?? null,
			pid: process.pid,
			state,
			updatedAt: new Date().toISOString(),
		};
		writeFileSync(tmp, JSON.stringify(body));
		renameSync(tmp, target);
	} catch {
		// Never throw into the host.
	}
}

export default function ompWorkspaceStatus(pi: ExtensionApiLike): void {
	let lastId: string | undefined;
	let lastFile: string | undefined;
	let running = false;
	let approvals = 0;

	const report = (ctx: ContextLike | undefined, state: StatusState) => {
		const { id, file } = sessionInfo(ctx);
		const sid = id ?? lastId;
		if (!sid) return;
		// Session switched inside the same process: close out the old file.
		if (lastId && id && id !== lastId) writeStatus(lastId, lastFile, "exited");
		lastId = sid;
		lastFile = file ?? lastFile;
		writeStatus(sid, lastFile, state);
	};

	const on = (event: string, handler: (ctx: ContextLike | undefined) => void) => {
		try {
			pi.on(event, (_event, ctx) => {
				try {
					handler(ctx);
				} catch {
					// ignore
				}
			});
		} catch {
			// Unknown event name on an older host — ignore.
		}
	};

	on("session_start", (ctx) => {
		running = false;
		approvals = 0;
		report(ctx, "idle");
	});
	on("session_switch", (ctx) => {
		running = false;
		approvals = 0;
		report(ctx, "idle");
	});
	on("agent_start", (ctx) => {
		running = true;
		report(ctx, approvals > 0 ? "awaiting_approval" : "working");
	});
	on("agent_end", (ctx) => {
		running = false;
		approvals = 0;
		report(ctx, "idle");
	});
	on("tool_approval_requested", (ctx) => {
		approvals += 1;
		report(ctx, "awaiting_approval");
	});
	on("tool_approval_resolved", (ctx) => {
		approvals = Math.max(0, approvals - 1);
		report(ctx, approvals > 0 ? "awaiting_approval" : running ? "working" : "idle");
	});
	on("session_shutdown", (ctx) => {
		running = false;
		report(ctx, "exited");
	});
}
