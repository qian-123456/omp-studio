/**
 * Mobile Visualize Block.
 * Renders an HTML fragment inside a sandboxed iframe (sandbox="allow-scripts", strict CSP).
 * Communicates via MessageChannel bridge with window.openai contract:
 * - theme: light / dark
 * - widgetState: persisted JSON state
 * - setWidgetState: validated <= 16KB, persisted to sessionStorage
 * - sendFollowUpMessage: dispatches prompt to chat
 * - openExternal: opens URL in browser
 *
 * Includes auto-height calculation with min/max bounds, timeout detection,
 * source code toggle, copy button, and mobile fullscreen view.
 */

import { Check, Copy, Maximize2, RefreshCw, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copyText } from "../../core/lib/format";
import { CodeBlock } from "../CodeBlock";
import { toast } from "../Toast";
import { vizBridgeSource } from "./bridge";
import {
	buildSrcDoc,
	clampVizHeight,
	MAX_VIZ_HEIGHT,
	MAX_WIDGET_STATE_BYTES,
	parseStoredWidgetState,
	utf8Length,
	widgetStateKey,
	type VisualizeMode,
} from "./frame";
import { collectVizThemeVars } from "./themeVars";

const GESTURE_WINDOW_MS = 3000;
const LOAD_TIMEOUT_MS = 10_000;

const widgetStateMemory = new Map<string, string>();
const heightMemory = new Map<string, number>();

function readWidgetState(key: string): string | null {
	const hit = widgetStateMemory.get(key);
	if (hit !== undefined) return hit;
	if (typeof sessionStorage === "undefined") return null;
	try {
		const stored = sessionStorage.getItem(key);
		if (stored !== null) {
			widgetStateMemory.set(key, stored);
			return stored;
		}
	} catch {
		// Ignore storage errors
	}
	return null;
}

function writeWidgetState(key: string, serialized: string): void {
	widgetStateMemory.set(key, serialized);
	if (typeof sessionStorage === "undefined") return;
	try {
		sessionStorage.setItem(key, serialized);
	} catch {
		// Ignore storage quota errors
	}
}

