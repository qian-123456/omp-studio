import clsx from "clsx";
import type { ComponentType, ReactNode } from "react";

export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	spin,
}: {
	icon?: ComponentType<{ className?: string }>;
	title: ReactNode;
	description?: ReactNode;
	action?: ReactNode;
	/** Spin the icon (loading states). */
	spin?: boolean;
}) {
	return (
		<div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
			{Icon && <Icon className={clsx("mb-1 h-6 w-6 text-[var(--text-dim)]", spin && "animate-spin")} />}
			<div className="text-[13px] font-medium text-[var(--text)]">{title}</div>
			{description && <div className="max-w-sm text-xs leading-[18px] text-[var(--text-muted)]">{description}</div>}
			{action && <div className="mt-2">{action}</div>}
		</div>
	);
}
