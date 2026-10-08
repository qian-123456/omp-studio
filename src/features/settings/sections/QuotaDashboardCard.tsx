/**
 * Settings ▸ 模型与供应商 ▸ 订阅与配额:
 * Provider quota and Coding Plans synced via `omp usage --json`.
 * Single-account providers render flat limit bars; multi-account providers show
 * pooled capacity and open `QuotaAccountSheet` for per-account detail.
 */
import { AlertCircle, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	OmpUsageCapacityWindow,
	OmpUsageLimit,
	OmpUsageReportData,
} from "../../../lib/contracts";
import { ompUsageReport } from "../../../lib/ipc";
import { SettingsCard } from "../ui";
import {
	type AccountSheetProvider,
	LimitBar,
	QuotaAccountSheet,
	QuotaBar,
} from "./QuotaAccountSheet";
import { ProviderBrandLogo } from "./ProviderBrandLogo";
import {
	dedupeLimits,
	findWindowResetsAt,
	formatCountdownCompact,
	formatHumanWindowName,
	formatRelativeTime,
	resolveBrandConfig,
} from "./quotaHelpers";

interface ProviderGroup extends AccountSheetProvider {
	totalAccounts: number;
	totalCredits: number;
	allLimits: OmpUsageLimit[];
	capacity: OmpUsageCapacityWindow[];
}

export function QuotaDashboardCard() {
	const [data, setData] = useState<OmpUsageReportData | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const [sheetProvider, setSheetProvider] = useState<ProviderGroup | null>(null);

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

	const { providers, stats } = useMemo(() => {
		const map = new Map<string, ProviderGroup>();
		const group = (providerId: string): ProviderGroup => {
			let g = map.get(providerId);
			if (!g) {
				g = {
					providerId,
					brand: resolveBrandConfig(providerId),
					reports: [],
					unmetered: [],
					totalAccounts: 0,
					totalCredits: 0,
					allLimits: [],
					capacity: data?.capacity?.[providerId] ?? [],
				};
				map.set(providerId, g);
			}
			return g;
		};
		for (const r of data?.reports ?? []) {
			const g = group(r.provider);
			g.reports.push(r);
			g.allLimits.push(...(r.limits ?? []));
			g.totalCredits += r.resetCredits?.availableCount ?? 0;
		}
		for (const u of data?.accountsWithoutUsage ?? []) group(u.provider).unmetered.push(u);

		const list = Array.from(map.values());
		let totalAccounts = 0;
		for (const g of list) {
			g.totalAccounts = g.reports.length + g.unmetered.length;
			totalAccounts += g.totalAccounts;
		}
		return {
			providers: list,
			stats: { totalProviders: list.length, totalAccounts },
		};
	}, [data]);

	return (
		<SettingsCard fieldId="quotaDashboard">
			<div className="space-y-4 p-4">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<div className="text-sm font-semibold text-neutral-100">配额与用量概览</div>
						<div className="mt-0.5 text-[11px] text-neutral-400">
							{stats.totalProviders} 个供应商 · {stats.totalAccounts} 个已授权账号
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						{data && (
							<span className="text-[11px] text-neutral-500">
								{formatRelativeTime(data.generatedAt, now)}
							</span>
						)}
						<button
							type="button"
							disabled={loading || refreshing}
							onClick={() => void fetchReport(true)}
							className="flex items-center gap-1.5 rounded-md border border-[var(--border-divider)] bg-[var(--well-bg)] px-2.5 py-1 text-xs text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-100 disabled:opacity-50"
						>
							<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
							{refreshing ? "刷新中…" : "刷新"}
						</button>
					</div>
				</div>

				{loading ? (
					<div className="flex flex-col items-center justify-center gap-2.5 py-12 text-xs text-neutral-400">
						<RefreshCw className="h-5 w-5 animate-spin text-[var(--accent)]" />
						<span>正在从 OMP 获取官方订阅与额度快照…</span>
					</div>
				) : error ? (
					<div className="space-y-2 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-4 text-xs">
						<div className="flex items-center gap-2 font-medium text-rose-300">
							<AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
							<span>无法获取 OMP 配额快照</span>
						</div>
						<div className="text-[11px] text-neutral-400">{error}</div>
						<button
							type="button"
							className="text-[11px] font-medium text-[var(--accent)] hover:opacity-80"
							onClick={() => void fetchReport(true)}
						>
							重试
						</button>
					</div>
				) : providers.length === 0 ? (
					<div className="space-y-2.5 py-10 text-center text-xs text-neutral-400">
						<div className="text-sm font-semibold text-neutral-100">
							暂无已激活的官方订阅或 Coding Plan
						</div>
						<div className="mx-auto max-w-md text-[11px] leading-relaxed">
							可在终端执行{" "}
							<code className="rounded border border-[var(--border-divider)] bg-[var(--well-bg)] px-1.5 py-0.5 font-mono text-neutral-200">
								omp login
							</code>{" "}
							登录账号，登录后即可在此实时查看官方配额与重置时间。
						</div>
						<div className="text-[10px] text-neutral-500">
							普通 API Key 按量计费，可在「接口与密钥」中配置。
						</div>
					</div>
				) : (
					<div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
						{providers.map((p) => (
							<ProviderQuotaCard
								key={p.providerId}
								p={p}
								now={now}
								onOpen={() => setSheetProvider(p)}
							/>
						))}
					</div>
				)}
			</div>
			<QuotaAccountSheet
				isOpen={sheetProvider !== null}
				onClose={() => setSheetProvider(null)}
				provider={sheetProvider}
				now={now}
			/>
		</SettingsCard>
	);
}

