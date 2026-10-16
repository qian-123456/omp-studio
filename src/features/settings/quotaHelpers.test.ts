import { describe, expect, it } from "vitest";
import type { OmpUsageLimit } from "../../lib/contracts";
import {
	dedupeLimits,
	findWindowResetsAt,
	formatCountdown,
	formatCountdownCompact,
	formatLimitStatus,
	formatRelativeTime,
	resolveProviderMeta,
} from "./sections/quotaHelpers";
import { limitUsedPct } from "./sections/QuotaAccountSheet";

describe("quotaHelpers", () => {
	describe("resolveProviderMeta", () => {
		it("resolves known providers with specialized badges", () => {
			expect(resolveProviderMeta("anthropic")).toEqual({
				name: "Anthropic Claude",
				badge: "Claude Pro/Max",
			});
			expect(resolveProviderMeta("google-antigravity")).toEqual({
				name: "Google Antigravity",
				badge: "Gemini / Claude / GPT",
			});
			expect(resolveProviderMeta("devin")).toEqual({
				name: "Devin AI",
				badge: "Cognition Devin",
			});
		});

		it("formats unknown provider ids cleanly", () => {
			expect(resolveProviderMeta("custom-agent-service")).toEqual({
				name: "Custom Agent Service",
				badge: "账号订阅",
			});
		});
	});

	describe("dedupeLimits", () => {
		it("deduplicates limits with identical sharedGroup", () => {
			const limits: OmpUsageLimit[] = [
				{
					id: "antigravity:anthropic:default:3p-weekly",
					label: "Claude & GPT (shared)",
					scope: { sharedGroup: "3p-weekly:weekly" },
					amount: { unit: "percent", usedFraction: 0 },
				},
				{
					id: "antigravity:openai:default:3p-weekly",
					label: "Claude & GPT (shared)",
					scope: { sharedGroup: "3p-weekly:weekly" },
					amount: { unit: "percent", usedFraction: 0 },
				},
				{
					id: "antigravity:gemini-5h",
					label: "Gemini (5 Hour)",
					scope: { windowId: "5h" },
					amount: { unit: "percent", usedFraction: 0.4 },
				},
			];

			const deduped = dedupeLimits(limits);
			expect(deduped).toHaveLength(2);
			expect(deduped[0].id).toBe("antigravity:anthropic:default:3p-weekly");
			expect(deduped[1].id).toBe("antigravity:gemini-5h");
		});
	});

	describe("formatCountdown", () => {
		it("formats days, hours, minutes, and expired values", () => {
			expect(formatCountdown(-1000)).toBe("即将重置");
			expect(formatCountdown(0)).toBe("即将重置");

			// 2 days + 3 hours
			const msDays = (2 * 24 + 3) * 3600 * 1000;
			expect(formatCountdown(msDays)).toBe("2 天 3 小时后重置");

			// 3 hours + 28 mins
			const msHours = (3 * 60 + 28) * 60 * 1000;
			expect(formatCountdown(msHours)).toBe("3 小时 28 分后重置");

			// 45 mins
			const msMins = 45 * 60 * 1000;
			expect(formatCountdown(msMins)).toBe("45 分钟后重置");

			// 25 secs
			expect(formatCountdown(25 * 1000)).toBe("25 秒后重置");
		});
	});

	describe("formatRelativeTime", () => {
		const now = 1000000;

		it("formats relative elapsed time accurately", () => {
			expect(formatRelativeTime(now - 10000, now)).toBe("刚刚同步");
			expect(formatRelativeTime(now - 120000, now)).toBe("2 分钟前同步");
			expect(formatRelativeTime(now - 7200000, now)).toBe("2 小时前同步");
			expect(formatRelativeTime(now - 86400000 * 3, now)).toBe("3 天前同步");
		});
	});
});

describe("compact quota status helpers", () => {
	const H = 3600000;
	const M = 60000;

	it("formatCountdownCompact formats each magnitude", () => {
		expect(formatCountdownCompact(0)).toBe("已到期");
		expect(formatCountdownCompact(-5)).toBe("已到期");
		expect(formatCountdownCompact(2 * 24 * H + 8 * H + 5 * M)).toBe("2d 8h");
		expect(formatCountdownCompact(4 * H + 49 * M)).toBe("4h 49m");
		expect(formatCountdownCompact(45 * M)).toBe("45m");
		expect(formatCountdownCompact(12000)).toBe("12s");
	});

	it("findWindowResetsAt resolves 5h and 7d windows independently", () => {
		const mk = (id: string, windowId: string, resetsAt: number): OmpUsageLimit => ({
			id,
			label: id,
			scope: { windowId },
			window: { id: windowId, label: windowId, durationMs: 0, resetsAt },
			amount: { unit: "percent", usedFraction: 0.5 },
		});
		const limits = [mk("anthropic:7d", "7d", 2000), mk("anthropic:5h", "5h", 1000)];
		expect(findWindowResetsAt(limits, "5h")).toBe(1000);
		expect(findWindowResetsAt(limits, "7d")).toBe(2000);
		expect(findWindowResetsAt(limits, "weekly")).toBe(2000);
		expect(findWindowResetsAt(limits, "1d")).toBeNull();
	});

	it("formatLimitStatus reports exhausted, warning, and normal", () => {
		const now = 1_000_000;
		expect(formatLimitStatus(100, now + 4 * H + 49 * M, now)).toEqual({
			text: "100% 耗尽 · 4h 49m后恢复",
			usedText: "100% 耗尽",
			resetText: "4h 49m 后恢复",
			badge: "已耗尽",
			isExhausted: true,
			isWarning: false,
			color: "rose",
		});
		expect(formatLimitStatus(100, null, now).text).toBe("100% 耗尽 · 恢复中");
		const warn = formatLimitStatus(85, now + 45 * M, now);
		expect(warn).toMatchObject({ text: "已用 85.0% · 45m 后重置", badge: "高用量", isWarning: true, color: "amber" });
		const normal = formatLimitStatus(32, now + 2 * 24 * H + 8 * H, now);
		expect(normal).toMatchObject({ text: "已用 32.0% · 2d 8h 后重置", badge: "正常", isExhausted: false, color: "neutral" });
		expect(formatLimitStatus(32, now - 1, now).text).toBe("已用 32.0%");
	});

	it("limitUsedPct calculates percentages and clamps bounds cleanly", () => {
		expect(
			limitUsedPct({
				id: "t1",
				label: "t1",
				amount: { unit: "percent", used: 42 },
			}),
		).toBe(42);
		expect(
			limitUsedPct({
				id: "t2",
				label: "t2",
				amount: { unit: "percent", usedFraction: 0.68 },
			}),
		).toBe(68);
		expect(
			limitUsedPct({
				id: "t3",
				label: "t3",
				amount: { unit: "tokens", used: 150, limit: 200 },
			}),
		).toBe(75);
		expect(
			limitUsedPct({
				id: "t4",
				label: "t4",
				amount: { unit: "percent", used: 150 },
			}),
		).toBe(100);
	});
});
