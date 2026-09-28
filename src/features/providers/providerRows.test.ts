import { describe, expect, it } from "vitest";
import type { OmpProviderInfo, ProviderConfig } from "../../lib/contracts";
import {
	buildProviderRows,
	formatHostOnly,
	providerRowMatchesQuery,
	providerRowName,
} from "./providerRows";

describe("providerRows", () => {
	const mockOmp: OmpProviderInfo = {
		id: "anthropic",
		baseUrl: "https://api.anthropic.com/v1",
		hasApiKey: true,
		apiKeyEnv: "ANTHROPIC_API_KEY",
		credentialTypes: ["api_key"],
		accounts: [],
		modelIds: ["claude-3-5-sonnet", "claude-3-opus"],
		sources: ["models.yml"],
		api: "anthropic",
		usedInRoles: [],
	};

	const mockWorkbench: ProviderConfig = {
		id: "p1",
		name: "My Anthropic",
		slug: "anthropic",
		presetId: "anthropic",
		baseUrl: "https://api.anthropic.com/v1",
		api: "anthropic",
		envVar: "ANTHROPIC_API_KEY",
		models: [{ id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet" }],
		defaultModel: "claude-3-7-sonnet",
		defaultContextWindow: 200000,
		defaultMaxTokens: 8192,
		enabled: true,
		sort: 0,
		hasKey: true,
		keyHint: "abcd",
		notes: null,
		createdAt: "",
		updatedAt: "",
	};

	it("merges OMP and workbench providers by slug", () => {
		const rows = buildProviderRows([mockOmp], [mockWorkbench]);
		expect(rows).toHaveLength(1);
		expect(rows[0].key).toBe("anthropic");
		expect(rows[0].omp?.id).toBe("anthropic");
		expect(rows[0].workbench?.name).toBe("My Anthropic");
	});

	it("determines providerRowName prioritizing workbench name", () => {
		const row = {
			key: "anthropic",
			omp: mockOmp,
			workbench: mockWorkbench,
		};
		expect(providerRowName(row)).toBe("My Anthropic");
		expect(providerRowName({ key: "foo", omp: mockOmp, workbench: null })).toBe("anthropic");
		expect(providerRowName({ key: "bar", omp: null, workbench: null })).toBe("bar");
	});

	it("matches query against provider names, models, and URLs", () => {
		const row = {
			key: "anthropic",
			omp: mockOmp,
			workbench: mockWorkbench,
		};
		expect(providerRowMatchesQuery(row, "claude-3-7")).toBe(true);
		expect(providerRowMatchesQuery(row, "api.anthropic.com")).toBe(true);
		expect(providerRowMatchesQuery(row, "non-existent")).toBe(false);
	});

	it("formats host-only correctly from URLs", () => {
		expect(formatHostOnly("https://api.openai.com/v1/chat")).toBe("api.openai.com");
		expect(formatHostOnly("localhost:11434")).toBe("localhost:11434");
		expect(formatHostOnly("")).toBeNull();
		expect(formatHostOnly(null)).toBeNull();
	});
});
