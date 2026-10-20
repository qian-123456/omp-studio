/**
 * Retry / model-fallback status: live rows while the turn is retrying, and a
 * collapsed, expandable entry in the thread once the turn has ended.
 */

import clsx from "clsx";
import { ChevronRight, Undo2 } from "lucide-react";
import { type JSX, useState } from "react";
import { useLive } from "../../stores/live";
import {
	type FallbackInfo,
	type RetryEpisode,
	type RetryNotice,
	retrySummary,
} from "../../stores/retryNotice";
import { canUndoFallback, undoFallback } from "./fallbackUndo";

const TONE: Record<RetryNotice["tone"], string> = {
	warn: "text-[var(--warn,#d97706)]",
	ok: "text-[var(--ok,#16a34a)]",
	error: "text-[var(--danger,#dc2626)]",
};

const DOT: Record<RetryNotice["tone"], string> = {
	warn: "bg-[var(--warn,#d97706)]",
	ok: "bg-[var(--ok,#16a34a)]",
	error: "bg-[var(--danger,#dc2626)]",
};

function RetryLines({ notices }: { notices: readonly RetryNotice[] }): JSX.Element {
	return (
		<div className="flex flex-col gap-0.5">
			{notices.map((n) => (
				<div
					key={n.id}
					className={clsx("flex items-start gap-2 py-0.5 text-[12px]", TONE[n.tone])}
				>
					<span
						className={clsx("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", DOT[n.tone])}
					/>
					<span className="min-w-0 select-text whitespace-pre-wrap break-words">
						{n.text}
					</span>
				</div>
			))}
		</div>
	);
}

/** Pill button that puts the session back on the pre-fallback model. */
function UndoFallbackButton({
	sessionId,
	fallback,
}: {
	sessionId: string;
	fallback: FallbackInfo | undefined;
}): JSX.Element | null {
	const stateModel = useLive((s) => s.sessions[sessionId]?.state?.model);
	const [busy, setBusy] = useState(false);
	if (!fallback || !canUndoFallback(fallback, stateModel)) return null;
	return (
		<button
			type="button"
			disabled={busy}
			title={`切回 ${fallback.from}`}
			onClick={() => {
				setBusy(true);
				void undoFallback(sessionId, fallback).finally(() => setBusy(false));
			}}
			className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-panel)] px-2.5 py-0.5 text-[11px] text-[var(--text)] transition-colors hover:bg-[var(--ghost-hover)] disabled:opacity-50"
		>
			<Undo2 size={11} />
			切回原模型
		</button>
	);
}

/** Live rows of the turn in progress. */
export function RetryNoticeList({
	sessionId,
}: {
	sessionId: string;
}): JSX.Element | null {
	const notices = useLive((s) => s.sessions[sessionId]?.retryNotices);
	const fallback = useLive((s) => s.sessions[sessionId]?.retryFallback);
	if (!notices || notices.length === 0) return null;
	return (
		<div className="mt-1 flex flex-col gap-0.5" data-retry-notices>
			<RetryLines notices={notices} />
			<div className="pl-3.5">
				<UndoFallbackButton sessionId={sessionId} fallback={fallback} />
			</div>
		</div>
	);
}

/** Collapsed chip for a finished turn; expands to every failure line. */
export function RetryEpisodeRow({
	sessionId,
	episode,
}: {
	sessionId: string;
	episode: RetryEpisode;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const failed = episode.notices.some((n) => n.tone === "error");
	return (
		<div className="my-1 flex flex-col gap-1" data-retry-episode>
			<div className="flex flex-wrap items-center gap-2">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
					className={clsx(
						"inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-0.5 text-[11px] transition-colors hover:bg-[var(--ghost-hover)]",
						failed ? TONE.error : TONE.warn,
					)}
				>
					<ChevronRight size={11} className={clsx("transition-transform", open && "rotate-90")} />
					{retrySummary(episode.notices, episode.fallback)}
				</button>
				<UndoFallbackButton sessionId={sessionId} fallback={episode.fallback} />
			</div>
			{open && (
				<div className="pl-1">
					<RetryLines notices={episode.notices} />
				</div>
			)}
		</div>
	);
}
