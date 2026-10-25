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

/** Numbered quote cards drawn at the top of a sent user bubble. */
export function QuoteCards({ cards }: { cards: readonly QuoteCard[] }) {
	const { t } = useT();
	return (
		<div className="flex flex-col gap-2 text-[13px] leading-5">
			{cards.map((c) => (
				<div
					key={c.n}
					data-testid="user-quote-card"
					className="rounded-xl bg-[var(--ghost-hover)] px-3 py-2"
				>
					<div className="mb-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-40)]">
						<span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] leading-none tabular-nums text-white">
							{c.n}
						</span>
						<span className="min-w-0 break-words">{c.label ?? t("chat.annotation.quoteLabel")}</span>
					</div>
					{c.quote && <QuoteBlock text={c.quote} />}
					{c.comment && (
						<div className={clsx("whitespace-pre-wrap break-words text-[var(--text)]", c.quote && "mt-1.5")}>
							<span className="mr-1.5 whitespace-nowrap text-[11px] text-[var(--text-40)]">
								{t("chat.annotation.noteLabel")}
							</span>
							{c.comment}
						</div>
					)}
				</div>
			))}
		</div>
	);
}
