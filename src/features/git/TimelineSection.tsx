import clsx from "clsx";
import {
	ChevronDown,
	ChevronRight,
	Copy,
	FileDiff,
	History,
	Play,
	RotateCcw,
	Search,
	Terminal,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { GitCommit, GitSummary, TmRun } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { relativeTime } from "../../lib/format";
import { isComposing } from "../../lib/hooks";
import { gitResetTo, tmRun } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { TmRunCard } from "./TmRunCard";

const btn =
	"flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors focus:opacity-100";

const HISTORY_KEY = "omp:tm:custom-command-history";


function dayKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(d: Date, now: Date): string {
	const todayKey = dayKey(now);
	const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
	const yestKey = dayKey(yest);
	const targetKey = dayKey(d);

	if (targetKey === todayKey) return "今天";
	if (targetKey === yestKey) return "昨天";

	const m = d.getMonth() + 1;
	const day = d.getDate();
	if (d.getFullYear() === now.getFullYear()) {
		return `${m}月${day}日`;
	}
	return `${d.getFullYear()}年${m}月${day}日`;
}

interface CommitRowProps {
	c: GitCommit;
	run: TmRun | undefined;
	expanded: boolean;
	currentCustom: string;
	customFor: boolean;
	busy: boolean;
	cmdHistory: string[];
	onToggleOpen: () => void;
	onDiff: (sha?: string, title?: string) => void;
	onStart: (sha: string, command?: string) => void;
	onCustomFor: () => void;
	onCustomChange: (v: string) => void;
	onCustomHistoryPick: (cmd: string) => void;
	onReset: (c: GitCommit, mode: "soft" | "hard") => void;
	onCopySha: (sha: string, short: string) => void;
	onRunGone: (id: string) => void;
}

function CommitRow({
	c,
	run,
	expanded,
	currentCustom,
	customFor,
	busy,
	cmdHistory,
	onToggleOpen,
	onDiff,
	onStart,
	onCustomFor,
	onCustomChange,
	onCustomHistoryPick,
	onReset,
	onCopySha,
	onRunGone,
}: CommitRowProps) {
	return (
		<li className="group/item relative pb-1 pl-3.5">
			{/* Timeline node dot */}
			<span
				className={clsx(
					"absolute -left-[3.5px] top-2 h-1.5 w-1.5 rounded-full ring-2 ring-neutral-900 transition-colors",
					run?.pid ? "bg-emerald-400 ring-emerald-950/60" : "bg-neutral-600 group-hover/item:bg-neutral-400",
					expanded && "!bg-indigo-400 !ring-indigo-950/60",
				)}
			/>

			{/* Main Compact Row */}
			<div
				className={clsx(
					"flex items-center justify-between gap-1.5 rounded px-1.5 py-1 transition-colors",
					expanded ? "bg-neutral-800/60" : "hover:bg-neutral-800/40",
				)}
				title={`${c.subject}\n作者: ${c.author}\n时间: ${c.ts}\nSHA: ${c.sha}`}
			>
				{/* Message: truncate 1 line */}
				<button
					type="button"
					onClick={onToggleOpen}
					className="min-w-0 flex-1 text-left"
				>
					<span
						className={clsx(
							"block truncate text-xs transition-colors",
							expanded ? "font-medium text-white" : "text-neutral-200 group-hover/item:text-neutral-100",
						)}
					>
						{c.subject}
					</span>
				</button>

				{/* Right side: quick actions on hover, short SHA, relative time */}
				<div className="flex shrink-0 items-center gap-1.5 text-[10px]">
					{/* Quick Actions (Diff, Run) visible on hover */}
					<div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/item:opacity-100">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onDiff(c.sha, `${c.short} ${c.subject}`);
							}}
							title="查看此版本 Diff"
							className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors"
						>
							<FileDiff size={12} />
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={(e) => {
								e.stopPropagation();
								onStart(c.sha);
							}}
							title="运行此版本"
							className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-emerald-300 transition-colors"
						>
							<Play size={12} />
						</button>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onCopySha(c.sha, c.short);
							}}
							title="复制完整 SHA"
							className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors"
						>
							<Copy size={12} />
						</button>
					</div>

					{/* Short SHA */}
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onCopySha(c.sha, c.short);
						}}
						className="font-mono text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/60 rounded px-1 py-0.5 transition-colors"
						title={`点击复制完整 SHA: ${c.sha}\n作者: ${c.author}`}
					>
						{c.short}
					</button>

					{/* Relative Time */}
					<span className="text-neutral-500 whitespace-nowrap text-[10px]">
						{relativeTime(c.ts)}
					</span>
				</div>
			</div>

			{/* Expanded Panel */}
			{expanded && (
				<div className="mt-1 pl-1">
					<div className="mb-1.5 flex items-center justify-between text-[10px] text-neutral-500 border-b border-neutral-800/80 pb-1">
						<span>
							作者: <span className="text-neutral-400">{c.author}</span>
						</span>
						<span>{c.ts}</span>
					</div>

					<div className="flex flex-wrap gap-1">
						<button
							type="button"
							className={btn}
							onClick={() => onDiff(c.sha, `${c.short} ${c.subject}`)}
						>
							<FileDiff size={12} /> 查看 diff
						</button>
						<button
							type="button"
							className={btn}
							disabled={busy}
							onClick={() => onStart(c.sha)}
							title="将基于 package.json 自动推断命令（例如 pnpm dev）及分配端口运行"
						>
							<Play size={12} />
							<span>{busy ? "启动中…" : "运行此版本"}</span>
							<span className="font-mono text-[10px] text-neutral-500">(pnpm dev · 端口 5173+)</span>
						</button>
						<button
							type="button"
							className={btn}
							onClick={onCustomFor}
						>
							<Terminal size={12} /> 自定义命令
						</button>
						<button type="button" className={btn} onClick={() => onReset(c, "soft")}>
							<RotateCcw size={12} /> 软回退
						</button>
						<button
							type="button"
							className={clsx(btn, "text-rose-400 hover:text-rose-300")}
							onClick={() => onReset(c, "hard")}
						>
							<RotateCcw size={12} /> 硬回退
						</button>
					</div>

					{customFor && (
						<form
							className="mt-1 flex flex-col gap-1 rounded border border-neutral-800 bg-neutral-900/60 p-1.5"
							onSubmit={(e) => {
								e.preventDefault();
								if (currentCustom.trim()) onStart(c.sha, currentCustom.trim());
							}}
						>
							<div className="flex gap-1">
								<input
									autoFocus
									list={`history-${c.sha}`}
									value={currentCustom}
									onChange={(e) => onCustomChange(e.target.value)}
									onKeyDown={(e) => {
										if (isComposing(e)) return;
										if (e.key === "Enter") {
											e.preventDefault();
											if (currentCustom.trim()) onStart(c.sha, currentCustom.trim());
										}
									}}
									placeholder="例如 pnpm dev --port 5180"
									className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
								/>
								<datalist id={`history-${c.sha}`}>
									{cmdHistory.map((h) => (
										<option key={h} value={h} />
									))}
								</datalist>
								<button
									type="submit"
									disabled={!currentCustom.trim() || busy}
									className="rounded bg-indigo-600 px-2 text-[11px] text-white hover:bg-indigo-500 disabled:opacity-40"
								>
									运行
								</button>
							</div>
							{cmdHistory.length > 0 && (
								<div className="flex flex-wrap items-center gap-1 text-[10px] text-neutral-500">
									<span>历史:</span>
									{cmdHistory.slice(0, 3).map((cmd) => (
										<button
											key={cmd}
											type="button"
											onClick={() => onCustomHistoryPick(cmd)}
											className="rounded bg-neutral-800/80 px-1 py-0.5 font-mono text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
										>
											{cmd}
										</button>
									))}
								</div>
							)}
						</form>
					)}
				</div>
			)}

			{run && (expanded || run.pid) && (
				<div className="mt-1 pl-1">
					<TmRunCard run={run} onGone={() => onRunGone(run.id)} />
				</div>
			)}
		</li>
	);
}

