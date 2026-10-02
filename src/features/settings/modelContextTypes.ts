/** Types for the cross-provider model context normalization feature (Three-Tier hierarchy). */

export type ModelFamily = "Claude" | "GPT" | "Gemini" | "DeepSeek" | "Qwen" | "其他";

/** Structured model tiers (档位) - no pure regex required from user */
export type ModelTierId =
	| "claude-opus"
	| "claude-sonnet"
	| "claude-haiku"
	| "gpt-flagship" // o1, o3, astra
	| "gpt-balanced" // gpt-4o, gpt-5
	| "gpt-mini" // gpt-4o-mini, o3-mini
	| "gemini-pro"
	| "gemini-flash"
	| "deepseek-r1"
	| "deepseek-v3"
	| "qwen-coder"
	| "other";

export interface TierDefinition {
	id: ModelTierId;
	name: string;
	family: ModelFamily;
	description: string;
	defaultContextWindow: number;
}

/** One model entry in one provider. */
export interface ModelSource {
	providerId: string;
	providerName: string;
	/** Raw model id as configured in the provider. */
	modelId: string;
	contextWindow: number | null;
}

/** Sources of the same underlying model, clustered across providers. */
export interface CanonicalModelGroup {
	key: string;
	name: string;
	family: ModelFamily;
	tier: ModelTierId;
	tierName: string;
	sources: ModelSource[];
	/** True when every source has the same non-null context window. */
	unified: boolean;
}

/** Three-tier context configuration: Brand (同品牌) -> Tier (同档位) -> Model (同模型) */
export interface ThreeTierConfig {
	/** Brand level defaults: family -> contextWindow */
	brands: Partial<Record<ModelFamily, number>>;
	/** Tier level defaults: tierId -> contextWindow */
	tiers: Partial<Record<ModelTierId, number>>;
	/** Model level specific overrides: canonicalKey -> contextWindow */
	models: Record<string, number>;
}

export type ContextSourceKind = "model" | "tier" | "brand" | "provider" | "none";

export interface ResolvedContext {
	value: number | null;
	source: ContextSourceKind;
	sourceLabel: string;
}

/** A pending per-model context window change. */
export interface ContextUpdate {
	providerId: string;
	modelId: string;
	contextWindow: number;
}
