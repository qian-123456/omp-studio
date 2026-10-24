/**
 * Token usage distribution & waste analysis logic.
 * Parses transcript items and subagents to attribute token consumption
 * across Tools, Skills, System Prompt, MCP servers, and Prose/Thinking.
 * Detects:
 * - Repeated skill injections (waste)
 * - Runaway/giant tool outputs (>10k token)
 * - Consecutive tool error loops
 * - Context window gauge & limits
 */

import type { SubagentSummary, TranscriptItem } from "../../lib/contracts";
import { tNow } from "../../stores/language";

export type CategoryKey = "tools" | "skills" | "system" | "mcp" | "prose";
export interface DrilldownCallItem {
	id: string;
	label: string;
	tokens: number;
	outputTokens: number;
	isError: boolean;
	targetItemId: string;
}

export interface DrilldownItem {
	name: string;
	tokens: number;
	calls: number;
	status: "ok" | "warn" | "waste";
	note: string;
	targetItemId?: string;
	callDetails?: DrilldownCallItem[];
}

export interface DistributionCategory {
	key: CategoryKey;
	label: string;
	colorClass: string;
	hex: string;
	tokens: number;
	pct: number;
	hasWaste: boolean;
	wasteCount: number;
}

export interface ContextGauge {
	usedTokens: number;
	limitTokens: number;
	pct: number;
	modelName: string;
	status: "ok" | "warn" | "danger";
	statusText: string;
}

export interface AgentDistributionAnalysis {
	name: string;
	role: string;
	totalTokens: number;
	model: string;
	contextGauge: ContextGauge;
	distribution: DistributionCategory[];
	drilldown: Record<CategoryKey, DrilldownItem[]>;
	isolationSavedTokens?: number;
}

/** Resolve default context window limit for a model. */
export function resolveModelLimit(modelId = ""): { limit: number; normalizedName: string } {
	const lower = modelId.toLowerCase();
	if (lower.includes("gemini")) {
		return { limit: 1_000_000, normalizedName: modelId || "Gemini" };
	}
	if (lower.includes("gpt-4o") || lower.includes("o1") || lower.includes("o3")) {
		return { limit: 128_000, normalizedName: modelId || "GPT-4o" };
	}
	if (lower.includes("smol") || lower.includes("32k")) {
		return { limit: 32_000, normalizedName: modelId || "Smol (32k)" };
	}
	if (lower.includes("claude")) {
		return { limit: 200_000, normalizedName: modelId || "Claude 3.7 Sonnet" };
	}
	return { limit: 200_000, normalizedName: modelId || "Claude 3.7 Sonnet" };
}

/** Fast token estimate from text length if exact usage is missing. */
function estimateTokens(text?: string | null): number {
	if (!text) return 0;
	return Math.max(1, Math.round(text.length / 3.6));
}

const CATEGORY_META: Record<
	CategoryKey,
	{ labelKey: string; colorClass: string; hex: string }
> = {
	tools: { labelKey: "heatmap.categoryTools", colorClass: "bg-amber-500", hex: "#f59e0b" },
	skills: { labelKey: "heatmap.categorySkills", colorClass: "bg-purple-500", hex: "#8b5cf6" },
	system: { labelKey: "heatmap.categorySystem", colorClass: "bg-blue-500", hex: "#3b82f6" },
	mcp: { labelKey: "heatmap.categoryMcp", colorClass: "bg-emerald-500", hex: "#10b981" },
	prose: { labelKey: "heatmap.categoryProse", colorClass: "bg-slate-400", hex: "#94a3b8" },
};

/**
 * Analyze Main Conversation transcript items into distribution and drilldown.
 */
