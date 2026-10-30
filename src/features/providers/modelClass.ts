/** [providers] Classify model ids into chat/reasoning models vs. other kinds (embedding, audio, image, rerank...). */

import type { TestStatus } from "./store";

export type ModelCategory = "chat" | "other";

/** Long fragments safe to match as substrings anywhere in the id. */
const OTHER_SUBSTRINGS = [
	"embedding",
	"embed-",
	"rerank",
	"chirp",
	"whisper",
	"realtime",
	"dall-e",
	"dalle",
	"stable-diffusion",
	"moderation",
	"imagen",
];
const OTHER_TOKENS: Record<string, true> = {
	bge: true,
	tts: true,
	flux: true,
	davinci: true,
	babbage: true,
	ada: true,
	curie: true,
	veo: true,
	sora: true,
	kling: true,
};

/** True for ids that are not text chat/reasoning models. */
export function isNonChatModel(id: string): boolean {
	const lower = id.toLowerCase();
	if (OTHER_SUBSTRINGS.some((s) => lower.includes(s))) return true;
	return lower.split(/[-_/.:\s]+/).some((seg) => OTHER_TOKENS[seg] === true);
}

export interface ClassifyInput {
	id: string;
	/** Provider listing metadata (`DiscoveredModel.kind`); authoritative when present. */
	kind?: "chat" | "other" | null;
	/** OMP's own registry (`omp models --json`) lists this model: it is chat-capable. */
	inCatalog?: boolean;
}

/** Priority: provider metadata → OMP catalog membership → id heuristics (last resort). */
export function classifyModel({ id, kind, inCatalog }: ClassifyInput): ModelCategory {
	if (kind === "chat" || kind === "other") return kind;
	if (inCatalog) return "chat";
	return isNonChatModel(id) ? "other" : "chat";
}

/** Provider-qualified catalog membership set for `classifyModel`'s `inCatalog`. */
export function catalogKeys(models: readonly { provider: string; id: string }[] | null): Set<string> {
	return new Set((models ?? []).map((m) => `${m.provider}::${m.id}`));
}

/** A finished probe that failed (empty upstream channel, HTTP error, ...). */
export function isProbeFailed(test: TestStatus | undefined): boolean {
	return test?.state === "done" && !test.result.ok;
}
