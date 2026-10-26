/** Effort slider modelled on the ChatGPT desktop model-picker "power slider":
 * a 24px rounded track, a colored range that ends under a 28px white thumb,
 * 4px stop dots, and — when the strongest stop is reached — a purple animated
 * WebGL fill that sweeps in from the thumb, a particle burst around the thumb
 * and softly drifting sparks inside the track.
 *
 * Geometry (same as ChatGPT): the thumb center sits `13px` in from each track
 * end (`offset(p)` below), the range's right edge follows the thumb center, and
 * every visual position is driven by one animated CSS number `--es-p` (0..100),
 * so the thumb, range and max effects always move in lockstep.
 * Styles live in index.css under "Effort slider". */

import clsx from "clsx";
import { type CSSProperties, type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

/** Half thumb width minus 1px: the thumb center's inset from each track end. */
const THUMB_INSET = 13;
/** Pointer travel (px) before a press counts as a drag. */
const DRAG_SLOP = 4;
/** Wheel delta (px) per stop, and the idle gap (ms) that resets accumulation. */
const WHEEL_STEP = 30;
const WHEEL_RESET_MS = 160;
const EFFECTS_FADE_MS = 300;
const PARTICLE_COUNT = 14;
const PARTICLE_CYCLE_S = 1.6;
const BURST_COUNT = 16;

/** Thumb-center offset (px) added to `p%`: +13 at the left end, -13 at the right. */
function offset(p: number): number {
	return THUMB_INSET - (p / 50) * THUMB_INSET;
}

/** Deterministic 0..1 noise so particles start in stable, scattered spots. */
function noise(i: number, seed: number): number {
	const n = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
	return n - Math.floor(n);
}

function usePrefersReducedMotion(): boolean {
	const [reduced, setReduced] = useState(
		() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
		const sync = () => setReduced(mq.matches);
		mq.addEventListener("change", sync);
		return () => mq.removeEventListener("change", sync);
	}, []);
	return reduced;
}

