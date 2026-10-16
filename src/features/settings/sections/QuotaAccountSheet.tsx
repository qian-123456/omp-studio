/**
 * Slide-over sheet listing every bound account of a multi-account quota provider.
 */
import { CheckCircle2, Clock, X } from "lucide-react";
import { createPortal } from "react-dom";
import type {
	OmpUsageAccountWithoutUsage,
	OmpUsageLimit,
	OmpUsageProviderReport,
} from "../../../lib/contracts";
import { useEscapeKey } from "../../../lib/hooks";
import { ProviderBrandLogo } from "./ProviderBrandLogo";
import {
	type ProviderBrandConfig,
	dedupeLimits,
	formatLimitStatus,
	formatRelativeTime,
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
	rose: "text-rose-400 font-semibold",
	amber: "text-amber-400 font-semibold",
	neutral: "text-neutral-400",
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
		tone === "rose" ? "#f43f5e" : tone === "amber" ? "#f59e0b" : brandColor;
	return (
		<div className="space-y-1.5" title={title}>
			<div className="flex items-baseline justify-between gap-3 text-xs">
				<span className="min-w-0 break-words font-medium text-neutral-200">{label}</span>
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
				<div className="text-right text-[10px] text-neutral-500">{caption}</div>
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
			label={lim.label}
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
}: QuotaAccountSheetProps) {
	useEscapeKey(onClose, isOpen);
	if (!isOpen || !provider) return null;

	const { brand } = provider;
	const totalAccounts = provider.reports.length + provider.unmetered.length;

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs"
			onClick={onClose}
			role="presentation"
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`${brand.name} 账号明细`}
				className="animate-in slide-in-from-right flex h-full w-full max-w-lg flex-col border-l border-[var(--border-divider)] bg-[var(--bg-panel)] shadow-2xl duration-200"
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
								<span className="truncate text-sm font-semibold text-neutral-100">
									{brand.name}
								</span>
								<span
									className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${brand.badgeClass}`}
								>
									{brand.badge}
								</span>
							</div>
							<div className="mt-0.5 text-[11px] text-neutral-400">
								{totalAccounts} 个已绑定账号明细
							</div>
						</div>
					</div>
					<button
						type="button"
						aria-label="关闭"
						onClick={onClose}
						className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-100"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="flex-1 space-y-2.5 overflow-y-auto p-4">
					{provider.reports.map((report, idx) => {
						const meta = report.metadata;
						const limits = dedupeLimits(report.limits ?? []);
						const credits = report.resetCredits?.availableCount ?? 0;
						return (
							<div
								key={meta?.email || meta?.accountId || idx}
								className="space-y-2.5 rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-3.5"
							>
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<span className="truncate text-xs font-semibold text-neutral-100">
												{meta?.email || meta?.accountId || "主账号"}
											</span>
											{meta?.planType && (
												<span className="shrink-0 rounded border border-[var(--border-divider)] px-1.5 text-[10px] text-neutral-300">
													{meta.planType}
												</span>
											)}
										</div>
										{meta?.orgName && (
											<div className="mt-0.5 truncate text-[11px] text-neutral-500">
												{meta.orgName}
											</div>
										)}
									</div>
									<div className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-neutral-500">
										<span className="flex items-center gap-1 font-mono">
											<Clock className="h-2.5 w-2.5" />
											{formatRelativeTime(report.fetchedAt, now)}
										</span>
										{credits > 0 && (
											<span className="font-semibold text-amber-400">
												✦ {credits} 次重置券
											</span>
										)}
										{meta?.overageBalanceUsd != null && (
											<span className="text-neutral-400">
												超额余额 ${meta.overageBalanceUsd.toFixed(2)}
											</span>
										)}
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
									<div className="text-[11px] text-neutral-500">暂无时间窗口限额</div>
								)}
							</div>
						);
					})}

					{provider.unmetered.map((u, idx) => (
						<div
							key={`unmetered-${u.enterpriseUrl || idx}`}
							className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-[var(--border-divider)] bg-[var(--well-bg)] p-3.5 text-xs"
						>
							<span className="truncate font-medium text-neutral-200">
								{u.enterpriseUrl || `${brand.name} 关联账号`}
							</span>
							<span className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-500">
								<CheckCircle2 className="h-3 w-3" />
								已连接 · 无独立配额
							</span>
						</div>
					))}
				</div>
			</div>
		</div>,
		document.body,
	);
}
