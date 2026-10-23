"use strict";
/* Per-request model stats, TUI-style glyphs. Vanilla port of
   src/features/chat/requestStats.ts (same math and formatting).
   The phone always shows the six default fields; duration/cost stay
   card-only. Exposed as M.requestStats. */
(function () {
	const M = (window.M = window.M || {});

	/** Field metadata: TUI glyph plus the Chinese explanation shown in the tap card. */
	const FIELDS = {
		time: { glyph: "", label: "开始时间", description: "这次请求发出的时间" },
		input: { glyph: "↘", label: "输入", description: "发给模型的新内容，含写入缓存的部分" },
		output: { glyph: "↗", label: "输出", description: "模型生成的内容（含思考）" },
		cache: { glyph: "💾", label: "缓存命中", description: "直接从缓存读取的内容，更快更便宜" },
		ttft: { glyph: "⏱", label: "首字延迟", description: "从发出请求到收到第一个字的时间" },
		tps: { glyph: "⚡", label: "输出速度", description: "每秒生成的 token 数（输出 ÷ 总耗时）" },
		duration: { glyph: "⌛", label: "总耗时", description: "这次请求从发出到结束的时间" },
		cost: { glyph: "$", label: "费用", description: "这次请求的费用（美元）" },
	};
	/** Display order of every field. */
	const FIELD_IDS = ["time", "input", "output", "cache", "ttft", "tps", "duration", "cost"];
	/** What the phone always renders on the stats line. */
	const LINE_FIELDS = ["time", "input", "output", "cache", "ttft", "tps"];

	const MISSING = "—";

	const finiteOrNull = (v) => (typeof v === "number" && isFinite(v) ? v : null);

	function buildStat(completedAt, durationMs, ttftMs, usage) {
		return {
			startedAt: completedAt != null && durationMs != null ? completedAt - durationMs : completedAt,
			completedAt,
			durationMs,
			ttftMs,
			usage,
		};
	}

	/** Stats for an assistant transcript item; null for every other kind. */
	function requestStatFromItem(item) {
		if (!item || item.kind !== "assistant") return null;
		const parsedTs = Date.parse(item.ts);
		return buildStat(
			finiteOrNull(item.completedAt) ?? (isNaN(parsedTs) ? null : parsedTs),
			finiteOrNull(item.duration),
			finiteOrNull(item.ttft),
			usageOf(item.usage),
		);
	}

	function usageOf(u) {
		if (!u || typeof u !== "object") return null;
		const cost = u.cost;
		return {
			input: finiteOrNull(u.input) ?? 0,
			output: finiteOrNull(u.output) ?? 0,
			cacheRead: finiteOrNull(u.cacheRead) ?? 0,
			cacheWrite: finiteOrNull(u.cacheWrite) ?? 0,
			totalTokens: finiteOrNull(u.totalTokens) ?? 0,
			cost: finiteOrNull(cost) ?? (cost && typeof cost === "object" ? (finiteOrNull(cost.total) ?? 0) : 0),
		};
	}

	/** Stats from a raw omp assistant message object (rpc `message_end.message`). */
	function requestStatFromMessage(msg, fallbackTs) {
		return buildStat(
			finiteOrNull(msg.completedAt) ?? finiteOrNull(msg.timestamp) ?? fallbackTs ?? null,
			finiteOrNull(msg.duration),
			finiteOrNull(msg.ttft),
			usageOf(msg.usage),
		);
	}

	/** Output tokens per second over the whole request (TUI ⚡); null without duration. */
	function tokensPerSecond(stat) {
		if (!stat || !stat.usage || !stat.durationMs || stat.durationMs <= 0) return null;
		return stat.usage.output / (stat.durationMs / 1000);
	}

	/** TUI-style compact token count: 235, 1.3K, 16K, 1.2M. */
	function formatStatTokens(n) {
		if (!(typeof n === "number" && isFinite(n))) return MISSING;
		if (n < 1000) return String(Math.round(n));
		if (n < 10000) return (n / 1000).toFixed(1) + "K";
		if (n < 1000000) return Math.round(n / 1000) + "K";
		return (n / 1000000).toFixed(1) + "M";
	}

	const pad2 = (n) => String(n).padStart(2, "0");

	/** Local HH:MM:SS. */
	function formatStatClock(epochMs) {
		const d = new Date(epochMs);
		return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
	}

	/** Seconds with one decimal: 2400 -> "2.4s". */
	function formatStatSeconds(ms) {
		if (typeof ms !== "number" || !isFinite(ms)) return MISSING;
		return (ms / 1000).toFixed(1) + "s";
	}

	/** Local `2026年10月16日 12:47:23`. */
	function formatStatDateTime(epochMs) {
		const d = new Date(epochMs);
		return (
			d.getFullYear() +
			"年" +
			(d.getMonth() + 1) +
			"月" +
			d.getDate() +
			"日 " +
			formatStatClock(epochMs)
		);
	}

	function isToday(epochMs) {
		const d = new Date(epochMs);
		const n = new Date();
		return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
	}

	/** Formatted value of one field, or null when the request did not record it. */
	function fieldText(stat, field) {
		const u = stat.usage;
		switch (field) {
			case "time":
				return stat.startedAt == null ? null : formatStatClock(stat.startedAt);
			case "input":
				return u ? formatStatTokens(u.input + u.cacheWrite) : null;
			case "output":
				return u ? formatStatTokens(u.output) : null;
			case "cache":
				return u ? formatStatTokens(u.cacheRead) : null;
			case "ttft":
				return stat.ttftMs == null ? null : formatStatSeconds(stat.ttftMs);
			case "tps": {
				const tps = tokensPerSecond(stat);
				return tps == null ? null : tps.toFixed(1) + "/s";
			}
			case "duration":
				return stat.durationMs == null ? null : formatStatSeconds(stat.durationMs);
			case "cost":
				return u ? u.cost.toFixed(u.cost < 1 ? 3 : 2) : null;
		}
		return null;
	}

	/** The six always-on fields of one request, each formatted ("—" when missing). */
	function formatRequestStat(stat) {
		return LINE_FIELDS.map((field) => ({
			field,
			glyph: FIELDS[field].glyph,
			text: fieldText(stat, field) ?? MISSING,
		}));
	}

	M.requestStats = {
		FIELDS,
		FIELD_IDS,
		LINE_FIELDS,
		MISSING,
		requestStatFromItem,
		requestStatFromMessage,
		tokensPerSecond,
		formatStatTokens,
		formatStatClock,
		formatStatSeconds,
		formatStatDateTime,
		isToday,
		fieldText,
		formatRequestStat,
	};
})();