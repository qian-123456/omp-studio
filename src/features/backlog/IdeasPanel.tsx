import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MODAL_SELECTOR } from "../../components/FloatingLayer";
import type { BacklogItem, BacklogKind } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { backlogUpdate } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";
import { useBacklog } from "./backlogStore";
import { bufferDoc } from "./IdeaEditBox";
import { fillIdeasIntoComposer } from "./fillComposer";
import { IdeaCaptureBox } from "./IdeaCaptureBox";
import { IdeaRow } from "./IdeaRow";
import { IdeaSearchBar } from "./IdeaSearchBar";
import { docToStored, refImagePaths, storedToDoc } from "./ideaTokens";
import { deleteIdeas, purgeIdeas, restoreIdeas, setIdeasStatus } from "./ideasActions";
import {
	EMPTY_SEARCH,
	effectiveScope,
	filterIdeas,
	groupIdeasByProject,
	type IdeaGroup,
	type IdeaPhase,
	type IdeaSearch,
	type IdeasScope,
	partitionByPhase,
	rangeSelection,
	scopeOptions,
	searchIdeas,
	tabCounts,
} from "./ideasLogic";
import { PILL_DANGER } from "./ideaStyles";
import { SelectionDock } from "./SelectionDock";
import { StatusTabs } from "./StatusTabs";

const EMPTY_TEXT_KEYS: Record<IdeaPhase, string> = {
	pending: "backlog.emptyPending",
	running: "backlog.emptyRunning",
	review: "backlog.emptyReview",
	finished: "backlog.emptyFinished",
	trash: "backlog.emptyTrash",
};

