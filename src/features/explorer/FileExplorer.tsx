import clsx from "clsx";
import {
	FolderUp,
	Loader2,
	RefreshCw,
	Search,
	FoldVertical,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DirEntry } from "../../lib/contracts";
import { fsReadDir, listWorkspaceFiles } from "../../lib/ipc";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "../../lib/toast";
import { isComposing } from "../../lib/hooks";
import { useExplorer } from "../../stores/explorer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { FileIcon } from "./FileIcon";
import { FileTreeNode } from "./FileTreeNode";
import { WorkspaceCard } from "./WorkspaceCard";

export function FileExplorer() {
	const workspaces = useSessions((s) => s.workspaces);
	const sessions = useSessions((s) => s.sessions);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const openDoc = useUi((s) => s.openDoc);
	const docPath = useUi((s) => s.docPath);

	// Determine active workspace: match selected session's workspace/cwd, or fallback to first non-global, or first workspace
	const activeSession = selectedSessionId ? sessions[selectedSessionId] : null;
	const manualWorkspaceId = useExplorer((s) => s.workspaceId);
	const setManualWorkspaceId = useExplorer((s) => s.setWorkspaceId);

	const currentWorkspace = useMemo(() => {
		if (workspaces.length === 0) return null;
		if (manualWorkspaceId) {
			const found = workspaces.find((w) => w.id === manualWorkspaceId);
			if (found) return found;
		}
		if (activeSession?.workspaceId) {
			const found = workspaces.find((w) => w.id === activeSession.workspaceId);
			if (found) return found;
		}
		if (activeSession?.cwd) {
			// Find workspace containing activeSession.cwd
			const found = workspaces.find(
				(w) =>
					w.kind !== "global" &&
					(activeSession.cwd === w.path || activeSession.cwd.startsWith(`${w.path}/`)),
			);
			if (found) return found;
		}
		const nonGlobal = workspaces.find((w) => w.kind !== "global");
		return nonGlobal || workspaces[0] || null;
	}, [workspaces, manualWorkspaceId, activeSession]);

	// Tree state
	const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);
	const [childrenMap, setChildrenMap] = useState<Record<string, DirEntry[]>>({});
	const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
	const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
	const [selectedPath, setSelectedPath] = useState<string | null>(docPath);
	const [isRootLoading, setIsRootLoading] = useState(false);

	// Search state
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<string[]>([]);
	const [isSearchingFiles, setIsSearchingFiles] = useState(false);
	const [searchLimit, setSearchLimit] = useState(50);
	const searchInputRef = useRef<HTMLInputElement>(null);

	// Sync selectedPath when docPath changes externally
	useEffect(() => {
		if (docPath) {
			setSelectedPath(docPath);
		}
	}, [docPath]);

	// Load directory entries for path
	const loadDir = useCallback(async (path: string) => {
		setLoadingPaths((prev) => new Set(prev).add(path));
		try {
			const entries = await fsReadDir(path);
			setChildrenMap((prev) => ({ ...prev, [path]: entries }));
			return entries;
		} catch (err) {
			toast.error(`读取目录失败: ${String(err)}`);
			return [];
		} finally {
			setLoadingPaths((prev) => {
				const next = new Set(prev);
				next.delete(path);
				return next;
			});
		}
	}, []);

	// Refresh root directory and reload expanded directories in current workspace
	const refreshRoot = useCallback(async () => {
		if (!currentWorkspace?.path) {
			setRootEntries([]);
			return;
		}
		setIsRootLoading(true);
		try {
			const entries = await fsReadDir(currentWorkspace.path);
			setRootEntries(entries);
			// Also reload currently expanded directories
			for (const expPath of expandedPaths) {
				if (expPath.startsWith(currentWorkspace.path)) {
					loadDir(expPath).catch(() => {});
				}
			}
		} catch (err) {
			toast.error(`加载工作区文件失败: ${String(err)}`);
			setRootEntries([]);
		} finally {
			setIsRootLoading(false);
		}
	}, [currentWorkspace?.path, expandedPaths, loadDir]);

	// Reset tree expansion and cache on workspace change, then load new root
	useEffect(() => {
		setExpandedPaths(new Set());
		setChildrenMap({});
		if (!currentWorkspace?.path) {
			setRootEntries([]);
			return;
		}
		setIsRootLoading(true);
		fsReadDir(currentWorkspace.path)
			.then((entries) => {
				setRootEntries(entries);
			})
			.catch((err) => {
				toast.error(`加载工作区文件失败: ${String(err)}`);
				setRootEntries([]);
			})
			.finally(() => {
				setIsRootLoading(false);
			});
	}, [currentWorkspace?.path]);

	// Toggle folder expand/collapse
	const handleToggleExpand = useCallback(
		async (path: string) => {
			if (expandedPaths.has(path)) {
				setExpandedPaths((prev) => {
					const next = new Set(prev);
					next.delete(path);
					return next;
				});
			} else {
				setExpandedPaths((prev) => new Set(prev).add(path));
				if (!childrenMap[path]) {
					await loadDir(path);
				}
			}
		},
		[expandedPaths, childrenMap, loadDir],
	);

	// Collapse all directories
	const handleCollapseAll = () => {
		setExpandedPaths(new Set());
	};

	// Open file in center DocView
	const handleOpenFile = (path: string) => {
		setSelectedPath(path);
		openDoc(path);
	};

	// Reveal current workspace root in Finder
	const handleRevealInFinder = async () => {
		if (!currentWorkspace?.path) return;
		try {
			await revealItemInDir(currentWorkspace.path);
		} catch (err) {
			toast.error(`在访达中打开失败: ${String(err)}`);
		}
	};

	// Perform workspace file search when query changes
	useEffect(() => {
		const q = searchQuery.trim();
		if (!q || !currentWorkspace?.path) {
			setSearchResults([]);
			return;
		}
		setSearchLimit(50);
		const timer = setTimeout(async () => {
			setIsSearchingFiles(true);
			try {
				const allFiles = await listWorkspaceFiles(currentWorkspace.path);
				const lowerQ = q.toLowerCase();
				const matched = allFiles.filter((rel) =>
					rel.toLowerCase().includes(lowerQ),
				);
				setSearchResults(matched);
			} catch {
				setSearchResults([]);
			} finally {
				setIsSearchingFiles(false);
			}
		}, 150);
		return () => clearTimeout(timer);
	}, [searchQuery, currentWorkspace?.path]);

	return (
		<div className="flex h-full flex-col bg-transparent text-neutral-300 text-xs select-none">
			{/* Top Tool Section: Actions Toolbar matching the reference screenshot */}
			<div className="flex items-center justify-between border-b border-[var(--border-divider)] px-2 py-1 bg-[var(--bg-active-fill)]">
				<span className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">
					资源管理器
				</span>

				{/* Toolbar Icons matching the screenshot */}
				<div className="flex items-center gap-0.5">
					{/* Search */}
					<button
						type="button"
						onClick={() => {
							setSearchOpen((v) => {
								const next = !v;
								if (next) {
									setTimeout(() => searchInputRef.current?.focus(), 50);
								} else {
									setSearchQuery("");
								}
								return next;
							});
						}}
						className={clsx(
							"flex h-6 w-6 items-center justify-center rounded transition-all active:scale-95",
							searchOpen
								? "bg-[var(--bg-hover)] text-neutral-100"
								: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
						)}
						title="搜索文件 (Cmd+F)"
					>
						<Search size={13} />
					</button>

					{/* Reveal in Finder / Open */}
					<button
						type="button"
						onClick={handleRevealInFinder}
						className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
						title="在访达中显示工作区目录"
					>
						<FolderUp size={13} />
					</button>
					{/* Collapse All */}
					<button
						type="button"
						onClick={handleCollapseAll}
						className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
						title="全部折叠"
					>
						<FoldVertical size={13} />
					</button>
					{/* Refresh */}
					<button
						type="button"
						onClick={refreshRoot}
						className={clsx(
							"flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all",
							isRootLoading && "animate-spin text-neutral-200",
						)}
						title="刷新文件树"
					>
						<RefreshCw size={12} />
					</button>
				</div>
			</div>

			{/* Search Input Bar (revealed on search click) */}
			{searchOpen && (
				<div className="border-b border-[var(--border-divider)] p-1.5 bg-[var(--well-bg)]">
					<div className="relative flex items-center">
						<Search
							size={12}
							className="pointer-events-none absolute left-2 text-neutral-500"
						/>
						<input
							ref={searchInputRef}
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onKeyDown={(e) => {
								if (isComposing(e)) return;
								if (e.key === "Escape") {
									e.preventDefault();
									if (searchQuery) setSearchQuery("");
									else setSearchOpen(false);
								}
							}}
							placeholder="输入文件名过滤..."
							className="w-full rounded hairline bg-[var(--well-bg)] py-0.5 pl-6 pr-5 text-xs text-neutral-200 placeholder:text-neutral-500 focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery("")}
								className="absolute right-1.5 text-neutral-500 hover:text-neutral-300"
							>
								<X size={11} />
							</button>
						)}
					</div>
				</div>
			)}

			{/* Workspace Card at the top */}
			<WorkspaceCard
				currentWorkspace={currentWorkspace}
				workspaces={workspaces}
				onSelectWorkspace={(ws) => setManualWorkspaceId(ws.id)}
			/>

			{/* Tree or Search Results Container */}
			<div className="flex-1 overflow-y-auto px-0.5 py-0.5 focus:outline-none">
				{/* Search Results Mode */}
				{searchQuery.trim().length > 0 ? (
					<div className="space-y-0.5">
						<div className="px-2 py-0.5 text-[10.5px] text-neutral-500 flex items-center justify-between">
							<span>搜索结果 ({searchResults.length})</span>
							{isSearchingFiles && <Loader2 size={11} className="animate-spin" />}
						</div>
						{searchResults.length === 0 && !isSearchingFiles ? (
							<div className="py-4 text-center text-xs text-neutral-500">
								无匹配文件
							</div>
						) : (
							<>
								{searchResults.slice(0, searchLimit).map((rel) => {
									const full = currentWorkspace
										? `${currentWorkspace.path}/${rel}`
										: rel;
									const fileName = rel.split("/").pop() || rel;
									const isSelected = selectedPath === full;
									return (
										<div
											key={rel}
											role="button"
											tabIndex={0}
											onClick={() => handleOpenFile(full)}
											className={clsx(
												"flex h-5 items-center gap-1.5 rounded px-2 text-xs transition-all active:scale-[0.98] cursor-pointer",
												isSelected
													? "bg-[#0A84FF]/15 text-[#0A84FF] font-medium"
													: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100",
											)}
											title={full}
										>
											<FileIcon name={fileName} size={11} />
											<div className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
												<span className="truncate font-mono text-[10.5px] leading-tight text-neutral-200">
													{fileName}
												</span>
												<span className="truncate font-mono text-[9.5px] text-neutral-500 leading-tight flex-1">
													{rel}
												</span>
											</div>
										</div>
									);
								})}
								{searchResults.length > searchLimit && (
									<button
										type="button"
										onClick={() => setSearchLimit((l) => l + 50)}
										className="w-full py-1 text-center text-[10.5px] text-neutral-400 hover:text-neutral-200 hover:bg-[var(--bg-hover)] rounded transition-colors"
									>
										显示更多 (剩余 {searchResults.length - searchLimit} 项)...
									</button>
								)}
							</>
						)}
					</div>
				) : (
					/* Regular File Tree Mode */
					<div>
						{isRootLoading && rootEntries.length === 0 ? (
							<div className="flex items-center justify-center gap-1.5 py-6 text-neutral-500 text-xs">
								<Loader2 size={13} className="animate-spin" />
								<span>加载目录中...</span>
							</div>
						) : rootEntries.length === 0 ? (
							<div className="py-6 text-center text-neutral-500 text-xs">
								当前工作区暂无文件
							</div>
						) : (
							rootEntries.map((entry) => (
								<FileTreeNode
									key={entry.path}
									entry={entry}
									depth={0}
									rootPath={currentWorkspace?.path || ""}
									expandedPaths={expandedPaths}
									selectedPath={selectedPath}
									onToggleExpand={handleToggleExpand}
									onSelectPath={(path) => {
										setSelectedPath(path);
									}}
									onOpenFile={handleOpenFile}
									childrenMap={childrenMap}
									loadingPaths={loadingPaths}
									onRefreshDir={loadDir}
								/>
							))
						)}
					</div>
				)}
			</div>
		</div>
	);
}
