import { History, MessageSquare } from "lucide-react";
import { api } from "../../core/api";
import { nav, paths } from "../../core/nav";
import type { PageProps } from "../../core/nav";
import { Chip, EmptyState, ListGroup, ListRow, PageHeader, PullToRefresh } from "../../ui";
import { LoadState, useLoad } from "./controls";
import { fmtTime, RUN_STATUS_LABEL, runDurationText, runTone } from "./schedule";
import type { Schedule, ScheduleRun } from "./schedule";

export function ScheduleRunsPage({ route }: PageProps) {
	const id = route.params.id ?? "";
	const runs = useLoad(() => api<ScheduleRun[]>("GET", `/left/schedules/${encodeURIComponent(id)}/runs?limit=50`), [id]);
	const sched = useLoad(async () => (await api<Schedule[]>("GET", "/left/schedules")).find((s) => s.id === id) ?? null, [id]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-m-bg-elev text-m-text">
			<PageHeader title="运行记录" subtitle={sched.data?.name} className="bg-m-bg-elev!" />
			<PullToRefresh onRefresh={() => Promise.all([runs.reload(), sched.reload()])}>
				{runs.data === null ? (
					<LoadState loading={runs.loading} error={runs.error} onRetry={runs.reload} />
				) : runs.data.length === 0 ? (
					<EmptyState className="min-h-[70dvh]" icon={<History size={26} strokeWidth={1.75} />} title="暂无运行记录" hint="任务运行后会显示在这里" />
				) : (
					<div className="pt-2" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 24px)" }}>
						<ListGroup note="有会话的记录可轻点打开">
							{runs.data.map((r) => {
								const dur = runDurationText(r);
								const sid = r.sessionId;
								return (
									<ListRow
										key={r.id}
										title={
											<span className="flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="run-row">
												<span className="whitespace-nowrap">{fmtTime(r.startedAt)}</span>
												<Chip tone={runTone(r.status)}>{RUN_STATUS_LABEL[r.status] ?? r.status}</Chip>
											</span>
										}
										subtitle={
											dur || r.summary ? (
												<>
													{dur && <span className="block">{dur}</span>}
													{r.summary && <span className="m-selectable mt-1 block text-m-sm whitespace-pre-wrap text-m-text-2">{r.summary}</span>}
												</>
											) : undefined
										}
										right={sid ? <MessageSquare size={18} strokeWidth={1.75} aria-label="打开会话" /> : undefined}
										chevron={!!sid}
										onClick={sid ? () => nav.push(paths.chat(sid)) : undefined}
									/>
								);
							})}
						</ListGroup>
					</div>
				)}
			</PullToRefresh>
		</div>
	);
}
