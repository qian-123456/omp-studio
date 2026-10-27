import { create } from "zustand";
import type { ConnectionPhase } from "../types";

interface ConnectionState {
	/** EventSource lifecycle; "unauthorized" is terminal until the user re-pairs. */
	phase: ConnectionPhase;
	/** Last request/stream failure shown by the connection banner; cleared by any 2xx. */
	error: string | null;
	setPhase: (phase: ConnectionPhase, error?: string | null) => void;
	setError: (error: string | null) => void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
	phase: "idle",
	error: null,
	setPhase: (phase, error = null) => {
		const cur = get();
		if (cur.phase === phase && cur.error === error) return;
		set({ phase, error: phase === "open" ? null : error });
	},
	setError: (error) => {
		if (get().error !== error) set({ error });
	},
}));

/** True once any request got a 401: pairing is gone and nothing may retry. */
export const isUnauthorized = (): boolean => useConnection.getState().phase === "unauthorized";
