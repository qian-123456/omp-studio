/**
 * Slide-over sheet listing every bound account of a multi-account quota provider.
 */
import { CheckCircle2, Clock, LogIn, LogOut, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type {
	OmpUsageAccountWithoutUsage,
	OmpUsageLimit,
	OmpUsageProviderReport,
} from "../../../lib/contracts";
import { useEscapeKey } from "../../../lib/hooks";
import { oauthLoginProviders, oauthLogout } from "../../../lib/ipc";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { toast } from "../../../lib/toast";
import { OauthLoginDialog } from "../../providers/OauthLoginDialog";
import { Button, Chip, IconButton } from "../ui";
import { ProviderBrandLogo } from "./ProviderBrandLogo";
import {
	type ProviderBrandConfig,
	dedupeLimits,
	formatLimitStatus,
	formatRelativeTime,
	localizeQuotaLabel,
} from "./quotaHelpers";

export interface AccountSheetProvider {
	providerId: string;
	brand: ProviderBrandConfig;
	reports: OmpUsageProviderReport[];
	unmetered: OmpUsageAccountWithoutUsage[];
}

export interface QuotaAccountSheetProps {
	isOpen: boolean;
	onClose: () => void;
	provider: AccountSheetProvider | null;
	now: number;
	refreshing: boolean;
	/** Last quota fetch failure; shown so a failed 刷新用量 is not silent. */
	error?: string | null;
	/** Re-fetches the usage report (same call as the dashboard header 刷新). */
	onRefresh: () => Promise<void> | void;
}

/** Used percentage (0–100) of a single limit, for percent and absolute units. */
export function limitUsedPct(lim: OmpUsageLimit): number {
	const a = lim.amount;
	const pct =
		a.unit === "percent"
			? (a.used ?? (a.usedFraction != null ? a.usedFraction * 100 : 0))
			: a.usedFraction != null
				? a.usedFraction * 100
				: a.limit
					? ((a.used ?? 0) / a.limit) * 100
					: 0;
	return Math.min(100, Math.max(0, pct));
}

const STATUS_TEXT_CLASS = {
	rose: "text-[var(--status-error)] font-semibold",
	amber: "text-[var(--status-warning)] font-semibold",
	neutral: "text-[var(--text-muted)]",
} as const;

/** Label + status row with a 4px capsule track. */
export function QuotaBar({
	label,
	usedPct,
	statusText,
	caption,
	tone,
	brandColor,
	title,
}: {
	label: string;
	usedPct: number;
	/** Short right-aligned value, e.g. "已用 49.0%". */
	statusText: string;
	/** Muted line under the bar (reset countdown, pool remainder). */
	caption?: string | null;
	tone: "rose" | "amber" | "neutral";
	brandColor: string;
	title?: string;
}) {
	const fill =
		tone === "rose" ? "var(--status-error)" : tone === "amber" ? "var(--status-warning)" : brandColor;
	return (
		<div className="space-y-1.5" title={title}>
			<div className="flex items-baseline justify-between gap-3 text-xs">
				<span className="min-w-0 break-words font-medium text-[var(--text)]">{label}</span>
				<span
					className={`shrink-0 whitespace-nowrap font-mono text-[11px] ${STATUS_TEXT_CLASS[tone]}`}
				>
					{statusText}
				</span>
			</div>
			<div className="h-1 w-full overflow-hidden rounded-full bg-[var(--bg-hover)]">
				<div
					className="h-full rounded-full transition-all duration-300"
					style={{ width: `${Math.max(1.5, usedPct)}%`, backgroundColor: fill }}
				/>
			</div>
			{caption ? (
				<div className="text-right text-[11px] text-[var(--text-dim)]">{caption}</div>
			) : null}
		</div>
	);
}

export function LimitBar({
	lim,
	now,
	brandColor,
}: {
	lim: OmpUsageLimit;
	now: number;
	brandColor: string;
}) {
	const usedPct = limitUsedPct(lim);
	const status = formatLimitStatus(usedPct, lim.window?.resetsAt ?? null, now);
	const title = `已用 ${usedPct.toFixed(1)}%，剩余 ${(100 - usedPct).toFixed(1)}%${
		status.resetText ? `；${status.resetText}` : ""
	}`;
	return (
		<QuotaBar
			label={localizeQuotaLabel(lim.label)}
			usedPct={usedPct}
			statusText={status.usedText}
			caption={status.resetText}
			tone={status.color}
			brandColor={brandColor}
			title={title}
		/>
	);
}

export function QuotaAccountSheet({
	isOpen,
	onClose,
	provider,
	now,
	refreshing,
	error,
	onRefresh,
}: QuotaAccountSheetProps) {
	const [loginOpen, setLoginOpen] = useState(false);
	const [oauthIds, setOauthIds] = useState<Set<string>>(new Set());
	const [loggingOutKey, setLoggingOutKey] = useState<string | null>(null);

	const childOpen = loginOpen;
	useEscapeKey(onClose, isOpen && !childOpen);

	useEffect(() => {
		if (!isOpen) return;
		let cancelled = false;
		oauthLoginProviders()
			.then((list) => {
				if (!cancelled) setOauthIds(new Set(list.filter((p) => p.available).map((p) => p.id)));
			})
			.catch(() => {
				if (!cancelled) setOauthIds(new Set());
			});
		return () => {
			cancelled = true;
		};
	}, [isOpen]);

	if (!isOpen || !provider) return null;

	const { brand } = provider;
	const totalAccounts = provider.reports.length + provider.unmetered.length;
	const latestFetchedAt = provider.reports.reduce<number | null>(
		(acc, r) => (acc == null || r.fetchedAt > acc ? r.fetchedAt : acc),
		null,
	);
	const canRelogin = oauthIds.has(provider.providerId);
	const handleLogout = async (
		accountKey: string,
		label: string,
		email?: string | null,
		accountId?: string | null,
	) => {
		if (loggingOutKey) return;
		const ok = await confirmDialog(
			`确定退出账号「${label}」？\n退出后该账号的授权凭据将从本地清除，需重新登录才能使用。`,
			{ title: "退出登录", danger: true, okLabel: "退出登录" },
		);
		if (!ok) return;
		setLoggingOutKey(accountKey);
		try {
			await oauthLogout(provider.providerId, email, accountId);
			toast.success(`已退出账号 ${label}`);
			if (totalAccounts <= 1) onClose();
			await onRefresh();
		} catch (err) {
			toast.error(errMsg(err));
		} finally {
			setLoggingOutKey(null);
		}
	};

	if (loginOpen) {
		return (
			<OauthLoginDialog
				initialProviderId={provider.providerId}
				onClose={() => {
					setLoginOpen(false);
					void onRefresh();
				}}
			/>
		);
	}

	return createPortal(
		<div
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/50 p-6 backdrop-blur-xs"
			onClick={onClose}
			role="presentation"
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`${brand.name} 账号明细`}
				className="animate-in fade-in zoom-in-95 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border-divider)] bg-[var(--bg-panel)] shadow-2xl duration-200"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between gap-3 border-b border-[var(--border-divider)] px-4 py-3.5">
					<div className="flex min-w-0 items-center gap-3">
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)]">
							<ProviderBrandLogo
								providerId={provider.providerId}
								iconType={brand.iconType}
								color={brand.color}
								className="h-4.5 w-4.5"
							/>
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<span className="truncate text-sm font-semibold text-[var(--text)]">
									{brand.name}
								</span>
								<span
									className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${brand.badgeClass}`}
								>
									{brand.badge}
								</span>
							</div>
							<div className="mt-0.5 text-xs text-[var(--text-muted)]">
								{totalAccounts} 个已绑定账号明细
							</div>
						</div>
					</div>
					<IconButton icon={X} label="关闭" onClick={onClose} />
				</div>

				<div className="flex-1 space-y-2.5 overflow-y-auto p-4">
					{provider.reports.map((report, idx) => {
						const meta = report.metadata;
						const limits = dedupeLimits(report.limits ?? []);
						const credits = report.resetCredits?.availableCount ?? 0;
						const accountKey = meta?.email || meta?.accountId || `report-${idx}`;
						const label = meta?.email || meta?.accountId || "主账号";
						return (
							<div
								key={accountKey}
								className="space-y-2.5 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-3.5"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<span
												className="break-all text-xs font-semibold text-[var(--text)]"
												title={meta?.email || meta?.accountId || undefined}
											>
												{label}
											</span>
											{meta?.planType && <Chip>{meta.planType}</Chip>}
										</div>
										{meta?.orgName && (
											<div className="mt-0.5 break-words text-xs text-[var(--text-dim)]">
												{meta.orgName}
											</div>
										)}
									</div>
									<div className="flex shrink-0 items-center gap-2.5">
										<div className="flex flex-col items-end gap-0.5 text-[11px] text-[var(--text-dim)]">
											<span className="flex items-center gap-1 font-mono">
												<Clock className="h-2.5 w-2.5" />
												{formatRelativeTime(report.fetchedAt, now)}
											</span>
											{credits > 0 && (
												<span className="font-semibold text-[var(--accent)]">
													{credits} 次重置券
												</span>
											)}
											{meta?.overageBalanceUsd != null && (
												<span className="text-[var(--text-muted)]">
													超额余额 ${meta.overageBalanceUsd.toFixed(2)}
												</span>
											)}
										</div>
										<Button
											variant="danger"
											size="sm"
											icon={LogOut}
											className="whitespace-nowrap"
											loading={loggingOutKey === accountKey}
											disabled={loggingOutKey !== null}
											onClick={() =>
												void handleLogout(
													accountKey,
													label,
													meta?.email,
													meta?.accountId,
												)
											}
										>
											退出登录
										</Button>
									</div>
								</div>
								{limits.length > 0 ? (
									<div className="space-y-2.5">
										{limits.map((lim) => (
											<LimitBar
												key={lim.id}
												lim={lim}
												now={now}
												brandColor={brand.progressColor}
											/>
										))}
									</div>
								) : (
									<div className="text-xs text-[var(--text-dim)]">暂无时间窗口限额</div>
								)}
							</div>
						);
					})}

					{provider.unmetered.map((u, idx) => {
						const accountKey = `unmetered-${u.enterpriseUrl || idx}`;
						const label = u.enterpriseUrl || `${brand.name} 关联账号`;
						return (
							<div
								key={accountKey}
								className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--border-divider)] bg-[var(--well-bg)] p-3.5 text-xs"
							>
								<span className="min-w-0 break-all font-medium text-[var(--text)]" title={u.enterpriseUrl}>
									{label}
								</span>
								<span className="flex shrink-0 items-center gap-2 text-xs text-[var(--text-dim)]">
									<span className="flex items-center gap-1 whitespace-nowrap">
										<CheckCircle2 className="h-3 w-3" />
										已连接 · 无独立配额
									</span>
									<Button
										variant="danger"
										size="sm"
										icon={LogOut}
										className="whitespace-nowrap"
										loading={loggingOutKey === accountKey}
										disabled={loggingOutKey !== null}
										onClick={() => void handleLogout(accountKey, label, null, null)}
									>
										退出登录
									</Button>
								</span>
							</div>
						);
					})}
				</div>

				<div className="space-y-2 border-t border-[var(--border-divider)] px-4 py-3">
					{error ? (
						<pre className="w-full select-text whitespace-pre-wrap break-words rounded-md border border-[var(--status-error)] p-2 text-xs text-[var(--status-error)]">
							刷新用量失败：{error}
						</pre>
					) : null}
					<div className="flex items-center gap-1 text-xs text-[var(--text-dim)]">
						<Clock className="h-3 w-3" />
						{latestFetchedAt != null
							? `用量更新于 ${formatRelativeTime(latestFetchedAt, now)}`
							: "暂无用量数据"}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="primary"
							size="sm"
							icon={RefreshCw}
							loading={refreshing}
							disabled={refreshing}
							onClick={() => void onRefresh()}
						>
							{refreshing ? "刷新中" : "刷新用量"}
						</Button>
						{canRelogin && (
							<Button
								size="sm"
								icon={totalAccounts > 0 ? Plus : LogIn}
								className="whitespace-nowrap"
								onClick={() => setLoginOpen(true)}
							>
								{totalAccounts > 0 ? "添加账号" : "登录账号"}
							</Button>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
