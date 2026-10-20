/** [B] Numbered markers in the message stream: one round badge per message quote
 * annotation, sitting just above the first character of the quoted text. Numbers
 * come from `textAnnotationsOf`, the same numbering as the outgoing `[n]` blocks. */

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import {
	sideChatAnnKey,
	useComposer,
	type Annotation,
} from "../../stores/composer";
import { textAnnotationsOf } from "./annotations";
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

		const hit = locateQuote(item.text, src.quote);
		if (!hit) continue;
		const range = segmentRange(item.segments, hit.start, hit.end);
		if (!range) continue;
		// Anchor to the first line box of the quote, not the union rect: a
		// multi-line or indented selection's union starts far left of the text.
		const first =
			Array.from(range.getClientRects()).find((r) => r.width > 0) ??
			range.getBoundingClientRect();
		if (first.width === 0 && first.height === 0) continue;
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

	return (
		<div
			ref={layerRef}
			className="pointer-events-none absolute left-0 top-0 h-0 w-full"
		>
			{markers.map((m) => (
				<button
					key={m.id}
					type="button"
					title={m.title}
					aria-label={m.title}
					onClick={() =>
						useComposer
							.getState()
							.requestAnnotationEdit(m.kind === "main" ? sessionId : sideChatAnnKey(sessionId), m.id)
					}
					style={{ top: m.top, left: m.left }}
					className={`pointer-events-auto absolute z-10 flex h-5 w-5 items-center justify-center rounded-full ${KIND_CLASS[m.kind]} text-[11px] leading-none text-white shadow-sm transition-transform hover:scale-110`}
				>
					{m.n}
				</button>
			))}
		</div>
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
