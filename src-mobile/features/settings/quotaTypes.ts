/**
 * Normalized quota contracts and display helpers for mobile /quota page.
 */

export interface QuotaLimit {
	name: string;
	used: number;
	total: number;
	unit?: string; // "percent", "tokens", "requests", "usd", etc.
	resetAt?: number | null; // epoch ms
}

export interface QuotaAccount {
	id: string;
	email?: string | null;
	plan?: string | null;
	limits: QuotaLimit[];
}

export interface QuotaProvider {
	id: string;
	name: string;
	badge?: string;
	accounts: QuotaAccount[];
}

export interface QuotaResponse {
	providers: QuotaProvider[];
	updatedAt?: number;
}

export interface ProviderBrandStyle {
	name: string;
	badge: string;
}

export const KNOWN_BRANDS: Record<string, ProviderBrandStyle> = {
	anthropic: {
		name: "Anthropic Claude",
		badge: "Claude Pro/Max",
	},
	"openai-codex": {
		name: "ChatGPT Plus/Pro",
		badge: "Codex Subscription",
	},
	openai: {
		name: "OpenAI / ChatGPT",
		badge: "ChatGPT Plus/Pro",
	},
	"google-antigravity": {
		name: "Google Antigravity",
		badge: "Gemini / Claude / GPT",
	},
	google: {
		name: "Google Gemini",
		badge: "Gemini Code Assist",
	},
	zai: {
		name: "Z.AI (GLM Coding Plan)",
		badge: "GLM Coding Plan",
	},
	"zai-coding-plan": {
		name: "Z.AI (GLM Coding Plan)",
		badge: "Coding Plan",
	},
	codegeex: {
		name: "CodeGeeX (智谱)",
		badge: "Coding Plan",
	},
	"zhipu-coding-plan": {
		name: "智谱 CodeGeeX",
		badge: "Coding Plan",
	},
	devin: {
		name: "Devin AI",
		badge: "Cognition Devin",
	},
	"github-copilot": {
		name: "GitHub Copilot",
		badge: "Copilot Business/Individual",
	},
	deepseek: {
		name: "DeepSeek",
		badge: "DeepSeek API",
	},
	moonshot: {
		name: "Moonshot (Kimi)",
		badge: "Kimi Coding",
	},
};

export function resolveBrand(id: string, name?: string): ProviderBrandStyle {
	const lower = id.toLowerCase();
	if (KNOWN_BRANDS[lower]) return KNOWN_BRANDS[lower];
	for (const [key, b] of Object.entries(KNOWN_BRANDS)) {
		if (lower.includes(key)) return b;
	}
	const fallbackName = name || id;
	return {
		name: fallbackName,
		badge: "",
	};
}

export function formatWindowLabel(name: string): string {
	const lower = name.toLowerCase();
	if (lower.includes("5h") || lower.includes("5-hour") || lower.includes("5 hour")) {
		return "5 小时滚动限额";
	}
	if (lower.includes("7d") || lower.includes("weekly") || lower.includes("7-day") || lower.includes("7 day")) {
		return "7 天周期限额";
	}
	if (lower.includes("1d") || lower.includes("daily") || lower.includes("day")) {
		return "每日限额";
	}
	if (lower.includes("30d") || lower.includes("monthly") || lower.includes("month")) {
		return "每月限额";
	}
	if (lower.includes("prompt")) return "Prompt 配额";
	if (lower.includes("flow")) return "Flow 配额";
	return name;
}

export function computePercentage(used: number, total: number, unit?: string): { usedPct: number; remainingPct: number } {
	if (unit === "percent") {
		const usedPct = Math.max(0, Math.min(100, used));
		return { usedPct, remainingPct: Math.max(0, 100 - usedPct) };
	}
	if (total <= 0) return { usedPct: 0, remainingPct: 100 };
	const pct = Math.max(0, Math.min(100, (used / total) * 100));
	return { usedPct: pct, remainingPct: Math.max(0, 100 - pct) };
}

export function formatCountdown(resetAt: number | null | undefined, now: number): string | null {
	if (!resetAt) return null;
	const diff = resetAt - now;
	if (diff <= 0) return "即将重置";
	const totalSec = Math.floor(diff / 1000);
	const days = Math.floor(totalSec / 86400);
	const hours = Math.floor((totalSec % 86400) / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);

	if (days >= 1) {
		return hours > 0 ? `${days} 天 ${hours} 小时后重置` : `${days} 天后重置`;
	}
	if (hours >= 1) {
		return minutes > 0 ? `${hours} 小时 ${minutes} 分后重置` : `${hours} 小时后重置`;
	}
	if (minutes >= 1) {
		return `${minutes} 分钟后重置`;
	}
	return "不到 1 分钟后重置";
}

