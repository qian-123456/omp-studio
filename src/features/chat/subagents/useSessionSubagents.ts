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
import { type LiveTool, type SubagentInfo, useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import { type AgentRow, asTaskDetails, mergeAgents } from "./merge";

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
	tools?: Record<string, LiveTool>,
): { subagents: Record<string, SubagentInfo>; rows: Record<string, AgentRow> } {
	const subagents: Record<string, SubagentInfo> = {};
	const rows: Record<string, AgentRow> = {};
	disk.forEach((s, index) => {
		const line = firstLine(s.prompt);
		subagents[s.id] = {
			status: s.status,
			agent: s.agent ?? undefined,
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
			agent: s.agent ?? undefined,
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
		subagents[id] = { ...subagents[id], ...info, agent: info.agent ?? subagents[id]?.agent };
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
	// Queued agents exist only in the dispatching task call's args/progress
	// until omp starts them: surface those not yet tracked as pending.
	for (const tool of Object.values(tools ?? {})) {
		if (tool.status !== "running" || (tool.toolName !== "task" && tool.toolName !== "agent")) continue;
		const merged = mergeAgents({
			args: tool.args,
			details: asTaskDetails(tool.details),
			fileList: disk,
			liveSubagents: live,
			toolCallId: tool.toolCallId,
		});
		for (const r of merged.rows) {
			if (r.status !== "pending" || subagents[r.id]) continue;
			const key = rows[r.id] ? `${tool.toolCallId}:${r.id}` : r.id;
			subagents[key] = {
				status: "pending",
				agent: r.agent,
				label: r.line ?? r.id,
				index: r.index,
				task: r.task,
			};
			rows[key] = { ...r, id: key };
		}
	}
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
	const liveTools = live?.tools;
	const merged = useMemo(
		() => mergeDiskAndLive(disk, liveSubagents ?? {}, liveTools),
		[disk, liveSubagents, liveTools],
	);
	return { parentFile, ...merged };
}
