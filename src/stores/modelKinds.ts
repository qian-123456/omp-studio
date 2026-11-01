/** Registered models of every runtime kind, shared by settings surfaces. */
import { create } from "zustand";
import type { ModelKindEntry } from "../lib/contracts";
import { modelKindCatalog } from "../lib/ipc";

export type ServiceModelRole = "image" | "web" | "speech" | "dictation" | "judge";

export function isServiceModelRole(role: string): role is ServiceModelRole {
	return role === "image" || role === "web" || role === "speech" || role === "dictation" || role === "judge";
}

/** Raw runtime kinds, never inferred from a selector or display name. */
export function isLLMModelKind(kind: string): boolean {
	return kind === "chat" || kind === "tiny";
}

/** Unknown nonempty kinds remain visible instead of being silently treated as chat. */
export function isNonLLMModelKind(kind: string): boolean {
	return kind.length > 0 && !isLLMModelKind(kind);
}

/** Preserve stored unknown selectors/kinds; absence of capability metadata is not invalidity. */
export function modelRoleCompatibility(
	entry: ModelKindEntry | undefined,
	role: ServiceModelRole,
): "compatible" | "incompatible" | "unverified" {
	if (!entry) return "unverified";
	// The CLI projection omits webSearch metadata for chat models. Do not guess from names.
	if (role === "web" && entry.kind === "chat") return "unverified";
	let supported: boolean;
	switch (role) {
		case "image":
			supported = entry.kind === "image";
			break;
		case "speech":
			supported = entry.kind === "tts";
			break;
		case "dictation":
			supported = entry.kind === "stt";
			break;
		case "web":
			supported = entry.kind === "search";
			break;
		case "judge":
			supported = entry.kind === "judge" || isLLMModelKind(entry.kind);
			break;
	}
	if (supported) return "compatible";
	switch (entry.kind) {
		case "chat":
		case "tiny":
		case "image":
		case "search":
		case "judge":
		case "tts":
		case "stt":
		case "embedding":
		case "rerank":
		case "video":
			return "incompatible";
		default:
			return "unverified";
	}
}

/** Accept registered entries only; provider configuration is not proof of runtime registration. */
export function modelSupportsRole(entry: ModelKindEntry, role: ServiceModelRole): boolean {
	return modelRoleCompatibility(entry, role) === "compatible";
}

interface ModelKindCatalogState {
	entries: ModelKindEntry[] | null;
	/** Exact selector → runtime kind; empty until loaded. */
	kindBySelector: ReadonlyMap<string, string>;
	loading: boolean;
	error: string | null;
	/** Cached until forced; forced loads invalidate old candidates and await fresh runtime data. */
	load: (force?: boolean) => Promise<void>;
}

export const useModelKindCatalog = create<ModelKindCatalogState>((set, get) => {
	let inFlight: Promise<void> | null = null;
	let refreshRequested = false;

	return {
		entries: null,
		kindBySelector: new Map(),
		loading: false,
		error: null,
		load: (force = false) => {
			if (force) {
				set({ entries: null, kindBySelector: new Map(), error: null });
				if (inFlight) refreshRequested = true;
			}
			if (inFlight) return inFlight;
			if (get().entries !== null && !force) return Promise.resolve();

			set({ loading: true, error: null });
			const run = async () => {
				do {
					refreshRequested = false;
					try {
						const entries = await modelKindCatalog();
						// A provider mutation during the read makes that result obsolete.
						if (!refreshRequested) {
							set({ entries, kindBySelector: new Map(entries.map((entry) => [entry.selector, entry.kind])), error: null });
						}
					} catch (error) {
						if (!refreshRequested) set({ error: String(error) });
					}
				} while (refreshRequested);
				set({ loading: false });
			};
			inFlight = run().finally(() => {
				inFlight = null;
			});
			return inFlight;
		},
	};
});

export interface ServiceModelConfigurationOrigin {
	role: ServiceModelRole;
	scope: "global" | "project";
	/** Selected project directory, never the project's configuration-file path. */
	projectPath: string | null;
}

/** In-memory return context for one role → other models → role configuration trip. */
export const useServiceModelConfiguration = create<{
	origin: ServiceModelConfigurationOrigin | null;
	returning: boolean;
	start: (origin: ServiceModelConfigurationOrigin) => void;
	requestReturn: () => void;
	finishReturn: () => void;
}>((set) => ({
	origin: null,
	returning: false,
	start: (origin) => set({ origin, returning: false }),
	requestReturn: () => set({ returning: true }),
	finishReturn: () => set({ origin: null, returning: false }),
}));
