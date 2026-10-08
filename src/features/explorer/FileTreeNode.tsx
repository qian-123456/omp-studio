import clsx from "clsx";
import { ChevronRight, Loader2, MoreHorizontal } from "lucide-react";
import React, { useState } from "react";
import type { DirEntry } from "../../lib/contracts";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FloatingLayer } from "../../components/FloatingLayer";
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
				style={{ paddingLeft: `${depth * 10 + 4}px` }}
				className={clsx(
					"group flex h-5 cursor-pointer items-center gap-1 pr-1 text-xs transition-all select-none mx-0.5 rounded active:scale-[0.98]",
					isSelected
						? "bg-[#0A84FF]/15 text-[#0A84FF] font-medium"
						: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100",
				)}
				title={entry.path}
			>
				{/* Chevron / Spacer */}
				<div className="flex h-3 w-3 shrink-0 items-center justify-center">
					{entry.isDir ? (
						isLoading ? (
							<Loader2 size={10} className="animate-spin text-neutral-500" />
						) : (
							<ChevronRight
								size={10}
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
						size={12}
					/>
				</div>

				{/* Label */}
				<span className="truncate flex-1 font-mono text-[10.5px] leading-tight">
					{entry.name}
				</span>

				{/* Action button on hover */}
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						handleContextMenu(e);
					}}
					className="opacity-0 group-hover:opacity-100 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-opacity"
					title="更多选项"
				>
					<MoreHorizontal size={11} />
				</button>
			</div>

			{/* Render Children when expanded */}
			{entry.isDir && isExpanded && (
				<div role="group" className="relative flex flex-col">
					{/* Vertical guide line for this subtree */}
					<div
						className="pointer-events-none absolute bottom-0.5 top-0.5 border-l border-white/[0.08]"
						style={{ left: `${depth * 10 + 10}px` }}
					/>
					{children.length === 0 && !isLoading ? (
						<div
							style={{ paddingLeft: `${(depth + 1) * 10 + 16}px` }}
							className="py-0.5 text-[10px] text-neutral-500 italic select-none"
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

			{/* Context Menu */}
			<FloatingLayer
				anchor={contextMenu}
				placement="bottom-start"
				layer="menu"
				onDismiss={() => setContextMenu(null)}
				className="min-w-[140px] p-1 text-xs text-neutral-200"
			>
				<button
					type="button"
					onClick={() => {
						setContextMenu(null);
						revealInFinder();
					}}
					className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-[0.98]"
				>
					在访达中显示
				</button>
				<button
					type="button"
					onClick={() => {
						setContextMenu(null);
						void copyRelativePath();
					}}
					className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-[0.98]"
				>
					复制相对路径
				</button>
				<button
					type="button"
					onClick={() => {
						setContextMenu(null);
						void copyAbsolutePath();
					}}
					className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-[0.98]"
				>
					复制完整路径
				</button>
				{entry.isDir && (
					<>
						<div className="my-0.5 border-t border-[var(--border-divider)]" />
						<button
							type="button"
							onClick={() => {
								setContextMenu(null);
								onRefreshDir(entry.path);
							}}
							className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] active:scale-[0.98]"
						>
							刷新此目录
						</button>
					</>
				)}
			</FloatingLayer>
		</div>
	);
}
