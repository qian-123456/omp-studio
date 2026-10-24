import { Check, CornerDownLeft, RotateCcw, Send, Trash2, Undo2, X } from "lucide-react";
import type { IdeaPhase } from "./ideasLogic";
import { useT } from "../../stores/language";
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

/** Floating rounded dock shown at the panel bottom while ≥1 idea is checked. */
export function SelectionDock(p: SelectionDockProps) {
	const { t } = useT();
	return (
		<div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-1 gap-y-1.5 rounded-2xl border border-[var(--border-divider)] bg-[var(--bg-panel)] px-2.5 py-2 shadow-lg">
			<button
				type="button"
				onClick={p.onClear}
				className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
				title={t("backlog.exitSelectionTitle")}
				aria-label={t("backlog.exitSelectionAriaLabel")}
			>
				<X className="h-3.5 w-3.5" />
			</button>
			<span className="whitespace-nowrap text-[11px] font-medium text-[var(--text)]">{t("backlog.selectedCount", { count: p.count })}</span>
			<button type="button" onClick={p.onToggleAll} className={`${PILL_OUTLINE} whitespace-nowrap`}>
				{p.allSelected ? t("backlog.deselectAll") : t("backlog.selectAll")}
			</button>
			<span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
				{p.phase === "trash" ? (
					<>
						<button type="button" onClick={p.onRestore} className={PILL_OUTLINE}>
							<Undo2 className="h-3 w-3" />
							{t("backlog.restore")}
						</button>
						<button type="button" onClick={p.onPurge} className={PILL_DANGER}>
							<Trash2 className="h-3 w-3" />
							{t("backlog.purge")}
						</button>
					</>
				) : (
					<>
						<button type="button" onClick={p.onDelete} className={PILL_DANGER}>
							<Trash2 className="h-3 w-3" />
							{t("common.delete")}
						</button>
						{(p.phase === "review" || p.phase === "finished") && (
							<button type="button" onClick={p.onReopen} className={PILL_OUTLINE}>
								<RotateCcw className="h-3 w-3" />
								{t("backlog.putBack")}
							</button>
						)}
						{p.phase === "review" && (
							<button type="button" onClick={p.onDone} className={PILL_SUCCESS}>
								<Check className="h-3 w-3" />
								{t("common.finish")}
							</button>
						)}
						{p.phase === "pending" && (
							<>
								<button
									type="button"
									disabled={!p.canFill}
									onClick={p.onFill}
									className={PILL_OUTLINE}
									title={p.canFill ? t("backlog.fillComposerDockTooltip") : t("backlog.noSessionSelectedTooltip")}
								>
									<CornerDownLeft className="h-3 w-3" />
									{t("backlog.fillComposer")}
								</button>
								<button type="button" onClick={p.onDispatch} className={PILL_PRIMARY}>
									<Send className="h-3 w-3" />
									{t("backlog.dispatch")}
								</button>
							</>
						)}
					</>
				)}
			</span>
		</div>
	);
}
