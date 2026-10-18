/**
 * Right tab: Token usage & cost panel.
 * Rebuilt as a professional context & token inspector:
 * - Segmented tabs: [ 本对话 ] vs [ 全局用量 ]
 * - Target switch: Main session vs Subagents with context isolation savings
 * - macOS-style distribution spectrum bar: Tool Calls, Skills, System Prompt, MCP, Prose
 * - Interactive drill-down inspector: inspects individual tools, skills (repeated waste detection), MCP calls
 * - Click-to-locate message scroll into the main chat stream
 * - Global OMP sessions explorer with time filters, sorting, and click-to-diagnose
 */

import clsx from "clsx";
import { AlertCircle, AlertTriangle, CheckCircle, ChevronDown, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Segmented } from "../../components/Segmented";
import type { SubagentSummary, TranscriptItem } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { subagentList } from "../../lib/ipc";
import { useLive } from "../../stores/live";
import { useLocate } from "../../stores/locate";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { DoctorView } from "./DoctorView";
import { SystemicIssuesCard } from "./SystemicIssuesCard";
import {
	type AgentDistributionAnalysis,
	type CategoryKey,
	analyzeMainDistribution,
	analyzeSubagentDistribution,
} from "./distribution";

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return n.toLocaleString();
}

function formatCost(c: number): string {
	if (c === 0) return "$0.00";
	if (c < 0.01) return `$${c.toFixed(4)}`;
	return `$${c.toFixed(2)}`;
}

const EMPTY_ITEMS: TranscriptItem[] = [];

type MainTab = "session" | "global" | "doctor";
type TimeRange = "today" | "7d" | "all";
type SortOption = "consumption" | "waste" | "latest";

