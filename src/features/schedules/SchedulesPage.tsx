import clsx from "clsx";
import {
	CalendarClock,
	Clock,
	Info,
	Plus,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { useEffect } from "react";
import type { ScheduleDraft } from "../../lib/contracts";
import { ScheduleEditorModal } from "./ScheduleEditorModal";
import { ScheduleRow } from "./ScheduleRow";
import { useSchedulesStore } from "./schedulesStore";

interface Template {
	title: string;
	desc: string;
	draft: Partial<ScheduleDraft>;
}

const TEMPLATES: Template[] = [
	{
		title: "每天早上总结昨天的提交",
		desc: "每工作日 09:00 自动拉取最近 24 小时提交并生成工作早报",
		draft: {
			name: "每天早上总结昨天的提交",
			prompt:
				"请查看仓库最近 24 小时（或昨天的所有 git commit 提交记录），分析各个改动的主要内容，生成一份简明的工作总结报告，列出完成的功能和修复的 Bug。",
			cadence: {
				kind: "daily",
				time: "09:00",
				weekdays: [1, 2, 3, 4, 5],
			},
			approvalMode: "write",
			runMode: "local",
		},
	},
	{
		title: "每工作日检查依赖安全更新",
		desc: "每工作日 10:00 自动检查 package.json / Cargo.toml 漏洞与过时版本",
		draft: {
			name: "每工作日检查依赖安全更新",
			prompt:
				"请检查当前项目的依赖配置文件（如 package.json、Cargo.toml 等），分析是否有已知的安全漏洞、安全通告或主版本过期的依赖项，并输出一份安全评估简报与升级建议。",
			cadence: {
				kind: "daily",
				time: "10:00",
				weekdays: [1, 2, 3, 4, 5],
			},
			approvalMode: "write",
			runMode: "local",
		},
	},
	{
		title: "每周五梳理待办与未完成任务",
		desc: "每周五 17:00 自动扫描代码中的 TODO / FIXME 注释并整理清单",
		draft: {
			name: "每周五梳理待办与未完成任务",
			prompt:
				"请扫描当前代码库中的 TODO、FIXME 注释以及未完成的代码项，按模块梳理出本周待办清单，并给出优先级建议。",
			cadence: {
				kind: "daily",
				time: "17:00",
				weekdays: [5],
			},
			approvalMode: "write",
			runMode: "local",
		},
	},
];

export function SchedulesPage() {
	const schedules = useSchedulesStore((s) => s.schedules);
	const runs = useSchedulesStore((s) => s.runs);
	const loading = useSchedulesStore((s) => s.loading);
	const runningScheduleIds = useSchedulesStore((s) => s.runningScheduleIds);
	const expandedRuns = useSchedulesStore((s) => s.expandedRuns);
	const isEditorOpen = useSchedulesStore((s) => s.isEditorOpen);
	const editingSchedule = useSchedulesStore((s) => s.editingSchedule);
	const draftTemplate = useSchedulesStore((s) => s.draftTemplate);

	const load = useSchedulesStore((s) => s.load);
	const toggleExpanded = useSchedulesStore((s) => s.toggleExpanded);
	const toggleEnabled = useSchedulesStore((s) => s.toggleEnabled);
	const runNow = useSchedulesStore((s) => s.runNow);
	const removeSchedule = useSchedulesStore((s) => s.removeSchedule);
	const saveSchedule = useSchedulesStore((s) => s.saveSchedule);
	const openCreate = useSchedulesStore((s) => s.openCreate);
	const openEdit = useSchedulesStore((s) => s.openEdit);
	const closeEditor = useSchedulesStore((s) => s.closeEditor);

	useEffect(() => {
		void load();
	}, [load]);

	return (
		<div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)] text-neutral-200">
			{/* Header */}
			<div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-divider)] bg-[var(--bg-panel)] shrink-0">
				<div className="flex items-center gap-3">
					<div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center">
						<CalendarClock size={18} />
					</div>
					<div>
						<h1 className="text-base font-semibold text-neutral-100 flex items-center gap-2">
							<span>定时任务</span>
							<span className="text-xs px-2 py-0.5 rounded-full bg-neutral-500/10 text-neutral-400 font-normal">
								{schedules.length}
							</span>
						</h1>
						<p className="text-xs text-neutral-400 mt-0.5">
							按预设周期自动触发 Agent 提示词，可在本地目录或独立 Git Worktree 中运行
						</p>
					</div>
				</div>

				<div className="flex items-center gap-3">
					<button
						type="button"
						onClick={() => load()}
						className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-[var(--bg-hover)] transition-colors"
						title="刷新任务列表"
					>
						<RefreshCw size={14} className={clsx(loading && "animate-spin")} />
					</button>

					<button
						type="button"
						onClick={() => openCreate()}
						className="px-3 py-1.5 rounded-lg bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm transition-all"
					>
						<Plus size={14} />
						<span>新建任务</span>
					</button>
				</div>
			</div>

			{/* Always-running notice banner */}
			<div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 text-xs text-amber-300 shrink-0">
				<Info size={14} className="shrink-0 text-amber-400" />
				<span>
					提示：定时任务依赖本地工作台进程调度，<strong>应用需保持运行</strong>
					才能按时触发。如果错过执行时间，将在应用启动时自动补跑一次。
				</span>
			</div>

			{/* Main content body */}
			<div className="flex-1 overflow-y-auto px-6 py-5">
				{schedules.length === 0 ? (
					<div className="max-w-2xl mx-auto py-10 space-y-8">
						{/* Empty explanation box */}
						<div className="text-center space-y-3">
							<div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center mx-auto">
								<Clock size={24} />
							</div>
							<h2 className="text-base font-medium text-neutral-100">
								暂无定时任务
							</h2>
							<p className="text-xs text-neutral-400 max-w-md mx-auto leading-relaxed">
								定时任务可以在特定时间或周期自动向 Agent 发送提示词，执行代码巡检、提交总结或日常巡检，结果将自动记录并同步至收件箱。
							</p>
							<div className="pt-2">
								<button
									type="button"
									onClick={() => openCreate()}
									className="px-4 py-2 rounded-lg bg-[#0A84FF] hover:bg-[#0A84FF]/90 text-white font-medium text-xs inline-flex items-center gap-1.5 shadow-sm transition-all"
								>
									<Plus size={14} />
									<span>创建第一个任务</span>
								</button>
							</div>
						</div>

						{/* Templates section */}
						<div className="border border-[var(--border-divider)] rounded-xl bg-[var(--bg-panel)] p-5 space-y-3">
							<div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
								<Sparkles size={14} className="text-amber-400" />
								<span>从常用模板快速创建</span>
							</div>

							<div className="grid grid-cols-1 gap-2.5">
								{TEMPLATES.map((tmpl) => (
									<button
										key={tmpl.title}
										type="button"
										onClick={() => openCreate(tmpl.draft)}
										className="p-3.5 rounded-lg border border-[var(--border-divider)] bg-[var(--bg)] hover:bg-[var(--bg-hover)] hover:border-neutral-500 text-left transition-all group flex items-center justify-between gap-4"
									>
										<div className="space-y-1 min-w-0">
											<div className="text-xs font-medium text-neutral-200 group-hover:text-[var(--text)]">
												{tmpl.title}
											</div>
											<div className="text-[11px] text-neutral-400 line-clamp-1">
												{tmpl.desc}
											</div>
										</div>
										<span className="shrink-0 text-xs text-[#0A84FF] font-medium opacity-0 group-hover:opacity-100 transition-opacity">
											使用模板 →
										</span>
									</button>
								))}
							</div>
						</div>
					</div>
				) : (
					/* Schedules cards list */
					<div className="max-w-4xl mx-auto space-y-3">
						{schedules.map((schedule) => (
							<ScheduleRow
								key={schedule.id}
								schedule={schedule}
								runs={runs[schedule.id] ?? []}
								isExpanded={!!expandedRuns[schedule.id]}
								isRunning={!!runningScheduleIds[schedule.id]}
								onToggleExpanded={() => toggleExpanded(schedule.id)}
								onToggleEnabled={(enabled) => toggleEnabled(schedule.id, enabled)}
								onRunNow={() => runNow(schedule.id)}
								onEdit={() => openEdit(schedule)}
								onDelete={() => removeSchedule(schedule.id)}
							/>
						))}
					</div>
				)}
			</div>

			{/* Editor modal */}
			<ScheduleEditorModal
				isOpen={isEditorOpen}
				onClose={closeEditor}
				editingSchedule={editingSchedule}
				template={draftTemplate}
				onSave={saveSchedule}
			/>
		</div>
	);
}
