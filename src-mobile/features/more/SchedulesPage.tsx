import { CalendarClock, History, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../core/api";
import { nav, paths } from "../../core/nav";
import { Chip, confirm, EmptyState, HeaderButton, PageHeader, PullToRefresh, toast } from "../../ui";
import { btnCls, btnDangerCls, LoadState, Switch, useLoad } from "./controls";
import { cadenceText, LIFECYCLE_LABEL, scheduleMeta } from "./schedule";
import type { Schedule } from "./schedule";

const enc = encodeURIComponent;

export function SchedulesPage() {
	const { data, setData, error, loading, reload } = useLoad(() => api<Schedule[]>("GET", "/left/schedules"));
	const [busy, setBusy] = useState<string | null>(null);

	const run = async (s: Schedule, action: () => Promise<unknown>, ok: string, fail: string) => {
		setBusy(s.id);
		try {
			await action();
			if (ok) toast(ok, { kind: "success" });
		} catch (e) {
			toast(`${fail}：${errorMessage(e)}`, { kind: "error" });
		}
		setBusy(null);
		await reload();
	};

	const toggle = (s: Schedule) => {
		setData((d) => d && d.map((x) => (x.id === s.id ? { ...x, enabled: !s.enabled } : x)));
		return run(s, () => api("POST", `/left/schedules/${enc(s.id)}/enabled`, { enabled: !s.enabled }), "", "操作失败");
	};
	const runNow = async (s: Schedule) => {
		if (!(await confirm({ title: "立即运行", message: `立即运行「${s.name}」一次？将创建新的会话执行该任务。` }))) return;
		await run(s, () => api("POST", `/left/schedules/${enc(s.id)}/run`), "已触发运行", "运行失败");
	};
	const del = async (s: Schedule) => {
		if (!(await confirm({ title: "删除定时任务", message: `删除定时任务「${s.name}」？此操作不可撤销。`, danger: true }))) return;
		await run(s, () => api("DELETE", `/left/schedules/${enc(s.id)}`), "已删除", "删除失败");
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			<PageHeader
				title="定时任务"
				right={<HeaderButton icon={<Plus size={22} />} label="新建定时任务" onClick={() => nav.push(paths.scheduleNew())} />}
			/>
			<PullToRefresh onRefresh={reload}>
				{data === null ? (
					<LoadState loading={loading} error={error} onRetry={reload} />
				) : data.length === 0 ? (
					<EmptyState
						icon={<CalendarClock size={40} />}
						title="还没有定时任务"
						hint="让 agent 按固定节奏自动执行提示词"
						action={
							<button type="button" className={btnCls} onClick={() => nav.push(paths.scheduleNew())}>
								新建定时任务
							</button>
						}
					/>
				) : (
					<ul className="flex flex-col gap-3 p-4" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 16px)" }}>
						{error && <li className="text-m-sm text-m-danger">刷新失败：{error}</li>}
						{data.map((s) => (
							<li key={s.id} className="rounded-m-lg border border-m-border bg-m-surface p-4" data-testid="schedule-card">
								<div className="flex items-start gap-2">
									<button type="button" className="min-w-0 flex-1 text-left" onClick={() => nav.push(paths.schedule(s.id))}>
										<div className="break-words text-m-lg font-semibold">{s.name}</div>
										<div className="mt-0.5 text-m-sm text-m-text-2">{cadenceText(s.cadence)}</div>
									</button>
									<Switch
										checked={s.enabled}
										label={`启用 ${s.name}`}
										disabled={busy === s.id || s.lifecycle === "completed"}
										onChange={() => void toggle(s)}
									/>
								</div>
								<div className="mt-2 flex flex-wrap gap-1.5">
									<Chip tone={s.lifecycle === "active" ? "success" : s.lifecycle === "paused" ? "warn" : "neutral"}>
										{LIFECYCLE_LABEL[s.lifecycle] ?? s.lifecycle}
									</Chip>
									{s.runMode === "worktree" && <Chip>工作树</Chip>}
								</div>
								<div className="mt-2 text-m-xs text-m-text-3">{scheduleMeta(s)}</div>
								<div className="mt-1 break-all text-m-xs text-m-text-3">{s.cwd}</div>
								<div className="mt-3 grid grid-cols-2 gap-2">
									<button type="button" className={btnCls} onClick={() => nav.push(paths.schedule(s.id))}>
										<Pencil size={16} /> 编辑
									</button>
									<button type="button" className={btnCls} disabled={busy === s.id} onClick={() => void runNow(s)}>
										<Play size={16} /> 立即运行
									</button>
									<button type="button" className={btnCls} onClick={() => nav.push(paths.scheduleRuns(s.id))}>
										<History size={16} /> 历史
									</button>
									<button type="button" className={btnDangerCls} disabled={busy === s.id} onClick={() => void del(s)}>
										<Trash2 size={16} /> 删除
									</button>
								</div>
							</li>
						))}
					</ul>
				)}
			</PullToRefresh>
		</div>
	);
}
