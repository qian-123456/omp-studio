import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import type { ModelFacts, ModelOpt, ModelsResponse } from "../lib/models";

/** Where the model + thinking sheet reads the catalog from and writes the choice to. */
export interface ModelSource {
	load(): Promise<ModelsResponse>;
	setModel(m: ModelOpt): Promise<ModelFacts>;
	setThinking(level: string): Promise<ModelFacts>;
}

/** A live session: `GET /sessions/{id}/models`, `POST …/model`, `POST …/thinking`. */
export function sessionModelSource(sessionId: string): ModelSource {
	const facts = (r: Partial<ModelFacts>): ModelFacts => ({
		current: r.current ?? null,
		thinkingLevel: r.thinkingLevel ?? null,
		liveThinking: r.liveThinking ?? [],
	});
	return {
		load: async () => {
			const r = await api<ModelsResponse>("GET", `/sessions/${sessionId}/models`);
			return { ...r, models: r.models ?? [], liveThinking: r.liveThinking ?? [] };
		},
		setModel: async (m) => facts(await api<ModelFacts>("POST", `/sessions/${sessionId}/model`, { provider: m.provider, modelId: m.id })),
		setThinking: async (level) => facts(await api<ModelFacts>("POST", `/sessions/${sessionId}/thinking`, { level })),
	};
}

export interface ModelFactsState {
	data: ModelsResponse | null;
	loading: boolean;
	error: string;
	reload: () => void;
	/** Merge facts returned by a write into the loaded data. */
	patch: (f: ModelFacts) => void;
}

/** Loads the catalog from `source` whenever the sheet opens. */
export function useModelFacts(open: boolean, source: ModelSource): ModelFactsState {
	const [data, setData] = useState<ModelsResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [tick, setTick] = useState(0);

	useEffect(() => {
		if (!open) return;
		let dead = false;
		setLoading(true);
		setError("");
		source
			.load()
			.then((r) => {
				if (!dead) setData(r);
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
	}, [open, source, tick]);

	const reload = useCallback(() => setTick((n) => n + 1), []);
	const patch = useCallback((f: ModelFacts) => setData((d) => (d ? { ...d, ...f } : d)), []);
	return { data, loading, error, reload, patch };
}
