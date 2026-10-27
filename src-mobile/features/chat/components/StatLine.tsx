import { memo, useRef } from "react";
import { BottomSheet } from "../../../ui";
import {
	FIELDS,
	FIELD_IDS,
	MISSING,
	fieldText,
	formatRequestStat,
	formatStatClock,
	formatStatDateTime,
	formatStatSeconds,
	isToday,
	ttftSplit,
} from "../lib/requestStats";
import type { RequestStat } from "../lib/requestStats";

/** Always-visible TUI-style stats line under an assistant reply; tap opens the detail card. */
export const StatLine = memo(function StatLine({
	stat,
	onOpen,
}: {
	stat: RequestStat;
	onOpen: (stat: RequestStat) => void;
}) {
	return (
		<button
			type="button"
			aria-label="请求详情"
			onClick={() => onOpen(stat)}
			className="-my-3 flex max-w-full flex-wrap items-center gap-x-3 gap-y-0.5 bg-transparent py-3 text-left font-m-mono text-m-xs text-m-text-3 active:text-m-text-2"
		>
			{formatRequestStat(stat).map((p) => (
				<span key={p.field} className="inline-flex items-center gap-1 whitespace-nowrap">
					{p.glyph !== "" && <span aria-hidden>{p.glyph}</span>}
					{p.text}
				</span>
			))}
		</button>
	);
});

function whenText(stat: RequestStat): string {
	// Same anchor as the desktop card: the request's start time.
	const at = stat.startedAt ?? stat.completedAt;
	if (at == null) return "时间未知";
	return isToday(at) ? `今天 ${formatStatClock(at)}` : formatStatDateTime(at);
}

function TtftBar({ stat }: { stat: RequestStat }) {
	const split = ttftSplit(stat);
	if (!split) return null;
	return (
		<div className="px-4 pb-3 pt-2">
			<div aria-hidden className="flex h-2 overflow-hidden rounded-m-pill bg-m-surface-2">
				<i className="block bg-m-warn" style={{ width: `${split.waitPercent.toFixed(1)}%` }} />
				<i className="block flex-1 bg-m-accent" />
			</div>
			<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-m-xs text-m-text-2">
				<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
					<i aria-hidden className="size-2 rounded-m-pill bg-m-warn" />
					等第一个字 {formatStatSeconds(split.ttftMs)}
				</span>
				<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
					<i aria-hidden className="size-2 rounded-m-pill bg-m-accent" />
					生成 {formatStatSeconds(split.generationMs)}
				</span>
			</div>
		</div>
	);
}

/** Detail sheet for one request; keeps the last stat while the sheet animates closed. */
export function StatCard({ stat, onClose }: { stat: RequestStat | null; onClose: () => void }) {
	const last = useRef<RequestStat | null>(null);
	if (stat) last.current = stat;
	const shown = stat ?? last.current;
	return (
		<BottomSheet open={stat !== null} onClose={onClose} title="这次请求">
			{shown && (
				<div className="pb-2">
					<div className="px-4 pb-2 text-center text-m-sm text-m-text-2">{whenText(shown)}</div>
					{FIELD_IDS.map((f) => {
						const meta = FIELDS[f];
						return (
							<div key={f} className="flex min-h-11 items-center gap-3 px-4 py-2">
								<span aria-hidden className="w-6 shrink-0 text-center text-m-md">
									{meta.glyph || "·"}
								</span>
								<div className="min-w-0 flex-1">
									<div className="text-m-sm font-medium">{meta.label}</div>
									<div className="text-m-xs text-m-text-3">{meta.description}</div>
								</div>
								<span className="shrink-0 whitespace-nowrap font-m-mono text-m-sm">
									{fieldText(shown, f) ?? MISSING}
								</span>
							</div>
						);
					})}
					<TtftBar stat={shown} />
				</div>
			)}
		</BottomSheet>
	);
}
