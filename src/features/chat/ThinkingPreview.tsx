/** [B] Thinking-content preview under 「思考了 N 秒」: a dim 2-line peek when
 * collapsed (the newest words while reasoning still streams, like subtitles),
 * and a left-ruled, internally scrollable full-text box when expanded.
 * Collapsing never hides content irrecoverably — expanding always reaches the
 * whole thinking text. */

import { useEffect, useRef } from "react";
import { Markdown } from "./markdown";

/** Roughly two 12px lines of CJK/Latin reasoning text. */
const LIVE_TAIL_CHARS = 160;

/**
 * Collapsed preview text while reasoning is still streaming: the newest two
 * non-empty lines, or — when those run longer than a two-line peek — the
 * newest `maxChars` characters, prefixed with 「…」 because the skipped head
 * is one click away in the expanded box.
 */
export function livePreviewText(text: string, maxChars = LIVE_TAIL_CHARS) {
	const lines = text
		.replace(/\r\n?/g, "\n")
		.replace(/\s+$/, "")
		.split("\n")
		.filter((l) => l.trim() !== "");
	if (lines.length === 0) return "";
	const tail = lines.slice(-2).join("\n");
	if (tail.length <= maxChars) return tail;
	const last = lines[lines.length - 1];
	if (last.length <= maxChars) return last;
	return `…${last.slice(last.length - maxChars)}`;
}

export function ThinkingPreview({
	thinking,
	running,
	open,
	onToggle,
}: {
	thinking: string;
	/** Reasoning is still streaming (live subtitle behaviour). */
	running?: boolean;
	open: boolean;
	onToggle: () => void;
}) {
	const boxRef = useRef<HTMLDivElement>(null);

	// Follow the end while streaming, like subtitles following a voice.
	useEffect(() => {
		const el = boxRef.current;
		if (!el || !open || !running) return;
		el.scrollTop = el.scrollHeight;
	}, [open, running, thinking]);

	if (open) {
		return (
			<div
				ref={boxRef}
				className="mt-0.5 max-h-30 overflow-y-auto overscroll-contain border-s border-[var(--line)] ps-2.5 text-[13px] leading-5 text-[var(--text-40)]"
			>
				<Markdown text={thinking} />
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={false}
			title="查看完整思考内容"
			className="mt-px block w-full cursor-pointer rounded text-left text-[12px] leading-5 text-[var(--text-40)] hover:text-[var(--text-60)]"
		>
			{/* WebKit ignores -webkit-line-clamp on <button> itself; clamp an inner box. */}
			<span className="line-clamp-2 whitespace-pre-wrap break-words">
				{running ? livePreviewText(thinking) : thinking}
			</span>
		</button>
	);
}
