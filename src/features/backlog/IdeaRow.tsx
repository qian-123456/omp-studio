import { Check, CornerDownLeft, MessageCircle, Pencil, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import type { BacklogItem, BacklogKind, SessionMeta } from "../../lib/contracts";
import { sessionDisplayName } from "../../lib/sessionName";
import { useT } from "../../stores/language";
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
	PILL_ACCENT,
	PILL_SUCCESS,
	TONE_SUCCESS,
} from "./ideaStyles";

/** Compact round controls; the content row reserves their width even when hidden. */
const ICON_BTN =
	"inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";

export interface IdeaRowProps {
	item: BacklogItem;
	phase: IdeaPhase;
	linked: SessionMeta | undefined;
	checked: boolean;
	/** Any row is checked: per-item draft actions hide in favour of the dock. */
	selecting: boolean;
	editing: boolean;
	editingKind: BacklogKind;
	/** Project dir while editing ("" = none). */
	editingProject: string;
	canFill: boolean;
	opening: boolean;
	onToggle: (shiftKey: boolean) => void;
	onEditKindChange: (kind: BacklogKind) => void;
	onEditProjectChange: (dir: string) => void;
	onStartEdit: () => void;
	onSaveEdit: () => void;
	onCancelEdit: () => void;
	onFill: () => void;
	onOpenInNewSession: () => void;
	onOpenSession: (sessionId: string) => void;
}

/** One idea: content with quiet edit controls, then metadata and per-status actions. */
export function IdeaRow(p: IdeaRowProps) {
	const { t } = useT();
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
				title={t("backlog.openSession")}
			>
				{sessionDisplayName(linked)}
			</button>
		) : (
			<span className="text-[11px] text-[var(--text-dim)]">{t("backlog.sessionNoLongerExists")}</span>
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
				title={t("backlog.select")}
			/>
			<div className="min-w-0 flex-1 space-y-1.5">
				{p.editing ? (
					<IdeaEditBox
						id={item.id}
						kind={p.editingKind}
						onKindChange={p.onEditKindChange}
						project={p.editingProject}
						onProjectChange={p.onEditProjectChange}
						onSave={p.onSaveEdit}
						onCancel={p.onCancelEdit}
					/>
				) : (
					<>
						<div className="flex items-start gap-2">
							<div
								className={`min-w-0 flex-1 ${phase === "finished" || phase === "trash" ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}
							>
								<IdeaTextView
									stored={item.text}
									refImages={refImagePaths(item.refs)}
									expanded={expanded}
									onToggle={() => setExpanded((v) => !v)}
								/>
							</div>
							{phase !== "trash" && (
								<span className="flex w-11 shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											p.onStartEdit();
										}}
										className={ICON_BTN}
										title={t("common.edit")}
										aria-label={t("common.edit")}
									>
										<Pencil className="h-3.5 w-3.5" />
									</button>
									{!p.selecting && (
										<button
											type="button"
											onClick={() => void deleteIdeas(id)}
											className={`${ICON_BTN} hover:text-[var(--status-error)]`}
											title={t("common.delete")}
											aria-label={t("common.delete")}
										>
											<Trash2 className="h-3.5 w-3.5" />
										</button>
									)}
								</span>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
								<span className={`${CHIP} ${meta.tone}`}>
									<KindIcon className="h-3 w-3" />
									{t(meta.labelKey)}
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
								{phase === "finished" && <span className={`${CHIP} ${TONE_SUCCESS}`}>{t("common.finish")}</span>}
								{phase === "trash" && (
									<span className="text-[10px] text-[var(--text-dim)]">{t("backlog.trashDaysLeft", { days: trashDaysLeft(item) })}</span>
								)}
							</span>
							<span className="ml-auto flex shrink-0 items-center justify-end gap-1">
								{!p.selecting && phase === "pending" && (
									<span className="flex shrink-0 items-center gap-1">
										<button
											type="button"
											disabled={!p.canFill}
											onClick={p.onFill}
											className={`${PILL_OUTLINE} whitespace-nowrap`}
											title={p.canFill ? t("backlog.fillCurrentTooltip") : t("backlog.noSessionSelectedTooltip")}
											aria-label={t("backlog.fillCurrent")}
										>
											<CornerDownLeft className="h-3 w-3" />
											{t("backlog.fillCurrent")}
										</button>
										<button type="button" disabled={p.opening} onClick={p.onOpenInNewSession} className={`${PILL_ACCENT} whitespace-nowrap`} title={t("backlog.openInNewSessionTooltip")}>
											<MessageCircle className="h-3 w-3" />
											{t("backlog.openInNewSession")}
										</button>
									</span>
								)}
								{phase === "review" && (
									<>
										<button type="button" onClick={() => void setIdeasStatus(id, "inbox")} className={PILL_OUTLINE} title={t("backlog.putBackToPending")}>
											<RotateCcw className="h-3 w-3" />
											{t("backlog.putBack")}
										</button>
										<button type="button" onClick={() => void setIdeasStatus(id, "done")} className={PILL_SUCCESS}>
											<Check className="h-3 w-3" />
											{t("common.finish")}
										</button>
									</>
								)}
								{phase === "finished" && (
									<button type="button" onClick={() => void setIdeasStatus(id, "inbox")} className={PILL_OUTLINE} title={t("backlog.putBackToPending")}>
										<RotateCcw className="h-3 w-3" />
										{t("backlog.putBack")}
									</button>
								)}
								{phase === "trash" && (
									<>
										<button type="button" onClick={() => void restoreIdeas(id)} className={PILL_OUTLINE}>
											<Undo2 className="h-3 w-3" />
											{t("backlog.restore")}
										</button>
										<button
											type="button"
											onClick={() => void purgeIdeas(id, t("backlog.purge"), t("backlog.purgeConfirmSingle"))}
											className={PILL_DANGER}
										>
											<Trash2 className="h-3 w-3" />
											{t("backlog.purge")}
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