function useCurrentTheme(): "light" | "dark" {
	const [theme, setTheme] = useState<"light" | "dark">(() => {
		if (typeof document === "undefined") return "dark";
		const root = document.documentElement;
		const s = root.dataset.scheme || root.dataset.mode;
		if (s === "light" || s === "dark") return s;
		return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
	});

	useEffect(() => {
		const update = () => {
			const root = document.documentElement;
			const s = root.dataset.scheme || root.dataset.mode;
			if (s === "light" || s === "dark") {
				setTheme(s);
			} else {
				setTheme(window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
			}
		};
		const obs = new MutationObserver(update);
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme", "data-mode"] });
		const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
		mq?.addEventListener("change", update);
		return () => {
			obs.disconnect();
			mq?.removeEventListener("change", update);
		};
	}, []);

	return theme;
}

interface FrameProps {
	html: string;
	mode: VisualizeMode;
	fill?: boolean;
	onSendFollowUp?: (prompt: string) => void;
	onReloadTriggered?: () => void;
}

function VisualizeFrame({
	html,
	mode,
	fill = false,
	onSendFollowUp,
	onReloadTriggered,
}: FrameProps) {
	const theme = useCurrentTheme();
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const portRef = useRef<MessagePort | null>(null);
	const lastActivityRef = useRef(0);

	const stateKey = useMemo(() => widgetStateKey(html, mode), [html, mode]);
	const [reloadSeq, setReloadSeq] = useState(0);
	const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
	const [height, setHeight] = useState<number>(() => heightMemory.get(stateKey) ?? 240);

	const themeRef = useRef(theme);
	themeRef.current = theme;

	const srcDoc = useMemo(
		() =>
			buildSrcDoc({
				html,
				theme: themeRef.current,
				themeVars: collectVizThemeVars(),
				widgetState: parseStoredWidgetState(readWidgetState(stateKey)),
				bridgeSource: vizBridgeSource(MAX_WIDGET_STATE_BYTES),
			}),
		[html, stateKey, reloadSeq],
	);

	useEffect(() => {
		const onBlur = () => {
			if (document.activeElement === iframeRef.current) {
				lastActivityRef.current = Date.now();
			}
		};
		window.addEventListener("blur", onBlur);
		return () => window.removeEventListener("blur", onBlur);
	}, []);

	const consumeGesture = () => {
		const ok = Date.now() - lastActivityRef.current < GESTURE_WINDOW_MS;
		lastActivityRef.current = 0;
		return ok;
	};

	useEffect(() => {
		const vars = collectVizThemeVars();
		portRef.current?.postMessage({ type: "theme", theme, vars });
	}, [theme, reloadSeq]);

	useEffect(() => {
		if (status !== "loading") return;
		const timer = window.setTimeout(() => {
			setStatus("error");
		}, LOAD_TIMEOUT_MS);
		return () => window.clearTimeout(timer);
	}, [status, reloadSeq]);

	const onPortMessage = (e: MessageEvent) => {
		const msg = e.data;
		if (!msg || typeof msg !== "object") return;
		switch (msg.type) {
			case "height": {
				const next = clampVizHeight(msg.height);
				if (next > 0) {
					setHeight(next);
					if (!fill) heightMemory.set(stateKey, next);
					setStatus("ready");
				}
				break;
			}
			case "open-external": {
				const href = typeof msg.href === "string" ? msg.href : "";
				if (!/^(https?:|mailto:)/i.test(href) || !consumeGesture()) return;
				window.open(href, "_blank", "noopener,noreferrer");
				break;
			}
			case "follow-up": {
				const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
				if (!prompt || !consumeGesture()) return;
				if (onSendFollowUp) {
					onSendFollowUp(prompt);
				} else {
					toast("已收到后续指令: " + prompt, { kind: "info" });
				}
				break;
			}
			case "widget-state-write": {
				const id = typeof msg.id === "number" ? msg.id : null;
				const reply = (ok: boolean) => {
					if (id !== null) {
						portRef.current?.postMessage({ type: "widget-state-result", id, ok });
					}
				};
				const serialized = typeof msg.state === "string" ? msg.state : null;
				if (serialized === null || utf8Length(serialized) > MAX_WIDGET_STATE_BYTES) {
					reply(false);
					return;
				}
				try {
					const parsed: unknown = JSON.parse(serialized);
					if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
						reply(false);
						return;
					}
				} catch {
					reply(false);
					return;
				}
				writeWidgetState(stateKey, serialized);
				reply(true);
				break;
			}
			case "scroll-to": {
				const top = typeof msg.top === "number" ? msg.top : 0;
				const frame = iframeRef.current;
				if (!frame) return;
				window.scrollTo({ top: frame.getBoundingClientRect().top + window.scrollY + top, behavior: "smooth" });
				break;
			}
		}
	};

	const handleLoad = () => {
		const frame = iframeRef.current;
		const contentWindow = frame?.contentWindow;
		if (!contentWindow) {
			setStatus("error");
			return;
		}
		const channel = new MessageChannel();
		portRef.current = channel.port1;
		channel.port1.onmessage = onPortMessage;
		contentWindow.postMessage(
			{
				type: "omp-visualize-init",
				theme,
				vars: collectVizThemeVars(),
			},
			"*",
			[channel.port2],
		);
	};

	useEffect(() => {
		return () => {
			portRef.current?.close();
			portRef.current = null;
		};
	}, []);

	const reload = () => {
		setStatus("loading");
		setReloadSeq((s) => s + 1);
		onReloadTriggered?.();
	};

	return (
		<div className={`relative w-full ${fill ? "h-full" : ""}`}>
			{status === "error" && (
				<div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-m-sm bg-m-danger-bg py-1 pr-1 pl-3 text-m-xs text-m-danger">
					<span className="flex-1">可视化组件加载超时或失败</span>
					<button
						type="button"
						onClick={reload}
						className="flex min-h-11 items-center gap-1 whitespace-nowrap rounded-m-pill px-3 text-m-xs font-medium active:opacity-70"
					>
						<RefreshCw size={13} />
						重试
					</button>
				</div>
			)}
			{status === "loading" && (
				<div className="absolute inset-0 flex items-center justify-center bg-m-code-bg text-m-xs text-m-text-3">
					<span className="m-shimmer">正在加载可视化组件</span>
				</div>
			)}
			<iframe
				ref={iframeRef}
				title="visualize"
				sandbox="allow-scripts"
				srcDoc={srcDoc}
				onLoad={handleLoad}
				style={{
					height: fill ? "100%" : `${height}px`,
					minHeight: fill ? undefined : "120px",
					maxHeight: fill ? undefined : `${MAX_VIZ_HEIGHT}px`,
				}}
				className="block w-full border-0 bg-transparent"
			/>
		</div>
	);
}

