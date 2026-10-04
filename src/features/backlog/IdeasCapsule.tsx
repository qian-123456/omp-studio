import {
	Bug,
	ChevronDown,
	ChevronRight,
	CornerDownLeft,
	Edit3,
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
import { FloatingLayer } from "../../components/FloatingLayer";
import { NativeSelect } from "../../components/NativeSelect";
import type { BacklogItem, BacklogKind, BacklogRef, BacklogStatus, Workspace } from "../../lib/contracts";
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
import { parseInlineImages } from "../chat/Composer";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useBacklog } from "./backlogStore";
import { AddImageButton, ImageThumbs, useImageAttach } from "./IdeaImages";
import {
	appendToDraft,
	filterIdeas,
	formatAddedTime,
	groupIdeasByProject,
	type IdeasFilter,
	ideaImages,
	linkedSessionStatus,
	partitionIdeas,
} from "./ideasLogic";

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

/** Top-bar 「想法」 capsule: count of undispatched items + backlog dropdown. */
export function IdeasCapsule() {
	const items = useBacklog((s) => s.items);
	const load = useBacklog((s) => s.load);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const sessions = useSessions((s) => s.sessions);
	const currentProject = selectedSessionId ? (sessions[selectedSessionId]?.cwd ?? null) : null;

	// Reopen the dropdown after a reload if an unsaved edit was in progress.
	const [open, setOpen] = useState(() => useBacklog.getState().editBuffer !== null);
	const [dispatching, setDispatching] = useState<BacklogItem | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		void load().catch(() => {});
	}, [load]);

	const pending = items.filter((i) => i.status === "inbox").length;

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
				title="想法收集：随手记、稍后派给 Agent"
			>
				<Lightbulb className="h-3.5 w-3.5 text-amber-400" />
				<span>想法</span>
				{pending > 0 && (
					<span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">{pending}</span>
				)}
			</button>

			<FloatingLayer
				anchor={open ? triggerRef.current : null}
				placement="bottom-end"
				offset={6}
				layer="popover"
				onDismiss={() => setOpen(false)}
				ignoreRefs={[triggerRef]}
				className="w-[380px] p-3"
			>
				<IdeasPanel
					items={items}
					currentProject={currentProject}
					onClose={() => setOpen(false)}
					onDispatch={(item) => {
						setOpen(false);
						setDispatching(item);
					}}
				/>
			</FloatingLayer>

			{dispatching && (
				<DispatchDialog
					item={dispatching}
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
	onDispatch: (item: BacklogItem) => void;
}) {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);
	const draft = useBacklog((s) => s.draft);
	const setDraft = useBacklog((s) => s.setDraft);
	const setLastKind = useBacklog((s) => s.setLastKind);
	const { text, kind, images } = draft;

	const [filter, setFilter] = useState<IdeasFilter>("all");
	// "current" without a current project degrades to "all".
	const view: IdeasFilter = filter === "current" && !currentProject ? "all" : filter;
	const { active, finished } = useMemo(() => partitionIdeas(items), [items]);
	const visibleActive = useMemo(() => filterIdeas(active, view, currentProject), [active, view, currentProject]);
	const visibleFinished = useMemo(
		() => filterIdeas(finished, view, currentProject),
		[finished, view, currentProject],
	);
	const groups = useMemo(
		() => (view === "project" ? groupIdeasByProject(visibleActive, currentProject) : null),
		[view, visibleActive, currentProject],
	);

	const [adding, setAdding] = useState(false);
	// Edit buffer lives in the store (localStorage) so an HMR/page reload keeps unsaved text.
	const editBuffer = useBacklog((s) => s.editBuffer);
	const setEditBuffer = useBacklog((s) => s.setEditBuffer);
	const cancelEdit = useBacklog((s) => s.clearEditBuffer);
	const editingId = editBuffer?.id ?? null;
	const editText = editBuffer?.text ?? "";
	const [showFinished, setShowFinished] = useState(false);

	const attach = useImageAttach((paths) => {
		const cur = useBacklog.getState().draft.images;
		setDraft({ images: [...cur, ...paths.filter((p) => !cur.includes(p))] });
	});

	const add = async (e: React.FormEvent) => {
		e.preventDefault();
		if (isComposing({ key: "Enter" })) return;
		const trimmed = text.trim();
		if (!trimmed && images.length === 0) return;
		setAdding(true);
		try {
			const refs: BacklogRef[] = images.map((path) => ({
				kind: "image",
				path,
				text: null,
				lines: null,
				sessionId: null,
			}));
			await backlogAdd(trimmed || "（图片）", kind, refs, currentProject);
			useBacklog.getState().clearDraft();
			await useBacklog.getState().load();
		} catch (err) {
			toast.error(`添加失败: ${errMsg(err)}`);
		} finally {
			setAdding(false);
		}
	};

	const saveEdit = async (id: string) => {
		const trimmed = (useBacklog.getState().editBuffer?.text ?? "").trim();
		if (!trimmed) {
			toast.error("内容不能为空");
			return;
		}
		try {
			await backlogUpdate(id, { text: trimmed });
			if (useBacklog.getState().editBuffer?.id === id) cancelEdit();
			await useBacklog.getState().load();
		} catch (err) {
			toast.error(`更新失败: ${errMsg(err)}`);
		}
	};

	const fillCurrent = async (item: BacklogItem) => {
		if (!selectedSessionId) return;
		try {
			const composer = useComposer.getState();
			const existing = composer.drafts[selectedSessionId] ?? "";
			const imgs = ideaImages(item);
			let imagePlaceholders = "";
			if (imgs.length > 0) {
				const existingParsed = parseInlineImages(existing);
				const startIdx =
					existingParsed.length > 0
						? Math.max(...existingParsed.map((t) => t.index)) + 1
						: 1;
				imagePlaceholders = imgs
					.map((p, i) => `[Image #${startIdx + i}: ${p}]`)
					.join(" ");
			}
			const itemContent = imagePlaceholders
				? `${item.text} ${imagePlaceholders}`
				: item.text;
			composer.setDraft(selectedSessionId, appendToDraft(existing, itemContent));
			composer.focusComposer(selectedSessionId);
			await backlogUpdate(item.id, { status: "dispatched", targetSessionId: selectedSessionId });
			await useBacklog.getState().load();
			onClose();
		} catch (err) {
			toast.error(`操作失败: ${errMsg(err)}`);
		}
	};

	const iconBtn = "rounded p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]";
	const filterTabs: { id: IdeasFilter; label: string; disabled?: boolean }[] = [
		{ id: "all", label: "全部" },
		{ id: "current", label: "当前项目", disabled: !currentProject },
		{ id: "project", label: "按项目归类" },
	];

	const renderAdded = (item: BacklogItem) => {
		const at = item.createdAt || item.updatedAt;
		return (
			<span className="text-[10px] text-[var(--text-dim)]" title={new Date(at).toLocaleString()}>
				{formatAddedTime(at)}
			</span>
		);
	};

	const renderItem = (item: BacklogItem, index: number) => {
		const meta = KIND_META[item.kind];
		const linked = item.targetSessionId ? sessions[item.targetSessionId] : undefined;
		const otherProject = view !== "project" && item.projectDir && item.projectDir !== currentProject;
		return (
			<div key={item.id} className="rounded-lg border border-[var(--border-divider)] bg-[var(--bg)] p-2">
				<div className="flex items-start gap-2">
					{item.status === "dispatched" && (
						<input
							type="checkbox"
							className="mt-0.5"
							title="标记完成"
							onChange={() => void setStatus(item.id, "done")}
						/>
					)}
					<div className="min-w-0 flex-1 space-y-1">
						<div className="flex flex-wrap items-center gap-1.5">
							<span className="font-mono text-[10px] font-semibold text-[var(--text-40)]">#{index + 1}</span>
							<span className={`rounded px-1 text-[10px] ${meta.cls}`}>{meta.label}</span>
							{item.status === "dispatched" && (
								<button
									type="button"
									disabled={!item.targetSessionId}
									onClick={() => item.targetSessionId && selectSession(item.targetSessionId)}
									className="rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-300 hover:underline"
									title={linked?.title}
								>
									进行中 · {linkedSessionStatus(linked)}
								</button>
							)}
							{otherProject && (
								<span className="truncate text-[10px] text-[var(--text-dim)]" title={item.projectDir ?? ""}>
									{item.projectDir?.split("/").pop()}
								</span>
							)}
							<span className="ml-auto">{renderAdded(item)}</span>
						</div>
						{editingId === item.id ? (
							<input
								autoFocus
								value={editText}
								onChange={(e) => setEditBuffer({ id: item.id, text: e.target.value })}
								onKeyDown={(e) => {
									if (isComposing(e)) return;
									if (e.key === "Enter") void saveEdit(item.id);
									if (e.key === "Escape") cancelEdit();
								}}
								onBlur={() => {
									// Window lost focus (app switch / reload): keep the buffer.
									if (document.hasFocus()) cancelEdit();
								}}
								className="w-full rounded border border-sky-500 bg-[var(--bg)] px-1.5 py-0.5 text-[var(--text)] focus:outline-none"
							/>
						) : (
							<p className="break-words text-[var(--text)]">{item.text}</p>
						)}
						<ImageThumbs paths={ideaImages(item)} size="h-10 w-10" />
					</div>
				</div>
				<div className="mt-1 flex items-center justify-end gap-0.5">
					{item.status === "inbox" && (
						<>
							<button
								type="button"
								disabled={!selectedSessionId}
								onClick={() => void fillCurrent(item)}
								className={`${iconBtn} inline-flex items-center gap-1 disabled:opacity-40`}
								title={selectedSessionId ? "追加到当前会话输入框" : "当前未选择会话"}
							>
								<CornerDownLeft className="h-3 w-3" />
								填入当前会话
							</button>
							<button
								type="button"
								onClick={() => onDispatch(item)}
								className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-sky-300 hover:bg-sky-500/10"
							>
								<Send className="h-3 w-3" />
								派发
							</button>
						</>
					)}
					<button
						type="button"
						onClick={() => {
							setEditBuffer({ id: item.id, text: item.text });
						}}
						className={iconBtn}
						title="编辑"
					>
						<Edit3 className="h-3 w-3" />
					</button>
					<button type="button" onClick={() => void deleteIdea(item.id)} className={`${iconBtn} hover:text-rose-400`} title="删除">
						<Trash2 className="h-3 w-3" />
					</button>
				</div>
			</div>
		);
	};

	return (
		<div className="space-y-3 text-xs">
			<div className="flex items-center justify-between border-b border-[var(--border-divider)] pb-2">
				<span className="font-semibold text-[var(--text)]">想法收集</span>
				<button type="button" onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)]">
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			<form
				onSubmit={add}
				{...attach.dropProps}
				className={`space-y-2 rounded-lg ${attach.dragging ? "outline-dashed outline-1 outline-sky-500" : ""}`}
			>
				<div className="flex items-center gap-1.5">
					<input
						value={text}
						onChange={(e) => setDraft({ text: e.target.value })}
						onPaste={attach.onPaste}
						onKeyDown={(e) => {
							// Enter that commits an IME candidate must not submit the form.
							if (isComposing(e) && e.key === "Enter") e.preventDefault();
						}}
						placeholder="随手记一条，可粘贴/拖入图片…"
						className="flex-1 rounded-lg border border-[var(--border-divider)] bg-[var(--bg)] px-2.5 py-1.5 text-[var(--text)] placeholder:text-[var(--text-dim)] focus:border-sky-500 focus:outline-none"
					/>
					<button
						type="submit"
						disabled={adding || (!text.trim() && images.length === 0)}
						className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
					>
						{adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
						记录
					</button>
				</div>
				<ImageThumbs paths={images} onRemove={(p) => setDraft({ images: images.filter((x) => x !== p) })} />
				<div className="flex items-center gap-1.5">
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
								className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 ${
									kind === k ? meta.cls : "text-[var(--text-dim)] hover:bg-[var(--bg-hover)]"
								}`}
							>
								<Icon className="h-3 w-3" />
								{meta.label}
							</button>
						);
					})}
					<AddImageButton
						onClick={attach.pick}
						className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					/>
					{attach.fileInput}
				</div>
			</form>

			<div className="flex items-center gap-1 rounded-lg bg-[var(--bg)] p-0.5">
				{filterTabs.map((t) => (
					<button
						key={t.id}
						type="button"
						disabled={t.disabled}
						onClick={() => setFilter(t.id)}
						title={t.disabled ? "当前未选择项目会话" : t.id === "current" ? (currentProject ?? "") : undefined}
						className={`flex-1 rounded-md px-2 py-0.5 disabled:opacity-40 ${
							view === t.id ? "bg-[var(--bg-hover)] font-medium text-[var(--text)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
						}`}
					>
						{t.label}
					</button>
				))}
			</div>

			<div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
				{visibleActive.length === 0 && (
					<div className="rounded-lg border border-dashed border-[var(--border-divider)] p-4 text-center text-[var(--text-dim)]">
						{view === "current" ? "当前项目还没有想法" : "还没有想法，在上面随手记一条吧"}
					</div>
				)}
				{groups
					? groups.map((g) => (
							<div key={g.project ?? "__global"} className="space-y-1.5">
								<div
									className="flex items-center gap-1.5 pt-1 text-[10px] font-semibold text-[var(--text-dim)]"
									title={g.project ?? ""}
								>
									<span className="truncate">{g.label}</span>
									{g.isCurrent && <span className="rounded bg-sky-500/15 px-1 text-sky-300">当前</span>}
									<span>({g.items.length})</span>
								</div>
								{g.items.map(renderItem)}
							</div>
						))
					: visibleActive.map(renderItem)}

				{visibleFinished.length > 0 && (
					<div className="pt-1">
						<button
							type="button"
							onClick={() => setShowFinished(!showFinished)}
							className="inline-flex items-center gap-1 text-[var(--text-dim)] hover:text-[var(--text)]"
						>
							{showFinished ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
							已完成 ({visibleFinished.length})
						</button>
						{showFinished &&
							visibleFinished.map((item, index) => (
								<div key={item.id} className="mt-1 rounded px-1 py-1 opacity-70">
									<div className="flex items-center gap-2">
										<span className="font-mono text-[10px] font-semibold text-[var(--text-40)]">#{index + 1}</span>
										<span className="min-w-0 flex-1 truncate text-[var(--text-dim)] line-through">{item.text}</span>
										{renderAdded(item)}
										<button
											type="button"
											onClick={() => void setStatus(item.id, "inbox")}
											className={`${iconBtn} inline-flex items-center gap-1`}
											title="放回待派发"
										>
											<RotateCcw className="h-3 w-3" />
											放回
										</button>
										<button type="button" onClick={() => void deleteIdea(item.id)} className={`${iconBtn} hover:text-rose-400`} title="删除">
											<Trash2 className="h-3 w-3" />
										</button>
									</div>
									<ImageThumbs paths={ideaImages(item)} size="h-8 w-8" />
								</div>
							))}
					</div>
				)}
			</div>
		</div>
	);
}

function DispatchDialog({
	item,
	currentProject,
	onClose,
}: {
	item: BacklogItem;
	currentProject: string | null;
	onClose: () => void;
}) {
	const sessions = useSessions((s) => s.sessions);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessionList = Object.values(sessions).filter((s) => !s.archived);

	const [target, setTarget] = useState<"existing" | "new">(sessionList.length > 0 ? "existing" : "new");
	const [existingId, setExistingId] = useState(
		selectedSessionId && sessions[selectedSessionId] ? selectedSessionId : (sessionList[0]?.id ?? ""),
	);
	const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
	const [workspacePath, setWorkspacePath] = useState(item.projectDir ?? currentProject ?? "");
	const [model, setModel] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void listWorkspaces()
			.then((ws) => {
				setWorkspaces(ws);
				setWorkspacePath((p) => p || ws[0]?.path || "");
			})
			.catch(() => {});
	}, []);

	const run = async () => {
		setBusy(true);
		setError(null);
		try {
			const prompt = await backlogBuildPrompt(item.id);
			let targetId = existingId;
			if (target === "new") {
				const info = await rpcStart({ cwd: workspacePath || ".", model: model.trim() || undefined });
				targetId = info.sessionId;
			} else if (!targetId) {
				throw new Error("请选择目标会话");
			}
			await dispatchPrompt(targetId, prompt);
			await backlogUpdate(item.id, { status: "dispatched", targetSessionId: targetId });
			await useBacklog.getState().load();
			toast.success("已派发给 Agent");
			onClose();
			selectSession(targetId);
		} catch (err) {
			const msg = errMsg(err);
			setError(msg);
			toast.error(`派发失败: ${msg}`);
		} finally {
			setBusy(false);
		}
	};

	// Workspace list may not contain the item's project dir; keep it selectable.
	const workspaceOptions =
		workspacePath && !workspaces.some((w) => w.path === workspacePath)
			? [{ path: workspacePath, name: workspacePath.split("/").pop() ?? workspacePath }, ...workspaces]
			: workspaces;

	const tabCls = (on: boolean) =>
		`rounded-lg border p-2.5 text-center font-medium ${
			on
				? "border-sky-500 bg-sky-500/10 text-sky-300"
				: "border-[var(--border-divider)] bg-[var(--bg)] text-[var(--text-dim)] hover:text-[var(--text)]"
		}`;

	return (
		<FloatingLayer
			anchor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
			placement="bottom-start"
			layer="modal"
			onDismiss={() => {
				if (!busy) onClose();
			}}
			className="w-[460px] max-w-[90vw] -translate-x-1/2 -translate-y-1/2 p-5 shadow-apple-modal"
		>
			<div className="space-y-4 text-xs">
				<div className="flex items-center justify-between border-b border-[var(--border-divider)] pb-2.5">
					<div className="flex items-center gap-2">
						<Send className="h-4 w-4 text-sky-400" />
						<h3 className="text-sm font-semibold text-[var(--text)]">派发给 Agent</h3>
					</div>
					<button type="button" disabled={busy} onClick={onClose} className="rounded p-1 text-[var(--text-dim)] hover:text-[var(--text)]">
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="rounded-lg bg-[var(--bg)] p-3 text-[var(--text-dim)]">
					<span className="font-medium text-[var(--text)]">任务内容:</span> {item.text}
				</div>
				<div className="grid grid-cols-2 gap-2">
					<button type="button" onClick={() => setTarget("existing")} className={tabCls(target === "existing")}>
						现有会话
					</button>
					<button type="button" onClick={() => setTarget("new")} className={tabCls(target === "new")}>
						开启新会话
					</button>
				</div>
				{target === "existing" ? (
					<div className="space-y-1.5">
						<label className="text-[var(--text-dim)]">选择会话</label>
						<NativeSelect value={existingId} onChange={(e) => setExistingId(e.target.value)} className="w-full">
							{sessionList.map((s) => (
								<option key={s.id} value={s.id}>
									{s.title || s.id}
								</option>
							))}
						</NativeSelect>
					</div>
				) : (
					<div className="space-y-3">
						<div className="space-y-1.5">
							<label className="text-[var(--text-dim)]">工作区目录</label>
							<NativeSelect value={workspacePath} onChange={(e) => setWorkspacePath(e.target.value)} className="w-full">
								{workspaceOptions.map((w) => (
									<option key={w.path} value={w.path}>
										{w.name} ({w.path})
									</option>
								))}
							</NativeSelect>
						</div>
						<div className="space-y-1.5">
							<label className="text-[var(--text-dim)]">指定模型 (可选)</label>
							<input
								value={model}
								onChange={(e) => setModel(e.target.value)}
								placeholder="留空使用默认模型"
								className="w-full rounded-lg border border-[var(--border-divider)] bg-[var(--bg)] px-3 py-1.5 text-[var(--text)] focus:border-sky-500 focus:outline-none"
							/>
						</div>
					</div>
				)}
				{error && <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-300">{error}</div>}
				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-2">
					<button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-1.5 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
						取消
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void run()}
						className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
					>
						{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						确认派发
					</button>
				</div>
			</div>
		</FloatingLayer>
	);
}
