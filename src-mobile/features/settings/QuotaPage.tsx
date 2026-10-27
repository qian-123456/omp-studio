import { ChevronLeft, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, useCanGoBack } from "../../core/nav";
import { EmptyState, PullToRefresh, Spinner } from "../../ui";
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

function LimitBar({
	limit,
	now,
	accentColor,
}: {
	limit: QuotaLimit;
	now: number;
	accentColor: string;
}) {
	const { usedPct, remainingPct } = computePercentage(limit.used, limit.total, limit.unit);
	const countdown = formatCountdown(limit.resetAt, now);
	const isExhausted = usedPct >= 99.5;
	const isWarning = usedPct >= 80 && !isExhausted;

	const barColor = isExhausted ? "var(--m-danger, #ff6b64)" : isWarning ? "var(--m-warn, #ffb74d)" : accentColor;

	return (
		<div className="space-y-1.5" data-testid={`limit-${limit.name}`}>
			<div className="flex items-center justify-between text-m-xs">
				<span className="font-medium text-m-text">{formatWindowLabel(limit.name)}</span>
				<span className="font-m-mono text-m-text-2">
					已用 {usedPct.toFixed(usedPct % 1 === 0 ? 0 : 1)}% · 剩余 {remainingPct.toFixed(remainingPct % 1 === 0 ? 0 : 1)}%
				</span>
			</div>
			{/* Progress track */}
			<div className="h-1.5 w-full overflow-hidden rounded-full bg-m-surface-2">
				<div
					className="h-full rounded-full transition-all duration-300"
					style={{
						width: `${usedPct}%`,
						backgroundColor: barColor,
					}}
				/>
			</div>
			<div className="flex items-center justify-between text-[11px] text-m-text-3">
				<span>{limit.unit === "percent" ? "" : `总量: ${limit.total}`}</span>
				{countdown ? (
					<span className={isExhausted ? "font-medium text-m-danger" : "text-m-text-3"}>{countdown}</span>
				) : (
					<span className="text-m-success">正常</span>
				)}
			</div>
		</div>
	);
}

function AccountSection({
	account,
	index,
	total,
	now,
	accentColor,
}: {
	account: QuotaAccount;
	index: number;
	total: number;
	now: number;
	accentColor: string;
}) {
	return (
		<div className={total > 1 ? "rounded-m-md border border-m-border bg-m-surface/40 p-3 space-y-3" : "space-y-3"}>
			{(account.email || account.plan || total > 1) && (
				<div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-m-border/60 pb-2 text-m-xs">
					<div className="flex items-center gap-1.5 font-medium text-m-text-2">
						{account.email ? (
							<span className="truncate max-w-[200px]" title={account.email}>
								{account.email}
							</span>
						) : (
							<span>账号 #{index + 1}</span>
						)}
					</div>
					{account.plan && (
						<span className="rounded-m-pill bg-m-surface-2 px-2 py-0.5 text-[11px] text-m-text-3">
							{account.plan}
						</span>
					)}
				</div>
			)}
			<div className="space-y-2.5">
				{account.limits.length === 0 ? (
					<p className="text-m-xs text-m-text-3">未报告具体限额数据</p>
				) : (
					account.limits.map((lim, i) => (
						<LimitBar key={`${lim.name}-${i}`} limit={lim} now={now} accentColor={accentColor} />
					))
				)}
			</div>
		</div>
	);
}

