import clsx from "clsx";
import {
	Clock,
	Info,
	Plus,
	RefreshCw,
	Search,
	Sparkles,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Segmented } from "../../components/Segmented";
import type { Schedule } from "../../lib/contracts";
import { formatCadence } from "./humanCadence";
import { ScheduleEditorPage } from "./ScheduleEditorPage";
import { ScheduleRow } from "./ScheduleRow";
import {
	TEMPLATES,
	draftFromSchedule,
	isRecentRun,
	lifecycleOf,
	renameDraft,
} from "./scheduleUtils";
import { useSchedulesStore } from "./schedulesStore";

type StatusFilter = "all" | "active" | "paused" | "completed";

const NOTE_KEY = "omp:schedules:bannerDismissed";

/** Quiet dark/neutral primary action (matches the app's composer-style CTA). */
const PRIMARY_BTN =
	"inline-flex items-center gap-1.5 rounded-lg bg-[var(--text)] px-3.5 py-2 text-xs font-medium text-[var(--bg)] transition-opacity hover:opacity-85 active:scale-[0.98] disabled:opacity-40";

export function SchedulesPage() {
	const schedules = useSchedulesStore((s) => s.schedules);
	const runs = useSchedulesStore((s) => s.runs);
	const loading = useSchedulesStore((s) => s.loading);
	const runningScheduleIds = useSchedulesStore((s) => s.runningScheduleIds);
	const seenRuns = useSchedulesStore((s) => s.seenRuns);
	const isEditorOpen = useSchedulesStore((s) => s.isEditorOpen);
	const editingSchedule = useSchedulesStore((s) => s.editingSchedule);
	const draftTemplate = useSchedulesStore((s) => s.draftTemplate);
	const editorTab = useSchedulesStore((s) => s.editorTab);

	const load = useSchedulesStore((s) => s.load);
	const loadRuns = useSchedulesStore((s) => s.loadRuns);
	const toggleEnabled = useSchedulesStore((s) => s.toggleEnabled);
	const runNow = useSchedulesStore((s) => s.runNow);
	const removeSchedule = useSchedulesStore((s) => s.removeSchedule);
	const saveSchedule = useSchedulesStore((s) => s.saveSchedule);
	const openCreate = useSchedulesStore((s) => s.openCreate);
	const openEdit = useSchedulesStore((s) => s.openEdit);
	const closeEditor = useSchedulesStore((s) => s.closeEditor);

	const [noteDismissed, setNoteDismissed] = useState<boolean>(() => {
		try {
			return localStorage.getItem(NOTE_KEY) === "1";
		} catch {
			return false;
		}
	});
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<StatusFilter>("all");

	useEffect(() => {
		void load();
	}, [load]);

	// Fetch the latest run for schedules that might carry an unread result.
	useEffect(() => {
		for (const s of schedules) {
			if (runs[s.id] !== undefined) continue;
			if (
				s.lastRunStatus === "ok" ||
				s.lastRunStatus === "error" ||
				s.lastRunStatus === "running"
			) {
				void loadRuns(s.id, 1);
			}
		}
	}, [schedules, runs, loadRuns]);

	const groups = useMemo(() => {
		const q = query.trim().toLowerCase();
		const matches = (s: Schedule) => {
			if (!q) return true;
			return (
				s.name.toLowerCase().includes(q) ||
				s.prompt.toLowerCase().includes(q) ||
				formatCadence(s.cadence).toLowerCase().includes(q)
			);
		};
		const filtered = schedules.filter(
			(s) => matches(s) && (filter === "all" || lifecycleOf(s) === filter),
		);

		const byNextRun = (a: Schedule, b: Schedule) => {
			// Upcoming runs first, soonest first; never-scheduled last.
			if (a.nextRunAt && b.nextRunAt)
				return a.nextRunAt.localeCompare(b.nextRunAt);
			if (a.nextRunAt) return -1;
			if (b.nextRunAt) return 1;
			return a.name.localeCompare(b.name, "zh-CN");
		};
		const byRecent = (a: Schedule, b: Schedule) =>
			(b.lastRunAt ?? b.updatedAt).localeCompare(a.lastRunAt ?? a.updatedAt);

		return {
			active: filtered
				.filter((s) => lifecycleOf(s) === "active")
				.sort(byNextRun),
			paused: filtered
				.filter((s) => lifecycleOf(s) === "paused")
				.sort(byRecent),
			completed: filtered
				.filter((s) => lifecycleOf(s) === "completed")
				.sort(byRecent),
		};
	}, [schedules, query, filter]);

	const dismissNote = () => {
		setNoteDismissed(true);
		try {
			localStorage.setItem(NOTE_KEY, "1");
		} catch {
			// Best-effort persistence.
		}
	};

	const renderRow = (schedule: Schedule) => {
		const latestRun = runs[schedule.id]?.[0] ?? null;
		return (
			<ScheduleRow
				key={schedule.id}
				schedule={schedule}
				isRunning={!!runningScheduleIds[schedule.id]}
				isUnread={!!latestRun && isRecentRun(latestRun) && !seenRuns[latestRun.id]}
				onToggleEnabled={(enabled) => toggleEnabled(schedule.id, enabled)}
				onRunNow={() => runNow(schedule.id)}
				onOpen={(tab) => openEdit(schedule, tab)}
				onDuplicate={() => openCreate(draftFromSchedule(schedule))}
				onDelete={() => removeSchedule(schedule.id)}
				onRename={(name) => void saveSchedule(renameDraft(schedule, name))}
			/>
		);
	};

	const isFiltering = query.trim().length > 0 || filter !== "all";
	const groupSections: { key: string; title: string; items: Schedule[] }[] = [
		{ key: "active", title: "即将运行", items: groups.active },
		{ key: "paused", title: "已暂停", items: groups.paused },
		{ key: "completed", title: "已完成", items: groups.completed },
	];

	// The editor is a full-page view, not a modal — it replaces the list.
	if (isEditorOpen) {
		return (
			<div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)] text-[var(--text)]">
				<ScheduleEditorPage
					onClose={closeEditor}
					editingSchedule={editingSchedule}
					template={draftTemplate}
					initialTab={editorTab}
					onSave={saveSchedule}
				/>
			</div>
		);
	}

	return (
		<div className="flex-1 flex flex-col h-full overflow-hidden bg-[var(--bg)] text-[var(--text)]">
			{/* Header */}
			<header className="shrink-0 border-b border-[var(--border-divider)]">
				<div className="mx-auto flex max-w-[880px] items-center justify-between gap-4 px-8 py-5">
					<div className="min-w-0">
						<h1 className="flex items-center gap-2.5 text-lg font-semibold text-[var(--text)]">
							<span>定时任务</span>
							<span className="rounded-full bg-[var(--bg-hover)] px-2 py-0.5 text-xs font-normal text-[var(--text-60)]">
								{schedules.length}
							</span>
						</h1>
						<p className="mt-1 text-xs text-[var(--text-40)]">
							按预设时间自动向 Agent 发送指令，运行结果同步至收件箱
						</p>
					</div>

					<div className="flex shrink-0 items-center gap-2">
						<button
							type="button"
							onClick={() => load()}
							className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-40)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
							title="刷新任务列表"
						>
							<RefreshCw
								size={14}
								className={clsx(loading && "animate-spin")}
							/>
						</button>

						<button
							type="button"
							onClick={() => openCreate()}
							className={PRIMARY_BTN}
						>
							<Plus size={14} />
							<span>新建任务</span>
						</button>
					</div>
				</div>
			</header>

			{/* Main content body */}
			<div className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[880px] px-8 py-6">
					{/* Dismissible local-scheduler note */}
					{!noteDismissed && (
						<div className="mb-6 flex items-center gap-2 text-xs leading-relaxed text-[var(--text-40)]">
							<Info size={13} className="shrink-0" />
							<span className="flex-1">
								定时任务依赖本地进程调度，应用需保持运行才能按时触发；错过的时间将在启动时补跑一次。
							</span>
							<button
								type="button"
								onClick={dismissNote}
								className="shrink-0 rounded-md p-1 text-[var(--text-30)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-60)]"
								title="关闭提示"
							>
								<X size={12} />
							</button>
						</div>
					)}

					{/* Toolbar: search + status filter */}
					{schedules.length > 0 && (
						<div className="mb-6 flex items-center justify-between gap-3">
							<div className="relative flex w-56 items-center sm:w-64">
								<Search
									size={13}
									className="pointer-events-none absolute left-3 text-[var(--text-30)]"
								/>
								<input
									type="text"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="搜索任务…"
									className="h-9 w-full rounded-xl hairline bg-[var(--bg-panel)] pl-8 pr-7 text-xs text-[var(--text)] placeholder-neutral-500 transition-all focus:outline-none focus:ring-1 focus:ring-[var(--hairline-strong)]"
								/>
								{query && (
									<button
										type="button"
										onClick={() => setQuery("")}
										className="absolute right-2.5 flex h-4 w-4 items-center justify-center rounded text-[var(--text-40)] hover:text-[var(--text)]"
										title="清除搜索"
									>
										<X size={12} />
									</button>
								)}
							</div>

							<Segmented<StatusFilter>
								size="sm"
								aria-label="按状态筛选"
								value={filter}
								onChange={setFilter}
								options={[
									{ value: "all", label: "全部" },
									{ value: "active", label: "运行中" },
									{ value: "paused", label: "已暂停" },
									{ value: "completed", label: "已完成" },
								]}
							/>
						</div>
					)}

					{schedules.length === 0 ? (
						<div className="mx-auto max-w-2xl space-y-10 py-12">
							{/* Empty explanation */}
							<div className="space-y-4 text-center">
								<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl hairline bg-[var(--bg-panel)] text-[var(--text-40)]">
									<Clock size={22} />
								</div>
								<h2 className="text-base font-semibold text-[var(--text)]">
									暂无定时任务
								</h2>
								<p className="mx-auto max-w-md text-xs leading-relaxed text-[var(--text-40)]">
									定时任务可以在特定时间或周期自动向 Agent
									发送指令，执行代码巡检、提交总结或日常检查，结果将自动记录并同步至收件箱。
								</p>
								<div className="pt-1">
									<button
										type="button"
										onClick={() => openCreate()}
										className={PRIMARY_BTN}
									>
										<Plus size={14} />
										<span>创建第一个任务</span>
									</button>
								</div>
							</div>

							{/* Template quick-create cards */}
							<div className="space-y-3">
								<div className="flex items-center gap-2 px-1 text-xs font-medium text-[var(--text-60)]">
									<Sparkles size={13} className="text-[var(--text-40)]" />
									<span>从常用模板快速创建</span>
								</div>

								<div className="grid grid-cols-1 gap-3">
									{TEMPLATES.map((tmpl) => (
										<button
											key={tmpl.title}
											type="button"
											onClick={() => openCreate(tmpl.draft)}
											className="group flex items-center justify-between gap-4 rounded-2xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-4 text-left transition-all hover:border-[var(--hairline-strong)] hover:bg-[var(--bg-hover)]/40"
										>
											<div className="min-w-0 space-y-1">
												<div className="text-[13px] font-medium text-[var(--text)]">
													{tmpl.title}
												</div>
												<div className="truncate text-xs text-[var(--text-40)]">
													{tmpl.desc}
												</div>
											</div>
											<span className="shrink-0 text-xs font-medium text-[var(--text-30)] transition-colors group-hover:text-[var(--text)]">
												使用模板 →
											</span>
										</button>
									))}
								</div>
							</div>
						</div>
					) : isFiltering &&
						groups.active.length +
							groups.paused.length +
							groups.completed.length ===
							0 ? (
						/* Search / filter empty state */
						<div className="mx-auto max-w-md space-y-2 py-20 text-center">
							<Search size={20} className="mx-auto text-[var(--text-30)]" />
							<p className="text-sm text-[var(--text)]">没有匹配的定时任务</p>
							<p className="text-xs text-[var(--text-40)]">
								尝试更换关键词，或清除筛选条件。
							</p>
						</div>
					) : (
						/* Grouped schedule list */
						<div className="space-y-8">
							{groupSections.map(
								(section) =>
									section.items.length > 0 && (
										<section key={section.key} className="space-y-2.5">
											<h2 className="px-1 text-xs font-medium text-[var(--text-40)]">
												{section.title}
												<span className="ml-1.5 text-[var(--text-30)]">
													{section.items.length}
												</span>
											</h2>
											<div className="space-y-2.5">
												{section.items.map(renderRow)}
											</div>
										</section>
									),
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