export function HeatmapPanel() {
	const selectedId = useUi((s) => s.selectedSessionId);
	const sessions = useSessions((s) => s.sessions);
	const sessionMeta = selectedId ? sessions[selectedId] : undefined;
	const sessionFile = sessionMeta?.file;
	const allSessions = useMemo(() => Object.values(sessions), [sessions]);
	const items = useLive((s) =>
		selectedId ? (s.sessions[selectedId]?.items ?? EMPTY_ITEMS) : EMPTY_ITEMS,
	);

	// Tabs & Navigation state
	const [mainTab, setMainTab] = useState<MainTab>("session");
	const [currentTarget, setCurrentTarget] = useState<string>("main");
	const [currentCategory, setCurrentCategory] = useState<CategoryKey>("tools");
	const [expandedItemName, setExpandedItemName] = useState<string | null>(null);

	// Global view controls
	const [timeRange, setTimeRange] = useState<TimeRange>("7d");
	const [sortBy, setSortBy] = useState<SortOption>("consumption");

	// Subagents state
	const [subagents, setSubagents] = useState<SubagentSummary[]>([]);

	// Fetch subagents for the selected session
	useEffect(() => {
		let cancelled = false;
		if (sessionFile) {
			subagentList(sessionFile)
				.then((list) => {
					if (!cancelled) setSubagents(list);
				})
				.catch(() => {
					if (!cancelled) setSubagents([]);
				});
		} else {
			setSubagents([]);
		}
		return () => {
			cancelled = true;
		};
	}, [sessionFile]);

	// Reset target when switching sessions
	useEffect(() => {
		setCurrentTarget("main");
	}, [selectedId]);

	// Calculate main distribution
	const mainAnalysis = useMemo(
		() => analyzeMainDistribution(items, sessionMeta?.model ?? undefined),
		[items, sessionMeta?.model],
	);

	// Calculate subagent distributions map
	const subagentAnalyses = useMemo(() => {
		const map = new Map<string, AgentDistributionAnalysis>();
		for (const sub of subagents) {
			map.set(sub.id, analyzeSubagentDistribution(sub));
		}
		return map;
	}, [subagents]);

	// Total tokens across all subagents (Isolation ROI)
	const subagentsTotalTokens = useMemo(
		() => subagents.reduce((acc, s) => acc + (s.tokens || 0), 0),
		[subagents],
	);

	// Current active analysis (Main vs specific Subagent)
	const activeAnalysis =
		currentTarget === "main"
			? mainAnalysis
			: subagentAnalyses.get(currentTarget) || mainAnalysis;

	const drilldownItems = activeAnalysis.drilldown[currentCategory] || [];

	// Global view filtering & sorting
	const { filteredSessions, globalTotals } = useMemo(() => {
		const now = Date.now();
		const oneDayMs = 24 * 60 * 60 * 1000;
		const sevenDaysMs = 7 * oneDayMs;

		const filtered = allSessions.filter((s) => {
			if (timeRange === "all") return true;
			const ts = new Date(s.updatedAt || s.createdAt).getTime();
			if (Number.isNaN(ts)) return true;
			const diff = now - ts;
			if (timeRange === "today") return diff <= oneDayMs;
			if (timeRange === "7d") return diff <= sevenDaysMs;
			return true;
		});

		let totalTok = 0;
		let totalCost = 0;

		const mapped = filtered.map((s) => {
			// Estimate tokens or check result
			const isError = s.status === "error";
			const isInterrupted = s.status === "interrupted";
			const dirty = s.git?.dirty ?? 0;
			// Baseline token estimate if exact usage isn't populated
			const tokEst = Math.max(1200, (dirty + 1) * 3500);
			totalTok += tokEst;
			totalCost += (tokEst / 1000) * 0.003; // Average blend estimate

			return {
				meta: s,
				tokens: tokEst,
				cost: (tokEst / 1000) * 0.003,
				hasWaste: isError || isInterrupted,
			};
		});

		// Sort
		if (sortBy === "consumption") {
			mapped.sort((a, b) => b.tokens - a.tokens);
		} else if (sortBy === "waste") {
			mapped.sort((a, b) => {
				if (a.hasWaste !== b.hasWaste) return a.hasWaste ? -1 : 1;
				return b.tokens - a.tokens;
			});
		} else {
			mapped.sort((a, b) => {
				const ta = new Date(a.meta.updatedAt).getTime();
				const tb = new Date(b.meta.updatedAt).getTime();
				return tb - ta;
			});
		}

		return {
			filteredSessions: mapped,
			globalTotals: {
				count: filtered.length,
				tokens: totalTok,
				cost: totalCost,
			},
		};
	}, [allSessions, timeRange, sortBy]);

	return (
		<div className="flex h-full min-w-0 flex-col overflow-y-auto overflow-x-hidden text-xs">
			{/* Top Segmented Switcher */}
			<div className="p-3 pb-2.5 hairline-b sticky top-0 bg-[var(--bg-panel)] z-10 flex items-center justify-between">
				<Segmented
					options={[
						{ value: "session", label: "本对话" },
						{ value: "global", label: "全局洞察" },
						{ value: "doctor", label: "🩺 AI会诊" },
					]}
					value={mainTab}
					onChange={setMainTab}
					size="sm"
				/>
				{mainTab === "session" && subagentsTotalTokens > 0 && (
					<span
						className="flex items-center gap-1 text-[10.5px] font-mono text-emerald-400 font-medium"
						title="通过并发子代理沙箱隔离，避免将冗长输出持久污染到主对话上下文"
					>
						<ShieldCheck size={12} />
						隔离省流 ~{formatTokens(subagentsTotalTokens)}
					</span>
				)}
			</div>

			{/* Main Tab Content */}
			{mainTab === "session" ? (
				<div className="flex-1 min-w-0 p-3 space-y-3">
					{!selectedId ? (
						<div className="p-6 text-center text-xs text-neutral-500">
							选择一个会话查看 Token 用量
						</div>
					) : items.length === 0 ? (
						<div className="p-6 text-center text-xs text-neutral-500">
							暂无消息记录
						</div>
					) : (
						<>
							{/* 1. Agent Selection Pills (Main vs Subagents) */}
							{subagents.length > 0 && (
								<div className="space-y-1">
									<div className="flex items-center justify-between text-[10.5px] text-neutral-400 px-0.5">
										<span>检查对象</span>
										<span className="font-mono text-[10px]">
											{subagents.length} 个 Subagents
										</span>
									</div>
									<div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
										<button
											type="button"
											onClick={() => setCurrentTarget("main")}
											className={clsx(
												"flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] transition-all whitespace-nowrap",
												currentTarget === "main"
													? "border-[var(--accent)] bg-[var(--bg-selected)] font-medium text-neutral-100 shadow-sm"
													: "border-[var(--border)] bg-[var(--bg)] text-neutral-400 hover:bg-[var(--bg-hover)]",
											)}
										>
											<span>👑 主对话</span>
											<span className="font-mono text-[10px] opacity-75">
												{formatTokens(mainAnalysis.totalTokens)}
											</span>
										</button>
										{subagents.map((sub) => (
											<button
												key={sub.id}
												type="button"
												onClick={() => setCurrentTarget(sub.id)}
												className={clsx(
													"flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] transition-all whitespace-nowrap",
													currentTarget === sub.id
														? "border-purple-400 bg-[var(--bg-selected)] font-medium text-neutral-100 shadow-sm"
														: "border-[var(--border)] bg-[var(--bg)] text-neutral-400 hover:bg-[var(--bg-hover)]",
												)}
											>
												<span className="px-1 py-0.2 rounded bg-purple-500/20 text-purple-400 font-mono text-[9.5px]">
													subagent
												</span>
												<span className="truncate max-w-[90px]">{sub.id}</span>
												<span className="font-mono text-[10px] opacity-75">
													{formatTokens(sub.tokens)}
												</span>
											</button>
										))}
									</div>
								</div>
							)}

							{/* 2. Bento Card: Context Gauge & Target Overview */}
							<div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 shadow-sm">
								<div className="flex items-center justify-between mb-1.5">
									<div className="flex flex-wrap items-center gap-1.5 min-w-0">
										<span className="font-medium text-neutral-200 text-[12px] break-words min-w-0">
											{activeAnalysis.name}
										</span>
										<span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-neutral-400 break-all min-w-0">
											{activeAnalysis.model}
										</span>
									</div>
									<span className="font-mono text-[11.5px] text-neutral-200 font-medium shrink-0">
										{formatTokens(activeAnalysis.totalTokens)} tok
									</span>
								</div>

								<div className="flex items-center justify-between text-[10.5px] text-neutral-400 mb-1">
									<span>上下文水位</span>
									<span className="font-mono">
										{formatTokens(activeAnalysis.contextGauge.usedTokens)} /{" "}
										{formatTokens(activeAnalysis.contextGauge.limitTokens)} (
										{activeAnalysis.contextGauge.pct}%)
									</span>
								</div>

								{/* Watermark bar */}
								<div className="h-1.5 w-full bg-[var(--bg-hover)] rounded-full overflow-hidden mb-1.5">
									<div
										className={clsx(
											"h-full rounded-full transition-all duration-300",
											activeAnalysis.contextGauge.status === "danger"
												? "bg-red-500"
												: activeAnalysis.contextGauge.status === "warn"
													? "bg-amber-500"
													: "bg-emerald-500",
										)}
										style={{ width: `${activeAnalysis.contextGauge.pct}%` }}
									/>
								</div>

								<div className="flex items-center justify-between text-[10px]">
									<span
										className={clsx(
											"flex items-center gap-1 font-medium",
											activeAnalysis.contextGauge.status === "danger"
												? "text-red-400"
												: activeAnalysis.contextGauge.status === "warn"
													? "text-amber-400"
													: "text-emerald-400",
										)}
									>
										{activeAnalysis.contextGauge.status === "danger" ? (
											<AlertCircle size={11} />
										) : activeAnalysis.contextGauge.status === "warn" ? (
											<AlertTriangle size={11} />
										) : (
											<CheckCircle size={11} />
										)}
										{activeAnalysis.contextGauge.statusText}
									</span>
									<span className="font-mono text-neutral-500">
										余量 ~
										{formatTokens(
											Math.max(
												0,
												activeAnalysis.contextGauge.limitTokens -
													activeAnalysis.contextGauge.usedTokens,
											),
										)}
									</span>
								</div>
							</div>

							{/* 3. macOS-style Spectrum Distribution Bar & Category Chips */}
							<div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 shadow-sm">
								<div className="flex items-center justify-between mb-2">
									<span className="font-medium text-[11px] text-neutral-400">
										Token 消耗分布 (Distribution)
									</span>
									<span className="text-[10px] text-neutral-500">
										点击类别钻取明细
									</span>
								</div>

								{/* Spectrum Bar */}
								<div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[var(--bg-hover)] mb-3">
									{activeAnalysis.distribution.map((d) => (
										<div
											key={d.key}
											className={clsx(
												"h-full transition-all cursor-pointer hover:opacity-80",
												d.colorClass,
											)}
											style={{ width: `${d.pct}%` }}
											title={`${d.label}: ${formatTokens(d.tokens)} (${d.pct}%)`}
											onClick={() => setCurrentCategory(d.key)}
										/>
									))}
								</div>

								{/* Category Selection Chips */}
								<div className="grid grid-cols-2 gap-1.5">
									{activeAnalysis.distribution.map((d) => (
										<button
											key={d.key}
											type="button"
											onClick={() => setCurrentCategory(d.key)}
											className={clsx(
												"flex items-center justify-between p-1.5 px-2 rounded-lg border text-left transition-all",
												currentCategory === d.key
													? "border-[var(--accent)] bg-[var(--bg-selected)] shadow-sm"
													: "border-[var(--border)] bg-[var(--bg-panel)]/40 hover:bg-[var(--bg-hover)]",
											)}
										>
											<div className="flex items-center gap-1.5 min-w-0">
												<span
													className={clsx(
														"h-2 w-2 rounded-full shrink-0",
														d.colorClass,
													)}
												/>
												<span
													className={clsx(
														"text-[11px] truncate",
														currentCategory === d.key
															? "font-medium text-neutral-100"
															: "text-neutral-400",
													)}
												>
													{d.label}
												</span>
												{d.hasWaste && (
													<span
														className="text-[9.5px] text-amber-400 font-medium"
														title="检测到潜在浪费或冗余"
													>
														⚠️
													</span>
												)}
											</div>
											<span className="font-mono text-[10px] text-neutral-400 shrink-0">
												{formatTokens(d.tokens)}
											</span>
										</button>
									))}
								</div>
							</div>

							{/* 4. Deep Dive Drill-Down Inspector */}
							<div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 shadow-sm">
								<div className="flex items-center justify-between mb-2 pb-1.5 hairline-b">
									<div className="flex items-center gap-1.5 font-medium text-[11.5px] text-neutral-200">
										<span>
											🔍 钻取明细：
											{currentCategory === "tools"
												? "Tool Calls (工具输出)"
												: currentCategory === "skills"
													? "Skills 注入 (规约与插件)"
													: currentCategory === "system"
														? "System Prompt (系统设定)"
														: currentCategory === "mcp"
															? "MCP 协议服务"
															: "思考与回复文本"}
										</span>
									</div>
									<span className="text-[10px] text-neutral-500">
										共 {drilldownItems.length} 项
									</span>
								</div>

								{drilldownItems.length === 0 ? (
									<div className="py-4 text-center text-xs text-neutral-500">
										当前对象未调用该类资源
									</div>
								) : (
									<div className="space-y-1.5">
										{drilldownItems.map((item, idx) => {
											const isExpanded = expandedItemName === item.name;
											const hasCalls = Boolean(item.callDetails && item.callDetails.length > 0);
											return (
												<div
													key={`${item.name}-${idx}`}
													className={clsx(
														"group rounded-lg border p-2.5 text-left transition-all",
														item.status === "waste"
															? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/80"
															: item.status === "warn"
																? "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60"
																: "border-[var(--border)] bg-[var(--bg-panel)]/30 hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]",
													)}
												>
													<div
														className="flex items-start justify-between gap-1 mb-0.5 cursor-pointer select-none"
														onClick={() => {
															if (hasCalls) {
																setExpandedItemName(isExpanded ? null : item.name);
															}
														}}
													>
														<div className="flex items-center gap-1.5 min-w-0 flex-1">
															{hasCalls && (
																<ChevronDown
																	size={12}
																	className={clsx(
																		"text-neutral-400 transition-transform shrink-0",
																		isExpanded && "rotate-180",
																	)}
																/>
															)}
															<span className="font-mono text-[11px] font-medium text-neutral-200 break-all min-w-0">
																{item.name}
															</span>
														</div>
														<div
															className={clsx(
																"font-mono text-[11px] font-medium shrink-0",
																item.status === "waste"
																	? "text-amber-400"
																	: "text-neutral-300",
															)}
														>
															{formatTokens(item.tokens)} tok
														</div>
													</div>
													<div
														className={clsx(
															"text-[10.5px] mb-1.5 leading-relaxed break-words [overflow-wrap:anywhere]",
															item.status === "waste"
																? "text-amber-300/90 font-medium"
																: "text-neutral-400",
														)}
													>
														{item.note}
													</div>
													<div className="flex items-center justify-between text-[10px] text-neutral-500">
														<button
															type="button"
															onClick={() => {
																if (hasCalls) {
																	setExpandedItemName(isExpanded ? null : item.name);
																}
															}}
															className="text-neutral-400 hover:text-neutral-200 underline decoration-neutral-600 underline-offset-2"
														>
															调用 {item.calls} 次 {hasCalls ? (isExpanded ? "▲ 收起" : "▼ 展开查看每次调用") : ""}
														</button>
														{item.targetItemId && selectedId && (
															<button
																type="button"
																onClick={(e) => {
																	e.stopPropagation();
																	useLocate
																		.getState()
																		.locate(
																			selectedId,
																			item.name,
																			(item.callDetails ?? [{ targetItemId: item.targetItemId! }]).map(
																				(c) => c.targetItemId,
																			),
																		);
																}}
																className="rounded-full border border-[var(--accent)]/50 px-2 py-0.5 text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
															>
																定位到会话
															</button>
														)}
													</div>

													{/* In-place Accordion: List of individual invocations */}
													{isExpanded && hasCalls && (
														<div className="mt-2.5 pt-2 border-t border-[var(--border-divider)] space-y-1">
															<div className="text-[10px] text-neutral-400 font-medium flex items-center justify-between mb-1">
																<span>具体调用历史 ({item.callDetails!.length} 次)</span>
																<span className="text-[9.5px] text-neutral-500">点击「定位」跳到对话中的这一步，可用上一处/下一处切换</span>
															</div>
															<div className="max-h-48 overflow-y-auto space-y-1 pr-0.5 no-scrollbar">
																{item.callDetails!.map((call, cIdx) => (
																	<div
																		key={`${call.id}-${cIdx}`}
																		className="flex items-start justify-between gap-1.5 rounded bg-[var(--bg-panel)]/80 px-2 py-1 text-[10px] hover:bg-[var(--bg-hover)] transition-colors"
																	>
																		<div className="flex items-center gap-1.5 min-w-0 flex-1">
																			<span className="font-mono text-neutral-500 text-[9px] shrink-0">
																				#{cIdx + 1}
																			</span>
																			<span
																				className="font-mono text-neutral-300 break-all min-w-0"
																				title={call.label}
																			>
																				{call.label}
																			</span>
																		</div>
																		<div className="flex items-center gap-1.5 shrink-0">
																			<span className="font-mono text-neutral-400">
																				{formatTokens(call.tokens)} tok
																			</span>
																			{call.isError && (
																				<span className="text-red-400 font-medium text-[9px]">
																					报错
																				</span>
																			)}
																			<button
																				type="button"
																				onClick={(e) => {
																					e.stopPropagation();
																					if (selectedId)
																						useLocate
																							.getState()
																							.locate(
																								selectedId,
																								item.name,
																								item.callDetails!.map((c) => c.targetItemId),
																								cIdx,
																							);
																				}}
																				className="rounded-full border border-[var(--accent)]/50 px-2 py-0.5 text-[10px] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
																			>
																				定位
																			</button>
																		</div>
																	</div>
																))}
															</div>
														</div>
													)}
												</div>
											);
										})}
									</div>
								)}
							</div>
						</>
					)}
				</div>
			) : mainTab === "global" ? (
				/* Global OMP Sessions Explorer View */
				<div className="flex-1 min-w-0 p-3 space-y-3">
					<SystemicIssuesCard
						sessions={sessions}
						onSelect={(id) => {
							useUi.getState().selectSession(id);
							setMainTab("session");
						}}
					/>
					{/* Controls: Time filter & Sort selection */}
					<div className="space-y-2">
						<Segmented
							options={[
								{ value: "today", label: "今天" },
								{ value: "7d", label: "近 7 天" },
								{ value: "all", label: "全部历史" },
							]}
							value={timeRange}
							onChange={setTimeRange}
							size="sm"
						/>
						<div className="flex items-center justify-between text-[11px] text-neutral-400 px-0.5">
							<span>排序方式</span>
							<div className="relative inline-block">
								<select
									value={sortBy}
									onChange={(e) => setSortBy(e.target.value as SortOption)}
									className="appearance-none bg-[var(--bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[11px] text-neutral-200 pr-6 focus:outline-none focus:border-[var(--accent)]"
								>
									<option value="consumption">最高消耗优先</option>
									<option value="waste">最多问题优先</option>
									<option value="latest">最新活动优先</option>
								</select>
								<ChevronDown
									size={12}
									className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-neutral-400"
								/>
							</div>
						</div>
					</div>

					{/* Summary Cards */}
					<div className="grid grid-cols-3 gap-2 text-[11px]">
						<div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2 text-center shadow-sm">
							<div className="text-neutral-500 mb-0.5 text-[10px]">会话总数</div>
							<div className="font-mono text-neutral-200 text-[13px] font-medium">
								{globalTotals.count}
							</div>
						</div>
						<div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2 text-center shadow-sm">
							<div className="text-neutral-500 mb-0.5 text-[10px]">总消耗</div>
							<div className="font-mono text-neutral-200 text-[13px] font-medium">
								{formatTokens(globalTotals.tokens)}
							</div>
						</div>
						<div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2 text-center shadow-sm">
							<div className="text-neutral-500 mb-0.5 text-[10px]">预估成本</div>
							<div className="font-mono text-emerald-400 text-[13px] font-medium">
								{formatCost(globalTotals.cost)}
							</div>
						</div>
					</div>

					{/* Sessions List */}
					<div className="space-y-1">
						<div className="text-[11px] font-medium text-neutral-400 px-0.5 mb-1.5">
							OMP 会话明细 (点击切入诊断)
						</div>
						{filteredSessions.length === 0 ? (
							<div className="p-6 text-center text-xs text-neutral-500">
								无匹配会话记录
							</div>
						) : (
							<div className="space-y-1.5">
								{filteredSessions.map(({ meta, tokens, cost, hasWaste }) => (
									<div
										key={meta.id}
										onClick={() => {
											useUi.getState().selectSession(meta.id);
											setMainTab("session");
										}}
										className={clsx(
											"group rounded-xl border p-2.5 cursor-pointer transition-all",
											selectedId === meta.id
												? "border-[var(--accent)] bg-[var(--bg-selected)] shadow-sm"
												: "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/60 hover:bg-[var(--bg-hover)]",
										)}
									>
										<div className="flex items-center justify-between mb-1">
											<div className="font-medium text-neutral-200 break-words min-w-0 pr-2 text-[11.5px]">
												{meta.title || "未命名会话"}
											</div>
											<div className="text-[10px] text-neutral-500 shrink-0 font-mono">
												{relativeTime(meta.updatedAt || meta.createdAt)}
											</div>
										</div>
										<div className="flex items-center justify-between text-[10px]">
											<div className="flex items-center gap-1.5 font-mono text-neutral-400">
												<span>{formatTokens(tokens)} tok</span>
												<span className="text-neutral-600">·</span>
												<span>{formatCost(cost)}</span>
												{meta.git?.branch && (
													<>
														<span className="text-neutral-600">·</span>
														<span className="text-neutral-500 break-all min-w-0">
															{meta.git.branch}
														</span>
													</>
												)}
											</div>
											<div>
												{hasWaste ? (
													<span className="text-amber-400 font-medium">
														⚠️ 异常中断
													</span>
												) : (
													<span className="text-emerald-400 font-medium">
														● 正常
													</span>
												)}
											</div>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			) : (
				<div className="flex-1 min-w-0 p-3 space-y-3">
					{!selectedId ? (
						<div className="p-6 text-center text-xs text-neutral-500">先在左侧选择一个对话，再开始 AI 会诊</div>
					) : (
						<DoctorView key={selectedId} sessionId={selectedId} meta={sessionMeta} items={items} />
					)}
				</div>
			)}
		</div>
	);
}
