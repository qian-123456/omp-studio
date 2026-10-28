import type { ReactNode } from "react";

/** Centred empty/zero state: icon disc, title, grey hint, optional action (usually a `Button`). */
export function EmptyState({
	icon,
	title,
	hint,
	action,
	className = "",
}: {
	icon?: ReactNode;
	title: string;
	hint?: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div className={`flex flex-1 flex-col items-center justify-center gap-2 px-8 py-12 text-center ${className}`}>
			{icon != null && <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-m-pill bg-m-surface text-m-text-2">{icon}</div>}
			<div className="text-m-md font-semibold text-m-text">{title}</div>
			{hint != null && <div className="max-w-xs text-m-sm break-words text-m-text-3">{hint}</div>}
			{action != null && <div className="mt-4">{action}</div>}
		</div>
	);
}
