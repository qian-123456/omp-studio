import { Eraser, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton, toast } from "../../ui";
import { useOverlay } from "../../ui/overlay";
import { COLOR_NAMES, SKETCH_COLORS, SKETCH_WIDTHS, cappedDpr, extendStroke, startStroke, undoStroke } from "../chat/lib/sketchModel";
import type { Point, Stroke } from "../chat/lib/sketchModel";

/** Inks shown in the toolbar: the palette without white (the paper is white). */
const INKS = SKETCH_COLORS.slice(0, 5);
const WIDTH_NAMES = ["细", "中", "粗"];
const PAPER = "white";

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, dpr: number): void {
	ctx.strokeStyle = s.color;
	ctx.fillStyle = s.color;
	ctx.lineWidth = s.width * dpr;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	const [first, ...rest] = s.pts;
	if (!first) return;
	ctx.beginPath();
	if (!rest.length) {
		ctx.arc(first[0] * dpr, first[1] * dpr, (s.width * dpr) / 2, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	ctx.moveTo(first[0] * dpr, first[1] * dpr);
	for (const [x, y] of rest) ctx.lineTo(x * dpr, y * dpr);
	ctx.stroke();
}

function SketchOverlay({ onClose, onDone }: { onClose: () => void; onDone: (png: Blob) => void }) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const strokes = useRef<Stroke[]>([]);
	const drawing = useRef(false);
	const dpr = useRef(1);
	const exporting = useRef(false);
	const [color, setColor] = useState<string>(INKS[0]);
	const [width, setWidth] = useState<number>(SKETCH_WIDTHS[1]);
	const [count, setCount] = useState(0);

	const redraw = useCallback(() => {
		const cv = canvasRef.current;
		const ctx = cv?.getContext("2d");
		if (!cv || !ctx) return;
		ctx.fillStyle = PAPER;
		ctx.fillRect(0, 0, cv.width, cv.height);
		for (const s of strokes.current) drawStroke(ctx, s, dpr.current);
	}, []);

	// Measure the stage once after mount; the bitmap is fixed afterwards.
	useEffect(() => {
		const stage = stageRef.current;
		const cv = canvasRef.current;
		if (!stage || !cv) return;
		dpr.current = cappedDpr(window.devicePixelRatio);
		const w = Math.max(1, Math.round(stage.clientWidth));
		const h = Math.max(1, Math.round(stage.clientHeight));
		cv.width = w * dpr.current;
		cv.height = h * dpr.current;
		cv.style.width = `${w}px`;
		cv.style.height = `${h}px`;
		redraw();
	}, [redraw]);

	const pos = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
		const r = e.currentTarget.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
	};
	const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		e.currentTarget.setPointerCapture(e.pointerId);
		drawing.current = true;
		strokes.current = startStroke(strokes.current, color, width, pos(e));
		redraw();
	};
	const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!drawing.current) return;
		extendStroke(strokes.current, pos(e));
		redraw();
	};
	const up = () => {
		if (!drawing.current) return;
		drawing.current = false;
		setCount(strokes.current.length);
	};
	const undo = () => {
		strokes.current = undoStroke(strokes.current);
		setCount(strokes.current.length);
		redraw();
	};
	const clear = () => {
		strokes.current = [];
		setCount(0);
		redraw();
	};
	const done = () => {
		const cv = canvasRef.current;
		if (!cv || exporting.current) return;
		// toBlob is async: a second tap before it lands would attach the sketch twice.
		exporting.current = true;
		cv.toBlob((blob) => {
			if (blob) {
				onClose();
				onDone(blob);
			} else {
				exporting.current = false;
				toast("导出失败", { kind: "error" });
			}
		}, "image/png");
	};

	return (
		<div role="dialog" aria-modal="true" aria-label="手绘草图" className="fixed inset-0 z-(--z-modal) flex flex-col bg-m-bg text-m-text">
			<div className="flex h-14 shrink-0 items-center gap-1 px-2" style={{ marginTop: "var(--m-safe-top)" }}>
				<IconButton variant="filled" icon={<X size={22} strokeWidth={1.75} />} label="取消" onClick={onClose} />
				<div className="min-w-0 flex-1 px-2 text-m-md font-semibold whitespace-nowrap">手绘草图</div>
				<IconButton icon={<Undo2 size={22} strokeWidth={1.75} />} label="撤销" disabled={count === 0} onClick={undo} />
				<IconButton icon={<Eraser size={22} strokeWidth={1.75} />} label="清空" disabled={count === 0} onClick={clear} />
				<Button variant="primary" size="sm" className="ml-1" disabled={count === 0} onClick={done}>
					完成
				</Button>
			</div>
			<div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden rounded-t-m-xl bg-white">
				<canvas
					ref={canvasRef}
					className="block touch-none"
					onPointerDown={down}
					onPointerMove={move}
					onPointerUp={up}
					onPointerCancel={up}
				/>
				<div
					className="pointer-events-none absolute inset-x-3 flex justify-center"
					style={{ bottom: "calc(var(--m-safe-bottom) + 16px)" }}
				>
					<div role="toolbar" aria-label="画笔" className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center rounded-m-pill bg-m-surface p-1 shadow-m-pop">
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
								aria-pressed={color === c}
								onClick={() => setColor(c)}
								className="flex h-11 w-11 shrink-0 items-center justify-center rounded-m-pill"
							>
								<span
									className={`h-7 w-7 rounded-m-pill transition-shadow duration-(--m-dur-fast) ${
										color === c ? "ring-2 ring-m-accent ring-offset-2 ring-offset-m-surface" : ""
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
