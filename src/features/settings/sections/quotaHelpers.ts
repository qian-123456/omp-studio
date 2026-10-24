/**
 * Helpers for Quota & Subscription dashboard (formatting, deduplication, metadata).
 */
import type { OmpUsageLimit } from "../../../lib/contracts";
import { tNow } from "../../../stores/language";

export interface ProviderBrandConfig {
	name: string;
	badge: string;
	color: string;
	borderLClass: string;
	badgeClass: string;
	headerBgClass: string;
	progressColor: string;
	iconType: string;
}

export const KNOWN_BRAND_CONFIGS: Record<string, ProviderBrandConfig> = {
	anthropic: {
		name: "Anthropic Claude",
		badge: "Claude Pro/Max",
		color: "#D97757",
		borderLClass: "border-l-[#D97757]",
		badgeClass: "bg-[#D97757]/10 text-[#D97757] border border-[#D97757]/30",
		headerBgClass: "bg-[#D97757]/[0.06] border-b border-[#D97757]/15",
		progressColor: "#D97757",
		iconType: "anthropic",
	},
	"openai-codex": {
		name: "ChatGPT Plus/Pro",
		badge: "Codex Subscription",
		color: "#10A37F",
		borderLClass: "border-l-[#10A37F]",
		badgeClass: "bg-[#10A37F]/10 text-[#10A37F] border border-[#10A37F]/30",
		headerBgClass: "bg-[#10A37F]/[0.06] border-b border-[#10A37F]/15",
		progressColor: "#10A37F",
		iconType: "openai",
	},
	openai: {
		name: "OpenAI",
		badge: "ChatGPT Plus/Pro",
		color: "#10A37F",
		borderLClass: "border-l-[#10A37F]",
		badgeClass: "bg-[#10A37F]/10 text-[#10A37F] border border-[#10A37F]/30",
		headerBgClass: "bg-[#10A37F]/[0.06] border-b border-[#10A37F]/15",
		progressColor: "#10A37F",
		iconType: "openai",
	},
	zai: {
		name: "Z.AI (GLM Coding Plan)",
		badge: "GLM Coding Plan",
		color: "#18181B",
		borderLClass: "border-l-neutral-400 dark:border-l-neutral-600",
		badgeClass: "bg-neutral-500/10 text-neutral-300 border border-neutral-700/30",
		headerBgClass: "bg-neutral-500/[0.04] border-b border-neutral-700/15",
		progressColor: "#27272A",
		iconType: "zai",
	},
	"zai-coding-plan": {
		name: "Z.AI (GLM Coding Plan)",
		badge: "Coding Plan",
		color: "#18181B",
		borderLClass: "border-l-neutral-400 dark:border-l-neutral-600",
		badgeClass: "bg-neutral-500/10 text-neutral-300 border border-neutral-700/30",
		headerBgClass: "bg-neutral-500/[0.04] border-b border-neutral-700/15",
		progressColor: "#27272A",
		iconType: "zai",
	},
	codegeex: {
		name: "CodeGeeX (智谱)",
		badge: "Coding Plan",
		color: "#00E7E7",
		borderLClass: "border-l-[#00E7E7]",
		badgeClass: "bg-[#00E7E7]/10 text-[#00E7E7] border border-[#00E7E7]/30",
		headerBgClass: "bg-[#00E7E7]/[0.06] border-b border-[#00E7E7]/15",
		progressColor: "#00E7E7",
		iconType: "codegeex",
	},
	"zhipu-coding-plan": {
		name: "智谱 CodeGeeX",
		badge: "Coding Plan",
		color: "#00E7E7",
		borderLClass: "border-l-[#00E7E7]",
		badgeClass: "bg-[#00E7E7]/10 text-[#00E7E7] border border-[#00E7E7]/30",
		headerBgClass: "bg-[#00E7E7]/[0.06] border-b border-[#00E7E7]/15",
		progressColor: "#00E7E7",
		iconType: "codegeex",
	},
	"google-antigravity": {
		name: "Google Antigravity",
		badge: "Gemini / Claude / GPT",
		color: "#3B82F6",
		borderLClass: "border-l-[#3B82F6]",
		badgeClass: "bg-[#3186FF]/10 text-[#3186FF] border border-[#3186FF]/30",
		headerBgClass: "bg-[#3186FF]/[0.06] border-b border-[#3186FF]/15",
		progressColor: "#3186FF",
		iconType: "antigravity",
	},
	google: {
		name: "Google Gemini",
		badge: "Gemini Code Assist",
		color: "#3B82F6",
		borderLClass: "border-l-[#3B82F6]",
		badgeClass: "bg-[#4285F4]/10 text-[#4285F4] border border-[#4285F4]/30",
		headerBgClass: "bg-[#4285F4]/[0.06] border-b border-[#4285F4]/15",
		progressColor: "#4285F4",
		iconType: "google",
	},
	devin: {
		name: "Devin AI",
		badge: "Cognition Devin",
		color: "#10B981",
		borderLClass: "border-l-[#10B981]",
		badgeClass: "bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30",
		headerBgClass: "bg-[#10B981]/[0.06] border-b border-[#10B981]/15",
		progressColor: "#10B981",
		iconType: "devin",
	},
	"github-copilot": {
		name: "GitHub Copilot",
		badge: "Copilot Business/Individual",
		color: "#6366F1",
		borderLClass: "border-l-[#6366F1]",
		badgeClass: "bg-[#6366F1]/10 text-[#6366F1] border border-[#6366F1]/30",
		headerBgClass: "bg-[#6366F1]/[0.06] border-b border-[#6366F1]/15",
		progressColor: "#6366F1",
		iconType: "copilot",
	},
	cursor: {
		name: "Cursor",
		badge: "Cursor Pro/Business",
		color: "#8B5CF6",
		borderLClass: "border-l-[#8B5CF6]",
		badgeClass: "bg-[#8B5CF6]/10 text-[#8B5CF6] border border-[#8B5CF6]/30",
		headerBgClass: "bg-[#8B5CF6]/[0.06] border-b border-[#8B5CF6]/15",
		progressColor: "#8B5CF6",
		iconType: "cursor",
	},
	"kimi-code": {
		name: "Kimi (月之暗面)",
		badge: "Kimi Coding Plan",
		color: "#14B8A6",
		borderLClass: "border-l-[#14B8A6]",
		badgeClass: "bg-[#14B8A6]/10 text-[#14B8A6] border border-[#14B8A6]/30",
		headerBgClass: "bg-[#14B8A6]/[0.06] border-b border-[#14B8A6]/15",
		progressColor: "#14B8A6",
		iconType: "kimi",
	},
	"minimax-code": {
		name: "MiniMax (名之梦)",
		badge: "Token Plan",
		color: "#E2167E",
		borderLClass: "border-l-[#E2167E]",
		badgeClass: "bg-[#E2167E]/10 text-[#E2167E] border border-[#E2167E]/30",
		headerBgClass: "bg-[#E2167E]/[0.06] border-b border-[#E2167E]/15",
		progressColor: "#E2167E",
		iconType: "minimax",
	},
	"alibaba-token-plan": {
		name: "阿里百炼 / Qwen",
		badge: "Token Plan",
		color: "#1677FF",
		borderLClass: "border-l-[#1677FF]",
		badgeClass: "bg-[#1677FF]/10 text-[#1677FF] border border-[#1677FF]/30",
		headerBgClass: "bg-[#1677FF]/[0.06] border-b border-[#1677FF]/15",
		progressColor: "#1677FF",
		iconType: "bailian",
	},
	"opencode-go": {
		name: "OpenCode",
		badge: "OpenCode Go",
		color: "#10B981",
		borderLClass: "border-l-[#10B981]",
		badgeClass: "bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30",
		headerBgClass: "bg-[#10B981]/[0.06] border-b border-[#10B981]/15",
		progressColor: "#10B981",
		iconType: "opencode-go",
	},
	deepseek: {
		name: "DeepSeek",
		badge: "DeepSeek API",
		color: "#4D6BFE",
		borderLClass: "border-l-[#4D6BFE]",
		badgeClass: "bg-[#4D6BFE]/10 text-[#4D6BFE] border border-[#4D6BFE]/30",
		headerBgClass: "bg-[#4D6BFE]/[0.06] border-b border-[#4D6BFE]/15",
		progressColor: "#4D6BFE",
		iconType: "deepseek",
	},
	openrouter: {
		name: "OpenRouter",
		badge: "Routing Plan",
		color: "#7624F4",
		borderLClass: "border-l-[#7624F4]",
		badgeClass: "bg-[#7624F4]/10 text-[#7624F4] border border-[#7624F4]/30",
		headerBgClass: "bg-[#7624F4]/[0.06] border-b border-[#7624F4]/15",
		progressColor: "#7624F4",
		iconType: "openrouter",
	},
	"alibaba-coding-plan": {
		name: "阿里百炼 / Qwen",
		badge: "Coding Plan",
		color: "#1677FF",
		borderLClass: "border-l-[#1677FF]",
		badgeClass: "bg-[#1677FF]/10 text-[#1677FF] border border-[#1677FF]/30",
		headerBgClass: "bg-[#1677FF]/[0.06] border-b border-[#1677FF]/15",
		progressColor: "#1677FF",
		iconType: "qwen",
	},
};

