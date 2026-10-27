import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";
import { errorMessage } from "../../core/api";
import { nav } from "../../core/nav";
import { events } from "../../core/sse";

export interface LoadState<T> {
	data: T | null;
	error: string | null;
	loading: boolean;
	/** Refetch; `silent` keeps current data on screen (no spinner). */
	reload: (silent?: boolean) => Promise<void>;
}

/** Async loader with a sequence guard: a superseded or unmounted request never writes state. */
export function useLoad<T>(fn: (signal: AbortSignal) => Promise<T>, deps: DependencyList): LoadState<T> {
	const fnRef = useRef(fn);
	fnRef.current = fn;
	const seq = useRef(0);
	const ctl = useRef<AbortController | null>(null);
	const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
		data: null,
		error: null,
		loading: true,
	});

	const run = useCallback(async (silent: boolean) => {
		const mine = ++seq.current;
		ctl.current?.abort();
		const c = new AbortController();
		ctl.current = c;
		if (!silent) setState({ data: null, error: null, loading: true });
		try {
			const data = await fnRef.current(c.signal);
			if (mine === seq.current) setState({ data, error: null, loading: false });
		} catch (e) {
			if (mine !== seq.current || (e instanceof DOMException && e.name === "AbortError")) return;
			setState((s) => ({ data: silent ? s.data : null, error: errorMessage(e, "加载失败"), loading: false }));
		}
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: caller-controlled deps
	useEffect(() => {
		void run(false);
		return () => {
			seq.current++;
			ctl.current?.abort();
		};
	}, deps);

	const reload = useCallback((silent = false) => run(silent), [run]);
	return { ...state, reload };
}

/** While `active`, the back gesture calls `close` instead of leaving the page. */
export function useLayer(active: boolean, close: () => void): void {
	const closeRef = useRef(close);
	closeRef.current = close;
	useEffect(() => {
		if (!active) return;
		return nav.pushLayer(() => closeRef.current());
	}, [active]);
}

/** Run `fn` whenever the SSE channel resyncs (also fires on visibility/online). */
export function useResync(fn: () => void): void {
	const ref = useRef(fn);
	ref.current = fn;
	useEffect(() => events.on("resync", () => ref.current()), []);
}
