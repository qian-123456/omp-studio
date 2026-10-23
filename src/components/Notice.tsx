import clsx from "clsx";
import { AlertTriangle, Check, Info } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const NOTICE_TONE: Record<NoticeTone, { box: string; icon: string; Icon: ComponentType<{ className?: string }> }> = {
	info: {
		box: "border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]",
		icon: "text-[var(--accent)]",
		Icon: Info,
	},
	success: {
		box: "border-[color-mix(in_srgb,var(--status-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--status-success)_8%,transparent)]",
		icon: "text-[var(--status-success)]",
		Icon: Check,
	},
	warning: {
		box: "border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_9%,transparent)]",
		icon: "text-[var(--status-warning)]",
		Icon: AlertTriangle,
	},
	danger: {
		box: "border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_9%,transparent)]",
		icon: "text-[var(--status-error)]",
		Icon: AlertTriangle,
	},
};

/** Inline callout. `action` renders on the right (usually a small Button). */
export function Notice({
	tone,
	title,
	children,
	action,
}: {
	tone: NoticeTone;
	title?: ReactNode;
	children?: ReactNode;
	action?: ReactNode;
}) {
	const t = NOTICE_TONE[tone];
	return (
		<div
			role={tone === "danger" || tone === "warning" ? "alert" : "status"}
			className={clsx("flex items-start gap-2.5 rounded-lg border px-3 py-2.5", t.box)}
		>
			<t.Icon className={clsx("mt-0.5 h-3.5 w-3.5 shrink-0", t.icon)} />
			<div className="min-w-0 flex-1">
				{title && <div className="text-[13px] font-medium leading-5 text-[var(--text)]">{title}</div>}
				{children && (
					<div className="text-xs leading-[18px] text-[var(--text-muted)]">{children}</div>
				)}
			</div>
			{action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
		</div>
	);
}
