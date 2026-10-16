import clsx from "clsx";
import {
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * Global stacking scale. Every floating surface MUST use one of these tiers
 * (also exposed as CSS vars `--z-*` in index.css) instead of ad-hoc z-index.
 *
 * Floating surfaces are portaled to `document.body`, so they never get trapped
 * inside a `backdrop-filter` / `transform` ancestor (which turns `position:
 * fixed` into "fixed relative to that ancestor" and creates a stacking context
 * that sibling columns paint over).
 */
export const Z_LAYER = {
	drawer: 40,
	modal: 50,
	popover: 60,
	menu: 65,
	hovercard: 70,
	/** Full-screen image lightbox: must cover every popover/menu/hovercard that spawned it. */
	lightbox: 80,
	toast: 100,
} as const;
export type ZLayer = keyof typeof Z_LAYER;

export type Placement =
	| "bottom-start"
	| "bottom-end"
	| "top-start"
	| "top-end"
	| "right-start"
	| "left-start"
	| "center";

/** A DOM element, a measured rect, or a pointer position (context menus). */
export type Anchor = Element | DOMRect | { x: number; y: number };

const EDGE = 8;

/**
 * Usable viewport box: excludes the app status bar (`[data-app-bottombar]`),
 * so floating content never slides underneath it.
 */
export function usableViewport(): { top: number; bottom: number; left: number; right: number } {
	const bar = document.querySelector("[data-app-bottombar]");
	const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
	return {
		top: EDGE,
		left: EDGE,
		right: window.innerWidth - EDGE,
		bottom: Math.min(window.innerHeight, barTop) - EDGE,
	};
}

export function anchorRect(anchor: Anchor): DOMRect {
	if (anchor instanceof Element) return anchor.getBoundingClientRect();
	if ("x" in anchor && !("width" in anchor)) return new DOMRect(anchor.x, anchor.y, 0, 0);
	return anchor as DOMRect;
}

export interface FloatingPosition {
	left: number;
	top: number;
	/** Max height that still fits the usable viewport on the chosen side. */
	maxHeight: number;
	placement: Placement;
}

/**
 * Pure placement math (exported for tests). Flips to the opposite side when
 * the preferred side lacks room, then clamps inside the usable viewport.
 */
export function computePosition(
	a: DOMRect,
	size: { width: number; height: number },
	placement: Placement,
	offset: number,
	vp: { top: number; bottom: number; left: number; right: number },
): FloatingPosition {
	if (placement === "center") {
		const width = vp.right - vp.left;
		const height = Math.max(0, vp.bottom - vp.top);
		const maxHeight = height;
		const maxWidth = Math.max(0, width);
		return {
			left: vp.left + (maxWidth - Math.min(size.width, maxWidth)) / 2,
			top: vp.top + (height - Math.min(size.height, maxHeight)) / 2,
			maxHeight,
			placement,
		};
	}
	let p: Placement = placement;
	const [side, align] = p.split("-") as ["top" | "bottom" | "left" | "right", "start" | "end"];
	const roomBelow = vp.bottom - (a.bottom + offset);
	const roomAbove = a.top - offset - vp.top;
	const roomRight = vp.right - (a.right + offset);
	const roomLeft = a.left - offset - vp.left;
	let left: number;
	let top: number;
	let maxHeight: number;
	if (side === "bottom" || side === "top") {
		let vertical = side;
		if (vertical === "bottom" && size.height > roomBelow && roomAbove > roomBelow) vertical = "top";
		else if (vertical === "top" && size.height > roomAbove && roomBelow > roomAbove) vertical = "bottom";
		p = `${vertical}-${align}` as Placement;
		maxHeight = Math.max(80, vertical === "bottom" ? roomBelow : roomAbove);
		const h = Math.min(size.height, maxHeight);
		top = vertical === "bottom" ? a.bottom + offset : a.top - offset - h;
		left = align === "start" ? a.left : a.right - size.width;
	} else {
		let horizontal = side;
		if (horizontal === "right" && size.width > roomRight && roomLeft > roomRight) horizontal = "left";
		else if (horizontal === "left" && size.width > roomLeft && roomRight > roomLeft) horizontal = "right";
		p = `${horizontal}-${align}` as Placement;
		left = horizontal === "right" ? a.right + offset : a.left - offset - size.width;
		top = a.top;
		maxHeight = Math.max(80, vp.bottom - vp.top);
	}
	const h = Math.min(size.height, maxHeight);
	left = Math.min(Math.max(left, vp.left), Math.max(vp.left, vp.right - size.width));
	top = Math.min(Math.max(top, vp.top), Math.max(vp.top, vp.bottom - h));
	return { left, top, maxHeight, placement: p };
}

/**
 * Positions `floatingRef` relative to `anchor` after layout, and re-measures
 * on resize / any ancestor scroll / content size change.
 */
export function useAnchoredPosition(
	anchor: Anchor | null,
	floatingRef: RefObject<HTMLElement | null>,
	placement: Placement = "bottom-start",
	offset = 4,
): FloatingPosition | null {
	const [pos, setPos] = useState<FloatingPosition | null>(null);

	const update = useCallback(() => {
		const el = floatingRef.current;
		if (!anchor || !el) return;
		const next = computePosition(
			anchorRect(anchor),
			{ width: el.offsetWidth, height: el.scrollHeight },
			placement,
			offset,
			usableViewport(),
		);
		setPos((prev) =>
			prev &&
			prev.left === next.left &&
			prev.top === next.top &&
			prev.maxHeight === next.maxHeight &&
			prev.placement === next.placement
				? prev
				: next,
		);
	}, [anchor, floatingRef, placement, offset]);

	useLayoutEffect(() => {
		if (!anchor) {
			setPos(null);
			return;
		}
		update();
	}, [anchor, update]);

	useEffect(() => {
		if (!anchor) return;
		const el = floatingRef.current;
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);
		const ro = el ? new ResizeObserver(update) : null;
		if (el && ro) ro.observe(el);
		return () => {
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
			ro?.disconnect();
		};
	}, [anchor, floatingRef, update]);

	return pos;
}

