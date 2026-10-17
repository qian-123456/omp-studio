import clsx from "clsx";
import {
	ChevronDown,
	Copy,
	FileDiff,
	FileText,
	Loader2,
	PenLine,
	RotateCcw,
	Save,
	Send,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { GitFileChange, GitSummary } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { dispatchPrompt, gitCommit, gitCommitSuggest, gitRestoreFile } from "../../lib/ipc";
import { isInside, isMarkdown, joinPath } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { FloatingLayer } from "../../components/FloatingLayer";

const FILE_CAP = 30;
const FILE_STEP = 30;
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

const COMMIT_DRAFT_KEY = "omp_git_commit_draft";

/**
 * One-click save: commits every change. The message is AI-written by default;
 * a hand-written one is optional and tucked behind the pencil toggle.
 */
function CommitComposer({
	cwd,
	toplevel,
	fileCount,
	onCommitted,
}: {
	cwd: string;
	toplevel: string;
	fileCount: number;
	onCommitted: () => void;
}) {
	const [message, setMessage] = useState(() => {
		try {
			return localStorage.getItem(COMMIT_DRAFT_KEY) ?? "";
		} catch {
			return "";
		}
	});
	// Persist the draft; a successful commit resets `message` which clears it.
	useEffect(() => {
		try {
			if (message) localStorage.setItem(COMMIT_DRAFT_KEY, message);
			else localStorage.removeItem(COMMIT_DRAFT_KEY);
		} catch {
			/* storage unavailable */
		}
	}, [message]);
	// A restored hand-written draft re-opens the manual message editor.
	const [custom, setCustom] = useState(() => message !== "");
	const [phase, setPhase] = useState<"idle" | "naming" | "saving">("idle");
	// An agent still editing this worktree would get saved mid-change.
	const working = useSessions((s) =>
		Object.values(s.sessions).some(
			(m) => m.status === "working" && !!m.cwd && isInside(m.cwd, toplevel),
		),
	);
	const busy = phase !== "idle";

	const suggest = async () => {
		setPhase("naming");
		try {
			setMessage((await gitCommitSuggest(cwd)).trim());
		} catch (e) {
			toast.error(`生成说明失败：${errMsg(e)}`);
		} finally {
			setPhase("idle");
		}
	};

	const save = async () => {
		let msg = custom ? message.trim() : "";
		try {
			if (!msg) {
				setPhase("naming");
				msg = (await gitCommitSuggest(cwd)).trim();
				if (!msg) throw new Error("AI 没有返回说明");
			}
			setPhase("saving");
			await gitCommit(cwd, msg);
			const first = msg.split("\n")[0];
			toast.success(
				`已存档：${first.length > 72 ? `${first.slice(0, 72)}…（完整说明见历史）` : first}`,
			);
			setMessage("");
			setCustom(false);
			onCommitted();
		} catch (e) {
			toast.error(`存档失败：${errMsg(e)}`);
			// Offer the manual path when the AI message could not be produced.
			if (!msg) setCustom(true);
		} finally {
			setPhase("idle");
		}
	};

	return (
		<div className="space-y-1.5 py-1.5">
			{working && (
				<div className="rounded border border-amber-700/50 bg-amber-950/30 px-2 py-1 text-[11px] text-amber-300">
					Agent 还在修改这个工作树，现在存档可能只存下一半的改动
				</div>
			)}
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={() => void save()}
					disabled={busy || (custom && !message.trim())}
					title="把全部改动（含新文件）存成一个版本，以后可在「版本历史」里回到这里"
					className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
				>
					{busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
					<span className="truncate">
						{phase === "naming"
							? "正在生成说明…"
							: phase === "saving"
								? "正在存档…"
								: `存档：提交全部 ${fileCount} 个文件`}
					</span>
				</button>
				<button
					type="button"
					onClick={() => setCustom((v) => !v)}
					aria-pressed={custom}
					aria-label="自己写提交说明（可选）"
					title="自己写提交说明（可选）；不写则由 AI 自动生成"
					className={clsx(
						"shrink-0 rounded-md border p-1.5 transition-colors",
						custom
							? "border-indigo-600/70 bg-indigo-600/20 text-indigo-200"
							: "border-neutral-700/80 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300",
					)}
				>
					<PenLine size={12} />
				</button>
			</div>
			{custom && (
				<div className="space-y-1">
					<textarea
						autoFocus
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
								e.preventDefault();
								if (!busy && message.trim()) void save();
							}
						}}
						disabled={busy}
						rows={3}
						placeholder="提交说明，例如 feat(git): one-click save（⌘Enter 存档）"
						className="w-full resize-y rounded-md border border-neutral-700/80 bg-neutral-950/80 p-2 font-sans text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-indigo-500/80 focus:outline-none disabled:opacity-50"
					/>
					<button
						type="button"
						onClick={() => void suggest()}
						disabled={busy}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-indigo-300 transition-colors hover:bg-indigo-600/20 disabled:opacity-50"
					>
						<Sparkles size={11} />
						先让 AI 写一版，再手动修改
					</button>
				</div>
			)}
		</div>
	);
}

