import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { nav } from "../core/nav";
import { IconButton } from "./IconButton";

const goBack = (): void => nav.back();

/**
 * Bare top bar of the home and chat screens (docs/MOBILE_DESIGN.md §4.1): left slot, flexible
 * centre, right slot, on the page background without a border.
 */
export function TopBar({ left, center, right, className = "" }: { left?: ReactNode; center?: ReactNode; right?: ReactNode; className?: string }) {
	return (
		<header className={`relative z-(--z-header) shrink-0 text-m-text ${className}`} style={{ paddingTop: "var(--m-safe-top)" }}>
			<div className="flex h-14 items-center gap-1 px-2">
				{left}
				<div className="flex min-w-0 flex-1 items-center">{center}</div>
				{right != null && <div className="flex shrink-0 items-center gap-1">{right}</div>}
			</div>
		</header>
	);
}

/**
 * Header of pushed sub-pages: filled circle back button, centred title, right slot.
 * `large` puts the title as a 28px heading under the bar (Gemini settings style).
 */
export function PageHeader({
	title,
	subtitle,
	onBack,
	left,
	right,
	children,
	large = false,
	className = "",
}: {
	title: ReactNode;
	subtitle?: ReactNode;
	onBack?: (() => void) | false;
	left?: ReactNode;
	right?: ReactNode;
	children?: ReactNode;
	large?: boolean;
	className?: string;
}) {
	const back = onBack === undefined ? goBack : onBack;
	const leftNode =
		left != null ? left : back !== false ? <IconButton variant="filled" icon={<ChevronLeft size={22} />} label="返回" onClick={back} /> : null;
	return (
		<header
			className={`sticky top-0 z-(--z-header) shrink-0 bg-m-bg text-m-text ${className}`}
			style={{ paddingTop: "var(--m-safe-top)" }}
		>
			<div className="relative flex h-14 items-center gap-1 px-2">
				<div className="flex min-w-11 shrink-0 items-center">{leftNode}</div>
				<div className="min-w-0 flex-1 px-1 text-center">
					{!large && (
						<>
							<div className="text-m-md leading-tight font-semibold break-words">{title}</div>
							{subtitle != null && <div className="text-m-xs leading-tight break-words text-m-text-3">{subtitle}</div>}
						</>
					)}
				</div>
				<div className="flex min-w-11 shrink-0 items-center justify-end gap-1">{right}</div>
			</div>
			{large && (
				<div className="px-5 pt-1 pb-3">
					<h1 className="text-m-title font-medium break-words">{title}</h1>
					{subtitle != null && <div className="mt-1 text-m-sm break-words text-m-text-3">{subtitle}</div>}
				</div>
			)}
			{children}
		</header>
	);
}