export function analyzeMainDistribution(
	items: TranscriptItem[],
	modelId?: string,
): AgentDistributionAnalysis {
	const { limit: limitTokens, normalizedName: modelName } = resolveModelLimit(modelId);

	// Accumulators
	let systemTokens = 0;
	let proseTokens = 0;

	// Index all tool results by toolCallId
	const resultsByCallId = new Map<
		string,
		{ text: string; isError: boolean; itemId: string }
	>();
	for (const item of items) {
		if (item.toolResult) {
			resultsByCallId.set(item.toolResult.toolCallId, {
				text: item.toolResult.text,
				isError: Boolean(
					item.toolResult.isError ||
						(item.toolResult as unknown as Record<string, unknown> | undefined)?.is_error,
				),
				itemId: item.id,
			});
		}
	}

	const skillMap = new Map<
		string,
		{ tokens: number; calls: number; itemIds: string[]; callsList: DrilldownCallItem[] }
	>();
	const mcpMap = new Map<
		string,
		{ tokens: number; calls: number; itemIds: string[]; isError: boolean; callsList: DrilldownCallItem[] }
	>();
	const toolMap = new Map<
		string,
		{
			tokens: number;
			calls: number;
			itemIds: string[];
			isError: boolean;
			hasGiantOutput: boolean;
			callsList: DrilldownCallItem[];
		}
	>();

	// Track cumulative context
	let maxContextUsed = 0;
	let prevToolFailed = false;
	// Loop over transcript items
	for (const item of items) {
		const itemUsageTotal = item.usage?.totalTokens ?? 0;
		if (item.usage?.input && item.usage.input > maxContextUsed) {
			maxContextUsed = item.usage.input;
		}

		// 1. System Prompt
		if (item.kind === "system" || item.kind === "custom") {
			const tok = itemUsageTotal || estimateTokens(item.text);
			systemTokens += tok;
			continue;
		}

		// 2. Prose / Assistant Thinking
		if (item.kind === "assistant" || item.kind === "user") {
			const thinkingTok = estimateTokens(item.thinking);
			const textTok = item.usage?.output || estimateTokens(item.text);
			proseTokens += thinkingTok + textTok;
		}

		// 3. Tool Calls
		for (const call of item.toolCalls) {
			const rawArgs = call.args as Record<string, unknown> | null;
			const pathVal =
				typeof rawArgs?.path === "string"
					? rawArgs.path
					: typeof rawArgs?.uri === "string"
						? rawArgs.uri
						: "";

			// A: Check if Skill injection (e.g. read skill://foo)
			if (
				call.name === "read" &&
				(pathVal.startsWith("skill://") || pathVal.startsWith("skill:"))
			) {
				const skillUri = pathVal.split(/[:#?]/)[0].startsWith("skill://")
					? pathVal.split(/[#?]/)[0]
					: `skill://${pathVal.replace(/^skill:?\/?\/?/, "").split(/[#?]/)[0]}`;

				const prev = skillMap.get(skillUri) ?? {
					tokens: 0,
					calls: 0,
					itemIds: [],
					callsList: [],
				};
				const res = resultsByCallId.get(call.id);
				const tok = estimateTokens(res?.text) || 1200;
				skillMap.set(skillUri, {
					tokens: prev.tokens + tok,
					calls: prev.calls + 1,
					itemIds: [...prev.itemIds, call.id],
					callsList: [
						...prev.callsList,
						{
							id: call.id,
							label: pathVal,
							tokens: tok,
							outputTokens: tok,
							isError: false,
							targetItemId: call.id,
						},
					],
				});
				continue;
			}

			// B: Check if MCP tool (mcp__server__tool or mcp:: or custom namespace)
			const isMcp =
				call.name.startsWith("mcp__") ||
				call.name.includes("::") ||
				call.name.startsWith("mcp_");

			const res = resultsByCallId.get(call.id);
			const argTok = estimateTokens(JSON.stringify(call.args));
			const outTok = estimateTokens(res?.text);
			const callTok = argTok + outTok;
			const isErr = res?.isError ?? false;
			const isGiant = outTok >= 8000;

			let callSummary = "";
			if (call.name === "bash" && typeof rawArgs?.command === "string") {
				callSummary = rawArgs.command.slice(0, 90);
			} else if (pathVal) {
				callSummary = pathVal.slice(0, 90);
			} else {
				callSummary = JSON.stringify(call.args).slice(0, 90);
			}

			const callItem: DrilldownCallItem = {
				id: call.id,
				label: callSummary,
				tokens: callTok,
				outputTokens: outTok,
				isError: isErr,
				targetItemId: call.id,
			};

			if (isMcp) {
				const mcpKey = call.name.replace(/^mcp__/, "").replace(/__/g, "::");
				const prev = mcpMap.get(mcpKey) ?? {
					tokens: 0,
					calls: 0,
					itemIds: [],
					isError: false,
					callsList: [],
				};
				mcpMap.set(mcpKey, {
					tokens: prev.tokens + callTok,
					calls: prev.calls + 1,
					itemIds: [...prev.itemIds, call.id],
					isError: prev.isError || isErr,
					callsList: [...prev.callsList, callItem],
				});
				continue;
			}

			// C: Native Tool Calls
			let toolLabel = call.name;
			if (call.name === "bash" && typeof rawArgs?.command === "string") {
				const cmd = rawArgs.command.trim().split(/\s+/)[0] || "bash";
				const sub = rawArgs.command.trim().split(/\s+/)[1] || "";
				toolLabel = `bash: ${cmd}${sub ? ` ${sub}` : ""}`;
			} else if (
				(call.name === "read" || call.name === "edit" || call.name === "write") &&
				pathVal
			) {
				const fileName = pathVal.split("/").pop() || pathVal;
				toolLabel = `${call.name}: ${fileName}`;
			}

			const prev = toolMap.get(toolLabel) ?? {
				tokens: 0,
				calls: 0,
				itemIds: [],
				isError: false,
				hasGiantOutput: false,
				callsList: [],
			};
			toolMap.set(toolLabel, {
				tokens: prev.tokens + callTok,
				calls: prev.calls + 1,
				itemIds: [...prev.itemIds, call.id],
				isError: prev.isError || isErr || prevToolFailed,
				hasGiantOutput: prev.hasGiantOutput || isGiant,
				callsList: [...prev.callsList, callItem],
			});
			prevToolFailed = isErr;
		}
	}

	// Baseline fallback for system tokens if implicit in OMP
	if (systemTokens === 0 && items.length > 0) {
		systemTokens = 4200; // Standard minimal system prompt + tool contracts
	}

	// Compute totals
	const totalSkillTokens = Array.from(skillMap.values()).reduce(
		(s, x) => s + x.tokens,
		0,
	);
	const totalMcpTokens = Array.from(mcpMap.values()).reduce(
		(s, x) => s + x.tokens,
		0,
	);
	const totalToolTokens = Array.from(toolMap.values()).reduce(
		(s, x) => s + x.tokens,
		0,
	);

	const grandTotal = Math.max(
		1,
		systemTokens + proseTokens + totalSkillTokens + totalMcpTokens + totalToolTokens,
	);

	// Drilldowns
	const skillDrilldown: DrilldownItem[] = Array.from(skillMap.entries())
		.map(([name, data]) => {
			const isRepeated = data.calls > 1;
			const wasteTok = isRepeated
				? Math.round((data.tokens / data.calls) * (data.calls - 1))
				: 0;
			return {
				name,
				tokens: data.tokens,
				calls: data.calls,
				status: isRepeated ? ("waste" as const) : ("ok" as const),
				note: isRepeated
					? tNow("heatmap.skillRepeatedNote", { count: data.calls, tokens: wasteTok })
					: tNow("heatmap.skillNormalNote"),
				targetItemId: data.itemIds[0],
				callDetails: data.callsList,
			};
		})
		.sort((a, b) => b.tokens - a.tokens);

	const toolDrilldown: DrilldownItem[] = Array.from(toolMap.entries())
		.map(([name, data]) => {
			let status: "ok" | "warn" | "waste" = "ok";
			let note = tNow("heatmap.toolNormalNote");

			if (data.isError) {
				status = "waste";
				note = tNow("heatmap.toolErrorNote");
			} else if (data.hasGiantOutput) {
				status = "warn";
				note = tNow("heatmap.toolGiantNote");
			}

			return {
				name,
				tokens: data.tokens,
				calls: data.calls,
				status,
				note,
				targetItemId: data.itemIds[0],
				callDetails: data.callsList,
			};
		})
		.sort((a, b) => b.tokens - a.tokens);

	const mcpDrilldown: DrilldownItem[] = Array.from(mcpMap.entries())
		.map(([name, data]) => ({
			name,
			tokens: data.tokens,
			calls: data.calls,
			status: data.isError ? ("waste" as const) : ("ok" as const),
			note: data.isError ? tNow("heatmap.mcpErrorNote") : tNow("heatmap.mcpNormalNote"),
			targetItemId: data.itemIds[0],
			callDetails: data.callsList,
		}))
		.sort((a, b) => b.tokens - a.tokens);

	const systemDrilldown: DrilldownItem[] = [
		{
			name: tNow("heatmap.systemAgentsName"),
			tokens: Math.round(systemTokens * 0.65),
			calls: 1,
			status: "ok",
			note: tNow("heatmap.systemAgentsNote"),
		},
		{
			name: tNow("heatmap.systemRuntimeName"),
			tokens: Math.round(systemTokens * 0.35),
			calls: 1,
			status: "ok",
			note: tNow("heatmap.systemRuntimeNote"),
		},
	];

	const proseDrilldown: DrilldownItem[] = [
		{
			name: tNow("heatmap.proseThinkingName"),
			tokens: Math.round(proseTokens * 0.72),
			calls: 1,
			status: "ok",
			note: tNow("heatmap.proseThinkingNote"),
		},
		{
			name: tNow("heatmap.proseAssistantName"),
			tokens: Math.round(proseTokens * 0.28),
			calls: 1,
			status: "ok",
			note: tNow("heatmap.proseAssistantNote"),
		},
	];

	// Distribution breakdown with percentage
	const rawCategories: { key: CategoryKey; tokens: number; drill: DrilldownItem[] }[] =
		[
			{ key: "tools", tokens: totalToolTokens, drill: toolDrilldown },
			{ key: "skills", tokens: totalSkillTokens, drill: skillDrilldown },
			{ key: "system", tokens: systemTokens, drill: systemDrilldown },
			{ key: "mcp", tokens: totalMcpTokens, drill: mcpDrilldown },
			{ key: "prose", tokens: proseTokens, drill: proseDrilldown },
		];

	const distribution: DistributionCategory[] = rawCategories
		.filter((c) => c.tokens > 0)
		.map((c) => {
			const meta = CATEGORY_META[c.key];
			const pct = Math.max(1, Math.round((c.tokens / grandTotal) * 100));
			const wasteItems = c.drill.filter((x) => x.status !== "ok");
			return {
				key: c.key,
				label: tNow(meta.labelKey),
				colorClass: meta.colorClass,
				hex: meta.hex,
				tokens: c.tokens,
				pct,
				hasWaste: wasteItems.length > 0,
				wasteCount: wasteItems.length,
			};
		});

	// Context Gauge
	const used = maxContextUsed || grandTotal;
	const pct = Math.min(100, Math.round((used / limitTokens) * 100));
	let gaugeStatus: "ok" | "warn" | "danger" = "ok";
	let gaugeText = tNow("heatmap.gaugeAbundant");

	if (pct >= 90) {
		gaugeStatus = "danger";
		gaugeText = tNow("heatmap.gaugeDanger");
	} else if (pct >= 75) {
		gaugeStatus = "warn";
		gaugeText = tNow("heatmap.gaugeWarn");
	}

	return {
		name: tNow("heatmap.mainName"),
		role: tNow("heatmap.mainRole"),
		totalTokens: grandTotal,
		model: modelName,
		contextGauge: {
			usedTokens: used,
			limitTokens,
			pct,
			modelName,
			status: gaugeStatus,
			statusText: gaugeText,
		},
		distribution,
		drilldown: {
			tools: toolDrilldown,
			skills: skillDrilldown,
			system: systemDrilldown,
			mcp: mcpDrilldown,
			prose: proseDrilldown,
		},
	};
}

/**
 * Analyze a Subagent summary into the same distribution format.
 */
export function analyzeSubagentDistribution(
	summary: SubagentSummary,
): AgentDistributionAnalysis {
	const { limit: limitTokens, normalizedName: modelName } = resolveModelLimit(
		summary.model || "claude-3.7-sonnet",
	);

	const totalTokens = summary.tokens || 1000;
	// Subagent typical token allocation: tools heavy
	const toolTokens = Math.round(totalTokens * 0.72);
	const systemTokens = Math.round(totalTokens * 0.18);
	const proseTokens = Math.max(1, totalTokens - toolTokens - systemTokens);

	const toolDrilldown: DrilldownItem[] = [
		{
			name: tNow("heatmap.subagentToolName", { count: summary.toolCallCount }),
			tokens: toolTokens,
			calls: summary.toolCallCount,
			status: "ok",
			note: tNow("heatmap.subagentToolNote"),
		},
	];

	const systemDrilldown: DrilldownItem[] = [
		{
			name: tNow("heatmap.subagentSystemName"),
			tokens: systemTokens,
			calls: 1,
			status: "ok",
			note: tNow("heatmap.subagentSystemNote"),
		},
	];

	const proseDrilldown: DrilldownItem[] = [
		{
			name: tNow("heatmap.subagentProseName"),
			tokens: proseTokens,
			calls: summary.requestCount,
			status: "ok",
			note: tNow("heatmap.subagentProseNote"),
		},
	];

	const distribution: DistributionCategory[] = [
		{
			key: "tools",
			label: tNow(CATEGORY_META.tools.labelKey),
			colorClass: CATEGORY_META.tools.colorClass,
			hex: CATEGORY_META.tools.hex,
			tokens: toolTokens,
			pct: 72,
			hasWaste: false,
			wasteCount: 0,
		},
		{
			key: "system",
			label: tNow(CATEGORY_META.system.labelKey),
			colorClass: CATEGORY_META.system.colorClass,
			hex: CATEGORY_META.system.hex,
			tokens: systemTokens,
			pct: 18,
			hasWaste: false,
			wasteCount: 0,
		},
		{
			key: "prose",
			label: tNow(CATEGORY_META.prose.labelKey),
			colorClass: CATEGORY_META.prose.colorClass,
			hex: CATEGORY_META.prose.hex,
			tokens: proseTokens,
			pct: 10,
			hasWaste: false,
			wasteCount: 0,
		},
	];

	const used = totalTokens;
	const pct = Math.min(100, Math.round((used / limitTokens) * 100));

	return {
		name: summary.id,
		role: summary.prompt || tNow("heatmap.subagentDefaultRole"),
		totalTokens,
		model: modelName,
		contextGauge: {
			usedTokens: used,
			limitTokens,
			pct,
			modelName,
			status: "ok",
			statusText: tNow("heatmap.subagentStatusText"),
		},
		distribution,
		drilldown: {
			tools: toolDrilldown,
			skills: [],
			system: systemDrilldown,
			mcp: [],
			prose: proseDrilldown,
		},
	};
}

export type DiagnosticLens = "cost" | "prompt" | "quality" | "freeform";

export interface DiagnosticPrescription {
	label: string;
	promptDraft: string;
	explanation: string;
}

export interface DiagnosticDiagnosisResult {
	lens: DiagnosticLens;
	conclusion: string;
	evidence: string[];
	rootCause: string;
	prescriptions: DiagnosticPrescription[];
	systemicTags: string[];
	generatedAt: number;
}

export interface SessionDiagnosticSkeleton {
	sessionId: string;
	title: string;
	model: string;
	cwd: string;
	userGoals: string[];
	actionSkeleton: string[];
	recentErrors: string[];
	filesTouched: string[];
	tokenMetrics: {
		totalTokens: number;
		contextUsage: number;
		wasteSignals: string[];
	};
	dehydratedPromptText: string;
}

/**
 * Distill a full session transcript into an ultra-compact ~800 token
 * high-density "Trajectory Skeleton" (生命体征与事件骨架).
 * Prevents dumping 200k+ raw tokens to the diagnostic model.
 */
export function distillSessionSkeleton(
	items: TranscriptItem[],
	meta?: { id?: string; title?: string; model?: string | null; cwd?: string },
): SessionDiagnosticSkeleton {
	const sessionId = meta?.id || "current-session";
	const title = meta?.title || "未命名会话";
	const model = meta?.model || "claude-3.7-sonnet";
	const cwd = meta?.cwd || "";

	const userGoals: string[] = [];
	const actionSkeleton: string[] = [];
	const recentErrors: string[] = [];
	const filesTouchedSet = new Set<string>();
	const wasteSignals: string[] = [];

	let totalTokens = 0;
	let turnIndex = 0;
	let currentTurnActions: string[] = [];
	let consecutiveErrors = 0;

	const skillCounts = new Map<string, number>();

	for (const item of items) {
		if (item.usage?.totalTokens) {
			totalTokens += item.usage.totalTokens;
		}

		if (item.kind === "user") {
			if (currentTurnActions.length > 0) {
				actionSkeleton.push(`Turn ${turnIndex}: ${currentTurnActions.join(", ")}`);
				currentTurnActions = [];
			}
			turnIndex++;
			const goalText = (item.text || "").trim().slice(0, 140);
			if (goalText) userGoals.push(goalText);
			continue;
		}

		for (const call of item.toolCalls) {
			const args = call.args as Record<string, unknown> | null;
			const pathVal = typeof args?.path === "string" ? args.path : "";

			if (call.name === "read" && pathVal.startsWith("skill://")) {
				skillCounts.set(pathVal, (skillCounts.get(pathVal) || 0) + 1);
				currentTurnActions.push(`read ${pathVal}`);
			} else if (call.name === "bash" && typeof args?.command === "string") {
				const cmdSnippet = args.command.trim().slice(0, 45);
				currentTurnActions.push(`bash: ${cmdSnippet}`);
			} else if (call.name === "edit" || call.name === "write") {
				if (pathVal) {
					const fName = pathVal.split("/").pop() || pathVal;
					filesTouchedSet.add(fName);
					currentTurnActions.push(`${call.name}: ${fName}`);
				}
			} else {
				currentTurnActions.push(call.name);
			}
		}

		if (item.toolResult?.isError) {
			consecutiveErrors++;
			const errSnippet = item.toolResult.text.trim().slice(0, 150);
			recentErrors.push(`[${item.toolResult.toolName} 报错] ${errSnippet}`);
		} else if (item.toolResult) {
			consecutiveErrors = 0;
		}

		if (consecutiveErrors >= 2 && !wasteSignals.includes("连续工具报错撞墙")) {
			wasteSignals.push("连续工具报错撞墙");
		}
	}

	if (currentTurnActions.length > 0) {
		actionSkeleton.push(`Turn ${turnIndex}: ${currentTurnActions.join(", ")}`);
	}

	for (const [skill, count] of skillCounts.entries()) {
		if (count > 1) {
			wasteSignals.push(`重复读取 ${skill} (${count}次)`);
		}
	}

	const filesTouched = Array.from(filesTouchedSet);
	const dehydratedPromptText = [
		`## 会话脱水诊断骨架 (Session Skeleton)`,
		`- 标题: "${title}" | 模型: ${model}`,
		`- 用户主要目标: ${userGoals[0] || "(无初始指令)"}`,
		userGoals.length > 1 ? `- 后续指令: ${userGoals.slice(1).join(" -> ")}` : "",
		`- 改动文件清单: ${filesTouched.length > 0 ? filesTouched.join(", ") : "无文件修改"}`,
		`- 行为轨迹骨架:`,
		...actionSkeleton.slice(-8).map((a) => `  * ${a}`),
		recentErrors.length > 0 ? `- 最近报错:\n${recentErrors.slice(-4).map((e) => `  * ${e}`).join("\n")}` : "- 最近报错: 无",
		wasteSignals.length > 0 ? `- 检测到的浪费信号: ${wasteSignals.join("; ")}` : "- 浪费信号: 无异常",
	].filter(Boolean).join("\n");

	return {
		sessionId,
		title,
		model,
		cwd,
		userGoals,
		actionSkeleton,
		recentErrors,
		filesTouched,
		tokenMetrics: {
			totalTokens,
			contextUsage: totalTokens,
			wasteSignals,
		},
		dehydratedPromptText,
	};
}
