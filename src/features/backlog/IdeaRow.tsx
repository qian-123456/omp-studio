import { Check, CornerDownLeft, Pencil, RotateCcw, Send, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import type { BacklogItem, BacklogKind, SessionMeta } from "../../lib/contracts";
import { sessionDisplayName } from "../../lib/sessionName";
import { IdeaEditBox } from "./IdeaEditBox";
import { IdeaTextView } from "./IdeaEditor";
import { refImagePaths } from "./ideaTokens";
import { deleteIdeas, purgeIdeas, restoreIdeas, setIdeasStatus } from "./ideasActions";
import { formatAddedTime, type IdeaPhase, trashDaysLeft } from "./ideasLogic";
import {
	CHIP,
	KIND_META,
	PILL_DANGER,
	PILL_OUTLINE,
	PILL_PRIMARY,
	PILL_SUCCESS,
	TONE_SUCCESS,
} from "./ideaStyles";

/** Larger round icon button for edit/delete so the two are hard to mis-tap. */
const ICON_BTN =
	"inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]";

export interface IdeaRowProps {
	item: BacklogItem;
	phase: IdeaPhase;
	linked: SessionMeta | undefined;
	checked: boolean;
	/** Any row is checked: per-item fill/dispatch hide in favour of the dock. */
	selecting: boolean;
	editing: boolean;
	editingKind: BacklogKind;
	canFill: boolean;
	onToggle: (shiftKey: boolean) => void;
	onEditKindChange: (kind: BacklogKind) => void;
	onStartEdit: () => void;
	onSaveEdit: () => void;
	onCancelEdit: () => void;
	onFill: () => void;
	onDispatch: () => void;
	onOpenSession: (sessionId: string) => void;
}

/** One idea: text, then a single action row (kind chip, time, per-status controls). */
export function IdeaRow(p: IdeaRowProps) {
	const { item, phase, linked } = p;
	const meta = KIND_META[item.kind];
	const KindIcon = meta.icon;
	const [expanded, setExpanded] = useState(false);
	const at = item.createdAt || item.updatedAt;
	const id = [item.id];
	const sessionLink =
		item.targetSessionId && linked ? (
			<button
				type="button"
				onClick={() => p.onOpenSession(item.targetSessionId as string)}
				className="min-w-0 max-w-full whitespace-normal break-words text-left text-[11px] font-medium text-[var(--accent)] hover:underline"
				title="打开会话"
			>
				{sessionDisplayName(linked)}
			</button>
		) : (
			<span className="text-[11px] text-[var(--text-dim)]">会话已不存在</span>
		);

	return (
		<div
			onClick={(e) => {
				if (p.editing) return;
				if ((e.target as HTMLElement).closest("button,a,input,textarea,select,[contenteditable='true']")) return;
				if (window.getSelection()?.toString()) return;
				p.onToggle(e.shiftKey);
			}}
			className={`group flex cursor-pointer items-start gap-2 rounded-xl px-2 py-2 transition-colors ${
				p.checked ? "bg-[var(--bg-selected)]" : "hover:bg-[var(--bg-hover)]"
			}`}
		>
			<input
				type="checkbox"
				checked={p.checked}
				onChange={() => {}}
				onClick={(e) => p.onToggle(e.shiftKey)}
				className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-[var(--border-divider)] accent-[var(--accent)] focus:ring-0"
				title="选择"
			/>
			<div className="min-w-0 flex-1 space-y-1.5">
				{p.editing ? (
					<IdeaEditBox
						id={item.id}
						kind={p.editingKind}
						onKindChange={p.onEditKindChange}
						onSave={p.onSaveEdit}
						onCancel={p.onCancelEdit}
					/>
				) : (
					<>
						<div className="relative">
							<div
								className={`${phase === "finished" || phase === "trash" ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}
							>
								<IdeaTextView
									stored={item.text}
									refImages={refImagePaths(item.refs)}
									expanded={expanded}
									onToggle={() => setExpanded((v) => !v)}
								/>
							</div>
							{phase !== "trash" && !p.selecting && (
								<span className="pointer-events-none absolute -top-0.5 right-0 flex items-center gap-2 rounded-full border border-[var(--border-divider)] bg-[var(--bg-panel)]/80 px-1.5 opacity-0 shadow-sm backdrop-blur-md transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
									<button type="button" onClick={p.onStartEdit} className={ICON_BTN} title="编辑" aria-label="编辑">
										<Pencil className="h-3.5 w-3.5" />
									</button>
									<button
										type="button"
										onClick={() => void deleteIdeas(id)}
										className={`${ICON_BTN} hover:text-[var(--status-error)]`}
										title="删除"
										aria-label="删除"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</button>
								</span>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
							<span className={`${CHIP} ${meta.tone}`}>
								<KindIcon className="h-3 w-3" />
								{meta.label}
							</span>
							<span className="shrink-0 text-[10px] text-[var(--text-dim)]" title={new Date(at).toLocaleString()}>
								{formatAddedTime(at)}
							</span>
							{phase === "running" && (
								<span className="flex min-w-0 items-center gap-1.5">
									<span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--status-success)]" />
									{sessionLink}
								</span>
							)}
							{phase === "review" && <span className="flex min-w-0 flex-wrap items-center gap-1.5">{sessionLink}</span>}
							{phase === "finished" && <span className={`${CHIP} ${TONE_SUCCESS}`}>完成</span>}
							{phase === "trash" && (
								<span className="text-[10px] text-[var(--text-dim)]">{trashDaysLeft(item)} 天后彻底删除</span>
							)}
							<span className="ml-auto flex flex-wrap items-center justify-end gap-1">
								{!p.selecting && phase === "pending" && (
									<>
										<button
											type="button"
											disabled={!p.canFill}
											onClick={p.onFill}
											className={PILL_OUTLINE}
											title={p.canFill ? "填入输入框，追加到当前会话" : "当前未选择会话"}
											aria-label="填入输入框"
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
								{phase === "review" && (
									<>
										<button type="button" onClick={() => void setIdeasStatus(id, "inbox")} className={PILL_OUTLINE} title="放回待处理">
											<RotateCcw className="h-3 w-3" />
											放回
										</button>
										<button type="button" onClick={() => void setIdeasStatus(id, "done")} className={PILL_SUCCESS}>
											<Check className="h-3 w-3" />
											完成
										</button>
									</>
								)}
								{phase === "finished" && (
									<button type="button" onClick={() => void setIdeasStatus(id, "inbox")} className={PILL_OUTLINE} title="放回待处理">
										<RotateCcw className="h-3 w-3" />
										放回
									</button>
								)}
								{phase === "trash" && (
									<>
										<button type="button" onClick={() => void restoreIdeas(id)} className={PILL_OUTLINE}>
											<Undo2 className="h-3 w-3" />
											恢复
										</button>
										<button
											type="button"
											onClick={() => void purgeIdeas(id, "彻底删除", "彻底删除这条想法？此操作不可恢复。")}
											className={PILL_DANGER}
										>
											<Trash2 className="h-3 w-3" />
											彻底删除
										</button>
									</>
								)}
							</span>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
