import clsx from "clsx";
import {
	ArrowDownUp,
	ChevronDown,
	ChevronRight,
	Copy,
	FileDiff,
	FolderGit2,
	FolderOpen,
	GitBranch,
	GitCommitHorizontal,
	GitMerge,
	GitPullRequest,
	Info,
	Loader2,
	MoreHorizontal,
	Plus,
	RefreshCw,
	SquareTerminal,
	Trash2,
	Undo2,
	Waypoints,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type Anchor, FloatingLayer } from "../../components/FloatingLayer";
import type { ServiceInfo, WorktreeInfo } from "../../lib/contracts";
import { createSession } from "../../lib/createSession";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	addWorkspace,
	gitCreateWorktree,
	gitDiffBase,
	gitDiscardAll,
	gitGetPrUrl,
	gitListBranches,
	gitMergeBranch,
	gitMergePreview,
	gitRebaseOntoBase,
	gitSyncBranch,
	gitSyncWithBase,
	servicesList,
	updateSessionMeta,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useExplorer } from "../../stores/explorer";
import { useSessions } from "../../stores/sessions";
import { useSettings } from "../../features/settings/store";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { addTerminalTabWithCwd } from "../terminal/terminalTabs";
import { startSessionInWorktree } from "../sessions/newSession";
import { defaultSlug } from "./helpers";
import { OrphanBadge, OrphanInlinePanel, useOrphans } from "./OrphanBadge";
import { removeWorktreeFlow } from "./removeWorktree";
import { type MenuEntry, WorktreeActionMenu } from "./WorktreeActionMenu";
import { WorktreeCommitPopover } from "./WorktreeCommitPopover";
import { WorktreeHoverCard, useHeadCommit, ago } from "./WorktreeHoverCard";

const CONFLICT_PREFIX = "CONFLICT:";

/** Conflicting paths from a backend `CONFLICT:`-prefixed error, or null for other errors. */
function conflictFiles(e: unknown): string[] | null {
	const msg = errMsg(e);
	if (!msg.startsWith(CONFLICT_PREFIX)) return null;
	return msg
		.slice(CONFLICT_PREFIX.length)
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
}

/** A git operation the AI conflict session must run itself (nothing has been run yet). */
interface ConflictOp {
	/** Human description, e.g. "把 main 合并进 feat-x". */
	desc: string;
	/** Exact command the agent should run inside the worktree. */
	command: string;
	/** How to finish once conflicts are resolved. */
	finish: string;
}

