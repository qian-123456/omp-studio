import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, confirm, toast } from "../../../ui";

export interface Goal {
	objective: string;
	status?: string;
}

const STATUS_LABEL: Record<string, string> = {
	active: "进行中",
	paused: "已暂停",
	complete: "已完成",
	completed: "已完成",
};
const DONE: Record<string, string> = { set: "目标已设定", pause: "目标已暂停", resume: "目标已恢复", drop: "目标已放弃" };

export function goalLabel(g: Goal): string {
	return STATUS_LABEL[g.status ?? "active"] ?? g.status ?? "进行中";
}

export function GoalSheet({
	open,
	onClose,
	sessionId,
	goal,
	onGoal,
}: {
	open: boolean;
	onClose: () => void;
	sessionId: string;
	goal: Goal | null;
	onGoal: (g: Goal | null) => void;
}) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const g = goal && goal.objective ? goal : null;

	useEffect(() => {
		if (open) setText("");
	}, [open]);

	const run = async (op: "set" | "pause" | "resume" | "drop") => {
		const objective = text.trim();
		if (op === "set" && !objective) {
			toast("请先输入目标", { kind: "error" });
			return;
		}
		if (op === "drop" && !(await confirm({ message: "放弃当前目标？", confirmText: "放弃", danger: true }))) return;
		setBusy(true);
		try {
			const r = await api<{ goal: Goal | null }>(
				"POST",
				`/sessions/${sessionId}/goal`,
				op === "set" ? { objective } : { op },
			);
			onGoal(r.goal ?? null);
			setText("");
			toast(DONE[op], { kind: "success" });
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	const btn = "min-h-11 whitespace-nowrap rounded-m-md px-4 text-m-sm font-medium disabled:opacity-50";
	return (
		<BottomSheet open={open} onClose={onClose} title="目标">
			<div className="flex flex-col gap-3 p-4">
				{g ? (
					<div className="flex flex-col gap-1 rounded-m-md border border-m-border bg-m-surface p-3">
						<div className="whitespace-pre-wrap break-words text-m-md font-semibold [overflow-wrap:anywhere]">{g.objective}</div>
						<div className="whitespace-nowrap text-m-xs text-m-text-2">{goalLabel(g)}</div>
					</div>
				) : (
					<div className="text-m-sm text-m-text-2">还没有目标。设定后 agent 会持续朝它推进。</div>
				)}
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					rows={3}
					placeholder={g ? "输入新目标（会替换当前目标）" : "输入目标"}
					className="w-full resize-none rounded-m-md border border-m-border bg-m-surface p-3 text-m-md text-m-text outline-none placeholder:text-m-text-3 focus:border-m-accent"
				/>
				<div className="flex flex-wrap gap-2">
					<button type="button" disabled={busy} onClick={() => void run("set")} className={`${btn} bg-m-accent text-m-accent-text`}>
						{g ? "替换目标" : "设定目标"}
					</button>
					{g && (
						<>
							<button
								type="button"
								disabled={busy}
								onClick={() => void run(g.status === "paused" ? "resume" : "pause")}
								className={`${btn} border border-m-border bg-m-surface text-m-text`}
							>
								{g.status === "paused" ? "恢复" : "暂停"}
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => void run("drop")}
								className={`${btn} border border-m-danger text-m-danger`}
							>
								放弃
							</button>
						</>
					)}
				</div>
			</div>
		</BottomSheet>
	);
}
