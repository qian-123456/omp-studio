import { History } from "lucide-react";
import { api } from "../../core/api";
import { nav, paths } from "../../core/nav";
import type { PageProps } from "../../core/nav";
import { Chip, EmptyState, PageHeader, PullToRefresh } from "../../ui";
import { LoadState, useLoad } from "./controls";
import { fmtTime, RUN_STATUS_LABEL, runDurationText, runTone } from "./schedule";
import type { Schedule, ScheduleRun } from "./schedule";

export function ScheduleRunsPage({ route }: PageProps) {
	const id = route.params.id ?? "";
	const runs = useLoad(() => api<ScheduleRun[]>("GET", `/left/schedules/${encodeURIComponent(id)}/runs?limit=50`), [id]);
	const sched = useLoad(async () => (await api<Schedule[]>("GET", "/left/schedules")).find((s) => s.id === id) ?? null, [id]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg text-m-text">
			<PageHeader title="运行记录" subtitle={sched.data?.name} />
			<PullToRefresh onRefresh={() => Promise.all([runs.reload(), sched.reload()])}>
				{runs.data === null ? (
					<LoadState loading={runs.loading} error={runs.error} onRetry={runs.reload} />
				) : runs.data.length === 0 ? (
					<EmptyState icon={<History size={40} />} title="暂无运行记录" hint="任务运行后会显示在这里" />
				) : (
					<ul className="flex flex-col" style={{ paddingBottom: "var(--m-safe-bottom)" }}>
						{runs.data.map((r) => {
							const dur = runDurationText(r);
							const open = r.sessionId ? () => nav.push(paths.chat(r.sessionId as string)) : undefined;
							const body = (
								<>
									<div className="flex flex-wrap items-center gap-2">
										<Chip tone={runTone(r.status)}>{RUN_STATUS_LABEL[r.status] ?? r.status}</Chip>
										<span className="whitespace-nowrap text-m-md font-medium">{fmtTime(r.startedAt)}</span>
										{dur && <span className="whitespace-nowrap text-m-sm text-m-text-3">{dur}</span>}
									</div>
									{r.summary && <div className="mt-1.5 whitespace-pre-wrap break-words text-m-sm text-m-text-2">{r.summary}</div>}
									{open && <div className="mt-1.5 text-m-xs text-m-accent">点击打开会话</div>}
								</>
							);
							return (
								<li key={r.id} className="border-b border-m-border" data-testid="run-row">
									{open ? (
										<button type="button" onClick={open} className="block min-h-14 w-full px-4 py-3 text-left active:bg-m-surface-hover">
											{body}
										</button>
									) : (
										<div className="min-h-14 px-4 py-3">{body}</div>
									)}
								</li>
							);
						})}
					</ul>
				)}
			</PullToRefresh>
		</div>
	);
}
