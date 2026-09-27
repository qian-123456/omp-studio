import { describe, expect, it } from "vitest";
import { getOmpAuthBadge } from "./ompBadge";

describe("getOmpAuthBadge", () => {
	it("derives OAuth badge with account suffix when credentialTypes includes oauth", () => {
		const badge = getOmpAuthBadge({
			credentialTypes: ["oauth"],
			accounts: ["user@example.com"],
			hasApiKey: false,
			apiKeyEnv: null,
		});
		expect(badge.label).toBe("OAuth");
		expect(badge.badgeType).toBe("oauth");
		expect(badge.accountSuffix).toBe("user@example.com");
		expect(badge.tooltip).toBe("账号: user@example.com");
	});

	it("prioritizes OAuth over API Key when both credentialTypes are present", () => {
		const badge = getOmpAuthBadge({
			credentialTypes: ["api_key", "oauth"],
			accounts: ["dev@test.io"],
			hasApiKey: true,
			apiKeyEnv: "OPENAI_API_KEY",
		});
		expect(badge.label).toBe("OAuth");
		expect(badge.badgeType).toBe("oauth");
	});

	it("derives API Key badge when hasApiKey is true", () => {
		const badge = getOmpAuthBadge({
			credentialTypes: [],
			accounts: [],
			hasApiKey: true,
			apiKeyEnv: null,
		});
		expect(badge.label).toBe("API Key");
		expect(badge.badgeType).toBe("api_key");
	});

	it("derives API Key badge when credentialTypes includes api_key", () => {
		const badge = getOmpAuthBadge({
			credentialTypes: ["api_key"],
			accounts: [],
			hasApiKey: false,
			apiKeyEnv: null,
		});
		expect(badge.label).toBe("API Key");
		expect(badge.badgeType).toBe("api_key");
	});

	it("derives env badge when apiKeyEnv is set", () => {
		const badge = getOmpAuthBadge({
			credentialTypes: [],
			accounts: [],
			hasApiKey: false,
			apiKeyEnv: "ANTHROPIC_API_KEY",
		});
		expect(badge.label).toBe("env:ANTHROPIC_API_KEY");
		expect(badge.badgeType).toBe("env");
		expect(badge.tooltip).toBe("环境变量: ANTHROPIC_API_KEY");
	});

	it("derives none badge when no credentials or env var exist", () => {
		const badge = getOmpAuthBadge({
			credentialTypes: [],
			accounts: [],
			hasApiKey: false,
			apiKeyEnv: null,
		});
		expect(badge.label).toBe("无凭据");
		expect(badge.badgeType).toBe("none");
	});
});
