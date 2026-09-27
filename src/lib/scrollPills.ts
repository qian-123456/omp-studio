/**
 * Custom overlay scroll pills.
 *
 * Why this exists: the user's macOS renders classic always-on scrollbars in
 * WKWebView (no native overlay mode), and WebKit does NOT reliably repaint
 * ::-webkit-scrollbar pseudo-elements on class/attribute changes — so a
 * "show while scrolling" thumb cannot be done with CSS alone. Instead we
 * hide the native bar entirely (index.css: *::-webkit-scrollbar width 0)
 * and draw our own floating capsule indicator per scrollable element.
 *
 * Behavior (macOS overlay semantics):
 * - Hidden at rest; appears while scrolling or while the pointer hovers the
 *   scroll lane; fades out ~600ms after activity stops.
 * - Pill height/position track scrollHeight/clientHeight/scrollTop, so it
 *   doubles as a position + document-size indicator.
 * - pointer-events: none — native wheel/trackpad scrolling is untouched.
 *   Dragging the pill is intentionally not implemented (scroll gestures only).
 */
const PILL_CLASS = "scroll-pill";
const PILL_VISIBLE = "scroll-pill--visible";
const LANE_PX = 14; // pointer proximity to the lane edge that wakes the pill
const IDLE_MS = 600;
const PILL_W = 6;
const PILL_MIN_H = 32;

type Entry = {
	pill: HTMLElement;
	idleTimer: number;
	visible: boolean;
};

const entries = new Map<HTMLElement, Entry>();

function isScrollable(el: Element): boolean {
	if (!(el instanceof HTMLElement)) return false;
	const st = getComputedStyle(el);
	return (
		/(auto|scroll)/.test(st.overflowY) &&
		el.scrollHeight > el.clientHeight + 1
	);
}

/** Find the nearest vertically-scrollable ancestor (or self). */
function scrollerOf(target: Element | null): HTMLElement | null {
	let el: HTMLElement | null =
		target === document.body || target === document.documentElement
			? (document.scrollingElement as HTMLElement | null)
			: (target as HTMLElement | null);
	while (el && el !== document.body && el !== document.documentElement) {
		if (isScrollable(el)) return el;
		el = el.parentElement;
	}
	return document.scrollingElement instanceof HTMLElement &&
		document.scrollingElement.scrollHeight > document.scrollingElement.clientHeight + 1
		? document.scrollingElement
		: null;
}

function entryFor(el: HTMLElement): Entry {
	let entry = entries.get(el);
	if (!entry) {
		const pill = document.createElement("div");
		pill.className = PILL_CLASS;
		pill.setAttribute("aria-hidden", "true");
		document.body.appendChild(pill);
		entry = { pill, idleTimer: 0, visible: false };
		entries.set(el, entry);
	}
	return entry;
}

function layout(el: HTMLElement, entry: Entry): void {
	const rect = el.getBoundingClientRect();
	const { scrollTop, scrollHeight, clientHeight } = el;
	if (scrollHeight <= clientHeight + 1 || rect.height <= 0) {
		hide(entry);
		return;
	}
	const trackH = rect.height;
	const pillH = Math.max(
		PILL_MIN_H,
		Math.round((clientHeight / scrollHeight) * trackH),
	);
	const maxTop = trackH - pillH;
	const frac = scrollTop / (scrollHeight - clientHeight);
	const top = rect.top + Math.round(frac * maxTop);
	const s = entry.pill.style;
	s.top = `${top}px`;
	s.left = `${Math.round(rect.right - PILL_W - 2)}px`;
	s.height = `${pillH}px`;
	s.width = `${PILL_W}px`;
}

function show(el: HTMLElement): void {
	const entry = entryFor(el);
	layout(el, entry);
	if (entry.idleTimer !== 0) window.clearTimeout(entry.idleTimer);
	if (!entry.visible) {
		entry.visible = true;
		entry.pill.classList.add(PILL_VISIBLE);
	}
	entry.idleTimer = window.setTimeout(() => hide(entry), IDLE_MS);
}

function hide(entry: Entry): void {
	if (entry.idleTimer !== 0) {
		window.clearTimeout(entry.idleTimer);
		entry.idleTimer = 0;
	}
	entry.visible = false;
	entry.pill.classList.remove(PILL_VISIBLE);
}

function prune(): void {
	for (const [el, entry] of entries) {
		if (!el.isConnected || !isScrollable(el)) {
			hide(entry);
			entry.pill.remove();
			entries.delete(el);
		}
	}
}

export function startScrollPills(): () => void {
	const onScroll = (e: Event) => {
		const t = e.target;
		const el =
			t === document
				? (document.scrollingElement instanceof HTMLElement
						? document.scrollingElement
						: null)
				: t instanceof Element
					? scrollerOf(t)
					: null;
		if (el) show(el);
	};
	// Wheel gives earlier feedback than scroll (momentum may lag the gesture).
	const onWheel = (e: WheelEvent) => {
		const el = scrollerOf(e.target as Element);
		if (el) show(el);
	};
	// Waking the pill by parking the pointer on the scroll lane (right edge).
	const onMove = (e: PointerEvent) => {
		const el = scrollerOf(e.target as Element);
		if (!el) return;
		const r = el.getBoundingClientRect();
		const nearLane =
			e.clientX >= r.left &&
			e.clientX <= r.right &&
			e.clientY >= r.top &&
			e.clientY <= r.bottom &&
			e.clientX >= r.right - LANE_PX;
		if (nearLane) show(el);
	};
	const onResize = () => {
		for (const [el, entry] of entries) {
			if (entry.visible) layout(el, entry);
		}
		prune();
	};

	window.addEventListener("scroll", onScroll, { capture: true, passive: true });
	window.addEventListener("wheel", onWheel, { capture: true, passive: true });
	window.addEventListener("pointermove", onMove, {
		capture: true,
		passive: true,
	});
	window.addEventListener("resize", onResize, { passive: true });
	const pruneTimer = window.setInterval(prune, 2000);

	return () => {
		window.removeEventListener("scroll", onScroll, { capture: true });
		window.removeEventListener("wheel", onWheel, { capture: true });
		window.removeEventListener("pointermove", onMove, { capture: true });
		window.removeEventListener("resize", onResize);
		window.clearInterval(pruneTimer);
		for (const [, entry] of entries) {
			hide(entry);
			entry.pill.remove();
		}
		entries.clear();
	};
}
