/** [B] Quote presentation shared by the annotation popover/hover card and the
 * sent user bubble: a muted left-bordered blockquote that clamps long text
 * behind an explicit expand toggle, and numbered quote cards. */

import clsx from "clsx";
import { useRef, useState } from "react";
import { useLineClampOverflow } from "../../lib/useLineClamp";
import { useT } from "../../stores/language";
import type { QuoteCard } from "./annotationQuoteParse";

const QUOTE_LINES = 3;

/** Blockquote that line-clamps only when the text really overflows; never hides content without a toggle. */
export function QuoteBlock({
	text,
	scrollWhenExpanded = false,
	className,
}: {
	text: string;
	/** Cap the expanded height and scroll (floating cards); bubbles grow instead. */
	scrollWhenExpanded?: boolean;
	className?: string;
}) {
	const { t } = useT();
	const [expanded, setExpanded] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const overflowing = useLineClampOverflow(ref, "line-clamp-3", QUOTE_LINES, [text]);
	return (
		<blockquote className={clsx("border-l-2 border-[var(--text-30)] pl-2.5", className)}>
			<div
				ref={ref}
				className={clsx(
					"whitespace-pre-wrap break-words leading-relaxed text-[var(--text-60)]",
					overflowing && !expanded && "line-clamp-3",
					overflowing && expanded && scrollWhenExpanded && "max-h-48 overflow-y-auto",
				)}
			>
				{text}
			</div>
			{overflowing && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((v) => !v)}
					className="mt-0.5 whitespace-nowrap rounded px-1 text-[11px] text-[var(--text-40)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				>
					{expanded ? t("common.collapse") : t("common.expand")}
				</button>
			)}
		</blockquote>
	);
}

/** Quote strip: accent bar + muted text clamped to 2 lines, with a visible pill to read the rest. */
function QuoteStrip({ card }: { card: QuoteCard }) {
	const { t } = useT();
	const [expanded, setExpanded] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const overflowing = useLineClampOverflow(ref, "line-clamp-2", 2, [card.quote]);
	return (
		<div className="flex min-w-0 flex-col items-start gap-1">
			<div className="flex w-full min-w-0 gap-2 border-l-2 border-[var(--accent)] pl-2 text-[12px] leading-relaxed text-[var(--text-60)]">
				<div className="min-w-0 flex-1">
					{card.label && <div className="break-words text-[11px] text-[var(--text-40)]">{card.label}</div>}
					{card.quote && (
						<div
							ref={ref}
							className={clsx(
								"whitespace-pre-wrap break-words",
								overflowing && !expanded && "line-clamp-2",
							)}
						>
							{card.quote}
						</div>
					)}
				</div>
			</div>
			{overflowing && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded((v) => !v)}
					className="ml-2.5 whitespace-nowrap rounded-full border border-[var(--text-30)] px-2.5 py-0.5 text-[11px] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
				>
					{expanded
						? t("common.collapse")
						: t("chat.annotation.expandFull", { count: [...card.quote].length })}
				</button>
			)}
		</div>
	);
}

/** Quote/note pairs at the top of a sent user bubble; numbers only when there are several. */
export function QuoteCards({ cards }: { cards: readonly QuoteCard[] }) {
	const numbered = cards.length > 1;
	return (
		<div className="flex flex-col gap-3 text-[13px] leading-5">
			{cards.map((c, i) => (
				<div
					key={c.n}
					data-testid="user-quote-card"
					className={clsx(
						"flex gap-2",
						i > 0 && "border-t border-[var(--ghost-hover)] pt-3",
					)}
				>
					{/* Number sits in its own column so quote text and comment share one left edge. */}
					{numbered && (
						<span className="shrink-0 whitespace-nowrap pl-0.5 text-[12px] tabular-nums text-[var(--text-40)]">{c.n}</span>
					)}
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						{(c.quote || c.label) && <QuoteStrip card={c} />}
						{c.comment && (
							// border-l-2 + pl-2 mirrors the quote strip so the comment starts exactly under the quoted text.
							<div className="whitespace-pre-wrap break-words border-l-2 border-transparent pl-2 text-[var(--text)]">{c.comment}</div>
						)}
					</div>
				</div>
			))}
		</div>
	);
}
