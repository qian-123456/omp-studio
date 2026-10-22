/**
 * SketchPad — 1:1 replica of the ChatGPT composer sketch editor modal.
 *
 * Structure mirrors the real editor:
 *   portal → transparent overlay → centered dialog → Surface
 *   Surface layers: CommittedCanvas / LiveStrokeCanvas / TextLayer (DOM) /
 *   OverlayCanvas / BrushCursor, plus floating top bar, size slider and
 *   color bar inside the dialog.
 *
 * All document state and object rendering live in sketchState.ts
 * (`createSketchEditor` + `renderSketch*`); this file wires pointer/keyboard
 * input, the canvas layer stack and the modal chrome.
 */
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type {
	ClipboardEvent as ReactClipboardEvent,
	CSSProperties,
	KeyboardEvent as ReactKeyboardEvent,
	MouseEvent as ReactMouseEvent,
	PointerEvent as ReactPointerEvent,
	ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { themeById, useResolvedThemeId } from "../../../lib/theme";
import {
	createSketchEditor,
	layoutText,
	renderEraserTrail,
	renderSketchDocument,
	renderSketchObject,
	TEXT_FONT_FAMILY,
} from "./sketchState";
import type {
	Bounds,
	PointerSample,
	ShapeKind,
	SketchDoc,
	SketchEditor,
	SketchItem,
	SketchPoint,
	SketchSnapshot,
	SketchTextEditInput,
	SketchTool,
	SnapGuide,
	StrokeStyle,
	TextFormat,
} from "./sketchState";
import {
	IconArrow,
	IconCheck,
	IconClose,
	IconDiamond,
	IconEllipse,
	IconEraser,
	IconHeart,
	IconLine,
	IconPen,
	IconRectangle,
	IconRedo,
	IconSelect,
	IconShapes,
	IconStar,
	IconText,
	IconTriangle,
	IconUndo,
} from "./sketchIcons";
import type { SketchIconProps } from "./sketchIcons";
import { claimEscape, isEscapeClaimed } from "../../../lib/escapeClaim";

export interface SketchPadProps {
	/** Called with a `data:image/png` URL of the finished sketch. */
	onInsert(dataUrl: string): void;
	onCancel(): void;
	/** Optional composer top edge, retained for interface compatibility. */
	composerTop?: number | null;
}

/* ------------------------------------------------------------------ */

const TOOL_ORDER: readonly SketchTool[] = [
	"select",
	"pen",
	"text",
	"shapes",
	"eraser",
];
const SHAPE_ORDER: readonly ShapeKind[] = [
	"line",
	"arrow",
	"rectangle",
	"ellipse",
	"triangle",
	"diamond",
	"star",
	"heart",
];
const DRAW_TOOLS: Record<string, true> = {
	pen: true,
	shapes: true,
	eraser: true,
};

/** Last shape picked from the popover, remembered across sketch sessions. */
const SHAPE_KIND_STORAGE_KEY = "ompws:sketch-shape-kind";

/** Canvas surface colors follow the app theme, mirroring ChatGPT's sketch modal. */
const CANVAS_BG_DARK = "#212121";
/** Dialog geometry: symmetric padding inset (px) inside overlay. */
const SKETCH_INSET = 48;
const CANVAS_BG_LIGHT = "#ffffff";
const SELECTION_BLUE = "#2563eb";
const CUSTOM_GRADIENT =
	"conic-gradient(from 210deg, #ff375f 0deg, #ff9f0a 48deg, #ffd60a 92deg, #30d158 142deg, #64d2ff 202deg, #0a84ff 242deg, #5e5ce6 282deg, #bf5af2 324deg, #ff375f 360deg)";

const SWATCHES: readonly { color: string; name: string }[] = [
	{ color: "#ffffff", name: "白色" },
	{ color: "#6b7280", name: "灰色" },
	{ color: "#92400e", name: "棕色" },
	{ color: "#dc2626", name: "红色" },
	{ color: "#f97316", name: "橙色" },
	{ color: "#f59e0b", name: "黄色" },
	{ color: "#16a34a", name: "绿色" },
	{ color: "#0d9488", name: "青绿色" },
	{ color: "#06b6d4", name: "青色" },
	{ color: "#2563eb", name: "蓝色" },
	{ color: "#4f46e5", name: "靛蓝" },
	{ color: "#9333ea", name: "紫色" },
	{ color: "#db2777", name: "粉色" },
];

const TEXT_FONT_PX = 24;
const TEXT_LINE_HEIGHT = 1.25;
const TEXT_PADDING = 8;
const TEXT_MIN = 8;
const TEXT_MAX = 128;
const TEXT_INITIAL_WIDTH = 240;
const TEXT_OPTICAL_OFFSET = 1;

const BASE_TOLERANCE = 10;
const MOUSE_HANDLE_TOLERANCE = 7;
const TOUCH_HANDLE_TOLERANCE = 14;
const MIN_SIDE_HANDLE_SPACING = 20;
const MIN_CORNER_HANDLE_SPACING = 28;
const SNAP_TOLERANCE = 6;
const PASTE_OFFSET = 12;

const HANDLE_SIZE = 10;
const SELECTION_LINE_WIDTH = 1.5;
const GUIDE_LINE_WIDTH = 1.25;
const GUIDE_EXTEND = 6;
const GUIDE_ALPHA = 0.72;
const ERASER_MIN = 4;
const ERASER_MAX = 96;

const CLIPBOARD_MIME = "application/x-openai-sketch-canvas-object";
const KEY_HINTS =
	"Meta+C Control+C Meta+V Control+V Meta+Z Control+Z Meta+Shift+Z " +
	"Control+Shift+Z Control+Y Enter Space Delete Escape ArrowUp ArrowDown " +
	"ArrowLeft ArrowRight";

const ARROW_KEYS: Record<string, true> = {
	ArrowUp: true,
	ArrowDown: true,
	ArrowLeft: true,
	ArrowRight: true,
};
const SLIDER_KEYS: Record<string, true> = {
	ArrowDown: true,
	ArrowLeft: true,
	ArrowRight: true,
	ArrowUp: true,
	End: true,
	Home: true,
	PageDown: true,
	PageUp: true,
};

const TOOL_LABELS: Record<SketchTool, string> = {
	select: "选择",
	pen: "画笔",
	text: "文字",
	shapes: "形状",
	eraser: "橡皮",
};
const SHAPE_LABELS: Record<ShapeKind, string> = {
	line: "直线",
	arrow: "箭头",
	rectangle: "矩形",
	ellipse: "椭圆",
	triangle: "三角形",
	diamond: "菱形",
	star: "星形",
	heart: "心形",
};
const TOOL_ICONS: Record<SketchTool, (props: SketchIconProps) => ReactElement> = {
	select: IconSelect,
	pen: IconPen,
	text: IconText,
	shapes: IconShapes,
	eraser: IconEraser,
};
const SHAPE_ICONS: Record<
	ShapeKind,
	(props: SketchIconProps) => ReactElement
> = {
	line: IconLine,
	arrow: IconArrow,
	rectangle: IconRectangle,
	ellipse: IconEllipse,
	triangle: IconTriangle,
	diamond: IconDiamond,
	star: IconStar,
	heart: IconHeart,
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function clamp(v: number, min: number, max: number): number {
	return v < min ? min : v > max ? max : v;
}

function isEditableTarget(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		target.closest(
			'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
		) != null
	);
}

/** Document driving overlays and the DOM text layer: while an eraser
 *  gesture runs the erasure preview replaces committed objects. */
function overlayDocument(snap: SketchSnapshot): SketchDoc {
	return snap.erasurePreview ?? snap.document;
}

function itemBounds(item: SketchItem): Bounds {
	switch (item.kind) {
		case "stroke":
		case "ink": {
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (const p of item.points) {
				minX = Math.min(minX, p.x);
				minY = Math.min(minY, p.y);
				maxX = Math.max(maxX, p.x);
				maxY = Math.max(maxY, p.y);
			}
			if (!Number.isFinite(minX)) {
				return { x: 0, y: 0, width: 0, height: 0 };
			}
			const half = item.style.width / 2;
			return {
				x: minX - half,
				y: minY - half,
				width: maxX - minX + item.style.width,
				height: maxY - minY + item.style.width,
			};
		}
		case "line":
		case "arrow": {
			const half = item.style.width / 2;
			const x = Math.min(item.from.x, item.to.x);
			const y = Math.min(item.from.y, item.to.y);
			return {
				x: x - half,
				y: y - half,
				width: Math.abs(item.to.x - item.from.x) + item.style.width,
				height: Math.abs(item.to.y - item.from.y) + item.style.width,
			};
		}
		default:
			return item.bounds;
	}
}

/* ------------------------------------------------------------------ *
 * Canvas plumbing (DPR sizing; objects themselves come from sketchState)
 * ------------------------------------------------------------------ */

function prepareCanvas(
	canvas: HTMLCanvasElement,
	size: { width: number; height: number },
): CanvasRenderingContext2D | null {
	const dpr = canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
	const w = Math.max(1, Math.round(size.width * dpr));
	const h = Math.max(1, Math.round(size.height * dpr));
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	const ctx = canvas.getContext("2d");
	if (ctx == null) return null;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, w, h);
	ctx.save();
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.beginPath();
	ctx.rect(0, 0, size.width, size.height);
	ctx.clip();
	return ctx;
}

