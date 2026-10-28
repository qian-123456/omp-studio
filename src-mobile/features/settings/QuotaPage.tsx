import { Gauge, RefreshCw, UserRound, WifiOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { Button, Chip, EmptyState, IconButton, PageHeader, PullToRefresh, Spinner } from "../../ui";
import {
	computePercentage,
	formatCountdown,
	formatRelativeTime,
	formatWindowLabel,
	normalizeQuotaData,
	type QuotaAccount,
	type QuotaLimit,
	type QuotaProvider,
	type QuotaResponse,
} from "./quotaTypes";

/** Whole percent, except near 0/100 where the rounding would hide "almost empty/full". */
const pct = (n: number): string => ((n > 0 && n < 1) || (n > 99 && n < 100) ? n.toFixed(1) : String(Math.round(n)));

function LimitBar({ limit, now }: { limit: QuotaLimit; now: number }) {
	const { usedPct, remainingPct } = computePercentage(limit.used, limit.total, limit.unit);
	const countdown = formatCountdown(limit.resetAt, now);
	const exhausted = usedPct >= 99.5;
	const fill = exhausted ? "bg-m-danger" : usedPct >= 80 ? "bg-m-warn" : "bg-m-accent";
	return (
		<div data-testid={`limit-${limit.name}`}>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
				<span className="text-m-md whitespace-nowrap text-m-text">{formatWindowLabel(limit.name)}</span>
				<span className="text-m-xs whitespace-nowrap text-m-text-2 tabular-nums">
					已用 {pct(usedPct)}% · 剩余 {pct(remainingPct)}%
				</span>
			</div>
			<div
				role="progressbar"
				aria-label={formatWindowLabel(limit.name)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(usedPct)}
				className="mt-2 h-2 w-full overflow-hidden rounded-m-pill bg-m-surface-2"
			>
				<div className={`h-full rounded-m-pill transition-[width] duration-(--m-dur) ease-m ${fill}`} style={{ width: `${usedPct}%` }} />
			</div>
			{(countdown || limit.unit !== "percent") && (
				<div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-m-xs text-m-text-3">
					{countdown && <span className={exhausted ? "text-m-danger" : undefined}>{countdown}</span>}
					{limit.unit !== "percent" && (
						<span className="tabular-nums">
							{limit.used} / {limit.total}
							{limit.unit ? ` ${limit.unit}` : ""}
						</span>
					)}
				</div>
			)}
		</div>
	);
}

function AccountBlock({ account, index, many, now }: { account: QuotaAccount; index: number; many: boolean; now: number }) {
	const showLine = account.email || account.plan || many;
	return (
		<div className="flex flex-col gap-4">
			{showLine && (
				<div className="flex items-start gap-2.5">
					<UserRound size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-m-text-3" />
					<span className="m-selectable min-w-0 flex-1 text-m-sm break-all text-m-text-2">{account.email || `账号 ${index + 1}`}</span>
					{account.plan && <Chip>{account.plan}</Chip>}
				</div>
			)}
			{account.limits.length === 0 ? (
				<p className="text-m-sm text-m-text-3">这个账号没有报告限额数据</p>
			) : (
				account.limits.map((lim, i) => <LimitBar key={`${lim.name}-${i}`} limit={lim} now={now} />)
			)}
		</div>
	);
}

function ProviderCard({ provider, now }: { provider: QuotaProvider; now: number }) {
	return (
		<section className="mx-4 rounded-m-lg bg-m-card px-5 py-5 shadow-m-card" data-testid={`provider-card-${provider.id}`}>
			<header className="mb-4">
				<h2 className="text-m-lg font-medium break-words text-m-text">{provider.name}</h2>
				{provider.badge && <div className="mt-0.5 text-m-xs text-m-text-3">{provider.badge}</div>}
			</header>
			{provider.accounts.length === 0 ? (
				<p className="text-m-sm text-m-text-3">暂无账号信息</p>
			) : (
				<div className="flex flex-col gap-5">
					{provider.accounts.map((acct, idx) => (
						<div key={acct.id || idx} className={idx > 0 ? "border-t border-m-border pt-5" : undefined}>
							<AccountBlock account={acct} index={idx} many={provider.accounts.length > 1} now={now} />
						</div>
					))}
				</div>
			)}
		</section>
	);
}

export function QuotaPage() {
	const [data, setData] = useState<QuotaResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());

	// Keep countdowns current.
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 10_000);
		return () => clearInterval(t);
	}, []);

	const load = useCallback(async (refresh: boolean) => {
		if (refresh) setRefreshing(true);
		else setLoading(true);
		setError(null);
		try {
			const res = await api<unknown>("GET", refresh ? "/quota?refresh=true" : "/quota");
			setData(normalizeQuotaData(res));
			setNow(Date.now());
		} catch (e) {
			setError(errorMessage(e, "获取用量配额失败"));
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void load(false);
	}, [load]);

	const accounts = data?.providers.reduce((sum, p) => sum + p.accounts.length, 0) ?? 0;
	const summary = data && data.providers.length > 0 ? `${accounts} 个账号 · ${formatRelativeTime(data.updatedAt, now)}` : undefined;

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg-elev text-m-text">
			<PageHeader
				title="订阅与配额"
				subtitle={summary}
				large
				className="bg-m-bg-elev"
				right={
					<IconButton
						variant="filled"
						icon={<RefreshCw size={20} strokeWidth={1.75} className={refreshing ? "animate-spin" : undefined} />}
						label="刷新配额"
						disabled={loading || refreshing}
						onClick={() => void load(true)}
					/>
				}
			/>

			<PullToRefresh onRefresh={() => load(true)} className="m-noscrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div className="flex flex-col gap-3 pt-1 pb-[calc(var(--m-safe-bottom)+24px)]">
					{loading && !data && (
						<div className="flex justify-center py-20">
							<Spinner />
						</div>
					)}

					{error && !data && (
						<EmptyState
							icon={<WifiOff size={24} strokeWidth={1.75} />}
							title="加载失败"
							hint={<span className="m-selectable">{error}</span>}
							action={
								<Button variant="tonal" onClick={() => void load(false)}>
									重试
								</Button>
							}
						/>
					)}
					{error && data && (
						<div role="alert" className="mx-4 rounded-m-lg bg-m-danger-bg px-4 py-3 text-m-sm break-words text-m-danger">
							<span className="m-selectable">刷新失败：{error}</span>
						</div>
					)}

					{data && data.providers.length === 0 && !loading && (
						<EmptyState
							icon={<Gauge size={24} strokeWidth={1.75} />}
							title="暂无订阅或配额"
							hint="没有找到已登录的订阅账号。在电脑上用 omp login 登录后，这里会自动显示配额。"
						/>
					)}

					{data?.providers.map((p) => <ProviderCard key={p.id} provider={p} now={now} />)}
				</div>
			</PullToRefresh>
		</div>
	);
}
