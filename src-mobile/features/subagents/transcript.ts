/** Subagent transcripts: initial/reset full reads, then visible event-driven incremental tailing. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { events } from "../../core/sse";
import type { TranscriptItem } from "../../core/types";
import { isActive } from "./model";
import type { SubagentSummary } from "./model";
import { createTranscriptRefresh } from "./transcriptRefresh";
import type { TranscriptRefresh } from "./transcriptRefresh";

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
	const controller = useRef<TranscriptRefresh | null>(null);
	const refresh = useCallback(() => controller.current?.refresh() ?? Promise.resolve(), []);

	useEffect(() => {
		let active = true;
		let tail: TailState = { items: [], nextByte: 0 };
		let unsubscribers: (() => void)[] = [];
		setInfo(null);
		setItems([]);
		setLoading(true);
		setError(null);
		const current = createTranscriptRefresh({
			async fetch(signal) {
				try {
					const page = await api<SubagentTranscript>(
						"GET",
						`/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(agentId)}?fromByte=${tail.nextByte}`,
						undefined,
						{ signal },
					);
					if (!active || signal.aborted) return { running: false };
					tail = accumulateTail(tail, page);
					setItems(tail.items);
					setInfo(page);
					setError(null);
					return { running: isActive(page.summary.status) };
				} catch (e) {
					if (active && !signal.aborted) setError(errorMessage(e, "加载失败"));
					throw e;
				} finally {
					if (active && !signal.aborted) setLoading(false);
				}
			},
		});
		controller.current = current;
		const updateVisibility = () => {
			for (const unsubscribe of unsubscribers) unsubscribe();
			unsubscribers = [];
			const visible = document.visibilityState !== "hidden";
			if (visible) {
				unsubscribers = [
					events.on("rpc", (event) => {
						if (event.sessionId === sessionId) current.notify();
					}),
					events.on("touch", (event) => {
						if (event.sessionId === sessionId) current.notify();
					}),
					events.on("resync", () => current.notify()),
				];
			}
			current.setVisible(visible);
		};
		document.addEventListener("visibilitychange", updateVisibility);
		updateVisibility();
		return () => {
			active = false;
			document.removeEventListener("visibilitychange", updateVisibility);
			for (const unsubscribe of unsubscribers) unsubscribe();
			current.dispose();
			if (controller.current === current) controller.current = null;
		};
	}, [sessionId, agentId]);

	return { info, items, loading, error, refresh };
}
