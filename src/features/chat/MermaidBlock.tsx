/** Renders a closed ```mermaid fence as a diagram in the same framed card as
 * code blocks, with a 图表/源码 switch and a copy button for the source. */

import clsx from "clsx";
import React, { useEffect, useState } from "react";
import { CopyButton } from "../../components/CopyButton";
import { currentMermaidMode, renderMermaidSvg, svgViewBoxSize } from "./mermaidRender";

type RenderState =
	| { status: "loading" }
	| { status: "ready"; src: string; width: number | null }
	| { status: "error"; message: string };

/** Re-renders when the app switches between light and dark. */
function useColorMode(): "dark" | "light" {
	const [mode, setMode] = useState(currentMermaidMode);
	useEffect(() => {
		const obs = new MutationObserver(() => setMode(currentMermaidMode()));
		obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
		return () => obs.disconnect();
	}, []);
	return mode;
}

export const MermaidBlock = React.memo(function MermaidBlock({ source }: { source: string }) {
	const mode = useColorMode();
	const [state, setState] = useState<RenderState>({ status: "loading" });
	const [showSource, setShowSource] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
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
				setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [source, mode]);

	const sourceVisible = showSource || state.status === "error";
	const tab = (active: boolean) =>
		clsx(
			"whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] transition-colors",
			active
				? "border-[var(--line)] bg-[var(--ghost-hover)] text-[var(--text)]"
				: "border-transparent text-[var(--text-40)] hover:text-[var(--text)]",
		);

	return (
		<div className="group/codeblock my-2 overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] text-[12px]">
			<div className="flex h-7 items-center justify-between border-b border-[var(--line)] px-3 font-mono text-[11px] text-[var(--text-40)]">
				<span className="truncate">mermaid</span>
				<div className="flex items-center gap-1">
					{state.status !== "error" && (
						<>
							<button type="button" className={tab(!showSource)} onClick={() => setShowSource(false)}>
								图表
							</button>
							<button type="button" className={tab(showSource)} onClick={() => setShowSource(true)}>
								源码
							</button>
						</>
					)}
					<CopyButton
						text={source}
						label="复制"
						copiedLabel="已复制"
						title="复制 Mermaid 源码"
						resetMs={2000}
						className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-[var(--text-40)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/codeblock:opacity-100"
					/>
				</div>
			</div>
			{state.status === "error" && (
				<div className="select-text whitespace-pre-wrap break-words border-b border-[var(--line)] px-3 py-2 text-[12px] text-[var(--status-error)]">
					图表渲染失败：{state.message}
				</div>
			)}
			{sourceVisible ? (
				<pre className="overflow-x-auto p-3 font-mono text-[12px] leading-5">
					<code>{source}</code>
				</pre>
			) : state.status === "ready" ? (
				<div className="overflow-x-auto p-3">
					<img
						src={state.src}
						alt="Mermaid 图表"
						draggable={false}
						style={{ width: state.width ?? undefined, maxWidth: "100%" }}
						className="mx-auto block h-auto"
					/>
				</div>
			) : (
				<div className="px-3 py-4 text-center text-[12px] text-[var(--text-40)]">正在渲染图表</div>
			)}
		</div>
	);
});
