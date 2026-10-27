/** Subagent transcript fetching: incremental `fromByte` tailing, refreshed every 15 s while the agent runs. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import type { TranscriptItem } from "../../core/types";
import { isActive } from "./model";
import type { SubagentSummary } from "./model";
import { POLL_MS } from "./poller";

/** `SubagentTranscript` (contracts.rs). */
export interface SubagentTranscript {
	agentId: string;
	summary: SubagentSummary;
	systemPrompt?: string | null;
	prompt?: string | null;
	items?: TranscriptItem[];
	output?: string | null;
	outputPath?: string | null;
	nextByte?: number;
	reset?: boolean;
}

export interface TailState {
	items: TranscriptItem[];
	nextByte: number;
}

/** Fold a page into the tail: a `reset` page replaces everything; ids already held are not duplicated. */
export function accumulateTail(prev: TailState, page: Pick<SubagentTranscript, "items" | "nextByte" | "reset">): TailState {
	const base = page.reset ? [] : prev.items;
	const seen = new Set(base.map((i) => i.id));
	const fresh = (page.items ?? []).filter((i) => !seen.has(i.id));
	return {
		items: fresh.length ? [...base, ...fresh] : base,
		nextByte: page.reset ? (page.nextByte ?? 0) : (page.nextByte ?? prev.nextByte),
	};
}

export interface TranscriptView {
	info: SubagentTranscript | null;
	items: TranscriptItem[];
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}

export function useSubagentTranscript(sessionId: string, agentId: string): TranscriptView {
	const [info, setInfo] = useState<SubagentTranscript | null>(null);
	const [items, setItems] = useState<TranscriptItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const tail = useRef<TailState>({ items: [], nextByte: 0 });
	const inflight = useRef<Promise<void> | null>(null);

	const refresh = useCallback((): Promise<void> => {
		if (inflight.current) return inflight.current;
		const p = (async () => {
			try {
				const t = await api<SubagentTranscript>(
					"GET",
					`/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(agentId)}?fromByte=${tail.current.nextByte}`,
				);
				tail.current = accumulateTail(tail.current, t);
				setItems(tail.current.items);
				setInfo(t);
				setError(null);
			} catch (e) {
				setError(errorMessage(e, "加载失败"));
			} finally {
				setLoading(false);
				inflight.current = null;
			}
		})();
		inflight.current = p;
		return p;
	}, [sessionId, agentId]);

	useEffect(() => {
		tail.current = { items: [], nextByte: 0 };
		setInfo(null);
		setItems([]);
		setLoading(true);
		void refresh();
	}, [refresh]);

	const running = info ? isActive(info.summary.status) : false;
	useEffect(() => {
		if (!running) return;
		const t = window.setInterval(() => {
			if (document.visibilityState !== "hidden") void refresh();
		}, POLL_MS);
		return () => clearInterval(t);
	}, [running, refresh]);

	return { info, items, loading, error, refresh };
}
