import { memo, useState } from "react";

const LIVE_TAIL_CHARS = 160;

/** Collapsed preview while thinking still streams: the newest two lines. */
export function liveTail(text: string): string {
	const lines = text
		.replace(/\r\n?/g, "\n")
		.replace(/\s+$/, "")
		.split("\n")
		.filter((l) => l.trim() !== "");
	if (!lines.length) return "";
	const tail = lines.slice(-2).join("\n");
	if (tail.length <= LIVE_TAIL_CHARS) return tail;
	const last = lines[lines.length - 1];
	if (last.length <= LIVE_TAIL_CHARS) return last;
	return `…${last.slice(last.length - LIVE_TAIL_CHARS)}`;
}

const openKeys = new Set<string>();

export const Thinking = memo(function Thinking({ id, text, live }: { id: string; text: string; live: boolean }) {
	const [open, setOpen] = useState(openKeys.has(id));
	if (!text.trim()) return null;
	const shown = open ? text : live ? liveTail(text) : text;
	return (
		<div className="my-1.5">
			<div className="text-m-xs font-medium text-m-text-3">{live ? "思考中" : "思考过程"}</div>
			<button
				type="button"
				aria-expanded={open}
				aria-label="查看完整思考内容"
				onClick={() => {
					if (open) openKeys.delete(id);
					else openKeys.add(id);
					setOpen(!open);
				}}
				className={`mt-0.5 block w-full whitespace-pre-wrap break-words rounded-m-sm border-l-2 border-m-border bg-m-surface px-3 py-1.5 text-left text-m-xs text-m-text-2 ${open ? "" : "line-clamp-3"}`}
			>
				{shown}
			</button>
		</div>
	);
});