/** 时光机: uncommitted changes on top, commit timeline grouped by day. */
export function TimelineSection({
	cwd,
	summary,
	commits,
	runs,
	hasMore,
	loadingMore,
	onLoadMore,
	onDiff,
	onRunsChange,
	onChanged,
}: {
	cwd: string;
	summary: GitSummary;
	commits: GitCommit[];
	runs: TmRun[];
	hasMore?: boolean;
	loadingMore?: boolean;
	onLoadMore?: () => void;
	onDiff: (sha?: string, title?: string) => void;
	onRunsChange: (runs: TmRun[]) => void;
	onChanged: () => void;
}) {
	const [collapsed, setCollapsed] = useState(false);
	const [open, setOpen] = useState<string | null>(null);
	const [customFor, setCustomFor] = useState<string | null>(null);
	const [customCommands, setCustomCommands] = useState<Record<string, string>>({});
	const [cmdHistory, setCmdHistory] = useState<string[]>(() => {
		try {
			const raw = localStorage.getItem(HISTORY_KEY);
			return raw ? JSON.parse(raw) : ["pnpm dev", "npm run dev", "cargo run"];
		} catch {
			return ["pnpm dev", "npm run dev", "cargo run"];
		}
	});
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [dayToggles, setDayToggles] = useState<Record<string, boolean>>({});

	// Filter state
	const [filterText, setFilterText] = useState("");
	const [onlyWithFiles, setOnlyWithFiles] = useState(false);

	// Check if commit items have `files` field (Requirement 3: 可选 "只看有代码变更"（若数据有 files 字段）)
	const hasFilesData = useMemo(
		() => commits.some((c) => Array.isArray((c as unknown as { files?: unknown[] }).files)),
		[commits],
	);

	// Filter commits by message / sha / author / files
	const filteredCommits = useMemo(() => {
		const query = filterText.trim().toLowerCase();
		return commits.filter((c) => {
			if (query) {
				const matchSubject = c.subject.toLowerCase().includes(query);
				const matchSha = c.sha.toLowerCase().includes(query) || c.short.toLowerCase().includes(query);
				const matchAuthor = c.author.toLowerCase().includes(query);
				if (!matchSubject && !matchSha && !matchAuthor) {
					return false;
				}
			}
			if (onlyWithFiles && hasFilesData) {
				const files = (c as unknown as { files?: unknown[] }).files;
				if (!files || files.length === 0) return false;
			}
			return true;
		});
	}, [commits, filterText, onlyWithFiles, hasFilesData]);

	// Group filtered commits by calendar day
	const dayGroups = useMemo(() => {
		const map = new Map<string, { date: Date; items: GitCommit[] }>();
		const order: string[] = [];
		for (const c of filteredCommits) {
			const parsed = new Date(c.ts);
			const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
			const key = dayKey(d);
			if (!map.has(key)) {
				map.set(key, { date: d, items: [] });
				order.push(key);
			}
			map.get(key)!.items.push(c);
		}
		const now = new Date();
		const todayKey = dayKey(now);
		const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
		const yestKey = dayKey(yest);

		return order.map((key) => {
			const group = map.get(key)!;
			const isToday = key === todayKey;
			const isYest = key === yestKey;
			return {
				key,
				label: formatDayLabel(group.date, now),
				date: group.date,
				items: group.items,
				isRecent: isToday || isYest,
			};
		});
	}, [filteredCommits]);

	const hasRecent = useMemo(() => dayGroups.some((g) => g.isRecent), [dayGroups]);
	const isSearching = filterText.trim().length > 0;

	const isGroupOpen = (g: (typeof dayGroups)[number], index: number) => {
		if (dayToggles[g.key] !== undefined) {
			return dayToggles[g.key];
		}
		if (isSearching) {
			return true;
		}
		// Default: today and yesterday expanded, older folded (if no recent commits, default first open)
		return g.isRecent || (!hasRecent && index === 0);
	};

	const toggleDay = (key: string, currentOpen: boolean) =>
		setDayToggles((prev) => ({ ...prev, [key]: !currentOpen }));

	const runFor = (sha: string) => runs.find((r) => r.sha === sha);

	const saveHistory = (cmd: string) => {
		const trimmed = cmd.trim();
		if (!trimmed) return;
		setCmdHistory((prev) => {
			const next = [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, 10);
			try {
				localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
			} catch {
				// ignore storage errors
			}
			return next;
		});
	};

	const start = async (sha: string, command?: string) => {
		setBusy(sha);
		setError(null);
		if (command) saveHistory(command);
		try {
			const run = await tmRun(cwd, sha, command);
			onRunsChange([...runs.filter((r) => r.id !== run.id), run]);
			setOpen(sha);
			toast.success(command ? `已启动自定义命令: ${command}` : "已启动时光机运行");
		} catch (e) {
			setError(errMsg(e));
			toast.error(errMsg(e));
		} finally {
			setBusy(null);
		}
	};

	const reset = async (c: GitCommit, mode: "soft" | "hard") => {
		const dirty = summary.hasUncommitted
			? `\n\n⚠️ 当前有 ${summary.files.length} 个文件未提交。`
			: "";
		if (mode === "soft") {
			const ok = await confirmDialog(
				`软回退到 ${c.short}「${c.subject}」？\n之后的提交会被撤销，但改动保留在工作区。${dirty}`,
			);
			if (!ok) return;
		} else {
			const ok = await confirmDialog(
				`硬回退到 ${c.short}「${c.subject}」？\n\n⚠️ 注意：后端无法自动保存快照 (Stash)。回退后，该版本之后的所有提交和当前未提交的改动都会被永久丢弃，无法撤销与恢复！${dirty}`,
				{
					danger: true,
					title: "硬回退确认",
					okLabel: "确认丢弃并回退",
				},
			);
			if (!ok) return;
		}
		setError(null);
		try {
			await gitResetTo(cwd, c.sha, mode);
			toast.success(`已${mode === "soft" ? "软" : "硬"}回退到 ${c.short}`);
			onChanged();
		} catch (e) {
			setError(errMsg(e));
			toast.error(errMsg(e));
		}
	};

	const copySha = async (sha: string, short: string) => {
		await copyText(sha);
		toast.success(`已复制 ${short}`);
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
						className={clsx("text-neutral-400 transition-transform", collapsed && "-rotate-90")}
					/>
					<History size={13} className="text-sky-400" />
					<span>时光机</span>
					{commits.length > 0 && (
						<span className="rounded-full bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
							{filteredCommits.length !== commits.length
								? `${filteredCommits.length}/${commits.length}`
								: commits.length}
						</span>
					)}
				</button>
			</div>

			{!collapsed && (
				<div className="border-t border-neutral-800 px-3 pb-2 pt-1.5">
					{error && <div className="mb-1 text-[11px] text-rose-400">{error}</div>}

					{summary.hasUncommitted && (
						<div className="mb-2 flex items-center gap-1 rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1 text-xs text-amber-300">
							<span className="flex-1 truncate">未提交的改动（{summary.files.length} 个文件）</span>
							<button
								type="button"
								className={btn}
								onClick={() => onDiff(undefined, "未提交的改动")}
								title="查看所有未提交改动的 Diff"
							>
								<FileDiff size={12} /> diff
							</button>
						</div>
					)}

					{/* Filter & Search Bar */}
					{commits.length > 0 && (
						<div className="mb-2 flex items-center gap-1.5">
							<div className="relative flex-1">
								<Search
									size={12}
									className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
								/>
								<input
									type="text"
									value={filterText}
									onChange={(e) => setFilterText(e.target.value)}
									placeholder="搜索提交信息 / 作者 / SHA..."
									className="w-full rounded border border-neutral-800 bg-neutral-950/70 pl-6 pr-6 py-1 text-xs text-neutral-200 placeholder:text-neutral-600 outline-none focus:border-neutral-700 focus:bg-neutral-950 transition-colors"
								/>
								{filterText && (
									<button
										type="button"
										onClick={() => setFilterText("")}
										className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-500 hover:text-neutral-300"
										title="清除"
									>
										<X size={12} />
									</button>
								)}
							</div>
							{hasFilesData && (
								<label className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200 cursor-pointer shrink-0 select-none">
									<input
										type="checkbox"
										checked={onlyWithFiles}
										onChange={(e) => setOnlyWithFiles(e.target.checked)}
										className="rounded border-neutral-700 bg-neutral-900 text-indigo-500 focus:ring-0"
									/>
									<span>仅代码变更</span>
								</label>
							)}
						</div>
					)}

					{commits.length === 0 && (
						<div className="py-2 text-xs text-neutral-500">还没有提交记录</div>
					)}

					{commits.length > 0 && filteredCommits.length === 0 && (
						<div className="py-3 text-center text-xs text-neutral-500">
							<p>未找到匹配的提交</p>
							{filterText && (
								<button
									type="button"
									onClick={() => setFilterText("")}
									className="mt-1 text-[11px] text-indigo-400 hover:text-indigo-300 underline"
								>
									清除搜索条件
								</button>
							)}
						</div>
					)}

					{dayGroups.map((g, index) => {
						const dayOpen = isGroupOpen(g, index);
						return (
							<div key={g.key} className="mb-2 last:mb-0">
								<button
									type="button"
									onClick={() => toggleDay(g.key, dayOpen)}
									className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200 transition-colors group"
								>
									<div className="flex items-center gap-1.5 min-w-0">
										{dayOpen ? (
											<ChevronDown
												size={12}
												className="shrink-0 text-neutral-500 group-hover:text-neutral-300 transition-transform"
											/>
										) : (
											<ChevronRight
												size={12}
												className="shrink-0 text-neutral-500 group-hover:text-neutral-300 transition-transform"
											/>
										)}
										<span
											className={clsx(
												"font-medium tracking-tight",
												g.isRecent ? "text-neutral-200" : "text-neutral-400",
											)}
										>
											{g.label}
										</span>
									</div>
									<span className="font-mono text-[10px] text-neutral-500 rounded bg-neutral-800/60 px-1.5 py-0.5">
										{g.items.length}
									</span>
								</button>
								{dayOpen && (
									<ol className="relative ml-2.5 mt-1 border-l border-neutral-800/80 space-y-0.5">
										{g.items.map((c) => {
											const run = runFor(c.sha);
											return (
												<CommitRow
													key={c.sha}
													c={c}
													run={run}
													expanded={open === c.sha}
													currentCustom={customCommands[c.sha] ?? ""}
													customFor={customFor === c.sha}
													busy={busy === c.sha}
													cmdHistory={cmdHistory}
													onToggleOpen={() =>
														setOpen(open === c.sha ? null : c.sha)
													}
													onDiff={onDiff}
													onStart={(sha, cmd) => void start(sha, cmd)}
													onCustomFor={() =>
														setCustomFor(customFor === c.sha ? null : c.sha)
													}
													onCustomChange={(v) =>
														setCustomCommands((prev) => ({ ...prev, [c.sha]: v }))
													}
													onCustomHistoryPick={(cmd) =>
														setCustomCommands((prev) => ({ ...prev, [c.sha]: cmd }))
													}
													onReset={(cc, mode) => void reset(cc, mode)}
													onCopySha={(sha, short) => void copySha(sha, short)}
													onRunGone={(id) =>
														onRunsChange(runs.filter((r) => r.id !== id))
													}
												/>
											);
										})}
									</ol>
								)}
							</div>
						);
					})}

					{hasMore && (
						<div className="mt-2">
							<button
								type="button"
								disabled={loadingMore}
								onClick={onLoadMore}
								className="w-full rounded border border-neutral-800 bg-neutral-900/60 py-1 text-center text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
							>
								{loadingMore ? "正在加载更多提交…" : "加载更多提交…"}
							</button>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
