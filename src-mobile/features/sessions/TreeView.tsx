import {
	Archive,
	ChevronDown,
	ChevronRight,
	Folder,
	FolderPlus,
	FolderSearch,
	GitBranch,
	GitFork,
	Pin,
	Plus,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api, errorMessage } from "../../core/api";
import { Spinner, toast } from "../../ui";
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

const ICONS: Record<HeaderIcon, ReactNode> = {
	pin: <Pin size={16} />,
	folder: <Folder size={16} />,
	branch: <GitBranch size={16} />,
	worktree: <GitFork size={16} />,
	archive: <Archive size={16} />,
	unassigned: <FolderSearch size={16} />,
	deleted: <GitFork size={16} />,
};

const pill = "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-m-pill px-2 text-m-xs font-medium";

/** Status bubbles shown on COLLAPSED headers only (desktop `StatusBubbles`). */
function Bubbles({ c }: { c: StatusCounts }) {
	return (
		<span className="flex shrink-0 items-center gap-1">
			{c.working > 0 && (
				<span className={`${pill} bg-m-surface-2 text-m-accent`} title={`${c.working} 个运行中会话`}>
					<span className="size-2 animate-pulse rounded-full bg-m-accent" />
					{c.working}
				</span>
			)}
			{c.awaiting > 0 && (
				<span className={`${pill} bg-m-surface-2 text-m-warn`} title={`${c.awaiting} 个待回复会话`}>
					{c.awaiting} 待回复
				</span>
			)}
			{c.unread > 0 && (
				<span className={`${pill} bg-m-surface-2 text-m-success`} title={`${c.unread} 个未读会话`}>
					<span className="size-2 rounded-full bg-m-success" />
					{c.unread}
				</span>
			)}
			{c.error > 0 && (
				<span className={`${pill} bg-m-surface-2 text-m-danger`} title={`${c.error} 个异常或中断会话`}>
					<span className="size-2 rounded-full bg-m-danger" />
					{c.error}
				</span>
			)}
		</span>
	);
}

const actBtn =
	"flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-m-pill border border-m-border bg-m-surface text-m-text-2 active:bg-m-surface-hover";

function runActionDefault(a: HeaderAction): void {
	if (a.kind === "plus") void newSessionIn(a.cwd);
	else if (a.kind === "archive") void batchArchive(a.title, useTree.getState().scopes[a.scope] ?? []);
	else void addWorkspace(a.cwd, a.label);
}

