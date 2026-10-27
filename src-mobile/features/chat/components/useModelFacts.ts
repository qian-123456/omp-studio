import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import type { ModelsResponse } from "../lib/models";

export interface ModelFactsState {
	data: ModelsResponse | null;
	loading: boolean;
	error: string;
	reload: () => void;
}

/** Fetches `GET /sessions/{id}/models` whenever the sheet opens. */
export function useModelFacts(open: boolean, sessionId: string): ModelFactsState {
	const [data, setData] = useState<ModelsResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [tick, setTick] = useState(0);

	useEffect(() => {
		if (!open) return;
		let dead = false;
		setLoading(true);
		setError("");
		api<ModelsResponse>("GET", `/sessions/${sessionId}/models`)
			.then((r) => {
				if (!dead) setData({ ...r, models: r.models ?? [], liveThinking: r.liveThinking ?? [] });
			})
			.catch((e: unknown) => {
				if (!dead) setError(errorMessage(e));
			})
			.finally(() => {
				if (!dead) setLoading(false);
			});
		return () => {
			dead = true;
		};
	}, [open, sessionId, tick]);

	const reload = useCallback(() => setTick((n) => n + 1), []);
	return { data, loading, error, reload };
}
