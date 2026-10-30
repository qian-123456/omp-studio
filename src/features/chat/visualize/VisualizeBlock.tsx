/**
 * Renders a `visualize` fenced block: the model's HTML fragment inside a
 * sandboxed srcdoc iframe (allow-scripts only, opaque origin, CSP from
 * frame.ts) with a quiet header row (source toggle / copy / fullscreen).
 * The in-iframe bridge (bridge.ts) exposes window.openai for theme, widget
 * state, link opening and follow-up prompts; the host side lives here.
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	Code2,
	ExternalLink,
	Loader2,
	Maximize2,
	RotateCw,
	X,
} from "lucide-react";
import React, {
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { FloatingLayer } from "../../../components/FloatingLayer";
import { CopyButton } from "../../../components/CopyButton";
import { errMsg } from "../../../lib/dialogs";
import { openHtmlInBrowser } from "./openInBrowser";
import { themeById, useResolvedThemeId } from "../../../lib/theme";
import { toast } from "../../../lib/toast";
import { tNow, useT } from "../../../stores/language";
import { sendPrompt } from "../send";
import { vizBridgeSource } from "./bridge";
import {
	buildSrcDoc,
	clampVizHeight,
	MAX_WIDGET_STATE_BYTES,
	parseStoredWidgetState,
	utf8Length,
	widgetStateKey,
	type VisualizeMode,
} from "./frame";
import { collectVizThemeVars } from "./themeVars";

/** How long a user gesture is honored for openExternal / follow-up. */
const GESTURE_WINDOW_MS = 3000;
/** No first height message within this window → error state. */
const LOAD_TIMEOUT_MS = 10_000;

/**
 * Per-block widget-state store: in-memory map backed by sessionStorage so a
 * reload (or the fullscreen frame) resumes where the last write left off.
 */
const widgetStateMemory = new Map<string, string>();
/** Entries are up to ~100 KB each; sessionStorage keeps the evicted ones readable. */
const WIDGET_STATE_MEMORY_LIMIT = 50;

