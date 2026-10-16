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
	ro: ResizeObserver;
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
		// Fires after layout, before paint: the pill tracks a resizing scroller
		// (splitter drags) in the same frame instead of trailing one behind.
		const ro = new ResizeObserver(() => {
			const cur = entries.get(el);
			if (cur?.visible) layout(el, cur);
		});
		const e: Entry = {
			el,
			pill,
			idleTimer: 0,
			visible: false,
			hovered: false,
			drag: null,
			ro,
		};
		ro.observe(el);
		attachPillHandlers(e);
		entries.set(el, e);
		entry = e;
	}
	return entry;
}

/** The scroller's rect intersected with every clipping ancestor and the
 * viewport — a scroller taller than its clipped container (modal body, card)
 * must not draw its pill in the clipped-away region. */
function visibleRect(el: HTMLElement) {
	const r = el.getBoundingClientRect();
	let top = r.top;
	let bottom = r.bottom;
	let left = r.left;
	let right = r.right;
	for (let a = el.parentElement; a; a = a.parentElement) {
		const st = getComputedStyle(a);
		if (st.overflowX === "visible" && st.overflowY === "visible") continue;
		const ar = a.getBoundingClientRect();
		top = Math.max(top, ar.top);
		bottom = Math.min(bottom, ar.bottom);
		left = Math.max(left, ar.left);
		right = Math.min(right, ar.right);
	}
	top = Math.max(top, 0);
	left = Math.max(left, 0);
	bottom = Math.min(bottom, window.innerHeight);
	right = Math.min(right, window.innerWidth);
	return { top, bottom, left, right, height: Math.max(0, bottom - top) };
}

