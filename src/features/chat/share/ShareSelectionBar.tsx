import { Share } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useLive } from "../../../stores/live";
import { useUi } from "../../../stores/ui";
import { listShareableIds } from "./shareEntries";
import { useShareSelection } from "./shareStore";

const EMPTY_ITEMS: never[] = [];

/**
 * Bottom bar shown instead of the Composer while the user ticks messages to
 * share as one image. Escape leaves the mode.
 */
export function ShareSelectionBar({ sessionId }: { sessionId: string }) {
	const selectedIds = useShareSelection((s) => s.selectedIds);
	const setSelected = useShareSelection((s) => s.setSelected);
	const cancel = useShareSelection((s) => s.cancel);
	const items = useLive((s) => s.sessions[sessionId]?.items ?? EMPTY_ITEMS);
	const shareable = useMemo(() => listShareableIds(items), [items]);
	const selectedCount = useMemo(() => {
		const all = new Set(shareable);
		return selectedIds.filter((id) => all.has(id)).length;
	}, [shareable, selectedIds]);
	const allSelected = shareable.length > 0 && selectedCount === shareable.length;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.isComposing) return;
			if (useUi.getState().modal) return;
			e.stopPropagation();
			cancel();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [cancel]);

	const generate = () => {
		const all = new Set(selectedIds);
		// Keep only ids that still exist, in transcript order.
		const ids = shareable.filter((id) => all.has(id));
		if (ids.length === 0) return;
		useUi.getState().openModal("share-image", { sessionId, itemIds: ids });
	};

	return (
		<div className="shrink-0 px-3 pb-3 pt-1">
			<div className="flex items-center justify-between gap-3 rounded-[22px] border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-2.5">
				<div className="text-[13px] text-[var(--text)]">
					已选 <span className="font-semibold tabular-nums">{selectedCount}</span> 条消息
				</div>
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => setSelected(allSelected ? [] : shareable)}
						disabled={shareable.length === 0}
						className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] disabled:opacity-40"
					>
						{allSelected ? "取消全选" : "全选"}
					</button>
					<button
						type="button"
						onClick={cancel}
						className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
					>
						取消
					</button>
					<button
						type="button"
						onClick={generate}
						disabled={selectedCount === 0}
						className="flex items-center gap-1.5 rounded-lg bg-[var(--text)] px-3 py-1.5 text-xs font-medium text-[var(--bg-panel)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Share size={13} />
						生成图片
					</button>
				</div>
			</div>
		</div>
	);
}
