import { X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useOverlay, usePresence } from "./overlay";

export interface ViewerImage {
	src: string;
	alt?: string;
}

let current: ViewerImage | null = null;
const listeners = new Set<() => void>();

function setCurrent(next: ViewerImage | null): void {
	current = next;
	for (const l of listeners) l();
}
function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
function getCurrent(): ViewerImage | null {
	return current;
}

export function openImage(src: string | ViewerImage): void {
	setCurrent(typeof src === "string" ? { src } : src);
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const TAP_SCALE = 2.5;
const TAP_MOVE_PX = 8;
const DOUBLE_TAP_MS = 300;

interface Gesture {
	scale: number;
	x: number;
	y: number;
	pointers: Map<number, { x: number; y: number }>;
	prevMid: { x: number; y: number } | null;
	prevDist: number;
	moved: number;
	downAt: number;
	lastTapAt: number;
	downOnImage: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function ImageViewerHost() {
	const item = useSyncExternalStore(subscribe, getCurrent, getCurrent);
	const open = item !== null;
	const close = () => setCurrent(null);
	const { mounted, visible } = usePresence(open, 200);
	useOverlay(open, close);
	// Keep the last image mounted while the exit transition plays.
	const lastRef = useRef<ViewerImage | null>(null);
	if (item) lastRef.current = item;
	const shown = item ?? lastRef.current;

	const imgRef = useRef<HTMLImageElement>(null);
	const g = useRef<Gesture>({
		scale: 1,
		x: 0,
		y: 0,
		pointers: new Map(),
		prevMid: null,
		prevDist: 0,
		moved: 0,
		downAt: 0,
		lastTapAt: 0,
		downOnImage: false,
	});

	const apply = (animate: boolean) => {
		const img = imgRef.current;
		if (!img) return;
		const s = g.current;
		img.style.transition = animate ? "transform 200ms var(--m-ease)" : "none";
		img.style.transform = `translate3d(${s.x}px,${s.y}px,0) scale(${s.scale})`;
	};

	const src = item?.src;
	useEffect(() => {
		const s = g.current;
		s.scale = 1;
		s.x = 0;
		s.y = 0;
		s.pointers.clear();
		s.prevMid = null;
		s.lastTapAt = 0;
		apply(false);
	}, [src]);

	if (!mounted || !shown) return null;

	const center = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

	/** Re-anchors so the content point that was under `from` ends up under `to`, scaling by `ratio`. */
	const transform = (from: { x: number; y: number }, to: { x: number; y: number }, ratio: number) => {
		const s = g.current;
		const c = center();
		const next = clamp(s.scale * ratio, MIN_SCALE, MAX_SCALE);
		const r = next / s.scale;
		let x = to.x - c.x - r * (from.x - c.x - s.x);
		let y = to.y - c.y - r * (from.y - c.y - s.y);
		const maxX = ((next - 1) * window.innerWidth) / 2;
		const maxY = ((next - 1) * window.innerHeight) / 2;
		x = clamp(x, -maxX, maxX);
		y = clamp(y, -maxY, maxY);
		s.scale = next;
		s.x = next === 1 ? 0 : x;
		s.y = next === 1 ? 0 : y;
	};

	const midOf = (s: Gesture) => {
		const pts = [...s.pointers.values()];
		const a = pts[0];
		const b = pts[1];
		if (!a) return { mid: { x: 0, y: 0 }, dist: 0 };
		if (!b) return { mid: { x: a.x, y: a.y }, dist: 0 };
		return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
	};

	const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if ((e.target as HTMLElement).closest("button")) return;
		const s = g.current;
		e.currentTarget.setPointerCapture(e.pointerId);
		s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (s.pointers.size === 1) {
			s.moved = 0;
			s.downAt = e.timeStamp;
			// Pointer capture retargets later events to the container, so remember the original target now.
			s.downOnImage = e.target === imgRef.current;
		} else {
			s.moved = TAP_MOVE_PX + 1;
		}
		const m = midOf(s);
		s.prevMid = m.mid;
		s.prevDist = m.dist;
	};

	const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const s = g.current;
		const p = s.pointers.get(e.pointerId);
		if (!p || !s.prevMid) return;
		s.moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
		p.x = e.clientX;
		p.y = e.clientY;
		const m = midOf(s);
		const ratio = s.pointers.size >= 2 && s.prevDist > 0 ? m.dist / s.prevDist : 1;
		if (s.scale === 1 && ratio === 1) {
			s.prevMid = m.mid;
			return;
		}
		transform(s.prevMid, m.mid, ratio);
		s.prevMid = m.mid;
		s.prevDist = m.dist;
		apply(false);
	};

	const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
		const s = g.current;
		if (!s.pointers.delete(e.pointerId)) return;
		const wasTap = s.moved <= TAP_MOVE_PX && e.timeStamp - s.downAt < 400 && s.pointers.size === 0;
		const m = midOf(s);
		s.prevMid = s.pointers.size > 0 ? m.mid : null;
		s.prevDist = m.dist;
		if (!wasTap) return;
		if (!s.downOnImage) {
			close();
			return;
		}
		// The second tap of a double-tap must not undo the zoom the first one applied.
		if (e.timeStamp - s.lastTapAt < DOUBLE_TAP_MS) {
			s.lastTapAt = 0;
			return;
		}
		s.lastTapAt = e.timeStamp;
		const point = { x: e.clientX, y: e.clientY };
		if (s.scale > 1) transform(center(), center(), MIN_SCALE / s.scale);
		else transform(point, point, TAP_SCALE);
		apply(true);
	};

	return createPortal(
		<div
			role="dialog"
			aria-modal="true"
			aria-label={shown.alt ?? "图片预览"}
			className={`fixed inset-0 z-(--z-modal) flex touch-none select-none items-center justify-center bg-m-scrim transition-opacity duration-200 ease-(--m-ease) ${visible ? "opacity-100" : "opacity-0"}`}
			onPointerDown={onDown}
			onPointerMove={onMove}
			onPointerUp={onUp}
			onPointerCancel={onUp}
		>
			<img
				ref={imgRef}
				src={shown.src}
				alt={shown.alt ?? ""}
				draggable={false}
				className="max-h-full max-w-full object-contain will-change-transform"
			/>
			<button
				type="button"
				aria-label="关闭"
				onClick={close}
				className="absolute right-2 flex min-h-11 min-w-11 items-center justify-center rounded-m-pill bg-m-surface text-m-text"
				style={{ top: "calc(var(--m-safe-top) + 8px)" }}
			>
				<X size={22} />
			</button>
		</div>,
		document.body,
	);
}
