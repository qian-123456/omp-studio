import {
	Bug,
	Check,
	CornerDownLeft,
	Edit3,
	ExternalLink,
	ImagePlus,
	Lightbulb,
	ListTodo,
	Loader2,
	Plus,
	RotateCcw,
	Send,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer, MODAL_SELECTOR } from "../../components/FloatingLayer";
import { NativeSelect } from "../../components/NativeSelect";
import type { BacklogItem, BacklogKind, BacklogStatus } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import {
	backlogAdd,
	backlogBuildPrompt,
	backlogDelete,
	backlogUpdate,
	dispatchPrompt,
	listWorkspaces,
	rpcStart,
} from "../../lib/ipc";
import { isComposing } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSidebarStore } from "../sessions/sidebarStore";
import { useBacklog } from "./backlogStore";
import { CaptureProjectSelect } from "./CaptureProjectSelect";
import { IdeaEditor, type IdeaEditorHandle, IdeaTextView } from "./IdeaEditor";
import { ImageThumbs, useImageAttach } from "./IdeaImages";
import {
	docToStored,
	ensureTokens,
	insertImages,
	reconcileDoc,
	removeImage,
	refImagePaths,
	storedToDoc,
	storedImagePaths,
	toComposerText,
	type TokenDoc,
} from "./ideaTokens";
import {
	appendToDraft,
	buildBatchFillText,
	filterIdeas,
	formatAddedTime,
	groupIdeasByProject,
	type IdeaGroup,
	type IdeaPhase,
	type IdeasScope,
	linkedSessionStatus,
	needsAttentionCount,
	partitionByPhase,
	projectRoot,
	rangeSelection,
	resolveCaptureProject,
	sessionOptionLabel,
	splitByProject,
} from "./ideasLogic";

/** Solid accent-filled primary action; sky-600 in this theme is a pale tint and read as disabled. */
const PRIMARY_BTN =
	"inline-flex items-center bg-[var(--accent)] font-medium text-[var(--bg)] shadow-sm transition-all hover:bg-[var(--accent-hover)] active:scale-95 disabled:cursor-not-allowed disabled:bg-[var(--bg-hover)] disabled:text-[var(--text-dim)] disabled:shadow-none disabled:active:scale-100";

const KIND_META: Record<BacklogKind, { label: string; icon: typeof Lightbulb; cls: string }> = {
	todo: { label: "待办", icon: ListTodo, cls: "bg-sky-500/15 text-sky-300 border border-sky-500/30" },
	bug: { label: "缺陷", icon: Bug, cls: "bg-rose-500/15 text-rose-300 border border-rose-500/30" },
	idea: { label: "想法", icon: Lightbulb, cls: "bg-amber-500/15 text-amber-300 border border-amber-500/30" },
};

const KINDS: BacklogKind[] = ["todo", "bug", "idea"];

async function setStatus(id: string, status: BacklogStatus) {
	try {
		await backlogUpdate(id, { status });
		await useBacklog.getState().load();
	} catch (err) {
		toast.error(`操作失败: ${errMsg(err)}`);
	}
}

async function deleteIdea(id: string) {
	const ok = await confirmDialog("确定要删除这条想法吗？", {
		danger: true,
		title: "删除想法",
		okLabel: "删除",
	});
	if (!ok) return;
	try {
		await backlogDelete(id);
		if (useBacklog.getState().editBuffer?.id === id) useBacklog.getState().clearEditBuffer();
		await useBacklog.getState().load();
	} catch (err) {
		toast.error(`删除失败: ${errMsg(err)}`);
	}
}

/** Top-bar 「想法」 capsule: count of pending + review items + backlog dropdown. */
export function IdeasCapsule() {
	const items = useBacklog((s) => s.items);
	const load = useBacklog((s) => s.load);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const sessions = useSessions((s) => s.sessions);
	const currentProject = selectedSessionId ? (sessions[selectedSessionId]?.cwd ?? null) : null;

	// Reopen the dropdown after a reload if an unsaved edit was in progress.
	const [open, setOpen] = useState(() => useBacklog.getState().editBuffer !== null);
	const [dispatching, setDispatching] = useState<BacklogItem[] | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		void load().catch(() => {});
	}, [load]);

	const badgeCount = useMemo(() => needsAttentionCount(items, sessions), [items, sessions]);

	return (
		<div className="relative flex items-center">
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(!open)}
				className={`flex items-center gap-1.5 rounded-full border border-neutral-700/80 px-2.5 py-1 text-xs font-medium shadow-sm transition-colors ${
					open
						? "bg-neutral-700 text-neutral-100"
						: "bg-neutral-800/80 text-neutral-300 hover:bg-neutral-700/60 hover:text-neutral-100"
				}`}
				title={`想法收集（待处理 + 待验收共 ${badgeCount} 项）：随手记、稍后派给 Agent`}
			>
				<Lightbulb className="h-3.5 w-3.5 text-amber-400" />
				<span>想法</span>
				{badgeCount > 0 && (
					<span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">{badgeCount}</span>
				)}
			</button>

			<FloatingLayer
				anchor={open ? triggerRef.current : null}
				placement="bottom-end"
				offset={6}
				layer="popover"
				onDismiss={() => setOpen(false)}
				ignoreRefs={[triggerRef]}
				className="w-[420px] p-3"
			>
				<IdeasPanel
					items={items}
					currentProject={currentProject}
					onClose={() => setOpen(false)}
					onDispatch={(batch) => {
						setOpen(false);
						setDispatching(batch);
					}}
				/>
			</FloatingLayer>

			{dispatching && (
				<DispatchDialog
					items={dispatching}
					currentProject={currentProject}
					onClose={() => setDispatching(null)}
				/>
			)}
		</div>
	);
}

