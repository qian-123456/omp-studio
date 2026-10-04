/**
 * Helpers for Quota & Subscription dashboard (formatting, deduplication, metadata).
 */
import type { OmpUsageLimit } from "../../../lib/contracts";

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
		badge: "账号订阅",
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
	if (lower.includes("5h") || lower.includes("5-hour")) return "5 小时滚动限额";
	if (lower.includes("7d") || lower.includes("weekly") || lower.includes("1w"))
		return "7 天周期限额";
	if (lower.includes("1d") || lower.includes("daily") || lower.includes("day"))
		return "24 小时每日限额";
	if (lower.includes("30d") || lower.includes("monthly") || lower.includes("1mo"))
		return "30 天每月限额";
	return id;
}

export function formatCountdown(ms: number): string {
	if (ms <= 0) return "即将重置";
	const totalSec = Math.floor(ms / 1000);
	const days = Math.floor(totalSec / 86400);
	const hours = Math.floor((totalSec % 86400) / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);

	if (days >= 1) {
		return `${days} 天 ${hours} 小时后重置`;
	}
	if (hours >= 1) {
		return `${hours} 小时 ${minutes} 分后重置`;
	}
	if (minutes >= 1) {
		return `${minutes} 分钟后重置`;
	}
	return `${totalSec} 秒后重置`;
}

export function formatRelativeTime(timestamp: number, now: number): string {
	const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (diffSec < 60) return "刚刚同步";
	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `${diffMin} 分钟前同步`;
	const diffHour = Math.floor(diffMin / 60);
	if (diffHour < 24) return `${diffHour} 小时前同步`;
	return `${Math.floor(diffHour / 24)} 天前同步`;
}
