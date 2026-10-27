import type { ReactNode } from "react";

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
			{icon != null && <div className="mb-1 text-m-text-3">{icon}</div>}
			<div className="text-m-lg font-medium text-m-text">{title}</div>
			{hint != null && <div className="text-m-sm text-m-text-3">{hint}</div>}
			{action != null && <div className="mt-3">{action}</div>}
		</div>
	);
}
