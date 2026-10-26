/**
 * Subagents of the selected session, merged from two sources:
 * - live RPC frames (`useLive`), only present for app-owned sessions;
 * - the parent session's on-disk subagent files (`subagent_list`), which is
 *   all there is for sessions driven by an external `omp` CLI process.
 * Live data wins per id. External/running sessions are re-polled so the CLI's
 * subagents stay observable while they run.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { SubagentSummary } from "../../../lib/contracts";
import { type AgentMessage, type LiveTool, type SubagentInfo, useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import { type DiskSubscription, DISK_POLL_MS, subscribeDiskSubagents } from "./diskPoller";
import { type AgentRow, asTaskDetails, isTerminalStatus, mergeAgents } from "./merge";

export { DISK_POLL_MS };

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
	streamingMessage?: AgentMessage | null,
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
			toolCount: s.toolCallCount || undefined,
			requests: s.requestCount || undefined,
			tokens: s.tokens || undefined,
			cost: s.cost && s.cost > 0 ? s.cost : undefined,
			startedAt: s.startedAt ?? undefined,
			endedAt: s.endedAt ?? undefined,
			outputPath: s.outputPath ?? undefined,
			filePath: s.filePath,
		};
		if (s.startedAt && s.endedAt) {
			const ms = Date.parse(s.endedAt) - Date.parse(s.startedAt);
			if (Number.isFinite(ms) && ms > 0) rows[s.id].durationMs = ms;
		}
	});
	Object.entries(live).forEach(([id, info]) => {
		const diskStatus = subagents[id]?.status;
		const isDiskTerminal = isTerminalStatus(diskStatus);
		// Terminal row statuses cannot be revived by stale non-terminal data.
		const nextStatus = isDiskTerminal && !isTerminalStatus(info.status)
			? diskStatus!
			: info.status;
		subagents[id] = {
			...subagents[id],
			...info,
			status: nextStatus,
			agent: info.agent ?? subagents[id]?.agent,
		};
		const prevRow = rows[id];
		const p = info.progress;
		rows[id] = {
			...(prevRow ?? { id, index: info.index ?? Object.keys(rows).length }),
			status: nextStatus,
			agent: info.agent ?? prevRow?.agent ?? p?.agent,
			agentSource: info.agentSource ?? prevRow?.agentSource ?? p?.agentSource,
			assignment: info.assignment ?? prevRow?.assignment ?? p?.assignment,
			task: info.task ?? prevRow?.task ?? p?.task,
			line: info.description ?? prevRow?.line ?? info.label,
			filePath: prevRow?.filePath ?? info.sessionFile,
			model: prevRow?.model ?? p?.resolvedModelIdentity ?? p?.resolvedModel,
			modelRole: prevRow?.modelRole ?? p?.modelRole,
			thinkingLevel: prevRow?.thinkingLevel ?? p?.resolvedThinkingLevel,
			toolCount: prevRow?.toolCount ?? (p?.toolCount ? p.toolCount : undefined),
			requests: prevRow?.requests ?? (p?.requests ? p.requests : undefined),
			tokens: prevRow?.tokens ?? (p?.tokens ? p.tokens : undefined),
			cost: prevRow?.cost ?? (p?.cost && p.cost > 0 ? p.cost : undefined),
			durationMs: prevRow?.durationMs ?? (p?.durationMs && p.durationMs > 0 ? p.durationMs : undefined),
			currentTool: nextStatus === "running" ? p?.currentTool : undefined,
			currentToolDetail: nextStatus === "running" ? (p?.currentToolIntent ?? p?.currentToolArgsKey) : undefined,
			recentTools: p?.recentTools,
		};
	});
	// Queued agents exist only in the dispatching task call's args/progress
	// until omp starts them: surface those not yet tracked as pending.
	const addPending = (toolCallId: string, args: unknown, details: unknown) => {
		const merged = mergeAgents({
			args,
			details: asTaskDetails(details),
			fileList: disk,
			liveSubagents: live,
			toolCallId,
		});
		for (const r of merged.rows) {
			if (r.status !== "pending" || subagents[r.id]) continue;
			const key = rows[r.id] ? `${toolCallId}:${r.id}` : r.id;
			subagents[key] = {
				status: "pending",
				agent: r.agent,
				label: r.line ?? r.id,
				index: r.index,
				task: r.task,
			};
			rows[key] = { ...r, id: key };
		}
	};
	for (const tool of Object.values(tools ?? {})) {
		if (tool.status !== "running" || (tool.toolName !== "task" && tool.toolName !== "agent")) continue;
		addPending(tool.toolCallId, tool.args, tool.details);
	}
	// A task call still being streamed by the model has no tool entry yet
	// (its args can take minutes to arrive): its queued agents already count.
	if (Array.isArray(streamingMessage?.content)) {
		for (const part of streamingMessage.content as unknown[]) {
			const o = (typeof part === "object" && part !== null ? part : {}) as Record<string, unknown>;
			if (o.type !== "tool_use" && o.type !== "toolCall") continue;
			if (o.name !== "task" && o.name !== "agent") continue;
			const id = String(o.id ?? "");
			if (!id || tools?.[id]) continue;
			addPending(id, o.input ?? o.arguments, null);
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
	const sub = useRef<DiskSubscription | null>(null);
	// Latest turn-activity flag for the subscription effect (which only re-runs
	// per parent file) and for pushing changes into the shared poller.
	const pollRef = useRef(poll);
	pollRef.current = poll;

	// One shared poll per parent file, however many hooks watch it.
	useEffect(() => {
		setDisk([]);
		if (!parentFile) return;
		sub.current = subscribeDiskSubagents(parentFile, setDisk, pollRef.current);
		return () => {
			sub.current?.unsubscribe();
			sub.current = null;
		};
	}, [parentFile]);

	useEffect(() => {
		sub.current?.setParentActive(poll);
	}, [poll]);

	const liveSubagents = live?.subagents;
	const liveTools = live?.tools;
	const streamingMessage = live?.streamingMessage;
	const merged = useMemo(
		() => mergeDiskAndLive(disk, liveSubagents ?? {}, liveTools, streamingMessage),
		[disk, liveSubagents, liveTools, streamingMessage],
	);
	return { parentFile, ...merged };
}
