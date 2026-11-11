import type { Model } from "../../src/lib/contracts";

// One CLI catalog shared by session and settings endpoints. No database fallback,
// no persistent mobile cache, and no assertion of completeness from HTTP success.
let lastKnown: Model[] | null = null;
let generation = 0;

export const catalogGeneration = (): number => generation;

export function invalidateProviderCatalog(id: string): void {
	++generation;
	lastKnown = lastKnown?.filter((model) => model.provider !== id) ?? null;
}

export function acceptCatalogResponse(data: unknown, requestGeneration: number): void {
	if (!data || typeof data !== "object") return;
	const response = data as { models?: Model[]; catalogSource?: string; catalogCompleteness?: string };
	if (response.catalogSource !== "cli" || !Array.isArray(response.models)) return;
	if (requestGeneration !== generation) throw new Error("供应商配置已更新，请重新读取模型目录。");
	const keys = new Set(response.models.map((model) => `${model.provider}\0${model.id}`));
	if (lastKnown?.some((model) => !keys.has(`${model.provider}\0${model.id}`))) {
		throw new Error("本次目录缺少既有模型，未替换上次列表；模型可用性尚未确认。");
	}
	lastKnown = response.models;
}
