/**
 * Settings ▸ 订阅与 Quota (`quota`):
 * Real provider quota and Coding Plans synced directly via `omp usage --json`.
 * Features crisp physical card boundaries, dedicated brand colorways & logos,
 * human-readable quota copy, and collapsible account breakdowns.
 */
import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Clock,
	Cpu,
	Gauge,
	RefreshCw,
	ShieldCheck,
	Sparkles,
	Timer,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	OmpUsageAccountWithoutUsage,
	OmpUsageProviderReport,
	OmpUsageReportData,
} from "../../../lib/contracts";
import { ompUsageReport } from "../../../lib/ipc";
import { SETTINGS_BUTTON_CLASS, SectionHeader, SettingsCard } from "../ui";
import { ProviderBrandLogo } from "./ProviderBrandLogo";
import {
	type ProviderBrandConfig,
	dedupeLimits,
	formatCountdown,
	formatHumanWindowName,
	formatRelativeTime,
	resolveBrandConfig,
} from "./quotaHelpers";

interface ProviderGroup {
	providerId: string;
	brand: ProviderBrandConfig;
	reports: OmpUsageProviderReport[];
	unmetered: OmpUsageAccountWithoutUsage[];
	primaryLimits: {
		label: string;
		usedPct: number;
		remainingText: string;
		countdown: string;
		windowLabel?: string;
	}[];
	earliestResetMs: number | null;
	totalCredits: number;
}

