import clsx from "clsx";
import { ChevronDown, Folder } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import type { Workspace } from "../../lib/contracts";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "../../lib/toast";

interface WorkspaceCardProps {
	currentWorkspace: Workspace | null;
	workspaces: Workspace[];
	onSelectWorkspace: (ws: Workspace) => void;
	gitDirtyCount?: number;
}

export function WorkspaceCard({
	currentWorkspace,
	workspaces,
	onSelectWorkspace,
	gitDirtyCount = 0,
}: WorkspaceCardProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	// Close menu on click outside
	useEffect(() => {
		if (!menuOpen) return;
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setMenuOpen(false);
			}
		};
		window.addEventListener("mousedown", handler);
		return () => window.removeEventListener("mousedown", handler);
	}, [menuOpen]);

	const name = currentWorkspace?.name || "未选择工作区";
	const path = currentWorkspace?.path || "";

	const handleOpenInFinder = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!path) return;
		try {
			await revealItemInDir(path);
		} catch (err) {
			toast.error(`在访达中打开失败: ${String(err)}`);
		}
	};

	return (
		<div className="relative px-2.5 pt-2 pb-1.5">
			<div
				role="button"
				tabIndex={0}
				onClick={() => {
					if (workspaces.length > 1) {
						setMenuOpen((v) => !v);
					}
				}}
				onContextMenu={(e) => {
					e.preventDefault();
					handleOpenInFinder(e);
				}}
				className={clsx(
					"group flex items-center gap-2.5 rounded-xl hairline bg-[var(--bg-panel)] p-2 text-left shadow-apple-card transition-all",
					workspaces.length > 1
						? "cursor-pointer hover:bg-[var(--bg-hover)] active:scale-[0.98]"
						: "cursor-default",
				)}
				title={
					path
						? `${name}\n${path}\n(右键在访达中显示${workspaces.length > 1 ? "，点击切换工作区" : ""})`
						: name
				}
			>
				{/* Folder icon container */}
				<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
					<Folder size={15} />
				</div>

				{/* Title and path */}
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-xs font-semibold text-neutral-200">
							{name}
						</span>
						{workspaces.length > 1 && (
							<ChevronDown
								size={12}
								className={clsx(
									"text-neutral-500 transition-transform duration-200",
									menuOpen && "rotate-180 text-neutral-300",
								)}
							/>
						)}
					</div>
					<div className="truncate font-mono text-[10px] text-neutral-400/80 leading-tight mt-0.5">
						{path || "选择或添加工作区目录"}
					</div>
				</div>

				{/* Status indicator dot */}
				<div className="shrink-0 flex items-center pr-0.5">
					<span
						className={clsx(
							"h-2 w-2 rounded-full transition-colors",
							gitDirtyCount > 0
								? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]"
								: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
						)}
						title={
							gitDirtyCount > 0
								? `工作区就绪 (${gitDirtyCount} 处未提交变更)`
								: "工作区已就绪"
						}
					/>
				</div>
			</div>

			{/* Workspace dropdown selector */}
			{menuOpen && workspaces.length > 1 && (
				<div
					ref={menuRef}
					className="absolute left-2.5 right-2.5 top-full z-50 mt-1.5 max-h-60 overflow-y-auto rounded-xl vibrancy-popover shadow-apple-modal hairline p-1"
				>
					<div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
						切换工作区
					</div>
					{workspaces.map((ws) => (
						<button
							key={ws.id}
							type="button"
							onClick={() => {
								onSelectWorkspace(ws);
								setMenuOpen(false);
							}}
							className={clsx(
								"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-all active:scale-[0.98]",
								currentWorkspace?.id === ws.id
									? "bg-[#0A84FF]/15 text-[#0A84FF] font-medium"
									: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100",
							)}
						>
							<Folder size={13} className="shrink-0 text-amber-400/80" />
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium">{ws.name}</div>
								<div className="truncate font-mono text-[10px] text-neutral-400">
									{ws.path}
								</div>
							</div>
							{currentWorkspace?.id === ws.id && (
								<span className="h-1.5 w-1.5 rounded-full bg-[#0A84FF] shrink-0" />
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
