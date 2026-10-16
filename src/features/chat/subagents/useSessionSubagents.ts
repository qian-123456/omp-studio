/**
 * Subagents of the selected session, merged from two sources:
 * - live RPC frames (`useLive`), only present for app-owned sessions;
 * - the parent session's on-disk subagent files (`subagent_list`), which is
 *   all there is for sessions driven by an external `omp` CLI process.
 * Live data wins per id. External/running sessions are re-polled so the CLI's
 * subagents stay observable while they run.
 */

import { useEffect, useMemo, useState } from "react";
import type { SubagentSummary } from "../../../lib/contracts";
import { subagentList } from "../../../lib/ipc";
import { type SubagentInfo, useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import type { AgentRow } from "./merge";

export const DISK_POLL_MS = 3000;

function firstLine(t: string | null | undefined): string | undefined {
	return t
		?.replace(/^Complete assignment thoroughly:\s*/, "")
		.split("\n")
		.map((l) => l.trim())
		.find(Boolean);
}

/** Pure: union disk summaries with live subagents into popover infos + sheet rows. */
export function mergeDiskAndLive(
	disk: SubagentSummary[],
	live: Record<string, SubagentInfo>,
): { subagents: Record<string, SubagentInfo>; rows: Record<string, AgentRow> } {
	const subagents: Record<string, SubagentInfo> = {};
	const rows: Record<string, AgentRow> = {};
	disk.forEach((s, index) => {
		const line = firstLine(s.prompt);
		subagents[s.id] = {
			status: s.status,
			label: line ?? s.id,
			index,
			task: s.prompt ?? undefined,
			sessionFile: s.filePath,
		};
		rows[s.id] = {
			id: s.id,
			index,
			status: s.status,
			line,
			task: s.prompt ?? undefined,
			model: s.model ?? undefined,
			thinkingLevel: s.thinkingLevel ?? undefined,
			toolCount: s.toolCallCount,
			requests: s.requestCount,
			tokens: s.tokens || undefined,
			cost: s.cost || undefined,
			startedAt: s.startedAt ?? undefined,
			endedAt: s.endedAt ?? undefined,
			outputPath: s.outputPath ?? undefined,
			filePath: s.filePath,
		};
		if (s.startedAt && s.endedAt) {
			const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
			if (Number.isFinite(ms) && ms >= 0) rows[s.id].durationMs = ms;
		}
	});
	Object.entries(live).forEach(([id, info]) => {
		subagents[id] = { ...subagents[id], ...info };
		rows[id] = {
			...(rows[id] ?? { id, index: info.index ?? Object.keys(rows).length }),
			status: info.status,
			agent: info.agent ?? rows[id]?.agent,
			agentSource: info.agentSource ?? rows[id]?.agentSource,
			assignment: info.assignment ?? rows[id]?.assignment,
			task: info.task ?? rows[id]?.task,
			line: info.description ?? rows[id]?.line ?? info.label,
			filePath: rows[id]?.filePath ?? info.sessionFile,
		};
	});
	return { subagents, rows };
}

export function useSessionSubagents(sessionId: string | null): {
	parentFile: string | undefined;
	subagents: Record<string, SubagentInfo>;
	rows: Record<string, AgentRow>;
} {
	const meta = useSessions((s) => (sessionId ? s.sessions[sessionId] : undefined));
	const live = useLive((s) => (sessionId ? s.sessions[sessionId] : undefined));
	const parentFile = meta?.file;
	const poll = meta?.status === "external" || meta?.status === "working";
	const [disk, setDisk] = useState<SubagentSummary[]>([]);

	useEffect(() => {
		setDisk([]);
		if (!parentFile) return;
		let cancelled = false;
		let timer: number | undefined;
		const tick = () => {
			subagentList(parentFile)
				.then((list) => {
					if (!cancelled) setDisk(list);
				})
				.catch(() => {})
				.finally(() => {
					if (!cancelled && poll) timer = window.setTimeout(tick, DISK_POLL_MS);
				});
		};
		tick();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [parentFile, poll]);

	const liveSubagents = live?.subagents;
	const merged = useMemo(
		() => mergeDiskAndLive(disk, liveSubagents ?? {}),
		[disk, liveSubagents],
	);
	return { parentFile, ...merged };
}
