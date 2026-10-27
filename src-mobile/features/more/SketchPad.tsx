import { Eraser, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { BottomSheet } from "../../ui";
import { btnCls, btnPrimaryCls } from "./controls";

interface Stroke {
	color: string;
	points: Array<[number, number]>;
}

const INKS = [
	["--m-text", "黑"],
	["--m-accent", "蓝"],
	["--m-danger", "红"],
] as const;
const LINE_WIDTH = 3;
const CANVAS_RATIO = 0.8;

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#000";

function paint(ctx: CanvasRenderingContext2D, w: number, h: number, strokes: Stroke[], bg: string): void {
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, w, h);
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.lineWidth = LINE_WIDTH;
	for (const s of strokes) {
		ctx.strokeStyle = s.color;
		ctx.fillStyle = s.color;
		const [first, ...rest] = s.points;
		if (!first) continue;
		if (!rest.length) {
			ctx.beginPath();
			ctx.arc(first[0], first[1], LINE_WIDTH / 2, 0, Math.PI * 2);
			ctx.fill();
			continue;
		}
		ctx.beginPath();
		ctx.moveTo(first[0], first[1]);
		for (const [x, y] of rest) ctx.lineTo(x, y);
		ctx.stroke();
	}
}

/** Freehand sketch sheet; resolves a PNG blob through `onDone`. */
export function SketchPad({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (png: Blob) => void }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const strokes = useRef<Stroke[]>([]);
	const current = useRef<Stroke | null>(null);
	const [ink, setInk] = useState<string>(INKS[0][0]);
	const [count, setCount] = useState(0);

	const redraw = useCallback(() => {
		const c = canvasRef.current;
		const ctx = c?.getContext("2d");
		if (!c || !ctx) return;
		const all = current.current ? [...strokes.current, current.current] : strokes.current;
		paint(ctx, c.width, c.height, all, token("--m-bg"));
	}, []);

	const setup = useCallback(
		(node: HTMLCanvasElement | null) => {
			canvasRef.current = node;
			if (!node) return;
			const w = node.clientWidth;
			if (!w) return;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			node.width = Math.round(w * dpr);
			node.height = Math.round(w * CANVAS_RATIO * dpr);
			redraw();
		},
		[redraw],
	);

	useEffect(() => {
		if (open) {
			strokes.current = [];
			current.current = null;
			setCount(0);
		}
	}, [open]);

	const pos = (e: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
		const c = e.currentTarget;
		const r = c.getBoundingClientRect();
		return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
	};
	const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		e.currentTarget.setPointerCapture(e.pointerId);
		current.current = { color: token(ink), points: [pos(e)] };
		redraw();
	};
	const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
		if (!current.current) return;
		current.current.points.push(pos(e));
		redraw();
	};
	const up = () => {
		if (!current.current) return;
		strokes.current.push(current.current);
		current.current = null;
		setCount(strokes.current.length);
		redraw();
	};
	const undo = () => {
		strokes.current.pop();
		setCount(strokes.current.length);
		redraw();
	};
	const done = () => {
		canvasRef.current?.toBlob((b) => {
			if (b) onDone(b);
			onClose();
		}, "image/png");
	};

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			title="手绘草图"
			footer={
				<div className="flex gap-2">
					<button type="button" className={`${btnCls} flex-1`} onClick={onClose}>
						取消
					</button>
					<button type="button" className={`${btnPrimaryCls} flex-1`} disabled={count === 0} onClick={done}>
						添加草图
					</button>
				</div>
			}
		>
			<div className="flex flex-col gap-3 p-4">
				<canvas
					ref={setup}
					className="w-full touch-none rounded-m-md border border-m-border bg-m-bg"
					style={{ aspectRatio: `${1 / CANVAS_RATIO}` }}
					onPointerDown={down}
					onPointerMove={move}
					onPointerUp={up}
					onPointerCancel={up}
				/>
				<div className="flex items-center gap-2">
					{INKS.map(([v, label]) => (
						<button
							key={v}
							type="button"
							aria-pressed={ink === v}
							onClick={() => setInk(v)}
							className={`min-h-11 whitespace-nowrap rounded-m-pill border px-4 text-m-sm ${
								ink === v ? "border-m-accent bg-m-accent text-m-accent-text" : "border-m-border text-m-text-2"
							}`}
						>
							{label}
						</button>
					))}
					<span className="flex-1" />
					<button type="button" className={btnCls} disabled={count === 0} onClick={undo}>
						<Undo2 size={16} /> 撤销
					</button>
					<button
						type="button"
						className={btnCls}
						disabled={count === 0}
						onClick={() => {
							strokes.current = [];
							setCount(0);
							redraw();
						}}
					>
						<Eraser size={16} /> 清空
					</button>
				</div>
			</div>
		</BottomSheet>
	);
}
