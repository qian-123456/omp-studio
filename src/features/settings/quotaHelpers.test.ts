import { describe, expect, it } from "vitest";
import type { OmpUsageLimit } from "../../lib/contracts";
import {
	dedupeLimits,
	formatCountdown,
	formatRelativeTime,
	resolveProviderMeta,
} from "./sections/quotaHelpers";

describe("quotaHelpers", () => {
	describe("resolveProviderMeta", () => {
		it("resolves known providers with specialized badges", () => {
			expect(resolveProviderMeta("anthropic")).toEqual({
				name: "Anthropic (Claude)",
				badge: "Claude Pro/Max",
			});
			expect(resolveProviderMeta("google-antigravity")).toEqual({
				name: "Google Antigravity",
				badge: "Gemini / Claude / GPT",
			});
			expect(resolveProviderMeta("devin")).toEqual({
				name: "Devin",
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
