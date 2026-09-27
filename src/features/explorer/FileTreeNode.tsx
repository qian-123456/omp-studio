import clsx from "clsx";
import { ChevronRight, Loader2 } from "lucide-react";
import React, { useState } from "react";
import type { DirEntry } from "../../lib/contracts";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEscapeKey } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { FileIcon } from "./FileIcon";

interface FileTreeNodeProps {
	entry: DirEntry;
	depth: number;
	rootPath: string;
	expandedPaths: Set<string>;
	selectedPath: string | null;
	onToggleExpand: (path: string) => void;
	onSelectPath: (path: string, isDir: boolean) => void;
	onOpenFile: (path: string) => void;
	childrenMap: Record<string, DirEntry[]>;
	loadingPaths: Set<string>;
	onRefreshDir: (path: string) => void;
}

export function FileTreeNode({
	entry,
	depth,
	rootPath,
	expandedPaths,
	selectedPath,
	onToggleExpand,
	onSelectPath,
	onOpenFile,
	childrenMap,
	loadingPaths,
	onRefreshDir,
}: FileTreeNodeProps) {
	const isExpanded = expandedPaths.has(entry.path);
	const isSelected = selectedPath === entry.path;
	const isLoading = loadingPaths.has(entry.path);
	const children = childrenMap[entry.path] ?? [];

	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(
		null,
	);

	useEscapeKey(() => setContextMenu(null), contextMenu !== null);

	const handleClick = (e: React.MouseEvent) => {
		e.stopPropagation();
		onSelectPath(entry.path, entry.isDir);
		if (entry.isDir) {
			onToggleExpand(entry.path);
		} else {
			onOpenFile(entry.path);
		}
	};

	const handleContextMenu = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onSelectPath(entry.path, entry.isDir);
		setContextMenu({
			x: Math.min(e.clientX, window.innerWidth - 180),
			y: Math.min(e.clientY, window.innerHeight - 150),
		});
	};

	const copyRelativePath = async () => {
		setContextMenu(null);
		const rel = entry.path.startsWith(rootPath)
			? entry.path.slice(rootPath.length).replace(/^[/\\]/, "")
			: entry.name;
		try {
			await navigator.clipboard.writeText(rel);
			toast.success("已复制相对路径");
		} catch {
			toast.error("复制失败");
		}
	};

	const copyAbsolutePath = async () => {
		setContextMenu(null);
		try {
			await navigator.clipboard.writeText(entry.path);
			toast.success("已复制绝对路径");
		} catch {
			toast.error("复制失败");
		}
	};

	const revealInFinder = async () => {
		setContextMenu(null);
		try {
			await revealItemInDir(entry.path);
		} catch (err) {
			toast.error(`在访达中打开失败: ${String(err)}`);
		}
	};

	return (
		<div>
			{/* Node Row */}
			<div
				role="treeitem"
				tabIndex={0}
				aria-expanded={entry.isDir ? isExpanded : undefined}
				aria-selected={isSelected}
				onClick={handleClick}
				onContextMenu={handleContextMenu}
				style={{ paddingLeft: `${depth * 14 + 8}px` }}
				className={clsx(
					"group flex h-[28px] cursor-pointer items-center gap-1.5 pr-2 text-xs transition-colors select-none mx-1 my-0.5",
					isSelected
						? "rounded-md border border-rose-500/70 bg-rose-500/10 text-rose-100 font-medium"
						: "rounded-md border border-transparent text-neutral-300 hover:bg-neutral-800/60 hover:text-neutral-100",
				)}
				title={entry.path}
			>
				{/* Chevron / Spacer */}
				<div className="flex h-4 w-4 shrink-0 items-center justify-center">
					{entry.isDir ? (
						isLoading ? (
							<Loader2 size={12} className="animate-spin text-neutral-500" />
						) : (
							<ChevronRight
								size={12}
								className={clsx(
									"text-neutral-500 transition-transform duration-150 group-hover:text-neutral-300",
									isExpanded && "rotate-90 text-neutral-300",
								)}
							/>
						)
					) : (
						<span className="w-3" />
					)}
				</div>

				{/* File/Folder Icon */}
				<div className="flex shrink-0 items-center justify-center">
					<FileIcon
						name={entry.name}
						isDir={entry.isDir}
						isOpen={isExpanded}
						size={14}
					/>
				</div>

				{/* Label */}
				<span className="truncate flex-1 font-mono text-[11.5px] leading-none">
					{entry.name}
				</span>
			</div>

			{/* Render Children when expanded */}
			{entry.isDir && isExpanded && (
				<div role="group" className="flex flex-col">
					{children.length === 0 && !isLoading ? (
						<div
							style={{ paddingLeft: `${(depth + 1) * 14 + 18}px` }}
							className="py-1 text-[11px] text-neutral-500 italic select-none"
						>
							空目录
						</div>
					) : (
						children.map((child) => (
							<FileTreeNode
								key={child.path}
								entry={child}
								depth={depth + 1}
								rootPath={rootPath}
								expandedPaths={expandedPaths}
								selectedPath={selectedPath}
								onToggleExpand={onToggleExpand}
								onSelectPath={onSelectPath}
								onOpenFile={onOpenFile}
								childrenMap={childrenMap}
								loadingPaths={loadingPaths}
								onRefreshDir={onRefreshDir}
							/>
						))
					)}
				</div>
			)}

			{/* Context Menu Backdrop & Popover */}
			{contextMenu && (
				<>
					<div
						className="fixed inset-0 z-50 cursor-default"
						onClick={(e) => {
							e.stopPropagation();
							setContextMenu(null);
						}}
						onContextMenu={(e) => {
							e.preventDefault();
							e.stopPropagation();
							setContextMenu(null);
						}}
					/>
					<div
						style={{ left: contextMenu.x, top: contextMenu.y }}
						className="fixed z-50 min-w-[150px] rounded-lg border border-neutral-800 bg-neutral-900/95 p-1 shadow-2xl backdrop-blur-md text-xs text-neutral-200"
					>
						<button
							type="button"
							onClick={revealInFinder}
							className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800 hover:text-neutral-100"
						>
							在访达中显示
						</button>
						<button
							type="button"
							onClick={copyRelativePath}
							className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800 hover:text-neutral-100"
						>
							复制相对路径
						</button>
						<button
							type="button"
							onClick={copyAbsolutePath}
							className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800 hover:text-neutral-100"
						>
							复制完整路径
						</button>
						{entry.isDir && (
							<>
								<div className="my-1 border-t border-neutral-800" />
								<button
									type="button"
									onClick={() => {
										setContextMenu(null);
										onRefreshDir(entry.path);
									}}
									className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-neutral-800 hover:text-neutral-100"
								>
									刷新此目录
								</button>
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}