/** 未提交的改动: commit composer + changed files with +/-; md opens in DocView via aux icon. */
export function ChangesSection({
	cwd,
	summary,
	toplevel,
	onDiff,
	onChanged,
}: {
	cwd: string;
	summary: GitSummary;
	toplevel: string;
	onDiff: (path?: string) => void;
	onChanged: () => void;
}) {
	const openDoc = useUi((s) => s.openDoc);
	const sessionId = useUi((s) => s.selectedSessionId);
	const [fileLimit, setFileLimit] = useState(FILE_CAP);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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
				: `确定要撤销对「${f.path}」的改动吗？\n该文件将恢复到最近一次提交时的样子，未提交的修改将永久丢失。`,
			{
				danger: true,
				title: isUntracked ? "删除未跟踪文件" : "撤销改动确认",
				okLabel: isUntracked ? "删除文件" : "撤销改动",
			},
		);
		if (!ok) return;

		try {
			await gitRestoreFile(toplevel, f.path);
			toast.success(isUntracked ? `已删除未跟踪文件 ${f.path}` : `已撤销 ${f.path} 的改动`);
			onChanged();
		} catch (e) {
			toast.error(`撤销改动失败: ${errMsg(e)}`);
		}
	};

	return (
		<div className="pt-1">
			{files.length === 0 ? (
				<div className="px-1 py-2 text-xs text-neutral-500">没有未提交的改动</div>
			) : (
						<>
							<CommitComposer
								cwd={cwd}
								toplevel={toplevel}
								fileCount={files.length}
								onCommitted={onChanged}
							/>
							<ul className="space-y-px">
								{files.slice(0, fileLimit).map((f) => {
									const md = isMarkdown(f.path) && f.status !== "D";
									const fullPath = joinPath(toplevel, f.path);
									const statusText = f.status === "??" ? "U" : f.status;
									const statusDesc = STATUS_DESC[f.status] ?? f.status;
									const slash = f.path.lastIndexOf("/");
									const name = slash < 0 ? f.path : f.path.slice(slash + 1);
									const dir = slash < 0 ? "" : f.path.slice(0, slash);

									return (
										<li
											key={f.path}
											onContextMenu={(e) => {
												e.preventDefault();
												setContextMenu({ x: e.clientX, y: e.clientY, file: f });
											}}
											className="group relative flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-neutral-800/60 transition-colors"
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
												className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
											>
												<span
													className={clsx(
														"truncate text-neutral-200 group-hover:text-neutral-100",
														dir ? "max-w-[60%] shrink-0" : "min-w-0 flex-1",
													)}
												>
													{name}
												</span>
												{dir !== "" && (
													<span className="min-w-0 flex-1 truncate text-neutral-500">
														{dir}
													</span>
												)}
											</button>
											{f.added > 0 && (
												<span className="shrink-0 font-mono text-[10px] text-emerald-500">
													+{f.added}
												</span>
											)}
											{f.deleted > 0 && (
												<span className="shrink-0 font-mono text-[10px] text-rose-500">
													-{f.deleted}
												</span>
											)}

											{/* Quick Action Icons: overlay so they never truncate the path */}
											<div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-neutral-800 bg-neutral-900 px-0.5 opacity-0 shadow-md group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
												{md && (
													<button
														type="button"
														title="在文档视图中打开"
														aria-label="在文档视图中打开"
														onClick={(e) => {
															e.stopPropagation();
															openDoc(fullPath);
														}}
														className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
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
													className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
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
													className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-amber-300"
												>
													<Send size={12} />
												</button>
												<button
													type="button"
													title={f.status === "??" ? "删除未跟踪文件" : "撤销这个文件的改动"}
													aria-label={f.status === "??" ? "删除未跟踪文件" : "撤销这个文件的改动"}
													onClick={(e) => {
														e.stopPropagation();
														void handleDiscard(f);
													}}
													className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-rose-400"
												>
													<RotateCcw size={12} />
												</button>
											</div>
										</li>
									);
								})}
						</ul>
							{files.length > FILE_CAP && (
								<div className="flex items-center justify-center gap-2 py-1 text-[11px] text-neutral-500">
									{files.length > fileLimit && (
										<button
											type="button"
											onClick={() => setFileLimit((c) => c + FILE_STEP)}
											className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors"
										>
											<ChevronDown size={12} />
											<span>
												还有 {files.length - fileLimit} 个文件 · 展开更多 (+{Math.min(files.length - fileLimit, FILE_STEP)})
											</span>
										</button>
									)}
									{fileLimit > FILE_CAP && (
										<button
											type="button"
											onClick={() => setFileLimit(FILE_CAP)}
											className="rounded px-2 py-0.5 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors"
										>
											收起
										</button>
									)}
								</div>
							)}
						</>
			)}

			{/* Context Menu */}
			<FloatingLayer
				anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
				placement="bottom-start"
				layer="menu"
				offset={2}
				onDismiss={() => setContextMenu(null)}
				className="min-w-[160px] p-1 text-xs text-neutral-300"
			>
				{contextMenu && (
					<>
						<button
							type="button"
							onClick={() => {
								onDiff(contextMenu.file.path);
								setContextMenu(null);
							}}
							className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
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
								className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
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
							className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
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
							className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors"
						>
							<Copy size={12} />
							<span>复制完整路径</span>
						</button>
						<div className="my-1 border-t border-[var(--border-divider)]" />
						<button
							type="button"
							onClick={() => {
								void handleSendToAgent(contextMenu.file);
								setContextMenu(null);
							}}
							className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-amber-300 hover:bg-[var(--bg-hover)] transition-colors"
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
							className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-rose-400 hover:bg-[var(--bg-hover)] transition-colors"
						>
							<RotateCcw size={12} />
							<span>{contextMenu.file.status === "??" ? "删除未跟踪文件…" : "撤销这个文件的改动"}</span>
						</button>
					</>
				)}
			</FloatingLayer>
		</div>
	);
}
