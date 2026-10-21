/**
 * Settings ▸ 模型与供应商 ▸ 订阅与配额:
 * Provider quota and Coding Plans synced via `omp usage --json`.
 * Single-account providers render flat limit bars; multi-account providers show
 * pooled capacity and open `QuotaAccountSheet` for per-account detail.
 */
import { ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	OmpUsageCapacityWindow,
	OmpUsageLimit,
	OmpUsageReportData,
} from "../../../lib/contracts";
import { ompUsageReport } from "../../../lib/ipc";
import { Button, Chip, EmptyState, Notice } from "../ui";
import {
	type AccountSheetProvider,
	QuotaAccountSheet,
	QuotaBar,
} from "./QuotaAccountSheet";
import { ProviderBrandLogo } from "./ProviderBrandLogo";
import {
	findWindowResetsAt,
	formatAccountSubtitle,
	formatHumanWindowName,
	formatLimitStatus,
	formatRelativeTime,
	resolveBrandConfig,
} from "./quotaHelpers";
import { buildQuotaRows } from "./quotaRows";

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
	const [sheetProviderId, setSheetProviderId] = useState<string | null>(null);

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

	// Resolve live so the open sheet reflects refreshed data.
	const sheetProvider = useMemo(
		() => providers.find((p) => p.providerId === sheetProviderId) ?? null,
		[providers, sheetProviderId],
	);

	return (
		<div className="space-y-3" data-field-id="quotaDashboard">
			<div className="flex items-center justify-between gap-3 px-1">
				<div className="min-w-0">
					<h3 className="text-[13px] font-semibold text-[var(--text)]">配额与用量概览</h3>
					<p className="mt-0.5 text-xs text-[var(--text-muted)]">
						{stats.totalProviders} 个供应商 · {stats.totalAccounts} 个已授权账号
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{data && (
						<span className="text-xs text-[var(--text-dim)]">{formatRelativeTime(data.generatedAt, now)}</span>
					)}
					<Button
						size="sm"
						icon={RefreshCw}
						loading={loading || refreshing}
						disabled={loading || refreshing}
						onClick={() => void fetchReport(true)}
					>
						{refreshing ? "刷新中" : "刷新"}
					</Button>
				</div>
			</div>

			{loading ? (
				<EmptyState icon={RefreshCw} spin title="正在获取官方订阅与额度快照" description="数据来自 omp，通常几秒内完成" />
			) : error ? (
				<Notice
					tone="danger"
					title="无法获取 omp 配额快照"
					action={
						<Button size="sm" onClick={() => void fetchReport(true)}>
							重试
						</Button>
					}
				>
					<span className="break-words">{error}</span>
				</Notice>
			) : providers.length === 0 ? (
				<EmptyState
					title="暂无已激活的官方订阅或 Coding Plan"
					description={
						<>
							可在终端执行 <code className="rounded border border-[var(--border-divider)] bg-[var(--well-bg)] px-1.5 py-0.5 font-mono text-[var(--text)]">omp login</code>{" "}
							登录账号，登录后即可在此实时查看官方配额与重置时间。普通 API 密钥按量计费，可在「接口与密钥」中配置。
						</>
					}
				/>
			) : (
				<div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2">
					{providers.map((p) => (
						<ProviderQuotaCard
							key={p.providerId}
							p={p}
							now={now}
							onOpen={() => setSheetProviderId(p.providerId)}
						/>
					))}
				</div>
			)}
			<QuotaAccountSheet
				isOpen={sheetProvider !== null}
				onClose={() => setSheetProviderId(null)}
				provider={sheetProvider}
				now={now}
				refreshing={refreshing}
				onRefresh={() => fetchReport(true)}
			/>
		</div>
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
			? formatAccountSubtitle(
					single.metadata?.email || single.metadata?.accountId,
					single.metadata?.orgName,
				) || "已授权账号"
			: p.unmetered[0]?.enterpriseUrl || "已连接账号";
	const shortName = p.brand.name.split(" ").pop() ?? p.brand.name;
	const rows = buildQuotaRows(p.reports, now);
	const overage = p.reports
		.map((r) => r.metadata?.overageBalanceUsd)
		.filter((v): v is number => typeof v === "number");
	const overageTotal = overage.reduce((s, v) => s + v, 0);

	const body =
		rows.length > 0 ? (
			rows.map((row) => (
				<QuotaBar
					key={row.key}
					label={row.label}
					usedPct={row.usedPct}
					statusText={row.statusText}
					caption={row.caption}
					title={row.title}
					tone={row.tone}
					brandColor={p.brand.progressColor}
				/>
			))
		) : p.capacity.length > 0 ? (
			p.capacity.map((cap) => {
				const usedPct =
					cap.accounts > 0 ? Math.min(100, (cap.usedAccounts / cap.accounts) * 100) : 0;
				const resetsAt = findWindowResetsAt(p.allLimits, cap.window);
				const status = formatLimitStatus(usedPct, resetsAt, now);
				return (
					<QuotaBar
						key={cap.window}
						label={`${shortName} ${formatHumanWindowName(cap.window)}`}
						usedPct={usedPct}
						statusText={status.usedText}
						caption={status.resetText ?? "持续滚动"}
						title="按账号汇总（数据来自 OMP）：已用比例 = 已用账号配额 / 账号总数"
						tone={status.color}
						brandColor={p.brand.progressColor}
					/>
				);
			})
		) : (
			<div className="text-xs text-[var(--text-dim)]">已连接，暂无时间窗口限额</div>
		);

	const footnotes = [
		p.reports.length > 0 && p.unmetered.length > 0
			? `${p.unmetered.length} 个账号暂无用量数据`
			: null,
		overage.length > 0
			? `超额余额 ${overageTotal < 0 ? "-" : ""}$${Math.abs(overageTotal).toFixed(2)}`
			: null,
		multi ? `共 ${p.totalAccounts} 个账号` : null,
	].filter(Boolean);

	return (
		<div className="flex h-full flex-col gap-3 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-4">
			<div className="space-y-2">
				<div className="flex items-center justify-between gap-3">
					<div className="flex min-w-0 flex-1 items-center gap-2.5">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-divider)] bg-[var(--bg-panel)]">
							<ProviderBrandLogo
								providerId={p.providerId}
								iconType={p.brand.iconType}
								color={p.brand.color}
								className="h-4.5 w-4.5"
							/>
						</div>
						<span className="min-w-0 break-words text-sm font-semibold text-[var(--text)]">
							{p.brand.name}
						</span>
					</div>
					<Button size="sm" className="shrink-0 whitespace-nowrap" onClick={onOpen}>
						查看明细
						<ChevronRight className="h-3.5 w-3.5" />
					</Button>
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<span
						className={`max-w-full break-words rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${p.brand.badgeClass}`}
					>
						{p.brand.badge}
					</span>
					{p.totalCredits > 0 && <Chip tone="accent">{p.totalCredits} 次重置券</Chip>}
				</div>
				<div className="w-full break-all text-xs text-[var(--text-muted)]" title={subtitle}>
					{subtitle}
				</div>
			</div>

			<div className="flex-1 space-y-2.5">{body}</div>

			{footnotes.length > 0 && (
				<div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-[var(--border-divider)] pt-2.5">
					{footnotes.map((f) => (
						<Chip key={f as string}>{f}</Chip>
					))}
				</div>
			)}
		</div>
	);
}
