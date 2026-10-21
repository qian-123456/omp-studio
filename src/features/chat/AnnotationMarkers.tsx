/** [B] Numbered markers in the message stream: one round badge per message quote
 * annotation, sitting just above the first character of the quoted text. Numbers
 * come from `textAnnotationsOf`, the same numbering as the outgoing `[n]` blocks. */

import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	sideChatAnnKey,
	useComposer,
	type Annotation,
} from "../../stores/composer";
import { textAnnotationsOf } from "./annotations";
import { type Anchor } from "../../components/FloatingLayer";
import { AnnotationHoverCard, AnnotationNotePopover } from "./AnnotationNotePopover";
import {
	collectTextSegments,
	locateQuote,
	segmentRange,
	type TextSegment,
} from "./annotationAnchor";

const MARKER_PX = 20;
/** How far the badge dips into the quote's first line (it sits on the line, not
 *  floating a full line above it). */
const LINE_OVERLAP_PX = 4;
/** Keeps the marker off the scrollbar / container edge. */
const EDGE_PX = 4;
const TITLE_SNIPPET_CHARS = 60;
/** Dwell before a hover card appears. */
const HOVER_DELAY_MS = 300;

/** Which annotation list a marker belongs to: main composer or the side chat. */
type MarkerKind = "main" | "sidechat";

const KIND_TITLE: Record<MarkerKind, string> = {
	main: "批注",
	sidechat: "侧聊批注",
};

/** Round badge colours: main = theme accent, side chat = accent-strong. */
const KIND_CLASS: Record<MarkerKind, string> = {
	main: "bg-[var(--accent)]",
	sidechat: "bg-[var(--accent-strong)]",
};

interface MarkerSource {
	id: string;
	n: number;
	itemId: string;
	quote: string;
	occurrence?: number;
	title: string;
	kind: MarkerKind;
}

interface MarkerPos extends MarkerSource {
	top: number;
	left: number;
}

const EMPTY_ANNOTATIONS: Annotation[] = [];

function quoteSnippet(text: string): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > TITLE_SNIPPET_CHARS
		? `${flat.slice(0, TITLE_SNIPPET_CHARS)}…`
		: flat;
}

/** Message-quote annotations that have an item to anchor to, with their `[n]` number. */
function messageMarkerSources(
	list: readonly Annotation[],
	kind: MarkerKind,
): MarkerSource[] {
	const out: MarkerSource[] = [];
	textAnnotationsOf(list).forEach((a, i) => {
		if (a.source !== "message" || !a.itemId) return;
		const n = i + 1;
		const label = a.comment?.trim() ? quoteSnippet(a.comment) : quoteSnippet(a.text);
		out.push({
			id: a.id,
			n,
			itemId: a.itemId,
			quote: a.text,
			occurrence: a.occurrence,
			title: `${KIND_TITLE[kind]} ${n}：${label}`,
			kind,
		});
	});
	return out;
}

/**
 * Markers for a session's main annotations plus the side-chat annotations staged
 * under `sideChatAnnKey(sessionId)`. Each list keeps its own `[n]` numbering —
 * the same one `formatWithAnnotations` writes into the outgoing message.
 */
export function markerSources(
	main: readonly Annotation[],
	sidechat: readonly Annotation[],
): MarkerSource[] {
	return [
		...messageMarkerSources(main, "main"),
		...messageMarkerSources(sidechat, "sidechat"),
	];
}

const SAVED_HIGHLIGHT = "annotation-saved";

function paintSaved(ranges: readonly Range[]) {
	if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
	if (ranges.length === 0) CSS.highlights.delete(SAVED_HIGHLIGHT);
	else CSS.highlights.set(SAVED_HIGHLIGHT, new Highlight(...ranges));
}

function clearSaved() {
	if (typeof CSS !== "undefined" && "highlights" in CSS) CSS.highlights.delete(SAVED_HIGHLIGHT);
}

interface ItemText {
	el: HTMLElement;
	text: string;
	segments: TextSegment<Text>[];
}

