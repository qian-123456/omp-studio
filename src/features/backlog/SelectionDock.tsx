import { Check, CornerDownLeft, RotateCcw, Send, Trash2, Undo2, X } from "lucide-react";
import type { IdeaPhase } from "./ideasLogic";
import { PILL_DANGER, PILL_OUTLINE, PILL_PRIMARY, PILL_SUCCESS } from "./ideaStyles";

export interface SelectionDockProps {
	phase: IdeaPhase;
	count: number;
	allSelected: boolean;
	canFill: boolean;
	onToggleAll: () => void;
	onClear: () => void;
	onDelete: () => void;
	onReopen: () => void;
	onDone: () => void;
	onFill: () => void;
	onDispatch: () => void;
	onRestore: () => void;
	onPurge: () => void;
}

const LINK = "rounded-full px-2 py-1 text-[11px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]";

/** Floating rounded dock shown at the panel bottom while ≥1 idea is checked. */
export function SelectionDock(p: SelectionDockProps) {
	return (
		<div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1.5 rounded-2xl border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2.5 py-2 shadow-lg">
			<button
				type="button"
				onClick={p.onClear}
				className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
				title="退出选择"
				aria-label="退出选择"
			>
				<X className="h-3.5 w-3.5" />
			</button>
			<span className="text-[11px] font-medium text-[var(--text)]">已选 {p.count}</span>
			<button type="button" onClick={p.onToggleAll} className={LINK}>
				{p.allSelected ? "取消全选" : "全选"}
			</button>
			<span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
				{p.phase === "trash" ? (
					<>
						<button type="button" onClick={p.onRestore} className={PILL_OUTLINE}>
							<Undo2 className="h-3 w-3" />
							恢复
						</button>
						<button type="button" onClick={p.onPurge} className={PILL_DANGER}>
							<Trash2 className="h-3 w-3" />
							彻底删除
						</button>
					</>
				) : (
					<>
						<button type="button" onClick={p.onDelete} className={PILL_DANGER}>
							<Trash2 className="h-3 w-3" />
							删除
						</button>
						{(p.phase === "review" || p.phase === "finished") && (
							<button type="button" onClick={p.onReopen} className={PILL_OUTLINE}>
								<RotateCcw className="h-3 w-3" />
								放回
							</button>
						)}
						{p.phase === "review" && (
							<button type="button" onClick={p.onDone} className={PILL_SUCCESS}>
								<Check className="h-3 w-3" />
								完成
							</button>
						)}
						{p.phase === "pending" && (
							<>
								<button
									type="button"
									disabled={!p.canFill}
									onClick={p.onFill}
									className={PILL_OUTLINE}
									title={p.canFill ? "追加到当前会话输入框" : "当前未选择会话"}
								>
									<CornerDownLeft className="h-3 w-3" />
									填入输入框
								</button>
								<button type="button" onClick={p.onDispatch} className={PILL_PRIMARY}>
									<Send className="h-3 w-3" />
									派发
								</button>
							</>
						)}
					</>
				)}
			</span>
		</div>
	);
}