export function IdeasPanel({
	items,
	currentProject,
	onDispatch,
}: {
	items: BacklogItem[];
	currentProject: string | null;
	onDispatch: (items: BacklogItem[]) => void;
}) {
	const { t } = useT();
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);
	const editBuffer = useBacklog((s) => s.editBuffer);
	const setEditBuffer = useBacklog((s) => s.setEditBuffer);
	const cancelEdit = useBacklog((s) => s.clearEditBuffer);

	const [selectedScope, setScope] = useState<IdeasScope>(null);
	const [activePhase, setActivePhase] = useState<IdeaPhase>("pending");
	const [selected, setSelected] = useState<string[]>([]);
	const [anchor, setAnchor] = useState<string | null>(null);
	const [search, setSearch] = useState<IdeaSearch>(EMPTY_SEARCH);
	const [searchOpen, setSearchOpen] = useState(false);
	const [editingKind, setEditingKind] = useState<BacklogKind>("idea");

	const options = useMemo(() => scopeOptions(items, currentProject), [items, currentProject]);
	const scope = effectiveScope(selectedScope, options);
	const searchActive = search.query.trim() !== "" || search.kinds.length > 0;

	const counts = useMemo(() => tabCounts(items, sessions, scope, search), [items, sessions, scope, search]);
	const phaseItems = useMemo(
		() => partitionByPhase(searchIdeas(filterIdeas(items, scope), search), sessions)[activePhase],
		[items, sessions, scope, search, activePhase],
	);
	const groups = useMemo<IdeaGroup[] | null>(
		() => (scope === null ? groupIdeasByProject(phaseItems, currentProject) : null),
		[scope, phaseItems, currentProject],
	);
	const orderedItems = useMemo(() => (groups ? groups.flatMap((g) => g.items) : phaseItems), [groups, phaseItems]);
	const orderedIds = useMemo(() => orderedItems.map((i) => i.id), [orderedItems]);

	// Drop selected ids that are no longer visible.
	useEffect(() => {
		const visible = new Set(orderedIds);
		setSelected((prev) => {
			const next = prev.filter((id) => visible.has(id));
			return next.length === prev.length ? prev : next;
		});
	}, [orderedIds]);

	const clearSelection = () => {
		setSelected([]);
		setAnchor(null);
	};
	const closeSearch = () => {
		setSearchOpen(false);
		setSearch(EMPTY_SEARCH);
	};

	// Escape: first closes search, then clears the selection, before the popover's own dismiss. Runs on
	// window capture; leaves Esc to open modals, text editors (cancel edit) and IME composition.
	const escapeArmed = searchOpen || selected.length > 0;
	useEffect(() => {
		if (!escapeArmed) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || isComposing(e)) return;
			if (document.querySelector(MODAL_SELECTOR)) return;
			const t = e.target as HTMLElement | null;
			const inSearch = !!t?.hasAttribute?.("data-idea-search");
			const editing =
				!!t &&
				(t.isContentEditable ||
					t.tagName === "TEXTAREA" ||
					(t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox"));
			if (editing && !inSearch) return;
			e.stopImmediatePropagation();
			if (searchOpen) closeSearch();
			else clearSelection();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [escapeArmed, searchOpen]);

	const changePhase = (phase: IdeaPhase) => {
		setActivePhase(phase);
		clearSelection();
	};
	const changeScope = (next: IdeasScope) => {
		setScope(next);
		clearSelection();
	};

	const startEdit = (item: BacklogItem) => {
		const d = storedToDoc(item.text, refImagePaths(item.refs));
		setEditingKind(item.kind);
		setEditBuffer({ id: item.id, text: d.text, images: d.images });
	};
	const saveEdit = async (id: string) => {
		const buf = useBacklog.getState().editBuffer;
		const stored = buf ? docToStored(bufferDoc(buf)) : "";
		if (!stored) {
			toast.error(t("backlog.contentRequired"));
			return;
		}
		try {
			const refs = (useBacklog.getState().items.find((i) => i.id === id)?.refs ?? []).filter((r) => r.kind !== "image");
			await backlogUpdate(id, { text: stored, kind: editingKind, refs });
			if (useBacklog.getState().editBuffer?.id === id) cancelEdit();
			await useBacklog.getState().load();
		} catch (err) {
			toast.error(t("backlog.updateFailed", { error: errMsg(err) }));
		}
	};

	// Put items into the current session's composer; they turn dispatched only once that text is sent.
	const fill = (targets: BacklogItem[]) => {
		if (!selectedSessionId || targets.length === 0) return;
		fillIdeasIntoComposer(selectedSessionId, targets);
		setSelected((prev) => prev.filter((id) => !targets.some((t) => t.id === id)));
		toast.success(targets.length === 1 ? t("backlog.filledSingle") : t("backlog.filledMultiple", { count: targets.length }));
	};

	const toggleChecked = (id: string, shiftKey: boolean) => {
		if (shiftKey && anchor) {
			const range = rangeSelection(orderedIds, anchor, id);
			setSelected((prev) => [...new Set([...prev, ...range])]);
		} else {
			setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
			setAnchor(id);
		}
	};
	const toggleGroup = (ids: string[]) => {
		const all = ids.length > 0 && ids.every((id) => selected.includes(id));
		setSelected((prev) => (all ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]));
	};
	const allSelected = orderedIds.length > 0 && selected.length === orderedIds.length;
	const toggleAll = () => {
		if (allSelected) clearSelection();
		else {
			setSelected([...orderedIds]);
			setAnchor(orderedIds[0] ?? null);
		}
	};

	const selectedItems = orderedItems.filter((i) => selected.includes(i.id));
	const selectedIds = selectedItems.map((i) => i.id);
	const afterBatch = async (run: () => Promise<unknown>) => {
		await run();
		clearSelection();
	};

	const renderRow = (item: BacklogItem) => (
		<IdeaRow
			key={item.id}
			item={item}
			phase={activePhase}
			linked={item.targetSessionId ? sessions[item.targetSessionId] : undefined}
			checked={selected.includes(item.id)}
			selecting={selected.length > 0}
			editing={editBuffer?.id === item.id}
			editingKind={editingKind}
			canFill={!!selectedSessionId}
			onToggle={(shift) => toggleChecked(item.id, shift)}
			onEditKindChange={setEditingKind}
			onStartEdit={() => startEdit(item)}
			onSaveEdit={() => void saveEdit(item.id)}
			onCancelEdit={cancelEdit}
			onFill={() => fill([item])}
			onDispatch={() => onDispatch([item])}
			onOpenSession={selectSession}
		/>
	);

	const trashed = items.filter((i) => i.deletedAt);

	return (
		<div className="flex max-h-[min(640px,calc(100vh-8rem))] flex-col text-xs">
			<div className="flex shrink-0 flex-col gap-2 pb-2">
				<IdeaCaptureBox variant="panel" />
				<StatusTabs
					active={activePhase}
					counts={counts}
					scope={scope}
					scopeOptions={options}
					searchOpen={searchOpen}
					searchActive={searchActive}
					onChange={changePhase}
					onScopeChange={changeScope}
					onToggleSearch={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
				/>
				{searchOpen && <IdeaSearchBar search={search} onChange={setSearch} onClose={closeSearch} />}
			</div>

			<div className="min-h-24 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
				{activePhase === "trash" && trashed.length > 0 && (
					<div className="flex justify-end pb-1">
						<button
							type="button"
							onClick={() =>
								void purgeIdeas(
									trashed.map((i) => i.id),
									t("backlog.emptyTrashBtn"),
									t("backlog.emptyTrashConfirm", { count: trashed.length }),
								)
							}
							className={PILL_DANGER}
						>
							<Trash2 className="h-3 w-3" />
							{t("backlog.emptyTrashBtn")}
						</button>
					</div>
				)}
				{phaseItems.length === 0 ? (
					<div className="my-4 rounded-xl border border-dashed border-[var(--border-divider)] p-4 text-center text-[var(--text-dim)]">
						{searchActive
							? t("backlog.noSearchResults")
							: scope !== null && activePhase === "pending"
								? t("backlog.noProjectPending")
								: t(EMPTY_TEXT_KEYS[activePhase])}
					</div>
				) : groups ? (
					groups.map((g) => {
						const ids = g.items.map((i) => i.id);
						const n = ids.filter((id) => selected.includes(id)).length;
						return (
							<div key={g.project ?? "__global"} className="pt-1">
								<div className="sticky top-0 z-10 flex items-start gap-1.5 rounded-xl bg-[var(--bg-panel)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-dim)]">
									<input
										type="checkbox"
										checked={n === ids.length}
										ref={(el) => {
											if (el) el.indeterminate = n > 0 && n < ids.length;
										}}
										onChange={() => toggleGroup(ids)}
										className="mt-0.5 h-3 w-3 shrink-0 rounded accent-[var(--accent)]"
										title={t("backlog.selectAllInProject")}
									/>
									<span className="min-w-0 break-words" title={g.project ?? ""}>
										{g.label}
									</span>
									{g.isCurrent && (
										<span className="shrink-0 rounded-full bg-[var(--bg-hover)] px-1.5 text-[10px] font-normal text-[var(--accent)]">
											{t("backlog.currentTag")}
										</span>
									)}
									<span className="shrink-0 text-[10px] font-normal opacity-75">({g.items.length})</span>
								</div>
								<div className="space-y-0.5">{g.items.map(renderRow)}</div>
							</div>
						);
					})
				) : (
					<div className="space-y-0.5">{phaseItems.map(renderRow)}</div>
				)}
			</div>

			{selected.length > 0 && (
				<SelectionDock
					phase={activePhase}
					count={selected.length}
					allSelected={allSelected}
					canFill={!!selectedSessionId}
					onToggleAll={toggleAll}
					onClear={clearSelection}
					onDelete={() => void afterBatch(() => deleteIdeas(selectedIds))}
					onReopen={() => void afterBatch(() => setIdeasStatus(selectedIds, "inbox"))}
					onDone={() => void afterBatch(() => setIdeasStatus(selectedIds, "done"))}
					onFill={() => fill(selectedItems)}
					onDispatch={() => {
						onDispatch(selectedItems);
						clearSelection();
					}}
					onRestore={() => void afterBatch(() => restoreIdeas(selectedIds))}
					onPurge={() =>
						void purgeIdeas(selectedIds, t("backlog.purge"), t("backlog.purgeConfirmMultiple", { count: selectedIds.length })).then(
							(ok) => ok && clearSelection(),
						)
					}
				/>
			)}
		</div>
	);
}
