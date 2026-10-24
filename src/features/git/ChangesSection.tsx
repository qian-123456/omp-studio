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
import { useT } from "../../stores/language";
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

const commitDraftKey = (toplevel: string) => `omp_git_commit_draft:${toplevel}`;

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
	const { t } = useT();
	const [message, setMessage] = useState(() => {
		try {
			return localStorage.getItem(commitDraftKey(toplevel)) ?? "";
		} catch {
			return "";
		}
	});
	// Persist the draft; a successful commit resets `message` which clears it.
	useEffect(() => {
		try {
			if (message) localStorage.setItem(commitDraftKey(toplevel), message);
			else localStorage.removeItem(commitDraftKey(toplevel));
		} catch {
			/* storage unavailable */
		}
	}, [message, toplevel]);
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
			toast.error(t("git.changes.suggestFailed", { error: errMsg(e) }));
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
				if (!msg) throw new Error(t("git.changes.aiNoDescription"));
			}
			setPhase("saving");
			await gitCommit(cwd, msg);
			const first = msg.split("\n")[0];
			toast.success(
				t("git.changes.savedWithSummary", {
					summary: first.length > 72 ? `${first.slice(0, 72)}${t("git.changes.fullDescInHistory")}` : first,
				}),
			);
			setMessage("");
			setCustom(false);
			onCommitted();
		} catch (e) {
			toast.error(t("git.changes.saveFailed", { error: errMsg(e) }));
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
					{t("git.changes.workingWarning")}
				</div>
			)}
			<div className="flex items-center gap-1.5">
				<button
					type="button"
					onClick={() => void save()}
					disabled={busy || (custom && !message.trim())}
					title={t("git.changes.saveAllTitle")}
					className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
				>
					{busy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
					<span className="truncate">
						{phase === "naming"
							? t("git.changes.generatingDesc")
							: phase === "saving"
								? t("git.changes.saving")
								: t("git.changes.saveFilesCount", { count: fileCount })}
					</span>
				</button>
				<button
					type="button"
					onClick={() => setCustom((v) => !v)}
					aria-pressed={custom}
					aria-label={t("git.changes.customDescAria")}
					title={t("git.changes.customDescTitle")}
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
						placeholder={t("git.changes.customDescPlaceholder")}
						className="w-full resize-y rounded-md border border-neutral-700/80 bg-neutral-950/80 p-2 font-sans text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-indigo-500/80 focus:outline-none disabled:opacity-50"
					/>
					<button
						type="button"
						onClick={() => void suggest()}
						disabled={busy}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-indigo-300 transition-colors hover:bg-indigo-600/20 disabled:opacity-50"
					>
						<Sparkles size={11} />
						{t("git.changes.aiSuggestFirst")}
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
	const { t } = useT();
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

	const files = summary.files;

	const handleCopyPath = async (f: GitFileChange, absolute = false) => {
		const target = absolute ? joinPath(toplevel, f.path) : f.path;
		await copyText(target);
		toast.success(absolute ? t("git.changes.copiedAbsolutePath") : t("git.changes.copiedRelativePath"));
	};

	const handleSendToAgent = async (f: GitFileChange) => {
		if (!sessionId) {
			toast.error(t("git.changes.noActiveSession"));
			return;
		}
		try {
			await dispatchPrompt(
				sessionId,
				`请审查并处理文件 ${f.path} 的改动：\n- 状态：${STATUS_DESC[f.status] ?? f.status}\n- 新增：+${f.added} 行\n- 删除：-${f.deleted} 行`,
			);
			toast.success(t("git.changes.dispatchedToAgent"));
		} catch (e) {
			toast.error(errMsg(e));
		}
	};

	const handleDiscard = async (f: GitFileChange) => {
		const isUntracked = f.status === "??";
		const ok = await confirmDialog(
			isUntracked
				? t("git.changes.discardUntrackedConfirm", { path: f.path })
				: t("git.changes.discardConfirm", { path: f.path }),
			{
				danger: true,
				title: isUntracked ? t("git.changes.discardUntrackedTitle") : t("git.changes.discardTitle"),
				okLabel: isUntracked ? t("git.changes.discardUntrackedOk") : t("git.changes.discardOk"),
			},
		);
		if (!ok) return;

		try {
			await gitRestoreFile(toplevel, f.path);
			toast.success(isUntracked ? t("git.changes.deletedUntracked", { path: f.path }) : t("git.changes.revertedFile", { path: f.path }));
			onChanged();
		} catch (e) {
			toast.error(t("git.changes.discardFailed", { error: errMsg(e) }));
		}
	};

	return (
		<div className="pt-1">
			{files.length === 0 ? (
				<div className="px-1 py-2 text-xs text-neutral-500">{t("git.changes.noChanges")}</div>
			) : (
						<>
							<CommitComposer
								key={toplevel}
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
														title={t("git.changes.openDoc")}
														aria-label={t("git.changes.openDoc")}
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
													title={t("git.changes.copyRelativePath")}
													aria-label={t("git.changes.copyRelativePath")}
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
													title={t("git.changes.dispatchToAgent")}
													aria-label={t("git.changes.dispatchToAgent")}
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
													title={f.status === "??" ? t("git.changes.deleteUntrackedFile") : t("git.changes.revertFileChange")}
													aria-label={f.status === "??" ? t("git.changes.deleteUntrackedFile") : t("git.changes.revertFileChange")}
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
												{t("git.changes.moreFiles", { remaining: files.length - fileLimit, step: Math.min(files.length - fileLimit, FILE_STEP) })}
											</span>
										</button>
									)}
									{fileLimit > FILE_CAP && (
										<button
											type="button"
											onClick={() => setFileLimit(FILE_CAP)}
											className="rounded px-2 py-0.5 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors"
										>
											{t("common.collapse")}
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
							<span>{t("git.changes.viewDiff")}</span>
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
								<span>{t("git.changes.openInDocEditor")}</span>
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
							<span>{t("git.changes.copyRelativePath")}</span>
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
							<span>{t("git.changes.copyAbsolutePath")}</span>
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
							<span>{t("git.changes.askAgentAboutChange")}</span>
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
							<span>{contextMenu.file.status === "??" ? t("git.changes.deleteUntrackedFileDots") : t("git.changes.revertFileChange")}</span>
						</button>
					</>
				)}
			</FloatingLayer>
		</div>
	);
}
