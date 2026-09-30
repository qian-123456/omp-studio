import clsx from "clsx";
import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	Clock,
	Edit2,
	ExternalLink,
	Folder,
	GitBranch,
	Loader2,
	Play,
	Trash2,
	XCircle,
} from "lucide-react";
import React, { useState } from "react";
import type { Schedule, ScheduleRun } from "../../lib/contracts";
import { useUi } from "../../stores/ui";
import { Switch } from "../settings/Switch";
import { formatCadence, formatRelativeTime } from "./humanCadence";

interface Props {
	schedule: Schedule;
	runs: ScheduleRun[];
	isExpanded: boolean;
	isRunning: boolean;
	onToggleExpanded: () => void;
	onToggleEnabled: (enabled: boolean) => void;
	onRunNow: () => void;
	onEdit: () => void;
	onDelete: () => void;
}

export const ScheduleRow = React.memo(function ScheduleRow({
	schedule,
	runs,
	isExpanded,
	isRunning,
	onToggleExpanded,
	onToggleEnabled,
	onRunNow,
	onEdit,
	onDelete,
}: Props) {
	const [confirmDelete, setConfirmDelete] = useState(false);
	const selectSession = useUi((s) => s.selectSession);

	// Runs load lazily on expand; the list row carries the latest status.
	const lastRunStatus = runs[0]?.status ?? schedule.lastRunStatus ?? undefined;

	const handleOpenSession = (sessionId: string | null) => {
		if (sessionId) {
			selectSession(sessionId);
		}
	};

	return (
		<div className="border border-[var(--border-divider)] rounded-xl bg-[var(--bg-panel)] shadow-sm overflow-hidden transition-all">
			{/* Main task card row */}
			<div className="p-4 flex items-center justify-between gap-4">
				{/* Left: Info */}
				<div className="min-w-0 flex-1 space-y-1.5">
					<div className="flex items-center gap-2.5">
						<button
							type="button"
							onClick={onToggleExpanded}
							className="p-0.5 rounded text-neutral-400 hover:text-neutral-200 transition-colors"
							title={isExpanded ? "收起执行记录" : "展开执行记录"}
						>
							{isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
						</button>

						<h3 className="font-semibold text-sm text-neutral-100 truncate">
							{schedule.name}
						</h3>

						{/* Worktree badge */}
						{schedule.runMode === "worktree" && (
							<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
								<GitBranch size={11} />
								<span>Worktree</span>
							</span>
						)}

						{/* Last run status badge */}
						<StatusBadge status={lastRunStatus} isRunningNow={isRunning} />
					</div>

					{/* Meta line */}
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-400 pl-6">
						<span className="inline-flex items-center gap-1.5 font-medium text-neutral-300">
							<Clock size={12} className="text-neutral-400" />
							{formatCadence(schedule.cadence)}
						</span>

						<span className="inline-flex items-center gap-1.5 text-neutral-400 truncate max-w-xs">
							<Folder size={12} className="text-neutral-400" />
							<span className="truncate" title={schedule.cwd}>
								{schedule.cwd}
							</span>
						</span>

						{schedule.enabled && schedule.nextRunAt && (
							<span className="text-neutral-400">
								下次：{formatRelativeTime(schedule.nextRunAt)}
							</span>
						)}

						{schedule.lastRunAt && (
							<span className="text-neutral-500">
								上次：{formatRelativeTime(schedule.lastRunAt)}
							</span>
						)}
					</div>
				</div>

				{/* Right: Actions */}
				<div className="flex items-center gap-3 shrink-0">
					{/* Enable switch */}
					<div className="flex items-center gap-2">
						<Switch
							checked={schedule.enabled}
							onChange={onToggleEnabled}
						/>
						<span className="text-xs text-neutral-400 w-7">
							{schedule.enabled ? "启用" : "暂停"}
						</span>
					</div>

					<div className="h-4 w-[1px] bg-[var(--border-divider)]" />

					{/* Run now button */}
					<button
						type="button"
						disabled={isRunning}
						onClick={onRunNow}
						className={clsx(
							"px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors border",
							isRunning
								? "opacity-50 cursor-not-allowed bg-[var(--bg)] border-[var(--border-divider)] text-neutral-400"
								: "bg-[var(--bg)] hover:bg-[var(--bg-hover)] border-[var(--border-divider)] text-neutral-200 hover:text-white",
						)}
						title="立即触发一次执行"
					>
						{isRunning ? (
							<Loader2 size={12} className="animate-spin text-sky-400" />
						) : (
							<Play size={12} className="text-sky-400" />
						)}
						<span>立即运行</span>
					</button>

					{/* Edit button */}
					<button
						type="button"
						onClick={onEdit}
						className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-[var(--bg-hover)] transition-colors"
						title="编辑任务"
					>
						<Edit2 size={14} />
					</button>

					{/* Delete button with confirm */}
					{confirmDelete ? (
						<div className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 rounded-md px-2 py-1">
							<span className="text-[11px] text-rose-300">删除?</span>
							<button
								type="button"
								onClick={() => {
									onDelete();
									setConfirmDelete(false);
								}}
								className="text-[11px] text-rose-400 hover:text-rose-200 font-bold"
							>
								确定
							</button>
							<button
								type="button"
								onClick={() => setConfirmDelete(false)}
								className="text-[11px] text-neutral-400 hover:text-neutral-200"
							>
								取消
							</button>
						</div>
					) : (
						<button
							type="button"
							onClick={() => setConfirmDelete(true)}
							className="p-1.5 rounded-md text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
							title="删除任务"
						>
							<Trash2 size={14} />
						</button>
					)}
				</div>
			</div>

			{/* Expandable run history */}
			{isExpanded && (
				<div className="border-t border-[var(--border-divider)] bg-[var(--bg)]/50 px-5 py-3">
					<div className="flex items-center justify-between mb-2">
						<span className="text-xs font-semibold text-neutral-400">
							历史运行记录（近 10 次）
						</span>
						{runs.length === 0 && (
							<span className="text-xs text-neutral-500">暂无运行历史</span>
						)}
					</div>

					{runs.length > 0 && (
						<div className="space-y-1.5">
							{runs.map((r) => (
								<div
									key={r.id}
									className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[var(--bg-panel)] border border-[var(--border-divider)] text-xs"
								>
									<div className="flex items-center gap-2.5 min-w-0 flex-1">
										<RunStatusIcon status={r.status} />
										<span className="text-neutral-400 shrink-0">
											{new Date(r.startedAt).toLocaleString("zh-CN", {
												month: "2-digit",
												day: "2-digit",
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
										{r.summary ? (
											<span className="text-neutral-300 truncate font-mono text-[11px]">
												{r.summary}
											</span>
										) : (
											<span className="text-neutral-500 italic">无摘要</span>
										)}
									</div>

									{r.sessionId && (
										<button
											type="button"
											onClick={() => handleOpenSession(r.sessionId)}
											className="shrink-0 text-[#0A84FF] hover:underline flex items-center gap-1 text-[11px]"
											title="在主工作台打开该会话"
										>
											<span>查看会话</span>
											<ExternalLink size={11} />
										</button>
									)}
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
});

function StatusBadge({
	status,
	isRunningNow,
}: {
	status?: "running" | "ok" | "error" | "skipped";
	isRunningNow: boolean;
}) {
	if (isRunningNow || status === "running") {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">
				<Loader2 size={10} className="animate-spin" />
				<span>运行中</span>
			</span>
		);
	}
	if (status === "ok") {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
				<CheckCircle2 size={10} />
				<span>成功</span>
			</span>
		);
	}
	if (status === "error") {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium">
				<XCircle size={10} />
				<span>失败</span>
			</span>
		);
	}
	if (status === "skipped") {
		return (
			<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
				<AlertCircle size={10} />
				<span>已跳过</span>
			</span>
		);
	}
	return (
		<span className="px-1.5 py-0.5 rounded text-[10px] bg-neutral-500/10 text-neutral-400 border border-neutral-500/20">
			未运行
		</span>
	);
}

function RunStatusIcon({ status }: { status: "running" | "ok" | "error" | "skipped" }) {
	if (status === "running") {
		return <Loader2 size={14} className="animate-spin text-sky-400 shrink-0" />;
	}
	if (status === "ok") {
		return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
	}
	if (status === "error") {
		return <XCircle size={14} className="text-rose-400 shrink-0" />;
	}
	return <AlertCircle size={14} className="text-amber-400 shrink-0" />;
}