export function EffortSlider({
	count,
	value,
	label,
	valueText,
	onPreview,
	onCommit,
	onCancel,
}: {
	/** Number of stops, weakest (0) → strongest (count - 1); the last one is "max". */
	count: number;
	/** Displayed stop index; -1 = no stop (e.g. `auto`): thumb and range hidden. */
	value: number;
	label: string;
	/** Accessible text for the displayed stop. */
	valueText: string;
	/** Pointer moved onto another stop (not committed yet). */
	onPreview: (index: number) => void;
	/** Stop chosen: pointer released, arrow key, or wheel notch. */
	onCommit: (index: number) => void;
	/** Press aborted (pointer capture lost / cancelled): drop the preview. */
	onCancel: () => void;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const press = useRef<{ x: number; y: number; index: number } | null>(null);
	const wheel = useRef({ delta: 0, at: 0 });
	const [pressed, setPressed] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [hovered, setHovered] = useState(false);
	// Focus ring only after keyboard use (pointer focus shows none), like ChatGPT.
	const [keyboardFocused, setKeyboardFocused] = useState(false);
	// Bumped each time the max stop is entered by user input: replays the burst
	// and the fill reveal. 0 = max was already selected when the slider opened.
	const [burstKey, setBurstKey] = useState(0);
	const reduced = usePrefersReducedMotion();

	const last = count - 1;
	const p = value < 0 ? null : last <= 0 ? 0 : (value / last) * 100;
	const atMax = last > 0 && value === last;
	const effects = useDelayedUnmount(atMax, reduced ? 0 : EFFECTS_FADE_MS);

	const move = (index: number) => {
		if (index === value) return;
		setBurstKey((k) => (index === last ? k + 1 : 0));
		onPreview(index);
	};
	const step = (index: number) => {
		const next = Math.max(0, Math.min(last, index));
		move(next);
		onCommit(next);
	};
	const indexAt = (clientX: number) => {
		const r = rootRef.current?.getBoundingClientRect();
		if (!r || r.width <= THUMB_INSET * 2 || last <= 0) return 0;
		const f = (clientX - r.left - THUMB_INSET) / (r.width - THUMB_INSET * 2);
		return Math.round(Math.min(1, Math.max(0, f)) * last);
	};
	const release = () => {
		press.current = null;
		setPressed(false);
		setDragging(false);
		setHovered(false);
	};

	const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0 || last <= 0) return;
		e.preventDefault();
		e.currentTarget.focus({ preventScroll: true });
		setKeyboardFocused(false);
		e.currentTarget.setPointerCapture(e.pointerId);
		const index = indexAt(e.clientX);
		press.current = { x: e.clientX, y: e.clientY, index };
		setPressed(true);
		move(index);
	};
	const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
		const start = press.current;
		if (!start) return;
		if (!dragging && (e.clientX - start.x) ** 2 + (e.clientY - start.y) ** 2 >= DRAG_SLOP ** 2) setDragging(true);
		const index = indexAt(e.clientX);
		start.index = index;
		move(index);
	};
	const onPointerUp = () => {
		const start = press.current;
		if (!start) return;
		release();
		onCommit(start.index);
	};
	const onPointerAbort = () => {
		if (!press.current) return;
		release();
		onCancel();
	};
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (last <= 0) return;
		const from = value < 0 ? -1 : value;
		let next: number;
		switch (e.key) {
			case "ArrowRight":
			case "ArrowUp":
			case "PageUp":
				next = from + 1;
				break;
			case "ArrowLeft":
			case "ArrowDown":
			case "PageDown":
				next = from < 0 ? 0 : from - 1;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = last;
				break;
			default:
				return;
		}
		e.preventDefault();
		setKeyboardFocused(true);
		step(next);
	};

	// Wheel / trackpad scrolling walks the stops, one per 30px of travel (ChatGPT
	// behavior). Needs a non-passive listener to stop the popover from scrolling.
	const onWheel = (e: WheelEvent) => {
		if (e.ctrlKey || last <= 0 || press.current) return;
		e.preventDefault();
		let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : -e.deltaY;
		if ((e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean }).webkitDirectionInvertedFromDevice) delta *= -1;
		if (e.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) delta = Math.sign(delta) * WHEEL_STEP;
		if (delta === 0) return;
		const acc = wheel.current;
		if (e.timeStamp - acc.at > WHEEL_RESET_MS || Math.sign(delta) !== Math.sign(acc.delta)) acc.delta = 0;
		acc.at = e.timeStamp;
		acc.delta += delta;
		if (Math.abs(acc.delta) < WHEEL_STEP) return;
		const dir = Math.sign(acc.delta);
		acc.delta -= dir * WHEEL_STEP;
		const next = value < 0 ? 0 : Math.max(0, Math.min(last, value + dir));
		if (next === value) {
			acc.delta = 0;
			return;
		}
		step(next);
	};
	const wheelRef = useRef(onWheel);
	wheelRef.current = onWheel;
	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const listener = (e: WheelEvent) => wheelRef.current(e);
		el.addEventListener("wheel", listener, { passive: false });
		return () => el.removeEventListener("wheel", listener);
	}, []);

	const thumbLift = !reduced && p !== null && (hovered || pressed);
	return (
		<div className="es-container">
			<div
				ref={rootRef}
				role="slider"
				tabIndex={0}
				aria-label={label}
				aria-valuemin={0}
				aria-valuemax={Math.max(last, 0)}
				aria-valuenow={Math.max(value, 0)}
				aria-valuetext={valueText}
				data-dragging={dragging}
				data-highlighted={atMax}
				data-reduced-motion={reduced}
				data-keyboard-focused={keyboardFocused}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerAbort}
				onLostPointerCapture={onPointerAbort}
				onKeyDown={onKeyDown}
				onBlur={() => setKeyboardFocused(false)}
				className="es-root outline-none"
				style={{ "--es-p": p ?? 0, "--es-z": Math.max(last, 1) } as CSSProperties}
			>
				<div className="es-track">
					<span aria-hidden className={clsx("es-range", p === null && "es-range-empty")}>
						{effects.mounted && (
							<span className="es-max-effects" data-visible={effects.visible}>
								<MaxFill reveal={!reduced && burstKey > 0} reduced={reduced} />
								{!reduced && <TrackParticles />}
							</span>
						)}
					</span>
					<div className="es-tick-rail">
						{Array.from({ length: count }, (_, i) => {
							const tp = last <= 0 ? 0 : (i / last) * 100;
							return (
								<span
									key={i}
									className="es-tick"
									data-selected={value >= 0 && i <= value}
									style={{ left: `calc(${tp}% + ${offset(tp)}px)` }}
								/>
							);
						})}
					</div>
				</div>
				{p !== null && (
					<div aria-hidden className="es-thumb-rail">
						<span
							className="es-thumb-pos"
							onPointerEnter={() => setHovered(true)}
							onPointerLeave={() => setHovered(false)}
						>
							{atMax && burstKey > 0 && !reduced && <MaxBurst key={burstKey} />}
							<span className="es-thumb-spring" data-lifted={thumbLift}>
								<span className="es-thumb" />
							</span>
						</span>
					</div>
				)}
			</div>
		</div>
	);
}

