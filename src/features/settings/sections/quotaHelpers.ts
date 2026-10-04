/**
 * Helpers for Quota & Subscription dashboard (formatting, deduplication, metadata).
 */
import type { OmpUsageLimit } from "../../../lib/contracts";

export interface ProviderMeta {
	name: string;
	badge: string;
}

export const KNOWN_PROVIDERS: Record<string, ProviderMeta> = {
	anthropic: { name: "Anthropic (Claude)", badge: "Claude Pro/Max" },
	"google-antigravity": {
		name: "Google Antigravity",
		badge: "Gemini / Claude / GPT",
	},
	devin: { name: "Devin", badge: "Cognition Devin" },
	"github-copilot": {
		name: "GitHub Copilot",
		badge: "Copilot Business/Individual",
	},
	cursor: { name: "Cursor", badge: "Cursor Pro/Business" },
	"kimi-code": { name: "Kimi (月之暗面)", badge: "Kimi Coding Plan" },
	"minimax-code": { name: "MiniMax (名之梦)", badge: "Token Plan" },
	"alibaba-token-plan": {
		name: "阿里百炼 / Qwen",
		badge: "Token Plan",
	},
	"opencode-go": { name: "OpenCode", badge: "OpenCode Go" },
	commandcode: { name: "CommandCode", badge: "Coding Plan" },
	"cline-pass": { name: "ClinePass", badge: "Subscription" },
	synthetic: { name: "Synthetic", badge: "Quota Plan" },
};

export function resolveProviderMeta(providerId: string): ProviderMeta {
	if (KNOWN_PROVIDERS[providerId]) {
		return KNOWN_PROVIDERS[providerId];
	}
	const clean = providerId
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
	return { name: clean, badge: "账号订阅" };
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
