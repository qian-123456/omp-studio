/** /status card body — markdown assembled from get_state + session stats. */

import { formatTokens } from "../sessionStats";
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
	return "未设置";
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
		`- **模型**: ${modelLabel(state)}`,
		`- **思考等级**: ${str(state.thinkingLevel) || "auto"}`,
		`- **快速模式**: ${state.fastModeEnabled === true ? "开启" : "关闭"}`,
	];
	if (pct !== null || used !== null) {
		const pctText = pct !== null ? `${Math.round(pct > 1 ? pct : pct * 100)}%` : "";
		const abs =
			used !== null
				? `${formatTokens(used)}${window_ ? ` / ${formatTokens(window_)}` : ""}`
				: "";
		lines.push(`- **上下文**: ${[pctText, abs].filter(Boolean).join(" · ")}`);
	}
	if (tokens !== null || cost !== null) {
		lines.push(
			`- **用量**: ${[
				tokens !== null ? formatTokens(tokens) : "",
				cost !== null ? `$${cost.toFixed(4)}` : "",
			]
				.filter(Boolean)
				.join(" · ")}`,
		);
	}
	const msgCount = num(state.messageCount);
	if (msgCount !== null) lines.push(`- **消息数**: ${msgCount}`);
	if (queuedCount) lines.push(`- **排队消息**: ${queuedCount}`);
	lines.push(`- **目录**: ${session?.cwd ?? "—"}`);
	const file = str(state.sessionFile) || session?.file;
	if (file) lines.push(`- **会话文件**: \`${file}\``);
	return lines.join("\n");
}