export function resolveBrandConfig(providerId: string): ProviderBrandConfig {
	if (KNOWN_BRAND_CONFIGS[providerId]) {
		return KNOWN_BRAND_CONFIGS[providerId];
	}
	const clean = providerId
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
	return {
		name: clean,
		badge: tNow("quota.helpers.defaultBadge"),
		color: "var(--accent)",
		borderLClass: "border-l-[var(--accent)]",
		badgeClass: "bg-[var(--well-bg)] text-neutral-300 border border-[var(--border-divider)]",
		headerBgClass: "bg-[var(--well-bg)] border-b border-[var(--border-divider)]",
		progressColor: "var(--accent)",
		iconType: providerId,
	};
}

export function resolveProviderMeta(providerId: string): { name: string; badge: string } {
	const brand = resolveBrandConfig(providerId);
	return { name: brand.name, badge: brand.badge };
}

export function dedupeLimits(limits: OmpUsageLimit[]): OmpUsageLimit[] {
	const seen = new Set<string>();
	const res: OmpUsageLimit[] = [];
	for (const lim of limits) {
		const groupKey = lim.scope?.sharedGroup || lim.id;
		if (seen.has(groupKey)) continue;
		seen.add(groupKey);
		res.push(lim);
	}
	return res;
}

export function formatHumanWindowName(id: string): string {
	const lower = id.toLowerCase();
	if (lower.includes("5h") || lower.includes("5-hour")) return tNow("quota.helpers.window5h");
	if (lower.includes("7d") || lower.includes("weekly") || lower.includes("1w"))
		return tNow("quota.helpers.window7d");
	if (lower.includes("1d") || lower.includes("daily") || lower.includes("day"))
		return tNow("quota.helpers.window1d");
	if (lower.includes("30d") || lower.includes("monthly") || lower.includes("1mo"))
		return tNow("quota.helpers.window30d");
	return id;
}

