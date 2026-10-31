/**
 * Mermaid diagram block for mobile web app.
 * Renders a closed ```mermaid fence as a sandboxed SVG.
 * Supports tap to fullscreen / pinch-to-zoom, source toggle, copy button,
 * and error fallback with retry button.
 */

import { Check, Copy, Maximize2, RefreshCw } from "lucide-react";
import React, { useEffect, useState } from "react";
import { copyText } from "../core/lib/format";
import { CodeBlock } from "./CodeBlock";
import { openImage } from "./ImageViewer";
import { currentMermaidMode, renderMermaidSvg, svgViewBoxSize } from "./mermaidRender";
import { toast } from "./Toast";

type RenderState =
	| { status: "loading" }
	| { status: "ready"; src: string; width: number | null }
	| { status: "error"; message: string };

function useColorMode(): "dark" | "light" {
	const [mode, setMode] = useState(currentMermaidMode);
	useEffect(() => {
		const update = () => setMode(currentMermaidMode());
		const obs = new MutationObserver(update);
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme", "data-mode"] });
		const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
		mq?.addEventListener("change", update);
		return () => {
			obs.disconnect();
			mq?.removeEventListener("change", update);
		};
	}, []);
	return mode;
}

export const MermaidBlock = React.memo(function MermaidBlock({
	source,
	className = "",
}: {
	source: string;
	className?: string;
}) {
	const mode = useColorMode();
	const [state, setState] = useState<RenderState>({ status: "loading" });
	const [showSource, setShowSource] = useState(false);
	const [copied, setCopied] = useState(false);
	const [retrySeq, setRetrySeq] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });
		renderMermaidSvg(source, mode).then(
			(svg) => {
				if (cancelled) return;
				setState({
					status: "ready",
					src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
					width: svgViewBoxSize(svg)?.width ?? null,
				});
			},
			(err: unknown) => {
				if (cancelled) return;
				setState({
					status: "error",
					message: err instanceof Error ? err.message : String(err),
				});
			},
		);
		return () => {
			cancelled = true;
		};
	}, [source, mode, retrySeq]);

	const onCopy = async () => {
		const ok = await copyText(source);
		if (ok) {
			setCopied(true);
			toast("源码已复制", { kind: "success" });
			setTimeout(() => setCopied(false), 1500);
		} else {
			toast("复制失败", { kind: "error" });
		}
	};

	const onFullscreen = () => {
		if (state.status === "ready") {
			openImage({ src: state.src, alt: "Mermaid diagram" });
		}
	};

	const tabBtn = "flex min-h-11 min-w-11 shrink-0 items-center px-0.5";
	const tabPill = (active: boolean) =>
		`flex h-8 items-center whitespace-nowrap rounded-m-pill px-3 text-m-xs transition-colors ${
			active ? "bg-m-surface text-m-text" : "text-m-text-3 active:bg-m-surface-hover"
		}`;
	const circle = "flex h-8 w-8 items-center justify-center rounded-m-pill bg-m-surface text-m-text-2 active:bg-m-surface-2";
	const tabs = (
		<div className="flex shrink-0 items-center">
			<button type="button" aria-pressed={!showSource} className={tabBtn} onClick={() => setShowSource(false)}>
				<span className={tabPill(!showSource)}>图表</span>
			</button>
			<button type="button" aria-pressed={showSource} className={tabBtn} onClick={() => setShowSource(true)}>
				<span className={tabPill(showSource)}>源码</span>
			</button>
		</div>
	);

	return (
		<div className={`my-4 min-w-0 overflow-hidden rounded-m-md bg-m-code-bg ${className}`}>
			{state.status !== "error" && !showSource && (
			<div className="flex flex-wrap items-center justify-between gap-x-2 pr-1 pl-4">
				<div className="flex flex-wrap items-center gap-x-2">
					<span className="whitespace-nowrap font-m-mono text-m-xs text-m-text-3">mermaid</span>
					{tabs}
				</div>
				<div className="flex items-center">
					{state.status === "ready" && !showSource && (
						<button
							type="button"
							onClick={onFullscreen}
							aria-label="全屏缩放"
							title="全屏缩放"
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
						title="复制源码"
						className="flex min-h-11 min-w-11 items-center justify-center"
					>
						<span className={circle}>{copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.75} />}</span>
					</button>
				</div>
			</div>
			)}

			{state.status === "error" && (
				<div>
					<div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-m-sm bg-m-danger-bg py-1 pr-1 pl-3 text-m-xs text-m-danger">
						<span className="flex-1 break-words">图表渲染失败：{state.message}</span>
						<button
							type="button"
							onClick={() => setRetrySeq((s) => s + 1)}
							className="flex min-h-11 min-w-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-m-pill px-3 text-m-xs font-medium active:opacity-70"
						>
							<RefreshCw size={13} />
							重试
						</button>
					</div>
					<CodeBlock code={source} lang="mermaid" className="rounded-none bg-transparent" />
				</div>
			)}

			{state.status !== "error" && showSource && (
				<CodeBlock code={source} lang="mermaid" className="rounded-none bg-transparent" headerActions={tabs} />
			)}

			{state.status === "ready" && !showSource && (
				<div className="overflow-x-auto px-4 pt-1 pb-4">
					<button
						type="button"
						onClick={onFullscreen}
						aria-label="全屏查看图表"
						className="mx-auto block min-h-11 min-w-11 cursor-zoom-in"
						style={{ width: state.width ?? "max-content" }}
					>
						<img
							src={state.src}
							alt="Mermaid diagram"
							draggable={false}
							style={{ width: state.width ?? undefined, maxWidth: "none" }}
							className="block h-auto select-none"
						/>
					</button>
				</div>
			)}

			{state.status === "loading" && !showSource && (
				<div className="px-4 pt-2 pb-6 text-center font-m-sans text-m-xs text-m-text-3">
					<span className="m-shimmer">正在渲染图表</span>
				</div>
			)}
		</div>
	);
});
