import clsx from "clsx";
import { FileDiff, History, Play, RotateCcw, Terminal } from "lucide-react";
import { useState } from "react";
import type { GitCommit, GitSummary, TmRun } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import { gitResetTo, tmRun } from "../../lib/ipc";
import { TmRunCard } from "./TmRunCard";
import { confirmDialog, errMsg } from "./ui";

const btn = "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200";

/** 时光机: uncommitted changes on top, commit timeline with diff/run/reset. */
export function TimelineSection({
	cwd,
	summary,
	commits,
	runs,
	onDiff,
	onRunsChange,
	onChanged,
}: {
	cwd: string;
	summary: GitSummary;
	commits: GitCommit[];
	runs: TmRun[];
	onDiff: (sha?: string, title?: string) => void;
	onRunsChange: (runs: TmRun[]) => void;
	onChanged: () => void;
}) {
	const [open, setOpen] = useState<string | null>(null);
	const [customFor, setCustomFor] = useState<string | null>(null);
	const [custom, setCustom] = useState("");
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const runFor = (sha: string) => runs.find((r) => r.sha === sha);

	const start = async (sha: string, command?: string) => {
		setBusy(sha);
		setError(null);
		try {
			const run = await tmRun(cwd, sha, command);
			onRunsChange([...runs.filter((r) => r.id !== run.id && r.sha !== run.sha), run]);
			setOpen(sha);
			setCustomFor(null);
		} catch (e) {
			setError(errMsg(e));
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
			const ok1 = await confirmDialog(
				`硬回退到 ${c.short}「${c.subject}」？\n之后的提交和所有未提交的改动都会被丢弃，无法恢复。${dirty}`,
				{ danger: true, title: "硬回退" },
			);
			if (!ok1) return;
			const ok2 = await confirmDialog("再次确认：真的要丢弃这些改动吗？", {
				danger: true,
				title: "硬回退",
				okLabel: "丢弃并回退",
			});
			if (!ok2) return;
		}
		setError(null);
		try {
			await gitResetTo(cwd, c.sha, mode);
			onChanged();
		} catch (e) {
			setError(errMsg(e));
		}
	};

	return (
		<section className="border-b border-neutral-800 px-3 py-2">
			<div className="mb-1 flex items-center gap-1 text-xs font-medium text-neutral-300">
				<History size={13} /> 时光机
			</div>
			{error && <div className="mb-1 text-[11px] text-rose-400">{error}</div>}
			<ol className="relative ml-1 border-l border-neutral-700">
				{summary.hasUncommitted && (
					<li className="relative pb-2 pl-3">
						<span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full border border-amber-400 bg-neutral-900" />
						<div className="flex items-center gap-1 text-xs text-amber-300">
							<span className="flex-1">未提交的改动（{summary.files.length} 个文件）</span>
							<button type="button" className={btn} onClick={() => onDiff(undefined, "未提交的改动")}>
								<FileDiff size={12} /> diff
							</button>
						</div>
					</li>
				)}
				{commits.length === 0 && <li className="pl-3 text-xs text-neutral-500">还没有提交记录</li>}
				{commits.map((c) => {
					const run = runFor(c.sha);
					const expanded = open === c.sha;
					return (
						<li key={c.sha} className="relative pb-1.5 pl-3">
							<span
								className={clsx(
									"absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full",
									run?.pid ? "bg-emerald-400" : "bg-neutral-500",
								)}
							/>
							<button
								type="button"
								onClick={() => setOpen(expanded ? null : c.sha)}
								className="block w-full min-w-0 text-left"
							>
								<div className="truncate text-xs text-neutral-200" title={c.subject}>
									{c.subject}
								</div>
								<div className="text-[10px] text-neutral-500">
									<span className="font-mono">{c.short}</span> · {c.author} · {relativeTime(c.ts)}
								</div>
							</button>
							{expanded && (
								<div className="mt-1 flex flex-wrap gap-0.5">
									<button type="button" className={btn} onClick={() => onDiff(c.sha, `${c.short} ${c.subject}`)}>
										<FileDiff size={12} /> 查看 diff
									</button>
									<button type="button" className={btn} disabled={busy === c.sha} onClick={() => start(c.sha)}>
										<Play size={12} /> {busy === c.sha ? "启动中…" : "运行此版本"}
									</button>
									<button type="button" className={btn} onClick={() => setCustomFor(customFor === c.sha ? null : c.sha)}>
										<Terminal size={12} /> 自定义命令
									</button>
									<button type="button" className={btn} onClick={() => reset(c, "soft")}>
										<RotateCcw size={12} /> 软回退
									</button>
									<button type="button" className={clsx(btn, "text-rose-400")} onClick={() => reset(c, "hard")}>
										<RotateCcw size={12} /> 硬回退
									</button>
								</div>
							)}
							{expanded && customFor === c.sha && (
								<form
									className="mt-1 flex gap-1"
									onSubmit={(e) => {
										e.preventDefault();
										if (custom.trim()) start(c.sha, custom.trim());
									}}
								>
									<input
										value={custom}
										onChange={(e) => setCustom(e.target.value)}
										placeholder="例如 pnpm dev --port 5180"
										className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
									/>
									<button type="submit" className="rounded bg-indigo-600 px-2 text-[11px] text-white">
										运行
									</button>
								</form>
							)}
							{run && (expanded || run.pid) && (
								<TmRunCard run={run} onGone={() => onRunsChange(runs.filter((r) => r.id !== run.id))} />
							)}
						</li>
					);
				})}
			</ol>
		</section>
	);
}