/** True when `rect` lies entirely outside a scroll/clip ancestor of the range, up to `stop`. */
function isClippedWithin(range: Range, rect: DOMRect, stop: HTMLElement): boolean {
	const start = range.startContainer;
	let el: Element | null = start instanceof Element ? start : start.parentElement;
	for (; el && el !== stop; el = el.parentElement) {
		const style = getComputedStyle(el);
		const clipsY = style.overflowY !== "visible";
		const clipsX = style.overflowX !== "visible";
		if (!clipsY && !clipsX) continue;
		const box = el.getBoundingClientRect();
		if (clipsY && (rect.top >= box.bottom || rect.bottom <= box.top)) return true;
		if (clipsX && (rect.left >= box.right || rect.right <= box.left)) return true;
	}
	return false;
}

/**
 * Lays out every marker against the current DOM. Items not rendered (virtualized
 * out), quotes not found, and quotes whose text is hidden (collapsed content)
 * produce no marker.
 */
function measureMarkers(
	container: HTMLElement,
	sources: readonly MarkerSource[],
	ranges: Range[],
): MarkerPos[] {
	const cRect = container.getBoundingClientRect();
	const { scrollTop, scrollLeft, clientWidth } = container;
	const maxLeft = scrollLeft + Math.max(0, clientWidth - MARKER_PX - EDGE_PX);
	const itemTexts = new Map<string, ItemText | null>();
	const out: MarkerPos[] = [];

	for (const src of sources) {
		let item = itemTexts.get(src.itemId);
		if (item === undefined) {
			const el = document.getElementById(`msg-${src.itemId}`);
			item =
				el && container.contains(el)
					? { el, ...collectTextSegments(el) }
					: null;
			itemTexts.set(src.itemId, item);
		}
		if (!item) continue;

		const hit = locateQuote(item.text, src.quote, src.occurrence);
		if (!hit) continue;
		const range = segmentRange(item.segments, hit.start, hit.end);
		if (!range) continue;
		// Anchor to the first line box of the quote, not the union rect: a
		// multi-line or indented selection's union starts far left of the text.
		const first =
			Array.from(range.getClientRects()).find((r) => r.width > 0) ??
			range.getBoundingClientRect();
		if (first.width === 0 && first.height === 0) continue;
		// Text clipped by a collapsed code block (overflow-hidden) still has
		// client rects; the badge would float over whatever sits below the clip.
		if (isClippedWithin(range, first, item.el)) continue;
		ranges.push(range);

		// Centered over the quote's first character, just above its line, and
		// clamped so it never leaves the container.
		const left = Math.min(
			Math.max(
				first.left - cRect.left + scrollLeft - MARKER_PX / 2,
				scrollLeft + EDGE_PX,
			),
			maxLeft,
		);
		const top = Math.max(
			first.top - cRect.top + scrollTop - MARKER_PX + LINE_OVERLAP_PX,
			0,
		);
		out.push({ ...src, top, left });
	}
	return out;
}