/** Handle positions matching the real ordering (corners + edge midpoints,
 *  kept only when the box is large enough to space them out). */
function selectionHandlePoints(item: SketchItem): SketchPoint[] {
	if (item.kind === "line" || item.kind === "arrow") {
		return [item.from, item.to];
	}
	const b = itemBounds(item);
	const x0 = b.x;
	const y0 = b.y;
	const x1 = b.x + b.width;
	const y1 = b.y + b.height;
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	const pts: SketchPoint[] = [
		{ x: x0, y: y0 },
		{ x: x1, y: y0 },
		{ x: x1, y: y1 },
		{ x: x0, y: y1 },
	];
	const wide = b.width >= MIN_CORNER_HANDLE_SPACING;
	const tall = b.height >= MIN_CORNER_HANDLE_SPACING;
	if (wide && b.height >= MIN_SIDE_HANDLE_SPACING)
		pts.splice(1, 0, { x: cx, y: y0 });
	if (tall && b.width >= MIN_SIDE_HANDLE_SPACING)
		pts.splice(wide ? 3 : 2, 0, { x: x1, y: cy });
	if (wide && b.height >= MIN_SIDE_HANDLE_SPACING) pts.push({ x: cx, y: y1 });
	if (tall && b.width >= MIN_SIDE_HANDLE_SPACING) pts.push({ x: x0, y: cy });
	return pts;
}

/** Dashed selection box + white handles (real `Wn`). */
function paintSelection(ctx: CanvasRenderingContext2D, item: SketchItem): void {
	const b = itemBounds(item);
	ctx.save();
	try {
		ctx.strokeStyle = SELECTION_BLUE;
		ctx.fillStyle = "#ffffff";
		ctx.lineWidth = SELECTION_LINE_WIDTH;
		ctx.setLineDash([6, 4]);
		if (item.kind === "line" || item.kind === "arrow") {
			ctx.beginPath();
			ctx.moveTo(item.from.x, item.from.y);
			ctx.lineTo(item.to.x, item.to.y);
			ctx.stroke();
		} else {
			ctx.strokeRect(b.x, b.y, b.width, b.height);
		}
		ctx.setLineDash([]);
		for (const p of selectionHandlePoints(item)) {
			ctx.beginPath();
			ctx.rect(
				p.x - HANDLE_SIZE / 2,
				p.y - HANDLE_SIZE / 2,
				HANDLE_SIZE,
				HANDLE_SIZE,
			);
			ctx.fill();
			ctx.stroke();
		}
	} finally {
		ctx.restore();
	}
}

/** Snap guides: `#2563eb`, alpha 0.72, dash [6,5]·lineWidth, +6px caps
 *  (real `Un`/`nr`; equal-gap guides are not produced by the editor). */
function paintGuides(ctx: CanvasRenderingContext2D, guides: SnapGuide[]): void {
	if (guides.length === 0) return;
	ctx.save();
	try {
		ctx.strokeStyle = SELECTION_BLUE;
		ctx.lineWidth = GUIDE_LINE_WIDTH;
		ctx.lineCap = "round";
		ctx.globalAlpha = GUIDE_ALPHA;
		ctx.setLineDash([6 * GUIDE_LINE_WIDTH, 5 * GUIDE_LINE_WIDTH]);
		for (const g of guides) {
			if (g.kind !== "alignment") continue;
			ctx.beginPath();
			if (g.axis === "x") {
				ctx.moveTo(g.coordinate, g.start - GUIDE_EXTEND);
				ctx.lineTo(g.coordinate, g.end + GUIDE_EXTEND);
			} else {
				ctx.moveTo(g.start - GUIDE_EXTEND, g.coordinate);
				ctx.lineTo(g.end + GUIDE_EXTEND, g.coordinate);
			}
			ctx.stroke();
		}
	} finally {
		ctx.restore();
	}
}

/* ------------------------------------------------------------------ *
 * Text editing session (UI side; the store holds the pending edit)
 * ------------------------------------------------------------------ */

interface TextSession {
	key: number;
	objectId: string | null;
	text: string;
	bounds: Bounds;
	style: StrokeStyle;
	format: TextFormat;
	selectAllOnFocus: boolean;
}

/** Grow the edited box like the real layout pass: box height follows the
 *  wrapped content, clamped to the remaining surface height. */
function sessionBounds(session: TextSession, surfaceHeight: number): Bounds {
	const fontSize = session.style.width > 0 ? session.style.width : TEXT_FONT_PX;
	const layout = layoutText({
		text: session.text,
		boxWidth: session.bounds.width,
		fontSize,
	});
	const availableHeight = Math.max(surfaceHeight - session.bounds.y, 0);
	const contentHeight = layout.height + TEXT_PADDING * 2;
	return {
		...session.bounds,
		height: Math.min(
			Math.max(contentHeight, session.bounds.height),
			Math.max(availableHeight, contentHeight),
		),
	};
}

/** Does the candidate text still fit the remaining surface height? */
function sessionFits(
	session: TextSession,
	candidate: string,
	surfaceHeight: number,
): boolean {
	const fontSize = session.style.width > 0 ? session.style.width : TEXT_FONT_PX;
	const layout = layoutText({
		text: candidate,
		boxWidth: session.bounds.width,
		fontSize,
	});
	const availableHeight = Math.max(surfaceHeight - session.bounds.y, 0);
	if (layout.height + TEXT_PADDING * 2 <= availableHeight) return true;
	// Shrink-only rule from the real `hi` clamp: shorter candidates pass even
	// when they still overflow.
	return candidate.length < session.text.length;
}

/** Initial text-box bounds (real `wt`): 240 wide, vertically centered on
 *  the click by half a line, optically offset 1px left. */
function initialTextBounds(
	point: SketchPoint,
	surface: Bounds,
	fontSize: number,
): Bounds {
	const minW = fontSize + TEXT_PADDING * 2;
	const surfaceW = Math.max(surface.width, minW);
	const left = clamp(point.x, 0, surfaceW);
	const f = Math.max(left - TEXT_PADDING - TEXT_OPTICAL_OFFSET, 0);
	const p = surfaceW - f;
	const width = Math.min(Math.max(TEXT_INITIAL_WIDTH, minW), Math.max(p, minW));
	const height = fontSize * TEXT_LINE_HEIGHT + TEXT_PADDING * 2;
	const top = clamp(
		point.y - TEXT_PADDING - (fontSize * TEXT_LINE_HEIGHT) / 2,
		0,
		Math.max(surface.height - height, 0),
	);
	return {
		x: p >= minW ? f : Math.max(surfaceW - width, 0),
		y: top,
		width,
		height,
	};
}

/* ------------------------------------------------------------------ *
 * Vertical drawing-size slider (real drawing-size-slider replica)
 * ------------------------------------------------------------------ */

interface SizeSliderProps {
	ariaLabel: string;
	className?: string;
	dark: boolean;
	disabled: boolean;
	max: number;
	min: number;
	name: string;
	title?: string;
	value: number;
	onInteractionStart(): void;
	onInteractionEnd(): void;
	onValueChange(value: number): void;
}