/** Keeps a fading layer mounted for `delayMs` after `on` turns false. */
function useDelayedUnmount(on: boolean, delayMs: number): { mounted: boolean; visible: boolean } {
	const [mounted, setMounted] = useState(on);
	const [visible, setVisible] = useState(on);
	useEffect(() => {
		if (on) {
			setMounted(true);
			// Next frame so the opacity transition starts from 0.
			const raf = requestAnimationFrame(() => setVisible(true));
			return () => cancelAnimationFrame(raf);
		}
		setVisible(false);
		const t = window.setTimeout(() => setMounted(false), delayMs);
		return () => window.clearTimeout(t);
	}, [on, delayMs]);
	return { mounted, visible };
}

/** 16 dots flying out of the thumb once, when the max stop is entered. */
function MaxBurst() {
	return (
		<span aria-hidden className="es-burst">
			{Array.from({ length: BURST_COUNT }, (_, i) => (
				<span key={i} />
			))}
		</span>
	);
}

/** Small white sparks drifting inside the maxed-out track. */
function TrackParticles() {
	return (
		<span aria-hidden className="es-particles">
			{Array.from({ length: PARTICLE_COUNT }, (_, i) => (
				<TrackParticle key={i} index={i} />
			))}
		</span>
	);
}

function particleSpot(rand: () => number) {
	const dx = rand();
	const dy = rand();
	return {
		durationScale: 0.8 + rand() * 1.2,
		dx: Math.round((dx - 0.5) * 8),
		y: Math.round(12 + (dy - 0.5) * 14),
	};
}

function TrackParticle({ index }: { index: number }) {
	const [spot, setSpot] = useState(() => {
		let seed = 1;
		return particleSpot(() => noise(index, seed++));
	});
	useEffect(() => {
		let timer = 0;
		const hop = () => {
			const next = particleSpot(Math.random);
			setSpot(next);
			timer = window.setTimeout(hop, PARTICLE_CYCLE_S * next.durationScale * 1000);
		};
		const raf = requestAnimationFrame(hop);
		return () => {
			cancelAnimationFrame(raf);
			window.clearTimeout(timer);
		};
	}, []);
	const base = Math.round(4 + noise(index, 14) * 92);
	return (
		<span
			className="es-particle"
			style={{
				left: `calc(${base}% + ${spot.dx}px)`,
				top: spot.y,
				opacity: 0.4 + noise(index, 11) * 0.6,
				transform: `translate(-50%, -50%) scale(${0.5 + noise(index, 12) * 0.45})`,
				transitionDuration: `${PARTICLE_CYCLE_S * spot.durationScale}s`,
			}}
		/>
	);
}

/** Purple fill for the max stop: a gradient tinted by an animated WebGL color
 * field (luminosity blend), optionally revealed with a right-to-left sweep. */
function MaxFill({ reveal, reduced }: { reveal: boolean; reduced: boolean }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		return startColorField(canvas, reduced);
	}, [reduced]);
	return (
		<span aria-hidden className="es-max-fill" data-reveal={reveal}>
			<span className="es-max-mask">
				<canvas ref={canvasRef} className="es-max-canvas" />
			</span>
		</span>
	);
}