export function formatCountdown(ms: number): string {
	return ms <= 0 ? tNow("quota.helpers.resetsSoon") : tNow("quota.helpers.resetsAfter", { time: formatCountdownCompact(ms) });
}

export function formatRelativeTime(timestamp: number, now: number): string {
	const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (diffSec < 60) return tNow("quota.helpers.syncedJustNow");
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return tNow("quota.helpers.syncedMinutesAgo", { count: diffMin });
	const diffHour = Math.floor(diffMin / 60);
	if (diffHour < 24) return tNow("quota.helpers.syncedHoursAgo", { count: diffHour });
	return tNow("quota.helpers.syncedDaysAgo", { count: Math.floor(diffHour / 24) });
}

/** "2 天 8 小时" / "4 小时 49 分" / "45 分钟" / "12 秒"; a zero trailing unit is dropped ("1 小时"). */
export function formatCountdownCompact(ms: number): string {
	if (ms <= 0) return tNow("quota.helpers.expired");
	const totalSec = Math.floor(ms / 1000);
	const days = Math.floor(totalSec / 86400);
	const hours = Math.floor((totalSec % 86400) / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	if (days >= 1) return hours > 0 ? tNow("quota.helpers.timeDaysHours", { days, hours }) : tNow("quota.helpers.timeDays", { days });
	if (hours >= 1) return minutes > 0 ? tNow("quota.helpers.timeHoursMinutes", { hours, minutes }) : tNow("quota.helpers.timeHours", { hours });
	if (minutes >= 1) return tNow("quota.helpers.timeMinutes", { minutes });
	return tNow("quota.helpers.timeSeconds", { seconds: totalSec });
}

const QUOTA_LABEL_KEYS: Record<string, string> = {
	"prompt credits": "promptCredits",
	"flow credits": "flowCredits",
	"daily quota": "dailyQuota",
	"weekly quota": "weeklyQuota",
	"monthly quota": "monthlyQuota",
	"claude 5 hour": "claude5Hour",
	"claude 7 day": "claude7Day",
	"claude 7 day (opus)": "claude7DayOpus",
	"claude 7 day (sonnet)": "claude7DaySonnet",
};

/** Chinese display name for an English quota label reported by `omp usage`. */
export function localizeQuotaLabel(label: string): string {
	const key = QUOTA_LABEL_KEYS[label.trim().toLowerCase()];
	if (key) return tNow(`quota.helpers.labelMap.${key}`);
	return label
		.replace(/\s*\(shared\)/gi, tNow("quota.helpers.sharedSuffix"))
		.replace(/\b(\d+)[\s-]*hours?\b/gi, (_, h) => tNow("quota.helpers.hoursPattern", { hours: h }))
		.replace(/\b(\d+)[\s-]*days?\b/gi, (_, d) => tNow("quota.helpers.daysPattern", { days: d }))
		.replace(/\bcredits?\b/gi, tNow("quota.helpers.credits"))
		.replace(/\bquota\b/gi, tNow("quota.helpers.credits"))
		.replace(/\bdaily\b/gi, tNow("quota.helpers.daily"))
		.replace(/\bweekly\b/gi, tNow("quota.helpers.weekly"))
		.replace(/\bmonthly\b/gi, tNow("quota.helpers.monthly"));
}

const WINDOW_KEY_ALIASES: Record<string, string> = {
	daily: "1d",
	day: "1d",
	"24h": "1d",
	weekly: "7d",
	week: "7d",
	"5hour": "5h",
	"5-hour": "5h",
};

function normalizeWindowKey(key: string): string {
	const k = key.trim().toLowerCase();
	return WINDOW_KEY_ALIASES[k] ?? k;
}

export function findWindowResetsAt(limits: OmpUsageLimit[], windowKey: string): number | null {
	const key = normalizeWindowKey(windowKey);
	if (!key) return null;
	const matches = (candidate: string | undefined): boolean => {
		if (!candidate) return false;
		const c = candidate.toLowerCase();
		return c === key || normalizeWindowKey(c) === key || c.includes(key);
	};
	const limit = limits.find(
		(l) => matches(l.scope?.windowId) || matches(l.window?.id) || matches(l.window?.label) || matches(l.id),
	);
	return limit?.window?.resetsAt ?? null;
}

export interface LimitStatus {
	text: string;
	/** Short used-share label ("已用 49.0%" / "100% 耗尽"), no countdown. */
	usedText: string;
	/** Countdown caption ("2 小时 58 分后重置"), null when no future reset is known. */
	resetText: string | null;
	badge: string;
	isExhausted: boolean;
	isWarning: boolean;
	color: "rose" | "amber" | "neutral";
}

export function formatLimitStatus(usedPct: number, resetsAt: number | null, now: number): LimitStatus {
	const remainingMs = resetsAt ? resetsAt - now : null;
	const hasCountdown = remainingMs !== null && remainingMs > 0;
	if (usedPct >= 100) {
		const resetText = hasCountdown
			? tNow("quota.helpers.exhaustedResetCountdown", { time: formatCountdownCompact(remainingMs) })
			: tNow("quota.helpers.recovering");
		return {
			text: hasCountdown
				? tNow("quota.helpers.exhaustedWithCountdown", { time: formatCountdownCompact(remainingMs) })
				: tNow("quota.helpers.exhaustedRecovering"),
			usedText: tNow("quota.helpers.exhaustedUsedText"),
			resetText,
			badge: tNow("quota.helpers.exhaustedBadge"),
			isExhausted: true,
			isWarning: false,
			color: "rose",
		};
	}
	const usedText = tNow("quota.helpers.usedPct", { percent: usedPct.toFixed(1) });
	const resetText = hasCountdown
		? tNow("quota.helpers.resetsAfter", { time: formatCountdownCompact(remainingMs) })
		: null;
	const text = resetText ? `${usedText} · ${resetText}` : usedText;
	if (usedPct >= 80) {
		return { text, usedText, resetText, badge: tNow("quota.helpers.highUsageBadge"), isExhausted: false, isWarning: true, color: "amber" };
	}
	return { text, usedText, resetText, badge: tNow("quota.helpers.normalBadge"), isExhausted: false, isWarning: false, color: "neutral" };
}

/**
 * Format account subtitle combining email/accountId and orgName.
 * Deduplicates if orgName is derived from email/accountId (e.g. "email's Organization" or equals email).
 */
export function formatAccountSubtitle(
	account: string | undefined | null,
	orgName: string | undefined | null,
): string {
	const acc = account?.trim() || "";
	const org = orgName?.trim() || "";

	if (!acc && !org) return "";
	if (!acc) return org;
	if (!org) return acc;

	// If orgName is identical to account/email, don't repeat
	if (acc.toLowerCase() === org.toLowerCase()) return acc;

	// If orgName is derived from account/email (e.g. "foo@bar.com's Organization" or "foo's Organization")
	const accPrefix = acc.includes("@") ? acc.split("@")[0] : acc;
	const pattern = new RegExp(`^(${escapeRegExp(acc)}|${escapeRegExp(accPrefix)})('s|’s)?\\s*organization$`, "i");
	if (pattern.test(org)) {
		return acc;
	}

	// If orgName contains the full email/account name surrounded by noise or already starts with it
	if (org.toLowerCase().startsWith(acc.toLowerCase())) {
		const suffix = org.slice(acc.length).replace(/^['’]s?\s*/i, "").trim();
		if (!suffix || /^organization$/i.test(suffix)) {
			return acc;
		}
	}

	return `${acc} · ${org}`;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
