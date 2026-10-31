import { X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
	startX: number;
	startY: number;
	startScale: number;
	multiTouch: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function ImageViewerHost() {
	const item = useSyncExternalStore(subscribe, getCurrent, getCurrent);
	const open = item !== null;
	const [chromeVisible, setChromeVisible] = useState(true);
	const tapTimer = useRef<number | undefined>(undefined);
	const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
	const clearTap = () => {
		window.clearTimeout(tapTimer.current);
		tapTimer.current = undefined;
		lastTap.current = null;
	};
	const close = () => {
		clearTap();
		setCurrent(null);
	};
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
		startX: 0,
		startY: 0,
		startScale: 1,
		multiTouch: false,
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
		clearTap();
		setChromeVisible(true);
		const s = g.current;
		s.scale = 1;
		s.x = 0;
		s.y = 0;
		s.pointers.clear();
		s.prevMid = null;
		s.multiTouch = false;
		apply(false);
	}, [src]);
	useEffect(() => () => window.clearTimeout(tapTimer.current), []);

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
		const points = s.pointers.values();
		const a = points.next().value;
		const b = points.next().value;
		if (!a) return { mid: { x: 0, y: 0 }, dist: 0 };
		if (!b) return { mid: { x: a.x, y: a.y }, dist: 0 };
		return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
	};

	const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!open || e.button !== 0 || (e.target as Element).closest("button")) return;
		const s = g.current;
		e.currentTarget.setPointerCapture(e.pointerId);
		s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
		if (s.pointers.size === 1) {
			s.moved = 0;
			s.downAt = e.timeStamp;
			s.startX = e.clientX;
			s.startY = e.clientY;
			s.startScale = s.scale;
			s.multiTouch = false;
		} else {
			s.multiTouch = true;
			clearTap();
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
		if (s.moved > TAP_MOVE_PX) clearTap();
		p.x = e.clientX;
		p.y = e.clientY;
		const m = midOf(s);
		const ratio = s.pointers.size >= 2 && s.prevDist > 0 ? m.dist / s.prevDist : 1;
		if (s.scale === 1 && ratio === 1) {
			s.prevMid = m.mid;
			s.prevDist = m.dist;
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
		const cancelled = e.type === "pointercancel" || e.type === "lostpointercapture";
		const dx = e.clientX - s.startX;
		const dy = e.clientY - s.startY;
		const wasTap = !cancelled && !s.multiTouch && s.moved <= TAP_MOVE_PX
			&& Math.hypot(dx, dy) <= TAP_MOVE_PX && e.timeStamp - s.downAt < 400 && s.pointers.size === 0;
		const m = midOf(s);
		s.prevMid = s.pointers.size > 0 ? m.mid : null;
		s.prevDist = m.dist;
		if (!wasTap) {
			clearTap();
			if (!cancelled && !s.multiTouch && s.pointers.size === 0 && s.startScale === 1 && s.scale === 1
				&& dy > 100 && dy > Math.abs(dx) * 1.5) close();
			return;
		}
		const previous = lastTap.current;
		if (previous && e.timeStamp - previous.at <= DOUBLE_TAP_MS
			&& Math.hypot(e.clientX - previous.x, e.clientY - previous.y) <= 32) {
			clearTap();
			const point = { x: e.clientX, y: e.clientY };
			if (s.scale > 1) transform(center(), center(), MIN_SCALE / s.scale);
			else transform(point, point, TAP_SCALE);
			apply(true);
			return;
		}
		if (previous) setChromeVisible((value) => !value);
		clearTap();
		lastTap.current = { at: e.timeStamp, x: e.clientX, y: e.clientY };
		tapTimer.current = window.setTimeout(() => {
			lastTap.current = null;
			tapTimer.current = undefined;
			setChromeVisible((value) => !value);
		}, DOUBLE_TAP_MS);
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
			onLostPointerCapture={onUp}
		>
			<img
				ref={imgRef}
				src={shown.src}
				alt={shown.alt ?? ""}
				draggable={false}
				className="max-h-full max-w-full object-contain will-change-transform"
			/>
			{chromeVisible && (
			<button
				type="button"
				aria-label="关闭"
				onClick={close}
				className="absolute right-2 flex min-h-11 min-w-11 items-center justify-center rounded-m-pill bg-m-surface text-m-text"
				style={{ top: "calc(var(--m-safe-top) + 8px)" }}
			>
				<X size={22} />
			</button>
			)}
		</div>,
		document.body,
	);
}