const VERTEX_SHADER = `
attribute vec2 aPosition;
varying vec2 vUv;
void main() {
	vUv = aPosition * 0.5 + 0.5;
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/** Twelve drifting gaussian color blobs + film grain (ChatGPT's max fill shader). */
const FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;

const vec3 COLOR_1 = vec3(0.592, 0.388, 0.945);
const vec3 COLOR_2 = vec3(0.831, 0.710, 0.953);
const vec3 COLOR_3 = vec3(0.286, 0.000, 0.404);
const vec3 COLOR_4 = vec3(0.145, 0.055, 0.478);
const vec3 COLOR_5 = vec3(0.592, 0.000, 0.996);
const vec3 COLOR_6 = vec3(0.780, 0.459, 0.914);
const vec3 COLOR_7 = vec3(0.725, 0.576, 1.000);
const vec3 COLOR_8 = vec3(0.400, 0.212, 0.820);
const vec3 COLOR_9 = vec3(0.882, 0.690, 1.000);
const vec3 COLOR_10 = vec3(0.498, 0.345, 0.957);
const vec3 COLOR_11 = vec3(0.659, 0.275, 0.910);
const vec3 COLOR_12 = vec3(0.212, 0.063, 0.400);

float grain(vec2 uv) {
	vec2 grainUv = uv * uResolution * 0.5;
	return fract(sin(dot(grainUv + uTime, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;
}

float fieldWeight(vec2 point, vec2 center) {
	return exp(-dot(point - center, point - center) * 12.0);
}

vec3 fieldColor(vec2 rawUv) {
	const float speed = 1.25;
	vec2 uv = vec2(rawUv.x, 0.40 + rawUv.y * 0.18);
	vec2 s = vec2(1.55, 1.0);
	vec2 point = uv * s;
	float t = uTime * speed;
	vec2 c1 = vec2(0.18 + sin(t * 0.42) * 0.18, 0.36 + cos(t * 0.50) * 0.42) * s;
	vec2 c2 = vec2(0.34 + cos(t * 0.62) * 0.24, 0.62 + sin(t * 0.47) * 0.38) * s;
	vec2 c3 = vec2(0.52 + sin(t * 0.38) * 0.28, 0.30 + cos(t * 0.58) * 0.36) * s;
	vec2 c4 = vec2(0.70 + cos(t * 0.54) * 0.24, 0.68 + sin(t * 0.41) * 0.36) * s;
	vec2 c5 = vec2(0.88 + sin(t * 0.74) * 0.16, 0.36 + cos(t * 0.64) * 0.40) * s;
	vec2 c6 = vec2(0.12 + cos(t * 0.48) * 0.20, 0.72 + sin(t * 0.70) * 0.30) * s;
	vec2 c7 = vec2(0.30 + sin(t * 0.58) * 0.22, 0.44 + cos(t * 0.52) * 0.42) * s;
	vec2 c8 = vec2(0.46 + cos(t * 0.68) * 0.26, 0.72 + sin(t * 0.56) * 0.32) * s;
	vec2 c9 = vec2(0.60 + sin(t * 0.44) * 0.28, 0.26 + cos(t * 0.60) * 0.38) * s;
	vec2 c10 = vec2(0.76 + cos(t * 0.50) * 0.22, 0.54 + sin(t * 0.66) * 0.40) * s;
	vec2 c11 = vec2(0.92 + sin(t * 0.70) * 0.15, 0.66 + cos(t * 0.46) * 0.30) * s;
	vec2 c12 = vec2(0.06 + cos(t * 0.40) * 0.14, 0.32 + sin(t * 0.60) * 0.40) * s;
	float w1 = fieldWeight(point, c1) * (0.7 + 0.3 * sin(uTime * 0.91));
	float w2 = fieldWeight(point, c2) * (0.7 + 0.3 * cos(uTime * 1.07));
	float w3 = fieldWeight(point, c3) * (0.7 + 0.3 * sin(uTime * 0.76));
	float w4 = fieldWeight(point, c4) * (0.7 + 0.3 * cos(uTime * 1.18));
	float w5 = fieldWeight(point, c5) * (0.7 + 0.3 * sin(uTime * 1.03));
	float w6 = fieldWeight(point, c6) * (0.7 + 0.3 * cos(uTime * 0.83));
	float w7 = fieldWeight(point, c7) * (0.7 + 0.3 * sin(uTime * 1.24));
	float w8 = fieldWeight(point, c8) * (0.7 + 0.3 * cos(uTime * 0.96));
	float w9 = fieldWeight(point, c9) * (0.7 + 0.3 * sin(uTime * 1.11));
	float w10 = fieldWeight(point, c10) * (0.7 + 0.3 * cos(uTime * 0.72));
	float w11 = fieldWeight(point, c11) * (0.7 + 0.3 * sin(uTime * 1.29));
	float w12 = fieldWeight(point, c12) * (0.7 + 0.3 * cos(uTime * 0.88));
	float total = max(w1 + w2 + w3 + w4 + w5 + w6 + w7 + w8 + w9 + w10 + w11 + w12, 0.0001);
	vec3 color = (
		COLOR_1 * w1 + COLOR_2 * w2 + COLOR_3 * w3 + COLOR_4 * w4 +
		COLOR_5 * w5 + COLOR_6 * w6 + COLOR_7 * w7 + COLOR_8 * w8 +
		COLOR_9 * w9 + COLOR_10 * w10 + COLOR_11 * w11 + COLOR_12 * w12
	) / total;
	color = mix(COLOR_4, color, 0.96);
	return pow(clamp(color, vec3(0.0), vec3(1.0)), vec3(0.9));
}

void main() {
	vec3 color = fieldColor(vUv);
	color += grain(vUv) * 0.012;
	color.r += sin(uTime * 0.5) * 0.02;
	color.g += cos(uTime * 0.7) * 0.02;
	color.b += sin(uTime * 0.6) * 0.02;
	color = pow(color, vec3(0.92));
	gl_FragColor = vec4(color, 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
	gl.deleteShader(shader);
	return null;
}

/** Renders the color field into `canvas` until the returned cleanup runs.
 * Reduced motion draws one still frame. No-op where WebGL is unavailable. */
function startColorField(canvas: HTMLCanvasElement, still: boolean): (() => void) | undefined {
	if (typeof WebGLRenderingContext === "undefined" || typeof ResizeObserver === "undefined") return;
	const gl = canvas.getContext("webgl", { alpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
	if (!gl) return;
	const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
	const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
	const program = vs && fs ? gl.createProgram() : null;
	if (!vs || !fs || !program) {
		if (vs) gl.deleteShader(vs);
		if (fs) gl.deleteShader(fs);
		return;
	}
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		gl.deleteProgram(program);
		return;
	}
	const buffer = gl.createBuffer();
	if (!buffer) {
		gl.deleteProgram(program);
		return;
	}
	const aPosition = gl.getAttribLocation(program, "aPosition");
	const uResolution = gl.getUniformLocation(program, "uResolution");
	const uTime = gl.getUniformLocation(program, "uTime");
	gl.useProgram(program);
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(aPosition);
	gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

	const start = performance.now();
	let raf = 0;
	const draw = (seconds: number) => {
		gl.uniform1f(uTime, seconds);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	};
	const resize = () => {
		const dpr = Math.min(window.devicePixelRatio, 2);
		const { width, height } = canvas.getBoundingClientRect();
		const w = Math.max(Math.round(width), 1);
		const h = Math.max(Math.round(height), 1);
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		gl.viewport(0, 0, canvas.width, canvas.height);
		gl.uniform2f(uResolution, w, h);
		draw(still ? 0 : (performance.now() - start) / 1000);
	};
	const frame = (now: number) => {
		draw((now - start) / 1000);
		raf = requestAnimationFrame(frame);
	};
	const ro = new ResizeObserver(resize);
	resize();
	ro.observe(canvas);
	if (!still) raf = requestAnimationFrame(frame);
	return () => {
		if (raf) cancelAnimationFrame(raf);
		ro.disconnect();
		gl.deleteBuffer(buffer);
		gl.deleteProgram(program);
	};
}
