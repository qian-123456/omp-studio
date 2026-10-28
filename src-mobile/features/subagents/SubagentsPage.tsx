import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { PageProps } from "../../core/nav";
import { nav, paths } from "../../core/nav";
import { EmptyState, PageHeader, PullToRefresh, Segmented, Spinner } from "../../ui";
import { FILTERS, buildTree, countRows, filterTree, flattenTree } from "./model";
import type { Filter } from "./model";
import { SubagentTree } from "./SubagentTree";
import { refreshSubagents, useWatchSubagents } from "./store";
import { useNow } from "./useNow";

export function SubagentsPage({ route }: PageProps) {
	const sessionId = route.params.id;
	const { rows, loaded, error } = useWatchSubagents(sessionId);
	const [filter, setFilter] = useState<Filter>("all");
	const counts = useMemo(() => countRows(rows), [rows]);
	const flat = useMemo(() => flattenTree(filterTree(buildTree(rows), filter), filter), [rows, filter]);
	const anyRunning = counts.running + counts.queued > 0;
	const now = useNow(anyRunning);
	const options = FILTERS.map((f) => ({
		value: f.key,
		label: `${f.label} ${f.key === "all" ? rows.length : f.key === "running" ? counts.running + counts.queued : counts[f.key]}`,
	}));

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader title="子代理" subtitle={rows.length ? `共 ${rows.length} 个` : undefined}>
				{rows.length > 0 && (
					<div className="px-4 pt-1 pb-3">
						<Segmented label="状态筛选" value={filter} options={options} onChange={setFilter} />
					</div>
				)}
			</PageHeader>
			<PullToRefresh className="min-h-0 flex-1" onRefresh={() => refreshSubagents(sessionId)}>
				{!loaded ? (
					<div className="flex justify-center py-12 text-m-text-3">
						<Spinner size={22} />
					</div>
				) : error && rows.length === 0 ? (
					<EmptyState title="加载失败" hint={error} />
				) : rows.length === 0 ? (
					<EmptyState icon={<Users size={24} strokeWidth={1.75} />} title="这个会话还没有子代理" hint="主代理派出子代理后会显示在这里" />
				) : flat.length === 0 ? (
					<EmptyState title="没有符合条件的子代理" hint="换一个筛选条件试试" />
				) : (
					<div className="px-4 pt-2 pb-8">
						{error && <p className="mb-3 px-1 text-m-xs break-words text-m-danger">刷新失败：{error}</p>}
						<SubagentTree
							rows={flat}
							now={now}
							className="bg-m-surface"
							onOpen={(id) => nav.push(paths.subagent(sessionId, id))}
						/>
					</div>
				)}
			</PullToRefresh>
		</div>
	);
}
