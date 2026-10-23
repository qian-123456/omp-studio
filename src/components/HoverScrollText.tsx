import clsx from "clsx";
import React, { useCallback, useLayoutEffect, useRef, useState } from "react";

// Superset WorkspaceNameMarquee constants for human-readable, comfortable pace
const PIXELS_PER_SECOND = 32;
const MIN_SCROLL_DURATION_S = 0.5;
const MAX_SCROLL_DURATION_S = 6;
const SCROLL_START_DELAY_S = 0.35;
const RESET_DURATION_S = 0.2;
const OVERFLOW_EPSILON_PX = 1.5;
const EDGE_FADE_PX = 14;

export interface HoverScrollTextProps extends React.HTMLAttributes<HTMLSpanElement> {
	/** Text content to display and scroll when overflowing. */
	text: string;
	/** Optional prefix displayed dimmed before text (e.g. "project/"). */
	prefix?: string;
	/** Pixels scrolled per second during hover animation. Default 32 px/s (Superset standard). */
	speed?: number;
	/** Delay in seconds before scrolling starts on hover. Default 0.35s. */
	delaySeconds?: number;
	/** Custom class applied to outer clipping container. */
	className?: string;
	/** Custom class applied to inner scrolling text span. */
	innerClassName?: string;
	/** Optional explicit tooltip text; defaults to `text`. */
	title?: string;
	/** Extra end padding (px) to prevent trailing content from being covered by floating action buttons. */
	extraEndPadding?: number;
	/** Force active scrolling (e.g. driven by row focus). */
	forceActive?: boolean;
}

/**
 * Superset-standard single-line text marquee:
 * - At rest: trimmed with a subtle 14px gradient fade at the trailing edge (no abrupt cut-off).
 * - On hover (350ms delay): smoothly scrolls horizontally at a constant 32 px/s linear pace.
 * - On mouse leave: smoothly resets to the start in 0.2s.
 * - Auto-adapts via ResizeObserver when sidebar width changes.
 */
export function HoverScrollText({
	text,
	prefix,
	speed = PIXELS_PER_SECOND,
	delaySeconds = SCROLL_START_DELAY_S,
	className,
	innerClassName,
	title,
	extraEndPadding = 0,
	forceActive = false,
	onMouseEnter,
	onMouseLeave,
	...rest
}: HoverScrollTextProps) {
	const containerRef = useRef<HTMLSpanElement>(null);
	const textRef = useRef<HTMLSpanElement>(null);
	const [overflow, setOverflow] = useState(0);
	const [hovered, setHovered] = useState(false);

	const fullText = prefix ? `${prefix}/${text}` : text;

	const measureOverflow = useCallback(() => {
		const container = containerRef.current;
		const textEl = textRef.current;
		if (!container || !textEl) return;
		const availableWidth = container.clientWidth - extraEndPadding;
		const diff = textEl.scrollWidth - availableWidth;
		setOverflow(diff > OVERFLOW_EPSILON_PX ? diff : 0);
	}, []);

	useLayoutEffect(() => {
		if (!fullText) return;
		measureOverflow();
		const container = containerRef.current;
		if (!container || typeof ResizeObserver === "undefined") return;

		const observer = new ResizeObserver(measureOverflow);
		observer.observe(container);
		return () => observer.disconnect();
	}, [fullText, measureOverflow]);

	const active = (hovered || forceActive) && overflow > 0;
	const canScroll = overflow > 0;
	const scrollDurationS = Math.min(
		MAX_SCROLL_DURATION_S,
		Math.max(MIN_SCROLL_DURATION_S, overflow / speed),
	);

	return (
		<span
			ref={containerRef}
			title={title === "" ? undefined : (title ?? fullText)}
			onMouseEnter={(e) => {
				measureOverflow();
				setHovered(true);
				onMouseEnter?.(e);
			}}
			onMouseLeave={(e) => {
				setHovered(false);
				onMouseLeave?.(e);
			}}
			className={clsx("block overflow-hidden whitespace-nowrap select-none", className)}
			style={{
				maskImage:
					!active && canScroll
						? `linear-gradient(to right, black calc(100% - ${extraEndPadding + EDGE_FADE_PX}px), transparent calc(100% - ${extraEndPadding}px))`
						: undefined,
				WebkitMaskImage:
					!active && canScroll
						? `linear-gradient(to right, black calc(100% - ${extraEndPadding + EDGE_FADE_PX}px), transparent calc(100% - ${extraEndPadding}px))`
						: undefined,
			}}
			{...rest}
		>
			<span
				ref={textRef}
				className={clsx("inline-block whitespace-nowrap will-change-transform", innerClassName)}
				style={{
					transform: active ? `translateX(-${overflow}px)` : undefined,
					transition: canScroll
						? active
							? `transform ${scrollDurationS}s linear ${delaySeconds}s`
							: `transform ${RESET_DURATION_S}s ease`
						: undefined,
				}}
			>
				{prefix && <span className="opacity-60">{`${prefix}/`}</span>}
				{text}
			</span>
		</span>
	);
}
