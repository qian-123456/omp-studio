import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eraser, Trash2, Undo2, X } from "lucide-react";
import { Button, IconButton, toast } from "../../../ui";
import { useOverlay } from "../../../ui/overlay";
import {
	COLOR_NAMES,
	SKETCH_COLORS,
	SKETCH_WIDTHS,
	SKETCH_PAPER,
	cappedDpr,
	extendStroke,
	replaySketch,
	resizeSketchCanvas,
	sketchPoint,
	startStroke,
	undoStroke,
} from "../lib/sketchModel";
import type { SketchSize, SketchTool, Stroke } from "../lib/sketchModel";

function SketchOverlay({ onClose, onDone }: { onClose: () => void; onDone: (blob: Blob) => void }) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const strokes = useRef<Stroke[]>([]);
	const drawing = useRef<number | null>(null);
	const model = useRef<SketchSize | null>(null);
	const exporting = useRef(false);
	const mounted = useRef(true);
	const [color, setColor] = useState<string>(SKETCH_COLORS[0]);
	const [width, setWidth] = useState<number>(SKETCH_WIDTHS[1]);
	const [tool, setTool] = useState<SketchTool>("pen");
	const [count, setCount] = useState(0);
	const [busy, setBusy] = useState(false);

	const redraw = useCallback(() => {
		const cv = canvasRef.current;
		if (cv && model.current) replaySketch(cv, strokes.current, model.current, SKETCH_PAPER);
	}, []);

	useEffect(() => {
		const stage = stageRef.current;
		const cv = canvasRef.current;
		if (!stage || !cv) return;
		mounted.current = true;
		const resize = () => {
			const size = { width: stage.clientWidth, height: stage.clientHeight };
			if (size.width <= 0 || size.height <= 0) return;
			model.current ??= size;
			drawing.current = null;
			resizeSketchCanvas(cv, size, model.current, cappedDpr(window.devicePixelRatio));
			redraw();
		};
		const observer = new ResizeObserver(resize);
		observer.observe(stage);
		window.addEventListener("resize", resize);
		resize();
		return () => {
			mounted.current = false;
			observer.disconnect();
			window.removeEventListener("resize", resize);
		};
	}, [redraw]);

	const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (!model.current || drawing.current !== null || exporting.current) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		drawing.current = e.pointerId;
		strokes.current = startStroke(strokes.current, color, width, sketchPoint(e.currentTarget, model.current, e.clientX, e.clientY), tool);
		setCount(strokes.current.length);
		redraw();
	};
	const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (drawing.current !== e.pointerId || !model.current) return;
		extendStroke(strokes.current, sketchPoint(e.currentTarget, model.current, e.clientX, e.clientY));
		redraw();
	};
	const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (drawing.current === e.pointerId) drawing.current = null;
	};

	const done = () => {
		const cv = canvasRef.current;
		if (!cv) return;
		if (strokes.current.length === 0) {
			toast("画布是空的");
			return;
		}
		// toBlob is async: a second tap before it lands would attach the sketch twice.
		if (exporting.current) return;
		drawing.current = null;
		exporting.current = true;
		setBusy(true);
		redraw();
		cv.toBlob((blob) => {
			if (!mounted.current) return;
			if (blob) {
				onClose();
				onDone(blob);
			} else {
				exporting.current = false;
				setBusy(false);
				toast("导出失败", { kind: "error" });
			}
		}, "image/png");
	};

	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="画板"
			className="fixed inset-0 z-(--z-modal) flex flex-col bg-m-bg text-m-text"
			style={{ paddingTop: "var(--m-safe-top)", paddingBottom: "var(--m-safe-bottom)" }}
		>
			<div className="flex h-14 shrink-0 items-center gap-1 px-2">
				<IconButton variant="filled" icon={<X size={22} />} label="取消" onClick={onClose} />
				<span className="min-w-0 flex-1 whitespace-nowrap text-center text-m-md font-semibold">草图</span>
				<IconButton
					variant="filled"
					icon={<Undo2 size={20} />}
					label="撤销"
					disabled={count === 0 || busy}
					onClick={() => {
						drawing.current = null;
						strokes.current = undoStroke(strokes.current);
						setCount(strokes.current.length);
						redraw();
					}}
				/>
				<IconButton
					variant="filled"
					icon={<Trash2 size={20} />}
					label="清空"
					disabled={count === 0 || busy}
					onClick={() => {
						drawing.current = null;
						strokes.current = [];
						setCount(0);
						redraw();
					}}
				/>
				<Button variant="primary" onClick={done} disabled={busy} className="ml-1 shrink-0 whitespace-nowrap">
					完成
				</Button>
			</div>
			<div ref={stageRef} className="relative mx-3 min-h-0 flex-1 overflow-hidden rounded-m-lg bg-m-surface">
				<canvas
					ref={canvasRef}
					className="absolute left-0 top-0 block"
					style={{ touchAction: "none" }}
					onPointerDown={down}
					onPointerMove={move}
					onPointerUp={up}
					onPointerCancel={up}
					onLostPointerCapture={up}
				/>
			</div>
			<div role="toolbar" aria-label="画笔" className="flex max-w-full shrink-0 flex-nowrap items-center gap-3 overflow-x-auto whitespace-nowrap px-3 py-2">
				<button
					type="button"
					aria-label="橡皮擦"
					aria-pressed={tool === "eraser"}
					onClick={() => setTool(tool === "eraser" ? "pen" : "eraser")}
					className={`flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-m-pill px-3 ${tool === "eraser" ? "bg-m-surface-2" : "active:bg-m-surface-hover"}`}
				>
					<Eraser size={20} />
					<span className="text-m-xs">橡皮</span>
				</button>
				<div className="flex shrink-0 items-center gap-1">
					{SKETCH_COLORS.map((c) => (
						<button
							key={c}
							type="button"
							aria-label={COLOR_NAMES[c] ?? "颜色"}
							aria-pressed={tool === "pen" && c === color}
							onClick={() => {
								setColor(c);
								setTool("pen");
							}}
							className="flex size-11 shrink-0 items-center justify-center"
						>
							<span
								className={`block size-7 rounded-m-pill ring-offset-2 ring-offset-m-bg ${tool === "pen" && c === color ? "ring-2 ring-m-accent" : "ring-1 ring-m-border"}`}
								style={{ background: c }}
							/>
						</button>
					))}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{SKETCH_WIDTHS.map((w) => (
						<button
							key={w}
							type="button"
							aria-label={`粗细 ${w}`}
							aria-pressed={w === width}
							onClick={() => setWidth(w)}
							className={`flex size-11 shrink-0 items-center justify-center rounded-m-pill ${w === width ? "bg-m-surface-2" : ""}`}
						>
							<i
								className="block rounded-m-pill bg-m-text"
								style={{ width: w + 4, height: w + 4 }}
							/>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}

/** Full-screen sketch pad; exports a white-background PNG on 完成. */
export function SketchPad({
	open,
	onClose,
	onDone,
}: {
	open: boolean;
	onClose: () => void;
	onDone: (blob: Blob) => void;
}) {
	useOverlay(open, onClose);
	if (!open) return null;
	return createPortal(<SketchOverlay onClose={onClose} onDone={onDone} />, document.body);
}
