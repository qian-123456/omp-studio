import { RefreshCw } from "lucide-react";
import type { PlanStatus } from "../../../src/features/chat/plan/planStatus";
import { api } from "../../core/api";
import type { PageProps } from "../../core/nav";
import { EmptyState, IconButton, Markdown, PageHeader, PullToRefresh } from "../../ui";
import { LoadGate } from "./PanelState";
import { useLoad, useResync } from "./hooks";
import { WorkspacePanelBar } from "./WorkspacePanelBar";
import { usePlanExecution } from "./usePlanExecution";

interface Plan {
	text?: string | null;
	streaming?: boolean;
	planStatus?: PlanStatus | null;
}

function planLabel(status: PlanStatus | null, streaming: boolean): string {
	if (status?.approved) {
		const labels = { executing: "执行中", completed: "已完成", failed: "执行失败", handoff: "已移交新会话" };
		return labels[status.approved.status];
	}
	if (status?.enabled) return status.phase === "review" ? "等待审批" : "规划中";
	if (status) return "规划未开启";
	return streaming ? "助手回复生成中（无已保存计划）" : "助手回复（无已保存计划）";
}

export function PlanPage({ route }: PageProps) {
	const id = route.params.id;
	const state = useLoad((signal) => api<Plan>("GET", `/sessions/${encodeURIComponent(id)}/plan`, undefined, { signal }), [id]);
	const execution = usePlanExecution(id);
	const status = execution.planStatus ?? state.data?.planStatus ?? null;
	const text = status ? status.approved?.content ?? status.content : state.data?.text;
	const refresh = () => Promise.all([state.reload(true), execution.reload()]).then(() => {});
	useResync(() => void state.reload(true));

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader
				title="计划"
				subtitle={planLabel(status, !!state.data?.streaming)}
				right={<IconButton icon={<RefreshCw size={20} />} label="刷新" onClick={() => void refresh()} />}
			/>
			<WorkspacePanelBar sessionId={id} current="plan" />
			<PullToRefresh onRefresh={refresh}>
				<LoadGate state={state}>
					{() => text ? (
						<div className="m-selectable px-5 pt-2 pb-8">
							{status?.approved?.error && (
								<p role="status" className="mb-3 rounded-m-md bg-m-warn-bg px-4 py-3 text-m-sm break-words text-m-warn">
									{status.approved.error === "aborted" ? "本次执行已停止" : status.approved.error}
								</p>
							)}
							<Markdown text={text} streaming={!status?.approved && !!state.data?.streaming} />
						</div>
					) : (
						<EmptyState title="暂无计划内容" hint={status?.enabled ? "计划准备好后会显示在这里" : "已批准的计划会保留在这里"} />
					)}
				</LoadGate>
			</PullToRefresh>
		</div>
	);
}
