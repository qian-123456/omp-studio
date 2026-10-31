import { ChevronLeft } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
 * Titles stay on one line with their full text available to assistive technology. The hairline
 * follows the page's scroll container; `scrolled` can override it for custom scrolling layouts.
 */
export function PageHeader({
	title,
	subtitle,
	onBack,
	left,
	right,
	children,
	large = false,
	scrolled,
	className = "",
}: {
	title: ReactNode;
	subtitle?: ReactNode;
	onBack?: (() => void) | false;
	left?: ReactNode;
	right?: ReactNode;
	children?: ReactNode;
	large?: boolean;
	scrolled?: boolean;
	className?: string;
}) {
	const headerRef = useRef<HTMLElement>(null);
	const barRef = useRef<HTMLDivElement>(null);
	const leftRef = useRef<HTMLDivElement>(null);
	const rightRef = useRef<HTMLDivElement>(null);
	const [autoScrolled, setAutoScrolled] = useState(false);

	useLayoutEffect(() => {
		const bar = barRef.current;
		const leftSlot = leftRef.current;
		const rightSlot = rightRef.current;
		if (!bar || !leftSlot || !rightSlot) return;
		const measure = () => bar.style.setProperty("--m-header-side", `${Math.max(leftSlot.offsetWidth, rightSlot.offsetWidth)}px`);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(leftSlot);
		observer.observe(rightSlot);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (scrolled !== undefined) return;
		const header = headerRef.current;
		const page = header?.parentElement;
		if (!header || !page) return;
		const selector = ".overflow-y-auto, .overflow-auto";
		let scroller = page.matches(selector) ? page : page.querySelector<HTMLElement>(selector);
		const update = (event?: Event) => {
			if (!scroller?.isConnected) scroller = page.matches(selector) ? page : page.querySelector<HTMLElement>(selector);
			if (!scroller || header.contains(scroller) || (event && event.target !== scroller)) return;
			setAutoScrolled(scroller.scrollTop > 0);
		};
		update();
		page.addEventListener("scroll", update, { capture: true, passive: true });
		return () => page.removeEventListener("scroll", update, true);
	}, [scrolled]);

	const back = onBack === undefined ? goBack : onBack;
	const leftNode =
		left != null ? left : back !== false ? <IconButton variant="filled" icon={<ChevronLeft size={22} />} label="返回" onClick={back} /> : null;
	return (
		<header
			ref={headerRef}
			className={`sticky top-0 z-(--z-header) shrink-0 bg-m-bg text-m-text after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-m-border ${
				scrolled ?? autoScrolled ? "after:opacity-100" : "after:opacity-0"
			} ${className}`}
			style={{ paddingTop: "var(--m-safe-top)" }}
		>
			<div ref={barRef} className="relative flex h-14 items-center justify-between gap-1 px-2">
				<div ref={leftRef} className="flex min-w-11 shrink-0 items-center">{leftNode}</div>
				<div className="absolute min-w-0 text-center" style={{ insetInline: "calc(var(--m-header-side, 44px) + 12px)" }}>
					{!large && (
						<>
							<div
								className="truncate text-m-md leading-tight font-semibold"
								aria-label={typeof title === "string" ? title : undefined}
								title={typeof title === "string" ? title : undefined}
							>
								{title}
							</div>
							{subtitle != null && (
								<div
									className="truncate text-m-xs leading-tight text-m-text-3"
									title={typeof subtitle === "string" ? subtitle : undefined}
									aria-label={typeof subtitle === "string" ? subtitle : undefined}
								>
									{subtitle}
								</div>
							)}
						</>
					)}
				</div>
				<div ref={rightRef} className="flex min-w-11 shrink-0 items-center justify-end gap-1">{right}</div>
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
