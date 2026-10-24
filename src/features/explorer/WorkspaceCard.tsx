import clsx from "clsx";
import { ChevronDown, Folder } from "lucide-react";
import React, { useRef, useState } from "react";
import type { Workspace } from "../../lib/contracts";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { FloatingLayer } from "../../components/FloatingLayer";
import { toast } from "../../lib/toast";
import { useT } from "../../stores/language";

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
	const { t } = useT();
	const [menuOpen, setMenuOpen] = useState(false);
	const cardRef = useRef<HTMLDivElement>(null);

	const name = currentWorkspace?.name || t("explorer.noWorkspaceSelected");
	const path = currentWorkspace?.path || "";

	const handleOpenInFinder = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!path) return;
		try {
			await revealItemInDir(path);
		} catch (err) {
			toast.error(t("explorer.openInFinderFailed", { error: String(err) }));
		}
	};

	return (
		<div className="relative px-2 py-1">
			<div
				ref={cardRef}
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
					"group flex h-6 items-center gap-1.5 rounded-lg hairline bg-[var(--bg-panel)] px-2 py-0.5 text-left shadow-apple-card transition-all",
					workspaces.length > 1
						? "cursor-pointer hover:bg-[var(--bg-hover)] active:scale-[0.98]"
						: "cursor-default",
				)}
				title={
					path
						? t("explorer.workspaceCardTip", {
								name,
								path,
								switchHint: workspaces.length > 1 ? t("explorer.switchHint") : "",
						  })
						: name
				}
			>
				{/* Folder icon container */}
				<div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
					<Folder size={11} />
				</div>

				{/* Title and path */}
				<div className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
					<span className="truncate text-[11px] font-medium text-neutral-200 shrink-0 max-w-[120px]">
						{name}
					</span>
					{workspaces.length > 1 && (
						<ChevronDown
							size={11}
							className={clsx(
								"text-neutral-500 transition-transform duration-200 shrink-0 self-center",
								menuOpen && "rotate-180 text-neutral-300",
							)}
						/>
					)}
					<span className="truncate font-mono text-[9.5px] text-neutral-500 flex-1">
						{path || t("explorer.selectOrAddWorkspace")}
					</span>
				</div>

				{/* Status indicator dot */}
				<div className="shrink-0 flex items-center pr-0.5">
					<span
						className={clsx(
							"h-1.5 w-1.5 rounded-full transition-colors",
							gitDirtyCount > 0
								? "bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.5)]"
								: "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]",
						)}
						title={
							gitDirtyCount > 0
								? t("explorer.workspaceReadyWithDirty", { count: gitDirtyCount })
								: t("explorer.workspaceReady")
						}
					/>
				</div>
			</div>

			{/* Workspace dropdown selector */}
			{workspaces.length > 1 && (
				<FloatingLayer
					anchor={menuOpen ? cardRef.current : null}
					placement="bottom-start"
					offset={4}
					layer="popover"
					ignoreRefs={[cardRef]}
					onDismiss={() => setMenuOpen(false)}
					className="w-[280px] p-1"
				>
					<div className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
						{t("explorer.switchWorkspace")}
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
								"flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-all active:scale-[0.98]",
								currentWorkspace?.id === ws.id
									? "bg-[#0A84FF]/15 text-[#0A84FF] font-medium"
									: "text-neutral-300 hover:bg-[var(--bg-hover)] hover:text-neutral-100",
							)}
						>
							<Folder size={12} className="shrink-0 text-amber-400/80" />
							<div className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
								<span className="truncate font-medium">{ws.name}</span>
								<span className="truncate font-mono text-[10px] text-neutral-500 flex-1">
									{ws.path}
								</span>
							</div>
							{currentWorkspace?.id === ws.id && (
								<span className="h-1.5 w-1.5 rounded-full bg-[#0A84FF] shrink-0" />
							)}
						</button>
					))}
				</FloatingLayer>
			)}
		</div>
	);
}
