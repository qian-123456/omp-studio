import clsx from "clsx";
import {
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { claimEscape } from "../lib/escapeClaim";
import { isComposing } from "../lib/hooks";

/**
 * Page-local stacking inside one component (sticky headers, a badge above a
 * sibling, splitter handles). Never use for anything that floats or overlays.
 * Tailwind `z-0/10/20/30/40` are the only allowed raw classes and map 1:1 to
 * these values. See docs/LAYERS.md.
 */
export const Z_LOCAL = {
	base: 0,
	raised: 10,
	overlay: 20,
	chrome: 30,
	handle: 40,
} as const;

/**
 * Global stacking scale, low -> high:
 * pill < drawer < popover < menu < modal < hovercard < lightbox < toast.
 * Every floating surface MUST use one of these tiers (also exposed as CSS vars
 * `--z-*` in index.css, kept in sync by zLayerGuard.test.ts; use Tailwind
 * `z-(--z-modal)` in className) instead of ad-hoc z-index. See docs/LAYERS.md.
 *
 * Floating surfaces are portaled to `document.body`, so they never get trapped
 * inside a `backdrop-filter` / `transform` ancestor (which turns `position:
 * fixed` into "fixed relative to that ancestor" and creates a stacking context
 * that sibling columns paint over).
 */
export const Z_LAYER = {
	/** Overlay scroll pills of ordinary page scrollers (scrollPills.ts); above every Z_LOCAL value. */
	pill: 50,
	drawer: 100,
	popover: 200,
	menu: 300,
	/** Modal dialogs (confirmDialog, settings, pickers). Above popovers/menus, so a confirm spawned from a popover covers it. */
	modal: 400,
	hovercard: 500,
	/** Full-screen image lightbox: must cover every popover/menu/hovercard that spawned it. */
	lightbox: 600,
	toast: 700,
} as const;
export type ZLayer = keyof typeof Z_LAYER;

/** Lowest tier that counts as "floating" (scroll pill lifting, nesting). */
export const Z_FLOATING_MIN = Z_LAYER.drawer;

/**
 * Nesting rule (pure): a floating layer opened from inside another floating
 * surface sits at max(own tier, parent z + 1). Local page values never count.
 */
export function nestedZ(own: number, ancestorZ: readonly number[]): number {
	let z = own;
	for (const a of ancestorZ) {
		if (Number.isFinite(a) && a >= Z_FLOATING_MIN && a + 1 > z) z = a + 1;
	}
	return z;
}

/** z-indexes of an element's ancestors (self excluded) that are floating surfaces. */
function ancestorFloatingZ(el: Element): number[] {
	const out: number[] = [];
	for (let n = el.parentElement; n; n = n.parentElement) {
		const z = Number.parseInt(getComputedStyle(n).zIndex, 10);
		if (!Number.isNaN(z) && z >= Z_FLOATING_MIN) out.push(z);
	}
	return out;
}

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
	layer?: Exclude<ZLayer, "pill">;
	/** Outside mousedown / Escape. Omit for non-dismissable surfaces (hover cards). */
	onDismiss?: () => void;
	/** Elements whose clicks must NOT dismiss (typically the trigger button). */
	ignoreRefs?: RefObject<HTMLElement | null>[];
	/** Esc pressed inside a text field within this layer is left to that field
	 * (it cancels its own edit) instead of dismissing the layer. Default: dismiss. */
	deferEscapeToEditors?: boolean;
	className?: string;
	style?: CSSProperties;
	role?: string;
	"aria-label"?: string;
	onMouseEnter?: () => void;
	onMouseLeave?: () => void;
	children: ReactNode;
}

const LIGHTBOX_SELECTOR = '[data-layer="lightbox"]';

/** True when `target` is a text field / contenteditable inside `root`. */
function isEditableWithin(target: EventTarget | null, root: HTMLElement | null): boolean {
	if (!root || !(target instanceof HTMLElement) || !root.contains(target)) return false;
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target.isContentEditable
	);
}

/** Modal surfaces: FloatingLayer modal tier plus any ARIA modal dialog. */
export const MODAL_SELECTOR = '[data-layer="modal"], [aria-modal="true"]';

/** True when a modal surface mounted after `self` (so stacked above it, not `self` or nested with it) is open. */
function modalAbove(self: HTMLElement | null): boolean {
	if (!self) return false;
	for (const m of document.querySelectorAll(MODAL_SELECTOR)) {
		if (m === self || self.contains(m) || m.contains(self)) continue;
		if (self.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) return true;
	}
	return false;
}

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
	deferEscapeToEditors = false,
	className,
	style,
	children,
	...rest
}: FloatingLayerProps) {
	const ref = useRef<HTMLDivElement>(null);
	const pos = useAnchoredPosition(anchor, ref, placement, offset);
	const isHovercard = layer === "hovercard";
	const [modalOpen, setModalOpen] = useState(false);
	// Nested floating UI (a picker opened from a dialog, a menu from a popover) must stay above its parent.
	const z = useMemo(
		() => (anchor instanceof Element ? nestedZ(Z_LAYER[layer], ancestorFloatingZ(anchor)) : Z_LAYER[layer]),
		[anchor, layer],
	);

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
			// Interacting with a modal stacked above (e.g. a confirm spawned from this popover) must not dismiss it.
			if (modalAbove(ref.current)) return;
			if (ref.current?.contains(t)) return;
			if (ignoreRefs?.some((r) => r.current?.contains(t))) return;
			onDismiss();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Esc that cancels an IME candidate belongs to the IME, not to the layer.
				if (isComposing({ nativeEvent: e, key: e.key })) return;
				// An editor inside the layer owns Esc (cancels its own edit) when opted in.
				if (deferEscapeToEditors && isEditableWithin(e.target, ref.current)) return;
				// Escape closes the topmost lightbox first; it handles the key itself.
				if (document.querySelector(LIGHTBOX_SELECTOR)) return;
				// A modal stacked above this layer owns Escape (its own cancel handler must receive it).
				if (modalAbove(ref.current)) return;
				e.stopPropagation();
				claimEscape(e);
				onDismiss();
			}
		};
		document.addEventListener("mousedown", onDown, true);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("mousedown", onDown, true);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [anchor, onDismiss, ignoreRefs, deferEscapeToEditors]);

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
				// Position must never animate: a `duration-*` class would otherwise
				// transition left/top from the -9999 pre-measure spot (flies in from the far left).
				transitionProperty: "none",
				zIndex: z,
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