function SizeSlider(props: SizeSliderProps): ReactElement {
	const { dark, disabled, min, max, value } = props;
	const [hover, setHover] = useState(false);
	const [active, setActive] = useState(false);
	const [focus, setFocus] = useState(false);
	const trackRef = useRef<HTMLDivElement>(null);
	const interactingRef = useRef<"pointer" | "keyboard" | null>(null);
	const heldKeysRef = useRef(new Set<string>());
	const expanded = !disabled && (hover || active || focus);
	const fraction = max > min ? (value - min) / (max - min) : 0;

	const valueFromClientY = (clientY: number): number => {
		const rect = trackRef.current?.getBoundingClientRect();
		if (rect == null || rect.height <= 0) return clamp(value, min, max);
		const t = clamp((rect.bottom - clientY) / rect.height, 0, 1);
		return clamp(Math.round(min + t * (max - min)), min, max);
	};

	const endInteraction = (kind: "pointer" | "keyboard") => {
		if (interactingRef.current !== kind) return;
		interactingRef.current = null;
		heldKeysRef.current.clear();
		if (kind === "pointer") setActive(false);
		props.onInteractionEnd();
	};

	const trackClip = expanded
		? "polygon(10% 0%, 90% 0%, calc(50% + 0.5px) 100%, calc(50% - 0.5px) 100%)"
		: "polygon(calc(50% - 0.5px) 0%, calc(50% + 0.5px) 0%, calc(50% + 0.5px) 100%, calc(50% - 0.5px) 100%)";

	return (
		<div
			aria-disabled={disabled || undefined}
			aria-label={props.ariaLabel}
			aria-orientation="vertical"
			aria-valuemax={max}
			aria-valuemin={min}
			aria-valuenow={Math.round(clamp(value, min, max))}
			className={`relative flex h-48 w-8 touch-none items-center justify-center select-none @[552px]/sketch-canvas:h-56 @[552px]/sketch-canvas:w-12 ${
				disabled ? "cursor-not-allowed opacity-50" : "cursor-ns-resize"
			} ${props.className ?? ""}`}
			role="slider"
			tabIndex={disabled ? -1 : 0}
			title={props.title}
			onBlur={() => {
				setFocus(false);
				endInteraction("keyboard");
			}}
			onFocus={() => {
				if (interactingRef.current !== "pointer") setFocus(true);
			}}
			onKeyDown={(e) => {
				if (disabled || !(e.key in SLIDER_KEYS)) return;
				e.preventDefault();
				setFocus(true);
				heldKeysRef.current.add(e.key);
				if (interactingRef.current == null) {
					interactingRef.current = "keyboard";
					props.onInteractionStart();
				}
				let next = value;
				switch (e.key) {
					case "ArrowUp":
					case "ArrowRight":
						next = value + 1;
						break;
					case "ArrowDown":
					case "ArrowLeft":
						next = value - 1;
						break;
					case "PageUp":
						next = value + 10;
						break;
					case "PageDown":
						next = value - 10;
						break;
					case "Home":
						next = min;
						break;
					case "End":
						next = max;
						break;
					default:
						break;
				}
				props.onValueChange(clamp(Math.round(next), min, max));
			}}
			onKeyUp={(e) => {
				heldKeysRef.current.delete(e.key);
				if (heldKeysRef.current.size === 0) endInteraction("keyboard");
			}}
			onPointerCancel={() => endInteraction("pointer")}
			onPointerDown={(e) => {
				e.preventDefault();
				if (disabled || e.button !== 0) return;
				setFocus(false);
				heldKeysRef.current.clear();
				setActive(true);
				if (interactingRef.current == null) {
					interactingRef.current = "pointer";
					props.onInteractionStart();
				}
				try {
					e.currentTarget.setPointerCapture(e.pointerId);
				} catch {
					// jsdom lacks pointer capture
				}
				props.onValueChange(valueFromClientY(e.clientY));
			}}
			onPointerEnter={(e) => {
				const rect = e.currentTarget.getBoundingClientRect();
				setHover(
					!disabled &&
						e.pointerType !== "touch" &&
						e.clientX >= rect.left &&
						e.clientX <= rect.right,
				);
			}}
			onPointerLeave={() => setHover(false)}
			onPointerMove={(e) => {
				const rect = e.currentTarget.getBoundingClientRect();
				setHover(
					!disabled &&
						e.pointerType !== "touch" &&
						e.clientX >= rect.left &&
						e.clientX <= rect.right,
				);
				if (interactingRef.current === "pointer") {
					props.onValueChange(valueFromClientY(e.clientY));
				}
			}}
			onPointerUp={(e) => {
				if (interactingRef.current === "pointer") {
					props.onValueChange(valueFromClientY(e.clientY));
				}
				endInteraction("pointer");
			}}
			onWheel={(e) => {
				if (disabled) return;
				if (interactingRef.current == null) {
					interactingRef.current = "keyboard";
					props.onInteractionStart();
				}
				props.onValueChange(
					clamp(Math.round(value - Math.sign(e.deltaY)), min, max),
				);
				endInteraction("keyboard");
			}}
		>
			{/* Track: 1px vertical line that clip-expands to 80% while active. */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-y-4 left-1/2 w-6 -translate-x-1/2 @[552px]/sketch-canvas:w-10"
				ref={trackRef}
			>
				<div
					className={`absolute h-full w-full transition-[clip-path] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[clip-path] motion-reduce:transition-none ${
						dark ? "bg-[#afafaf]/40" : "bg-[#8f8f8f]/40"
					}`}
					style={{ clipPath: trackClip }}
				/>
			</div>
			{/* Thumb: white 16px dot, scales while interacting. */}
			<span
				aria-hidden="true"
				className={`pointer-events-none absolute left-1/2 block size-4 rounded-full border border-black/20 bg-white shadow-[0_4px_6px_-1px_rgba(0,0,0,0.1),0_2px_4px_-2px_rgba(0,0,0,0.1)] transition-transform duration-300 ease-out motion-reduce:transition-none @[552px]/sketch-canvas:size-5 ${
					focus ? "outline outline-2 outline-offset-2 outline-[#2c67c5]" : ""
				}`}
				style={{
					top: `calc(16px + ${(1 - fraction) * 100}% * (100% - 32px) / 100%)`,
					transform: `translate(-50%, -50%) scale(${expanded ? 1.1 : 1})`,
				}}
			/>
		</div>
	);
}

/* ------------------------------------------------------------------ *
 * SketchPad modal
 * ------------------------------------------------------------------ */

export function SketchPad(props: SketchPadProps): ReactElement {
	const { onInsert, onCancel } = props;
	const dark = themeById(useResolvedThemeId())?.dark ?? true;
	const canvasBg = dark ? CANVAS_BG_DARK : CANVAS_BG_LIGHT;
	const chrome = dark
		? {
				dialog: "border-[#ffffff26] bg-[#212121] shadow-[0_8px_16px_#00000052]",
				pill: "border-[#ffffff26] bg-[#2f2f2f]/95 text-white",
				popover: "border-[#ffffff26] bg-[#2f2f2f]",
				toolActive: "bg-white/15",
				toolHover: "hover:bg-white/10",
				idleText: "text-white",
				ringOffset: "ring-offset-[#212121]",
				swatchBorder: "border-white/25",
				swatchHoverRing: "hover:ring-white/25",
				track: "bg-[#afafaf]/40",
			}
		: {
				dialog: "border-black/10 bg-white shadow-[0_8px_16px_#0000001f]",
				pill: "border-black/10 bg-white/95 text-neutral-900",
				popover: "border-black/10 bg-white",
				toolActive: "bg-black/10",
				toolHover: "hover:bg-black/5",
				idleText: "text-[#0d0d0d]",
				ringOffset: "ring-offset-white",
				swatchBorder: "border-black/20",
				swatchHoverRing: "hover:ring-black/15",
				track: "bg-[#8f8f8f]/40",
			};
	const editorRef = useRef<SketchEditor | null>(null);
	if (editorRef.current == null) {
		let storedShape: string | null = null;
		try {
			storedShape = localStorage.getItem(SHAPE_KIND_STORAGE_KEY);
		} catch {
			/* storage unavailable */
		}
		editorRef.current = createSketchEditor({
			tool: "pen",
			shapeKind:
				storedShape != null &&
				(SHAPE_ORDER as readonly string[]).includes(storedShape)
					? (storedShape as ShapeKind)
					: "line",
			style: { color: dark ? "#ffffff" : "#000000" },
		});
	}
	const editor = editorRef.current;
	const swatches = useMemo(
		() => [
			{
				color: dark ? "#ffffff" : "#000000",
				name: dark ? "白色" : "黑色",
			},
			...SWATCHES.slice(1),
		],
		[dark],
	);
	const snap = useSyncExternalStore(
		useCallback((fn: () => void) => editor.subscribe(fn), [editor]),
		useCallback(() => editor.getSnapshot(), [editor]),
	);

	const surfaceRef = useRef<HTMLDivElement>(null);
	const committedRef = useRef<HTMLCanvasElement>(null);
	const liveRef = useRef<HTMLCanvasElement>(null);
	const overlayRef = useRef<HTMLCanvasElement>(null);
	const brushRef = useRef<HTMLDivElement>(null);
	const brushPosRef = useRef<{ x: number; y: number } | null>(null);
	const popoverWrapRef = useRef<HTMLDivElement>(null);
	const sliderGroupRef = useRef<string | undefined>(undefined);
	const sliderGroupCounterRef = useRef(0);
	const clipboardRef = useRef<{
		object: SketchItem;
		serialized: string;
	} | null>(null);
	const nudgeGroupRef = useRef<string | null>(null);
	const nudgeCounterRef = useRef(0);
	const lastDrawToolRef = useRef<"pen" | "shapes" | "eraser">("pen");
	const sessionKeyRef = useRef(0);
	const erasureCacheRef = useRef<HTMLCanvasElement | null>(null);
	const erasureIdRef = useRef<string | null>(null);
	const drawingPointerRef = useRef<number | null>(null);
	const snapRef = useRef(snap);
	snapRef.current = snap;
	const [session, setSessionState] = useState<TextSession | null>(null);
	const sessionRef = useRef<TextSession | null>(null);
	sessionRef.current = session;
	const [surfaceSize, setSurfaceSize] = useState<{
		width: number;
		height: number;
	} | null>(null);
	const [shapesOpen, setShapesOpen] = useState(false);
	const [customColor, setCustomColor] = useState<string | null>(null);

	const surface: Bounds =
		surfaceSize != null
			? { x: 0, y: 0, width: surfaceSize.width, height: surfaceSize.height }
			: { x: 0, y: 0, width: 0, height: 0 };

	/* ---------------- surface size ---------------- */
	useLayoutEffect(() => {
		const el = surfaceRef.current;
		if (el == null) return;
		const measure = () => {
			const rect = el.getBoundingClientRect();
			const width = rect.width || el.clientWidth || 0;
			const height = rect.height || el.clientHeight || 0;
			setSurfaceSize((prev) =>
				prev != null && prev.width === width && prev.height === height
					? prev
					: { width, height },
			);
		};
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	useEffect(() => {
		if (surfaceSize == null) return;
		editor.setSurfaceBounds({
			x: 0,
			y: 0,
			width: surfaceSize.width,
			height: surfaceSize.height,
		});
	}, [editor, surfaceSize]);

	/* ---------------- coordinate mapping ---------------- */
	const toSample = useCallback(
		(e: PointerEvent | ReactPointerEvent): PointerSample | null => {
			const el = surfaceRef.current;
			if (el == null) return null;
			const rect = el.getBoundingClientRect();
			const width = rect.width || surface.width;
			const height = rect.height || surface.height;
			if (width <= 0 || height <= 0) return null;
			const pointerType = e.pointerType ?? "mouse";
			return {
				pointerId: e.pointerId ?? 0,
				point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
				viewportScale: 1,
				tolerance: BASE_TOLERANCE,
				handleTolerance:
					pointerType === "touch"
						? TOUCH_HANDLE_TOLERANCE
						: MOUSE_HANDLE_TOLERANCE,
				snapTolerance: SNAP_TOLERANCE,
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				pressure: pointerType === "mouse" ? null : e.pressure,
				pointerType,
				timestamp: e.timeStamp ?? null,
				surfaceBounds: { x: 0, y: 0, width, height },
			};
		},
		[surface.width, surface.height],
	);

	/* ---------------- brush cursor ---------------- */
	const brushTool = snap.activeTool === "pen" || snap.activeTool === "eraser";
	const previewStroke =
		snap.preview?.object.kind === "stroke" ? snap.preview.object : null;
	const previewEraser =
		snap.preview?.object.kind === "eraser" ? snap.preview.object : null;
	const brushSize =
		snap.activeTool === "pen"
			? previewStroke == null && snap.drawingWidthPx != null
				? snap.drawingWidthPx
				: (previewStroke?.style.width ?? snap.style.width)
			: (previewEraser?.width ?? snap.eraserSizePx);
	const brushColor =
		snap.activeTool === "pen"
			? (previewStroke?.style.color ?? snap.style.color)
			: undefined;

	const updateBrush = useCallback(() => {
		const el = brushRef.current;
		if (el == null) return;
		const pos = brushPosRef.current;
		el.style.visibility = brushTool && pos != null ? "visible" : "hidden";
		if (pos != null) {
			el.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -50%)`;
		}
	}, [brushTool]);

	useLayoutEffect(updateBrush, [updateBrush, brushSize, brushColor]);

	/* ---------------- canvas painting ---------------- */
	useLayoutEffect(() => {
		const canvas = committedRef.current;
		if (canvas == null || surfaceSize == null) return;
		const ctx = prepareCanvas(canvas, surfaceSize);
		if (ctx == null) return;
		try {
			const preview = snap.preview;
			// Text objects render in the DOM text layer, so they are excluded
			// here; a move/resize preview substitutes its object in.
			const excludeIds = new Set(
				snap.document.objects
					.filter((o) => o.kind === "text")
					.map((o) => o.id),
			);
			const replacement =
				preview != null &&
				preview.replaceObjectId != null &&
				preview.object.kind !== "text" &&
				preview.object.kind !== "eraser"
					? { objectId: preview.replaceObjectId, object: preview.object }
					: undefined;
			renderSketchDocument(ctx, snap.document, { excludeIds, replacement });
			const trail = preview?.object.kind === "eraser" ? preview.object : null;
			if (trail != null) {
				// Cache the clean bitmap once per gesture, then punch the trail
				// out with destination-out (real `Bn` semantics).
				if (
					erasureCacheRef.current == null ||
					erasureIdRef.current !== trail.id
				) {
					const cache =
						erasureCacheRef.current ??
						canvas.ownerDocument.createElement("canvas");
					cache.width = canvas.width;
					cache.height = canvas.height;
					const cctx = cache.getContext("2d");
					if (cctx != null) {
						cctx.setTransform(1, 0, 0, 1, 0, 0);
						cctx.clearRect(0, 0, cache.width, cache.height);
						cctx.drawImage(canvas, 0, 0);
					}
					erasureCacheRef.current = cache;
					erasureIdRef.current = trail.id;
				}
				const cache = erasureCacheRef.current;
				if (cache != null) {
					const dpr =
						canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1;
					ctx.setTransform(1, 0, 0, 1, 0, 0);
					ctx.clearRect(0, 0, canvas.width, canvas.height);
					ctx.drawImage(cache, 0, 0);
					ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
					renderEraserTrail(ctx, trail.points, trail.width);
				}
			} else {
				erasureCacheRef.current = null;
				erasureIdRef.current = null;
			}
		} finally {
			ctx.restore();
		}
	}, [snap, surfaceSize]);

	useLayoutEffect(() => {
		const canvas = liveRef.current;
		if (canvas == null || surfaceSize == null) return;
		const ctx = prepareCanvas(canvas, surfaceSize);
		if (ctx == null) return;
		try {
			const preview = snap.preview;
			if (
				preview != null &&
				preview.replaceObjectId == null &&
				preview.object.kind !== "text" &&
				preview.object.kind !== "eraser"
			) {
				renderSketchObject(ctx, preview.object);
			}
		} finally {
			ctx.restore();
		}
	}, [snap, surfaceSize]);

	/* Selected object (preview-substituted, erasure-preview aware). */
	const selectedItem: SketchItem | null = (() => {
		if (snap.selectionId == null) return null;
		const found =
			overlayDocument(snap).objects.find(
				(o) => o.id === snap.selectionId,
			) ?? null;
		const preview = snap.preview;
		if (
			found != null &&
			preview != null &&
			preview.replaceObjectId === found.id &&
			preview.object.kind !== "eraser"
		) {
			return preview.object;
		}
		return found;
	})();

	useLayoutEffect(() => {
		const canvas = overlayRef.current;
		if (canvas == null || surfaceSize == null) return;
		const ctx = prepareCanvas(canvas, surfaceSize);
		if (ctx == null) return;
		try {
			paintGuides(ctx, snap.snapGuides);
			const pendingBox: SketchItem | null =
				session != null
					? {
							id: session.objectId ?? "sketch-text-draft",
							kind: "text",
							text: session.text,
							bounds: session.bounds,
							style: session.style,
							format: session.format,
						}
					: null;
			const target = pendingBox ?? selectedItem;
			if (target != null) paintSelection(ctx, target);
		} finally {
			ctx.restore();
		}
	}, [snap, surfaceSize, session, selectedItem]);

	/* ---------------- text editing ---------------- */
	const pushPendingText = useCallback(
		(next: TextSession) => {
			const input: SketchTextEditInput = {
				objectId: next.objectId,
				text: next.text.replace(/\r\n?/g, " "),
				bounds: next.bounds,
				style: next.style,
				format: next.format,
			};
			editor.setPendingTextEdit(input);
		},
		[editor],
	);

	const updateSession = useCallback(
		(next: TextSession) => {
			sessionRef.current = next;
			setSessionState(next);
			pushPendingText(next);
		},
		[pushPendingText],
	);

	const beginTextEdit = useCallback(
		(
			item: Extract<SketchItem, { kind: "text" }> | null,
			point?: SketchPoint,
		) => {
			sessionKeyRef.current += 1;
			if (item != null) {
				editor.selectObject(item.id);
				updateSession({
					key: sessionKeyRef.current,
					objectId: item.id,
					text: item.text,
					bounds: item.bounds,
					style: { ...item.style },
					format: { ...item.format },
					selectAllOnFocus: true,
				});
				return;
			}
			if (point == null) return;
			editor.clearSelection();
			const current = snapRef.current;
			const style: StrokeStyle = {
				...current.style,
				width:
					current.textSizePx != null && current.textSizePx > 0
						? current.textSizePx
						: current.style.width,
			};
			updateSession({
				key: sessionKeyRef.current,
				objectId: null,
				text: "",
				bounds: initialTextBounds(point, surface, style.width),
				style,
				format: { ...current.textFormat },
				selectAllOnFocus: false,
			});
		},
		[editor, surface, updateSession],
	);

	const commitText = useCallback(
		(focusCanvas: boolean) => {
			const current = sessionRef.current;
			if (current == null) return;
			sessionRef.current = null;
			setSessionState(null);
			pushPendingText({
				...current,
				text: current.text.replace(/\r\n?/g, " "),
				bounds: sessionBounds(current, surface.height),
			});
			editor.commitPendingTextEdit();
			if (focusCanvas) committedRef.current?.focus();
		},
		[editor, pushPendingText, surface.height],
	);

	/* ---------------- actions ---------------- */
	const handleDone = useCallback(() => {
		commitText(false);
		void editor
			.export({
				backgroundColor: canvasBg,
				padding: 36,
				scale: 1,
				mimeType: "image/png",
			})
			.then((result) => {
				if (result.kind === "success") onInsert(result.dataUrl);
			});
	}, [canvasBg, commitText, editor, onInsert]);

	const pickColor = useCallback(
		(color: string) => {
			editor.setStyle({ color }, { historyGroup: "sketch-color" });
			const s = editor.getSnapshot();
			// Real behavior: picking a color while erasing (or selecting with
			// nothing selected) jumps back to the pen.
			if (
				s.activeTool === "eraser" ||
				(s.activeTool === "select" && s.selectionId == null)
			) {
				editor.setTool("pen");
			}
		},
		[editor],
	);

	const selectTool = useCallback(
		(tool: SketchTool) => {
			commitText(false);
			if (tool in DRAW_TOOLS) {
				lastDrawToolRef.current = tool as "pen" | "shapes" | "eraser";
			}
			if (tool === "shapes") {
				setShapesOpen((open) => !open);
				editor.setTool("shapes");
				return;
			}
			setShapesOpen(false);
			editor.setTool(tool);
		},
		[commitText, editor],
	);

	const pickShape = useCallback(
		(kind: ShapeKind) => {
			// Shape names double as tools in the real editor.
			editor.setTool(kind);
			try {
				localStorage.setItem(SHAPE_KIND_STORAGE_KEY, kind);
			} catch {
				/* storage unavailable */
			}
			lastDrawToolRef.current = "shapes";
			setShapesOpen(false);
			committedRef.current?.focus();
		},
		[editor],
	);

	/* ---------------- pointer pipeline ---------------- */
	const updateBrushPos = useCallback(
		(e: { clientX: number; clientY: number; pointerType: string }) => {
			if (e.pointerType === "touch" && drawingPointerRef.current == null) {
				brushPosRef.current = null;
				updateBrush();
				return;
			}
			const rect = surfaceRef.current?.getBoundingClientRect();
			if (rect == null) return;
			brushPosRef.current = {
				x: e.clientX - rect.left,
				y: e.clientY - rect.top,
			};
			updateBrush();
		},
		[updateBrush],
	);

	const handlePointerDown = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (e.defaultPrevented) return;
			if (e.pointerType === "mouse" && e.button !== 0) return;
			if (editor.getSnapshot().hasActiveGesture) return;
			const sample = toSample(e);
			if (sample == null) return;
			drawingPointerRef.current = sample.pointerId;
			if (sessionRef.current != null) commitText(false);
			const s = editor.getSnapshot();
			if (s.activeTool === "text") {
				e.preventDefault();
				const hit = editor.getObjectAtPoint(sample.point, sample.tolerance);
				if (hit != null && hit.kind === "text") {
					editor.setTool("select");
					editor.selectObject(hit.id);
					return;
				}
				beginTextEdit(null, sample.point);
				return;
			}
			if (editor.pointerDown(sample)) {
				if (s.activeTool === "pen" || s.activeTool === "eraser") {
					updateBrushPos(e);
				}
				try {
					surfaceRef.current?.setPointerCapture(e.pointerId);
				} catch {
					// jsdom lacks pointer capture
				}
			}
		},
		[beginTextEdit, commitText, editor, toSample, updateBrushPos],
	);

	const handlePointerMove = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			updateBrushPos(e);
			const native = e.nativeEvent;
			const coalesced =
				typeof native.getCoalescedEvents === "function"
					? native.getCoalescedEvents()
					: [];
			const events =
				coalesced.length > 0 ? [...coalesced, native] : [native];
			// Gesture in flight → batch into pointerMoves; hovering → per-sample.
			const batching = snapRef.current.hasActiveGesture;
			const batch: PointerSample[] = [];
			let prev: PointerEvent | null = null;
			for (const ev of events) {
				if (
					prev != null &&
					prev.pointerId === ev.pointerId &&
					prev.timeStamp === ev.timeStamp &&
					prev.clientX === ev.clientX &&
					prev.clientY === ev.clientY &&
					prev.pressure === ev.pressure
				) {
					continue;
				}
				prev = ev;
				const sample = toSample(ev);
				if (sample == null) continue;
				if (batching) batch.push(sample);
				else editor.pointerMove(sample);
			}
			if (batch.length > 0) editor.pointerMoves(batch);
		},
		[editor, toSample, updateBrushPos],
	);

	const handlePointerUp = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			updateBrushPos(e);
			const sample = toSample(e);
			if (sample != null) editor.pointerUp(sample);
			else editor.pointerCommit(e.pointerId ?? 0);
			drawingPointerRef.current = null;
		},
		[editor, toSample, updateBrushPos],
	);

	const handlePointerCancel = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (drawingPointerRef.current === (e.pointerId ?? 0)) {
				drawingPointerRef.current = null;
			}
			editor.pointerCancel(e.pointerId ?? 0);
		},
		[editor],
	);

	const handlePointerLeave = useCallback(() => {
		brushPosRef.current = null;
		updateBrush();
		editor.pointerLeave();
	}, [editor, updateBrush]);

	const handleLostPointerCapture = useCallback(
		(e: ReactPointerEvent<HTMLDivElement>) => {
			if (drawingPointerRef.current === (e.pointerId ?? 0)) {
				drawingPointerRef.current = null;
			}
			editor.pointerCommit(e.pointerId ?? 0);
		},
		[editor],
	);

	const handleDoubleClick = useCallback(
		(e: ReactMouseEvent<HTMLDivElement>) => {
			const s = editor.getSnapshot();
			if (s.hasActiveGesture || sessionRef.current != null) return;
			if (s.activeTool !== "select") return;
			const el = surfaceRef.current;
			if (el == null) return;
			const rect = el.getBoundingClientRect();
			const hit = editor.getObjectAtPoint(
				{ x: e.clientX - rect.left, y: e.clientY - rect.top },
				BASE_TOLERANCE,
			);
			if (hit != null && hit.kind === "text") beginTextEdit(hit);
		},
		[beginTextEdit, editor],
	);

	/* ---------------- keyboard ---------------- */
	/** Escape consumption shared by the surface keydown and the window
	 *  fallback: cancel gesture → text tool back to select → clear
	 *  selection. Returns true when the key was consumed. */
	const consumeEscape = useCallback((): boolean => {
		const s = snapRef.current;
		if (editor.pointerCancel()) return true;
		if (s.activeTool === "text") {
			editor.setTool("select");
			return true;
		}
		if (s.selectionId != null) {
			editor.clearSelection();
			return true;
		}
		return false;
	}, [editor]);

	const handleKeyDown = useCallback(
		(e: ReactKeyboardEvent<HTMLDivElement>) => {
			if (e.defaultPrevented || isEditableTarget(e.target)) return;
			const key = e.key;
			if ((e.metaKey || e.ctrlKey) && key.toLowerCase() === "z") {
				if (e.shiftKey ? editor.redo() : editor.undo()) e.preventDefault();
				return;
			}
			if (e.ctrlKey && key.toLowerCase() === "y") {
				if (editor.redo()) e.preventDefault();
				return;
			}
			const s = snapRef.current;
			if (s.hasActiveGesture && key !== "Escape") return;
			switch (key) {
				case "Enter": {
					if (s.selectionId == null) return;
					const sel =
						overlayDocument(s).objects.find(
							(o) => o.id === s.selectionId,
						) ?? null;
					if (sel != null && sel.kind === "text") {
						e.preventDefault();
						beginTextEdit(sel);
					}
					return;
				}
				case "Backspace":
				case "Delete":
					if (editor.deleteSelection()) e.preventDefault();
					return;
				case "Escape":
					if (consumeEscape()) claimEscape(e);
					return;
				case "ArrowUp":
				case "ArrowDown":
				case "ArrowLeft":
				case "ArrowRight": {
					if (s.selectionId == null) return;
					const amount = e.shiftKey ? 10 : 1;
					if (nudgeGroupRef.current == null) {
						nudgeCounterRef.current += 1;
						nudgeGroupRef.current = `canvas-nudge-${nudgeCounterRef.current}`;
					}
					const delta =
						key === "ArrowUp"
							? { x: 0, y: -amount }
							: key === "ArrowDown"
								? { x: 0, y: amount }
								: key === "ArrowLeft"
									? { x: -amount, y: 0 }
									: { x: amount, y: 0 };
					if (
						editor.nudgeSelection(delta, {
							historyGroup: nudgeGroupRef.current,
						})
					) {
						e.preventDefault();
					}
					return;
				}
				default:
					return;
			}
		},
		[beginTextEdit, consumeEscape, editor],
	);

	const handleKeyUp = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
		if (e.key in ARROW_KEYS) nudgeGroupRef.current = null;
	}, []);

	/* ---------------- clipboard ---------------- */
	const handleCopy = useCallback(
		(e: ReactClipboardEvent<HTMLDivElement>) => {
			const data = e.clipboardData;
			if (
				e.defaultPrevented ||
				data == null ||
				sessionRef.current != null
			) {
				return;
			}
			const s = editor.getSnapshot();
			const obj =
				s.selectionId == null
					? null
					: (overlayDocument(s).objects.find(
							(o) => o.id === s.selectionId,
						) ?? null);
			if (obj == null) return;
			const serialized = JSON.stringify({ schemaVersion: 1, object: obj });
			clipboardRef.current = { object: obj, serialized };
			try {
				data.setData(CLIPBOARD_MIME, serialized);
				if (obj.kind === "text") data.setData("text/plain", obj.text);
				e.preventDefault();
			} catch {
				// clipboard unavailable
			}
		},
		[editor],
	);

	const handlePaste = useCallback(
		(e: ReactClipboardEvent<HTMLDivElement>) => {
			const data = e.clipboardData;
			if (
				e.defaultPrevented ||
				data == null ||
				sessionRef.current != null ||
				editor.getSnapshot().hasActiveGesture
			) {
				return;
			}
			const clip = clipboardRef.current;
			if (clip == null) return;
			let serialized = "";
			try {
				serialized = data.getData(CLIPBOARD_MIME);
			} catch {
				return;
			}
			if (serialized !== clip.serialized) return;
			const pasted = editor.pasteObject(clip.object, {
				offset: { x: PASTE_OFFSET, y: PASTE_OFFSET },
			});
			if (pasted != null) e.preventDefault();
		},
		[editor],
	);

	/* ---------------- close wiring ---------------- */
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const discardAndClose = useCallback(() => {
		editor.discardPendingTextEdit();
		sessionRef.current = null;
		setSessionState(null);
		setConfirmDiscard(false);
		onCancel();
	}, [editor, onCancel]);
	// A non-empty drawing is only discarded after an explicit confirmation.
	const requestClose = useCallback(() => {
		if (editor.getSnapshot().effectiveDocument.objects.length > 0) {
			setConfirmDiscard(true);
			return;
		}
		discardAndClose();
	}, [editor, discardAndClose]);

	// Esc fallback: first run the same consume hierarchy the surface
	// keydown uses; only when nothing consumes it does the modal close.
	// The dialog carries aria-modal="true" so SessionView's global
	// Escape handler leaves this surface alone.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || isEscapeClaimed(e)) return;
			if (confirmDiscard) {
				claimEscape(e);
				setConfirmDiscard(false);
				return;
			}
			if (isEditableTarget(e.target)) return;
			if (sessionRef.current != null) return;
			if (consumeEscape()) {
				claimEscape(e);
				return;
			}
			claimEscape(e);
			requestClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [consumeEscape, requestClose, confirmDiscard]);

	// Focus the canvas once mounted (keyboard shortcuts live there).
	useEffect(() => {
		committedRef.current?.focus();
	}, []);

	// Close the shapes popover on outside pointerdown / Esc.
	useEffect(() => {
		if (!shapesOpen) return;
		const onPointer = (e: PointerEvent) => {
			const target = e.target;
			if (target instanceof Node && popoverWrapRef.current?.contains(target)) {
				return;
			}
			setShapesOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				claimEscape(e);
				setShapesOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointer, true);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("pointerdown", onPointer, true);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [shapesOpen]);

	// Discard half-finished gestures and pending text on unmount.
	useEffect(() => {
		return () => {
			editor.pointerCancel();
			editor.discardPendingTextEdit();
		};
	}, [editor]);

	/* ---------------- slider model ---------------- */
	const sliderModel = ((): {
		value: number;
		min: number;
		max: number;
		label: string;
		name: string;
		disabled: boolean;
		title?: string;
		apply(v: number): void;
	} => {
		const sel = selectedItem;
		const isEraser = snap.activeTool === "eraser";
		const isText = snap.activeTool === "text" || sel?.kind === "text";
		const isInk = !isEraser && sel?.kind === "ink";
		const toolWidth = isText
			? (snap.textSizePx ?? snap.style.width)
			: (snap.drawingWidthPx ?? snap.style.width);
		const value = isEraser
			? snap.eraserSizePx
			: sel != null
				? sel.style.width
				: toolWidth;
		let min: number;
		let max: number;
		let label: string;
		let name: string;
		if (isEraser) {
			min = ERASER_MIN;
			max = ERASER_MAX;
			label = "橡皮大小";
			name = "sketch-eraser-size";
		} else if (isText) {
			min = Math.min(TEXT_MIN, value);
			max = Math.max(TEXT_MAX, value);
			label = "文字大小";
			name = "sketch-text-size";
		} else {
			// Drawing tool → width range 1–32; selected object → 2–48.
			min = Math.min(sel == null ? 1 : 2, value);
			max = Math.max(sel == null ? 32 : 48, value);
			label = "线宽";
			name = "sketch-stroke-width";
		}
		const apply = (v: number) => {
			if (isEraser) {
				editor.setEraserSize(v);
				return;
			}
			if (sel == null) {
				if (isText) editor.setTextSize(v);
				else editor.setDrawingWidth(v);
				return;
			}
			editor.setStyle({ width: v }, { historyGroup: sliderGroupRef.current });
		};
		return {
			value,
			min,
			max,
			label,
			name,
			disabled: isInk,
			title: isInk
				? "局部擦除后无法修改线宽，请使用选框手柄调整大小。"
				: undefined,
			apply,
		};
	})();

	/* ---------------- derived view state ---------------- */
	const cursor = brushTool ? "none" : snap.cursor;
	const doneDisabled = snap.effectiveDocument.objects.length === 0;
	const activeShape = snap.shapeKind;
	const customSwatchActive =
		customColor != null &&
		!SWATCHES.some((s) => s.color === snap.style.color);

	return createPortal(
		<div
			data-sketch-overlay=""
			className="absolute inset-0 z-(--z-modal) bg-[var(--overlay)] backdrop-blur-md"
			onPointerDown={(e) => {
				if (e.target === e.currentTarget) requestClose();
			}}
		>
			<div
				aria-label="草图编辑器"
				aria-modal="true"
				className={`@container/sketch-canvas absolute rounded-2xl border ${chrome.dialog}`}
				role="dialog"
				style={{
					inset: SKETCH_INSET,
				}}
				onPointerDown={(e) => e.stopPropagation()}
			>
				{/* Canvas surface (layer stack). */}
				<div
					data-sketch-canvas-surface=""
					className="relative h-full w-full overflow-hidden rounded-2xl"
					style={{
						backgroundColor: canvasBg,
						cursor,
						isolation: "isolate",
					}}
					ref={surfaceRef}
					onBlur={() => {
						nudgeGroupRef.current = null;
					}}
					onContextMenu={(e) => {
						if (!isEditableTarget(e.target)) e.preventDefault();
					}}
					onCopy={handleCopy}
					onDoubleClick={handleDoubleClick}
					onKeyDown={handleKeyDown}
					onKeyUp={handleKeyUp}
					onLostPointerCapture={handleLostPointerCapture}
					onPaste={handlePaste}
					onPointerCancel={handlePointerCancel}
					onPointerDown={handlePointerDown}
					onPointerLeave={handlePointerLeave}
					onPointerMove={handlePointerMove}
					onPointerUp={handlePointerUp}
				>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute top-0 left-0 z-40 box-border rounded-full border border-white shadow-[0_0_0_1px_#000000bf]"
						data-sketch-brush-cursor={snap.activeTool}
						ref={brushRef}
						style={{
							visibility: "hidden",
							width: brushSize,
							height: brushSize,
							backgroundColor: brushColor,
						}}
					/>
					<canvas
						aria-keyshortcuts={KEY_HINTS}
						aria-label="草图画布"
						className="absolute inset-0 h-full w-full outline-none"
						ref={committedRef}
						role="application"
						style={{ touchAction: "none" }}
						tabIndex={0}
					/>
					<canvas
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 h-full w-full"
						ref={liveRef}
					/>
					{/* DOM text layer: read-only textareas, 24px font scaled. */}
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 z-10"
					>
						{overlayDocument(snap).objects.flatMap((obj) => {
							if (obj.kind !== "text") return [];
							if (session != null && session.objectId === obj.id) return [];
							const shown =
								snap.preview?.replaceObjectId === obj.id &&
								snap.preview.object.kind === "text"
									? snap.preview.object
									: obj;
							if (shown.kind !== "text") return [];
							return [<TextBox item={shown} key={obj.id} />];
						})}
					</div>
					<canvas
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 z-20 h-full w-full"
						ref={overlayRef}
					/>
					{session != null && (
						<TextEditor
							interactive={
								snap.activeTool === "text" || snap.activeTool === "select"
							}
							key={session.key}
							session={session}
							surfaceHeight={surface.height}
							onChange={(text) => {
								const cur = sessionRef.current;
								if (cur == null || !sessionFits(cur, text, surface.height)) {
									return;
								}
								updateSession({
									...cur,
									text,
									bounds: sessionBounds(
										{ ...cur, text },
										surface.height,
									),
								});
							}}
							onCommit={commitText}
						/>
					)}
				</div>

				{/* Top bar. */}
				<div className="pointer-events-none absolute top-3 right-3 left-3 z-30 flex h-9 items-center justify-center">
					<div className="pointer-events-auto absolute inset-y-0 left-0 flex items-center">
						<button
							aria-label="关闭草图编辑器"
							className={`flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors ${chrome.idleText} ${chrome.toolHover}`}
							title="关闭草图编辑器"
							type="button"
							onClick={requestClose}
							onPointerDown={(e) => e.preventDefault()}
						>
							<IconClose className="size-4" />
						</button>
					</div>
					<fieldset
						aria-label="绘图工具"
						className={`pointer-events-auto m-0 flex max-w-full items-center gap-0.5 rounded-full border p-1 shadow-sm select-none ${chrome.pill}`}
					>
						{TOOL_ORDER.map((tool) => {
							if (tool === "shapes") {
								return (
									<div
										className="relative"
										key="shapes"
										ref={popoverWrapRef}
									>
										<button
											aria-label="形状"
											aria-pressed={snap.activeTool === "shapes"}
											className={`flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors ${chrome.idleText} ${
												snap.activeTool === "shapes"
													? chrome.toolActive
													: chrome.toolHover
											}`}
											title="形状"
											type="button"
											onClick={() => selectTool("shapes")}
											onPointerDown={(e) => e.preventDefault()}
										>
											<IconShapes className="size-4" />
										</button>
										{shapesOpen && (
											<div
												aria-label="形状"
												className={`absolute top-full left-1/2 z-40 mt-1 w-max -translate-x-1/2 rounded-xl border p-1 shadow-sm ${chrome.popover}`}
											>
												<div className="grid grid-cols-4 grid-rows-2 gap-0.5">
													{SHAPE_ORDER.map((kind) => {
														const ShapeIcon = SHAPE_ICONS[kind];
														const active =
															snap.activeTool === "shapes" &&
															activeShape === kind;
														return (
															<button
																aria-label={SHAPE_LABELS[kind]}
																aria-pressed={active}
																className={`flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors ${chrome.idleText} ${
																		active
																			? chrome.toolActive
																			: chrome.toolHover
																	}`}
																key={kind}
																title={SHAPE_LABELS[kind]}
																type="button"
																onClick={() => pickShape(kind)}
																onPointerDown={(e) => e.preventDefault()}
															>
																<ShapeIcon className="size-4" />
															</button>
														);
													})}
												</div>
											</div>
										)}
									</div>
								);
							}
							const ToolIcon = TOOL_ICONS[tool];
							const active = snap.activeTool === tool;
							return (
								<button
									aria-label={TOOL_LABELS[tool]}
									aria-pressed={active}
									className={`flex size-7 cursor-pointer items-center justify-center rounded-full transition-colors ${chrome.idleText} ${
										active ? chrome.toolActive : chrome.toolHover
									}`}
									key={tool}
									title={TOOL_LABELS[tool]}
									type="button"
									onClick={() => selectTool(tool)}
									onPointerDown={(e) => e.preventDefault()}
								>
									<ToolIcon
										className={`size-4 ${
											tool === "select"
												? "translate-x-px translate-y-px"
												: ""
										}`}
									/>
								</button>
							);
						})}
					</fieldset>
					<div className="pointer-events-auto absolute inset-y-0 right-0 flex items-center gap-0.5">
						<button
							aria-label="撤销"
							className={`flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors ${chrome.idleText} ${chrome.toolHover} disabled:cursor-default disabled:opacity-50`}
							disabled={!snap.canUndo}
							title="撤销"
							type="button"
							onClick={() => {
								editor.commitPendingTextEdit();
								editor.undo();
							}}
							onPointerDown={(e) => e.preventDefault()}
						>
							<IconUndo className="size-4" />
						</button>
						<button
							aria-label="重做"
							className={`flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors ${chrome.idleText} ${chrome.toolHover} disabled:cursor-default disabled:opacity-50`}
							disabled={!snap.canRedo}
							title="重做"
							type="button"
							onClick={() => {
								editor.commitPendingTextEdit();
								editor.redo();
							}}
							onPointerDown={(e) => e.preventDefault()}
						>
							<IconRedo className="size-4" />
						</button>
					</div>
				</div>

				{/* Left-edge size slider. */}
				<div className="pointer-events-none absolute top-1/2 left-3 z-30 flex -translate-y-1/2 justify-center">
					<SizeSlider
						ariaLabel={sliderModel.label}
						className="pointer-events-auto shrink-0"
						dark={dark}
						disabled={sliderModel.disabled}
						max={sliderModel.max}
						min={sliderModel.min}
						name={sliderModel.name}
						title={sliderModel.title}
						value={sliderModel.value}
						onInteractionEnd={() => {
							sliderGroupRef.current = undefined;
						}}
						onInteractionStart={() => {
							sliderGroupCounterRef.current += 1;
							sliderGroupRef.current = `slider-${sliderGroupCounterRef.current}`;
						}}
						onValueChange={sliderModel.apply}
					/>
				</div>

				{/* Bottom bar: color swatches + attach. */}
				<div className="pointer-events-none absolute right-3 bottom-3 left-3 z-30 flex h-9 items-center gap-2">
					<div className="pointer-events-auto min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] @[552px]/sketch-canvas:pointer-events-none @[552px]/sketch-canvas:absolute @[552px]/sketch-canvas:inset-x-0 @[552px]/sketch-canvas:flex @[552px]/sketch-canvas:justify-center">
						<fieldset
							aria-label="画笔颜色"
							className="m-0 mx-auto flex w-max items-center gap-2 border-0 p-0 px-1 py-1 select-none @[552px]/sketch-canvas:pointer-events-auto"
						>
							<legend className="sr-only">画笔颜色</legend>
							{/* Rainbow custom-color swatch wrapping a color input. */}
							<label className="relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full @[552px]/sketch-canvas:size-6">
								<span className="sr-only">自定义颜色</span>
								<input
									aria-label="自定义颜色"
									className="peer absolute inset-0 z-20 m-0 h-full w-full cursor-pointer border-0 bg-transparent p-0 opacity-0"
									name="sketch-custom-color"
									type="color"
									value={customColor ?? "#a855f7"}
									onChange={(e) => {
										setCustomColor(e.currentTarget.value);
										pickColor(e.currentTarget.value);
									}}
									onInput={(e) => {
										setCustomColor(e.currentTarget.value);
										pickColor(e.currentTarget.value);
									}}
								/>
								<span
									aria-hidden="true"
									className={`pointer-events-none relative z-10 size-full rounded-full shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)] transition-transform peer-hover:scale-105 motion-reduce:transition-none ${
										customSwatchActive
											? `ring-2 ring-[#2c67c5] ring-offset-2 ${chrome.ringOffset}`
											: ""
									}`}
									style={{ background: CUSTOM_GRADIENT }}
								>
									{customSwatchActive && customColor != null && (
										<>
											<span className="absolute inset-[3px] rounded-full bg-white" />
											<span
												className="absolute inset-[5px] rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
												style={{ backgroundColor: customColor }}
											/>
										</>
									)}
								</span>
							</label>
							{swatches.map(({ color, name }) => {
								const active = snap.style.color === color;
								return (
									<button
										aria-label={`使用${name}`}
										aria-pressed={active}
										className={`size-5 shrink-0 cursor-pointer rounded-full border shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)] transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c67c5] motion-reduce:transition-none @[552px]/sketch-canvas:size-6 ${chrome.swatchBorder} ${
											active
												? `ring-2 ring-[#2c67c5] ring-offset-2 ${chrome.ringOffset}`
												: `hover:scale-105 hover:ring-2 ${chrome.swatchHoverRing}`
										}`}
										key={color}
										style={{ backgroundColor: color }}
										title={color}
										type="button"
										onClick={() => pickColor(color)}
										onPointerDown={(e) => e.preventDefault()}
									/>
								);
							})}
						</fieldset>
					</div>
					<button
						aria-label="附加草图"
						className="pointer-events-auto ms-auto flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--text)] p-0 text-[var(--bg)] transition-opacity focus-visible:outline-2 disabled:cursor-default disabled:opacity-50"
						disabled={doneDisabled}
						title="附加草图"
						type="submit"
						onClick={handleDone}
						onPointerDown={(e) => e.preventDefault()}
					>
						<IconCheck className="size-4" />
					</button>
				</div>
			</div>
			{confirmDiscard && (
				<div
					className="absolute inset-0 z-40 grid place-items-center bg-black/30"
					onPointerDown={(e) => e.stopPropagation()}
				>
					<div
						aria-label="放弃草图"
						aria-modal="true"
						className={`w-[min(360px,calc(100vw-48px))] rounded-2xl border p-4 shadow-lg ${chrome.dialog}`}
						data-layer="modal"
						role="alertdialog"
					>
						<div className="text-[14px] font-semibold">放弃当前草图？</div>
						<div className="mt-1 text-[12px] opacity-70">
							关闭后已绘制的内容将丢失。
						</div>
						<div className="mt-4 flex justify-end gap-2">
							<button
								autoFocus
								className="rounded-xl bg-[var(--text)] px-4 py-1.5 text-[12.5px] font-semibold text-[var(--bg)] hover:opacity-90"
								type="button"
								onClick={() => setConfirmDiscard(false)}
							>
								继续编辑
							</button>
							<button
								className="rounded-xl border border-[var(--line,var(--border-divider))] px-4 py-1.5 text-[12.5px] font-medium hover:bg-[var(--ghost-hover,var(--bg-hover))]"
								type="button"
								onClick={discardAndClose}
							>
								放弃草图
							</button>
						</div>
					</div>
				</div>
			)}
		</div>,
		document.body,
	);
}

/* ------------------------------------------------------------------ *
 * DOM text pieces
 * ------------------------------------------------------------------ */

/** Textarea style inside its box: rendered at 24px, scaled to fontSize
 *  (the real `$r` style builder). */
function textAreaStyle(item: {
	bounds: Bounds;
	style: StrokeStyle;
	format: TextFormat;
}): CSSProperties {
	const fontSize = item.style.width > 0 ? item.style.width : TEXT_FONT_PX;
	const scale = fontSize / TEXT_FONT_PX;
	const pad = TEXT_PADDING;
	return {
		position: "absolute",
		left: pad,
		top: pad,
		width:
			Math.round(
				(Math.max(item.bounds.width - pad * 2, pad / 8) / scale) * 1e6,
			) / 1e6,
		height: Math.max(item.bounds.height - pad * 2, 0) / scale,
		transform: `scale(${scale})`,
		transformOrigin: "top left",
		appearance: "none",
		border: 0,
		borderRadius: 0,
		boxSizing: "border-box",
		boxShadow: "none",
		color: item.style.color,
		direction: "ltr",
		fontFamily: TEXT_FONT_FAMILY,
		fontFeatureSettings: "normal",
		fontKerning: "normal",
		fontSize: TEXT_FONT_PX,
		fontStretch: "normal",
		fontStyle: item.format.italic ? "italic" : "normal",
		fontSynthesis: "none",
		fontVariantLigatures: "normal",
		fontWeight: item.format.bold ? 700 : 400,
		hyphens: "manual",
		letterSpacing: "0px",
		lineHeight: `${(fontSize * TEXT_LINE_HEIGHT) / scale}px`,
		margin: 0,
		outline: "none",
		overflowWrap: "break-word",
		padding: 0,
		resize: "none",
		textAlign: "left",
		textDecoration: item.format.underline ? "underline" : "none",
		whiteSpace: "pre-wrap",
		backgroundColor: "transparent",
		overflow: "hidden",
		pointerEvents: "none",
	};
}

function TextBox(props: {
	item: Extract<SketchItem, { kind: "text" }>;
}): ReactElement {
	const { item } = props;
	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute overflow-hidden"
			style={{
				left: item.bounds.x,
				top: item.bounds.y,
				width: item.bounds.width,
				height: item.bounds.height,
			}}
		>
			<textarea
				aria-hidden="true"
				className="absolute m-0 resize-none overflow-hidden bg-transparent outline-none"
				readOnly={true}
				spellCheck={false}
				style={textAreaStyle(item)}
				tabIndex={-1}
				value={item.text}
				wrap="soft"
			/>
		</div>
	);
}

function TextEditor(props: {
	session: TextSession;
	surfaceHeight: number;
	interactive: boolean;
	onChange(text: string): void;
	onCommit(focusCanvas: boolean): void;
}): ReactElement {
	const { session } = props;
	const bounds = sessionBounds(session, props.surfaceHeight);
	const taRef = useRef<HTMLTextAreaElement>(null);
	const composingRef = useRef(false);
	useLayoutEffect(() => {
		const ta = taRef.current;
		if (ta == null) return;
		ta.focus();
		if (session.selectAllOnFocus) ta.select();
		// Focus once on mount; select-all applies to double-click editing.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return (
		<div
			className="pointer-events-none absolute z-10 overflow-hidden"
			style={{
				left: bounds.x,
				top: bounds.y,
				width: bounds.width,
				height: bounds.height,
			}}
		>
			<textarea
				aria-label="草图文字"
				aria-multiline="true"
				autoCapitalize="sentences"
				autoCorrect="on"
				className="absolute m-0 resize-none overflow-hidden bg-transparent outline-none"
				data-testid="sketch-text-editor"
				ref={taRef}
				spellCheck={false}
				style={{
					...textAreaStyle({
						bounds,
						style: session.style,
						format: session.format,
					}),
					pointerEvents: props.interactive ? "auto" : "none",
					caretColor: session.style.color,
					cursor: "text",
				}}
				value={session.text}
				wrap="soft"
				onBlur={() => props.onCommit(false)}
				onChange={(e) => props.onChange(e.currentTarget.value)}
				onCompositionEnd={() => {
					composingRef.current = false;
				}}
				onCompositionStart={() => {
					composingRef.current = true;
				}}
				onKeyDown={(e) => {
					// Esc/Enter inside the editor must not reach the surface
					// shortcuts or close the dialog.
					if (e.key === "Escape" || e.key === "Enter") {
						e.stopPropagation();
					}
					if (composingRef.current || e.nativeEvent.isComposing) return;
					if (
						e.key === "Escape" ||
						(e.key === "Enter" && (e.metaKey || e.ctrlKey))
					) {
						claimEscape(e);
						props.onCommit(true);
					}
				}}
			/>
		</div>
	);
}