export function formatRelativeTime(ts: number | undefined, now: number): string {
	if (!ts) return "";
	const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
	if (diffSec < 60) return "刚刚更新";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin} 分钟前更新`;
	const diffHour = Math.floor(diffMin / 60);
	if (diffHour < 24) return `${diffHour} 小时前更新`;
	return `${Math.floor(diffHour / 24)} 天前更新`;
}

/**
 * Normalizes backend responses from either:
 * 1) Mobile endpoint: { providers: [{ id, name, accounts: [{ id, email, plan, limits }] }], updatedAt }
 * 2) Desktop CLI report: { generatedAt, reports: [{ provider, metadata, limits: [{ name, amount, window }] }] }
 */
export function normalizeQuotaData(raw: unknown): QuotaResponse {
	if (!raw || typeof raw !== "object") {
		return { providers: [], updatedAt: Date.now() };
	}

	const data = raw as Record<string, unknown>;

	// Format 1: Already has `providers` array
	if (Array.isArray(data.providers)) {
		const rawProviders = data.providers as Array<Record<string, unknown>>;
		const providers: QuotaProvider[] = rawProviders.map((p) => {
			const id = String(p.id ?? p.provider ?? "unknown");
			const nameVal = typeof p.name === "string" ? p.name : undefined;
			const brand = resolveBrand(id, nameVal);
			const rawAccounts = Array.isArray(p.accounts) ? (p.accounts as Array<Record<string, unknown>>) : [];
			const accounts: QuotaAccount[] = rawAccounts.map((a) => {
				const rawLimits = Array.isArray(a.limits) ? (a.limits as Array<Record<string, unknown>>) : [];
				return {
					id: String(a.id ?? "default"),
					email: typeof a.email === "string" ? a.email : null,
					plan: typeof a.plan === "string" ? a.plan : null,
					limits: rawLimits.map((l) => ({
						name: String(l.name ?? l.label ?? "默认限额"),
						used: Number(l.used ?? 0),
						total: Number(l.total ?? l.limit ?? 100),
						unit: typeof l.unit === "string" ? l.unit : "percent",
						resetAt: l.resetAt ? Number(l.resetAt) : null,
					})),
				};
			});

			return {
				id,
				name: nameVal || brand.name,
				badge: brand.badge,
				accounts,
			};
		});

		return {
			providers,
			updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
		};
	}

	// Format 2: Desktop raw `reports` array from `OmpUsageReportData`
	if (Array.isArray(data.reports)) {
		const providerMap = new Map<string, QuotaAccount[]>();
		const generatedAt = typeof data.generatedAt === "number" ? data.generatedAt : Date.now();
		const rawReports = data.reports as Array<Record<string, unknown>>;

		for (const r of rawReports) {
			const providerId = String(r.provider ?? "unknown");
			const meta = (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as Record<string, unknown>;
			const email = typeof meta.email === "string" ? meta.email : null;
			const plan = typeof meta.planType === "string" ? meta.planType : null;
			const acctId = typeof meta.accountId === "string" ? meta.accountId : (email ?? "default");

			const rawLimits = Array.isArray(r.limits) ? (r.limits as Array<Record<string, unknown>>) : [];
			const limits: QuotaLimit[] = rawLimits.map((l) => {
				const amount = (l.amount && typeof l.amount === "object" ? l.amount : {}) as Record<string, unknown>;
				const unit = typeof amount.unit === "string" ? amount.unit : "percent";
				const used =
					unit === "percent"
						? Number(amount.used ?? (typeof amount.usedFraction === "number" ? amount.usedFraction * 100 : 0))
						: Number(amount.used ?? 0);
				const total = unit === "percent" ? 100 : Number(amount.limit ?? 100);
				const win = (l.window && typeof l.window === "object" ? l.window : {}) as Record<string, unknown>;
				const resetAt = win.resetsAt ? Number(win.resetsAt) : null;
				return {
					name: String(l.label ?? l.name ?? "限额"),
					used,
					total,
					unit,
					resetAt,
				};
			});

			const acct: QuotaAccount = { id: acctId, email, plan, limits };
			if (!providerMap.has(providerId)) {
				providerMap.set(providerId, []);
			}
			providerMap.get(providerId)!.push(acct);
		}

		const providers: QuotaProvider[] = [];
		for (const [id, accounts] of providerMap.entries()) {
			const brand = resolveBrand(id);
			providers.push({
				id,
				name: brand.name,
				badge: brand.badge,
				accounts,
			});
		}

		return {
			providers,
			updatedAt: generatedAt,
		};
	}

	return { providers: [], updatedAt: Date.now() };
}