function ProviderQuotaCard({
	p,
	now,
	onOpen,
}: {
	p: ProviderGroup;
	now: number;
	onOpen: () => void;
}) {
	const multi = p.totalAccounts > 1;
	const single = p.reports[0];
	const subtitle = multi
		? `${p.totalAccounts} 个已授权账号`
		: single
			? [single.metadata?.email || single.metadata?.accountId, single.metadata?.orgName]
					.filter(Boolean)
					.join(" · ") || "已授权账号"
			: p.unmetered[0]?.enterpriseUrl || "已连接账号";
	const shortName = p.brand.name.split(" ").pop() ?? p.brand.name;

	const body = multi ? (
		p.capacity.length > 0 ? (
			p.capacity.map((cap) => {
				const usedPct =
					cap.accounts > 0 ? Math.min(100, (cap.usedAccounts / cap.accounts) * 100) : 0;
				const resetsAt = findWindowResetsAt(p.allLimits, cap.window);
				const countdown =
					resetsAt && resetsAt > now ? formatCountdownCompact(resetsAt - now) : "持续滚动";
				const tone = usedPct >= 100 ? "rose" : usedPct >= 80 ? "amber" : "neutral";
				return (
					<QuotaBar
						key={cap.window}
						label={`${shortName} ${formatHumanWindowName(cap.window)}`}
						usedPct={usedPct}
						statusText={`余 ${cap.remainingAccounts.toFixed(2)}× 账号配额 · ${countdown}`}
						tone={tone}
						brandColor={p.brand.progressColor}
					/>
				);
			})
		) : (
			<div className="text-xs text-neutral-500">暂无共享池容量汇总，查看明细了解各账号配额</div>
		)
	) : single && (single.limits ?? []).length > 0 ? (
		dedupeLimits(single.limits).map((lim) => (
			<LimitBar key={lim.id} lim={lim} now={now} brandColor={p.brand.progressColor} />
		))
	) : (
		<div className="text-xs text-neutral-500">已连接 · 暂无时间窗口限额</div>
	);

	return (
		<div
			className={`flex flex-col justify-between space-y-3 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-4 shadow-xs ${
				multi ? "cursor-pointer transition-colors hover:border-[var(--border)]" : ""
			}`}
			onClick={multi ? onOpen : undefined}
			onKeyDown={
				multi
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onOpen();
							}
						}
					: undefined
			}
			role={multi ? "button" : undefined}
			tabIndex={multi ? 0 : undefined}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)]">
						<ProviderBrandLogo
							providerId={p.providerId}
							iconType={p.brand.iconType}
							color={p.brand.color}
							className="h-4.5 w-4.5"
						/>
					</div>
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<span className="truncate text-sm font-semibold text-neutral-100">
								{p.brand.name}
							</span>
							<span
								className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${p.brand.badgeClass}`}
							>
								{p.brand.badge}
							</span>
						</div>
						<div className="mt-0.5 truncate text-[11px] text-neutral-400">{subtitle}</div>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{p.totalCredits > 0 && (
						<span className="rounded-full border border-amber-500/25 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
							✦ {p.totalCredits} 次重置券
						</span>
					)}
					{multi && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onOpen();
							}}
							className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-100"
						>
							查看明细
							<ChevronRight className="h-3 w-3" />
						</button>
					)}
				</div>
			</div>

			<div className="space-y-2.5">{body}</div>

			{multi && (
				<div className="border-t border-[var(--border-divider)] pt-2.5 text-[10px] text-neutral-500">
					共 {p.totalAccounts} 个账号共享池 · 点击卡片查看各账号详情
				</div>
			)}
		</div>
	);
}