export function QuotaDashboardCard() {
	const [data, setData] = useState<OmpUsageReportData | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const [selectedTab, setSelectedTab] = useState<string>("all");
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	const toggleExpanded = (providerId: string) => {
		setExpanded((prev) => ({
			...prev,
			[providerId]: !prev[providerId],
		}));
	};

	const fetchReport = useCallback(async (refresh = false) => {
		if (refresh) setRefreshing(true);
		else setLoading(true);
		setError(null);
		try {
			const res = await ompUsageReport(refresh);
			setData(res);
			setNow(Date.now());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void fetchReport(false);
		const interval = setInterval(() => setNow(Date.now()), 15_000);
		return () => clearInterval(interval);
	}, [fetchReport]);

	// Process and group reports by provider
	const { providers, stats } = useMemo(() => {
		if (!data) {
			return {
				providers: [] as ProviderGroup[],
				stats: {
					totalProviders: 0,
					totalAccounts: 0,
					totalCredits: 0,
					allHealthy: true,
				},
			};
		}

		const map = new Map<
			string,
			{
				reports: OmpUsageProviderReport[];
				unmetered: OmpUsageAccountWithoutUsage[];
			}
		>();

		for (const r of data.reports ?? []) {
			const existing = map.get(r.provider) ?? { reports: [], unmetered: [] };
			existing.reports.push(r);
			map.set(r.provider, existing);
		}

		for (const u of data.accountsWithoutUsage ?? []) {
			const existing = map.get(u.provider) ?? { reports: [], unmetered: [] };
			existing.unmetered.push(u);
			map.set(u.provider, existing);
		}

		let totalCreditsCount = 0;
		let allHealthy = true;

		const list: ProviderGroup[] = Array.from(map.entries()).map(
			([providerId, val]) => {
				const brand = resolveBrandConfig(providerId);
				const capacity = data.capacity?.[providerId];
				const primaryLimits: ProviderGroup["primaryLimits"] = [];
				let earliestReset: number | null = null;
				let providerCredits = 0;

				for (const r of val.reports) {
					if (r.resetCredits?.availableCount) {
						providerCredits += r.resetCredits.availableCount;
					}
					for (const l of r.limits ?? []) {
						if (l.window?.resetsAt) {
							if (!earliestReset || l.window.resetsAt < earliestReset) {
								earliestReset = l.window.resetsAt;
							}
						}
						if (l.status === "exhausted") {
							allHealthy = false;
						}
					}
				}
				totalCreditsCount += providerCredits;

				// If provider has multi-account capacity summary, translate to human language
				if (capacity && capacity.length > 0) {
					for (const cap of capacity) {
						const usedPct =
							cap.accounts > 0
								? Math.min(100, (cap.usedAccounts / cap.accounts) * 100)
								: 0;
						const windowName = formatHumanWindowName(cap.window);
						const remText =
							cap.accounts > 1
								? `余 ${cap.remainingAccounts.toFixed(2)}× 账号配额 (${cap.accounts} 账号共享池)`
								: `余 ${(100 - usedPct).toFixed(1)}% 配额`;

						primaryLimits.push({
							label: windowName,
							usedPct,
							remainingText: remText,
							countdown: earliestReset
								? formatCountdown(earliestReset - now)
								: "持续滚动",
							windowLabel: cap.window,
						});
					}
				} else if (val.reports[0]) {
					// Single account or no capacity summary: use first account's deduped limits
					const sampleLimits = dedupeLimits(val.reports[0].limits ?? []).slice(
						0,
						2,
					);
					for (const l of sampleLimits) {
						const isPercent = l.amount.unit === "percent";
						const usedPct = isPercent
							? l.amount.used ??
								(l.amount.usedFraction != null
									? l.amount.usedFraction * 100
									: 0)
							: l.amount.limit
								? ((l.amount.used ?? 0) / l.amount.limit) * 100
								: 0;
						const remPct = isPercent
							? l.amount.remaining ?? 100 - usedPct
							: null;
						const windowName = formatHumanWindowName(
							l.window?.id || l.window?.label || l.label,
						);

						primaryLimits.push({
							label: windowName,
							usedPct,
							remainingText:
								remPct != null
									? `余 ${remPct.toFixed(1)}% 配额`
									: `余 ${l.amount.remaining ?? 0} ${l.amount.unit}`,
							countdown: l.window?.resetsAt
								? formatCountdown(l.window.resetsAt - now)
								: "持续滚动",
							windowLabel: l.window?.label,
						});
					}
				}

				return {
					providerId,
					brand,
					reports: val.reports,
					unmetered: val.unmetered,
					primaryLimits,
					earliestResetMs: earliestReset,
					totalCredits: providerCredits,
				};
			},
		);

		let totalAccountsCount = 0;
		for (const p of list) {
			totalAccountsCount += p.reports.length + p.unmetered.length;
		}

		return {
			providers: list,
			stats: {
				totalProviders: list.length,
				totalAccounts: totalAccountsCount,
				totalCredits: totalCreditsCount,
				allHealthy,
			},
		};
	}, [data, now]);

	const visibleProviders = useMemo(() => {
		if (selectedTab === "all") return providers;
		return providers.filter((p) => p.providerId === selectedTab);
	}, [providers, selectedTab]);

	return (
		<SettingsCard fieldId="quotaDashboard">
			<div className="space-y-4 p-4">
				{/* Top Section Header */}
				<SectionHeader
					title={
						<span className="flex items-center gap-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
							<Gauge className="h-4 w-4 text-[var(--accent)]" /> 订阅与 Quota
						</span>
					}
					description="通过 OMP 实时同步的官方订阅与 Coding Plan 额度（Anthropic Claude、Google Antigravity、Devin 等），直连官方用量统计与重置周期。"
					actions={
						<button
							type="button"
							className={SETTINGS_BUTTON_CLASS}
							disabled={loading || refreshing}
							onClick={() => void fetchReport(true)}
						>
							<RefreshCw
								className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
							/>
							{refreshing ? "刷新中…" : "刷新"}
						</button>
					}
				/>

				{loading ? (
					<div className="flex flex-col items-center justify-center py-12 text-xs text-neutral-500 gap-2.5">
						<RefreshCw className="h-5 w-5 animate-spin text-[var(--accent)]" />
						<span>正在从 OMP 获取官方订阅与额度快照…</span>
					</div>
				) : error ? (
					<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-600 dark:text-red-300 space-y-2">
						<div className="flex items-center gap-2 font-medium">
							<AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
							<span>无法获取 OMP 配额快照</span>
						</div>
						<div className="text-[11px] text-red-500/80">{error}</div>
						<button
							type="button"
							className="text-[11px] text-[var(--accent)] underline hover:opacity-80 font-medium"
							onClick={() => void fetchReport(true)}
						>
							重试
						</button>
					</div>
				) : providers.length === 0 ? (
					<div className="py-10 text-center text-xs text-neutral-500 space-y-2.5">
						<div className="text-neutral-800 dark:text-neutral-200 font-semibold text-sm">
							暂无已激活的官方订阅或 Coding Plan
						</div>
						<div className="text-[11px] text-neutral-500 max-w-md mx-auto leading-relaxed">
							未检测到 Anthropic、Devin、Google Antigravity、GitHub Copilot
							等官方订阅账号。可在终端执行{" "}
							<code className="rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-neutral-800 dark:text-neutral-200 font-mono border border-neutral-200 dark:border-neutral-700">
								omp login
							</code>{" "}
							登录账号，登录后即可在此实时查看官方配额与重置时间。
						</div>
						<div className="text-[10px] text-neutral-400">
							普通 API Key 按量计费结算，不属于 Coding Plan
							配额，可在左侧「API 供应商」中配置。
						</div>
					</div>
				) : (
					<div className="space-y-4">
						{/* North Star KPI Summary Bar */}
						<div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
							<div className="rounded-xl border border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 shadow-xs">
								<div className="text-[11px] text-neutral-500 flex items-center gap-1.5 font-medium">
									<Cpu className="h-3.5 w-3.5 text-neutral-400" />
									<span>活跃服务</span>
								</div>
								<div className="mt-1 text-lg font-bold text-neutral-900 dark:text-neutral-100">
									{stats.totalProviders}{" "}
									<span className="text-xs font-normal text-neutral-500">
										家
									</span>
								</div>
							</div>

							<div className="rounded-xl border border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 shadow-xs">
								<div className="text-[11px] text-neutral-500 flex items-center gap-1.5 font-medium">
									<Users className="h-3.5 w-3.5 text-neutral-400" />
									<span>授权账号</span>
								</div>
								<div className="mt-1 text-lg font-bold text-neutral-900 dark:text-neutral-100">
									{stats.totalAccounts}{" "}
									<span className="text-xs font-normal text-neutral-500">
										个
									</span>
								</div>
							</div>

							<div className="rounded-xl border border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 shadow-xs">
								<div className="text-[11px] text-neutral-500 flex items-center gap-1.5 font-medium">
									<ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
									<span>健康状态</span>
								</div>
								<div className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
									<span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
									{stats.allHealthy ? "全部充裕" : "部分受限"}
								</div>
							</div>

							<div className="rounded-xl border border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 shadow-xs">
								<div className="text-[11px] text-neutral-500 flex items-center gap-1.5 font-medium">
									<Sparkles className="h-3.5 w-3.5 text-amber-500" />
									<span>专属权益</span>
								</div>
								<div className="mt-1 text-xs font-semibold text-amber-600 dark:text-amber-400 truncate">
									{stats.totalCredits > 0
										? `✦ ${stats.totalCredits} 次重置机会`
										: "标准额度"}
								</div>
							</div>
						</div>

						{/* Quick Filter Tabs */}
						{providers.length > 1 && (
							<div className="flex flex-wrap items-center gap-1.5 border-b border-neutral-200 dark:border-neutral-800 pb-2.5">
								<button
									type="button"
									onClick={() => setSelectedTab("all")}
									className={`rounded-full px-3 py-1 text-xs transition-all ${
										selectedTab === "all"
											? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 font-semibold shadow-xs"
											: "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
									}`}
								>
									全部 ({providers.length})
								</button>
								{providers.map((p) => {
									const isSel = selectedTab === p.providerId;
									return (
										<button
											key={p.providerId}
											type="button"
											onClick={() => setSelectedTab(p.providerId)}
											className={`rounded-full px-3 py-1 text-xs transition-all flex items-center gap-1.5 ${
												isSel
													? "font-semibold shadow-xs"
													: "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
											}`}
											style={
												isSel
													? {
															backgroundColor: p.brand.color,
															color: "#ffffff",
														}
													: undefined
											}
										>
											<span
												className="h-2 w-2 rounded-full shrink-0"
												style={{ backgroundColor: p.brand.color }}
											/>
											<span>{p.brand.name.split(" ")[0]}</span>
											<span className="text-[10px] opacity-80">
												({p.reports.length + p.unmetered.length})
											</span>
										</button>
									);
								})}
							</div>
						)}

						{/* Provider Cards List with Distinct Boundaries and Brand Themes */}
						<div className="space-y-4">
							{visibleProviders.map((p) => {
								const totalAccounts = p.reports.length + p.unmetered.length;
								const isOpen =
									expanded[p.providerId] ?? (totalAccounts === 1 || false);

								return (
									<div
										key={p.providerId}
										className={`rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden transition-all duration-200 ${p.brand.borderLClass} border-l-4`}
									>
										{/* Provider Card Header */}
										<div
											className={`flex flex-wrap items-center justify-between gap-3 p-4 ${p.brand.headerBgClass}`}
										>
											<div className="flex items-center gap-3 min-w-0">
												{/* Brand Icon Box */}
												<div
													className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 shadow-xs"
													style={{
														backgroundColor: `${p.brand.color}15`,
														color: p.brand.color,
													}}
												>
													<ProviderBrandLogo
														iconType={p.brand.iconType}
														color={p.brand.color}
														className="h-5 w-5"
													/>
												</div>

												{/* Provider Name and Badges */}
												<div className="min-w-0">
													<div className="flex items-center gap-2">
														<span className="font-bold text-sm text-neutral-900 dark:text-neutral-100">
															{p.brand.name}
														</span>
														<span
															className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${p.brand.badgeClass}`}
														>
															{p.brand.badge}
														</span>
													</div>
													<div className="text-[11px] text-neutral-500 mt-0.5">
														{totalAccounts} 个已授权账号
													</div>
												</div>
											</div>

											{/* Right Side Actions & Badges */}
											<div className="flex items-center gap-2.5 shrink-0">
												{p.totalCredits > 0 && (
													<span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-300 font-semibold flex items-center gap-1 shadow-xs">
														<Sparkles className="h-3 w-3" />✦ {p.totalCredits}{" "}
														次重置券
													</span>
												)}

												<button
													type="button"
													onClick={() => toggleExpanded(p.providerId)}
													className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
													style={{ color: p.brand.color }}
												>
													<span>
														{isOpen
															? "收起账号"
															: `展开账号 (${totalAccounts})`}
													</span>
													{isOpen ? (
														<ChevronUp className="h-3.5 w-3.5" />
													) : (
														<ChevronDown className="h-3.5 w-3.5" />
													)}
												</button>
											</div>
										</div>

										{/* Primary Glanceable Quota Progress Bars */}
										<div className="p-4 space-y-3 bg-white dark:bg-neutral-900/40">
											{p.primaryLimits.length === 0 ? (
												<div className="text-xs text-neutral-500 py-1">
													已连接账号，暂无特定时间窗口限额
												</div>
											) : (
												p.primaryLimits.map((lim, idx) => {
													const barColor =
														lim.usedPct >= 85
															? "#f43f5e"
															: p.brand.progressColor;

													return (
														<div
															key={`${lim.label}-${idx}`}
															className="space-y-1.5"
														>
															<div className="flex items-center justify-between text-xs">
																<div className="flex items-center gap-1.5">
																	<span className="font-semibold text-neutral-900 dark:text-neutral-200">
																		{lim.label}
																	</span>
																</div>
																<div className="font-mono text-xs flex items-center gap-2">
																	<span
																		className="font-bold"
																		style={{ color: barColor }}
																	>
																		{lim.usedPct.toFixed(1)}% 已用
																	</span>
																	<span className="text-neutral-500 dark:text-neutral-400 text-[11px]">
																		· {lim.remainingText}
																	</span>
																</div>
															</div>

															{/* Sleek Tactile Progress Track */}
															<div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/50 dark:border-neutral-700/50">
																<div
																	className="h-full transition-all duration-300 rounded-full"
																	style={{
																		width: `${Math.max(2, lim.usedPct)}%`,
																		backgroundColor: barColor,
																	}}
																/>
															</div>

															{/* Reset Countdown Info */}
															<div className="flex items-center justify-between text-[11px] text-neutral-500 pt-0.5">
																<span className="flex items-center gap-1.5 font-medium">
																	<Timer className="h-3 w-3 text-neutral-400 shrink-0" />
																	<span>{lim.countdown}</span>
																</span>
																<span className="text-[10px] text-neutral-400">
																	动态滚动窗口
																</span>
															</div>
														</div>
													);
												})
											)}
										</div>

										{/* Collapsible Account Breakdown */}
										{isOpen && (
											<div className="border-t border-neutral-200 dark:border-neutral-800 p-4 space-y-2.5 bg-neutral-50/70 dark:bg-neutral-950/40">
												<div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 mb-1 flex items-center justify-between">
													<span>已绑定账号明细</span>
													<span className="text-[11px] text-neutral-500 font-normal">
														共 {totalAccounts} 个账号
													</span>
												</div>

												<div className="space-y-2">
													{p.reports.map((report, rIdx) => {
														const meta = report.metadata;
														const email = meta?.email;
														const accountId = meta?.accountId;
														const orgName = meta?.orgName;
														const planType = meta?.planType;
														const uniqueLimits = dedupeLimits(
															report.limits ?? [],
														);
														const resetCredits = report.resetCredits;
														const overage = meta?.overageBalanceUsd;

														return (
															<div
																key={`${email || accountId || rIdx}`}
																className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 text-xs space-y-2 shadow-2xs"
															>
																{/* Account Row Header */}
																<div className="flex flex-wrap items-center justify-between gap-2">
																	<div className="flex items-center gap-2 min-w-0">
																		<span className="truncate font-semibold text-neutral-900 dark:text-neutral-200">
																			{email || accountId || "主账号"}
																		</span>
																		{planType && (
																			<span className="rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.2 text-[9px] font-semibold border border-emerald-500/20">
																				{planType}
																			</span>
																		)}
																		{orgName && (
																			<span className="text-[11px] text-neutral-500 truncate max-w-[200px]">
																				· {orgName}
																			</span>
																		)}
																	</div>

																	<div className="flex items-center gap-2 text-[10px] text-neutral-500">
																		{resetCredits &&
																			resetCredits.availableCount > 0 && (
																				<span className="text-amber-600 dark:text-amber-400 font-semibold">
																					✦ {resetCredits.availableCount}{" "}
																					次重置券
																				</span>
																			)}
																		{overage != null && (
																			<span className="text-neutral-600 dark:text-neutral-400">
																				超额: ${overage.toFixed(2)}
																			</span>
																		)}
																		<span className="flex items-center gap-1 font-mono">
																			<Clock className="h-2.5 w-2.5" />
																			{formatRelativeTime(
																				report.fetchedAt,
																				now,
																			)}
																		</span>
																	</div>
																</div>

																{/* Account Limits Chips / Bars */}
																{uniqueLimits.length > 0 && (
																	<div className="grid gap-2 sm:grid-cols-2 pt-1 border-t border-neutral-100 dark:border-neutral-800">
																		{uniqueLimits.map((lim) => {
																			const isPercent =
																				lim.amount.unit === "percent";
																			const usedPct = isPercent
																				? lim.amount.used ??
																					(lim.amount.usedFraction != null
																						? lim.amount.usedFraction * 100
																						: 0)
																				: lim.amount.limit
																					? ((lim.amount.used ?? 0) /
																							lim.amount.limit) *
																						100
																					: 0;

																			const barColor =
																				usedPct >= 85
																					? "#f43f5e"
																					: p.brand.progressColor;

																			return (
																				<div
																					key={lim.id}
																					className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2 space-y-1 border border-neutral-100 dark:border-neutral-700/50"
																				>
																					<div className="flex items-center justify-between text-[11px]">
																						<span className="text-neutral-700 dark:text-neutral-300 font-medium truncate max-w-[140px]">
																							{lim.label}
																						</span>
																						<span
																							className="font-mono font-semibold"
																							style={{ color: barColor }}
																						>
																							{usedPct.toFixed(1)}%
																						</span>
																					</div>
																					<div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
																						<div
																							className="h-full rounded-full"
																							style={{
																								width: `${Math.max(2, usedPct)}%`,
																								backgroundColor: barColor,
																							}}
																						/>
																					</div>
																					<div className="flex items-center justify-between text-[10px] text-neutral-500">
																						<span>
																							{lim.window?.resetsAt
																								? formatCountdown(
																										lim.window.resetsAt - now,
																									)
																								: "滚动"}
																						</span>
																						{lim.window?.label && (
																							<span className="text-neutral-400">
																								{lim.window.label}
																							</span>
																						)}
																					</div>
																				</div>
																			);
																		})}
																	</div>
																)}
															</div>
														);
													})}

													{/* Unmetered connected accounts */}
													{p.unmetered.map((u, uIdx) => (
														<div
															key={`unmetered-${u.enterpriseUrl || uIdx}`}
															className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-800 p-2.5 text-xs flex items-center justify-between text-neutral-500 bg-white dark:bg-neutral-900"
														>
															<span className="truncate font-medium text-neutral-600 dark:text-neutral-400">
																{u.enterpriseUrl || `${p.brand.name} 关联账号`}
															</span>
															<span className="text-[11px] text-neutral-500 flex items-center gap-1 shrink-0">
																<CheckCircle2 className="h-3 w-3 text-neutral-400" />
																已连接 · 暂无独立配额窗口
															</span>
														</div>
													))}
												</div>
											</div>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</SettingsCard>
	);
}