function readWidgetState(key: string): string | null {
	const hit = widgetStateMemory.get(key);
	if (hit !== undefined) return hit;
	try {
		return window.sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

function writeWidgetState(key: string, serialized: string): void {
	// Re-insert so the Map's insertion order doubles as recency; evict oldest past the cap.
	widgetStateMemory.delete(key);
	widgetStateMemory.set(key, serialized);
	if (widgetStateMemory.size > WIDGET_STATE_MEMORY_LIMIT) {
		const oldest = widgetStateMemory.keys().next().value;
		if (oldest !== undefined) widgetStateMemory.delete(oldest);
	}
	try {
		window.sessionStorage.setItem(key, serialized);
	} catch {
		/* storage full or unavailable — the in-memory copy still applies */
	}
}

/**
 * Last reported content height per document, keyed like widget state. A
 * remounted frame (virtualized row scrolled back into view, reopened session)
 * starts at this height instead of the 240px placeholder, so its row is not
 * re-measured and the transcript does not shift. Bounded; oldest evicted first.
 */
const HEIGHT_MEMORY_LIMIT = 200;
const heightMemory = new Map<string, number>();

function rememberHeight(key: string, height: number): void {
	heightMemory.delete(key);
	heightMemory.set(key, height);
	if (heightMemory.size > HEIGHT_MEMORY_LIMIT) {
		const oldest = heightMemory.keys().next().value;
		if (oldest !== undefined) heightMemory.delete(oldest);
	}
}

type FrameStatus = "loading" | "ready" | "error";

/**
 * The sandboxed iframe plus its host-side bridge wiring. `fill` makes it take
 * the parent's height (fullscreen modal) instead of auto-sizing to content.
 */
function VisualizeFrame({
	html,
	mode,
	sessionId,
	fill = false,
}: {
	html: string;
	mode: VisualizeMode;
	sessionId?: string;
	fill?: boolean;
}) {
	const themeId = useResolvedThemeId();
	const theme: "light" | "dark" =
		themeById(themeId)?.dark === false ? "light" : "dark";
	const { t } = useT();
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const portRef = useRef<MessagePort | null>(null);
	const sessionIdRef = useRef(sessionId);
	sessionIdRef.current = sessionId;
	const lastActivityRef = useRef(0);

	const stateKey = useMemo(() => widgetStateKey(html, mode), [html, mode]);

	const [reloadSeq, setReloadSeq] = useState(0);
	const [status, setStatus] = useState<FrameStatus>("loading");
	const [height, setHeight] = useState<number | null>(
		() => heightMemory.get(stateKey) ?? null,
	);
	const [showSource, setShowSource] = useState(false);

	// srcdoc is intentionally NOT rebuilt on theme changes — the bridge applies
	// them live — so memo keys are the document inputs plus the reload tick.
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

	// A gesture counts only when it belongs to THIS frame: clicks inside a
	// cross-origin iframe never reach the parent, but they blur the host window
	// while the iframe is the active element. Host-wide keydown/pointerdown
	// (typing in the composer, clicking elsewhere) must not count. The gesture
	// is consumed by one follow-up / open-external.
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

	// Push live theme updates into the frame without reloading it.
	useEffect(() => {
		const vars = collectVizThemeVars();
		portRef.current?.postMessage({ type: "theme", theme, vars });
	}, [theme, reloadSeq]);

	// Load timeout: a fragment that never reports a height is treated as failed.
	useEffect(() => {
		if (status !== "loading") return;
		const timer = window.setTimeout(() => setStatus("error"), LOAD_TIMEOUT_MS);
		return () => window.clearTimeout(timer);
	}, [status, reloadSeq]);

	const onPortMessage = async (e: MessageEvent) => {
		const msg = e.data;
		if (!msg || typeof msg !== "object") return;
		switch (msg.type) {
			case "height": {
				const next = clampVizHeight(msg.height);
				if (next > 0) {
					setHeight(next);
					// Fullscreen frames fill the modal; their height is not the content's.
					if (!fill) rememberHeight(stateKey, next);
					setStatus((s) => (s === "loading" ? "ready" : s));
				}
				break;
			}
			case "open-external": {
				const href = typeof msg.href === "string" ? msg.href : "";
				if (!/^(https?:|mailto:)/i.test(href) || !consumeGesture()) return;
				try {
					await openUrl(href);
				} catch (err) {
					toast.error(tNow("visualize.openLinkFailed", { error: errMsg(err) }));
				}
				break;
			}
			case "follow-up": {
				const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
				if (!prompt || !consumeGesture()) return;
				const target = sessionIdRef.current;
				if (!target) {
					toast.error(tNow("visualize.unsupportedContext"));
					return;
				}
				try {
					await sendPrompt(target, prompt);
				} catch (err) {
					toast.error(tNow("visualize.sendFailed", { error: errMsg(err) }));
				}
				break;
			}
			case "widget-state-write": {
				const id = typeof msg.id === "number" ? msg.id : null;
				const reply = (ok: boolean) => {
					if (id !== null) {
						portRef.current?.postMessage({
							type: "widget-state-result",
							id,
							ok,
						});
					}
				};
				const serialized =
					typeof msg.state === "string" ? msg.state : null;
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
				if (!frame || !frame.parentElement) return;
				let scroller: HTMLElement | null = frame.parentElement;
				while (
					scroller &&
					scroller !== document.body &&
					scroller.scrollHeight <= scroller.clientHeight
				) {
					scroller = scroller.parentElement;
				}
				const container =
					scroller && scroller !== document.body
						? scroller
						: document.scrollingElement;
				if (!container) return;
				const containerTop =
					container === document.scrollingElement
						? 0
						: (container as HTMLElement).getBoundingClientRect().top;
				const frameTop = frame.getBoundingClientRect().top;
				const current =
					container === document.scrollingElement
						? window.scrollY
						: (container as HTMLElement).scrollTop;
				const target = Math.max(0, current + frameTop + top - containerTop - 24);
				if (container === document.scrollingElement) {
					window.scrollTo({ top: target, behavior: "smooth" });
				} else {
					(container as HTMLElement).scrollTo({ top: target, behavior: "smooth" });
				}
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
		channel.port1.onmessage = (e) => {
			void onPortMessage(e);
		};
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

	useEffect(
		() => () => {
			portRef.current?.close();
			portRef.current = null;
		},
		[],
	);

	const reload = () => {
		portRef.current?.close();
		portRef.current = null;
		// Restart from the last known content height, not the 240px placeholder,
		// so the reloaded frame does not shift the transcript.
		setHeight(heightMemory.get(stateKey) ?? null);
		setStatus("loading");
		setReloadSeq((n) => n + 1);
	};

	return (
		<div
			className={clsx(
				"relative overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] p-3",
				fill && "flex h-full flex-col",
			)}
		>
			{status === "error" ? (
				<div className="flex flex-col items-start gap-2 p-3 text-[12px]">
					<div className="flex w-full items-center justify-between gap-2">
						<span className="text-[var(--text-40)]">{t("visualize.loadFailed")}</span>
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								onClick={reload}
								className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40)] transition-colors hover:text-[var(--text)]"
							>
								<RotateCw size={12} />
								<span>{t("visualize.reload")}</span>
							</button>
							<button
								type="button"
								onClick={() => setShowSource((v) => !v)}
								className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40)] transition-colors hover:text-[var(--text)]"
							>
								<Code2 size={12} />
								<span>{showSource ? t("visualize.hideSource") : t("visualize.viewSource")}</span>
							</button>
						</div>
					</div>
					{showSource && <SourceView source={html} />}
				</div>
			) : (
				<>
					<iframe
						key={reloadSeq}
						ref={iframeRef}
						sandbox="allow-scripts"
						referrerPolicy="no-referrer"
						srcDoc={srcDoc}
						title={t("visualize.contentTitle")}
						onLoad={handleLoad}
						onError={() => setStatus("error")}
						className={clsx(
							"block w-full border-0 bg-transparent",
							fill && "min-h-0 flex-1",
						)}
						style={fill ? undefined : { height: height ?? 240 }}
					/>
					{status === "loading" && (
						<div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-[var(--well-bg)] text-[12px] text-[var(--text-40)]">
							<Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
							<span>{t("visualize.generating")}</span>
						</div>
					)}
				</>
			)}
		</div>
	);
}

function SourceView({ source }: { source: string }) {
	return (
		<pre className="max-h-[320px] w-full overflow-auto rounded-[8px] border border-[var(--line)] bg-[var(--bg)] p-3 font-mono text-[11px] leading-5 text-[var(--text-60)]">
			<code>{source}</code>
		</pre>
	);
}

/**
 * Header chrome + frame. Memoized on html/mode/sessionId so streaming tokens
 * that re-render the surrounding markdown never reload the iframe.
 */
export const VisualizeBlock = React.memo(function VisualizeBlock({
	html,
	mode,
	streaming,
	sessionId,
}: {
	html: string;
	mode: VisualizeMode;
	streaming?: boolean;
	sessionId?: string;
}) {
	const [fullscreen, setFullscreen] = useState(false);
	const [showSource, setShowSource] = useState(false);
	const { t } = useT();
	const darkTheme = themeById(useResolvedThemeId())?.dark !== false;
	if (streaming) {
		return (
			<div
				className={clsx(
					"my-2 flex h-[240px] w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] text-[12px] text-[var(--text-40)]",
					mode === "wide" ? "max-w-[1024px]" : "max-w-[736px]",
				)}
			>
				<Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
				<span>{t("visualize.generating")}</span>
			</div>
		);
	}

	const chromeButton =
		"flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-30)] transition-colors hover:text-[var(--text-60)]";

	return (
		<>
			<div
				className={clsx(
					"group/viz my-2 w-full",
					mode === "wide" ? "max-w-[1024px]" : "max-w-[736px]",
				)}
			>
				<div className="mb-1 flex h-5 items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/viz:opacity-100">
					<button
						type="button"
						onClick={() => setShowSource((v) => !v)}
						className={chromeButton}
						title={showSource ? t("visualize.hideSource") : t("visualize.viewSource")}
					>
						<Code2 size={12} />
						<span>{showSource ? t("visualize.hideSource") : t("visualize.viewSource")}</span>
					</button>
					<CopyButton
						text={html}
						label={t("visualize.copySource")}
						copiedLabel={t("visualize.copied")}
						title={t("visualize.copySource")}
						resetMs={2000}
						className={chromeButton}
					/>
					<button
						type="button"
						onClick={() => {
							const doc = buildSrcDoc({
								html,
								theme: darkTheme ? "dark" : "light",
								themeVars: collectVizThemeVars(),
								bridgeSource: vizBridgeSource(MAX_WIDGET_STATE_BYTES),
							});
							void openHtmlInBrowser(doc).catch((e: unknown) =>
								toast.error(t("visualize.openInBrowserFailed", { error: errMsg(e) })),
							);
						}}
						className={chromeButton}
						title={t("visualize.openInBrowser")}
					>
						<ExternalLink size={12} />
						<span>{t("visualize.openInBrowser")}</span>
					</button>
					<button
						type="button"
						onClick={() => setFullscreen(true)}
						className={chromeButton}
						title={t("visualize.fullscreen")}
					>
						<Maximize2 size={12} />
						<span>{t("visualize.fullscreen")}</span>
					</button>
				</div>
				<VisualizeFrame html={html} mode={mode} sessionId={sessionId} />
				{showSource && <SourceView source={html} />}
			</div>
			{fullscreen && (
				<FloatingLayer
					anchor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
					placement="center"
					layer="modal"
					onDismiss={() => setFullscreen(false)}
					aria-label={t("visualize.fullscreenTitle")}
					className="flex h-[calc(100vh-4rem)] w-[min(1100px,calc(100vw-3rem))] flex-col p-4 shadow-apple-modal"
				>
					<div className="mb-2 flex items-center justify-end">
						<button
							type="button"
							onClick={() => setFullscreen(false)}
							className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-40)] transition-colors hover:text-[var(--text)]"
							title={t("visualize.exitFullscreen")}
						>
							<X size={13} />
							<span>{t("visualize.exitFullscreen")}</span>
						</button>
					</div>
					<VisualizeFrame html={html} mode={mode} sessionId={sessionId} fill />
				</FloatingLayer>
			)}
		</>
	);
});