/** Track geometry shared by layout() and drag math. */
function metrics(el: HTMLElement) {
	const rect = visibleRect(el);
	const trackH = rect.height;
	const pillH = Math.min(
		trackH,
		Math.max(
			PILL_MIN_H,
			Math.round((el.clientHeight / el.scrollHeight) * trackH),
		),
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
	if (!el.isConnected) {
		hide(entry);
		entry.pill.remove();
		entry.ro.disconnect();
		entries.delete(el);
		return;
	}
	const { scrollTop, scrollHeight, clientHeight } = el;
	const { rect, trackH, pillH, maxScroll } = metrics(el);
	if (
		scrollHeight <= clientHeight + 1 ||
		rect.height < PILL_MIN_H ||
		rect.right - rect.left <= PILL_W
	) {
		hide(entry);
		return;
	}
	const maxTop = trackH - pillH;
	const frac = maxScroll > 0 ? scrollTop / maxScroll : 0;
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
	const kr = visibleRect(keep);
	const kLeft = kr.right - PILL_W - 2;
	for (const [otherEl, other] of entries) {
		if (otherEl === keep || !other.visible) continue;
		const or = visibleRect(otherEl);
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

let suspended = false;
/** Hide every pill instantly (no fade) and ignore scroll/wheel until resumed.
 * Used while a splitter drag reflows the layout: reflow fires scroll events on
 * several nested scrollers, which would otherwise flash overlapping pills. */
export function suspendScrollPills(on: boolean): void {
	suspended = on;
	for (const [, entry] of entries) {
		if (on) hide(entry);
		entry.pill.style.display = on ? "none" : "";
	}
}

/** While a modal is open, scrollers outside it are inert (backdrop). Their
 * pill (z-index above the modal) would otherwise float over the dialog when
 * background content scrolls, e.g. a streaming chat behind Settings. */
const MODAL_SELECTOR = '[data-layer="modal"], [aria-modal="true"]';
function isBehindModal(el: HTMLElement): boolean {
	const modals = document.querySelectorAll(MODAL_SELECTOR);
	if (modals.length === 0) return false;
	for (const m of modals) if (m.contains(el)) return false;
	return true;
}

function show(el: HTMLElement): void {
	if (suspended || !el.isConnected || isBehindModal(el)) return;
	const entry = entryFor(el);
	if (!dedupeOverlap(el)) return;
	layout(el, entry);
	if (entry.idleTimer !== 0) window.clearTimeout(entry.idleTimer);
	if (!entry.visible) {
		entry.visible = true;
		entry.pill.classList.add(PILL_VISIBLE);
		ensureSync();
	}
	entry.idleTimer = window.setTimeout(() => {
		entry.idleTimer = 0;
		if (!entry.el.isConnected) {
			prune();
			return;
		}
		// Verify if the pointer is actually still hovering the pill
		if (entry.hovered && !entry.drag) {
			const isStillHovered = typeof entry.pill.matches === "function" && entry.pill.matches(":hover");
			if (!isStillHovered) {
				entry.hovered = false;
			}
		}
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
	entry.hovered = false;
	entry.pill.classList.remove(PILL_VISIBLE);
}

/** A visible pill is positioned with fixed coordinates computed from its
 * scroller's rect. Layout changes that fire no scroll/resize event (dragging the
 * right-panel splitter, sidebar toggle, …) would leave it stale until the next
 * scroll, so re-sync every frame while at least one pill is visible. */
let syncRaf = 0;
function syncVisiblePills(): void {
	syncRaf = 0;
	let any = false;
	for (const [el, entry] of Array.from(entries)) {
		if (!entry.visible) continue;
		if (isBehindModal(el)) {
			hide(entry);
			continue;
		}
		layout(el, entry);
		if (entry.visible) any = true;
	}
	// Two visible pills on the same rail read as a ghost: keep only the deepest.
	const vis = Array.from(entries).filter(([, e]) => e.visible && !e.drag);
	for (let i = 0; i < vis.length; i++) {
		for (let j = i + 1; j < vis.length; j++) {
			const [a, ea] = vis[i];
			const [b, eb] = vis[j];
			if (!ea.visible || !eb.visible) continue;
			const ra = visibleRect(a);
			const rb = visibleRect(b);
			const overlap =
				Math.abs(ra.right - rb.right) <= 40 &&
				!(ra.bottom < rb.top || rb.bottom < ra.top);
			if (!overlap) continue;
			// Ancestor loses to its descendant; unrelated rails: the older one yields.
			hide(b.contains(a) ? eb : ea);
		}
	}
	if (any) syncRaf = window.requestAnimationFrame(syncVisiblePills);
}
function ensureSync(): void {
	if (syncRaf === 0) syncRaf = window.requestAnimationFrame(syncVisiblePills);
}

export function prune(): void {
	// Sweep pill nodes no entry owns (leaked by a dead instance / lost entry).
	const owned = new Set<Element>();
	for (const entry of entries.values()) owned.add(entry.pill);
	for (const p of document.querySelectorAll(`.${PILL_CLASS}`)) {
		if (!owned.has(p)) p.remove();
	}
	for (const [el, entry] of Array.from(entries)) {
		if (!el.isConnected || !isScrollable(el)) {
			if (entry.drag) document.body.classList.remove(DRAG_BODY_CLASS);
			hide(entry);
			entry.pill.remove();
			entry.ro.disconnect();
			entries.delete(el);
		}
	}
}

/** Instantly hide and clean all overlay pills (e.g. on modal close or view switch). */
export function hideAllScrollPills(): void {
	for (const [, entry] of Array.from(entries)) {
		if (!entry.drag) {
			hide(entry);
		}
	}
	prune();
}

export function startScrollPills(): () => void {
	// A second live instance (HMR re-eval, double init) would stack its own
	// pills on top of ours; tear any previous one down first.
	const w = window as unknown as { __ompScrollPillsStop?: () => void };
	w.__ompScrollPillsStop?.();
	for (const p of document.querySelectorAll(`.${PILL_CLASS}`)) p.remove();
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
	const pruneTimer = window.setInterval(prune, 1000);

	// MutationObserver: instantly prune pills when modal/view DOM subtrees are removed
	let moRaf = 0;
	const observer = new MutationObserver(() => {
		if (moRaf !== 0) return;
		moRaf = window.requestAnimationFrame(() => {
			moRaf = 0;
			prune();
		});
	});
	observer.observe(document.body, { childList: true, subtree: true });

	const onBlur = () => hideAllScrollPills();
	window.addEventListener("blur", onBlur);
	const stop = () => {
		window.removeEventListener("scroll", onScroll, { capture: true });
		window.removeEventListener("wheel", onWheel, { capture: true });
	window.removeEventListener("pointerdown", onDown, { capture: true });
	window.removeEventListener("pointermove", onMove, { capture: true });
		document.body.classList.remove(DRAG_BODY_CLASS);
		window.removeEventListener("resize", onResize);
		window.clearInterval(pruneTimer);
		observer.disconnect();
		if (moRaf !== 0) window.cancelAnimationFrame(moRaf);
		if (syncRaf !== 0) {
			window.cancelAnimationFrame(syncRaf);
			syncRaf = 0;
		}
		window.removeEventListener("blur", onBlur);
		for (const [, entry] of entries) {
			hide(entry);
			entry.pill.remove();
			entry.ro.disconnect();
		}
		entries.clear();
		if (w.__ompScrollPillsStop === stop) w.__ompScrollPillsStop = undefined;
	};
	w.__ompScrollPillsStop = stop;
	return stop;
}
