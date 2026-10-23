import { useEffect, useRef, useState } from "react";
import type { SearchIndexStatus, SessionSearchHit } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { onSearchIndexProgress } from "../../../lib/events";
import { searchIndexStatus, searchSessions } from "../../../lib/ipc";

export const CONTENT_DEBOUNCE_MS = 150;
export const CONTENT_LIMIT = 1000;

export interface ContentSearchState {
	/** Hits for `query` only; empty while a newer query is pending. */
	hits: SessionSearchHit[];
	/** True from the query change until its response (or failure) lands. */
	loading: boolean;
	/** Full IPC error text of the latest request; null otherwise. */
	error: string | null;
}

const IDLE: ContentSearchState = { hits: [], loading: false, error: null };

/**
 * Full-text message search for the trimmed `query`: debounced, and every newer
 * query (or unmount) invalidates the in-flight one so stale responses are dropped.
 */
export function useContentSearch(query: string): ContentSearchState {
	const q = query.trim();
	const [state, setState] = useState<ContentSearchState>(IDLE);
	const seqRef = useRef(0);

	useEffect(() => {
		const seq = ++seqRef.current;
		if (!q) {
			setState(IDLE);
			return;
		}
		setState({ hits: [], loading: true, error: null });
		const timer = window.setTimeout(() => {
			searchSessions(q, CONTENT_LIMIT).then(
				(hits) => {
					if (seq === seqRef.current) setState({ hits, loading: false, error: null });
				},
				(err) => {
					if (seq === seqRef.current) setState({ hits: [], loading: false, error: errMsg(err) });
				},
			);
		}, CONTENT_DEBOUNCE_MS);
		return () => {
			window.clearTimeout(timer);
			// Invalidate so a response of the superseded query is ignored.
			seqRef.current++;
		};
	}, [q]);

	return state;
}

/** Live full-text index build progress (initial snapshot + `search_index:progress`). */
export function useSearchIndexStatus(active: boolean): SearchIndexStatus | null {
	const [status, setStatus] = useState<SearchIndexStatus | null>(null);

	useEffect(() => {
		if (!active) return;
		let disposed = false;
		let unlisten: (() => void) | null = null;
		void onSearchIndexProgress((s) => {
			if (!disposed) setStatus(s);
		}).then((fn) => {
			if (disposed) fn();
			else unlisten = fn;
		});
		searchIndexStatus().then(
			(s) => {
				// A progress event that already arrived is newer than this snapshot.
				if (!disposed) setStatus((prev) => prev ?? s);
			},
			() => {
				// Status is advisory; the search itself reports real failures.
			},
		);
		return () => {
			disposed = true;
			unlisten?.();
		};
	}, [active]);

	return status;
}
