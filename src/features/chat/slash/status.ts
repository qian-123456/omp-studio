/** /status card body — markdown assembled from get_state + session stats. */

import { formatTokens } from "../sessionStats";
import { tNow } from "../../../stores/language";
import type { SlashContext } from "./types";
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

/** Pull the first finite number found at any of the given paths. */
function pickNumber(data: Record<string, unknown>, paths: string[]): number | null {
	for (const path of paths) {
		let cur: unknown = data;
		for (const key of path.split(".")) {
			cur =
				cur !== null && typeof cur === "object"
					? (cur as Record<string, unknown>)[key]
					: undefined;
		}
		const n = num(cur);
		if (n !== null) return n;
	}
	return null;
}

function modelLabel(state: Record<string, unknown>): string {
	const m = state.model;
	if (typeof m === "string") return m;
	if (m && typeof m === "object") {
		const o = m as Record<string, unknown>;
		const provider = str(o.provider);
		const id = str(o.id) || str(o.modelId) || str(o.model);
		if (provider && id) return `${provider}/${id}`;
		if (id) return id;
		if (provider) return provider;
	}
	return tNow("slash.statusCard.notSet");
}

export async function buildStatusCard(ctx: SlashContext): Promise<string> {
	const state = ctx.live?.state ?? {};
	const session = ctx.session;
	const contextUsage =
		state.contextUsage && typeof state.contextUsage === "object"
			? (state.contextUsage as Record<string, unknown>)
			: null;
	const pct = num(contextUsage?.percent);
	const used = num(contextUsage?.used ?? contextUsage?.tokens);
	const window_ = num(contextUsage?.window ?? contextUsage?.max);
	const queued = state.queuedMessages as Record<string, unknown> | undefined;
	const steerQ = Array.isArray(queued?.steering) ? queued.steering.length : 0;
	const followQ = Array.isArray(queued?.followUp) ? queued.followUp.length : 0;
	const queuedCount =
		num(state.queuedMessageCount) ?? steerQ + followQ;

	// Tokens/cost: prefer get_session_stats; fall back to the transcript
	// usage summary the rest of the app uses.
	let tokens: number | null = null;
	let cost: number | null = null;
	if (ctx.live?.alive) {
		try {
			const resp = await ctx.rpcSend({ type: "get_session_stats" });
			const data = (resp.data ?? resp) as Record<string, unknown>;
			tokens = pickNumber(data, [
				"totalTokens",
				"tokens.total",
				"tokens",
				"usage.total",
			]);
			cost = pickNumber(data, ["cost", "totalCost", "usage.cost"]);
		} catch {
			/* fall through to sessionUsage */
		}
	}

	const lines: string[] = [
		`- **${tNow("slash.statusCard.modelLabel")}**: ${modelLabel(state)}`,
		`- **${tNow("slash.statusCard.thinkingLabel")}**: ${str(state.thinkingLevel) || "auto"}`,
		`- **${tNow("slash.statusCard.fastModeLabel")}**: ${state.fastModeEnabled === true ? tNow("slash.statusCard.on") : tNow("slash.statusCard.off")}`,
	];
	if (pct !== null || used !== null) {
		const pctText = pct !== null ? `${Math.round(pct > 1 ? pct : pct * 100)}%` : "";
		const abs =
			used !== null
				? `${formatTokens(used)}${window_ ? ` / ${formatTokens(window_)}` : ""}`
				: "";
		lines.push(`- **${tNow("slash.statusCard.contextLabel")}**: ${[pctText, abs].filter(Boolean).join(" · ")}`);
	}
	if (tokens !== null || cost !== null) {
		lines.push(
			`- **${tNow("slash.statusCard.usageLabel")}**: ${[
				tokens !== null ? formatTokens(tokens) : "",
				cost !== null ? `$${cost.toFixed(4)}` : "",
			]
				.filter(Boolean)
				.join(" · ")}`,
		);
	}
	const msgCount = num(state.messageCount);
	if (msgCount !== null) lines.push(`- **${tNow("slash.statusCard.messageCountLabel")}**: ${msgCount}`);
	if (queuedCount) lines.push(`- **${tNow("slash.statusCard.queuedMessageCountLabel")}**: ${queuedCount}`);
	lines.push(`- **${tNow("slash.statusCard.directoryLabel")}**: ${session?.cwd ?? "—"}`);
	const file = str(state.sessionFile) || session?.file;
	if (file) lines.push(`- **${tNow("slash.statusCard.sessionFileLabel")}**: \`${file}\``);
	return lines.join("\n");
}
