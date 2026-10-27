import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { nav } from "../core/nav";

export function HeaderButton({
	icon,
	label,
	onClick,
	disabled,
}: {
	icon: ReactNode;
	label: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			disabled={disabled}
			onClick={onClick}
			className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-m-pill text-m-text active:bg-m-surface-hover disabled:opacity-40"
		>
			{icon}
		</button>
	);
}

const goBack = (): void => nav.back();

export function PageHeader({
	title,
	subtitle,
	onBack,
	right,
	children,
	className = "",
}: {
	title: ReactNode;
	subtitle?: ReactNode;
	onBack?: (() => void) | false;
	right?: ReactNode;
	children?: ReactNode;
	className?: string;
}) {
	const back = onBack === undefined ? goBack : onBack;
	return (
		<header
			className={`sticky top-0 shrink-0 border-b border-m-border bg-m-bg text-m-text ${className}`}
			style={{ paddingTop: "var(--m-safe-top)" }}
		>
			<div className="flex h-13 items-center gap-1 px-1">
				{back !== false ? (
					<HeaderButton icon={<ChevronLeft size={24} />} label="返回" onClick={back} />
				) : (
					<div className="w-3 shrink-0" />
				)}
				<div className="min-w-0 flex-1">
					<div className="truncate text-m-lg font-semibold leading-tight">{title}</div>
					{subtitle != null && <div className="truncate text-m-xs leading-tight text-m-text-3">{subtitle}</div>}
				</div>
				{right != null && <div className="flex shrink-0 items-center">{right}</div>}
			</div>
			{children}
		</header>
	);
}
