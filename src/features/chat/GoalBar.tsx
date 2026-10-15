/** [B] Slim goal-status bar pinned directly above the composer while omp
 * goal mode has an objective: shows the real goal text (from
 * get_state.goal / goal_updated), with pause/resume, edit (re-seeds a
 * /goal chip) and clear affordances wired to the `goal` RPC op. */

import clsx from "clsx";
import { Pause, PenLine, Play, Target, X } from "lucide-react";
import { useState } from "react";
import { errMsg } from "../../lib/dialogs";
import { rpcSend } from "../../lib/ipc";
import { ensureLive } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";

interface GoalLike {
	objective?: string;
	status?: string;
}
interface GoalModeLike {
	enabled?: boolean;
	mode?: string;
	goal?: GoalLike | null;
}

/** get_state.goal carries GoalModeState; tolerate the bare-Goal shape too. */
function goalModeOf(raw: unknown): GoalModeLike | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	if (typeof o.objective === "string") return { goal: o as GoalLike, mode: o.mode as string | undefined };
	return o as GoalModeLike;
}

export function GoalBar({
	sessionId,
	onEdit,
}: {
	sessionId: string;
	/** Seed the composer with `/goal <objective>` so the user can reword it. */
	onEdit(objective: string): void;
}) {
	const [busy, setBusy] = useState(false);
	const rawGoal = useLive((s) => s.sessions[sessionId]?.state?.goal);
	const mode = goalModeOf(rawGoal);
	const objective = mode?.goal?.objective?.trim() ?? "";
	const paused = mode?.mode === "paused";
	if (!objective) return null;

	const run = async (op: "pause" | "resume" | "drop") => {
		setBusy(true);
		try {
			if (!useLive.getState().sessions[sessionId]?.alive) await ensureLive(sessionId);
			await rpcSend(sessionId, { type: "goal", op });
			await rpcSend(sessionId, { type: "get_state" });
		} catch (err) {
			toast.error(`目标操作失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const btn =
		"flex h-5 w-5 items-center justify-center rounded text-[var(--text-40,var(--text-dim))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)] disabled:opacity-40";

	return (
		<div className="flex items-center gap-1.5 px-3 pb-1.5 text-[11.5px]">
			<Target size={12} className="shrink-0 text-emerald-500" />
			<span className="shrink-0 font-medium text-[var(--text-60,var(--text-muted))]">目标</span>
			{paused && (
				<span className="shrink-0 rounded-full border border-[var(--line,var(--border))] px-1.5 text-[10px] text-[var(--text-40,var(--text-dim))]">
					已暂停
				</span>
			)}
			<span
				title={objective}
				className={clsx(
					"min-w-0 flex-1 truncate",
					paused ? "text-[var(--text-40,var(--text-dim))]" : "text-[var(--text)]",
				)}
			>
				{objective}
			</span>
			<button
				type="button"
				disabled={busy}
				onClick={() => void run(paused ? "resume" : "pause")}
				title={paused ? "恢复目标" : "暂停目标"}
				aria-label={paused ? "恢复目标" : "暂停目标"}
				className={btn}
			>
				{paused ? <Play size={11} /> : <Pause size={11} />}
			</button>
			<button
				type="button"
				disabled={busy}
				onClick={() => onEdit(objective)}
				title="编辑目标"
				aria-label="编辑目标"
				className={btn}
			>
				<PenLine size={11} />
			</button>
			<button
				type="button"
				disabled={busy}
				onClick={() => void run("drop")}
				title="清除目标"
				aria-label="清除目标"
				className={btn}
			>
				<X size={12} />
			</button>
		</div>
	);
}
