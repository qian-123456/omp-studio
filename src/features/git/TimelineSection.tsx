import clsx from "clsx";
import { ChevronDown, ChevronRight, Copy, FileDiff, History, Play, RotateCcw, Terminal } from "lucide-react";
import { useState } from "react";
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

function dayKey(ts: string): string {
	const d = new Date(ts);
	if (Number.isNaN(d.getTime())) return "unknown";
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
		<li className="group/item relative pb-1.5 pl-3">
			<span
				className={clsx(
					"absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full",
					run?.pid ? "bg-emerald-400" : "bg-neutral-500",
				)}
			/>
			<div className="flex items-start justify-between gap-1">
				<button
					type="button"
					onClick={onToggleOpen}
					className="block min-w-0 flex-1 text-left"
				>
					<div className="truncate text-xs text-neutral-200 hover:text-neutral-100" title={c.subject}>
						{c.subject}
					</div>
					<div className="text-[10px] text-neutral-500">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onCopySha(c.sha, c.short);
							}}
							className="font-mono text-neutral-400 underline decoration-dotted underline-offset-2 hover:text-neutral-200"
							title={`点击复制完整 SHA: ${c.sha}`}
						>
							{c.short}
						</button>{" "}
						· {c.author} · {relativeTime(c.ts)}
					</div>
				</button>

				{/* Row Quick Action Toolbar */}
				<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/item:opacity-100">
					<button
						type="button"
						onClick={() => onDiff(c.sha, `${c.short} ${c.subject}`)}
						title="查看此版本 Diff"
						className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
					>
						<FileDiff size={12} />
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => onStart(c.sha)}
						title="运行此版本 (推断命令: pnpm dev 端口: 自动)"
						className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-emerald-300"
					>
						<Play size={12} />
					</button>
					<button
						type="button"
						onClick={() => onCopySha(c.sha, c.short)}
						title="复制 SHA"
						className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
					>
						<Copy size={12} />
					</button>
				</div>
			</div>

			{expanded && (
				<div className="mt-1 flex flex-wrap gap-0.5">
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
			)}

			{expanded && customFor && (
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

			{run && (expanded || run.pid) && (
				<TmRunCard run={run} onGone={() => onRunGone(run.id)} />
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
	const [closedDays, setClosedDays] = useState<Record<string, boolean>>({});

	// Group commits by calendar day; today/yesterday open, older collapsed.
	const dayGroups = (() => {
		const map = new Map<string, GitCommit[]>();
		const order: string[] = [];
		for (const c of commits) {
			const key = dayKey(c.ts);
			if (!map.has(key)) {
				map.set(key, []);
				order.push(key);
			}
			map.get(key)!.push(c);
		}
		const now = new Date();
		const todayKey = dayKey(now.toISOString());
		const yestKey = dayKey(new Date(now.getTime() - 86400_000).toISOString());
		return order.map((key, i) => ({
			key,
			label: key === todayKey ? "今天" : key === yestKey ? "昨天" : key,
			items: map.get(key)!,
			defaultOpen: i < 2,
		}));
	})();

	const toggleDay = (key: string) =>
		setClosedDays((prev) => ({ ...prev, [key]: !prev[key] }));

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
							{commits.length}
						</span>
					)}
				</button>
			</div>

			{!collapsed && (
				<div className="border-t border-neutral-800 px-3 pb-2 pt-1">
					{error && <div className="mb-1 text-[11px] text-rose-400">{error}</div>}

					{summary.hasUncommitted && (
						<div className="mb-1 flex items-center gap-1 rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1 text-xs text-amber-300">
							<span className="flex-1">未提交的改动（{summary.files.length} 个文件）</span>
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

					{commits.length === 0 && (
						<div className="py-1 text-xs text-neutral-500">还没有提交记录</div>
					)}

					{dayGroups.map((g) => {
						const dayOpen = closedDays[g.key] === undefined ? g.defaultOpen : !closedDays[g.key];
						return (
							<div key={g.key}>
								<button
									type="button"
									onClick={() => toggleDay(g.key)}
									className="flex w-full items-center gap-1.5 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300"
								>
									{dayOpen ? (
										<ChevronDown size={10} className="shrink-0 text-neutral-500" />
									) : (
										<ChevronRight size={10} className="shrink-0 text-neutral-500" />
									)}
									<span>{g.label}</span>
									<span className="font-mono text-neutral-600">({g.items.length})</span>
								</button>
								{dayOpen && (
									<ol className="relative ml-1 border-l border-neutral-700">
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
