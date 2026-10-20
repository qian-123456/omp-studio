import { describe, expect, it } from "vitest";
import type { OmpUsageLimit, OmpUsageProviderReport } from "../../../lib/contracts";
import { buildQuotaRows } from "./quotaRows";

const H = 3_600_000;
const NOW = 1_000_000;

function pct(id: string, label: string, windowId: string, used: number, resetsAt: number, shared?: string): OmpUsageLimit {
	return {
		id,
		label,
		scope: { windowId, ...(shared ? { sharedGroup: shared, shared: true } : {}) },
		window: { id: windowId, label: windowId, durationMs: 0, resetsAt },
		amount: { unit: "percent", used, limit: 100, usedFraction: used / 100 },
	};
}

const report = (provider: string, limits: OmpUsageLimit[]): OmpUsageProviderReport => ({
	provider,
	fetchedAt: NOW,
	limits,
});

describe("buildQuotaRows", () => {
	it("keeps Gemini and Claude & GPT as separate rows and disambiguates repeated labels by window", () => {
		const acct = (used: number, reset: number) =>
			report("google-antigravity", [
				pct("ag:gemini-weekly", "Gemini", "weekly", used, NOW + 100 * H),
				pct("ag:gemini-5h", "Gemini", "5h", used, NOW + reset),
				pct("ag:anthropic:3p-5h", "Claude & GPT (shared)", "5h", 0, NOW + reset, "3p-5h:5h"),
				pct("ag:openai:3p-5h", "Claude & GPT (shared)", "5h", 0, NOW + reset, "3p-5h:5h"),
			]);
		const rows = buildQuotaRows([acct(10, 4 * H), acct(30, 2 * H)], NOW);
		expect(rows.map((r) => r.label)).toEqual([
			"Gemini · 7 天周期限额",
			"Gemini · 5 小时滚动限额",
			"Claude & GPT（共享）",
		]);
		const gemini5h = rows[1];
		expect(gemini5h.usedPct).toBeCloseTo(20); // mean of 10 and 30
		expect(gemini5h.statusText).toBe("已用 20.0%");
		expect(gemini5h.caption).toBe("2 小时后重置 · 2 个账号平均"); // earliest reset wins
	});

	it("shows non-percent credits as used / limit, summed across accounts", () => {
		const credits = (used: number): OmpUsageLimit => ({
			id: "devin:credits:prompt",
			label: "Prompt Credits",
			window: { id: "monthly", label: "monthly", durationMs: 0, resetsAt: 0 },
			amount: { unit: "unknown", used, limit: 2500, usedFraction: used / 2500 },
		});
		const [row] = buildQuotaRows([report("devin", [credits(500)]), report("devin", [credits(1000)])], NOW);
		expect(row.statusText).toBe("已用 1500 / 5000");
		expect(row.usedPct).toBeCloseTo(30);
		expect(row.caption).toBe("2 个账号平均");
	});

	it("marks exhausted rows", () => {
		const [row] = buildQuotaRows([report("anthropic", [pct("a:5h", "Claude 5 Hour", "5h", 100, NOW + H)])], NOW);
		expect(row).toMatchObject({ statusText: "100% 耗尽", tone: "rose", caption: "1 小时后恢复" });
	});
});