export function WorktreeSection({
	repo,
	worktrees,
	current,
	selected,
	selectedExplicit = true,
	onSelect,
	onChanged,
	onOpenPane,
	onDiff,
}: {
	repo: string;
	worktrees: WorktreeInfo[];
	current: string;
	selected: string;
	selectedExplicit?: boolean;
	onSelect: (path: string) => void;
	onChanged: () => void;
	onOpenPane: (path: string, tab: "changes" | "history") => void;
	onDiff: (req: { title: string; load: () => Promise<string> }) => void;
}) {
	const openModal = useUi((s) => s.openModal);
	const selectSession = useUi((s) => s.selectSession);
	const setRightTab = useUi((s) => s.setRightTab);
	const setExplorerWorkspace = useExplorer((s) => s.setWorkspaceId);
	const sessions = useSessions((s) => s.sessions);
	const workspaces = useSessions((s) => s.workspaces);
	const deliveryMode = useSettings((s) => s.settings?.gitDeliveryMode ?? "pr");

	const [services, setServices] = useState<ServiceInfo[]>([]);
	const [showCreate, setShowCreate] = useState(false);
	const [newWtName, setNewWtName] = useState("");
	const [creating, setCreating] = useState(false);
	const [busyPath, setBusyPath] = useState<string | null>(null);
	const [sessionMenuWt, setSessionMenuWt] = useState<string | null>(null);
	const [sessionMenuAnchor, setSessionMenuAnchor] = useState<HTMLElement | null>(null);
	const [menu, setMenu] = useState<{ path: string; anchor: Anchor } | null>(null);
	const [branchPick, setBranchPick] = useState<{
		path: string;
		anchor: Anchor;
		branches: string[];
	} | null>(null);
	const [commitFor, setCommitFor] = useState<{ path: string; anchor: HTMLElement } | null>(
		null,
	);
	const [showIdle, setShowIdle] = useState(false);

	const [showOrphans, setShowOrphans] = useState(false);
	const orphanState = useOrphans(repo, onChanged);

	// WorktreeHoverCard state
	const [hoveredWt, setHoveredWt] = useState<WorktreeInfo | null>(null);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);

	const overlayOpen = menu !== null || branchPick !== null || commitFor !== null || sessionMenuWt !== null;

	useEscapeKey(() => {
		setSessionMenuWt(null);
		setShowCreate(false);
	});

	// Poll running dev services to extract live listening ports per worktree
	const loadServices = useCallback(async () => {
		try {
			const list = await servicesList(false);
			setServices(list);
		} catch {
			// ignore polling errors
		}
	}, []);

	useEffect(() => {
		void loadServices();
		const timer = window.setInterval(() => {
			void loadServices();
		}, 6000);
		return () => window.clearInterval(timer);
	}, [loadServices]);

	const dismissHover = () => {
		if (hoverTimer.current !== null) {
			window.clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		setHoveredWt(null);
		setAnchorRect(null);
	};

	// The hover card never coexists with an open menu/popover.
	useEffect(() => {
		if (overlayOpen) dismissHover();
	}, [overlayOpen]);

	const handleItemMouseEnter = (wt: WorktreeInfo, e: React.MouseEvent<HTMLElement>) => {
		if (overlayOpen) return;
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		const rect = e.currentTarget.getBoundingClientRect();
		hoverTimer.current = window.setTimeout(() => {
			setHoveredWt(wt);
			setAnchorRect(rect);
		}, 400);
	};

	const handleItemMouseLeave = () => {
		if (hoverTimer.current !== null) {
			window.clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		closeTimer.current = window.setTimeout(() => {
			dismissHover();
		}, 150);
	};

	// Same local base the backend resolves for history/ahead-behind: main, else master.
	const baseBranch =
		worktrees.find((w) => w.branch === "main")?.branch ??
		worktrees.find((w) => w.branch === "master")?.branch ??
		"main";

	const handleCreateWorktree = async () => {
		const name = newWtName.trim() || defaultSlug("worktree");
		setCreating(true);
		try {
			await gitCreateWorktree(repo, name);
			void useWorktrees.getState().refresh();
			toast.success(`已创建工作树：${name}`);
			setNewWtName("");
			setShowCreate(false);
			onChanged();
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setCreating(false);
		}
	};

	/** Runs a mutating row action with the row marked busy. */
	const runBusy = async (wt: WorktreeInfo, fn: () => Promise<void>) => {
		setBusyPath(wt.path);
		try {
			await fn();
		} finally {
			setBusyPath(null);
		}
	};

	const clean = (wt: WorktreeInfo) =>
		runBusy(wt, async () => {
			try {
				if (await removeWorktreeFlow(repo, wt)) {
					const sessionStore = useSessions.getState();
					for (const sid of wt.sessionIds) {
						try {
							const updated = await updateSessionMeta(sid, { archived: true });
							sessionStore.upsert([updated]);
						} catch {
							const cur = sessionStore.sessions[sid];
							if (cur) {
								sessionStore.upsert([{ ...cur, archived: true }]);
							}
						}
					}
					void useWorktrees.getState().refresh();
					toast.success("已清理工作树，并自动归档关联会话");
					onChanged();
				}
			} catch (e) {
				toast.error(errMsg(e));
			}
		});

	const openInExplorer = async (path: string) => {
		try {
			const ws = await addWorkspace(path);
			void useSessions.getState().refreshWorkspaces();
			setExplorerWorkspace(ws.id);
			setRightTab("explorer");
		} catch (e) {
			toast.error(`在侧边栏打开失败: ${errMsg(e)}`);
		}
	};

	const openTerminal = (wt: WorktreeInfo) => {
		const name = wt.branch ?? "worktree";
		addTerminalTabWithCwd(wt.path, name);
		setRightTab("terminal");
		toast.success(`已在「${name}」工作树打开终端`);
	};

	// Launch an AI session that performs the conflicting operation itself and resolves it.
	const launchAiConflictSession = async (wt: WorktreeInfo, op: ConflictOp, files: string[]) => {
		try {
			const targetWs = workspaces.find((w) => w.path === repo);
			const { sessionId, stub } = await createSession({
				cwd: wt.path,
				workspaceId: targetWs?.id,
			});
			useSessions.getState().upsert([stub]);
			useUi.getState().selectSession(sessionId);

			const fileList = files.length > 0 ? files.map((f) => `- ${f}`).join("\n") : "- （未列出具体文件）";
			const prompt = [
				`请在当前工作树（${wt.path}，分支 ${wt.branch ?? wt.head.slice(0, 7)}）中${op.desc}。`,
				`预检发现以下文件会产生冲突，这一步尚未执行，工作区里目前没有冲突标记：`,
				fileList,
				"",
				"请按顺序完成：",
				`1. 自己运行 \`${op.command}\`；`,
				"2. 结合两边的代码意图逐个解决冲突，不要简单丢弃任何一方的改动；",
				"3. 运行项目的测试 / 类型检查，确认通过；",
				`4. ${op.finish}`,
			].join("\n");
			useComposer.getState().setDraft(sessionId, prompt);
			useComposer.getState().focusComposer(sessionId);
			toast.success("已创建解冲突会话，提示词可在输入框随时调整");
		} catch (e) {
			toast.error(`启动解冲突会话失败: ${errMsg(e)}`);
		}
	};

	const offerConflictSession = async (wt: WorktreeInfo, op: ConflictOp, files: string[]) => {
		const ok = await confirmDialog(
			`${op.desc}会产生冲突：\n${files.join("\n") || "多个文件冲突"}\n\n仓库已保持原状。是否启动 AI 会话来执行该操作并解决冲突？`,
			{ title: "检测到冲突", okLabel: "✨ AI 辅助解冲突", cancelLabel: "取消" },
		);
		if (ok) await launchAiConflictSession(wt, op, files);
	};

	const mergeOp = (wt: WorktreeInfo, source: string): ConflictOp => ({
		desc: `把分支 ${source} 合并进 ${wt.branch}`,
		command: `git merge ${source}`,
		finish: "完成合并提交（git add 后 git commit）。",
	});

	/** Preview → confirm → merge `source` into the row's branch; shared by 从 main 同步 / 合并其他分支. */
	const mergeInto = async (wt: WorktreeInfo, source: string, title: string) => {
		const branch = wt.branch;
		if (!branch) return;
		await runBusy(wt, async () => {
			try {
				const preview = await gitMergePreview(repo, branch, source);
				if (preview.hasConflicts) {
					await offerConflictSession(wt, mergeOp(wt, source), preview.conflictingFiles);
					return;
				}
				if (preview.commitsAhead === 0) {
					toast.info(`「${branch}」已包含 ${source} 的全部提交`);
					return;
				}
				const ok = await confirmDialog(
					`将把 ${source} 的 ${preview.commitsAhead} 个新提交合并进「${branch}」，预检无冲突。确认合并？`,
					{ title, okLabel: "确认合并" },
				);
				if (!ok) return;
				await gitMergeBranch(wt.path, source);
				toast.success(`已把 ${source} 合并进「${branch}」`);
				onChanged();
			} catch (e) {
				const files = conflictFiles(e);
				if (files) await offerConflictSession(wt, mergeOp(wt, source), files);
				else toast.error(`合并失败: ${errMsg(e)}`);
			}
		});
	};

	const handleSyncAndMerge = (wt: WorktreeInfo) =>
		runBusy(wt, async () => {
			const branch = wt.branch;
			if (!branch) return;
			try {
				const preview = await gitMergePreview(repo, branch, baseBranch);
				if (preview.hasConflicts) {
					await offerConflictSession(wt, mergeOp(wt, baseBranch), preview.conflictingFiles);
					return;
				}
				const ok = await confirmDialog(
					[
						`将在本地依次执行两步（不涉及远端）：`,
						`1. 把 ${baseBranch} 的 ${preview.commitsAhead} 个新提交合并进「${branch}」；`,
						`2. 把本地 ${baseBranch} 快进到「${branch}」，带上它的 ${wt.ahead} 个提交。`,
						"",
						`若 ${baseBranch} 所在工作树有会被覆盖的未提交改动，第 2 步会被 git 拒绝。`,
					].join("\n"),
					{ title: `同步并合入 ${baseBranch}`, okLabel: "确认同步" },
				);
				if (!ok) return;
				const r = await gitSyncWithBase(wt.path);
				toast.success(
					`已同步并合入 ${baseBranch}：同步了 ${r.mergedFromBase} 个 ${baseBranch} 提交，${baseBranch} 快进了 ${r.fastForwarded} 个提交`,
				);
				onChanged();
			} catch (e) {
				const files = conflictFiles(e);
				if (files) await offerConflictSession(wt, mergeOp(wt, baseBranch), files);
				else toast.error(`同步并合入 ${baseBranch} 失败: ${errMsg(e)}`);
			}
		});

	const handleRebase = (wt: WorktreeInfo) =>
		runBusy(wt, async () => {
			const branch = wt.branch;
			if (!branch) return;
			const ok = await confirmDialog(
				`将把「${branch}」的 ${wt.ahead} 个提交变基到最新的 ${baseBranch} 之上。\n\n变基会重写该分支的提交历史；如果它已经推送到远端，之后需要强制推送（force push），协作者手里的旧历史会失效。`,
				{ title: `变基到 ${baseBranch}`, danger: true, okLabel: "确认变基" },
			);
			if (!ok) return;
			try {
				await gitRebaseOntoBase(wt.path);
				toast.success(`已把「${branch}」变基到 ${baseBranch}`);
				onChanged();
			} catch (e) {
				const files = conflictFiles(e);
				if (files) {
					await offerConflictSession(
						wt,
						{
							desc: `把分支 ${branch} 变基到 ${baseBranch}`,
							command: `git rebase ${baseBranch}`,
							finish: "每解决一轮冲突后 git add 并 git rebase --continue，直到变基完成。",
						},
						files,
					);
				} else toast.error(`变基失败: ${errMsg(e)}`);
			}
		});

	const handleDiscardAll = (wt: WorktreeInfo) =>
		runBusy(wt, async () => {
			const ok = await confirmDialog(
				`将丢弃「${wt.branch ?? wt.path}」的全部 ${wt.dirty} 处未提交改动（含未跟踪的新文件），此操作无法撤销。\n被 .gitignore 忽略的文件（如 node_modules、.env）会保留。`,
				{ title: "丢弃全部未提交改动", danger: true, okLabel: "确认丢弃" },
			);
			if (!ok) return;
			try {
				await gitDiscardAll(wt.path);
				toast.success("已丢弃全部未提交改动");
				onChanged();
			} catch (e) {
				toast.error(`丢弃失败: ${errMsg(e)}`);
			}
		});

	// Deliver to main: Mode A (GitHub PR) vs Mode B (Direct Merge)
	const handleDeliverToMain = async (wt: WorktreeInfo) => {
		const branchName = wt.branch;
		if (!branchName) return;

		if (deliveryMode === "direct") {
			const ok = await confirmDialog(
				`确认将工作树「${branchName}」合并入本地 ${baseBranch} 并推送到云端 origin/${baseBranch}？\n（这是直推模式，无需 PR 审查）`,
				{
					title: `直接合并入 ${baseBranch}`,
					danger: true,
					okLabel: "确认直接合并推送",
				},
			);
			if (!ok) return;
			await runBusy(wt, async () => {
				try {
					await gitSyncBranch(repo, branchName, "push");
					await gitMergeBranch(repo, branchName);
					toast.success(`已直接合并入 ${baseBranch}`);
					onChanged();
				} catch (e) {
					toast.error(`合并失败: ${errMsg(e)}`);
				}
			});
			return;
		}

		// Mode A: PR workflow
		await runBusy(wt, async () => {
			try {
				await gitSyncBranch(repo, branchName, "push");
				const prInfo = await gitGetPrUrl(repo, branchName, baseBranch);
				if (prInfo.prUrl) {
					await openUrl(prInfo.prUrl);
					toast.success("已在浏览器中打开 GitHub Pull Request 创建页");
				} else {
					toast.success(`已推送到云端 origin/${branchName}，未配置 GitHub 仓库链接`);
				}
			} catch (e) {
				toast.error(`交付/提 PR 失败: ${errMsg(e)}`);
			}
		});
	};

	const openBranchPicker = async (wt: WorktreeInfo, anchor: Anchor) => {
		try {
			const branches = (await gitListBranches(repo)).filter((b) => b !== wt.branch);
			if (branches.length === 0) {
				toast.info("没有其他可合并的分支");
				return;
			}
			setBranchPick({ path: wt.path, anchor, branches });
		} catch (e) {
			toast.error(`读取分支列表失败: ${errMsg(e)}`);
		}
	};

	const menuEntries = (wt: WorktreeInfo, anchor: Anchor): MenuEntry[] => {
		const isMainCheckout = wt.path === mainPath;
		const isBase = wt.branch === baseBranch;
		const branch = wt.branch;
		const busy = busyPath !== null && busyPath === wt.path;
		const branchOps = !!branch && !isBase;
		const entries: MenuEntry[] = [];
		if (branchOps) {
			entries.push(
				{
					key: "sync-from-base",
					label: `从 ${baseBranch} 同步`,
					icon: <GitMerge size={12} />,
					title: `把 ${baseBranch} 的最新提交合并进此工作树（带冲突预检）`,
					disabled: busy,
					onSelect: () => void mergeInto(wt, baseBranch, `从 ${baseBranch} 同步更新`),
				},
				{
					key: "sync-and-merge",
					label: `同步并合入 ${baseBranch}`,
					icon: <ArrowDownUp size={12} />,
					title: `先合入 ${baseBranch}，再把本地 ${baseBranch} 快进到此分支；仅本地，不推送`,
					disabled: busy || wt.dirty > 0,
					onSelect: () => void handleSyncAndMerge(wt),
				},
				{
					key: "merge-other",
					label: "合并其他分支进来…",
					icon: <Waypoints size={12} />,
					disabled: busy,
					onSelect: () => void openBranchPicker(wt, anchor),
				},
				{
					key: "rebase",
					label: `变基到 ${baseBranch}`,
					icon: <RefreshCw size={12} />,
					title: "重写此分支历史；已推送过则需要强制推送",
					danger: true,
					disabled: busy || wt.dirty > 0,
					onSelect: () => void handleRebase(wt),
				},
				{
					key: "deliver",
					label: deliveryMode === "direct" ? `交付（直接合并入 ${baseBranch}）` : "交付/提PR",
					icon: <GitPullRequest size={12} />,
					disabled: busy,
					onSelect: () => void handleDeliverToMain(wt),
				},
			);
		}
		entries.push("separator");
		if (branch && !isBase) {
			entries.push({
				key: "diff-base",
				label: `查看相对 ${baseBranch} 的总 diff`,
				icon: <FileDiff size={12} />,
				onSelect: () =>
					onDiff({
						title: `${branch} 相对 ${baseBranch} 的全部提交改动`,
						load: () => gitDiffBase(wt.path),
					}),
			});
		}
		entries.push(
			{
				key: "terminal",
				label: "在此工作树打开终端",
				icon: <SquareTerminal size={12} />,
				onSelect: () => openTerminal(wt),
			},
			{
				key: "explorer",
				label: "在文件管理器打开",
				icon: <FolderOpen size={12} />,
				onSelect: () => void openInExplorer(wt.path),
			},
			{
				key: "copy-path",
				label: "复制路径",
				icon: <Copy size={12} />,
				onSelect: () => void copyText(wt.path).then(() => toast.success("已复制工作树路径")),
			},
		);
		if (branch) {
			entries.push({
				key: "copy-branch",
				label: "复制分支名",
				icon: <GitBranch size={12} />,
				onSelect: () => void copyText(branch).then(() => toast.success("已复制分支名")),
			});
		}
		entries.push("separator");
		if (wt.dirty > 0) {
			entries.push({
				key: "discard",
				label: `丢弃全部未提交改动（${wt.dirty}）`,
				icon: <Undo2 size={12} />,
				danger: true,
				disabled: busy,
				onSelect: () => void handleDiscardAll(wt),
			});
		}
		if (!isMainCheckout) {
			entries.push({
				key: "remove",
				label: "删除工作树",
				icon: <Trash2 size={12} />,
				danger: true,
				disabled: busy,
				onSelect: () => void clean(wt),
			});
		}
		return entries;
	};

	const mainPath = worktrees[0]?.path;

	// Attribute each service to the most specific (longest-path) worktree containing
	// its cwd. Linked worktrees live under the main checkout (`<repo>/.worktrees/<name>`),
	// so a plain prefix match would also credit every child worktree's port to main.
	const servicesByWorktree = new Map<string, ServiceInfo[]>();
	for (const s of services) {
		const cwd = s.cwd;
		if (!cwd) continue;
		let owner: string | null = null;
		for (const w of worktrees) {
			if (cwd !== w.path && !cwd.startsWith(`${w.path}/`)) continue;
			if (owner === null || w.path.length > owner.length) owner = w.path;
		}
		if (owner === null) continue;
		const list = servicesByWorktree.get(owner) ?? [];
		if (!list.some((x) => x.port === s.port)) list.push(s);
		servicesByWorktree.set(owner, list);
	}

	const isIdle = (wt: WorktreeInfo) =>
		wt.sessionIds.length === 0 &&
		wt.branch !== baseBranch &&
		wt.path !== mainPath &&
		wt.path !== current &&
		wt.path !== selected;
	const activeWts = worktrees.filter((w) => !isIdle(w));
	const idleWts = worktrees.filter(isIdle);

	const renderRow = (wt: WorktreeInfo, idle = false) => {
		const isCurrent = wt.path === current;
		const isSelected = wt.path === selected && selectedExplicit;
		const isBusy = busyPath === wt.path;
		const rowOverlay =
			menu?.path === wt.path || commitFor?.path === wt.path || branchPick?.path === wt.path;
		const uniquePorts = (servicesByWorktree.get(wt.path) ?? []).map((s) => s.port);
		const displayName = wt.branch ?? `分离 HEAD · ${wt.head.slice(0, 7)}`;
		const label = wt.branch ?? wt.path;
		const isBase = wt.branch === baseBranch;
		const showSync = !idle && !isBase && (wt.ahead > 0 || wt.behind > 0);
		const syncTitle = [
			wt.ahead > 0 &&
				`领先 ${baseBranch} ${wt.ahead} 个提交：这些提交还没进入 ${baseBranch}，可「${deliveryMode === "direct" ? "交付" : "交付/提PR"}」或「同步并合入 ${baseBranch}」`,
			wt.behind > 0 &&
				`落后 ${baseBranch} ${wt.behind} 个提交：${baseBranch} 有新提交而此分支没有，建议「从 ${baseBranch} 同步」`,
		]
			.filter(Boolean)
			.join("\n");
		const hasMeta =
			idle ||
			wt.dirty > 0 ||
			showSync ||
			uniquePorts.length > 0 ||
			wt.sessionIds.length > 0;

		const openMenuAt = (anchor: Anchor) => {
			dismissHover();
			setSessionMenuWt(null);
			setMenu({ path: wt.path, anchor });
		};

		return (
			<div
				key={wt.path}
				tabIndex={0}
				onMouseEnter={(e) => handleItemMouseEnter(wt, e)}
				onMouseLeave={handleItemMouseLeave}
				onContextMenu={(e) => {
					e.preventDefault();
					openMenuAt({ x: e.clientX, y: e.clientY });
				}}
				onKeyDown={(e) => {
					if (e.target !== e.currentTarget) return;
					if (e.key === "Enter") {
						e.preventDefault();
						onSelect(wt.path);
					} else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
						e.preventDefault();
						openMenuAt(e.currentTarget);
					}
				}}
				className={clsx(
					"group relative flex flex-col gap-0.5 rounded-md border px-2 text-xs outline-none transition-colors focus-visible:border-neutral-500",
					idle ? "py-0.5" : "py-1",
					isCurrent
						? "border-transparent bg-emerald-950/20 hover:bg-emerald-950/35"
						: isSelected
							? "border-neutral-600 bg-neutral-800/70"
							: "border-transparent hover:bg-neutral-900/70",
				)}
			>
				{/* Line 1: branch/title (truncates) + actions that reserve their width (no hover shift). */}
				<div className="flex min-w-0 items-center gap-1.5">
				<div className="flex min-w-0 flex-1 items-center gap-1.5">
					<GitBranch
						size={idle ? 11 : 12}
						className={clsx(
							"shrink-0",
							isCurrent ? "text-emerald-400" : idle ? "text-neutral-600" : "text-neutral-500",
						)}
					/>
					<button
						type="button"
						onClick={() => {
							dismissHover();
							onSelect(wt.path);
						}}
						title={displayName}
						className={clsx(
							"min-w-0 truncate text-left font-mono transition-colors",
							idle ? "text-[11px]" : "text-xs",
							isCurrent
								? "font-semibold text-emerald-300 hover:text-emerald-200"
								: isSelected
									? "font-semibold text-neutral-100"
									: idle
										? "text-neutral-500 hover:text-neutral-300"
										: "text-neutral-300 hover:text-neutral-100",
						)}
					>
						{displayName}
					</button>
					{isCurrent && (
						<span
							title="当前窗口正在使用的工作树"
							className="shrink-0 select-none rounded border border-emerald-500/35 bg-emerald-500/15 px-1 text-[9.5px] font-medium leading-tight text-emerald-300"
						>
							当前
						</span>
					)}
					{isBusy && <Loader2 size={11} className="shrink-0 animate-spin text-neutral-400" />}
				</div>

				{/* Actions: always occupy space; revealed on hover/focus or while a popup is open. */}
				<div
					onMouseEnter={dismissHover}
					className={clsx(
						"flex shrink-0 items-center gap-0.5 text-neutral-400 transition-opacity",
						rowOverlay
							? "opacity-100"
							: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
					)}
				>
					{idle ? (
						<button
							type="button"
							disabled={isBusy}
							onClick={() => {
								dismissHover();
								void clean(wt);
							}}
							title="回收此闲置工作树（删除工作树目录）"
							className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
						>
							<Trash2 size={11} />
							回收
						</button>
					) : (
						<>
							{wt.dirty > 0 && (
								<button
									type="button"
									disabled={isBusy}
									onClick={(e) => {
										dismissHover();
										setCommitFor({ path: wt.path, anchor: e.currentTarget });
									}}
									title="提交全部改动（AI 生成说明）"
									aria-label="提交全部改动"
									className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
								>
									<GitCommitHorizontal size={11} />
								</button>
							)}
							<button
								type="button"
								onClick={() => void startSessionInWorktree(wt.path)}
								title="在此工作树新建会话"
								aria-label="在此工作树新建会话"
								className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-100"
							>
								<Plus size={11} />
							</button>
						</>
					)}
					<button
						type="button"
						onClick={(e) => openMenuAt(e.currentTarget)}
						title={`更多操作：${label}`}
						aria-label="更多操作"
						aria-haspopup="menu"
						className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-100"
					>
						<MoreHorizontal size={11} />
					</button>
				</div>
				</div>

				{/* Line 2: secondary metadata / sessions, indented under the branch name. */}
				{hasMeta && (
				<div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-[18px]">
					{wt.dirty > 0 && (
						<button
							type="button"
							onClick={() => onOpenPane(wt.path, "changes")}
							title={`${wt.dirty} 个文件未提交，点击查看改动`}
							className="rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[10px] text-amber-300 hover:bg-amber-500/20"
						>
							{wt.dirty} 未提交
						</button>
					)}
					{showSync && (
						<span title={syncTitle} className="cursor-help text-[10px] text-neutral-500">
							{[wt.ahead > 0 && `领先 ${wt.ahead}`, wt.behind > 0 && `落后 ${wt.behind}`]
								.filter(Boolean)
								.join(" · ")}
						</span>
					)}
					{!idle &&
						uniquePorts.map((port) => (
							<button
								key={port}
								type="button"
								onClick={() => {
									void openUrl(`http://localhost:${port}`);
									toast.success(`已在浏览器中打开 http://localhost:${port}`);
								}}
								title={`正在监听端口 :${port}，点击在浏览器中打开预览`}
								className="flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-1 font-mono text-[10px] text-emerald-300 hover:bg-emerald-500/30"
							>
								<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />:{port}
							</button>
						))}
					{!idle && wt.sessionIds.length > 0 && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								dismissHover();
								if (sessionMenuWt === wt.path) {
									setSessionMenuWt(null);
									setSessionMenuAnchor(null);
								} else {
									setSessionMenuWt(wt.path);
									setSessionMenuAnchor(e.currentTarget);
								}
							}}
							title="查看关联会话"
							className="flex items-center gap-0.5 rounded bg-neutral-800 px-1 text-[10px] text-neutral-300 hover:bg-neutral-700"
						>
							{wt.sessionIds.length} 会话
							<ChevronDown size={10} className="text-neutral-500" />
						</button>
					)}
					{idle && (
						<span className="truncate text-[10px] text-neutral-600">
							<IdleActivity wt={wt} />
						</span>
					)}
				</div>
				)}
			</div>
		);
	};

	const menuWt = menu ? worktrees.find((w) => w.path === menu.path) : undefined;
	const pickWt = branchPick ? worktrees.find((w) => w.path === branchPick.path) : undefined;
	const commitWt = commitFor ? worktrees.find((w) => w.path === commitFor.path) : undefined;

	return (
		<section className="space-y-1 select-none">
			<div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1 py-0.5 text-xs">
				<div className="flex items-center gap-1.5 whitespace-nowrap font-semibold text-neutral-200">
					<FolderGit2 size={13} className="text-emerald-400" />
					<span>活跃工作树</span>
					<span className="rounded-full bg-neutral-800 px-1.5 font-mono text-[10px] text-neutral-400">
						{worktrees.length}
					</span>
					<span
						title="每个工作树是一份独立的物理代码目录，支持多任务并行修改代码，互不干扰、互不踩文件。右键工作树可打开更多操作。"
						className="cursor-help text-neutral-500 transition-colors hover:text-neutral-300"
					>
						<Info size={11} />
					</span>
				</div>

				<div className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap">
					<OrphanBadge
						count={orphanState.orphans.length}
						open={showOrphans}
						onToggle={() => setShowOrphans(!showOrphans)}
					/>
					<button
						type="button"
						onClick={() => setShowCreate(!showCreate)}
						title="新建并行工作树"
						aria-label="新建并行工作树"
						className={clsx(
							"rounded p-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100",
							showCreate && "bg-neutral-800 text-neutral-100",
						)}
					>
						<Plus size={13} />
					</button>
				</div>
			</div>

			{showOrphans && orphanState.orphans.length > 0 && (
				<OrphanInlinePanel
					orphans={orphanState.orphans}
					busy={orphanState.busy}
					cleaningPath={orphanState.cleaningPath}
					error={orphanState.error}
					home={orphanState.home}
					onReclaim={orphanState.reclaim}
					onReclaimAll={orphanState.reclaimAll}
					onClose={() => setShowOrphans(false)}
					onDismiss={() => {
						orphanState.dismiss();
						setShowOrphans(false);
					}}
				/>
			)}

			{showCreate && (
				<div className="rounded-lg border border-neutral-800 bg-neutral-900/90 p-2 text-xs shadow-sm">
					<div className="mb-1 text-[11px] font-medium text-neutral-300">新建并行工作树</div>
					<div className="mb-1.5 flex gap-1.5">
						<input
							autoFocus
							value={newWtName}
							onChange={(e) => setNewWtName(e.target.value)}
							onKeyDown={(e) => {
								if (isComposing(e)) return;
								if (e.key === "Enter") {
									e.preventDefault();
									void handleCreateWorktree();
								}
								if (e.key === "Escape") {
									e.preventDefault();
									setShowCreate(false);
								}
							}}
							placeholder="工作树名称（例如 feat-auth）"
							className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200 outline-none focus:border-indigo-500"
						/>
						<button
							type="button"
							disabled={creating}
							onClick={handleCreateWorktree}
							className="flex shrink-0 items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
						>
							{creating && <Loader2 size={11} className="animate-spin" />}
							<span>创建</span>
						</button>
					</div>
					<div className="flex items-center justify-between text-[10px] text-neutral-500">
						<span>按 Enter 创建，Esc 取消</span>
						<button
							type="button"
							onClick={() => {
								setShowCreate(false);
								openModal("new-session", { cwd: repo, useWorktree: true });
							}}
							className="text-indigo-400 hover:underline"
						>
							更多选项…
						</button>
					</div>
				</div>
			)}

			<div className="space-y-0.5">
				{activeWts.map((w) => renderRow(w))}
				{idleWts.length > 0 && (
					<>
						<button
							type="button"
							onClick={() => setShowIdle((v) => !v)}
							aria-expanded={showIdle}
							title="没有关联会话的工作树"
							className="flex w-full items-center gap-1 rounded px-2 py-0.5 text-[10px] text-neutral-500 hover:bg-neutral-900/70 hover:text-neutral-300"
						>
							{showIdle ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
							闲置 {idleWts.length}
						</button>
						{showIdle && idleWts.map((w) => renderRow(w, true))}
					</>
				)}
			</div>

			{menu && menuWt && (
				<WorktreeActionMenu
					anchor={menu.anchor}
					header={menuWt.branch ?? `分离 HEAD · ${menuWt.head.slice(0, 7)}`}
					entries={menuEntries(menuWt, menu.anchor)}
					onDismiss={() => setMenu(null)}
				/>
			)}

			{branchPick && pickWt?.branch && (
				<WorktreeActionMenu
					anchor={branchPick.anchor}
					header={`合并到「${pickWt.branch}」的来源分支`}
					entries={branchPick.branches.map((b) => ({
						key: b,
						label: b,
						icon: <GitBranch size={12} />,
						onSelect: () => void mergeInto(pickWt, b, `合并 ${b}`),
					}))}
					onDismiss={() => setBranchPick(null)}
				/>
			)}

			{commitFor && commitWt && (
				<WorktreeCommitPopover
					cwd={commitWt.path}
					branch={commitWt.branch ?? commitWt.head.slice(0, 7)}
					fileCount={commitWt.dirty}
					anchor={commitFor.anchor}
					onDismiss={() => setCommitFor(null)}
					onCommitted={onChanged}
				/>
			)}

			{sessionMenuWt && sessionMenuAnchor && (
				<FloatingLayer
					anchor={sessionMenuAnchor}
					placement="bottom-end"
					layer="menu"
					onDismiss={() => {
						setSessionMenuWt(null);
						setSessionMenuAnchor(null);
					}}
					className="w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-1 text-xs shadow-xl"
				>
					<div className="border-b border-neutral-800 px-2 py-1 text-[10px] font-semibold text-neutral-400">
						关联会话
					</div>
					<div className="max-h-48 overflow-y-auto py-1">
						{(() => {
							const wt = worktrees.find((w) => w.path === sessionMenuWt);
							if (!wt || wt.sessionIds.length === 0) {
								return <div className="px-2 py-1 text-neutral-500">暂无会话</div>;
							}
							return wt.sessionIds.map((sid) => {
								const s = sessions[sid];
								return (
									<button
										key={sid}
										type="button"
										onClick={() => {
											setSessionMenuWt(null);
											setSessionMenuAnchor(null);
											selectSession(sid);
										}}
										className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
									>
										<span className="flex-1 truncate font-mono text-[11px]">
											{s?.title || sid.slice(0, 8)}
										</span>
									</button>
								);
							});
						})()}
					</div>
				</FloatingLayer>
			)}

			<WorktreeHoverCard
				wt={hoveredWt}
				anchorRect={anchorRect}
				open={hoveredWt !== null && anchorRect !== null && !overlayOpen}
				isCurrent={hoveredWt?.path === current}
				isIdle={hoveredWt ? isIdle(hoveredWt) : false}
				baseBranch={baseBranch}
				services={hoveredWt ? servicesByWorktree.get(hoveredWt.path) : undefined}
			/>
		</section>
	);
}

/** Idle-row right label: relative time of the HEAD commit, loaded once the row mounts (group expanded). */
function IdleActivity({ wt }: { wt: WorktreeInfo }) {
	const commit = useHeadCommit(wt.path, wt.head, true);
	if (!commit) return null;
	return <span title={`最近提交：${commit.subject}`}>{ago(commit.ts)}</span>;
}
