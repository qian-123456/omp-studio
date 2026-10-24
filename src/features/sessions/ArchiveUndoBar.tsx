import { Undo2, X } from "lucide-react";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { undoArchive, useArchiveUndo } from "./archiveUndo";
import { useT } from "../../stores/language";

/**
 * Global archive undo bar displayed at the bottom of the session sidebar.
 * Displays "已归档「title」" for single session or "已归档 N 个会话" for multiple.
 * Safe with light/dark theme variables (R16).
 */
export function ArchiveUndoBar() {
	const { t } = useT();
	const item = useArchiveUndo((s) => s.item);
	const clear = useArchiveUndo((s) => s.clear);

	if (!item) return null;

	const restoreListFocus = () => {
		requestAnimationFrame(() => {
			if (!document.activeElement || document.activeElement === document.body) {
				document.querySelector<HTMLElement>("[data-sidebar-list]")?.focus();
			}
		});
	};

	const handleUndo = () => {
		undoArchive().catch((err) => {
			toast.error(t("sessions.undoArchiveFailed", { error: errMsg(err) }));
		});
		restoreListFocus();
	};

	return (
		<div className="flex items-center justify-between border-t border-[var(--border-divider)] bg-[var(--bg-panel)] px-3 py-2 text-xs text-[var(--text)] transition-colors">
			<div className="min-w-0 flex-1 truncate pr-2 font-normal text-[var(--text)]">
				{item.title}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				<button
					type="button"
					onClick={handleUndo}
					className="press-scale flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium text-[var(--primary)] hover:bg-[var(--bg-hover)] transition-colors"
				>
					<Undo2 size={12} />
					{t("sessions.undoArchive")}
				</button>
				<button
					type="button"
					onClick={() => {
						clear(item.id);
						restoreListFocus();
					}}
					className="press-scale flex h-5 w-5 items-center justify-center rounded text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
					title={t("common.close")}
				>
					<X size={12} />
				</button>
			</div>
		</div>
	);
}
