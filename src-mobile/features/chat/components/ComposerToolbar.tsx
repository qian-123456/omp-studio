import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { shortModel, thinkLabel } from "../lib/models";
import { ContextIndicator } from "./ContextIndicator";

/**
 * Tracks keyboard state via Visual Viewport or active input focus.
 */
export function useKeyboardOpen(inputFocused = false): boolean {
	const [kbOpen, setKbOpen] = useState(false);
	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const handle = () => {
			const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
			setKbOpen(kb > 80);
		};
		vv.addEventListener("resize", handle);
		handle();
		return () => vv.removeEventListener("resize", handle);
	}, []);
	return inputFocused || kbOpen;
}

export function ComposerToolbar({
	model,
	thinking,
	onModel,
	onThinking,
	contextText = "0%",
	contextToneClass = "text-m-text-3",
	onContext,
	children,
	hidden = false,
}: {
	model?: string | null;
	thinking?: string | null;
	onModel?: () => void;
	onThinking?: () => void;
	contextText?: string | null;
	contextToneClass?: string;
	onContext?: () => void;
	children?: ReactNode;
	hidden?: boolean;
}) {
	if (hidden) return null;

	return (
		<div className="mt-2 flex min-w-0 items-center justify-between gap-1.5 text-m-xs">
			<div className="m-noscrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto whitespace-nowrap">
				<button
					type="button"
					aria-label={`当前模型：${shortModel(model ?? "") || "默认模型"}，点击切换`}
					onClick={onModel}
					className="flex min-h-11 shrink-0 items-center gap-1 px-2 text-m-xs font-medium whitespace-nowrap text-m-text"
				>
					<span className="max-w-[140px] truncate">{shortModel(model ?? "") || "默认模型"}</span>
					<ChevronDown size={13} className="shrink-0 text-m-text-3" aria-hidden />
				</button>
				<button
					type="button"
					aria-label={`当前思考强度：${thinkLabel(thinking)}，点击切换`}
					onClick={onThinking ?? onModel}
					className="flex min-h-11 shrink-0 items-center gap-1 px-2 text-m-xs whitespace-nowrap text-m-text-2"
				>
					<span>{thinkLabel(thinking)}</span>
					<ChevronDown size={13} className="shrink-0 text-m-text-3" aria-hidden />
				</button>
				{children}
			</div>
			<button
				type="button"
				aria-label={`上下文用量：${contextText ?? "0%"}`}
				onClick={onContext}
				disabled={!onContext}
				className={`flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-m-xs whitespace-nowrap disabled:opacity-60 ${contextToneClass}`}
			>
				<ContextIndicator text={contextText ?? "0%"} />
			</button>
		</div>
	);
}
