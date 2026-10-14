import {
	Check,
	Circle,
	Eraser,
	Minus,
	MousePointer2,
	Redo2,
	Shapes,
	Signature,
	Square,
	Type,
	Undo2,
	X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
	CSSProperties,
	PointerEvent as ReactPointerEvent,
	ReactElement,
	RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Z_LAYER } from "../../../components/FloatingLayer";
import { useEscapeKey } from "../../../lib/hooks";
import {
	addItem,
	commitErase,
	dropItems,
	emptySketch,
	hasInk,
	hitItem,
	hitTest,
	moveItem,
	redo,
	translateItem,
	undo,
} from "./sketchState";
import type {
	RemovedItem,
	ShapeKind,
	SketchItem,
	SketchPoint,
	SketchState,
} from "./sketchState";

export interface SketchPadProps {
	/** Called with a `data:image/png` URL of the finished sketch. */
	onInsert(dataUrl: string): void;
	onCancel(): void;
	/** Composer card element: the pad docks directly above it. */
	anchor?: RefObject<HTMLElement | null>;
}

type Tool = "select" | "draw" | "text" | "shapes" | "eraser";

/** In-flight gesture rendered but not yet committed to the op log. */
type Preview =
	| { kind: "stroke"; item: Extract<SketchItem, { kind: "stroke" }> }
	| { kind: "shape"; item: Extract<SketchItem, { kind: "shape" }> }
	| { kind: "move"; id: string; dx: number; dy: number };

const SWATCHES = [
	"#ffffff",
	"#98989d",
	"#a0642f",
	"#e5483f",
	"#f2913d",
	"#eec758",
	"#4caf50",
	"#2fa98c",
	"#55c7dd",
	"#3f8cff",
	"#6366f1",
	"#a855f7",
	"#ec4899",
] as const;

const TOOLS: { id: Tool; Icon: typeof Signature; label: string }[] = [
	{ id: "select", Icon: MousePointer2, label: "选择" },
	{ id: "draw", Icon: Signature, label: "画笔" },
	{ id: "text", Icon: Type, label: "文字" },
	{ id: "shapes", Icon: Shapes, label: "形状" },
	{ id: "eraser", Icon: Eraser, label: "橡皮擦" },
];

const SHAPE_OPTIONS: { kind: ShapeKind; Icon: typeof Square; label: string }[] =
	[
		{ kind: "rect", Icon: Square, label: "矩形" },
		{ kind: "ellipse", Icon: Circle, label: "椭圆" },
		{ kind: "line", Icon: Minus, label: "直线" },
	];

const PANEL_TOP = 64;
const PANEL_GAP = 6; // gap between panel bottom and composer top
const PANEL_MIN_H = 320;
const ERASE_RADIUS = 12;
const SELECT_RADIUS = 10;
const MIN_W = 2;
const MAX_W = 24;
const TRACK_H = 180;
const KNOB = 26;
const TEXT_SIZE = 16;