export interface VisualizeBlockProps {
	html: string;
	mode?: VisualizeMode;
	className?: string;
	onSendFollowUp?: (prompt: string) => void;
}

export const VisualizeBlock = React.memo(function VisualizeBlock({
	html,
	mode = "standard",
	className = "",
	onSendFollowUp,
}: VisualizeBlockProps) {
	const [showSource, setShowSource] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [copied, setCopied] = useState(false);

	const onCopy = async () => {
		const ok = await copyText(html);
		if (ok) {
			setCopied(true);
			toast("代码已复制", { kind: "success" });
			setTimeout(() => setCopied(false), 1500);
		} else {
			toast("复制失败", { kind: "error" });
		}
	};

	const tabBtn = "flex min-h-11 items-center px-0.5";
	const tabPill = (active: boolean) =>
		`flex h-8 items-center whitespace-nowrap rounded-m-pill px-3 text-m-xs transition-colors ${
			active ? "bg-m-surface text-m-text" : "text-m-text-3 active:bg-m-surface-hover"
		}`;
	const circle = "flex h-8 w-8 items-center justify-center rounded-m-pill bg-m-surface text-m-text-2 active:bg-m-surface-2";

	return (
		<>
			<div className={`my-4 overflow-hidden rounded-m-md bg-m-code-bg ${className}`}>
				<div className="flex items-center justify-between pr-1 pl-4">
					<div className="flex items-center gap-2">
						<span className="whitespace-nowrap font-m-mono text-m-xs text-m-text-3">
							{mode === "wide" ? "visualize wide" : "visualize"}
						</span>
						<div className="flex items-center">
							<button type="button" aria-pressed={!showSource} className={tabBtn} onClick={() => setShowSource(false)}>
								<span className={tabPill(!showSource)}>预览</span>
							</button>
							<button type="button" aria-pressed={showSource} className={tabBtn} onClick={() => setShowSource(true)}>
								<span className={tabPill(showSource)}>源码</span>
							</button>
						</div>
					</div>
					<div className="flex items-center">
						{!showSource && (
							<button
								type="button"
								onClick={() => setIsFullscreen(true)}
								aria-label="全屏视图"
								title="全屏视图"
								className="flex min-h-11 min-w-11 items-center justify-center"
							>
								<span className={circle}>
									<Maximize2 size={15} strokeWidth={1.75} />
								</span>
							</button>
						)}
						<button
							type="button"
							onClick={onCopy}
							aria-label="复制代码"
							title="复制代码"
							className="flex min-h-11 min-w-11 items-center justify-center"
						>
							<span className={circle}>{copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.75} />}</span>
						</button>
					</div>
				</div>

				{showSource ? (
					<CodeBlock code={html} lang="html" className="rounded-none bg-transparent" />
				) : (
					<VisualizeFrame
						html={html}
						mode={mode}
						onSendFollowUp={onSendFollowUp}
					/>
				)}
			</div>

			{isFullscreen &&
				typeof document !== "undefined" &&
				createPortal(
					<div className="fixed inset-0 z-(--z-modal) flex flex-col bg-m-bg pt-(--m-safe-top) pb-(--m-safe-bottom) text-m-text">
						<div className="flex min-h-14 items-center justify-between gap-2 pr-2 pl-5">
							<span className="whitespace-nowrap text-m-md font-semibold">可视化全屏视图</span>
							<button
								type="button"
								onClick={() => setIsFullscreen(false)}
								aria-label="关闭全屏"
								className="flex min-h-11 min-w-11 items-center justify-center"
							>
								<span className="flex h-11 w-11 items-center justify-center rounded-m-pill bg-m-surface active:bg-m-surface-2">
									<X size={20} strokeWidth={1.75} />
								</span>
							</button>
						</div>
						<div className="flex-1 w-full overflow-hidden bg-m-bg">
							<VisualizeFrame
								html={html}
								mode={mode}
								fill
								onSendFollowUp={onSendFollowUp}
							/>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
});
