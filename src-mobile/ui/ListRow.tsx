import type { ReactNode } from "react";

export function ListRow({
	icon,
	title,
	subtitle,
	right,
	onClick,
	danger = false,
	className = "",
}: {
	icon?: ReactNode;
	title: ReactNode;
	subtitle?: ReactNode;
	right?: ReactNode;
	onClick?: () => void;
	danger?: boolean;
	className?: string;
}) {
	const cls = `flex min-h-14 w-full items-center gap-3 border-b border-m-border px-4 py-2 text-left ${
		danger ? "text-m-danger" : "text-m-text"
	} ${onClick ? "active:bg-m-surface-hover" : ""} ${className}`;
	const inner = (
		<>
			{icon != null && <span className="flex shrink-0 items-center text-m-text-2">{icon}</span>}
			<span className="min-w-0 flex-1">
				<span className="block truncate text-m-md">{title}</span>
				{subtitle != null && <span className="block truncate text-m-xs text-m-text-3">{subtitle}</span>}
			</span>
			{right != null && <span className="shrink-0 whitespace-nowrap text-m-sm text-m-text-3">{right}</span>}
		</>
	);
	if (onClick) {
		return (
			<button type="button" onClick={onClick} className={cls}>
				{inner}
			</button>
		);
	}
	return <div className={cls}>{inner}</div>;
}