export interface FloatingLayerProps {
	/** Render nothing when null. */
	anchor: Anchor | null;
	placement?: Placement;
	offset?: number;
	layer?: ZLayer;
	/** Outside mousedown / Escape. Omit for non-dismissable surfaces (hover cards). */
	onDismiss?: () => void;
	/** Elements whose clicks must NOT dismiss (typically the trigger button). */
	ignoreRefs?: RefObject<HTMLElement | null>[];
	className?: string;
	style?: CSSProperties;
	role?: string;
	"aria-label"?: string;
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
	children: ReactNode;
}

const LIGHTBOX_SELECTOR = '[data-layer="lightbox"]';

/** Modal surfaces: FloatingLayer modal tier plus any ARIA modal dialog. */
export const MODAL_SELECTOR = '[data-layer="modal"], [aria-modal="true"]';

/**
 * The single floating primitive: portal + fixed positioning + viewport
 * collision (flip/clamp, status bar aware) + dismissal + z tier.
 * Surfaces are opaque (`bg-[var(--bg-panel)]`) by default; pass className to
 * override skin, never to override position/z.
 */
export function FloatingLayer({
	anchor,
	placement = "bottom-start",
	offset = 4,
	layer = "popover",
	onDismiss,
	ignoreRefs,
	className,
	style,
	children,
	...rest
}: FloatingLayerProps) {
	const ref = useRef<HTMLDivElement>(null);
	const pos = useAnchoredPosition(anchor, ref, placement, offset);
	const isHovercard = layer === "hovercard";
	const [modalOpen, setModalOpen] = useState(false);

	// Hover cards sit above popovers, but must never cover an open modal dialog:
	// hide them while any modal surface is mounted.
	useEffect(() => {
		if (!anchor || !isHovercard) return;
		const check = () => setModalOpen(document.querySelector(MODAL_SELECTOR) !== null);
		check();
		const mo = new MutationObserver(check);
		mo.observe(document.body, { childList: true, subtree: true });
		return () => mo.disconnect();
	}, [anchor, isHovercard]);

	useEffect(() => {
		if (!anchor || !onDismiss) return;
		const onDown = (e: MouseEvent) => {
			const t = e.target as Node;
			// Clicks inside an open lightbox (portaled outside this layer) must not dismiss the layer that spawned it.
			if (t instanceof Element && t.closest(LIGHTBOX_SELECTOR)) return;
			if (ref.current?.contains(t)) return;
			if (ignoreRefs?.some((r) => r.current?.contains(t))) return;
			onDismiss();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Escape closes the topmost lightbox first; it handles the key itself.
				if (document.querySelector(LIGHTBOX_SELECTOR)) return;
				e.stopPropagation();
				onDismiss();
			}
		};
		document.addEventListener("mousedown", onDown, true);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("mousedown", onDown, true);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [anchor, onDismiss, ignoreRefs]);

	if (!anchor || (isHovercard && modalOpen)) return null;
	return createPortal(
		<div
			ref={ref}
			{...rest}
			data-layer={layer}
			className={clsx(
				"fixed overflow-y-auto rounded-xl border border-[var(--border-divider)] vibrancy-popover shadow-apple-modal backdrop-blur-2xl",
				className,
			)}
			style={{
				...style,
				zIndex: Z_LAYER[layer],
				left: pos?.left ?? -9999,
				top: pos?.top ?? -9999,
				maxHeight: pos?.maxHeight,
				visibility: pos ? "visible" : "hidden",
			}}
		>
			{children}
		</div>,
		document.body,
	);
}
