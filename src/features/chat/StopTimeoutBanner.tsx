/**
 * [B] Persistent banner shown when a stop request got no backend answer
 * (turn-level stop RPC timed out). Explains the situation and offers two
 * actions — retry the stop (the banner stays if the backend keeps ignoring
 * it), or restart the session via rpc_restart, which keeps the history.
 * The banner disappears by itself once the turn really ends (see stopHint).
 */

import { useState } from "react";
import clsx from "clsx";
import { OctagonX, RefreshCw, Loader2, TriangleAlert } from "lucide-react";
import { rpcRestart } from "../../lib/ipc";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";
import { useStopHint } from "./stopHint";
import { abortTurn } from "./send";

export function StopTimeoutBanner({ sessionId }: { sessionId: string }) {
	const { t } = useT();
	const shown = useStopHint((s) => s.timedOut[sessionId] === true);
	const [busy, setBusy] = useState<"stop" | "restart" | null>(null);
	if (!shown) return null;

	const retryStop = async () => {
		if (busy) return;
		setBusy("stop");
		try {
			// Same turn-level stop as the original request; on another timeout
			// the hint simply stays (no automatic process kill).
			await abortTurn(sessionId);
		} catch {
			// The stop failed again: keep the banner so the user can restart.
		} finally {
			setBusy(null);
		}
	};

	const restart = async () => {
		if (busy) return;
		setBusy("restart");
		try {
			await rpcRestart(sessionId);
			useStopHint.getState().clear(sessionId);
			toast.info(t("chatView.send.stopRestarted"));
		} catch (err) {
			toast.error(t("chatView.send.stopRestartFailed", { error: errMsg(err) }));
		} finally {
			setBusy(null);
		}
	};

	return (
		<div
			data-stop-timeout-banner=""
			className="mx-3 my-1.5 flex flex-col gap-2 rounded-xl border border-amber-500/45 bg-amber-500/10 px-3.5 py-2.5 text-xs"
		>
			<div className="flex items-start gap-2">
				<TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-500" />
				<div className="min-w-0 flex-1 leading-snug">
					<span className="font-medium text-amber-700 dark:text-amber-400">
						{t("chatView.send.stopTimeoutTitle")}
					</span>
					<p className="mt-0.5 text-[11px] text-[var(--text-60)]">
						{t("chatView.send.stopTimeoutDetail")}
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2 pt-0.5">
				<button
					type="button"
					disabled={busy !== null}
					onClick={() => void retryStop()}
					className="flex items-center gap-1.5 rounded-lg border border-amber-600/40 bg-amber-600 px-3 py-1 font-medium text-white shadow-xs transition-colors hover:bg-amber-700 disabled:opacity-50"
				>
					{busy === "stop" ? (
						<Loader2 size={12} className="animate-spin" />
					) : (
						<OctagonX size={12} />
					)}
					<span>{t("chatView.send.stopRetryAction")}</span>
				</button>
				<button
					type="button"
					disabled={busy !== null}
					onClick={() => void restart()}
					className={clsx(
						"flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg-panel)] px-2.5 py-1",
						"text-[11px] text-[var(--text-60)] transition-colors hover:border-[var(--text-30)] hover:text-[var(--text)] disabled:opacity-50",
					)}
				>
					{busy === "restart" ? (
						<Loader2 size={12} className="animate-spin" />
					) : (
						<RefreshCw size={12} />
					)}
					<span>{t("chatView.send.stopRestartAction")}</span>
				</button>
			</div>
		</div>
	);
}