function ProviderCard({
	provider,
	now,
}: {
	provider: QuotaProvider;
	now: number;
}) {
	return (
		<div
			className="rounded-m-lg border border-m-border bg-m-bg-elev p-4 shadow-m-card space-y-3.5 transition-all"
			data-testid={`provider-card-${provider.id}`}
		>
			{/* Provider Header */}
			<div className="flex items-center justify-between gap-2 border-b border-m-border pb-3">
				<div className="flex min-w-0 items-center gap-2.5">
					<span
						className="h-3 w-3 shrink-0 rounded-full"
						style={{ backgroundColor: provider.color || "var(--m-accent)" }}
					/>
					<h3 className="truncate text-m-md font-semibold text-m-text">{provider.name}</h3>
				</div>
				{provider.badge && (
					<span
						className="shrink-0 rounded-m-pill px-2.5 py-0.5 text-m-xs font-medium"
						style={{
							backgroundColor: `${provider.color}15`,
							color: provider.color,
							border: `1px solid ${provider.color}35`,
						}}
					>
						{provider.badge}
					</span>
				)}
			</div>

			{/* Accounts */}
			<div className="space-y-3">
				{provider.accounts.length === 0 ? (
					<p className="py-2 text-m-xs text-m-text-3">暂无账号信息</p>
				) : (
					provider.accounts.map((acct, idx) => (
						<AccountSection
							key={acct.id || idx}
							account={acct}
							index={idx}
							total={provider.accounts.length}
							now={now}
							accentColor={provider.color || "var(--m-accent)"}
						/>
					))
				)}
			</div>
		</div>
	);
}

export function QuotaPage() {
	const canGoBack = useCanGoBack();
	const [data, setData] = useState<QuotaResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());

	// Keep now updated every 10s for countdowns
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 10_000);
		return () => clearInterval(t);
	}, []);

	const load = useCallback(async (isRefresh = false) => {
		if (isRefresh) {
			setRefreshing(true);
		} else {
			setLoading(true);
		}
		setError(null);
		try {
			const res = await api<unknown>("GET", isRefresh ? "/quota?refresh=true" : "/quota");
			setData(normalizeQuotaData(res));
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

	const totalAccounts = data?.providers.reduce((sum, p) => sum + p.accounts.length, 0) ?? 0;

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			{/* Top Header */}
			<header className="flex min-h-12 items-center justify-between border-b border-m-border px-4 py-2 pt-[calc(var(--m-safe-top)+8px)]">
				<div className="flex items-center gap-2">
					{canGoBack && (
						<button
							type="button"
							aria-label="返回"
							onClick={() => nav.back()}
							className="flex h-10 w-10 items-center justify-center rounded-m-md text-m-text-2 active:bg-m-surface-hover"
						>
							<ChevronLeft size={22} />
						</button>
					)}
					<h1 className="text-m-lg font-semibold text-m-text">订阅与配额</h1>
				</div>
				<button
					type="button"
					aria-label="刷新配额"
					disabled={loading || refreshing}
					onClick={() => void load(true)}
					className="flex h-10 w-10 items-center justify-center rounded-m-md text-m-text-2 active:bg-m-surface-hover disabled:opacity-50"
				>
					<RefreshCw size={18} className={refreshing ? "animate-spin text-m-accent" : ""} />
				</button>
			</header>

			{/* Sub-header status */}
			{data && !error && (
				<div className="flex items-center justify-between border-b border-m-border/60 bg-m-surface/50 px-4 py-2 text-m-xs text-m-text-3">
					<span>
						共 {data.providers.length} 个供应商 · {totalAccounts} 个账号
					</span>
					<span>{formatRelativeTime(data.updatedAt, now)}</span>
				</div>
			)}

			{/* Main Content */}
			<PullToRefresh onRefresh={() => load(true)} className="min-h-0 flex-1 overflow-y-auto">
				<div className="space-y-4 p-4 pb-[calc(var(--m-safe-bottom)+24px)]">
					{loading && !data && (
						<div className="flex justify-center py-20">
							<Spinner />
						</div>
					)}

					{error && !data && (
						<EmptyState
							title="加载失败"
							hint={error}
							action={
								<button
									type="button"
									onClick={() => void load(false)}
									className="min-h-11 rounded-m-md border border-m-border bg-m-surface px-4 text-m-sm text-m-text"
								>
									重试
								</button>
							}
						/>
					)}

					{data && data.providers.length === 0 && !loading && (
						<EmptyState
							title="暂无订阅或配额"
							hint="未检测到已登录的提供商账号。在电脑上使用 omp login 登录账号后，配额将自动同步至此。"
						/>
					)}

					{data && data.providers.map((p) => <ProviderCard key={p.id} provider={p} now={now} />)}
				</div>
			</PullToRefresh>
		</div>
	);
}
