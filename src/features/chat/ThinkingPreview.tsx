/** [B] Thinking-content body under the 「思考 · N秒」 header. Finished thinking
 * is just the one-line header; this component renders only while reasoning
 * streams (a rolling peek of the newest two lines, like subtitles) or when
 * the row is expanded (left-ruled, internally scrollable full text).
 * Collapsing never hides content irrecoverably — expanding always reaches the
 * whole thinking text. */

import { useEffect, useRef } from "react";
import { Markdown } from "../../components/Markdown";
import { useRevealText } from "./useRevealText";

/** Enough characters to fill two wrapped 12px lines of the peek box. */
const LIVE_TAIL_CHARS = 240;

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
	// Collapsed peek paces its characters like the body; the expanded box
	// paces inside <Markdown>.
	const revealedThinking = useRevealText(thinking, running === true && !open);

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
				className="mt-0.5 max-h-80 overflow-y-auto overscroll-contain border-s border-[var(--line)] ps-2.5 text-[13px] leading-5 text-[var(--text-40)]"
			>
				<Markdown text={thinking} streaming={running} />
			</div>
		);
	}
	if (!running) return null;

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={false}
			title="查看完整思考内容"
			className="mt-px flex h-10 w-full cursor-pointer flex-col justify-end overflow-hidden rounded text-left text-[12px] leading-5 text-[var(--text-40)] hover:text-[var(--text-60)]"
		>
			{/* Bottom-anchored fixed 2-line window: older lines scroll out the top. */}
			<span className="whitespace-pre-wrap break-words">
				{livePreviewText(revealedThinking)}
			</span>
		</button>
	);
}
