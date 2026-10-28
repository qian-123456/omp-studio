import { RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { api } from "../../core/api";
import type { PageProps } from "../../core/nav";
import { events } from "../../core/sse";
import { EmptyState, IconButton, Markdown, PageHeader, PullToRefresh } from "../../ui";
import { LoadGate } from "./PanelState";
import { useLoad, useResync } from "./hooks";

interface Plan {
	text?: string;
	streaming?: boolean;
}

const RELOAD_MS = 800;

export function PlanPage({ route }: PageProps) {
	const id = route.params.id;
	const state = useLoad((signal) => api<Plan>("GET", `/sessions/${encodeURIComponent(id)}/plan`, undefined, { signal }), [id]);
	const reloadRef = useRef(state.reload);
	reloadRef.current = state.reload;
	useResync(() => void reloadRef.current(true));

	// Debounced refresh while the session streams (the plan is its latest assistant reply).
	useEffect(() => {
		let timer = 0;
		const off = events.on("rpc", (d) => {
			if (d.sessionId !== id) return;
			window.clearTimeout(timer);
			timer = window.setTimeout(() => void reloadRef.current(true), RELOAD_MS);
		});
		return () => {
			off();
			window.clearTimeout(timer);
		};
	}, [id]);

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader
				title="计划"
				subtitle={state.data?.streaming ? "生成中" : "最新一条助手回复"}
				right={<IconButton icon={<RefreshCw size={20} />} label="刷新" onClick={() => void state.reload(true)} />}
			/>
			<PullToRefresh onRefresh={() => state.reload(true)}>
				<LoadGate state={state}>
					{(p) =>
						p.text ? (
							<div className="m-selectable px-5 pt-2 pb-8">
								<Markdown text={p.text} streaming={!!p.streaming} />
							</div>
						) : (
							<EmptyState title="暂无计划内容" />
						)
					}
				</LoadGate>
			</PullToRefresh>
		</div>
	);
}
