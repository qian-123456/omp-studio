import type { OmpProviderInfo } from "../../lib/contracts";

export interface OmpAuthBadge {
	label: string;
	badgeType: "oauth" | "api_key" | "env" | "none";
	accountSuffix: string | null;
	tooltip: string;
}

/**
 * Derive auth badge metadata for an OMP-configured provider.
 * Priority: OAuth > API Key > env:$VAR > 无凭据.
 */
export function getOmpAuthBadge(
	info: Pick<
		OmpProviderInfo,
		"credentialTypes" | "hasApiKey" | "apiKeyEnv" | "accounts"
	>,
): OmpAuthBadge {
	const creds = info.credentialTypes ?? [];
	if (creds.includes("oauth")) {
		const accounts = info.accounts ?? [];
		const accountSuffix = accounts.length > 0 ? accounts.join(", ") : null;
		return {
			label: "OAuth",
			badgeType: "oauth",
			accountSuffix,
			tooltip: accountSuffix ? `账号: ${accountSuffix}` : "OAuth 凭据",
		};
	}

	const hasApiKey = Boolean(info.hasApiKey) || creds.includes("api_key");
	if (hasApiKey) {
		return {
			label: "API Key",
			badgeType: "api_key",
			accountSuffix: null,
			tooltip: "已配置 API Key",
		};
	}

	if (info.apiKeyEnv) {
		return {
			label: `env:${info.apiKeyEnv}`,
			badgeType: "env",
			accountSuffix: null,
			tooltip: `环境变量: ${info.apiKeyEnv}`,
		};
	}

	return {
		label: "无凭据",
		badgeType: "none",
		accountSuffix: null,
		tooltip: "未检测到 API 凭据",
	};
}

/**
 * Determine if an OMP provider has importable API key credentials.
 * OAuth-only providers are managed by OMP and cannot be imported into workbench keys.env.
 */
export function canImportOmpProvider(
	item: Pick<OmpProviderInfo, "hasApiKey" | "apiKeyEnv" | "credentialTypes">,
): boolean {
	const creds = item.credentialTypes ?? [];
	return (
		Boolean(item.hasApiKey) ||
		item.apiKeyEnv != null ||
		creds.includes("api_key")
	);
}
