/**
 * Static stand-in for a `visualize` block inside the shared image. It loads the
 * fragment in the same sandboxed frame as the live block, asks the in-frame
 * bridge for a PNG snapshot once the content has settled, then swaps the frame
 * for that image. While waiting it carries `data-share-pending` so
 * `renderShareImage` holds off rasterising the card.
 */

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { themeById, useResolvedThemeId } from "../../../lib/theme";
import { useT } from "../../../stores/language";
import { vizBridgeSource } from "./bridge";
import {
	buildSrcDoc,
	clampVizHeight,
	MAX_WIDGET_STATE_BYTES,
	type VisualizeMode,
} from "./frame";
import { collectVizThemeVars } from "./themeVars";

/** Quiet period after the last height report before snapshotting (lets chart animations finish). */
const SETTLE_MS = 1500;
/** Give up on the snapshot after this long and show the placeholder notice. */
const SNAPSHOT_TIMEOUT_MS = 12_000;

type SnapshotState =
	| { status: "pending" }
	| { status: "done"; src: string }
	| { status: "failed" };

export function VisualizeSnapshot({ html, mode }: { html: string; mode: VisualizeMode }) {
	const { t } = useT();
	const themeId = useResolvedThemeId();
	const theme: "light" | "dark" = themeById(themeId)?.dark === false ? "light" : "dark";
	const themeRef = useRef(theme);
	themeRef.current = theme;
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const portRef = useRef<MessagePort | null>(null);
	const settleRef = useRef<number | null>(null);
	const [height, setHeight] = useState(240);
	const [state, setState] = useState<SnapshotState>({ status: "pending" });

	const srcDoc = useMemo(
		() =>
			buildSrcDoc({
				html,
				theme: themeRef.current,
				themeVars: collectVizThemeVars(),
				bridgeSource: vizBridgeSource(MAX_WIDGET_STATE_BYTES),
			}),
		[html],
	);

	useEffect(() => {
		if (state.status !== "pending") return;
		const timer = window.setTimeout(() => setState({ status: "failed" }), SNAPSHOT_TIMEOUT_MS);
		return () => window.clearTimeout(timer);
	}, [state.status]);

	useEffect(
		() => () => {
			if (settleRef.current !== null) window.clearTimeout(settleRef.current);
			portRef.current?.close();
			portRef.current = null;
		},
		[],
	);

	const handleLoad = () => {
		const contentWindow = iframeRef.current?.contentWindow;
		if (!contentWindow) {
			setState({ status: "failed" });
			return;
		}
		const channel = new MessageChannel();
		portRef.current = channel.port1;
		channel.port1.onmessage = (e: MessageEvent) => {
			const msg = e.data;
			if (!msg || typeof msg !== "object") return;
			if (msg.type === "height") {
				const next = clampVizHeight(msg.height);
				if (next <= 0) return;
				setHeight(next);
				if (settleRef.current !== null) window.clearTimeout(settleRef.current);
				settleRef.current = window.setTimeout(() => {
					portRef.current?.postMessage({ type: "snapshot", id: 1 });
				}, SETTLE_MS);
			} else if (msg.type === "snapshot-result") {
				if (typeof msg.dataUrl === "string" && msg.dataUrl.startsWith("data:image/png")) {
					setState({ status: "done", src: msg.dataUrl });
				} else {
					setState({ status: "failed" });
				}
			}
		};
		contentWindow.postMessage(
			{ type: "omp-visualize-init", theme, vars: collectVizThemeVars() },
			"*",
			[channel.port2],
		);
	};

	return (
		<div
			data-share-pending={state.status === "pending" ? "" : undefined}
			className={clsx(
				"my-2 w-full overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] p-3",
				mode === "wide" ? "max-w-[1024px]" : "max-w-[736px]",
			)}
		>
			{state.status === "done" ? (
				<img src={state.src} alt="" className="block w-full" draggable={false} />
			) : state.status === "failed" ? (
				<div className="py-1 text-center text-[12px] text-[var(--text-40)]">
					{t("components.interactiveVisualNotice")}
				</div>
			) : (
				<iframe
					ref={iframeRef}
					sandbox="allow-scripts"
					referrerPolicy="no-referrer"
					srcDoc={srcDoc}
					title={t("visualize.contentTitle")}
					onLoad={handleLoad}
					onError={() => setState({ status: "failed" })}
					className="block w-full border-0 bg-transparent"
					style={{ height }}
				/>
			)}
		</div>
	);
}
