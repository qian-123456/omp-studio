import clsx from "clsx";
import {
	CheckCircle2,
	Clock,
	Copy,
	Edit2,
	Loader2,
	MoreHorizontal,
	Pause,
	PauseCircle,
	PenLine,
	Play,
	Trash2,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { Schedule } from "../../lib/contracts";
import { absoluteTime } from "../../lib/format";
import { isComposing } from "../../lib/hooks";
import { Switch } from "../settings/Switch";
import { formatCadenceWithEnd, formatNextRun } from "./humanCadence";
import { lifecycleOf } from "./scheduleUtils";
import type { EditorTab } from "./schedulesStore";
import { claimEscape } from "../../lib/escapeClaim";

interface Props {
	schedule: Schedule;
	/** A run is actively executing for this schedule. */
	isRunning: boolean;
	/** Last run finished recently and the user has not opened it yet. */
	isUnread: boolean;
	onToggleEnabled: (enabled: boolean) => void;
	onRunNow: () => void;
	onOpen: (tab: EditorTab) => void;
	onDuplicate: () => void;
	onDelete: () => void;
	/** Persist a new display name (already trimmed, non-empty, changed). */
	onRename: (name: string) => void;
}
const MENU_ITEM =
	"flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[var(--text-60)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40 transition-all active:scale-[0.98]";

export const ScheduleRow = React.memo(function ScheduleRow({
	schedule,
	isRunning,
	isUnread,
	onToggleEnabled,
	onRunNow,
	onOpen,
	onDuplicate,
	onDelete,
	onRename,
}: Props) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const menuBtnRef = useRef<HTMLButtonElement>(null);
	const [renaming, setRenaming] = useState(false);
	const [nameDraft, setNameDraft] = useState(schedule.name);
	const nameInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!renaming) return;
		nameInputRef.current?.focus();
		nameInputRef.current?.select();
	}, [renaming]);

	const startRename = () => {
		setNameDraft(schedule.name);
		setRenaming(true);
	};
	const finishRename = (commit: boolean) => {
		setRenaming(false);
		const next = nameDraft.trim();
		if (commit && next && next !== schedule.name) onRename(next);
	};

	const lifecycle = lifecycleOf(schedule);
	const runningNow = isRunning || schedule.lastRunStatus === "running";
	const lastFailed = schedule.lastRunStatus === "error";
	const completed = lifecycle === "completed";

	const subtitle = formatCadenceWithEnd(
		schedule.cadence,
		schedule.endAt,
		schedule.maxRuns,
	);
	const nextRun = schedule.nextRunAt;
	const nextLabel = completed
		? "已完成"
		: !schedule.enabled
			? "已暂停"
			: nextRun
				? `下次运行 ${formatNextRun(nextRun) ?? ""}`
				: "";
	/** "3/10" run progress toward a maxRuns cap. */
	const progress =
		schedule.maxRuns != null && schedule.maxRuns >= 1
			? `${schedule.runsDone ?? 0}/${schedule.maxRuns}`
			: null;
	const statusText = runningNow
		? "正在运行…"
		: lastFailed
			? `上次运行失败${nextLabel ? ` · ${nextLabel}` : ""}`
			: nextLabel;
	const secondary = [progress, statusText].filter(Boolean).join(" · ");

	const closeMenu = () => {
		setMenuOpen(false);
		setConfirmDelete(false);
	};

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => onOpen(lastFailed ? "history" : "settings")}
			onKeyDown={(e) => {
				if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
					e.preventDefault();
					onOpen(lastFailed ? "history" : "settings");
				}
			}}
			className="group flex items-center gap-3.5 rounded-2xl border border-[var(--border-divider)] bg-[var(--bg-panel)] px-4 py-3.5 text-left transition-colors hover:border-[var(--hairline-strong)] hover:bg-[var(--bg-hover)]/40 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--hairline-strong)]"
		>
			{/* Status icon */}
			<span
				className={clsx(
					"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl hairline bg-[var(--bg-hover)]/60",
					runningNow
						? "text-[var(--text)]"
						: completed
							? "text-emerald-400"
							: lastFailed
								? "text-rose-400"
								: "text-[var(--text-40)]",
				)}
				title={
					runningNow
						? "正在运行"
						: completed
							? "已完成"
							: lastFailed
								? "上次运行失败"
								: lifecycle === "paused"
									? "已暂停"
									: "运行中"
				}
			>
				{runningNow ? (
					<Loader2 size={15} className="animate-spin motion-reduce:animate-none" />
				) : completed ? (
					<CheckCircle2 size={15} />
				) : lifecycle === "paused" ? (
					<PauseCircle size={15} />
				) : (
					<Clock size={15} />
				)}
			</span>

			{/* Title + subtitle */}
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					{renaming ? (
						<input
							ref={nameInputRef}
							value={nameDraft}
							aria-label="任务标题"
							maxLength={80}
							onChange={(e) => setNameDraft(e.target.value)}
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (isComposing(e)) return;
								if (e.key === "Enter") {
									e.preventDefault();
									finishRename(true);
								} else if (e.key === "Escape") {
									claimEscape(e);
									finishRename(false);
								}
							}}
							onBlur={() => finishRename(true)}
							className="min-w-0 flex-1 rounded-md bg-[var(--bg)] px-1.5 py-0.5 text-[13px] font-medium text-[var(--text)] hairline-outset focus:outline-none"
						/>
					) : (
						<>
							<h3 className="truncate text-[13px] font-medium text-[var(--text)]">
								{schedule.name}
							</h3>
							<button
								type="button"
								aria-label="重命名"
								title="重命名"
								onClick={(e) => {
									e.stopPropagation();
									startRename();
								}}
								className="shrink-0 rounded p-0.5 text-[var(--text-30)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover:opacity-100"
							>
								<PenLine size={12} />
							</button>
						</>
					)}
					{schedule.runMode === "worktree" && (
						<span className="shrink-0 rounded-md hairline bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-40)]">
							Worktree
						</span>
					)}
					{isUnread && (
						<span
							className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]"
							title="有新的运行结果"
						/>
					)}
				</div>
				<div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-40)]">
					<span className="truncate" title={subtitle}>
						{subtitle}
					</span>
					{(runningNow || nextLabel || lastFailed || progress) && (
						<>
							<span className="shrink-0 text-[var(--text-30)]">·</span>
							<span
								className={clsx(
									"shrink-0",
									lastFailed && !runningNow
										? "text-rose-400"
										: completed
											? "text-emerald-400/80"
											: "text-[var(--text-40)]",
								)}
								title={nextRun ? absoluteTime(nextRun) : undefined}
							>
								{secondary}
							</span>
						</>
					)}
				</div>
			</div>

			{/* Quick pause/resume */}
			<div
				className="flex shrink-0 items-center"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
			>
				<Switch
					checked={schedule.enabled}
					disabled={completed}
					onChange={onToggleEnabled}
					title={
						completed
							? "任务已完成"
							: schedule.enabled
								? "暂停任务"
								: "恢复任务"
					}
					ariaLabel={schedule.enabled ? "暂停任务" : "恢复任务"}
				/>
			</div>

			{/* Overflow menu */}
			<div className="relative shrink-0">
				<button
					ref={menuBtnRef}
					type="button"
					aria-label="更多操作"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					title="更多操作"
					onClick={(e) => {
						e.stopPropagation();
						setConfirmDelete(false);
						setMenuOpen((v) => !v);
					}}
					className={clsx(
						"flex h-7 w-7 items-center justify-center rounded-lg transition-all active:scale-95",
						menuOpen
							? "bg-[var(--bg-active-fill)] text-[var(--text)]"
							: "text-[var(--text-30)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
					)}
				>
					<MoreHorizontal size={14} />
				</button>

				<FloatingLayer
					anchor={menuOpen ? menuBtnRef.current : null}
					placement="bottom-end"
					offset={4}
					layer="menu"
					ignoreRefs={[menuBtnRef]}
					onDismiss={closeMenu}
					role="menu"
					aria-orientation="vertical"
					className="w-48 p-1 text-xs"
				>
					<button
						type="button"
						role="menuitem"
						disabled={runningNow}
						onClick={(e) => {
							e.stopPropagation();
							closeMenu();
							onRunNow();
						}}
						className={MENU_ITEM}
						title="立即触发一次执行"
					>
						<Play size={13} className="shrink-0 text-[var(--text-40)]" />
						<span className="flex-1 truncate">立即运行</span>
					</button>

					<button
						type="button"
						role="menuitem"
						disabled={completed}
						onClick={(e) => {
							e.stopPropagation();
							closeMenu();
							onToggleEnabled(!schedule.enabled);
						}}
						className={MENU_ITEM}
						title={completed ? "任务已完成" : undefined}
					>
						{schedule.enabled ? (
							<Pause size={13} className="shrink-0 text-[var(--text-40)]" />
						) : (
							<Play size={13} className="shrink-0 text-[var(--text-40)]" />
						)}
						<span className="flex-1 truncate">
							{schedule.enabled ? "暂停" : "恢复"}
						</span>
					</button>

					<button
						type="button"
						role="menuitem"
						onClick={(e) => {
							e.stopPropagation();
							closeMenu();
							onOpen("settings");
						}}
						className={MENU_ITEM}
					>
						<Edit2 size={13} className="shrink-0 text-[var(--text-40)]" />
						<span className="flex-1 truncate">编辑</span>
					</button>

					<button
						type="button"
						role="menuitem"
						onClick={(e) => {
							e.stopPropagation();
							closeMenu();
							startRename();
						}}
						className={MENU_ITEM}
					>
						<PenLine size={13} className="shrink-0 text-[var(--text-40)]" />
						<span className="flex-1 truncate">重命名</span>
					</button>

					<button
						type="button"
						role="menuitem"
						onClick={(e) => {
							e.stopPropagation();
							closeMenu();
							onDuplicate();
						}}
						className={MENU_ITEM}
						title="以此任务的配置新建一个任务"
					>
						<Copy size={13} className="shrink-0 text-[var(--text-40)]" />
						<span className="flex-1 truncate">复制</span>
					</button>

					<div className="my-1 border-t border-[var(--border-divider)]" />

					{confirmDelete ? (
						<div className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5">
							<span className="flex-1 text-[11px] text-rose-300">
								删除该任务？
							</span>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									closeMenu();
									onDelete();
								}}
								className="text-[11px] font-bold text-rose-400 hover:text-rose-200"
							>
								删除
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									setConfirmDelete(false);
								}}
								className="text-[11px] text-[var(--text-40)] hover:text-[var(--text)]"
							>
								取消
							</button>
						</div>
					) : (
						<button
							type="button"
							role="menuitem"
							onClick={(e) => {
								e.stopPropagation();
								setConfirmDelete(true);
							}}
							className={clsx(
								MENU_ITEM,
								"text-rose-400 hover:!bg-rose-500/10 hover:!text-rose-300",
							)}
						>
							<Trash2 size={13} className="shrink-0" />
							<span className="flex-1 truncate">删除</span>
						</button>
					)}
				</FloatingLayer>
			</div>
		</div>
	);
});
