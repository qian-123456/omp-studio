import { ChevronRight } from "lucide-react";
import { Chip } from "../../ui";
import type { ChipTone } from "../../ui";
import { elapsedMs, formatElapsed, rowLabel, statusText } from "./model";
import type { Bucket, FlatRow } from "./model";

export const BUCKET_TONE: Record<Bucket, ChipTone> = {
	running: "accent",
	queued: "neutral",
	done: "success",
	failed: "danger",
};

/** Status dot colour; the running dot also pulses. */
export const BUCKET_DOT: Record<Bucket, string> = {
	running: "bg-m-accent m-pulse",
	queued: "bg-m-text-3",
	done: "bg-m-success",
	failed: "bg-m-danger",
};

/** Width of one tree level. Equals the dot column so a child's connector sits under its parent's dot. */
const COL = 24;
/** Keep deeply nested dispatches readable on a phone; the full level remains in the row label. */
const MAX_VISIBLE_DEPTH = 3;
/** Vertical centre of the first text line (row padding 14px + half of the 22px line). */
const DOT_Y = 25;

const line = "absolute w-px bg-m-border-strong";

/** Guides and the elbow of one row, drawn in the indentation columns. */
function Connectors({ flat }: { flat: FlatRow }) {
	const { guides, isLast } = flat;
	const depth = Math.min(flat.depth, MAX_VISIBLE_DEPTH);
	const guideOffset = flat.depth - depth;
	if (depth === 0) return null;
	return (
		<span className="flex shrink-0 self-stretch" aria-hidden>
			{Array.from({ length: depth }, (_, i) => {
				const col = i + 1;
				const own = col === depth;
				return (
					<span key={col} className="relative shrink-0" style={{ width: COL }}>
						{own ? (
							<>
								<span className={`${line} left-1/2 top-0`} style={{ height: isLast ? DOT_Y : "100%" }} />
								<span className="absolute left-1/2 h-px bg-m-border-strong" style={{ top: DOT_Y, width: COL / 2 + 4 }} />
							</>
						) : (
							guides[guideOffset + col - 1] && <span className={`${line} bottom-0 left-1/2 top-0`} />
						)}
					</span>
				);
			})}
		</span>
	);
}

function TreeRow({ flat, hasChildren, now, onOpen }: { flat: FlatRow; hasChildren: boolean; now: number; onOpen: (id: string) => void }) {
	const { row, bucket } = flat.node;
	const label = rowLabel(row);
	const elapsed = formatElapsed(elapsedMs(row, now));
	const meta = [label.role, row.model].filter(Boolean).join(" · ");
	return (
		<li className={`m-list-row flex pl-4 ${flat.dim ? "opacity-55" : ""}`}>
			<Connectors flat={flat} />
			<button
				type="button"
				onClick={() => onOpen(row.id)}
				aria-label={`${label.primary}，${statusText(row.status)}${flat.depth > 0 ? `，第 ${flat.depth + 1} 层` : ""}`}
				className="flex min-w-0 flex-1 text-left active:bg-m-surface-hover"
			>
				<span className="relative flex shrink-0 justify-center self-stretch" style={{ width: COL }} aria-hidden>
					<span className={`absolute size-2 rounded-m-pill ${BUCKET_DOT[bucket]}`} style={{ top: DOT_Y - 4 }} />
					{hasChildren && <span className={`${line} bottom-0 left-1/2`} style={{ top: DOT_Y + 8 }} />}
				</span>
				<span className="m-list-sep ml-2 flex min-h-14 min-w-0 flex-1 items-start gap-2 py-3.5 pr-3">
					<span className="min-w-0 flex-1">
						<span className="block text-m-md font-medium [overflow-wrap:anywhere] text-m-text">{label.primary}</span>
						{label.description && (
							<span className="mt-0.5 line-clamp-2 text-m-sm break-words text-m-text-2">{label.description}</span>
						)}
						{meta && <span className="mt-1 block text-m-xs [overflow-wrap:anywhere] text-m-text-3">{meta}</span>}
						<span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
							<Chip tone={BUCKET_TONE[bucket]}>{statusText(row.status)}</Chip>
							{elapsed && <span className="text-m-xs whitespace-nowrap text-m-text-3 tabular-nums">{elapsed}</span>}
							{flat.depth >= MAX_VISIBLE_DEPTH && (
								<span className="text-m-xs whitespace-nowrap text-m-text-3">第 {flat.depth + 1} 层</span>
							)}
						</span>
					</span>
					<ChevronRight size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-m-text-3" aria-hidden />
				</span>
			</button>
		</li>
	);
}

/**
 * Nested dispatch tree in one grouped card: each level indents one dot column, thin connector
 * lines join a child to its parent's dot. Rows open the agent's detail page.
 */
export function SubagentTree({
	rows,
	now,
	onOpen,
	className = "bg-m-card",
}: {
	rows: readonly FlatRow[];
	now: number;
	onOpen: (id: string) => void;
	/** Card fill; `bg-m-card` on elevated canvases, `bg-m-surface` on the page canvas. */
	className?: string;
}) {
	return (
		<ul className={`m-list m-0 list-none overflow-hidden rounded-m-lg p-0 ${className}`}>
			{rows.map((f, i) => (
				<TreeRow key={f.node.id} flat={f} hasChildren={rows[i + 1]?.depth === f.depth + 1} now={now} onOpen={onOpen} />
			))}
		</ul>
	);
}