function sameMarkers(a: readonly MarkerPos[], b: readonly MarkerPos[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((m, i) => {
		const o = b[i];
		return (
			m.id === o.id &&
			m.n === o.n &&
			m.kind === o.kind &&
			m.itemId === o.itemId &&
			m.title === o.title &&
			m.top === o.top &&
			m.left === o.left
		);
	});
}

function MarkerLayer({
	sessionId,
	containerRef,
	sources,
}: {
	sessionId: string;
	containerRef: RefObject<HTMLElement | null>;
	sources: MarkerSource[];
}) {
	const layerRef = useRef<HTMLDivElement>(null);
	const [markers, setMarkers] = useState<MarkerPos[]>([]);
	const rangesRef = useRef<Range[]>([]);
	const markersRef = useRef<MarkerPos[]>([]);
	const main = useComposer((s) => s.annotations[sessionId] ?? EMPTY_ANNOTATIONS);
	const side = useComposer((s) => s.annotations[sideChatAnnKey(sessionId)] ?? EMPTY_ANNOTATIONS);
	const storeKeyOf = (kind: MarkerKind) => (kind === "main" ? sessionId : sideChatAnnKey(sessionId));
	const [active, setActive] = useState<{ id: string; anchor: Anchor } | null>(null);
	// The popover closes on pointerdown; the click that follows on the same
	// marker/text must not reopen it (re-click = toggle closed).
	const closedAt = useRef<{ id: string; at: number } | null>(null);
	const pressClosed = useCallback((id: string) => {
		const c = closedAt.current;
		closedAt.current = null;
		return !!c && c.id === id && performance.now() - c.at < 600;
	}, []);
	const [hover, setHover] = useState<{ id: string; anchor: Anchor } | null>(null);
	const hoverTimer = useRef<number | undefined>(undefined);
	const pendingHover = useRef<string | null>(null);
	/** Targets a hover card at `id` (null = none); it shows after a short dwell. */
	const aim = useCallback((id: string | null, anchor?: Anchor) => {
		if (pendingHover.current === id) return;
		pendingHover.current = id;
		window.clearTimeout(hoverTimer.current);
		setHover(null);
		if (id && anchor) {
			hoverTimer.current = window.setTimeout(() => setHover({ id, anchor }), HOVER_DELAY_MS);
		}
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const layer = layerRef.current;
		let frame = 0;
		let disposed = false;

		const measure = () => {
			frame = 0;
			if (disposed) return;
			const ranges: Range[] = [];
			const next = measureMarkers(container, sources, ranges);
			paintSaved(ranges);
			rangesRef.current = ranges;
			markersRef.current = next;
			setMarkers((prev) => (sameMarkers(prev, next) ? prev : next));
		};
		// Coalesce bursts of DOM/resize events into one measurement per frame.
		const schedule = () => {
			if (frame === 0) frame = requestAnimationFrame(measure);
		};

		const resizeObserver = new ResizeObserver(schedule);
		resizeObserver.observe(container);
		const mutationObserver = new MutationObserver((records) => {
			// Our own marker updates live inside the container; ignore them or the
			// layer would re-measure itself forever.
			if (layer && records.every((r) => layer.contains(r.target))) return;
			schedule();
		});
		mutationObserver.observe(container, {
			childList: true,
			subtree: true,
			characterData: true,
			// Virtualized rows move via inline `transform`; without this the markers
			// drift when rows above them are re-measured.
			attributes: true,
			attributeFilter: ["style", "class"],
		});
		window.addEventListener("resize", schedule);
		schedule();

		return () => {
			disposed = true;
			clearSaved();
			if (frame !== 0) cancelAnimationFrame(frame);
			resizeObserver.disconnect();
			mutationObserver.disconnect();
			window.removeEventListener("resize", schedule);
		};
	}, [containerRef, sources]);

	// Highlights have no DOM, so hover/click on annotated text hit-tests the
	// painted ranges against the pointer position.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let frame = 0;
		let point = { x: 0, y: 0 };
		const hit = (x: number, y: number) => {
			for (let i = 0; i < rangesRef.current.length; i++) {
				for (const r of rangesRef.current[i].getClientRects()) {
					if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
						const m = markersRef.current[i];
						if (m) return { m, rect: r };
					}
				}
			}
			return null;
		};
		const selecting = () => {
			const sel = window.getSelection();
			return !!sel && !sel.isCollapsed;
		};
		const onMove = (e: MouseEvent) => {
			if (layerRef.current?.contains(e.target as Node)) return;
			if (e.buttons !== 0 || selecting()) {
				aim(null);
				return;
			}
			point = { x: e.clientX, y: e.clientY };
			if (frame !== 0) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				const h = hit(point.x, point.y);
				aim(h?.m.id ?? null, h?.rect);
			});
		};
		const onLeave = () => aim(null);
		const onClick = (e: MouseEvent) => {
			const t = e.target as Element;
			if (layerRef.current?.contains(t) || t.closest("a,button,input,textarea")) return;
			if (selecting()) return;
			const h = hit(e.clientX, e.clientY);
			if (!h) return;
			aim(null);
			if (pressClosed(h.m.id)) return;
			setActive({ id: h.m.id, anchor: h.rect });
		};
		container.addEventListener("mousemove", onMove);
		container.addEventListener("mouseleave", onLeave);
		container.addEventListener("click", onClick);
		return () => {
			if (frame !== 0) cancelAnimationFrame(frame);
			container.removeEventListener("mousemove", onMove);
			container.removeEventListener("mouseleave", onLeave);
			container.removeEventListener("click", onClick);
		};
	}, [containerRef, aim, pressClosed]);

	// Session switch: drop any open popover / pending hover.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on the session
	useEffect(() => {
		setActive(null);
		aim(null);
	}, [sessionId, aim]);
	useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

	const lookup = (id: string, kind: MarkerKind) => {
		const list = kind === "main" ? main : side;
		return list.find((a) => a.id === id);
	};
	const activeMarker = active ? markers.find((m) => m.id === active.id) : undefined;
	const activeAnn = activeMarker ? lookup(activeMarker.id, activeMarker.kind) : undefined;
	const hoverMarker = hover && !active ? markers.find((m) => m.id === hover.id) : undefined;
	const hoverAnn = hoverMarker ? lookup(hoverMarker.id, hoverMarker.kind) : undefined;

	return (
		<>
			<div
				ref={layerRef}
				className="pointer-events-none absolute left-0 top-0 h-0 w-full"
			>
				{markers.map((m) => (
					<button
						key={m.id}
						type="button"
						aria-label={m.title}
						onClick={(e) => {
							aim(null);
							if (pressClosed(m.id)) return;
							setActive({ id: m.id, anchor: e.currentTarget });
						}}
						onMouseEnter={(e) => aim(m.id, e.currentTarget)}
						onMouseLeave={() => aim(null)}
						style={{ top: m.top, left: m.left }}
						className={`pointer-events-auto absolute z-10 flex h-5 w-5 items-center justify-center rounded-full ${KIND_CLASS[m.kind]} text-[11px] leading-none text-white shadow-sm transition-transform hover:scale-110`}
					>
						{m.n}
					</button>
				))}
			</div>
			{active && activeMarker && activeAnn && (
				<AnnotationNotePopover
					key={active.id}
					anchor={active.anchor}
					storeKey={storeKeyOf(activeMarker.kind)}
					annotation={activeAnn}
					n={activeMarker.n}
					scrollTarget={containerRef.current}
					onClose={() => {
						closedAt.current = { id: active.id, at: performance.now() };
						setActive(null);
					}}
				/>
			)}
			{hover && hoverMarker && hoverAnn && (
				<AnnotationHoverCard anchor={hover.anchor} annotation={hoverAnn} n={hoverMarker.n} />
			)}
		</>
	);
}

/** Mounts inside the message scroll container. Renders nothing (and attaches no
 * observers) unless the session has message quotes. */
export function AnnotationMarkers({
	sessionId,
	containerRef,
}: {
	sessionId: string;
	containerRef: RefObject<HTMLElement | null>;
}) {
	const annotations = useComposer(
		(s) => s.annotations[sessionId] ?? EMPTY_ANNOTATIONS,
	);
	// Side-chat annotations staged for this session live under a sibling key;
	// they show as the same numbered markers in a different colour.
	const sideChatAnnotations = useComposer(
		(s) => s.annotations[sideChatAnnKey(sessionId)] ?? EMPTY_ANNOTATIONS,
	);
	const sources = useMemo(
		() => markerSources(annotations, sideChatAnnotations),
		[annotations, sideChatAnnotations],
	);
	if (sources.length === 0) return null;
	return (
		<MarkerLayer
			sessionId={sessionId}
			containerRef={containerRef}
			sources={sources}
		/>
	);
}
