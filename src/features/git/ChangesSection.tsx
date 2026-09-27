import clsx from "clsx";
import { ChevronDown, Copy, FileDiff, FileText, RotateCcw, Send } from "lucide-react";
import { useEffect, useState } from "react";
import type { GitFileChange, GitSummary } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { useEscapeKey } from "../../lib/hooks";
import { dispatchPrompt, gitRestoreFile } from "../../lib/ipc";
import { isMarkdown, joinPath } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";

const STATUS_STYLE: Record<string, string> = {
	M: "text-amber-400",
	A: "text-emerald-400",
	D: "text-rose-400",
	R: "text-sky-400",
	"??": "text-emerald-300",
};

const STATUS_DESC: Record<string, string> = {
	M: "已修改 (Modified)",
	A: "新增文件 (Added)",
	D: "已删除 (Deleted)",
	R: "已重命名 (Renamed)",
	"??": "未跟踪新文件 (Untracked)",
};

interface ContextMenuState {
	x: number;
	y: number;
	file: GitFileChange;
}

/** 变更: changed files with +/-; md opens in DocView via aux icon, all files open diff by default. */
export function ChangesSection({
	summary,
	toplevel,
	onDiff,
	onChanged,
}: {
	summary: GitSummary;
	toplevel: string;
	onDiff: (path?: string) => void;
	onChanged?: () => void;
}) {
	const openDoc = useUi((s) => s.openDoc);
	const sessionId = useUi((s) => s.selectedSessionId);
	const [collapsed, setCollapsed] = useState(false);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

	useEscapeKey(() => setContextMenu(null));

	useEffect(() => {
		if (!contextMenu) return;
		const handleClick = () => setContextMenu(null);
		window.addEventListener("click", handleClick);
		return () => window.removeEventListener("click", handleClick);
	}, [contextMenu]);

	const files = summary.files;

	const handleCopyPath = async (f: GitFileChange, absolute = false) => {
		const target = absolute ? joinPath(toplevel, f.path) : f.path;
		await copyText(target);
		toast.success(absolute ? "已复制完整路径" : "已复制相对路径");
	};

	const handleSendToAgent = async (f: GitFileChange) => {
		if (!sessionId) {
			toast.error("当前未选择活跃会话，无法派发审查任务");
			return;
		}
		try {
			await dispatchPrompt(
				sessionId,
				`请审查并处理文件 ${f.path} 的改动：\n- 状态：${STATUS_DESC[f.status] ?? f.status}\n- 新增：+${f.added} 行\n- 删除：-${f.deleted} 行`,
			);
			toast.success("已派发给 Agent 审查");
		} catch (e) {
			toast.error(errMsg(e));
		}
	};

	const handleDiscard = async (f: GitFileChange) => {
		const isUntracked = f.status === "??";
		const ok = await confirmDialog(
			isUntracked
				? `确定要删除未跟踪文件「${f.path}」吗？\n该文件将被直接从磁盘删除，此操作无法撤销。`
				: `确定要放弃对文件「${f.path}」的改动吗？\n该文件将恢复至当前分支的 HEAD 版本，未提交的修改将永久丢失。`,
			{
				danger: true,
				title: isUntracked ? "删除未跟踪文件" : "放弃改动确认",
				okLabel: isUntracked ? "删除文件" : "放弃改动",
			},
		);
		if (!ok) return;

		try {
			await gitRestoreFile(toplevel, f.path);
			toast.success(isUntracked ? `已删除未跟踪文件 ${f.path}` : `已恢复文件 ${f.path}`);
			onChanged?.();
		} catch (e) {
			toast.error(`放弃改动失败: ${errMsg(e)}`);
		}
	};

	return (
	<section className="rounded-lg border border-neutral-800 bg-neutral-900/50">
		<div className="flex items-center justify-between px-3 py-2">
			<button
				type="button"
				onClick={() => setCollapsed(!collapsed)}
				className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 hover:text-neutral-100"
			>
				<ChevronDown
					size={13}
					className={clsx("transition-transform text-neutral-400", collapsed && "-rotate-90")}
				/>
				<FileDiff size={13} className="text-amber-400" />
				<span>变更</span>
				{files.length > 0 && (
					<span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
						{files.length}
					</span>
				)}
			</button>
			{files.length > 0 && !collapsed && (
				<button
					type="button"
					onClick={() => onDiff()}
					className="text-[11px] text-neutral-400 hover:text-neutral-200"
				>
					全部 diff
				</button>
			)}
		</div>


		{!collapsed && (
			<div className="border-t border-neutral-800 px-3 pb-2 pt-1">
					{files.length === 0 && (
						<div className="py-1 text-xs text-neutral-500">工作区干净，没有未提交的改动</div>
					)}
					<ul className="space-y-px">
						{files.map((f) => {
							const md = isMarkdown(f.path) && f.status !== "D";
							const fullPath = joinPath(toplevel, f.path);
							const statusText = f.status === "??" ? "U" : f.status;
							const statusDesc = STATUS_DESC[f.status] ?? f.status;

							return (
								<li
									key={f.path}
									onContextMenu={(e) => {
										e.preventDefault();
										setContextMenu({ x: e.clientX, y: e.clientY, file: f });
									}}
									className="group flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-800/60 transition-colors"
								>
									<span
										title={statusDesc}
										className={clsx(
											"w-4 shrink-0 font-mono text-[10px] cursor-help select-none",
											STATUS_STYLE[f.status] ?? "text-neutral-400",
										)}
									>
										{statusText}
									</span>
									<button
										type="button"
										title={fullPath}
										onClick={() => onDiff(f.path)}
										className="min-w-0 flex-1 truncate text-left text-neutral-300 hover:text-neutral-100"
									>
										{f.path}
									</button>
									<span className="shrink-0 font-mono text-[10px] text-emerald-500">+{f.added}</span>
									<span className="shrink-0 font-mono text-[10px] text-rose-500">-{f.deleted}</span>

									{/* Quick Action Icons */}
									<div className="flex shrink-0 items-center gap-0.5">
										{md && (
											<button
												type="button"
												title="在文档视图中打开"
												aria-label="在文档视图中打开"
												onClick={(e) => {
													e.stopPropagation();
													openDoc(fullPath);
												}}
												className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-neutral-200 group-hover:opacity-100 focus:opacity-100 transition-opacity"
											>
												<FileText size={12} />
											</button>
										)}
										<button
											type="button"
											title="复制相对路径"
											aria-label="复制相对路径"
											onClick={(e) => {
												e.stopPropagation();
												void handleCopyPath(f, false);
											}}
											className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-neutral-200 group-hover:opacity-100 focus:opacity-100 transition-opacity"
										>
											<Copy size={12} />
										</button>
										<button
											type="button"
											title="派发给 Agent 审查"
											aria-label="派发给 Agent 审查"
											onClick={(e) => {
												e.stopPropagation();
												void handleSendToAgent(f);
											}}
											className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-amber-300 group-hover:opacity-100 focus:opacity-100 transition-opacity"
										>
											<Send size={12} />
										</button>
										<button
											type="button"
											title={f.status === "??" ? "删除未跟踪文件" : "放弃此文件改动"}
											aria-label={f.status === "??" ? "删除未跟踪文件" : "放弃此文件改动"}
											onClick={(e) => {
												e.stopPropagation();
												void handleDiscard(f);
											}}
											className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-rose-400 group-hover:opacity-100 focus:opacity-100 transition-opacity"
										>
											<RotateCcw size={12} />
										</button>
									</div>
								</li>
							);
						})}
				</ul>
			</div>
		)}


			{/* Context Menu */}
			{contextMenu && (
				<div
					style={{ left: contextMenu.x, top: contextMenu.y }}
					className="fixed z-50 min-w-[160px] rounded-lg border border-neutral-700 bg-neutral-900/95 p-1 text-xs text-neutral-300 shadow-2xl backdrop-blur-md"
					onClick={(e) => e.stopPropagation()}
				>
					<button
						type="button"
						onClick={() => {
							onDiff(contextMenu.file.path);
							setContextMenu(null);
						}}
						className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-neutral-800 hover:text-neutral-100"
					>
						<FileDiff size={12} />
						<span>查看 Diff</span>
					</button>
					{isMarkdown(contextMenu.file.path) && contextMenu.file.status !== "D" && (
						<button
							type="button"
							onClick={() => {
								openDoc(joinPath(toplevel, contextMenu.file.path));
								setContextMenu(null);
							}}
							className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-neutral-800 hover:text-neutral-100"
						>
							<FileText size={12} />
							<span>在文档编辑器中打开</span>
						</button>
					)}
					<button
						type="button"
						onClick={() => {
							void handleCopyPath(contextMenu.file, false);
							setContextMenu(null);
						}}
						className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-neutral-800 hover:text-neutral-100"
					>
						<Copy size={12} />
						<span>复制相对路径</span>
					</button>
					<button
						type="button"
						onClick={() => {
							void handleCopyPath(contextMenu.file, true);
							setContextMenu(null);
						}}
						className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-neutral-800 hover:text-neutral-100"
					>
						<Copy size={12} />
						<span>复制完整路径</span>
					</button>
					<div className="my-1 border-t border-neutral-800" />
					<button
						type="button"
						onClick={() => {
							void handleSendToAgent(contextMenu.file);
							setContextMenu(null);
						}}
						className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-amber-300 hover:bg-neutral-800"
					>
						<Send size={12} />
						<span>向 Agent 询问此改动</span>
					</button>
					<button
						type="button"
						onClick={() => {
							void handleDiscard(contextMenu.file);
							setContextMenu(null);
						}}
						className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-rose-400 hover:bg-neutral-800"
					>
						<RotateCcw size={12} />
						<span>{contextMenu.file.status === "??" ? "删除未跟踪文件…" : "放弃改动 (恢复到 HEAD)"}</span>
					</button>
				</div>
			)}
		</section>
	);
}
