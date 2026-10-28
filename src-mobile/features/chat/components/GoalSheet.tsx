import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, Button, confirm, inputCls, toast } from "../../../ui";

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

	return (
		<BottomSheet open={open} onClose={onClose} title="目标">
			<div className="flex flex-col gap-4 px-5 pt-2 pb-5">
				{g ? (
					<div className="rounded-m-lg bg-m-card p-5 shadow-m-card">
						<div className="text-m-xs whitespace-nowrap text-m-text-3">{goalLabel(g)}</div>
						<div className="m-selectable mt-1 text-m-md font-medium break-words whitespace-pre-wrap [overflow-wrap:anywhere]">{g.objective}</div>
					</div>
				) : (
					<p className="px-1 text-m-sm text-m-text-2">还没有目标。设定后代理会持续朝它推进，直到完成。</p>
				)}
				<textarea
					value={text}
					onChange={(e) => setText(e.target.value)}
					rows={3}
					aria-label="目标内容"
					placeholder={g ? "输入新目标（会替换当前目标）" : "想让它完成什么"}
					className={`${inputCls} resize-none`}
				/>
				<div className="flex flex-wrap justify-end gap-2">
					{g && (
						<>
							<Button variant="danger" disabled={busy} onClick={() => void run("drop")}>
								放弃
							</Button>
							<Button variant="tonal" disabled={busy} onClick={() => void run(g.status === "paused" ? "resume" : "pause")}>
								{g.status === "paused" ? "恢复" : "暂停"}
							</Button>
						</>
					)}
					<Button variant="primary" busy={busy} disabled={!text.trim()} onClick={() => void run("set")}>
						{g ? "替换目标" : "设定目标"}
					</Button>
				</div>
			</div>
		</BottomSheet>
	);
}
