import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { PageProps } from "../../core/nav";
import { nav, paths } from "../../core/nav";
import { Chip } from "../../ui/Chip";
import { EmptyState } from "../../ui/EmptyState";
import { PageHeader } from "../../ui/PageHeader";
import { PullToRefresh } from "../../ui/PullToRefresh";
import { Spinner } from "../../ui/Spinner";
import { compactNumber } from "../../core/lib/format";
import { FILTERS, buildTree, countRows, elapsedMs, filterTree, flattenTree, formatElapsed, rowLabel, statusText } from "./model";
import type { Bucket, Filter, FlatRow } from "./model";
import { refreshSubagents, useWatchSubagents } from "./store";
import { useNow } from "./useNow";

export const BUCKET_TONE: Record<Bucket, "accent" | "success" | "danger" | "neutral"> = {
	running: "accent",
	queued: "neutral",
	done: "success",
	failed: "danger",
};

const INDENT = 16;

function Connectors({ depth, guides, isLast }: { depth: number; guides: boolean[]; isLast: boolean }) {
	if (depth === 0) return null;
	return (
		<div className="flex shrink-0 self-stretch" aria-hidden>
			{Array.from({ length: depth }, (_, i) => {
				const col = i + 1;
				const own = col === depth;
				return (
					<div key={col} className="relative shrink-0" style={{ width: INDENT }}>
						{own ? (
							<>
								<span className="absolute left-2 top-0 h-6 w-2 rounded-bl-m-sm border-b border-l border-m-border" />
								{!isLast && <span className="absolute bottom-0 left-2 top-0 border-l border-m-border" />}
							</>
						) : (
							guides[col - 1] && <span className="absolute bottom-0 left-2 top-0 border-l border-m-border" />
						)}
					</div>
				);
			})}
		</div>
	);
}

function Row({ flat, sessionId, now }: { flat: FlatRow; sessionId: string; now: number }) {
	const { row, bucket } = flat.node;
	const label = rowLabel(row);
	const elapsed = formatElapsed(elapsedMs(row, now));
	return (
		<li className={`flex ${flat.dim ? "opacity-60" : ""}`}>
			<Connectors depth={flat.depth} guides={flat.guides} isLast={flat.isLast} />
			<button
				type="button"
				onClick={() => nav.push(paths.subagent(sessionId, row.id))}
				className="mb-2 flex min-h-11 min-w-0 flex-1 flex-col gap-1 rounded-m-md border border-m-border bg-m-surface px-3 py-2.5 text-left active:bg-m-surface-hover"
			>
				<span className="flex items-start gap-2">
					<span className="min-w-0 flex-1 break-words text-m-md font-medium text-m-text">{label.primary}</span>
					<Chip tone={BUCKET_TONE[bucket]} icon={bucket === "running" ? <Spinner size={10} /> : undefined}>
						{statusText(row.status)}
					</Chip>
				</span>
				{label.description && <span className="break-words text-m-sm text-m-text-2">{label.description}</span>}
				<span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-m-xs text-m-text-3">
					{label.role && <Chip>{label.role}</Chip>}
					{elapsed && <span className="whitespace-nowrap">{elapsed}</span>}
					{!!row.tokens && <span className="whitespace-nowrap">{compactNumber(row.tokens)} tok</span>}
				</span>
			</button>
		</li>
	);
}

export function SubagentsPage({ route }: PageProps) {
	const sessionId = route.params.id;
	const { rows, loaded, error } = useWatchSubagents(sessionId);
	const [filter, setFilter] = useState<Filter>("all");
	const counts = useMemo(() => countRows(rows), [rows]);
	const flat = useMemo(() => flattenTree(filterTree(buildTree(rows), filter), filter), [rows, filter]);
	const anyRunning = counts.running + counts.queued > 0;
	const now = useNow(anyRunning);
	const countOf = (f: Filter): number =>
		f === "all" ? rows.length : f === "running" ? counts.running + counts.queued : counts[f];

	return (
		<div className="flex h-full flex-col bg-m-bg">
			<PageHeader
				title="子代理"
				subtitle={rows.length ? `共 ${rows.length} 个` : undefined}
				right={anyRunning ? <Spinner size={16} className="mr-3 text-m-accent" /> : undefined}
			>
				{rows.length > 0 && (
					<div className="flex gap-2 overflow-x-auto px-3 py-2" role="tablist" aria-label="状态筛选">
						{FILTERS.map((f) => (
							<Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
								{f.label} {countOf(f.key)}
							</Chip>
						))}
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
					<EmptyState icon={<Users size={32} />} title="这个会话还没有子代理" hint="主代理派出子代理后会显示在这里" />
				) : flat.length === 0 ? (
					<EmptyState title="没有符合条件的子代理" hint="换一个筛选条件试试" />
				) : (
					<>
						{error && <div className="mx-3 mt-2 rounded-m-md bg-m-surface px-3 py-2 text-m-xs text-m-danger">刷新失败：{error}</div>}
						<ul className="px-3 pb-6 pt-2">
							{flat.map((f) => (
								<Row key={f.node.id} flat={f} sessionId={sessionId} now={now} />
							))}
						</ul>
					</>
				)}
			</PullToRefresh>
		</div>
	);
}
