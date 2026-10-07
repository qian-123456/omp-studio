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
 * - Hidden at rest; appears while scrolling, dragging, or hovering the pill
 *   itself; fades out ~1.4s after activity stops (macOS linger). Moving the
 *   pointer onto the visible pill's rail re-arms the fade (no wake when hidden).
 * - Pill height/position track scrollHeight/clientHeight/scrollTop, so it
 *   doubles as a position + document-size indicator.
 * - pointer-events: none while hidden (so wheel/trackpad and clicks pass
 *   through); auto while visible so the pill can be dragged like a thumb.
 * - While visible, pressing the pill's rail (~10px column) outside the pill
 *   jumps to that proportion of the document (macOS "jump to the spot
 *   that's clicked") and continues as a drag until release. While hidden,
 *   the lane passes all pointer events through.
 * - The pill stays visible while hovered or dragged.
 */
const PILL_CLASS = "scroll-pill";
const PILL_DRAGGING = "scroll-pill--dragging";
const DRAG_BODY_CLASS = "scroll-pill-drag-active";
const PILL_VISIBLE = "scroll-pill--visible";
const IDLE_MS = 1400;
const PILL_W = 6;
const PILL_MIN_H = 32;

type Entry = {
	el: HTMLElement;
	pill: HTMLElement;
	idleTimer: number;
	visible: boolean;
	hovered: boolean;
	drag: { pointerId: number; startY: number; startScrollTop: number } | null;
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
		const e: Entry = {
			el,
			pill,
			idleTimer: 0,
			visible: false,
			hovered: false,
			drag: null,
		};
		attachPillHandlers(e);
		entries.set(el, e);
		entry = e;
	}
	return entry;
}

/** Track geometry shared by layout() and drag math. */
function metrics(el: HTMLElement) {
	const rect = el.getBoundingClientRect();
	const trackH = rect.height;
	const pillH = Math.max(
		PILL_MIN_H,
		Math.round((el.clientHeight / el.scrollHeight) * trackH),
	);
	return { rect, trackH, pillH, maxScroll: el.scrollHeight - el.clientHeight };
}

function beginDrag(entry: Entry, e: PointerEvent): void {
	entry.drag = {
		pointerId: e.pointerId,
		startY: e.clientY,
		startScrollTop: entry.el.scrollTop,
	};
	try {
		entry.pill.setPointerCapture(e.pointerId);
	} catch {
		// Pointer already gone; the drag will end on the next up/cancel.
	}
	entry.pill.classList.add(PILL_DRAGGING);
	document.body.classList.add(DRAG_BODY_CLASS);
	show(entry.el);
}

function endDrag(entry: Entry, e: PointerEvent): void {
	if (!entry.drag || entry.drag.pointerId !== e.pointerId) return;
	entry.drag = null;
	if (entry.pill.hasPointerCapture(e.pointerId)) {
		entry.pill.releasePointerCapture(e.pointerId);
	}
	entry.pill.classList.remove(PILL_DRAGGING);
	document.body.classList.remove(DRAG_BODY_CLASS);
	// Keep visible briefly, then fade normally (unless still hovered).
	if (entry.el.isConnected) show(entry.el);
}

function attachPillHandlers(entry: Entry): void {
	const { pill } = entry;
	pill.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		beginDrag(entry, e);
	});
	pill.addEventListener("pointermove", (e) => {
		const d = entry.drag;
		if (!d || d.pointerId !== e.pointerId) return;
		e.preventDefault();
		const { trackH, pillH, maxScroll } = metrics(entry.el);
		const travel = trackH - pillH;
		if (travel <= 0 || maxScroll <= 0) return;
		entry.el.scrollTop =
			d.startScrollTop + ((e.clientY - d.startY) * maxScroll) / travel;
		// The resulting scroll event re-runs layout() via show(); also lay out
		// now so the pill tracks the pointer even if the scroll event lags.
		show(entry.el);
	});
	pill.addEventListener("pointerup", (e) => endDrag(entry, e));
	pill.addEventListener("pointercancel", (e) => endDrag(entry, e));
	pill.addEventListener("lostpointercapture", (e) => endDrag(entry, e));
	pill.addEventListener("pointerenter", () => {
		entry.hovered = true;
		show(entry.el);
	});
	pill.addEventListener("pointerleave", () => {
		entry.hovered = false;
		if (entry.visible) show(entry.el);
	});
}

function layout(el: HTMLElement, entry: Entry): void {
	const { scrollTop, scrollHeight, clientHeight } = el;
	const { rect, trackH, pillH, maxScroll } = metrics(el);
	if (scrollHeight <= clientHeight + 1 || rect.height <= 0) {
		hide(entry);
		return;
	}
	const maxTop = trackH - pillH;
	const frac = scrollTop / maxScroll;
	const top = rect.top + Math.round(frac * maxTop);
	const s = entry.pill.style;
	s.top = `${top}px`;
	s.left = `${Math.round(rect.right - PILL_W - 2)}px`;
	s.height = `${pillH}px`;
	s.width = `${PILL_W}px`;
}

