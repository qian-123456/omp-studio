import clsx from "clsx";
import { Check, GitCommit, Loader2, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import type { GitSummary } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { gitCommit, gitCommitSuggest } from "../../lib/ipc";
import { toast } from "../../lib/toast";

interface CommitSectionProps {
	cwd: string;
	summary: GitSummary;
	onCommitted?: () => void;
}

export function CommitSection({ cwd, summary, onCommitted }: CommitSectionProps) {
	const [message, setMessage] = useState("");
	const [stageAll, setStageAll] = useState(true);
	const [loadingSuggest, setLoadingSuggest] = useState(false);
	const [loadingCommit, setLoadingCommit] = useState(false);

	const files = summary.files ?? [];
	const hasChanges = summary.hasUncommitted || files.length > 0;

	const handleSuggest = useCallback(async () => {
		if (!hasChanges) {
			toast.info("没有检测到任何未提交的改动");
			return;
		}
		setLoadingSuggest(true);
		try {
			const suggested = await gitCommitSuggest(cwd);
			if (suggested?.trim()) {
				setMessage(suggested.trim());
				toast.success("AI 提交信息已生成");
			} else {
				toast.error("未生成有效的提交信息");
			}
		} catch (e) {
			toast.error(`生成提交信息失败: ${errMsg(e)}`);
		} finally {
			setLoadingSuggest(false);
		}
	}, [cwd, hasChanges]);

	const handleCommit = useCallback(async () => {
		const trimmedMsg = message.trim();
		if (!trimmedMsg) {
			toast.error("请输入提交信息");
			return;
		}
		if (!hasChanges) {
			toast.info("没有可提交的改动");
			return;
		}

		// User confirm showing final message
		const confirmed = await confirmDialog(
			`确定要提交以下改动吗？\n\n提交信息：\n${trimmedMsg}`,
			{
				title: "确认 Git 提交",
				okLabel: "确认提交",
			},
		);
		if (!confirmed) return;

		setLoadingCommit(true);
		try {
			await gitCommit(cwd, trimmedMsg, stageAll);
			toast.success("提交成功");
			setMessage("");
			onCommitted?.();
		} catch (e) {
			toast.error(`提交失败: ${errMsg(e)}`);
			setLoadingCommit(false);
		}
	}, [cwd, message, hasChanges, stageAll, onCommitted]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			if (!loadingCommit && !loadingSuggest && message.trim() && hasChanges) {
				void handleCommit();
			}
		}
	};

	return (
		<section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-2.5">
			<div className="flex items-center justify-between pb-2">
				<div className="flex items-center gap-1.5 text-xs font-medium text-neutral-300">
					<GitCommit size={13} className="text-indigo-400" />
					<span>提交改动</span>
					{hasChanges ? (
						<span className="rounded-full bg-indigo-950/80 border border-indigo-800/60 px-1.5 py-0.2 text-[10px] font-mono text-indigo-300">
							{files.length} 个文件
						</span>
					) : (
						<span className="text-[11px] text-neutral-500 font-normal">
							(工作区干净)
						</span>
					)}
				</div>
			</div>

			<div className="space-y-2">
				<textarea
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={loadingCommit}
					placeholder={
						hasChanges
							? "输入提交信息 (⌘Enter 快速提交)，或点击「AI 生成」..."
							: "暂无未提交改动"
					}
					rows={3}
					className="w-full resize-y rounded-md border border-neutral-700/80 bg-neutral-950/80 p-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-indigo-500/80 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed font-sans"
				/>

				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleSuggest}
							disabled={loadingSuggest || loadingCommit || !hasChanges}
							aria-label="AI 生成提交信息"
							title={hasChanges ? "根据当前 Diff 生成提交信息" : "没有可生成的改动"}
							className={clsx(
								"flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors border",
								loadingSuggest
									? "border-indigo-700/60 bg-indigo-950/50 text-indigo-300"
									: hasChanges
										? "border-indigo-700/80 bg-indigo-600/20 text-indigo-200 hover:bg-indigo-600/30 hover:text-indigo-100"
										: "border-neutral-800 bg-neutral-800/40 text-neutral-500 cursor-not-allowed opacity-50",
							)}
						>
							{loadingSuggest ? (
								<Loader2 size={12} className="animate-spin text-indigo-300" />
							) : (
								<Sparkles size={12} className="text-indigo-400" />
							)}
							<span>{loadingSuggest ? "生成中…" : "AI 生成"}</span>
						</button>

						{hasChanges && (
							<label className="flex items-center gap-1.5 text-[11px] text-neutral-400 cursor-pointer select-none hover:text-neutral-300 transition-colors">
								<input
									type="checkbox"
									checked={stageAll}
									onChange={(e) => setStageAll(e.target.checked)}
									className="rounded border-neutral-700 bg-neutral-800 text-indigo-500 focus:ring-0"
								/>
								<span>暂存全部改动</span>
							</label>
						)}
					</div>

					<button
						type="button"
						onClick={handleCommit}
						disabled={loadingCommit || loadingSuggest || !message.trim() || !hasChanges}
						aria-label="提交改动"
						title={
							!hasChanges
								? "暂无可提交改动"
								: !message.trim()
									? "请先输入提交信息"
									: "提交到 Git (⌘Enter)"
						}
						className={clsx(
							"flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors shadow-sm",
							loadingCommit
								? "bg-emerald-950/60 text-emerald-300 border border-emerald-800/80"
								: message.trim() && hasChanges
									? "bg-emerald-600 text-white hover:bg-emerald-500"
									: "bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700/50",
						)}
					>
						{loadingCommit ? (
							<Loader2 size={12} className="animate-spin text-emerald-300" />
						) : (
							<Check size={12} />
						)}
						<span>{loadingCommit ? "提交中…" : "提交"}</span>
					</button>
				</div>
			</div>
		</section>
	);
}
