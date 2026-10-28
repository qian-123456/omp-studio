import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { ReactNode, Ref } from "react";
import { Spinner } from "./Spinner";

export const PULL_THRESHOLD = 64;
const PULL_MAX = 140;
const PULL_HOLD = 48;

/** Rubber-band resistance: ~1:1 at the start, saturating towards PULL_MAX. Reaches the threshold at dy ≈ 118. */
export function pullDistance(dy: number): number {
	if (!(dy > 0)) return 0;
	return (PULL_MAX * dy) / (dy + PULL_MAX);
}

export function PullToRefresh({
	onRefresh,
	disabled = false,
	children,
	className = "",
	ref,
}: {
	onRefresh: () => Promise<unknown> | void;
	disabled?: boolean;
	children: ReactNode;
	className?: string;
	ref?: Ref<HTMLDivElement>;
}) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const indicatorRef = useRef<HTMLDivElement>(null);
	const arrowRef = useRef<HTMLSpanElement>(null);
	const spinnerRef = useRef<HTMLSpanElement>(null);
	const statusRef = useRef<HTMLSpanElement>(null);
	const onRefreshRef = useRef(onRefresh);
	onRefreshRef.current = onRefresh;

	const setRefs = useCallback(
		(node: HTMLDivElement | null) => {
			scrollRef.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		},
		[ref],
	);

	useEffect(() => {
		const scroller = scrollRef.current;
		const body = bodyRef.current;
		const indicator = indicatorRef.current;
		const arrow = arrowRef.current;
		const spinner = spinnerRef.current;
		if (!scroller || !body || !indicator || !arrow || !spinner) return;
		const status = statusRef.current;
		const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		let startX = 0;

		let startY = 0;
		let armed = false;
		let pulling = false;
		let refreshing = false;
		let dist = 0;
		let alive = true;
		let hideTimer: number | undefined;

		const paint = (d: number, animate: boolean) => {
			dist = d;
			const t = animate && !reducedMotion ? "transform 220ms var(--m-ease)" : "none";
			body.style.transition = t;
			indicator.style.transition = reducedMotion ? "none" : `${t}, opacity 220ms`;
			body.style.transform = d > 0 ? `translate3d(0,${d}px,0)` : "";
			indicator.style.transform = `translate3d(0,${d - 40}px,0)`;
			indicator.style.opacity = d > 0 ? "1" : "0";
			const ready = d >= PULL_THRESHOLD;
			arrow.style.transform = `rotate(${ready ? 180 : 0}deg)`;
			if (status && !refreshing) status.textContent = d > 0 ? (ready ? "松开刷新" : "下拉刷新") : "";
		};
		const showSpinner = (on: boolean) => {
			spinner.style.display = on ? "inline-flex" : "none";
			arrow.style.display = on ? "none" : "inline-flex";
		};

		const onStart = (e: TouchEvent) => {
			armed = !disabled && !refreshing && scroller.scrollTop <= 0 && e.touches.length === 1;
			if (!armed && !refreshing) paint(0, true);
			pulling = false;
			if (armed) {
				startY = e.touches[0]?.clientY ?? 0;
				startX = e.touches[0]?.clientX ?? 0;
			}
		};
		const onMove = (e: TouchEvent) => {
			if (!armed) return;
			if (e.touches.length !== 1 || Math.abs((e.touches[0]?.clientX ?? startX) - startX) > Math.abs((e.touches[0]?.clientY ?? startY) - startY)) {
				armed = false;
				paint(0, true);
				return;
			}
			const y = e.touches[0]?.clientY ?? startY;
			const dy = y - startY;
			if (dy <= 0) {
				if (pulling) paint(0, false);
				pulling = false;
				return;
			}
			pulling = true;
			if (e.cancelable) e.preventDefault();
			paint(pullDistance(dy), false);
		};
		const onEnd = () => {
			if (!armed) return;
			armed = false;
			if (!pulling) return;
			pulling = false;
			if (dist < PULL_THRESHOLD) {
				paint(0, true);
				return;
			}
			refreshing = true;
			scroller.setAttribute("aria-busy", "true");
			if (status) status.textContent = "正在刷新";
			showSpinner(true);
			paint(PULL_HOLD, true);
			const finish = () => {
				refreshing = false;
				if (!alive) return;
				scroller.removeAttribute("aria-busy");
				paint(0, true);
				window.clearTimeout(hideTimer);
				hideTimer = window.setTimeout(() => {
					if (alive && !refreshing) showSpinner(false);
				}, 240);
			};
			Promise.resolve()
				.then(() => onRefreshRef.current())
				.then(finish, finish);
		};
		const onCancel = () => {
			armed = false;
			pulling = false;
			if (!refreshing) paint(0, true);
		};

		scroller.addEventListener("touchstart", onStart, { passive: true });
		// Must be non-passive so the native overscroll can be cancelled while pulling; the handler bails out immediately otherwise.
		scroller.addEventListener("touchmove", onMove, { passive: false });
		scroller.addEventListener("touchend", onEnd, { passive: true });
		scroller.addEventListener("touchcancel", onCancel, { passive: true });
		return () => {
			alive = false;
			window.clearTimeout(hideTimer);
			scroller.removeEventListener("touchstart", onStart);
			scroller.removeEventListener("touchmove", onMove);
			scroller.removeEventListener("touchend", onEnd);
			scroller.removeEventListener("touchcancel", onCancel);
			scroller.removeAttribute("aria-busy");
			if (status) status.textContent = "";
			paint(0, false);
			showSpinner(false);
		};
	}, [disabled]);

	return (
		<div ref={setRefs} className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${className}`}>
			<span ref={statusRef} role="status" className="sr-only" />
			<div
				ref={indicatorRef}
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 flex h-10 items-center justify-center opacity-0"
				style={{ transform: "translate3d(0,-40px,0)" }}
			>
				<span className="flex size-9 items-center justify-center rounded-m-pill bg-m-surface text-m-text-2 shadow-m-pop">
					<span ref={arrowRef} className="inline-flex transition-transform duration-(--m-dur-fast) ease-m">
						<ArrowDown size={18} strokeWidth={1.75} />
					</span>
					<span ref={spinnerRef} className="hidden">
						<Spinner size={18} />
					</span>
				</span>
			</div>
			<div ref={bodyRef} className="min-h-full">
				{children}
			</div>
		</div>
	);
}