function paintStroke(
	ctx: CanvasRenderingContext2D,
	item: Extract<SketchItem, { kind: "stroke" }>,
): void {
	const pts = item.points;
	if (pts.length === 0) return;
	ctx.strokeStyle = item.color;
	ctx.fillStyle = item.color;
	ctx.lineWidth = item.width;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	if (pts.length === 1) {
		ctx.beginPath();
		ctx.arc(pts[0].x, pts[0].y, item.width / 2, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	ctx.beginPath();
	ctx.moveTo(pts[0].x, pts[0].y);
	if (pts.length === 2) {
		ctx.lineTo(pts[1].x, pts[1].y);
	} else {
		for (let i = 1; i < pts.length - 1; i++) {
			const midX = (pts[i].x + pts[i + 1].x) / 2;
			const midY = (pts[i].y + pts[i + 1].y) / 2;
			ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
		}
		const last = pts[pts.length - 1];
		ctx.lineTo(last.x, last.y);
	}
	ctx.stroke();
}

function paintShape(
	ctx: CanvasRenderingContext2D,
	item: Extract<SketchItem, { kind: "shape" }>,
): void {
	const left = Math.min(item.x1, item.x2);
	const top = Math.min(item.y1, item.y2);
	const w = Math.abs(item.x2 - item.x1);
	const h = Math.abs(item.y2 - item.y1);
	ctx.strokeStyle = item.color;
	ctx.lineWidth = item.width;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	if (item.shape === "rect") {
		ctx.rect(left, top, w, h);
	} else if (item.shape === "ellipse") {
		ctx.ellipse(
			left + w / 2,
			top + h / 2,
			Math.max(w / 2, 0.5),
			Math.max(h / 2, 0.5),
			0,
			0,
			Math.PI * 2,
		);
	} else {
		ctx.moveTo(item.x1, item.y1);
		ctx.lineTo(item.x2, item.y2);
	}
	ctx.stroke();
}

function paintItem(ctx: CanvasRenderingContext2D, item: SketchItem): void {
	if (item.kind === "stroke") paintStroke(ctx, item);
	else if (item.kind === "shape") paintShape(ctx, item);
	else {
		ctx.fillStyle = item.color;
		ctx.font = `${item.size}px -apple-system, system-ui, sans-serif`;
		ctx.textBaseline = "alphabetic";
		ctx.fillText(item.text, item.x, item.y);
	}
}

function itemBounds(item: SketchItem): {
	left: number;
	top: number;
	right: number;
	bottom: number;
} {
	if (item.kind === "stroke") {
		const xs = item.points.map((p) => p.x);
		const ys = item.points.map((p) => p.y);
		const pad = item.width / 2;
		return {
			left: Math.min(...xs) - pad,
			top: Math.min(...ys) - pad,
			right: Math.max(...xs) + pad,
			bottom: Math.max(...ys) + pad,
		};
	}
	if (item.kind === "text") {
		const w = Math.max(item.text.length * item.size * 0.6, item.size);
		return { left: item.x, top: item.y - item.size, right: item.x + w, bottom: item.y };
	}
	const pad = item.width / 2;
	return {
		left: Math.min(item.x1, item.x2) - pad,
		top: Math.min(item.y1, item.y2) - pad,
		right: Math.max(item.x1, item.x2) + pad,
		bottom: Math.max(item.y1, item.y2) + pad,
	};
}

/** Repaint the whole pad: dark panel surface, then every item plus the
 *  in-flight preview. Item coords are stored in CSS px; dpr scales the
 *  backing store only. */
function paint(
	canvas: HTMLCanvasElement,
	dpr: number,
	bg: string,
	state: SketchState,
	preview: Preview | null,
	selectedId: string | null,
): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) return; // jsdom: no 2d backend — drawing silently no-ops.
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	const w = canvas.width / dpr;
	const h = canvas.height / dpr;
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, w, h);
	const items =
		preview?.kind === "move"
			? state.items.map((i) =>
					i.id === preview.id ? translateItem(i, preview.dx, preview.dy) : i,
				)
			: state.items;
	for (const item of items) paintItem(ctx, item);
	if (preview?.kind === "stroke" || preview?.kind === "shape") {
		paintItem(ctx, preview.item);
	}
	const selected = selectedId ? items.find((i) => i.id === selectedId) : null;
	if (selected) {
		const b = itemBounds(selected);
		ctx.setLineDash([4, 4]);
		ctx.strokeStyle = "rgba(255,255,255,0.35)";
		ctx.lineWidth = 1;
		ctx.strokeRect(b.left - 4, b.top - 4, b.right - b.left + 8, b.bottom - b.top + 8);
		ctx.setLineDash([]);
	}
}

/**
 * Codex-style sketch pad: a dark panel docked above the composer whose PNG
 * export is inserted like any other image attachment.
 */
