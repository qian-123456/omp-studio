import {
	Archive,
	ChevronRight,
	Folder,
	FolderPlus,
	FolderSearch,
	GitBranch,
	GitFork,
	Pin,
	Plus,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, errorMessage } from "../../core/api";
import { Button, Chip, IconButton, Spinner, toast } from "../../ui";
import { ActionSheet } from "./ActionSheets";
import { addWorkspace, assignToWorkspace, batchArchive, newSessionIn } from "./actions";
import { SessionRow } from "./SessionRow";
import {
	flattenTree,
	filterTree,
	rowEqual,
	type DirEntry,
	type FlatRow,
	type HeaderAction,
	type HeaderIcon,
	type HeaderRow,
	type StatusCounts,
	type TreeSession,
} from "./tree";
import { useTree } from "./treeStore";

const I = { size: 20, strokeWidth: 1.75 } as const;
const ICONS: Record<HeaderIcon, ReactNode> = {
	pin: <Pin {...I} />,
	folder: <Folder {...I} />,
	branch: <GitBranch {...I} />,
	worktree: <GitFork {...I} />,
	archive: <Archive {...I} />,
	unassigned: <FolderSearch {...I} />,
	deleted: <GitFork {...I} />,
};

/** Status chips shown on COLLAPSED headers only (desktop `StatusBubbles`). */
function Bubbles({ c }: { c: StatusCounts }) {
	return (
		<>
			{c.working > 0 && (
				<Chip tone="accent" icon={<span className="m-pulse size-1.5 rounded-m-pill bg-current" />}>
					{c.working} 运行中
				</Chip>
			)}
			{c.awaiting > 0 && <Chip tone="warn">{c.awaiting} 待回复</Chip>}
			{c.error > 0 && <Chip tone="danger">{c.error} 出错</Chip>}
			{c.unread > 0 && <Chip tone="success">{c.unread} 未读</Chip>}
		</>
	);
}

function runActionDefault(a: HeaderAction): void {
	if (a.kind === "plus") void newSessionIn(a.cwd);
	else if (a.kind === "archive") void batchArchive(a.title, useTree.getState().scopes[a.scope] ?? []);
	else void addWorkspace(a.cwd, a.label);
}

const HeaderView = memo(
	function HeaderView({ row, onAction }: { row: HeaderRow; onAction?: (a: HeaderAction) => void }) {
		const sec = row.level === "sec";
		const chips = row.tags.length > 0 || row.bubbles != null;
		return (
			<div
				className={`flex items-start gap-1 pr-2 ${sec ? "pt-2" : ""} ${row.dim ? "opacity-70" : ""}`}
				style={{ paddingLeft: 8 + row.depth * 16 }}
			>
				<button
					type="button"
					aria-expanded={row.open}
					onClick={() => useTree.getState().toggle(row.key, row.open)}
					className="flex min-h-12 min-w-0 flex-1 items-start gap-3 rounded-m-md px-3 py-2.5 text-left transition-colors duration-(--m-dur-fast) active:bg-m-surface-hover"
				>
					<span className="flex h-[22px] w-5 shrink-0 items-center justify-center text-m-text-2">{ICONS[row.icon]}</span>
					<span className="min-w-0 flex-1">
						<span className="flex items-start gap-1.5">
							<span className={`min-w-0 break-words text-m-text ${sec ? "text-m-md font-medium" : "text-m-sm"}`}>{row.title}</span>
							{row.count != null && (
								<Chip>{row.count}</Chip>
							)}
							<ChevronRight
								size={16}
								strokeWidth={1.75}
								aria-hidden
								className={`mt-[3px] shrink-0 text-m-text-3 transition-transform duration-(--m-dur-fast) ${row.open ? "rotate-90" : ""}`}
							/>
						</span>
						{row.hint && <span className="mt-0.5 block text-m-xs break-all text-m-text-3">{row.hint}</span>}
						{chips && (
							<span className="mt-1.5 flex flex-wrap gap-1.5">
								{row.tags.map((t) => (
									<Chip key={t}>{t}</Chip>
								))}
								{row.bubbles && <Bubbles c={row.bubbles} />}
							</span>
						)}
					</span>
				</button>
				{row.actions.length > 0 && (
					<span className="flex shrink-0 items-center pt-0.5">
						{row.actions.map((a) => (
							<IconButton
								key={a.kind}
								size="sm"
								variant={a.kind === "plus" ? "filled" : "plain"}
								label={a.kind === "plus" ? `在 ${a.label} 新建会话` : a.kind === "addws" ? `将 ${a.cwd} 添加为工作区` : a.label}
								onClick={() => (onAction ? onAction(a) : runActionDefault(a))}
								icon={
									a.kind === "plus" ? (
										<Plus size={20} strokeWidth={1.75} />
									) : a.kind === "archive" ? (
										<Archive size={18} strokeWidth={1.75} className="text-m-text-2" />
									) : (
										<FolderPlus size={18} strokeWidth={1.75} className="text-m-text-2" />
									)
								}
							/>
						))}
					</span>
				)}
			</div>
		);
	},
	(a, b) => rowEqual(a.row, b.row) && a.onAction === b.onAction,
);

