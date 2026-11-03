/**
 * [B] Restored half-answer of an interrupted run ("未完成回答（上次中断）").
 * Rendered only while the session is idle — during streaming the frames own
 * the thread, and the live→committed handoff (holding) must never duplicate
 * this row. One click removes it; a transcript that later carries the same
 * content dedupes it away (see streamSnapshot / live store subscription).
 */

import { useMemo } from "react";
import { CircleAlert, X } from "lucide-react";
import { Markdown } from "../../components/Markdown";
import { useT } from "../../stores/language";
import { useLive } from "../../stores/live";
import { unfinishedDisplay } from "./streamSnapshot";

export function UnfinishedAnswerRow({ sessionId }: { sessionId: string }) {
	const { t } = useT();
	const snapshot = useLive((s) => s.sessions[sessionId]?.restoredUnfinished ?? null);
	const remove = useLive((s) => s.removeUnfinishedAnswer);
	const display = useMemo(
		() => (snapshot ? unfinishedDisplay(snapshot) : null),
		[snapshot],
	);
	if (!snapshot || !display) return null;
	return (
		<div
			data-unfinished-answer=""
			className="mx-3 my-1.5 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg-panel)]/60 px-3.5 py-2.5 text-xs"
		>
			<div className="flex items-center gap-2">
				<CircleAlert size={14} className="shrink-0 text-[var(--text-40)]" />
				<span className="rounded-full border border-[var(--line)] bg-[var(--ghost-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-60)]">
					{t("chatView.streamRestore.unfinishedBadge")}
				</span>
				<button
					type="button"
					onClick={() => remove(sessionId)}
					className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-2.5 py-1 text-[11px] text-[var(--text-60)] transition-colors hover:border-[var(--text-30)] hover:text-[var(--text)]"
				>
					<X size={12} />
					<span>{t("chatView.streamRestore.unfinishedRemove")}</span>
				</button>
			</div>
			{display.thinking.length > 0 && (
				<details className="mt-2 min-w-0">
					<summary className="cursor-pointer select-none text-[11px] text-[var(--text-40)] hover:text-[var(--text-60)]">
						{t("chatView.streamRestore.unfinishedThinking")}
					</summary>
					<div className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-normal text-[var(--text-60)]">
						{display.thinking.join("\n\n")}
					</div>
				</details>
			)}
			{display.text && (
				<div className={ANSWER_TEXT_WRAP_CLASS}>
					<Markdown text={display.text} sessionId={sessionId} />
				</div>
			)}
			{display.tools.length > 0 && (
				<p className="mt-1.5 text-[11px] text-[var(--text-40)]">
					{t("chatView.streamRestore.unfinishedTools", { count: display.tools.length })}
				</p>
			)}
		</div>
	);
}

const ANSWER_TEXT_WRAP_CLASS = "mt-2 min-w-0 text-[length:var(--chat-font-size)] text-[var(--text)]";
