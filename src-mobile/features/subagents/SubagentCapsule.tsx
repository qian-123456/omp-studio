import { Check, ChevronDown, ChevronRight, Clock, X } from "lucide-react";
import { useMemo, useState } from "react";
import { nav, paths } from "../../core/nav";
import { BottomSheet } from "../../ui/BottomSheet";
import { Chip } from "../../ui/Chip";
import { Spinner } from "../../ui/Spinner";
import { BUCKET_TONE } from "./SubagentsPage";
import {
	buildTree,
	countRows,
	elapsedMs,
	flattenTree,
	formatElapsed,
	rowLabel,
	statusText,
	type SubagentSummary,
} from "./model";
import { useCapsuleVisible } from "./settings";
import { useWatchSubagents } from "./store";
import { useNow } from "./useNow";

/** Build the ancestry chain of subagent names, e.g. ["A", "B", "C"] */
export function getAncestryChain(nodeId: string, rows: readonly SubagentSummary[]): string[] {
	const map = new Map<string, SubagentSummary>();
	for (const r of rows) map.set(r.id, r);

	const parts = nodeId.split(".");
	const chain: string[] = [];
	let cur = "";
	for (const p of parts) {
		cur = cur ? `${cur}.${p}` : p;
		const r = map.get(cur);
		if (r) {
			chain.push(rowLabel(r).primary);
		} else {
			chain.push(p.replace(/^\d+-/, ""));
		}
	}
	return chain;
}

/**
 * Subagent capsule matching desktop behavior:
 * - Only displays when session has subagent records
 * - Positioned at top-right of message area
 * - Shows running/queued/done/failed counts + progress
 * - Stays visible after completion
 * - Respects capsuleVisible setting
 * - Tap opens BottomSheet with nested tree (A > B > C) and agent status
 * - Tap an agent navigates to full-screen SubagentDetailPage
 */
export function SubagentCapsule({ sessionId }: { sessionId: string }) {
	const visible = useCapsuleVisible();
	const { rows } = useWatchSubagents(sessionId);
	const [sheetOpen, setSheetOpen] = useState(false);

	const c = countRows(rows);
	const anyRunning = c.running + c.queued > 0;
	const now = useNow(anyRunning);

	const tree = useMemo(() => buildTree(rows), [rows]);
	const flat = useMemo(() => flattenTree(tree, "all"), [tree]);

	if (!visible || rows.length === 0) return null;

	const total = c.running + c.queued + c.done + c.failed;
	const progress = `${c.done + c.failed}/${total}`;

	return (
		<>
			<div className="flex shrink-0 justify-end px-3 py-1">
				<button
					type="button"
					aria-label="打开子代理摘要"
					onClick={() => setSheetOpen(true)}
					className="flex min-h-9 items-center active:opacity-70"
				>
					<span className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-m-pill border border-m-border bg-m-surface px-2.5 text-m-xs text-m-text-2 shadow-sm">
						{c.running > 0 && <Spinner size={12} className="text-m-accent" />}
						<span className={c.running > 0 ? "text-m-accent font-medium" : ""}>运行中 {c.running}</span>
						<span aria-hidden>·</span>
						<span className={c.done > 0 ? "text-m-success" : ""}>完成 {c.done}</span>
						<span aria-hidden>·</span>
						<span className={c.failed > 0 ? "text-m-danger" : ""}>失败 {c.failed}</span>
						{c.queued > 0 && (
							<>
								<span aria-hidden>·</span>
								<span>等待 {c.queued}</span>
							</>
						)}
						<span className="ml-0.5 font-mono text-[11px] font-medium text-m-text-3">({progress})</span>
						<ChevronDown size={13} className="text-m-text-3" />
					</span>
				</button>
			</div>

			<BottomSheet
				open={sheetOpen}
				onClose={() => setSheetOpen(false)}
				title={
					<div className="flex items-center gap-2">
						<span>子代理</span>
						<span className="font-mono text-m-xs text-m-text-3">({progress})</span>
					</div>
				}
				footer={
					<div className="border-t border-m-border p-3">
						<button
							type="button"
							onClick={() => {
								setSheetOpen(false);
								nav.push(paths.subagents(sessionId));
							}}
							className="flex min-h-11 w-full items-center justify-center rounded-m-pill border border-m-border bg-m-surface px-4 text-m-sm font-medium text-m-text active:bg-m-surface-hover"
						>
							打开完整子代理列表
						</button>
					</div>
				}
			>
				<div className="max-h-[min(65vh,480px)] overflow-y-auto overscroll-contain px-2 py-1">
					<div className="mb-2 flex items-center justify-between px-2 text-m-xs text-m-text-3">
						<span>
							运行中 {c.running} · 等待 {c.queued} · 完成 {c.done} · 失败 {c.failed}
						</span>
						<span className="font-mono">进度 {progress}</span>
					</div>
					<ul className="m-0 list-none space-y-1 p-0">
						{flat.map((f) => {
							const { node, depth } = f;
							const { row, bucket } = node;
							const label = rowLabel(row);
							const elapsed = formatElapsed(elapsedMs(row, now));
							const ancestry = getAncestryChain(node.id, rows);
							const isNested = ancestry.length > 1;

							return (
								<li key={node.id}>
									<button
										type="button"
										onClick={() => {
											setSheetOpen(false);
											nav.push(paths.subagent(sessionId, node.id));
										}}
										className="flex min-h-12 w-full items-center gap-2.5 rounded-m-md px-3 py-2 text-left active:bg-m-surface-hover"
										style={{ paddingLeft: `${Math.max(10, depth * 16 + 10)}px` }}
									>
										<span className="shrink-0">
											{bucket === "running" ? (
												<Spinner size={14} className="text-m-accent" />
											) : bucket === "done" ? (
												<Check size={14} className="text-m-success" />
											) : bucket === "failed" ? (
												<X size={14} className="text-m-danger" />
											) : (
												<Clock size={14} className="text-m-text-3" />
											)}
										</span>
										<span className="min-w-0 flex-1">
											<span className="flex flex-wrap items-center gap-1.5">
												<span className="text-m-sm font-medium text-m-text">{label.primary}</span>
												{isNested && (
													<span className="font-mono text-[11px] text-m-text-3">
														({ancestry.join(" > ")})
													</span>
												)}
												{label.role && <Chip className="py-0 text-[10px]">{label.role}</Chip>}
												{row.model && <Chip className="py-0 text-[10px]">{row.model}</Chip>}
											</span>
											{label.description && (
												<span className="mt-0.5 block truncate text-m-xs text-m-text-3">
													{label.description}
												</span>
											)}
										</span>
										<span className="flex shrink-0 items-center gap-1.5">
											{elapsed && <span className="text-m-xs text-m-text-3">{elapsed}</span>}
											<Chip tone={BUCKET_TONE[bucket]}>{statusText(row.status)}</Chip>
											<ChevronRight size={14} className="text-m-text-3" />
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			</BottomSheet>
		</>
	);
}
