import {
	AlertCircle,
	Bot,
	ChevronRight,
	Copy,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FloatingLayer } from "../../../components/FloatingLayer";
import { copyText } from "../../../lib/dialogs";
import { toast } from "../../../lib/toast";
import { useLive } from "../../../stores/live";
import { useUi } from "../../../stores/ui";
import { useSettings } from "../../settings/store";
import { subagentBucket, subagentCounts } from "./counts";

export function TopCapsule() {
	const settings = useSettings((s) => s.settings);
	const loadSettings = useSettings((s) => s.load);
	const selectedSessionId = useUi((s) => s.selectedSessionId);

	const live = useLive((s) =>
		selectedSessionId ? s.sessions[selectedSessionId] : undefined,
	);

	const [openSubPopover, setOpenSubPopover] = useState(false);
	const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	// Auto-collapse popovers when selected session changes
	useEffect(() => {
		setOpenSubPopover(false);
	}, [selectedSessionId]);

	if (settings && !settings.capsuleVisible) {
		return null;
	}

	const subagents = live?.subagents ?? {};
	const subCounts = subagentCounts(subagents);
	const hasSubagents = Object.keys(subagents).length > 0;

	if (!hasSubagents) {
		return null;
	}

	return (
		<div className="relative flex items-center">
			<div className="flex items-center rounded-full border border-neutral-700/80 bg-neutral-800/80 p-0.5 text-xs shadow-sm">
				<button
					ref={triggerRef}
					type="button"
					onClick={() => setOpenSubPopover(!openSubPopover)}
					className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium transition-colors ${
						openSubPopover
							? "bg-neutral-700 text-neutral-100"
							: "text-neutral-300 hover:bg-neutral-700/60 hover:text-neutral-100"
					}`}
					title="查看当前会话的子任务状态"
				>
					<Bot className="h-3.5 w-3.5 text-violet-400" />
					<span>子任务</span>
					{subCounts.running > 0 && (
						<span className="rounded bg-sky-500/20 px-1 py-0.2 text-[10px] text-sky-300">
							{subCounts.running} 运行
						</span>
					)}
					{subCounts.done > 0 && (
						<span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[10px] text-emerald-300">
							{subCounts.done} 完成
						</span>
					)}
					{subCounts.failed > 0 && (
						<span className="rounded bg-rose-500/20 px-1 py-0.2 text-[10px] text-rose-300">
							{subCounts.failed} 失败
						</span>
					)}
				</button>
			</div>

			<FloatingLayer
				anchor={openSubPopover ? triggerRef.current : null}
				placement="bottom-end"
				offset={6}
				layer="popover"
				onDismiss={() => setOpenSubPopover(false)}
				ignoreRefs={[triggerRef]}
				className="w-80 p-3"
			>
				<div className="mb-2 flex items-center justify-between border-b border-neutral-800 pb-2">
					<div className="text-xs font-semibold text-neutral-200">
						子任务列表 ({Object.keys(subagents).length})
					</div>
					<button
						type="button"
						onClick={() => setOpenSubPopover(false)}
						className="text-neutral-500 hover:text-neutral-300"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				<div className="max-h-72 space-y-1.5 overflow-y-auto">
					{Object.entries(subagents).map(([id, sub]) => {
						const agent =
							typeof sub.agent === "string" && sub.agent ? sub.agent : null;
						const task = typeof sub.task === "string" ? sub.task : "";
						const bucket = subagentBucket(String(sub.status ?? ""));
						const isExpanded = expandedSubId === id;

						return (
							<div
								key={id}
								onClick={() =>
									setExpandedSubId(isExpanded ? null : id)
								}
								className={`cursor-pointer rounded-lg border transition-all ${
									isExpanded
										? "border-neutral-700 bg-neutral-900/90 shadow-sm"
										: "border-neutral-800 bg-neutral-950/60 hover:border-neutral-700"
								} p-2 text-xs`}
							>
								<div className="flex items-center justify-between gap-1.5">
									<div className="flex min-w-0 items-center gap-1.5">
										<span className="truncate font-medium text-neutral-200">
											{agent || sub.label || id}
										</span>
										<ChevronRight
											className={`h-3 w-3 shrink-0 text-neutral-500 transition-transform ${
												isExpanded ? "rotate-90" : ""
											}`}
										/>
									</div>

									<span
										className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
											bucket === "failed"
												? "border border-rose-500/30 bg-rose-500/20 text-rose-300"
												: bucket === "running"
													? "bg-sky-500/20 text-sky-300"
													: bucket === "done"
														? "bg-emerald-500/20 text-emerald-300"
														: "bg-neutral-800 text-neutral-400"
										}`}
									>
										{bucket === "failed" && (
											<AlertCircle className="h-2.5 w-2.5 text-rose-400" />
										)}
										<span>{sub.status || "未知"}</span>
									</span>
								</div>

								{task && (
									<div
										className={`mt-1 text-[11px] text-neutral-400 ${
											isExpanded
												? "whitespace-pre-wrap break-words leading-relaxed"
												: "line-clamp-2"
										}`}
									>
										{task}
									</div>
								)}

								{isExpanded && (
									<div
										className="mt-2 space-y-1.5 border-t border-neutral-800/80 pt-2 text-[11px]"
										onClick={(e) => e.stopPropagation()}
									>
										<div className="flex items-center justify-between text-neutral-400">
											<span>
												ID: <code className="text-neutral-300">{id}</code>
											</span>
											<button
												type="button"
												onClick={async () => {
													await copyText(task || id);
													toast.success("已复制任务信息");
												}}
												className="inline-flex items-center gap-1 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100"
											>
												<Copy className="h-2.5 w-2.5" />
												<span>复制</span>
											</button>
										</div>
										{sub.progress?.retryFailure?.errorMessage && (
											<div className="rounded border border-[var(--line)] p-1.5 text-[var(--status-error)]">
												错误: {sub.progress.retryFailure.errorMessage}
											</div>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			</FloatingLayer>
		</div>
	);
}
