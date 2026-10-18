/** [B] Interim assistant prose between tool calls, folded to a fixed height
 * when long (with a visible 「展开全文」 pill) so scrolling back through a turn
 * is not dominated by narration. The final answer is never clamped. */

import clsx from "clsx";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** About 14 lines of body text. */
const CLAMP_PX = 320;

export function ClampedProse({ children }: { children: ReactNode }) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const [overflows, setOverflows] = useState(false);
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		const el = bodyRef.current;
		if (!el) return;
		const measure = () => setOverflows(el.scrollHeight > CLAMP_PX + 24);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const clamped = overflows && !expanded;
	return (
		<div>
			<div
				ref={bodyRef}
				style={clamped ? { maxHeight: CLAMP_PX } : undefined}
				className={clsx(
					"relative",
					clamped &&
						"overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-56px),transparent)]",
				)}
			>
				{children}
			</div>
			{overflows && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-1 rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				>
					{expanded ? "收起" : "展开全文"}
				</button>
			)}
		</div>
	);
}