/** Scroll chaining (macOS rubber-banding) fires scroll on ancestor scrollers
 * too — the deepest scroller's pill always wins to avoid ping-pong flicker.
 * Returns false when `el` must not show because a visible descendant pill
 * already covers this rail. */
function dedupeOverlap(keep: HTMLElement): boolean {
	const keepEntry = entries.get(keep);
	if (keepEntry?.drag) return true; // never suppress a pill mid-drag
	const kr = keep.getBoundingClientRect();
	const kLeft = kr.right - PILL_W - 2;
	for (const [otherEl, other] of entries) {
		if (otherEl === keep || !other.visible) continue;
		const or = otherEl.getBoundingClientRect();
		const oLeft = or.right - PILL_W - 2;
		const overlap =
			Math.abs(kLeft - oLeft) <= 40 &&
			!(kr.bottom < or.top || or.bottom < kr.top);
		if (!overlap) continue;
		if (otherEl.contains(keep) || (!keep.contains(otherEl) && !other.drag)) {
			// keep is the deeper scroller (or unrelated) — it wins.
			hide(other);
			continue;
		}
		// keep is an ANCESTOR of a visible pill's scroller — suppress it so
		// chained scroll events never resurrect an overlapping parent pill.
		const entry = entries.get(keep);
		if (entry) hide(entry);
		return false;
	}
	return true;
}

function show(el: HTMLElement): void {
	const entry = entryFor(el);
	if (!dedupeOverlap(el)) return;
	layout(el, entry);
	if (entry.idleTimer !== 0) window.clearTimeout(entry.idleTimer);
	if (!entry.visible) {
		entry.visible = true;
		entry.pill.classList.add(PILL_VISIBLE);
	}
	entry.idleTimer = window.setTimeout(() => {
		entry.idleTimer = 0;
		// Hovered or dragged pills stay up; leave/release re-arms the timer.
		if (entry.hovered || entry.drag) return;
		hide(entry);
	}, IDLE_MS);
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
			if (entry.drag) document.body.classList.remove(DRAG_BODY_CLASS);
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
	// Track click: only when the pill is visible and the press lands on the
	// pill's own rail (~10px centered on the pill). Jump so the pill centers
	// on the pointer, then keep dragging until release (macOS jump-to-spot).
	// Hidden pill → every pointer event passes through untouched.
	const onDown = (e: PointerEvent) => {
		if (e.button !== 0) return;
		const t = e.target as Element | null;
		if (t instanceof Element && t.classList.contains(PILL_CLASS)) return;
		const el = scrollerOf(t);
		if (!el || el.closest(".no-scrollbar")) return;
		const entry = entries.get(el);
		if (!entry?.visible) return;
		const { rect, trackH, pillH, maxScroll } = metrics(el);
		if (
			e.clientX < rect.right - PILL_W - 4 ||
			e.clientX > rect.right ||
			e.clientY < rect.top ||
			e.clientY > rect.bottom
		)
			return;
		const travel = trackH - pillH;
		if (travel <= 0 || maxScroll <= 0) return;
		e.preventDefault();
		e.stopPropagation();
		const frac = Math.min(
			1,
			Math.max(0, (e.clientY - rect.top - pillH / 2) / travel),
		);
		el.scrollTop = frac * maxScroll;
		beginDrag(entry, e);
	};
	// Keep-alive only: pointer over the visible pill's rail re-arms the fade.
	// Hidden pills are never woken by plain movement.
	const onMove = (e: PointerEvent) => {
		const t = e.target as Element | null;
		if (t instanceof Element && t.classList.contains(PILL_CLASS)) return;
		const el = scrollerOf(t);
		if (!el) return;
		const entry = entries.get(el);
		if (!entry?.visible) return;
		const r = el.getBoundingClientRect();
		if (
			e.clientX >= r.right - PILL_W - 4 &&
			e.clientX <= r.right &&
			e.clientY >= r.top &&
			e.clientY <= r.bottom
		)
			show(el);
	};
	const onResize = () => {
		for (const [el, entry] of entries) {
			if (entry.visible) layout(el, entry);
		}
		prune();
	};

	window.addEventListener("scroll", onScroll, { capture: true, passive: true });
	window.addEventListener("wheel", onWheel, { capture: true, passive: true });
	window.addEventListener("pointerdown", onDown, { capture: true });
	window.addEventListener("pointermove", onMove, { capture: true, passive: true });
	window.addEventListener("resize", onResize, { passive: true });
	const pruneTimer = window.setInterval(prune, 2000);

	return () => {
		window.removeEventListener("scroll", onScroll, { capture: true });
		window.removeEventListener("wheel", onWheel, { capture: true });
	window.removeEventListener("pointerdown", onDown, { capture: true });
	window.removeEventListener("pointermove", onMove, { capture: true });
		document.body.classList.remove(DRAG_BODY_CLASS);
		window.removeEventListener("resize", onResize);
		window.clearInterval(pruneTimer);
		for (const [, entry] of entries) {
			hide(entry);
			entry.pill.remove();
		}
		entries.clear();
	};
}