const HeaderView = memo(
	function HeaderView({ row, onAction }: { row: HeaderRow; onAction?: (a: HeaderAction) => void }) {
		const sec = row.level === "sec";
		return (
			<div
				className={`flex min-h-12 items-center border-b border-m-border ${sec ? "bg-m-bg" : "bg-m-bg"} ${row.dim ? "opacity-80" : ""}`}
				style={{ paddingLeft: 4 + row.depth * 12 }}
			>
				<button
					type="button"
					aria-expanded={row.open}
					onClick={() => useTree.getState().toggle(row.key, row.open)}
					className="flex min-h-12 min-w-0 flex-1 items-center gap-2 pr-2 text-left active:bg-m-surface-hover"
				>
					<span className="flex size-6 shrink-0 items-center justify-center text-m-text-3">
						{row.open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
					</span>
					<span className="flex shrink-0 text-m-text-2">{ICONS[row.icon]}</span>
					<span className="min-w-0 flex-1">
						<span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							<span className={`break-words ${sec ? "text-m-md font-semibold" : "text-m-sm font-medium"} text-m-text`}>
								{row.title}
							</span>
							{row.tags.map((t) => (
								<span key={t} className={`${pill} bg-m-surface text-m-text-3`}>
									{t}
								</span>
							))}
						</span>
						{row.hint && <span className="block break-all text-m-xs text-m-text-3">{row.hint}</span>}
					</span>
					{row.count != null && (
						<span className={`${pill} bg-m-surface text-m-text-2`}>{row.count}</span>
					)}
					{row.bubbles && <Bubbles c={row.bubbles} />}
				</button>
				<span className="flex shrink-0 items-center gap-1 pr-2">
					{row.actions.map((a) => (
						<button
							key={a.kind}
							type="button"
							aria-label={a.kind === "plus" ? `在 ${a.label} 新建会话` : a.kind === "addws" ? `将 ${a.cwd} 添加为工作区` : a.label}
							onClick={() => (onAction ? onAction(a) : runActionDefault(a))}
							className={actBtn}
						>
							{a.kind === "plus" ? <Plus size={18} /> : a.kind === "archive" ? <Archive size={18} /> : <FolderPlus size={18} />}
						</button>
					))}
				</span>
			</div>
		);
	},
	(a, b) => rowEqual(a.row, b.row) && a.onAction === b.onAction,
);

const textBtn =
	"inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-m-pill border border-m-border bg-m-surface px-3 text-m-sm text-m-text-2 active:bg-m-surface-hover";

const MoreView = memo(
	function MoreView({ row }: { row: Extract<FlatRow, { t: "more" }> }) {
		return (
			<div className="flex items-center justify-center gap-2 py-1" style={{ paddingLeft: row.depth * 12 }}>
				{row.expandText && (
					<button type="button" className={textBtn} onClick={() => useTree.getState().expand(row.moreKey, row.expandTo)}>
						<Plus size={14} />
						{row.expandText}
					</button>
				)}
				{row.collapse && (
					<button type="button" className={textBtn} onClick={() => useTree.getState().collapseMore(row.moreKey)}>
						收起
					</button>
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
		label: <span className="break-all">{d.label || d.path}</span>,
		run: () => void assignToWorkspace(sessions ?? [], d.workspaceId ?? ""),
	}));
	return (
		<ActionSheet
			open={sessions !== null && dirs !== null && dirs.length > 0}
			title={`归入工作区（${sessions?.length ?? 0} 个会话）`}
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

	useEffect(() => {
		if (flat) useTree.getState().setScopes(flat.scopes);
	}, [flat]);

	if (error && !data) return <div className="p-8 text-center text-m-sm text-m-danger">加载失败：{error}</div>;
	if (!data)
		return (
			<div className="flex items-center justify-center gap-2 p-8 text-m-sm text-m-text-3">
				<Spinner size={18} />
				加载中
			</div>
		);
	if (!flat) return null;
	if (!flat.rows.length)
		return <div className="p-8 text-center text-m-sm text-m-text-3">{emptyText ?? (searching ? "没有匹配的会话" : "没有会话")}</div>;

	return (
		<div>
			{flat.rows.map((r) => {
				switch (r.t) {
					case "h":
						return (
							<HeaderView
								key={r.key}
								row={r}
								onAction={(a) => {
									if (a.kind === "plus") {
										setPlusTarget({ cwd: a.cwd, label: a.label });
									} else {
										runActionDefault(a);
									}
								}}
							/>
						);
					case "s":
						return <SessionRow key={r.key} s={r.s} depth={r.depth} current={r.current} onMore={onMore} onOpen={onOpen} />;
					case "more":
						return <MoreView key={r.key} row={r} />;
					case "gap":
						return (
							<div
								key={r.key}
								aria-hidden
								className="flex items-center gap-2 py-1 text-m-xs text-m-text-3"
								style={{ paddingLeft: 12 + r.depth * 12, paddingRight: 12 }}
							>
								<span className="h-px flex-1 bg-m-border" />
								<span className="whitespace-nowrap">{r.skipped} 条未显示</span>
								<span className="h-px flex-1 bg-m-border" />
							</div>
						);
					case "none":
						return (
							<div key={r.key} className="py-3 text-m-sm text-m-text-3" style={{ paddingLeft: 16 + r.depth * 12 }}>
								{r.text}
							</div>
						);
					case "ubar":
						return (
							<div key={r.key} className="flex flex-wrap items-center justify-center gap-2 py-2">
								<button
									type="button"
									className={textBtn}
									onClick={() => void batchArchive("未归入工作区", useTree.getState().scopes[r.scope] ?? [])}
								>
									<Archive size={14} />
									全部归档 ({r.total})
								</button>
								<button
									type="button"
									className={textBtn}
									onClick={() => setAssigning(useTree.getState().scopes[r.scope] ?? [])}
								>
									<FolderPlus size={14} />
									归入工作区
								</button>
							</div>
						);
				}
			})}
			<AssignSheet sessions={assigning} onClose={() => setAssigning(null)} />
			<ActionSheet
				open={plusTarget !== null}
				title={plusTarget ? `在「${plusTarget.label}」新建会话` : "新建会话"}
				onClose={() => setPlusTarget(null)}
				items={
					plusTarget
						? [
								{
									key: "current",
									label: (
										<span className="flex items-center gap-2">
											<Folder size={18} />
											在当前目录创建
										</span>
									),
									run: () => void newSessionIn(plusTarget.cwd),
								},
								{
									key: "worktree",
									label: (
										<span className="flex items-center gap-2">
											<GitFork size={18} />
											在独立工作树创建
										</span>
									),
									run: async () => {
										const target = plusTarget;
										try {
											const res = await api<{ dirs: DirEntry[] }>("GET", "/left/dirs");
											const all = res.dirs ?? [];
											const matching = all.filter((d) => d.kind === "worktree" && d.path.startsWith(target.cwd));
											if (matching.length === 1) {
												void newSessionIn(matching[0].path);
											} else if (matching.length > 1) {
												setWtChoices(matching);
											} else {
												toast("该工作区暂无已检出的独立工作树，已在当前目录创建", { kind: "info" });
												void newSessionIn(target.cwd);
											}
										} catch (e) {
											toast(`创建失败：${errorMessage(e)}`, { kind: "error" });
										}
									},
								},
							]
						: []
				}
			/>
			<ActionSheet
				open={wtChoices !== null}
				title="选择工作树"
				onClose={() => setWtChoices(null)}
				items={
					wtChoices
						? wtChoices.map((w) => ({
								key: w.path,
								label: (
									<span className="flex items-center gap-2">
										<GitBranch size={18} />
										{w.label || w.path}
									</span>
								),
								run: () => void newSessionIn(w.path),
							}))
						: []
				}
			/>
		</div>
	);
}
