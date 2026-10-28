import { ChevronRight } from "lucide-react";
import { memo, useState } from "react";
import { thinkingLabel } from "../lib/turns";

/** Open state survives remounts of the row (window paging, live → persisted). */
const openKeys = new Set<string>();

/**
 * One quiet line: 「已思考 12 秒 ›」, or a shimmering 「思考中」 while it streams. Tap expands the reasoning in a
 * left-ruled block (full text, selectable).
 */
export const Thinking = memo(function Thinking({
	id,
	text,
	live,
	ms = null,
}: {
	id: string;
	text: string;
	live: boolean;
	ms?: number | null;
}) {
	const [open, setOpen] = useState(openKeys.has(id));
	if (!text.trim()) return null;
	const toggle = () => {
		if (open) openKeys.delete(id);
		else openKeys.add(id);
		setOpen(!open);
	};
	return (
		<div>
			<button
				type="button"
				aria-expanded={open}
				onClick={toggle}
				className="-mx-2 inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-m-pill px-2 text-m-sm text-m-text-3 active:bg-m-surface-hover"
			>
				<span className={live ? "m-shimmer" : ""}>{live ? "思考中" : thinkingLabel(ms)}</span>
				<ChevronRight
					size={16}
					strokeWidth={1.75}
					aria-hidden
					className={`transition-transform duration-(--m-dur-fast) ${open ? "rotate-90" : ""}`}
				/>
			</button>
			{open && (
				<div className="m-selectable mt-1 mb-2 whitespace-pre-wrap break-words border-l-2 border-m-border pl-4 text-m-sm leading-6 text-m-text-2">
					{text}
				</div>
			)}
		</div>
	);
});