const MoreView = memo(
	function MoreView({ row }: { row: Extract<FlatRow, { t: "more" }> }) {
		return (
			<div className="flex flex-wrap items-center gap-2 py-1.5 pr-4" style={{ paddingLeft: 20 + row.depth * 16 }}>
				{row.expandText && (
					<Button size="sm" className="min-h-11" variant="tonal" onClick={() => useTree.getState().expand(row.moreKey, row.expandTo)}>
						{row.expandText}
					</Button>
				)}
				{row.collapse && (
					<Button size="sm" className="min-h-11" variant="ghost" onClick={() => useTree.getState().collapseMore(row.moreKey)}>
						收起
					</Button>
				)}
			</div>
		);
	},
	(a, b) => rowEqual(a.row, b.row),
);

function AssignSheet({ sessions, onClose }: { sessions: TreeSession[] | null; onClose: () => void }) {
	const mode = useTree((s) => s.mode);
	const [dirs, setDirs] = useState<DirEntry[] | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	useEffect(() => {
		if (!sessions) return;
		let alive = true;
		setDirs(null);
		setFailed(null);
		api<{ dirs: DirEntry[] }>("GET", "/left/dirs")
			.then((r) => alive && setDirs((r.dirs ?? []).filter((d) => d.kind === "workspace" && d.mode === mode)))
			.catch((e) => alive && setFailed(errorMessage(e)));
		return () => {
			alive = false;
		};
	}, [sessions, mode]);
	useEffect(() => {
		if (sessions && failed) {
			toast(`加载工作区失败：${failed}`, { kind: "error" });
			onClose();
		} else if (sessions && dirs && dirs.length === 0) {
			toast("当前空间还没有工作区");
			onClose();
		}
	}, [sessions, failed, dirs, onClose]);
	const items = (dirs ?? []).map((d) => ({
		key: d.path,
		icon: <Folder {...I} />,
		label: d.label || d.path,
		hint: d.label ? <span className="break-all">{d.path}</span> : undefined,
		run: () => void assignToWorkspace(sessions ?? [], d.workspaceId ?? ""),
	}));
	return (
		<ActionSheet
			open={sessions !== null && dirs !== null && dirs.length > 0}
			title="归入工作区"
			subtitle={`${sessions?.length ?? 0} 个会话`}
			items={items}
			onClose={onClose}
		/>
	);
}

