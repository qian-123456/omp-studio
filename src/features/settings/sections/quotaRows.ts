/**
 * Turns the raw per-account `omp usage` limits of one provider into uniform
 * display rows. Every provider, single or pooled, goes through the same path so
 * rows always read "label · 已用 N% · reset caption".
 */
import type { OmpUsageLimit, OmpUsageProviderReport } from "../../../lib/contracts";
import { limitUsedPct } from "./QuotaAccountSheet";
import { dedupeLimits, formatHumanWindowName, formatLimitStatus, localizeQuotaLabel } from "./quotaHelpers";

export interface QuotaRow {
	key: string;
	label: string;
	usedPct: number;
	/** Right-aligned value: "已用 49.0%" or "已用 120 / 2500". */
	statusText: string;
	/** Muted line under the bar: reset countdown and account count. */
	caption: string | null;
	tone: "rose" | "amber" | "neutral";
	title: string;
}

/** Earliest still-future reset among the limits, else null. */
function earliestReset(limits: OmpUsageLimit[], now: number): number | null {
	let best: number | null = null;
	for (const l of limits) {
		const at = l.window?.resetsAt;
		if (at && at > now && (best === null || at < best)) best = at;
	}
	return best;
}

export function buildQuotaRows(reports: OmpUsageProviderReport[], now: number): QuotaRow[] {
	// Same limit id across accounts = same quota; within one account shared
	// groups (e.g. Claude & GPT) collapse to a single entry.
	const groups = new Map<string, OmpUsageLimit[]>();
	for (const r of reports) {
		for (const lim of dedupeLimits(r.limits ?? [])) {
			const key = lim.scope?.sharedGroup || lim.id;
			const list = groups.get(key);
			if (list) list.push(lim);
			else groups.set(key, [lim]);
		}
	}

	const entries = Array.from(groups.entries());
	const labelCount = new Map<string, number>();
	for (const [, members] of entries) {
		const l = members[0].label;
		labelCount.set(l, (labelCount.get(l) ?? 0) + 1);
	}

	return entries.map(([key, members]) => {
		const first = members[0];
		const n = members.length;
		const percentLike = members.every(
			(m) => m.amount.unit === "percent" || !(m.amount.limit && m.amount.limit > 0),
		);
		let usedPct: number;
		let usedText: string | null = null;
		if (percentLike) {
			usedPct = members.reduce((s, m) => s + limitUsedPct(m), 0) / n;
		} else {
			const used = members.reduce((s, m) => s + (m.amount.used ?? 0), 0);
			const limit = members.reduce((s, m) => s + (m.amount.limit ?? 0), 0);
			usedPct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
			usedText = `已用 ${used.toFixed(Number.isInteger(used) ? 0 : 1)} / ${limit.toFixed(Number.isInteger(limit) ? 0 : 1)}`;
		}
		const resetsAt = earliestReset(members, now);
		const status = formatLimitStatus(usedPct, resetsAt, now);

		// Identical labels (e.g. "Gemini" 5h vs weekly) need the window to be told apart.
		const windowId = first.scope?.windowId ?? first.window?.id;
		const label =
			(labelCount.get(first.label) ?? 0) > 1 && windowId
				? `${localizeQuotaLabel(first.label)} · ${formatHumanWindowName(windowId)}`
				: localizeQuotaLabel(first.label);

		const caption = [status.resetText, n > 1 ? `${n} 个账号平均` : null]
			.filter(Boolean)
			.join(" · ");
		const title = percentLike
			? `已用 ${usedPct.toFixed(1)}%，剩余 ${(100 - usedPct).toFixed(1)}%${
					n > 1 ? `（${n} 个账号的平均值）` : ""
				}${status.resetText ? `；${status.resetText}` : ""}`
			: `${usedText}${n > 1 ? `（${n} 个账号合计）` : ""}${status.resetText ? `；${status.resetText}` : ""}`;

		return {
			key,
			label,
			usedPct,
			statusText: usedText ?? status.usedText,
			caption: caption || null,
			tone: status.color,
			title,
		};
	});
}