export function SketchPad({
	onInsert,
	onCancel,
	anchor,
}: SketchPadProps): ReactElement {
	const [state, setState] = useState<SketchState>(emptySketch);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [tool, setTool] = useState<Tool>("draw");
	const [shape, setShape] = useState<ShapeKind>("rect");
	const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
	const [color, setColor] = useState<string>("#ffffff");
	const [customColor, setCustomColor] = useState<string>("#ffffff");
	const [width, setWidth] = useState(6);
	const [layout, setLayout] = useState<{
		left: number;
		top: number;
		width: number;
		height: number;
	} | null>(null);
	const [textDraft, setTextDraft] = useState<SketchPoint | null>(null);
	const [textValue, setTextValue] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [pointerPos, setPointerPos] = useState<SketchPoint | null>(null);

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const colorInputRef = useRef<HTMLInputElement>(null);
	const sliderRef = useRef<HTMLDivElement>(null);
	const dprRef = useRef(1);
	const bgRef = useRef("#1e1e20");
	const idRef = useRef(0);
	// Gesture bookkeeping: non-null while the matching drag is live.
	const strokeRef = useRef<Extract<SketchItem, { kind: "stroke" }> | null>(null);
	const shapeStartRef = useRef<SketchPoint | null>(null);
	const moveRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
	const moveStartRef = useRef<SketchPoint | null>(null);
	const eraseRef = useRef<RemovedItem[] | null>(null);
	const sliderDragRef = useRef(false);

	// Esc closes the pad, but never while the text input is focused — there
	// Esc only cancels the input.
	useEscapeKey(onCancel, textDraft === null);

	// Measure the anchor rect: pad spans the composer column, docked 6px
	// above it; falls back to a centered modal when the anchor is unusable.
	useLayoutEffect(() => {
		const measure = () => {
			const r = anchor?.current?.getBoundingClientRect();
			if (!r || r.width < 40 || r.top <= 0) {
				setLayout(null);
				return;
			}
			let top = PANEL_TOP;
			let height = r.top - PANEL_GAP - top;
			if (height < PANEL_MIN_H) {
				top = r.top - PANEL_GAP - PANEL_MIN_H;
				height = PANEL_MIN_H;
			}
			if (top < 8) {
				top = 8;
				height = r.top - PANEL_GAP - top;
			}
			if (height < 160) {
				setLayout(null);
				return;
			}
			setLayout({ left: r.left, top, width: r.width, height });
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [anchor]);

	// Size the DPR-scaled backing store to the panel and capture the panel
	// background so the PNG export bakes the same dark surface.
	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		dprRef.current = dpr;
		const bg = getComputedStyle(canvas)
			.getPropertyValue("--bg-panel")
			.trim();
		if (bg) bgRef.current = bg;
		const cssW = canvas.clientWidth > 0 ? canvas.clientWidth : 640;
		const cssH = canvas.clientHeight > 0 ? canvas.clientHeight : 360;
		canvas.width = Math.max(1, Math.round(cssW * dpr));
		canvas.height = Math.max(1, Math.round(cssH * dpr));
		paint(canvas, dpr, bgRef.current, state, preview, selectedId);
		// First paint only; redraws are driven by the state effect below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [layout]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (canvas) {
			paint(canvas, dprRef.current, bgRef.current, state, preview, selectedId);
		}
	}, [state, preview, selectedId]);

	const localPoint = (e: ReactPointerEvent): SketchPoint => {
		const r = canvasRef.current?.getBoundingClientRect();
		return {
			x: e.clientX - (r?.left ?? 0),
			y: e.clientY - (r?.top ?? 0),
		};
	};

	const nextId = () => `item-${++idRef.current}`;

	const eraseAt = (p: SketchPoint) => {
		if (!eraseRef.current) return;
		const hits: RemovedItem[] = [];
		state.items.forEach((item, index) => {
			if (hitItem(item, p.x, p.y, ERASE_RADIUS)) hits.push({ item, index });
		});
		if (hits.length === 0) return;
		eraseRef.current.push(...hits);
		setState((s) => dropItems(s, new Set(hits.map((h) => h.item.id))));
	};

	const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		if (e.button !== 0 || textDraft) return;
		try {
			e.currentTarget.setPointerCapture(e.pointerId);
		} catch {
			// jsdom has no pointer capture; drawing still works without it.
		}
		const p = localPoint(e);
		if (tool === "draw") {
			strokeRef.current = {
				kind: "stroke",
				id: nextId(),
				color,
				width,
				points: [p],
			};
			setPreview({ kind: "stroke", item: strokeRef.current });
		} else if (tool === "shapes") {
			shapeStartRef.current = p;
			setPreview({
				kind: "shape",
				item: {
					kind: "shape",
					id: nextId(),
					shape,
					x1: p.x,
					y1: p.y,
					x2: p.x,
					y2: p.y,
					color,
					width,
				},
			});
		} else if (tool === "select") {
			const hit = hitTest(state, p.x, p.y, SELECT_RADIUS);
			moveRef.current = hit ? { id: hit.id, dx: 0, dy: 0 } : null;
			moveStartRef.current = hit ? p : null;
			setSelectedId(hit?.id ?? null);
		} else if (tool === "eraser") {
			eraseRef.current = [];
			eraseAt(p);
		} else if (tool === "text") {
			setTextDraft(p);
			setTextValue("");
		}
	};

	const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		const p = localPoint(e);
		setPointerPos(p);
		const strokeStart = strokeRef.current?.points[0];
		if (strokeRef.current && strokeStart) {
			strokeRef.current = {
				...strokeRef.current,
				points: [...strokeRef.current.points, p],
			};
			setPreview({ kind: "stroke", item: strokeRef.current });
			return;
		}
		if (shapeStartRef.current && preview?.kind === "shape") {
			setPreview({
				kind: "shape",
				item: { ...preview.item, x2: p.x, y2: p.y },
			});
			return;
		}
		if (moveRef.current) {
			moveRef.current = {
				id: moveRef.current.id,
				dx: p.x - (moveStartRef.current?.x ?? p.x),
				dy: p.y - (moveStartRef.current?.y ?? p.y),
			};
			setPreview({
				kind: "move",
				id: moveRef.current.id,
				dx: moveRef.current.dx,
				dy: moveRef.current.dy,
			});
			return;
		}
		if (eraseRef.current) eraseAt(p);
	};

	const onPointerUp = () => {
		if (strokeRef.current) {
			const stroke = strokeRef.current;
			strokeRef.current = null;
			setPreview(null);
			if (stroke.points.length > 0) setState((s) => addItem(s, stroke));
		}
		if (shapeStartRef.current) {
			shapeStartRef.current = null;
			const item = preview?.kind === "shape" ? preview.item : null;
			setPreview(null);
			if (item && Math.hypot(item.x2 - item.x1, item.y2 - item.y1) >= 4) {
				setState((s) => addItem(s, item));
			}
		}
		if (moveRef.current) {
			const { id, dx, dy } = moveRef.current;
			moveRef.current = null;
			moveStartRef.current = null;
			setPreview(null);
			if (dx !== 0 || dy !== 0) setState((s) => moveItem(s, id, dx, dy));
		}
		if (eraseRef.current) {
			const removed = eraseRef.current;
			eraseRef.current = null;
			if (removed.length > 0) setState((s) => commitErase(s, removed));
		}
	};

	const commitText = () => {
		if (!textDraft) return;
		const text = textValue;
		setTextDraft(null);
		setTextValue("");
		if (text.trim().length === 0) return;
		setState((s) =>
			addItem(s, {
				kind: "text",
				id: nextId(),
				x: textDraft.x,
				y: textDraft.y,
				text,
				color,
				size: TEXT_SIZE,
			}),
		);
	};

	const handleInsert = () => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		paint(canvas, dprRef.current, bgRef.current, state, null, null);
		onInsert(canvas.toDataURL("image/png"));
	};

	const setWidthFromClientY = (clientY: number) => {
		const r = sliderRef.current?.getBoundingClientRect();
		if (!r || r.height <= KNOB) return;
		const t = Math.min(1, Math.max(0, (clientY - r.top - KNOB / 2) / (r.height - KNOB)));
		setWidth(Math.round(MAX_W - t * (MAX_W - MIN_W)));
	};

	const cursor =
		tool === "draw" || tool === "shapes"
			? "cursor-crosshair"
			: tool === "text"
				? "cursor-text"
				: tool === "eraser"
					? "cursor-none"
					: "cursor-default";

	const padStyle: CSSProperties = layout
		? {
				left: layout.left,
				top: layout.top,
				width: layout.width,
				height: layout.height,
				zIndex: Z_LAYER.modal,
			}
		: {
				left: "50%",
				top: "50%",
				transform: "translate(-50%, -50%)",
				width: "min(720px, calc(100vw - 48px))",
				height: "min(480px, calc(100vh - 160px))",
				zIndex: Z_LAYER.modal,
			};

	const knobTop =
		(1 - (width - MIN_W) / (MAX_W - MIN_W)) * (TRACK_H - KNOB);
	const iconBtn =
		"flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-neutral-400";

	return createPortal(
		<div
			role="dialog"
			aria-modal="true"
			aria-label="草图"
			className="hairline fixed overflow-hidden rounded-2xl bg-[var(--bg-panel)] shadow-[0_12px_48px_rgba(0,0,0,0.55)]"
			style={padStyle}
		>
			<canvas
				ref={canvasRef}
				className={`block h-full w-full touch-none ${cursor}`}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onPointerLeave={() => setPointerPos(null)}
			/>

			{/* Close — top-left */}
			<button
				type="button"
				title="关闭"
				onClick={onCancel}
				className="absolute left-4 top-3.5 flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-200"
			>
				<X className="h-5 w-5" />
			</button>

			{/* Tool pill — top-center */}
			<div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-white/[0.08] p-1">
				{TOOLS.map(({ id, Icon, label }) => (
					<button
						key={id}
						type="button"
						title={label}
						onClick={() => {
							if (id === "shapes") {
								if (tool === "shapes") setShapeMenuOpen((v) => !v);
								else {
									setTool("shapes");
									setShapeMenuOpen(true);
								}
							} else {
								setTool(id);
								setShapeMenuOpen(false);
							}
						}}
						className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
							tool === id
								? "bg-white/15 text-neutral-100"
								: "text-neutral-400 hover:text-neutral-200"
						}`}
					>
						<Icon className="h-[18px] w-[18px]" />
					</button>
				))}
			</div>

			{/* Shape picker popover under the pill */}
			{shapeMenuOpen && (
				<div className="absolute left-1/2 top-[52px] flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-white/[0.08] p-1">
					{SHAPE_OPTIONS.map(({ kind, Icon, label }) => (
						<button
							key={kind}
							type="button"
							title={label}
							onClick={() => {
								setShape(kind);
								setTool("shapes");
								setShapeMenuOpen(false);
							}}
							className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
								tool === "shapes" && shape === kind
									? "bg-white/15 text-neutral-100"
									: "text-neutral-400 hover:text-neutral-200"
							}`}
						>
							<Icon className="h-4 w-4" />
						</button>
					))}
				</div>
			)}

			{/* Undo / redo — top-right */}
			<div className="absolute right-4 top-3.5 flex items-center gap-0.5">
				<button
					type="button"
					title="撤销"
					onClick={() => setState(undo)}
					disabled={state.undoStack.length === 0}
					className={iconBtn}
				>
					<Undo2 className="h-[18px] w-[18px]" />
				</button>
				<button
					type="button"
					title="重做"
					onClick={() => setState(redo)}
					disabled={state.redoStack.length === 0}
					className={iconBtn}
				>
					<Redo2 className="h-[18px] w-[18px]" />
				</button>
			</div>

			{/* Brush-size slider — left edge, vertically centered */}
			<div
				ref={sliderRef}
				role="slider"
				aria-label="画笔粗细"
				aria-valuemin={MIN_W}
				aria-valuemax={MAX_W}
				aria-valuenow={width}
				className="absolute left-5 top-1/2 -translate-y-1/2 touch-none"
				style={{ width: KNOB, height: TRACK_H }}
				onPointerDown={(e) => {
					if (e.button !== 0) return;
					try {
						e.currentTarget.setPointerCapture(e.pointerId);
					} catch {
						// jsdom: no pointer capture.
					}
					sliderDragRef.current = true;
					setWidthFromClientY(e.clientY);
				}}
				onPointerMove={(e) => {
					if (sliderDragRef.current) setWidthFromClientY(e.clientY);
				}}
				onPointerUp={() => {
					sliderDragRef.current = false;
				}}
			>
				<div className="absolute bottom-0 left-1/2 top-0 w-[2px] -translate-x-1/2 rounded-full bg-white/20" />
				<div
					className="absolute left-0 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
					style={{ top: knobTop, width: KNOB, height: KNOB }}
				/>
			</div>

			{/* Eraser cursor */}
			{tool === "eraser" && pointerPos && (
				<div
					className="pointer-events-none absolute h-6 w-6 rotate-45 rounded-[4px] border border-white/60 bg-white/15"
					style={{
						left: pointerPos.x - 12,
						top: pointerPos.y - 12,
					}}
				/>
			)}

			{/* Text entry at click point */}
			{textDraft && (
				<input
					autoFocus
					value={textValue}
					onChange={(e) => setTextValue(e.target.value)}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter") commitText();
						else if (e.key === "Escape") {
							setTextDraft(null);
							setTextValue("");
						}
					}}
					onBlur={commitText}
					className="absolute z-10 border-none bg-transparent text-[16px] leading-6 text-white outline-none"
					style={{ left: textDraft.x, top: textDraft.y - TEXT_SIZE + 2, width: 240 }}
				/>
			)}

			{/* Color palette — bottom-center */}
			<div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2.5">
				<button
					type="button"
					title="自定义颜色"
					onClick={() => colorInputRef.current?.click()}
					className="h-[22px] w-[22px] rounded-full transition-transform hover:scale-110"
					style={{
						background:
							"conic-gradient(red, orange, yellow, green, cyan, blue, magenta, red)",
						boxShadow:
							color === customColor
								? "0 0 0 2px var(--bg-panel), 0 0 0 4px #4c8dff"
								: "none",
					}}
				/>
				{SWATCHES.map((hex) => (
					<button
						key={hex}
						type="button"
						title={hex}
						onClick={() => setColor(hex)}
						className="h-[22px] w-[22px] rounded-full transition-transform hover:scale-110"
						style={{
							backgroundColor: hex,
							boxShadow:
								color === hex && hex !== customColor
									? "0 0 0 2px var(--bg-panel), 0 0 0 4px #4c8dff"
									: "none",
						}}
					/>
				))}
				<input
					ref={colorInputRef}
					type="color"
					value={customColor}
					onChange={(e) => {
						setCustomColor(e.target.value);
						setColor(e.target.value);
					}}
					className="pointer-events-none absolute h-0 w-0 opacity-0"
					tabIndex={-1}
					aria-hidden="true"
				/>
			</div>

			{/* Confirm — bottom-right */}
			<button
				type="button"
				title="完成"
				onClick={handleInsert}
				disabled={!hasInk(state)}
				className="absolute bottom-4 right-5 flex h-10 w-10 items-center justify-center rounded-full bg-[#48484a] text-white transition-colors hover:bg-[#5a5a5e] disabled:opacity-40 disabled:hover:bg-[#48484a]"
			>
				<Check className="h-5 w-5" />
			</button>
		</div>,
		document.body,
	);
}
