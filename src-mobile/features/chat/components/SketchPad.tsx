import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "../../../ui";
import { useOverlay } from "../../../ui/overlay";
import {
	COLOR_NAMES,
	SKETCH_COLORS,
	SKETCH_WIDTHS,
	cappedDpr,
	extendStroke,
	startStroke,
	undoStroke,
} from "../lib/sketchModel";
import type { Point, Stroke } from "../lib/sketchModel";

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, dpr: number) {
	ctx.strokeStyle = s.color;
	ctx.fillStyle = s.color;
	ctx.lineWidth = s.width * dpr;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	const p = s.pts;
	ctx.beginPath();
	if (p.length === 1) {
		ctx.arc(p[0][0] * dpr, p[0][1] * dpr, (s.width * dpr) / 2, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	ctx.moveTo(p[0][0] * dpr, p[0][1] * dpr);
	for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0] * dpr, p[i][1] * dpr);
	ctx.stroke();
}

const barBtn =
	"inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-m-md border border-m-border bg-m-surface px-4 text-m-md font-medium text-m-text active:bg-m-surface-hover disabled:opacity-50";

function SketchOverlay({ onClose, onDone }: { onClose: () => void; onDone: (blob: Blob) => void }) {
	const stageRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const strokes = useRef<Stroke[]>([]);
	const drawing = useRef(false);
	const dpr = useRef(1);
	const exporting = useRef(false);
	const [color, setColor] = useState<string>(SKETCH_COLORS[0]);
	const [width, setWidth] = useState<number>(SKETCH_WIDTHS[1]);

	const redraw = useCallback(() => {
		const cv = canvasRef.current;
		const ctx = cv?.getContext("2d");
		if (!cv || !ctx) return;
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, cv.width, cv.height);
		for (const s of strokes.current) drawStroke(ctx, s, dpr.current);
	}, []);

	// Measure the stage once after mount; the canvas bitmap is fixed afterwards.
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

	const pos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
		const r = e.currentTarget.getBoundingClientRect();
		return [e.clientX - r.left, e.clientY - r.top];
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
		<div
			role="dialog"
			aria-modal="true"
			aria-label="画板"
			className="fixed inset-0 z-(--z-modal) flex flex-col bg-m-bg text-m-text"
			style={{ paddingTop: "var(--m-safe-top)", paddingBottom: "var(--m-safe-bottom)" }}
		>
			<div className="flex shrink-0 items-center gap-2 border-b border-m-border px-3 py-2">
				<button type="button" className={barBtn} onClick={onClose}>
					取消
				</button>
				<span className="flex-1" />
				<button
					type="button"
					className={barBtn}
					onClick={() => {
						strokes.current = undoStroke(strokes.current);
						redraw();
					}}
				>
					撤销
				</button>
				<button
					type="button"
					className={barBtn}
					onClick={() => {
						strokes.current = [];
						redraw();
					}}
				>
					清空
				</button>
				<button
					type="button"
					className="inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-m-md bg-m-accent px-5 text-m-md font-semibold text-m-accent-text active:opacity-80"
					onClick={done}
				>
					完成
				</button>
			</div>
			<div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden bg-white">
				<canvas
					ref={canvasRef}
					className="absolute left-0 top-0 block"
					style={{ touchAction: "none" }}
					onPointerDown={(e) => {
						e.currentTarget.setPointerCapture(e.pointerId);
						drawing.current = true;
						strokes.current = startStroke(strokes.current, color, width, pos(e));
						redraw();
					}}
					onPointerMove={(e) => {
						if (!drawing.current) return;
						extendStroke(strokes.current, pos(e));
						redraw();
					}}
					onPointerUp={() => {
						drawing.current = false;
					}}
					onPointerCancel={() => {
						drawing.current = false;
					}}
				/>
			</div>
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-m-border px-3 py-2">
				<div className="flex items-center gap-1">
					{SKETCH_COLORS.map((c) => (
						<button
							key={c}
							type="button"
							aria-label={COLOR_NAMES[c] ?? "颜色"}
							aria-pressed={c === color}
							onClick={() => setColor(c)}
							className="flex size-11 items-center justify-center"
						>
							<span
								className={`block size-7 rounded-m-pill border ${c === color ? "border-m-accent ring-2 ring-m-accent" : "border-m-border"}`}
								style={{ background: c }}
							/>
						</button>
					))}
				</div>
				<div className="flex items-center gap-1">
					{SKETCH_WIDTHS.map((w) => (
						<button
							key={w}
							type="button"
							aria-label={`粗细 ${w}`}
							aria-pressed={w === width}
							onClick={() => setWidth(w)}
							className={`flex size-11 items-center justify-center rounded-m-md ${w === width ? "bg-m-surface-2" : ""}`}
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
