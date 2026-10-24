import clsx from "clsx";
import {
	GitBranch,
	GitMerge,
	GitPullRequest,
	Loader2,
	Plus,
	RefreshCw,
	Trash2,
	Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { SearchInput } from "../../components/SearchInput";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { BranchInfo, MergePreview } from "../../lib/contracts";
import { createSession } from "../../lib/createSession";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import {
	gitDeleteBranch,
	gitGetPrUrl,
	gitListBranchesDetailed,
	gitMergeBranch,
	gitMergePreview,
	gitSyncBranch,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useSettings } from "../../features/settings/store";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";

type BranchTab = "local" | "remote";

interface BranchAssetSectionProps {
	repo: string;
	currentWorktreePath: string;
	onSelectWorktree: (path: string) => void;
	onWorktreeChanged: () => void;
}

/** Converts relative English dates from git (e.g. "2 hours ago") into friendly Chinese. */
function formatRelativeTime(raw?: string | null, isZh = true): string {
	if (!raw) return "";
	if (!isZh) return raw;
	return raw
		.replace(/(\d+)\s+seconds?\s+ago/i, "$1秒前")
		.replace(/(\d+)\s+minutes?\s+ago/i, "$1分钟前")
		.replace(/(\d+)\s+hours?\s+ago/i, "$1小时前")
		.replace(/(\d+)\s+days?\s+ago/i, "$1天前")
		.replace(/(\d+)\s+weeks?\s+ago/i, "$1周前")
		.replace(/(\d+)\s+months?\s+ago/i, "$1个月前")
		.replace(/(\d+)\s+years?\s+ago/i, "$1年前")
		.replace(/just now/i, "刚刚");
}

export function BranchAssetSection({
	repo,
	currentWorktreePath,
	onSelectWorktree,
	onWorktreeChanged,
}: BranchAssetSectionProps) {
	const openModal = useUi((s) => s.openModal);
	const workspaces = useSessions((s) => s.workspaces);
	const deliveryMode = useSettings((s) => s.settings?.gitDeliveryMode ?? "pr");
	const { t, locale } = useT();
	const isZh = locale.startsWith("zh");

	const [branches, setBranches] = useState<BranchInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [tab, setTab] = useState<BranchTab>("local");
	const [query, setQuery] = useState("");
	const [fetching, setFetching] = useState(false);
	const [actionRunning, setActionRunning] = useState<string | null>(null);

	const loadBranches = useCallback(async () => {
		try {
			setLoading(true);
			setLoadError(null);
			const list = await gitListBranchesDetailed(repo);
			setBranches(list);
		} catch (e) {
			console.error("Failed to list branches:", e);
			setLoadError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [repo]);

	useEffect(() => {
		void loadBranches();
	}, [loadBranches]);

	const localBranches = useMemo(
		() => branches.filter((b) => !b.isRemote),
		[branches],
	);
	const remoteBranches = useMemo(
		() => branches.filter((b) => b.isRemote),
		[branches],
	);

	const activeList = tab === "local" ? localBranches : remoteBranches;
	const filteredBranches = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return activeList;
		return activeList.filter(
			(b) =>
				b.name.toLowerCase().includes(q) ||
				b.displayName.toLowerCase().includes(q) ||
				(b.lastCommitMessage && b.lastCommitMessage.toLowerCase().includes(q)),
		);
	}, [activeList, query]);

	// Fetch / refresh remotes from GitHub
	const handleFetchAll = async () => {
		setFetching(true);
		try {
			await gitSyncBranch(repo, "", "fetch");
			toast.success(t("git.branches.fetchedLatest"));
			await loadBranches();
		} catch (e) {
			toast.error(t("git.branches.fetchFailed", { error: errMsg(e) }));
		} finally {
			setFetching(false);
		}
	};

	// Push local branch to remote
	const handlePushBranch = async (branch: BranchInfo) => {
		const targetName = branch.upstream ?? `origin/${branch.name}`;
		const isMain = branch.name === "main" || branch.name === "master";

		if (isMain) {
			const ok = await confirmDialog(
				t("git.branches.pushMainWarning", { target: targetName }),
				{
					title: t("git.branches.pushMainTitle"),
					danger: true,
					okLabel: t("git.branches.pushMainOk"),
				},
			);
			if (!ok) return;
		}

		setActionRunning(branch.name);
		try {
			await gitSyncBranch(repo, branch.name, "push");
			toast.success(t("git.branches.pushedSuccess", { target: targetName }));
			await loadBranches();
		} catch (e) {
			toast.error(t("git.branches.pushFailed", { error: errMsg(e) }));
		} finally {
			setActionRunning(null);
		}
	};

	// Deliver to main: Mode A (GitHub PR) vs Mode B (Direct Merge)
	const handleDeliverToMain = async (branch: BranchInfo) => {
		if (branch.name === "main" || branch.name === "master") {
			toast.error(t("git.branches.alreadyOnMain"));
			return;
		}

		if (deliveryMode === "direct") {
			// Mode B: Direct local merge + push
			const ok = await confirmDialog(
				t("git.branches.deliverDirectConfirm", { branch: branch.name }),
				{
					title: t("git.branches.deliverDirectTitle"),
					danger: true,
					okLabel: t("git.branches.deliverDirectOk"),
				},
			);
			if (!ok) return;

			setActionRunning(branch.name);
			try {
				await gitSyncBranch(repo, branch.name, "push");
				await gitMergeBranch(repo, branch.name);
				toast.success(t("git.branches.mergedIntoMain"));
				await loadBranches();
				onWorktreeChanged();
			} catch (e) {
				toast.error(t("git.branches.mergeFailed", { error: errMsg(e) }));
			} finally {
				setActionRunning(null);
			}
			return;
		}

		// Mode A (Default): Push + Open GitHub PR
		setActionRunning(branch.name);
		try {
			await gitSyncBranch(repo, branch.name, "push");
			const prInfo = await gitGetPrUrl(repo, branch.name, "main");
			if (prInfo.prUrl) {
				await openUrl(prInfo.prUrl);
				toast.success(t("git.branches.openedPrPage"));
			} else {
				toast.success(t("git.branches.pushedNoPrLink", { branch: branch.name }));
			}
			await loadBranches();
		} catch (e) {
			toast.error(t("git.branches.deliverFailed", { error: errMsg(e) }));
		} finally {
			setActionRunning(null);
		}
	};

	// Sync from main into branch
	const handleSyncFromMain = async (branch: BranchInfo) => {
		if (branch.name === "main" || branch.name === "master") {
			toast.error(t("git.branches.alreadyMainNoSync"));
			return;
		}

		setActionRunning(branch.name);
		try {
			const preview: MergePreview = await gitMergePreview(
				repo,
				branch.name,
				"main",
			);
			if (preview.hasConflicts) {
				const ok = await confirmDialog(
					t("git.branches.conflictDetected", { branch: branch.name, files: preview.conflictingFiles.join("\n") || t("git.branches.multipleFilesConflict") }),
					{
						title: t("git.branches.conflictPrecheckTitle"),
						okLabel: t("git.branches.aiResolveConflict"),
						cancelLabel: t("common.cancel"),
					},
				);
				if (ok) {
					await launchAiConflictSession(branch);
				}
				return;
			}

			// Clean merge
			const ok = await confirmDialog(
				t("git.branches.syncFromMainConfirm", { commits: preview.commitsAhead, branch: branch.name }),
				{
					title: t("git.branches.syncFromMainTitle"),
					okLabel: t("git.branches.confirmSync"),
				},
			);
			if (!ok) return;

			await gitMergeBranch(repo, "main");
			toast.success(t("git.branches.syncSuccess", { branch: branch.name }));
			await loadBranches();
			onWorktreeChanged();
		} catch (e) {
			toast.error(t("git.branches.syncFailed", { error: errMsg(e) }));
		} finally {
			setActionRunning(null);
		}
	};

	// Launch new AI session with prefilled conflict prompt
	const launchAiConflictSession = async (branch: BranchInfo) => {
		try {
			const targetCwd = branch.worktreePath ?? currentWorktreePath ?? repo;
			const targetWs = workspaces.find((w) => w.path === repo);
			const { sessionId, stub } = await createSession({
				cwd: targetCwd,
				workspaceId: targetWs?.id,
			});
			useSessions.getState().upsert([stub]);
			useUi.getState().selectSession(sessionId);

			const prompt = `当前分支 (${branch.name}) 从 main 合并代码遇到了冲突，请检查冲突标记并结合上下文代码逻辑协助解决冲突，最后运行测试验证。`;
			useComposer.getState().setDraft(sessionId, prompt);
			useComposer.getState().focusComposer(sessionId);
			toast.success(t("git.branches.conflictSessionCreated"));
		} catch (e) {
			toast.error(t("git.branches.conflictSessionFailed", { error: errMsg(e) }));
		}
	};

	// Delete branch
	const handleDeleteBranch = async (branch: BranchInfo) => {
		if (branch.isCurrentWorktree) {
			toast.error(t("git.branches.branchInUse", { branch: branch.name }));
			return;
		}

		const isRemote = branch.isRemote;
		const ok = await confirmDialog(
			t("git.branches.deleteBranchConfirm", { type: isRemote ? t("git.branches.remoteType") : t("git.branches.localType"), branch: branch.name }),
			{
				title: isRemote ? t("git.branches.deleteRemoteTitle") : t("git.branches.deleteLocalTitle"),
				danger: true,
				okLabel: t("git.branches.confirmDelete"),
			},
		);
		if (!ok) return;

		setActionRunning(branch.name);
		try {
			await gitDeleteBranch(repo, branch.name, isRemote, true);
			toast.success(t("git.branches.deletedBranch", { branch: branch.name }));
			await loadBranches();
		} catch (e) {
			toast.error(t("git.branches.deleteFailed", { error: errMsg(e) }));
		} finally {
			setActionRunning(null);
		}
	};

	// Prune merged local branches
	const handlePruneMerged = async () => {
		const prunable = localBranches.filter(
			(b) =>
				b.isMerged &&
				!b.isCurrentWorktree &&
				b.name !== "main" &&
				b.name !== "master",
		);

		if (prunable.length === 0) {
			toast.info(t("git.branches.noPrunableBranches"));
			return;
		}

		const names = prunable.map((b) => b.name).join(", ");
		const ok = await confirmDialog(
			t("git.branches.pruneMergedConfirm", { count: prunable.length, names }),
			{
				title: t("git.branches.pruneMergedTitle"),
				danger: true,
				okLabel: t("git.branches.confirmPrune"),
			},
		);
		if (!ok) return;

		setLoading(true);
		try {
			for (const b of prunable) {
				await gitDeleteBranch(repo, b.name, false, true);
			}
			toast.success(t("git.branches.prunedBranches", { count: prunable.length }));
			await loadBranches();
		} catch (e) {
			toast.error(t("git.branches.pruneFailed", { error: errMsg(e) }));
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col gap-2 p-2.5 select-none">
			{/* Section Header: Sketch Segmented Tabs [ 本地 ] | [ 云端 ] */}
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-[var(--border-divider)] pb-2">
				<div className="flex min-w-0 items-center gap-1.5">
					<span className="text-xs font-semibold text-[var(--text)]">
						{t("git.branches.header")}
					</span>
					{loading && <Loader2 size={12} className="animate-spin text-[var(--text-dim)]" />}
				</div>

				<div className="flex shrink-0 items-center gap-1.5">
					<button
						type="button"
						onClick={handleFetchAll}
						disabled={fetching}
						title={t("git.branches.fetchRemotesTitle")}
						className="flex items-center gap-1 rounded bg-[var(--well-bg)] hover:bg-[var(--bg-hover)] px-2 py-0.5 text-[10px] text-[var(--text)] transition-colors disabled:opacity-50"
					>
						<RefreshCw size={10} className={fetching ? "animate-spin text-indigo-400" : ""} />
						<span>{t("git.branches.fetchRemotes")}</span>
					</button>

					{localBranches.some((b) => b.isMerged && !b.isCurrentWorktree && b.name !== "main") && (
						<button
							type="button"
							onClick={handlePruneMerged}
							title={t("git.branches.pruneMergedTitle")}
							className="flex items-center gap-1 rounded bg-[var(--well-bg)] hover:bg-rose-950/40 hover:text-rose-300 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)] transition-colors"
						>
							<Trash2 size={10} />
							<span>{t("git.branches.pruneMerged")}</span>
						</button>
					)}
				</div>
			</div>

			{/* Tab Switcher (Matches Hand-Drawn Sketch) */}
			<div className="flex shrink-0 flex-wrap items-center gap-2">
				<div className="flex shrink-0 rounded-md bg-[var(--bg-panel)] p-0.5 border border-[var(--border-divider)] text-xs">
					<button
						type="button"
						onClick={() => setTab("local")}
						className={clsx(
							"rounded px-2.5 py-1 font-medium transition-colors text-xs whitespace-nowrap",
							tab === "local"
								? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
								: "text-[var(--text-muted)] hover:text-[var(--text)]",
						)}
					>
						{t("git.branches.tabLocal", { count: localBranches.length })}
					</button>
					<button
						type="button"
						onClick={() => setTab("remote")}
						className={clsx(
							"rounded px-2.5 py-1 font-medium transition-colors text-xs whitespace-nowrap",
							tab === "remote"
								? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
								: "text-[var(--text-muted)] hover:text-[var(--text)]",
						)}
					>
						{t("git.branches.tabRemote", { count: remoteBranches.length })}
					</button>
				</div>

				{/* Search box */}
				<SearchInput
					value={query}
					onChange={setQuery}
					placeholder={t("git.branches.searchPlaceholder")}
					className="min-w-[8rem] flex-1"
				/>
			</div>

			{/* Branch List */}
			<div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-0.5">
				{loadError ? (
					<div className="m-1 flex items-start justify-between gap-2 rounded border border-rose-800/60 bg-rose-950/40 p-2 text-xs text-rose-300">
						<span className="min-w-0 flex-1 select-text whitespace-pre-wrap break-words">
							{t("git.branches.loadFailed", { error: loadError })}
						</span>
						<button
							type="button"
							onClick={() => void loadBranches()}
							className="shrink-0 whitespace-nowrap rounded bg-rose-900/60 px-2 py-0.5 text-[11px] font-medium text-rose-200 hover:bg-rose-800/80 transition-colors"
						>
							{t("common.retry")}
						</button>
					</div>
				) : filteredBranches.length === 0 ? (
					<EmptyState
						title={query ? t("git.branches.emptyNoMatch") : tab === "local" ? t("git.branches.emptyNoLocal") : t("git.branches.emptyNoRemote")}
					/>
				) : (
					filteredBranches.map((branch) => {
						const isBusy = actionRunning === branch.name;
						const isRunning = branch.isCurrentWorktree;

						return (
							<div
								key={branch.name}
								className={clsx(
									"group relative rounded-lg border px-2 py-1.5 text-xs transition-colors",
									isRunning
										? "border-emerald-500/30 bg-emerald-950/10 hover:border-emerald-500/50"
										: "border-[var(--border-divider)] bg-[var(--bg-panel)] hover:border-[var(--border)] hover:bg-[var(--bg-hover)]",
								)}
							>
								{/* Line 1: Branch name has top priority (wraps up to two lines); relative time on the right. */}
								<div className="flex items-start justify-between gap-2 min-w-0">
									<div className="flex items-start gap-1.5 min-w-0 flex-1">
										<GitBranch
											size={13}
											className={clsx(
												"mt-0.5 shrink-0",
												isRunning
													? "text-emerald-400"
													: branch.isRemote
														? "text-sky-400"
														: "text-[var(--text-dim)] group-hover:text-[var(--text)]",
											)}
										/>
										<span
											title={branch.name}
											className={clsx(
												"line-clamp-2 [overflow-wrap:anywhere] font-mono text-xs font-semibold leading-4 min-w-0 flex-1",
												isRunning ? "text-emerald-300" : "text-[var(--text)]",
											)}
										>
											{branch.displayName}
										</span>

										{/* Subtle running dot when idle */}
										{isRunning && (
											<span
												title={t("git.branches.branchBoundWorktree")}
												className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.6)]"
											/>
										)}

										{/* Minimal Ahead/Behind counters */}
										{!branch.isRemote && branch.ahead > 0 && (
											<span
												title={t("git.branches.aheadCount", { count: branch.ahead })}
												className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-mono font-medium leading-4 text-amber-300"
											>
												↑{branch.ahead}
											</span>
										)}
										{!branch.isRemote && branch.behind > 0 && (
											<span
												title={t("git.branches.behindCount", { count: branch.behind })}
												className="shrink-0 rounded bg-purple-500/15 px-1 text-[9px] font-mono font-medium leading-4 text-purple-300"
											>
												↓{branch.behind}
											</span>
										)}
									</div>

									{/* Relative time stays in place; actions overlay the summary line so geometry never shifts */}
									<div className="shrink-0 pt-px text-[10px] leading-4 text-[var(--text-dim)] whitespace-nowrap">
										{branch.lastCommitTime ? formatRelativeTime(branch.lastCommitTime, isZh) : ""}
									</div>

									{/* Hover/focus only: action toolbar overlaying the summary line */}
									<div className="pointer-events-none absolute bottom-1 right-1.5 flex items-center gap-0.5 rounded-md border border-[var(--border-divider)] bg-[var(--bg-panel)] px-0.5 opacity-0 shadow-sm transition-opacity duration-100 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
											{isRunning && (
												<button
													type="button"
													onClick={() => {
														if (branch.worktreePath) {
															onSelectWorktree(branch.worktreePath);
														}
													}}
													title={t("git.branches.viewWorktreeTitle")}
													className="flex items-center gap-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300 transition-colors"
												>
													<span>{t("git.branches.viewWorktree")}</span>
												</button>
											)}

											{isBusy ? (
												<Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />
											) : !branch.isRemote ? (
												<>
													{/* Action: Push */}
													<button
														type="button"
														onClick={() => void handlePushBranch(branch)}
														title={
															branch.upstream
																? t("git.branches.pushUpstreamTitle", { upstream: branch.upstream })
																: t("git.branches.pushNewRemoteTitle")
														}
														className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-amber-300 transition-colors"
													>
														<Upload size={11} />
													</button>

													{/* Action: Deliver / PR */}
													<button
														type="button"
														onClick={() => void handleDeliverToMain(branch)}
														title={
															deliveryMode === "direct"
																? t("git.branches.deliverDirectTitleShort")
																: t("git.branches.deliverPrTitleShort")
														}
														className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-indigo-300 transition-colors"
													>
														<GitPullRequest size={11} />
													</button>

													{/* Action: Sync from main */}
													<button
														type="button"
														onClick={() => void handleSyncFromMain(branch)}
														title={t("git.branches.syncFromMainTooltip")}
														className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-emerald-300 transition-colors"
													>
														<GitMerge size={11} />
													</button>

													{/* Action: Spawn worktree (if not already running) */}
													{!isRunning && (
														<button
															type="button"
															onClick={() => {
																openModal("new-session", {
																	cwd: repo,
																	branch: branch.name,
																	useWorktree: true,
																});
															}}
															title={t("git.branches.spawnWorktreeTitle")}
															className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
														>
															<Plus size={11} />
														</button>
													)}

													{/* Action: Delete */}
													<button
														type="button"
														disabled={isRunning}
														onClick={() => void handleDeleteBranch(branch)}
														title={isRunning ? t("git.branches.inUseCannotDelete") : t("git.branches.deleteLocalBranch")}
														className={clsx(
															"rounded p-1 transition-colors",
															isRunning
																? "text-[var(--text-dim)] cursor-not-allowed"
																: "text-[var(--text-muted)] hover:bg-rose-950/40 hover:text-rose-300",
														)}
													>
														<Trash2 size={11} />
													</button>
												</>
											) : (
												<>
													{/* Remote branch actions */}
													<button
														type="button"
														onClick={() => {
															openModal("new-session", {
																cwd: repo,
																branch: branch.name,
																useWorktree: true,
															});
														}}
														title={t("git.branches.checkoutWorktreeTitle")}
														className="flex items-center gap-1 rounded bg-[var(--well-bg)] hover:bg-indigo-600 px-1.5 py-0.5 text-[10px] text-[var(--text)] hover:text-white transition-colors"
													>
														<Plus size={10} />
														<span>{t("git.branches.buildWorktree")}</span>
													</button>

													<button
														type="button"
														onClick={() => void handleDeleteBranch(branch)}
														title={t("git.branches.deleteRemoteBranch")}
														className="rounded p-1 text-[var(--text-muted)] hover:bg-rose-950/40 hover:text-rose-300 transition-colors"
													>
														<Trash2 size={11} />
													</button>
												</>
											)}
									</div>
								</div>

								{/* Line 2: Status badges + commit summary; hover/focus actions overlay its right end. */}
								<div className="mt-1 flex h-5 items-center gap-1.5 text-[10px] text-[var(--text-muted)] min-w-0 overflow-hidden">
									{/* Status badges stay visible so hover never changes card content */}
									{!branch.isRemote && (
										<div className="flex items-center gap-1 shrink-0">
											{!branch.upstream && (
												<span
													title={t("git.branches.onlyLocalTitle")}
													className="shrink-0 rounded bg-[var(--well-bg)] border border-[var(--border-divider)] px-1 text-[9px] text-[var(--text-muted)]"
												>
													{t("git.branches.onlyLocal")}
												</span>
											)}
											{branch.upstream && branch.ahead === 0 && branch.behind === 0 && (
												<span
													title={t("git.branches.syncedTitle")}
													className="shrink-0 rounded bg-[var(--well-bg)] border border-[var(--border-divider)] px-1 text-[9px] text-[var(--text-muted)]"
												>
													{t("git.branches.synced")}
												</span>
											)}
											{branch.isMerged && (
												<span
													title={t("git.branches.mergedTitle")}
													className="shrink-0 rounded bg-[var(--well-bg)] px-1 text-[9px] text-[var(--text-dim)]"
												>
													{t("git.branches.merged")}
												</span>
											)}
										</div>
									)}

									{branch.isRemote && (
										<span className="shrink-0 rounded bg-sky-500/10 border border-sky-500/30 px-1 text-[9px] text-sky-300">
											{t("git.branches.cloudBadge")}
										</span>
									)}

									{branch.lastCommitMessage && (
										<span
											className="truncate text-[var(--text-dim)] group-hover:text-[var(--text-muted)] flex-1 min-w-0 transition-colors"
											title={branch.lastCommitMessage}
										>
											{branch.lastCommitMessage}
										</span>
									)}
								</div>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
