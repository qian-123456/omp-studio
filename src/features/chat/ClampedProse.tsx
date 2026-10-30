/** [B] Brief interim assistant prose that only introduces tool work, folded to
 * a fixed height when it still overflows (with a visible 「展开全文」 pill) so
 * scrolling back through a turn is not dominated by it. Callers pass only
 * confirmed brief tool transitions; the final answer, narration, formal or
 * ambiguous prose are never clamped, and nothing clamps while a turn is active. */

import clsx from "clsx";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../../stores/language";

/** About 14 lines of body text. */
const CLAMP_PX = 320;

export function ClampedProse({
	children,
	streaming = false,
}: {
	children: ReactNode;
	/** While true the prose is never clamped, so its height cannot snap down mid-stream. */
	streaming?: boolean;
}) {
	const { t } = useT();
	const bodyRef = useRef<HTMLDivElement>(null);
	const [overflows, setOverflows] = useState(false);
	const [expanded, setExpanded] = useState(false);

	// Layout effect: measure before paint so long prose never shows unclamped
	// for a frame (and the virtualizer measures the clamped height once).
	useLayoutEffect(() => {
		const el = bodyRef.current;
		if (!el) return;
		const measure = () => setOverflows(el.scrollHeight > CLAMP_PX + 24);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const clamped = overflows && !expanded && !streaming;
	return (
		<div data-clamped-prose="">
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
			{overflows && !streaming && (
				<button
					type="button"
					onClick={() => setExpanded((v) => !v)}
					className="mt-1 rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				>
					{expanded ? t("common.collapse") : t("chat.expandFull")}
				</button>
			)}
		</div>
	);
}
