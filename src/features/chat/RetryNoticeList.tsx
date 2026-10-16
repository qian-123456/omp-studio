/** Inline retry / model-fallback status rows at the end of the thread. */

import clsx from "clsx";
import type { JSX } from "react";
import { useLive } from "../../stores/live";
import type { RetryNotice } from "../../stores/retryNotice";

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

export function RetryNoticeList({
	sessionId,
}: {
	sessionId: string;
}): JSX.Element | null {
	const notices = useLive((s) => s.sessions[sessionId]?.retryNotices);
	if (!notices || notices.length === 0) return null;
	return (
		<div className="mt-1 flex flex-col gap-0.5" data-retry-notices>
			{notices.map((n) => (
				<div
					key={n.id}
					className={clsx("flex items-start gap-2 py-0.5 text-[12px]", TONE[n.tone])}
				>
					<span
						className={clsx("mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full", DOT[n.tone])}
					/>
					<span className="min-w-0 break-words">{n.text}</span>
				</div>
			))}
		</div>
	);
}
