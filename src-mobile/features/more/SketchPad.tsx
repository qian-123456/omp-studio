import { Eraser, Trash2, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, toast } from "../../ui";
import { useOverlay } from "../../ui/overlay";
import {
	COLOR_NAMES,
	SKETCH_COLORS,
	SKETCH_WIDTHS,
	cappedDpr,
	extendStroke,
	replaySketch,
	resizeSketchCanvas,
	sketchPoint,
	startStroke,
	undoStroke,
} from "../chat/lib/sketchModel";
import type { SketchSize, SketchTool, Stroke } from "../chat/lib/sketchModel";

/** Inks shown in the toolbar: the palette without white (the paper is white). */
const INKS = SKETCH_COLORS.slice(0, 5);
const WIDTH_NAMES = ["细", "中", "粗"];
const PAPER = "white";


function SketchOverlay({ onClose, onDone }: { onClose: () => void; onDone: (png: Blob) => void }) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const strokes = useRef<Stroke[]>([]);
	const drawing = useRef<number | null>(null);
	const model = useRef<SketchSize | null>(null);
	const exporting = useRef(false);
	const mounted = useRef(true);
	const [color, setColor] = useState<string>(INKS[0]);
	const [width, setWidth] = useState<number>(SKETCH_WIDTHS[1]);
	const [tool, setTool] = useState<SketchTool>("pen");
	const [count, setCount] = useState(0);
	const [busy, setBusy] = useState(false);

	const redraw = useCallback(() => {
		const cv = canvasRef.current;
		if (cv && model.current) replaySketch(cv, strokes.current, model.current, PAPER);
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

	const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!model.current || drawing.current !== null || exporting.current) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		drawing.current = e.pointerId;
		strokes.current = startStroke(strokes.current, color, width, sketchPoint(e.currentTarget, model.current, e.clientX, e.clientY), tool);
		setCount(strokes.current.length);
		redraw();
	};
	const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		if (drawing.current !== e.pointerId || !model.current) return;
		extendStroke(strokes.current, sketchPoint(e.currentTarget, model.current, e.clientX, e.clientY));
		redraw();
	};
	const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		if (drawing.current === e.pointerId) drawing.current = null;
	};
	const undo = () => {
		drawing.current = null;
		strokes.current = undoStroke(strokes.current);
		setCount(strokes.current.length);
		redraw();
	};
	const clear = () => {
		drawing.current = null;
		strokes.current = [];
		setCount(0);
		redraw();
	};
	const done = () => {
		const cv = canvasRef.current;
		if (!cv || strokes.current.length === 0 || exporting.current) return;
		// toBlob is async: a second tap before it lands would attach the sketch twice.
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
		<div role="dialog" aria-modal="true" aria-label="手绘草图" className="fixed inset-0 z-(--z-modal) flex flex-col bg-m-bg text-m-text">
			<div className="flex h-14 shrink-0 items-center gap-1 px-2" style={{ marginTop: "var(--m-safe-top)" }}>
				<IconButton variant="filled" icon={<X size={22} strokeWidth={1.75} />} label="取消" onClick={onClose} />
				<div className="min-w-0 flex-1 px-2 text-m-md font-semibold whitespace-nowrap">手绘草图</div>
				<IconButton icon={<Undo2 size={22} strokeWidth={1.75} />} label="撤销" disabled={count === 0 || busy} onClick={undo} />
				<IconButton icon={<Trash2 size={22} strokeWidth={1.75} />} label="清空" disabled={count === 0 || busy} onClick={clear} />
				<Button variant="primary" size="sm" className="ml-1 shrink-0 whitespace-nowrap" disabled={count === 0 || busy} onClick={done}>
					完成
				</Button>
			</div>
			<div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden rounded-t-m-xl bg-white">
				<canvas
					ref={canvasRef}
					className="absolute left-0 top-0 block touch-none"
					onPointerDown={down}
					onPointerMove={move}
					onPointerUp={up}
					onPointerCancel={up}
					onLostPointerCapture={up}
				/>
				<div
					className="pointer-events-none absolute inset-x-3 flex justify-center"
					style={{ bottom: "calc(var(--m-safe-bottom) + 16px)" }}
				>
					<div role="toolbar" aria-label="画笔" className="pointer-events-auto flex max-w-full flex-nowrap items-center overflow-x-auto whitespace-nowrap rounded-m-pill bg-m-surface p-1 shadow-m-pop">
						<button
							type="button"
							aria-label="橡皮擦"
							aria-pressed={tool === "eraser"}
							onClick={() => setTool(tool === "eraser" ? "pen" : "eraser")}
							className={`flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-m-pill px-3 ${tool === "eraser" ? "bg-m-surface-2" : "active:bg-m-surface-hover"}`}
						>
							<Eraser size={20} strokeWidth={1.75} />
							<span className="text-m-xs">橡皮</span>
						</button>
						{SKETCH_WIDTHS.map((w, i) => (
							<button
								key={w}
								type="button"
								aria-label={`${WIDTH_NAMES[i]}笔`}
								aria-pressed={width === w}
								onClick={() => setWidth(w)}
								className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill ${width === w ? "bg-m-surface-2" : "active:bg-m-surface-hover"}`}
							>
								<span className="rounded-m-pill bg-m-text" style={{ width: w + 4, height: w + 4 }} />
							</button>
						))}
						<span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-m-border-strong" />
						{INKS.map((c) => (
							<button
								key={c}
								type="button"
								aria-label={COLOR_NAMES[c] ?? c}
								aria-pressed={tool === "pen" && color === c}
								onClick={() => {
									setColor(c);
									setTool("pen");
								}}
								className="flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill"
							>
								<span
									className={`h-7 w-7 rounded-m-pill transition-shadow duration-(--m-dur-fast) ${
										tool === "pen" && color === c ? "ring-2 ring-m-accent ring-offset-2 ring-offset-m-surface" : ""
									}`}
									style={{ backgroundColor: c }}
								/>
							</button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

/** Full-screen sketch pad over a white paper; resolves a PNG blob through `onDone`. */
export function SketchPad({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (png: Blob) => void }) {
	useOverlay(open, onClose);
	if (!open) return null;
	return createPortal(<SketchOverlay onClose={onClose} onDone={onDone} />, document.body);
}