function IdeasPanel({
	items,
	currentProject,
	onClose,
	onDispatch,
}: {
	items: BacklogItem[];
	currentProject: string | null;
	onClose: () => void;
	onDispatch: (items: BacklogItem[]) => void;
}) {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);
	const draft = useBacklog((s) => s.draft);
	const setDraft = useBacklog((s) => s.setDraft);
	const setLastKind = useBacklog((s) => s.setLastKind);
	const { text, kind, images } = draft;

	const [scope, setScope] = useState<IdeasScope>("all");
	const [activePhase, setActivePhase] = useState<IdeaPhase>("pending");
	const [selected, setSelected] = useState<string[]>([]);
	const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);

	// Effective scope falls back to "all" if "current" is selected but no current project.
	const effectiveScope: IdeasScope = scope === "current" && !currentProject ? "all" : scope;

	// Partition scoped items into phases
	const scopedItems = useMemo(
		() => filterIdeas(items, effectiveScope, currentProject),
		[items, effectiveScope, currentProject],
	);
	const phaseBuckets = useMemo(
		() => partitionByPhase(scopedItems, sessions),
		[scopedItems, sessions],
	);

	const currentPhaseItems = phaseBuckets[activePhase];

	// Grouped structure when in "all" scope
	const groups = useMemo<IdeaGroup[] | null>(
		() => (effectiveScope === "all" ? groupIdeasByProject(currentPhaseItems, currentProject) : null),
		[effectiveScope, currentPhaseItems, currentProject],
	);

	// Ordered visible item IDs in current list for range selection & select all
	const visibleOrderedItems = useMemo<BacklogItem[]>(() => {
		if (groups) {
			return groups.flatMap((g) => g.items);
		}
		return currentPhaseItems;
	}, [groups, currentPhaseItems]);

	const visibleOrderedIds = useMemo(
		() => visibleOrderedItems.map((i) => i.id),
		[visibleOrderedItems],
	);

	// Keep selection clean: drop IDs that are no longer in visible list
	useEffect(() => {
		const visibleSet = new Set(visibleOrderedIds);
		setSelected((prev) => {
			const next = prev.filter((id) => visibleSet.has(id));
			return next.length === prev.length ? prev : next;
		});
	}, [visibleOrderedIds]);

	// First Escape clears the selection instead of closing the popover. Runs on window capture so it
	// precedes FloatingLayer's document listener; leaves Esc alone for open modals (e.g. the batch
	// delete confirm), text editors (cancel edit) and IME composition.
	useEffect(() => {
		if (selected.length === 0) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || isComposing(e)) return;
			if (document.querySelector(MODAL_SELECTOR)) return;
			const t = e.target as HTMLElement | null;
			const editing =
				!!t &&
				(t.isContentEditable ||
					t.tagName === "TEXTAREA" ||
					(t.tagName === "INPUT" && (t as HTMLInputElement).type !== "checkbox"));
			if (editing) return;
			e.stopImmediatePropagation();
			setSelected([]);
			setSelectionAnchor(null);
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => window.removeEventListener("keydown", handleKeyDown, true);
	}, [selected.length]);

	const handleScopeChange = (nextScope: IdeasScope) => {
		setScope(nextScope);
		setSelected([]);
		setSelectionAnchor(null);
	};

	const handlePhaseChange = (phase: IdeaPhase) => {
		setActivePhase(phase);
		setSelected([]);
		setSelectionAnchor(null);
	};

	const [adding, setAdding] = useState(false);
	const editBuffer = useBacklog((s) => s.editBuffer);
	const setEditBuffer = useBacklog((s) => s.setEditBuffer);
	const cancelEdit = useBacklog((s) => s.clearEditBuffer);
	const editingId = editBuffer?.id ?? null;
	const [editingKind, setEditingKind] = useState<BacklogKind>("todo");

	const composerRef = useRef<IdeaEditorHandle>(null);
	const doc = useMemo(() => ensureTokens({ text, images }), [text, images]);
	const attach = useImageAttach((paths) => {
		const d = useBacklog.getState().draft;
		const r = insertImages(ensureTokens({ text: d.text, images: d.images }), composerRef.current?.caret() ?? d.text.length, paths);
		composerRef.current?.placeCaret(r.caret);
		setDraft({ text: r.doc.text, images: r.doc.images });
	});

	const add = async (e: React.FormEvent) => {
		e.preventDefault();
		const stored = docToStored(doc);
		if (!stored) {
			toast.error("先写点内容或粘贴图片再记录");
			composerRef.current?.placeCaret(doc.text.length);
			return;
		}
		setAdding(true);
		try {
			await backlogAdd(stored, kind, [], resolveCaptureProject(useBacklog.getState().captureProject, currentProject));
			useBacklog.getState().clearDraft();
			await useBacklog.getState().load();
		} catch (err) {
			toast.error(`添加失败: ${errMsg(err)}`);
		} finally {
			setAdding(false);
		}
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
			toast.error("内容不能为空");
			return;
		}
		try {
			const refs = (useBacklog.getState().items.find((i) => i.id === id)?.refs ?? []).filter((r) => r.kind !== "image");
			await backlogUpdate(id, { text: stored, kind: editingKind, refs });
			if (useBacklog.getState().editBuffer?.id === id) cancelEdit();
			await useBacklog.getState().load();
		} catch (err) {
			toast.error(`更新失败: ${errMsg(err)}`);
		}
	};

	/** Append items to the session's composer draft; their images become real composer attachments. */
	const fillComposer = (sessionId: string, targets: BacklogItem[]) => {
		const composer = useComposer.getState();
		const paths = targets.flatMap((it) => storedImagePaths(it.text, refImagePaths(it.refs)));
		const numbers = composer.attachImages(sessionId, paths);
		const numberByPath = new Map(paths.map((p, i) => [p, numbers[i]]));
		const numberOf = (p: string) => numberByPath.get(p) ?? 0;
		const bodies = targets.map((it) => ({ kind: it.kind, body: toComposerText(it.text, refImagePaths(it.refs), numberOf) }));
		const text = targets.length === 1 ? bodies[0].body : buildBatchFillText(bodies);
		composer.setDraft(sessionId, appendToDraft(composer.drafts[sessionId] ?? "", text));
		composer.focusComposer(sessionId);
	};

	const fillCurrentSingle = async (item: BacklogItem) => {
		if (!selectedSessionId) return;
		try {
			fillComposer(selectedSessionId, [item]);
			await backlogUpdate(item.id, { status: "dispatched", targetSessionId: selectedSessionId });
			setSelected((s) => s.filter((id) => id !== item.id));
			await useBacklog.getState().load();
			toast.success("已填入当前对话框");
		} catch (err) {
			toast.error(`操作失败: ${errMsg(err)}`);
		}
	};

	// Batch actions
	const handleCheckboxClick = (itemId: string, shiftKey: boolean) => {
		if (shiftKey && selectionAnchor) {
			const range = rangeSelection(visibleOrderedIds, selectionAnchor, itemId);
			setSelected((prev) => {
				const set = new Set(prev);
				for (const id of range) set.add(id);
				return [...set];
			});
		} else {
			setSelected((prev) =>
				prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId],
			);
			setSelectionAnchor(itemId);
		}
	};

	const handleToggleGroup = (groupItemIds: string[]) => {
		const allInGroupSelected = groupItemIds.length > 0 && groupItemIds.every((id) => selected.includes(id));
		if (allInGroupSelected) {
			const toRemove = new Set(groupItemIds);
			setSelected((prev) => prev.filter((id) => !toRemove.has(id)));
		} else {
			setSelected((prev) => {
				const set = new Set(prev);
				for (const id of groupItemIds) set.add(id);
				return [...set];
			});
		}
	};

	const handleToggleAll = () => {
		if (selected.length === visibleOrderedIds.length && visibleOrderedIds.length > 0) {
			setSelected([]);
			setSelectionAnchor(null);
		} else {
			setSelected([...visibleOrderedIds]);
			if (visibleOrderedIds.length > 0) {
				setSelectionAnchor(visibleOrderedIds[0]);
			}
		}
	};

	const selectedItemObjects = useMemo(() => {
		const itemMap = new Map(items.map((i) => [i.id, i]));
		// Keep visible order
		return visibleOrderedIds
			.filter((id) => selected.includes(id))
			.map((id) => itemMap.get(id)!)
			.filter(Boolean);
	}, [items, visibleOrderedIds, selected]);

	const batchFillCurrent = async () => {
		if (!selectedSessionId) return;
		const targetItems = selectedItemObjects;
		if (targetItems.length === 0) return;
		try {
			fillComposer(selectedSessionId, targetItems);

			let failed = 0;
			for (const it of targetItems) {
				try {
					await backlogUpdate(it.id, { status: "dispatched", targetSessionId: selectedSessionId });
				} catch {
					failed++;
				}
			}
			setSelected([]);
			setSelectionAnchor(null);
			await useBacklog.getState().load();
			if (failed === 0) {
				toast.success(`已将 ${targetItems.length} 项填入当前会话`);
			} else {
				toast.error(`${targetItems.length - failed} 项已填入，${failed} 项更新状态失败`);
			}
		} catch (err) {
			toast.error(`操作失败: ${errMsg(err)}`);
		}
	};

	const batchDelete = async () => {
		const targetItems = selectedItemObjects;
		if (targetItems.length === 0) return;
		const ok = await confirmDialog(`删除这 ${targetItems.length} 条？`, {
			danger: true,
			title: "批量删除",
			okLabel: "删除",
		});
		if (!ok) return;
		let failed = 0;
		const curEditId = useBacklog.getState().editBuffer?.id;
		for (const it of targetItems) {
			try {
				await backlogDelete(it.id);
				if (curEditId === it.id) useBacklog.getState().clearEditBuffer();
			} catch {
				failed++;
			}
		}
		setSelected([]);
		setSelectionAnchor(null);
		await useBacklog.getState().load();
		if (failed === 0) {
			toast.success(`已删除 ${targetItems.length} 条`);
		} else {
			toast.error(`已删除 ${targetItems.length - failed} 条，${failed} 条失败`);
		}
	};

	const batchSetStatus = async (status: BacklogStatus, label: string) => {
		const targetItems = selectedItemObjects;
		if (targetItems.length === 0) return;
		let failed = 0;
		for (const it of targetItems) {
			try {
				await backlogUpdate(it.id, { status });
			} catch {
				failed++;
			}
		}
		setSelected([]);
		setSelectionAnchor(null);
		await useBacklog.getState().load();
		if (failed === 0) {
			toast.success(`已${label} ${targetItems.length} 项`);
		} else {
			toast.error(`已${label} ${targetItems.length - failed} 项，${failed} 项失败`);
		}
	};

	const isBatchSupported = activePhase !== "running";
	const selectionCount = selected.length;
	const totalVisibleCount = visibleOrderedIds.length;
	const isAllSelected = totalVisibleCount > 0 && selectionCount === totalVisibleCount;
	const isIndeterminate = selectionCount > 0 && !isAllSelected;

	const selectAllCheckboxRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (selectAllCheckboxRef.current) {
			selectAllCheckboxRef.current.indeterminate = isIndeterminate;
		}
	}, [isIndeterminate]);

	const renderAdded = (item: BacklogItem) => {
		const at = item.createdAt || item.updatedAt;
		return (
			<span className="shrink-0 text-[10px] text-[var(--text-dim)]" title={new Date(at).toLocaleString()}>
				{formatAddedTime(at)}
			</span>
		);
	};

	const renderItem = (item: BacklogItem) => {
		const meta = KIND_META[item.kind];
		const linked = item.targetSessionId ? sessions[item.targetSessionId] : undefined;
		const isSelected = selected.includes(item.id);
		const isEditing = editingId === item.id;

		return (
			<div
				key={item.id}
				className={`group relative flex items-start gap-2 py-2 transition-colors ${
					isSelected ? "bg-sky-500/5" : "hover:bg-[var(--bg-hover)]/30"
				}`}
			>
				{isBatchSupported && (
					<div className="pt-0.5">
						<input
							type="checkbox"
							checked={isSelected}
							onChange={() => {}}
							onClick={(e) => {
								handleCheckboxClick(item.id, e.shiftKey);
							}}
							className="h-3.5 w-3.5 rounded border-[var(--border-divider)] text-sky-600 focus:ring-0"
							title="选择"
						/>
					</div>
				)}
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex items-center gap-1.5">
						{/* Kind dot with tooltip */}
						<span
							className={`inline-block h-2 w-2 shrink-0 rounded-full ${
								item.kind === "todo" ? "bg-sky-400" : item.kind === "bug" ? "bg-rose-400" : "bg-amber-400"
							}`}
							title={`类型：${meta.label}`}
						/>
						{/* Running chip */}
						{activePhase === "running" && (
							<button
								type="button"
								disabled={!item.targetSessionId}
								onClick={() => item.targetSessionId && selectSession(item.targetSessionId)}
								className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/25"
								title={linked?.title ? `打开会话：${linked.title}` : "打开会话"}
							>
								<span>运行中 · 打开会话</span>
								<ExternalLink className="h-2.5 w-2.5" />
							</button>
						)}
						{/* Review chip */}
						{activePhase === "review" && (
							<button
								type="button"
								disabled={!item.targetSessionId}
								onClick={() => item.targetSessionId && selectSession(item.targetSessionId)}
								className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/25"
								title={linked?.title ? `打开会话：${linked.title}` : "打开会话"}
							>
								<span>会话已停 · {linkedSessionStatus(linked)}</span>
								<ExternalLink className="h-2.5 w-2.5" />
							</button>
						)}

						<span className="ml-auto">{renderAdded(item)}</span>

						{/* Hover/focus-within edit & delete icons */}
						<div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
							<button
								type="button"
								onClick={() => startEdit(item)}
								className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
								title="编辑"
							>
								<Edit3 className="h-3 w-3" />
							</button>
							<button
								type="button"
								onClick={() => void deleteIdea(item.id)}
								className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-rose-400"
								title="删除"
							>
								<Trash2 className="h-3 w-3" />
							</button>
						</div>
					</div>

					{isEditing ? (
						<div className="space-y-1.5">
							<div className="flex items-center gap-1">
								<span className="text-[10px] text-[var(--text-dim)]">类型:</span>
								{KINDS.map((k) => (
									<button
										key={k}
										type="button"
										onClick={() => setEditingKind(k)}
										className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
											editingKind === k ? KIND_META[k].cls : "text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
										}`}
									>
										{KIND_META[k].label}
									</button>
								))}
							</div>
							<EditIdeaBox id={item.id} onSave={() => void saveEdit(item.id)} onCancel={cancelEdit} />
						</div>
					) : (
						<div className={activePhase === "finished" ? "text-[var(--text-dim)]" : "text-[var(--text)]"}>
							<IdeaTextView stored={item.text} refImages={refImagePaths(item.refs)} />
						</div>
					)}

					{/* Action buttons per phase */}
					{!isEditing && (
						<div className="flex items-center justify-end gap-1.5 pt-0.5">
							{activePhase === "pending" && (
								<>
									<button
										type="button"
										disabled={!selectedSessionId}
										onClick={() => void fillCurrentSingle(item)}
										className="inline-flex items-center gap-1 rounded-full border border-[var(--border-divider)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text)] shadow-xs transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40"
										title={selectedSessionId ? "追加到当前会话输入框" : "当前未选择会话"}
									>
										<CornerDownLeft className="h-3 w-3" />
										填入当前会话
									</button>
									<button
										type="button"
										onClick={() => onDispatch([item])}
										className={`${PRIMARY_BTN} gap-1 rounded-full px-3 py-0.5 text-[11px]`}
									>
										<Send className="h-3 w-3" />
										派发
									</button>
								</>
							)}
							{activePhase === "review" && (
								<>
									<button
										type="button"
										onClick={() => void setStatus(item.id, "inbox")}
										className="inline-flex items-center gap-1 rounded-full border border-[var(--border-divider)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text)] shadow-xs transition-colors hover:bg-[var(--bg-hover)]"
										title="放回待处理"
									>
										<RotateCcw className="h-3 w-3" />
										放回
									</button>
									<button
										type="button"
										onClick={() => void setStatus(item.id, "done")}
										className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-0.5 text-[11px] font-medium text-white shadow-xs transition-colors hover:bg-emerald-500"
									>
										<Check className="h-3 w-3" />
										完成
									</button>
								</>
							)}
							{activePhase === "finished" && (
								<button
									type="button"
									onClick={() => void setStatus(item.id, "inbox")}
									className="inline-flex items-center gap-1 rounded-full border border-[var(--border-divider)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text)] shadow-xs transition-colors hover:bg-[var(--bg-hover)]"
									title="放回待处理"
								>
									<RotateCcw className="h-3 w-3" />
									放回
								</button>
							)}
						</div>
					)}
				</div>
			</div>
		);
	};

	const phaseTabs: { id: IdeaPhase; label: string }[] = [
		{ id: "pending", label: "待处理" },
		{ id: "running", label: "运行中" },
		{ id: "review", label: "待验收" },
		{ id: "finished", label: "已完成" },
	];

	return (
		<div className="flex max-h-[min(600px,calc(100vh-8rem))] flex-col text-xs">
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between border-b border-[var(--border-divider)] pb-2">
				<span className="font-semibold text-[var(--text)]">想法收集</span>
				<div className="flex items-center gap-2">
					<div className="inline-flex rounded-lg bg-[var(--bg)] p-0.5">
						<button
							type="button"
							onClick={() => handleScopeChange("all")}
							className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
								effectiveScope === "all"
									? "bg-[var(--bg-hover)] font-medium text-[var(--text)]"
									: "text-[var(--text-dim)] hover:text-[var(--text)]"
							}`}
						>
							全部
						</button>
						<button
							type="button"
							disabled={!currentProject}
							onClick={() => handleScopeChange("current")}
							title={currentProject ? `当前项目：${currentProject}` : "当前未选择项目会话"}
							className={`rounded-md px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
								effectiveScope === "current"
									? "bg-[var(--bg-hover)] font-medium text-[var(--text)]"
									: "text-[var(--text-dim)] hover:text-[var(--text)]"
							}`}
						>
							当前项目
						</button>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{/* Quick capture form */}
			<form
				onSubmit={add}
				{...attach.dropProps}
				className={`my-2 shrink-0 space-y-1 rounded-lg ${attach.dragging ? "outline-dashed outline-1 outline-sky-500" : ""}`}
			>
				<ImageThumbs
					paths={doc.images}
					onRemove={(p) => {
						const r = removeImage(doc, doc.images.indexOf(p) + 1);
						setDraft({ text: r.text, images: r.images });
					}}
				/>
				<div className="flex items-start gap-1.5">
					<button
						type="button"
						onClick={attach.pick}
						title="添加图片"
						aria-label="添加图片"
						className="mt-[3px] inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-[var(--border-divider)] text-[var(--text-dim)] transition-colors hover:border-sky-500 hover:text-sky-400"
					>
						<ImagePlus className="h-4 w-4" />
					</button>
					<div className="min-w-0 flex-1">
						<IdeaEditor
							ref={composerRef}
							doc={doc}
							onChange={(d) => {
								const r = reconcileDoc(d);
								setDraft({ text: r.text, images: r.images });
							}}
							onPaste={attach.onPaste}
							onKeyDown={(e) => {
								if (e.key !== "Enter" || e.shiftKey) return;
								e.preventDefault();
								if (isComposing(e)) return;
								e.currentTarget.form?.requestSubmit();
							}}
							placeholder="随手记一条…（Shift+Enter 换行）"
							minHeight={36}
							maxHeight={120}
							boxClass="rounded-lg border-[var(--border-divider)] focus:border-sky-500"
						/>
					</div>
					<button
						type="submit"
						disabled={adding}
						className={`${PRIMARY_BTN} gap-1 rounded-lg px-3 py-1.5`}
					>
						{adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
						记录
					</button>
				</div>
				<div className="flex items-center gap-1.5 pt-0.5">
					<span className="text-[10px] text-[var(--text-dim)]">类型:</span>
					{KINDS.map((k) => {
						const meta = KIND_META[k];
						const Icon = meta.icon;
						return (
							<button
								key={k}
								type="button"
								onClick={() => {
									setDraft({ kind: k });
									setLastKind(k);
								}}
								className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${
									kind === k ? meta.cls : "text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
								}`}
							>
								<Icon className="h-3 w-3" />
								{meta.label}
							</button>
						);
					})}
					{attach.fileInput}
				</div>
				<CaptureProjectSelect currentProject={currentProject} className="pt-0.5" />
			</form>

			{/* Tab row OR Selection bar */}
			<div className="shrink-0 border-b border-[var(--border-divider)] pb-1.5">
				{selectionCount > 0 ? (
					<div className="flex items-center justify-between rounded-lg bg-sky-500/10 px-2 py-1 text-[11px] text-sky-200">
						<div className="flex items-center gap-2">
							<input
								ref={selectAllCheckboxRef}
								type="checkbox"
								checked={isAllSelected}
								onChange={handleToggleAll}
								className="h-3.5 w-3.5 rounded border-[var(--border-divider)] text-sky-600 focus:ring-0"
								title={isAllSelected ? "取消全选" : "全选"}
							/>
							<span>
								已选 {selectionCount} / {totalVisibleCount}
							</span>
						</div>
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								onClick={handleToggleAll}
								className="rounded px-1.5 py-0.5 text-sky-300 hover:bg-sky-500/20"
							>
								{isAllSelected ? "取消全选" : "全选"}
							</button>
							<button
								type="button"
								onClick={() => {
									setSelected([]);
									setSelectionAnchor(null);
								}}
								className="rounded px-1.5 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
							>
								清除
							</button>
						</div>
					</div>
				) : (
					<div className="flex items-center gap-1">
						{phaseTabs.map((tab) => {
							const count = phaseBuckets[tab.id].length;
							const isActive = activePhase === tab.id;
							return (
								<button
									key={tab.id}
									type="button"
									onClick={() => handlePhaseChange(tab.id)}
									className={`flex-1 rounded-md px-1.5 py-1 text-center text-[11px] transition-colors ${
										isActive
											? "bg-[var(--bg-hover)] font-medium text-[var(--text)]"
											: "text-[var(--text-dim)] hover:text-[var(--text)]"
									}`}
								>
									{tab.label} <span className="text-[10px] opacity-75">{count}</span>
								</button>
							);
						})}
					</div>
				)}
			</div>

			{/* List container */}
			<div className="min-h-24 flex-1 divide-y divide-[var(--border-divider)] overflow-y-auto pr-3 [scrollbar-gutter:stable]">
				{currentPhaseItems.length === 0 ? (
					<div className="my-4 rounded-lg border border-dashed border-[var(--border-divider)] p-4 text-center text-[var(--text-dim)]">
						{activePhase === "pending"
							? effectiveScope === "current"
								? "当前项目没有待处理的想法"
								: "还没有待处理的想法，在上面随手记一条吧"
							: activePhase === "running"
								? "没有正在运行中的任务"
								: activePhase === "review"
									? "没有待验收的任务"
									: "没有已完成的事项"}
					</div>
				) : groups ? (
					groups.map((g) => {
						const groupItemIds = g.items.map((i) => i.id);
						const groupSelectedCount = groupItemIds.filter((id) => selected.includes(id)).length;
						const isGroupAllSelected = groupItemIds.length > 0 && groupSelectedCount === groupItemIds.length;
						const isGroupIndeterminate = groupSelectedCount > 0 && !isGroupAllSelected;

						return (
							<div key={g.project ?? "__global"} className="pt-2 first:pt-0">
								<div className="sticky top-0 z-10 flex items-center justify-between bg-[var(--bg-panel)]/95 py-1 backdrop-blur-xs">
									<div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-dim)]">
										{isBatchSupported && (
											<input
												type="checkbox"
												checked={isGroupAllSelected}
												ref={(el) => {
													if (el) el.indeterminate = isGroupIndeterminate;
												}}
												onChange={() => handleToggleGroup(groupItemIds)}
												className="h-3 w-3 rounded border-[var(--border-divider)] text-sky-600 focus:ring-0"
												title="选择该项目全部事项"
											/>
										)}
										<span className="truncate" title={g.project ?? ""}>
											{g.label}
										</span>
										{g.isCurrent && (
											<span className="rounded bg-sky-500/15 px-1 text-[10px] font-normal text-sky-300">
												当前
											</span>
										)}
										<span className="text-[10px] font-normal opacity-75">({g.items.length})</span>
									</div>
								</div>
								<div className="divide-y divide-[var(--border-divider)]">
									{g.items.map(renderItem)}
								</div>
							</div>
						);
					})
				) : (
					currentPhaseItems.map(renderItem)
				)}
			</div>

			{/* Sticky bottom batch action bar */}
			{selectionCount > 0 && (
				<div className="mt-2 flex shrink-0 items-center justify-between border-t border-[var(--border-divider)] pt-2">
					<span className="text-[11px] text-[var(--text-dim)]">
						已选 {selectionCount} 项
					</span>
					<div className="flex items-center gap-1.5">
						{activePhase === "pending" && (
							<>
								<button
									type="button"
									onClick={() => void batchDelete()}
									className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/10"
								>
									<Trash2 className="h-3 w-3" />
									删除
								</button>
								<button
									type="button"
									disabled={!selectedSessionId}
									onClick={() => void batchFillCurrent()}
									className="inline-flex items-center gap-1 rounded-full border border-[var(--border-divider)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
									title={selectedSessionId ? "追加到当前会话输入框" : "当前未选择会话"}
								>
									<CornerDownLeft className="h-3 w-3" />
									填入当前会话
								</button>
								<button
									type="button"
									onClick={() => {
										onDispatch(selectedItemObjects);
										setSelected([]);
										setSelectionAnchor(null);
									}}
									className={`${PRIMARY_BTN} gap-1 rounded-full px-3 py-1 text-[11px]`}
								>
									<Send className="h-3 w-3" />
									派发 ({selectionCount})
								</button>
							</>
						)}
						{activePhase === "review" && (
							<>
								<button
									type="button"
									onClick={() => void batchSetStatus("inbox", "放回待处理")}
									className="inline-flex items-center gap-1 rounded-full border border-[var(--border-divider)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]"
								>
									<RotateCcw className="h-3 w-3" />
									放回待处理
								</button>
								<button
									type="button"
									onClick={() => void batchSetStatus("done", "标记完成")}
									className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-medium text-white shadow-xs hover:bg-emerald-500"
								>
									<Check className="h-3 w-3" />
									标记完成 ({selectionCount})
								</button>
							</>
						)}
						{activePhase === "finished" && (
							<>
								<button
									type="button"
									onClick={() => void batchDelete()}
									className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-500/10"
								>
									<Trash2 className="h-3 w-3" />
									删除
								</button>
								<button
									type="button"
									onClick={() => void batchSetStatus("inbox", "放回待处理")}
									className="inline-flex items-center gap-1 rounded-full border border-[var(--border-divider)] px-2.5 py-1 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]"
								>
									<RotateCcw className="h-3 w-3" />
									放回待处理
								</button>
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

/** Edit buffer → editable doc (buffers saved before inline tokens carry raw `[图片: path]` tags). */
function bufferDoc(buf: { text: string; images?: string[] }): TokenDoc {
	return buf.images ? ensureTokens({ text: buf.text, images: buf.images }) : storedToDoc(buf.text);
}

/** In-place editor for one idea: auto-growing, Enter saves, Esc cancels, paste/drop adds image tokens. */
function EditIdeaBox({ id, onSave, onCancel }: { id: string; onSave: () => void; onCancel: () => void }) {
	const buf = useBacklog((s) => s.editBuffer);
	const setEditBuffer = useBacklog((s) => s.setEditBuffer);
	const ref = useRef<IdeaEditorHandle>(null);
	const attach = useImageAttach((paths) => {
		const b = useBacklog.getState().editBuffer;
		if (!b || b.id !== id) return;
		const r = insertImages(bufferDoc(b), ref.current?.caret() ?? b.text.length, paths);
		ref.current?.placeCaret(r.caret);
		setEditBuffer({ id, text: r.doc.text, images: r.doc.images });
	});
	if (!buf || buf.id !== id) return null;
	return (
		<div {...attach.dropProps} className={`rounded ${attach.dragging ? "outline-dashed outline-1 outline-sky-500" : ""}`}>
			<IdeaEditor
				ref={ref}
				doc={bufferDoc(buf)}
				autoFocus
				onChange={(d) => {
					const r = reconcileDoc(d);
					setEditBuffer({ id, text: r.text, images: r.images });
				}}
				onPaste={attach.onPaste}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						onCancel();
						return;
					}
					if (e.key !== "Enter" || e.shiftKey) return;
					e.preventDefault();
					if (!isComposing(e)) onSave();
				}}
				onBlur={() => {
					// Window lost focus (app switch / reload): keep the buffer.
					if (document.hasFocus()) onCancel();
				}}
				minHeight={52}
				maxHeight={240}
				boxClass="rounded border-sky-500"
			/>
			<div className="mt-0.5 text-[10px] text-[var(--text-dim)]">Enter 保存 · Shift+Enter 换行 · Esc 取消</div>
		</div>
	);
}
function DispatchDialog({
	items,
	currentProject,
	onClose,
}: {
	items: BacklogItem[];
	currentProject: string | null;
	onClose: () => void;
}) {
	const sessions = useSessions((state) => state.sessions);
	const selectedSessionId = useUi((state) => state.selectedSessionId);
	const selectSession = useUi((state) => state.selectSession);
	const sessionList = Object.values(sessions).filter((session) => !session.archived);
	const activeId =
		selectedSessionId && sessionList.some((session) => session.id === selectedSessionId)
			? selectedSessionId
			: null;
	const [target, setTarget] = useState<"existing" | "new">(
		activeId || sessionList.length > 0 ? "existing" : "new",
	);
	const [existingId, setExistingId] = useState(activeId ?? sessionList[0]?.id ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Split items by project
	const projectGroups = useMemo(() => splitByProject(items), [items]);
	const projectCount = projectGroups.length;
	// Groups already dispatched in an earlier attempt; a retry after a partial failure skips them
	// instead of sending the same prompt twice.
	const dispatchedGroups = useRef(new Set<number>());
	const createdSessions = useRef<string[]>([]);

	const getGroupProjectName = (groupItems: BacklogItem[]) => {
		const root = projectRoot(groupItems[0]?.projectDir);
		if (!root) return "未关联项目";
		return root.split("/").filter(Boolean).pop() ?? root;
	};

	const run = async () => {
		setBusy(true);
		setError(null);
		try {
			if (target === "existing") {
				const targetId = existingId;
				if (!targetId) throw new Error("请选择目标会话");
				const prompt = await backlogBuildPrompt(items.map((item) => item.id));
				await dispatchPrompt(targetId, prompt);
				for (const item of items) {
					await backlogUpdate(item.id, { status: "dispatched", targetSessionId: targetId });
				}
				await useBacklog.getState().load();
				toast.success("已派发给 Agent");
				onClose();
				selectSession(targetId);
			} else {
				// target === "new"
				// Use splitByProject: one new session per project group
				const activeMode = useSidebarStore.getState().activeMode;
				const globalPath =
					activeMode === "chat"
						? (await listWorkspaces()).find((workspace) => workspace.kind === "global")?.path
						: undefined;

				for (const [index, group] of projectGroups.entries()) {
					if (dispatchedGroups.current.has(index)) continue;
					const groupProject = group[0]?.projectDir ?? currentProject ?? globalPath;
					if (!groupProject) {
						throw new Error("当前模式没有可用的项目目录，请先添加项目");
					}
					const info = await rpcStart({
						cwd: groupProject,
						mode:
							globalPath && groupProject === globalPath
								? "chat"
								: activeMode === "chat"
									? "code"
									: activeMode,
					});
					createdSessions.current.push(info.sessionId);
					const prompt = await backlogBuildPrompt(group.map((item) => item.id));
					await dispatchPrompt(info.sessionId, prompt);
					for (const item of group) {
						await backlogUpdate(item.id, { status: "dispatched", targetSessionId: info.sessionId });
					}
					dispatchedGroups.current.add(index);
				}

				await useBacklog.getState().load();
				toast.success("已派发给 Agent");
				onClose();
				const first = createdSessions.current[0];
				if (first) selectSession(first);
			}
		} catch (err) {
			const message = errMsg(err);
			// Some groups may already be dispatched; reflect that in the list behind the dialog.
			void useBacklog.getState().load().catch(() => {});
			setError(message);
			toast.error(`派发失败: ${message}`);
		} finally {
			setBusy(false);
		}
	};

	const tabCls = (on: boolean) =>
		`rounded-lg border p-2.5 text-center font-medium ${
			on
				? "border-sky-500 bg-sky-500/10 text-sky-300"
				: "border-[var(--border-divider)] bg-[var(--bg)] text-[var(--text-dim)] hover:text-[var(--text)]"
		}`;

	return (
		<FloatingLayer
			anchor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
			placement="center"
			layer="modal"
			onDismiss={() => {
				if (!busy) onClose();
			}}
			className="max-h-[calc(100vh-1rem)] w-[460px] max-w-[calc(100vw-1rem)] p-5 shadow-apple-modal"
		>
			<div className="space-y-4 text-xs">
				<div className="flex items-center justify-between border-b border-[var(--border-divider)] pb-2.5">
					<div className="flex items-center gap-2">
						<Send className="h-4 w-4 text-sky-400" />
						<h3 className="text-sm font-semibold text-[var(--text)]">派发给 Agent</h3>
					</div>
					<button
						type="button"
						disabled={busy}
						onClick={onClose}
						className="rounded p-1 text-[var(--text-dim)] hover:text-[var(--text)]"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						disabled={!sessionList.length}
						onClick={() => setTarget("existing")}
						className={`${tabCls(target === "existing")} disabled:opacity-40`}
					>
						现有会话
					</button>
					<button type="button" onClick={() => setTarget("new")} className={tabCls(target === "new")}>
						开启新会话
					</button>
				</div>
				{target === "existing" ? (
					<div className="space-y-1.5">
						<label className="text-[var(--text-dim)]">选择会话</label>
						<NativeSelect
							value={existingId}
							onChange={(event) => setExistingId(event.target.value)}
							className="w-full"
						>
							{sessionList.map((session) => (
								<option key={session.id} value={session.id}>
									{sessionOptionLabel(session)}
								</option>
							))}
						</NativeSelect>
					</div>
				) : (
					<div className="space-y-1.5 text-[var(--text-dim)]">
						{projectCount > 1 ? (
							<div>
								<div>
									选中的 {items.length} 条来自 {projectCount} 个项目，将分别开 {projectCount} 个新会话：
								</div>
								<ul className="mt-1 list-inside list-disc space-y-0.5 text-[11px] text-[var(--text)]">
									{projectGroups.map((g, idx) => (
										<li key={idx}>
											<span className="font-medium">{getGroupProjectName(g)}</span> ({g.length} 条)
										</li>
									))}
								</ul>
							</div>
						) : (
							<div>
								{items[0]?.projectDir ?? currentProject ? (
									<>将在 {getGroupProjectName(projectGroups[0] ?? items)} 中开启新会话</>
								) : (
									"将在全局工作区中开启新会话"
								)}
							</div>
						)}
					</div>
				)}
				{error && (
					<div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300">
						{error}
					</div>
				)}
				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-2">
					<button
						type="button"
						disabled={busy}
						onClick={onClose}
						className="rounded-lg px-3 py-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					>
						取消
					</button>
					<button
						type="button"
						disabled={busy || (target === "existing" && !existingId)}
						onClick={() => void run()}
						className={`${PRIMARY_BTN} gap-1.5 rounded-lg px-4 py-1.5 font-semibold`}
					>
						{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						确认派发
					</button>
				</div>
			</div>
		</FloatingLayer>
	);
}