/** The grouped tree for the current mode, flattened into memoized rows. */
export function TreeView({
	searching = false,
	filterIds = null,
	onMore,
	onOpen,
	curId,
	emptyText,
}: {
	searching?: boolean;
	filterIds?: ReadonlySet<string> | null;
	onMore: (s: TreeSession) => void;
	onOpen?: (s: TreeSession) => void;
	curId?: string | null;
	emptyText?: string;
}) {
	const data = useTree((s) => s.data);
	const error = useTree((s) => s.error);
	const open = useTree((s) => s.open);
	const expanded = useTree((s) => s.expanded);
	const [assigning, setAssigning] = useState<TreeSession[] | null>(null);
	const [plusTarget, setPlusTarget] = useState<{ cwd: string; label: string } | null>(null);
	const [wtChoices, setWtChoices] = useState<DirEntry[] | null>(null);
	const flat = useMemo(() => {
		if (!data) return null;
		if (searching && !filterIds) return null;
		const d = searching && filterIds ? filterTree(data, filterIds) : data;
		return flattenTree(d, { searching, open, expanded, curId });
	}, [data, searching, filterIds, open, expanded, curId]);
	// Stable so memoized header rows do not re-render on every parent render.
	const onAction = useCallback((a: HeaderAction) => {
		if (a.kind === "plus") setPlusTarget({ cwd: a.cwd, label: a.label });
		else runActionDefault(a);
	}, []);

	useEffect(() => {
		if (flat) useTree.getState().setScopes(flat.scopes);
	}, [flat]);

	const newInWorktree = async (target: { cwd: string; label: string }) => {
		try {
			const res = await api<{ dirs: DirEntry[] }>("GET", "/left/dirs");
			const project = data?.workspaceGroups.find((g) =>
				g.workspace.path === target.cwd || g.subgroups.some((s) => (s.createCwd ?? s.path) === target.cwd),
			);
			// Worktrees may live anywhere on disk; only the registered workspace owns them.
			const matching = (res.dirs ?? []).filter((d) => d.kind === "worktree" &&
				project != null && d.workspaceId === project.workspace.id);
			if (matching.length === 1) void newSessionIn(matching[0].path);
			else if (matching.length > 1) setWtChoices(matching);
			else toast("这个项目还没有独立工作树，请先在电脑端创建", { kind: "info" });
		} catch (e) {
			toast(`新建失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	if (error && !data) return <div role="alert" className="flex flex-col items-center gap-4 px-6 py-10 text-center"><p className="m-selectable text-m-sm break-words text-m-danger">加载失败：{error}</p><Button onClick={() => void useTree.getState().load()}>重试</Button></div>;
	if (!data)
		return (
			<div className="flex items-center justify-center gap-2 px-6 py-10 text-m-sm text-m-text-3">
				<Spinner size={18} />
				加载中
			</div>
		);
	if (!flat) return null;
	if (!flat.rows.length && !error)
		return <div className="px-6 py-10 text-center text-m-sm text-m-text-3">{emptyText ?? (searching ? "没有匹配的会话" : "这个空间还没有会话")}</div>;

	return (
		<div className="pb-2">
			{error && <div role="alert" className="flex flex-col items-center gap-3 px-6 py-4 text-center"><p className="m-selectable text-m-sm break-words text-m-danger">刷新失败：{error}</p><Button onClick={() => void useTree.getState().load()}>重试</Button></div>}
			{flat.rows.map((r) => {
				switch (r.t) {
					case "h":
						return <HeaderView key={r.key} row={r} onAction={onAction} />;
					case "s":
						return <SessionRow key={r.key} s={r.s} depth={r.depth} current={r.current} onMore={onMore} onOpen={onOpen} />;
					case "more":
						return <MoreView key={r.key} row={r} />;
					case "gap":
						return (
							<div
								key={r.key}
								aria-hidden
								className="flex items-center gap-3 py-1 text-m-xs text-m-text-3"
								style={{ paddingLeft: 20 + r.depth * 16, paddingRight: 20 }}
							>
								<span className="h-px flex-1 bg-m-border" />
								<span className="whitespace-nowrap">另有 {r.skipped} 条</span>
								<span className="h-px flex-1 bg-m-border" />
							</div>
						);
					case "none":
						return (
							<div key={r.key} className="py-2.5 text-m-sm text-m-text-3" style={{ paddingLeft: 20 + r.depth * 16 }}>
								{r.text}
							</div>
						);
					case "ubar":
						return (
							<div key={r.key} className="flex flex-wrap items-center gap-2 py-2 pr-4" style={{ paddingLeft: 20 + r.depth * 16 }}>
								<Button
									size="sm"
									className="min-h-11"
									variant="tonal"
									icon={<Archive size={16} strokeWidth={1.75} />}
									onClick={() => void batchArchive("未归入工作区", useTree.getState().scopes[r.scope] ?? [])}
								>
									全部归档（{r.total}）
								</Button>
								<Button
									size="sm"
									className="min-h-11"
									variant="tonal"
									icon={<FolderPlus size={16} strokeWidth={1.75} />}
									onClick={() => setAssigning(useTree.getState().scopes[r.scope] ?? [])}
								>
									归入工作区
								</Button>
							</div>
						);
				}
			})}
			<AssignSheet sessions={assigning} onClose={() => setAssigning(null)} />
			<ActionSheet
				open={plusTarget !== null}
				title="新建会话"
				subtitle={plusTarget?.label}
				onClose={() => setPlusTarget(null)}
				items={
					plusTarget
						? [
								{
									key: "current",
									icon: <Folder {...I} />,
									label: "在当前目录新建",
									hint: <span className="break-all">{plusTarget.cwd}</span>,
									run: () => void newSessionIn(plusTarget.cwd),
								},
								{
									key: "worktree",
									icon: <GitFork {...I} />,
									label: "在独立工作树新建",
									hint: "使用已存在的工作树；新的工作树请先在电脑端创建",
									run: () => void newInWorktree(plusTarget),
								},
							]
						: []
				}
			/>
			<ActionSheet
				open={wtChoices !== null}
				title="选择工作树"
				onClose={() => setWtChoices(null)}
				items={(wtChoices ?? []).map((w) => ({
					key: w.path,
					icon: <GitBranch {...I} />,
					label: w.label || w.path,
					hint: <span className="break-all">{w.path}</span>,
					run: () => void newSessionIn(w.path),
				}))}
			/>
		</div>
	);
}
