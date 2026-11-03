import { useEffect, useState } from "react";
import { events } from "../../../core/sse";
import { Spinner } from "../../../ui";
import { emptyTurnNotices, reduceTurnNotice, type TurnNoticeState } from "../lib/turnNotices";

type RowTone = "warn" | "ok" | "error" | "run" | "history";

/** Tinted chips, not bare text: every status keeps a visible shape (docs/MOBILE_DESIGN.md §5). */
const TONE: Record<RowTone, string> = {
	warn: "bg-m-warn-bg text-m-warn",
	ok: "bg-m-success-bg text-m-success",
	error: "bg-m-danger-bg text-m-danger",
	run: "bg-m-surface text-m-text-2",
	history: "bg-m-surface text-m-text-3",
};

/** One notice row: tinted pill whose text wraps in full (errors are never clipped). */
function NoticeRow({ tone, text }: { tone: RowTone; text: string }) {
	return (
		<div
			role="status"
			className={`inline-flex max-w-full items-start gap-2 rounded-m-lg px-3 py-1.5 text-m-xs ${TONE[tone]}`}
		>
			{tone === "run" && <Spinner size={14} className="mt-0.5 shrink-0" />}
			<span className="min-w-0 break-words [overflow-wrap:anywhere]">{text}</span>
		</div>
	);
}

/**
 * Turn-flow notices above the composer: model auto-retry / fallback lines and
 * auto-compaction progress, plus a one-line per-turn history once the turn ends.
 * Subscribes to the shared `rpc` bus directly (chatStore's streaming state is
 * deliberately untouched); hidden when nothing happened this turn.
 */
export function TurnNotices({ sessionId }: { sessionId: string }) {
	const [state, setState] = useState<TurnNoticeState>(emptyTurnNotices);
	useEffect(() => {
		setState(emptyTurnNotices);
		return events.on("rpc", (d) => {
			if (!d || d.sessionId !== sessionId) return;
			setState((prev) => reduceTurnNotice(prev, d.frame));
		});
	}, [sessionId]);

	if (!state.retries.length && !state.compaction && !state.summary) return null;
	return (
		<div className="flex w-full shrink-0 flex-col items-center gap-1.5 px-4 pb-1">
			{state.compaction && (
				<NoticeRow
					tone={state.compaction.status === "running" ? "run" : state.compaction.status === "done" ? "ok" : "error"}
					text={state.compaction.text}
				/>
			)}
			{state.retries.map((n) => (
				<NoticeRow key={n.id} tone={n.tone} text={n.text} />
			))}
			{state.summary && <NoticeRow tone="history" text={state.summary} />}
		</div>
	);
}
