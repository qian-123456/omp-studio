import clsx from "clsx";
import { Bot, Check, ChevronDown, ChevronRight, ChevronUp, Clock, X } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { claimEscape, isEscapeClaimed } from "../../../lib/escapeClaim";
import type { SubagentInfo } from "../../../stores/live";
import { useUi } from "../../../stores/ui";
import { useSettings } from "../../settings/store";
import { subagentCounts } from "./counts";
import { formatShortModel } from "../turnGrouping";
import type { AgentRow } from "./merge";
import { SubagentHoverCard } from "./SubagentHoverCard";
import { SubagentSheet } from "./SubagentSheet";
import {
	MAX_VISIBLE_ROWS,
	type RowState,
	type TreeNode,
	activityText,
	buildSubagentTree,
	capTree,
	elapsedMs,
	flattenTree,
	moreLabel,
	collapseTree,
	descendantStats,
	type DescendantStats,
	roleTone,
	shouldAutoExpand,
	statusSummary,
	subagentTitle,
} from "./subagentTree";
import { useSessionSubagents } from "./useSessionSubagents";

const TINT = {
	running: "bg-[color-mix(in_oklab,var(--status-info)_16%,transparent)] text-[var(--status-info)]",
	done: "bg-[color-mix(in_oklab,var(--status-success)_16%,transparent)] text-[var(--status-success)]",
	failed: "bg-[color-mix(in_oklab,var(--status-error)_16%,transparent)] text-[var(--status-error)]",
	queued: "bg-[var(--ghost-hover)] text-[var(--text-60)]",
} as const;

function Spinner() {
	return (
		<span className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" />
	);
}

const ROLE_TINT = {
	scout: "bg-[color-mix(in_oklab,var(--status-renamed)_18%,transparent)] text-[var(--status-renamed)]",
	task: "bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]",
	reviewer: "bg-[color-mix(in_oklab,var(--status-warning)_18%,transparent)] text-[var(--status-warning)]",
	other: "bg-[var(--ghost-hover)] text-[var(--text-60)]",
} as const;

/** Single non-redundant status summary (running / all done / done+failed). */
function SummaryBadge({
	counts,
	small,
}: {
	counts: { running: number; done: number; failed: number; queued?: number };
	small?: boolean;
}) {
	const s = statusSummary(counts);
	const seg = clsx(
		"inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]",
		small ? "h-[18px] px-1.5 text-[11px]" : "h-5 px-[7px] text-[12px]",
	);
	if (s.mode === "running" || s.mode === "queued") {
		const queued = s.queued;
		return (
			<>
				{s.mode === "running" && (
					<span className={clsx(seg, TINT.running)}>
						<Spinner />
						{s.running} 运行中
					</span>
				)}
				{queued > 0 && (
					<span className={clsx(seg, TINT.queued)} title={`${queued} 个子代理排队中，尚未开始`}>
						<Clock className="h-3 w-3" />
						{queued} 排队中
					</span>
				)}
				<span className="text-[11px] tabular-nums text-[var(--text-40)]">{s.progress}</span>
			</>
		);
	}
	if (s.mode === "done") {
		return (
			<span className={clsx(seg, TINT.done)} title={`${s.count} 个子代理已全部完成`}>
				<Check className="h-3 w-3" strokeWidth={3} />
				{s.count}
			</span>
		);
	}
	return (
		<>
			<span className={clsx(seg, TINT.done)}>✓ {s.done}</span>
			<span className={clsx(seg, TINT.failed)}>✕ {s.failed}</span>
		</>
	);
}

function StatusGlyph({ state }: { state: RowState }) {
	return (
		<span
			className={clsx(
				"grid w-3.5 shrink-0 place-items-center text-[12px] font-bold",
				state === "running" && "text-[var(--status-info)]",
				state === "done" && "text-[var(--status-success)]",
				state === "failed" && "text-[var(--status-error)]",
				state === "waiting" && "text-[var(--text-40)]",
			)}
		>
			{state === "running" ? (
				<Spinner />
			) : state === "done" ? (
				<Check className="h-3 w-3" strokeWidth={3} />
			) : state === "failed" ? (
				<X className="h-3 w-3" strokeWidth={3} />
			) : (
				<Clock className="h-3 w-3" />
			)}
		</span>
	);
}

interface RowCtx {
	subagents: Record<string, SubagentInfo>;
	rows: Record<string, AgentRow>;
	selectedId: string | null;
	now: number;
	onOpen: (id: string) => void;
	onHover: (id: string | null, el?: Element) => void;
	perRowModel: boolean;
	stats: Map<string, DescendantStats>;
	collapsed: ReadonlySet<string>;
	onToggle: (id: string) => void;
}

function TreeRows({ nodes, ctx }: { nodes: TreeNode[]; ctx: RowCtx }) {
	return (
		<>
			{nodes.map((n) => {
				const info = ctx.subagents[n.id];
				const row = ctx.rows[n.id];
				const act = activityText(info, row, n.state);
				const title = subagentTitle(n.id, info, row);
				const role = info.agent || row?.agent;
				const model = formatShortModel(row?.model ?? info.progress?.resolvedModel);
				const sub =
					n.state === "failed" ? act.text : "";
				const st = ctx.stats.get(n.id);
				const isCollapsed = ctx.collapsed.has(n.id);
				return (
					<li key={n.id}>
						<div
							role="button"
							tabIndex={0}
							data-selected={ctx.selectedId === n.id}
							data-subagent-row={n.id}
							onClick={() => ctx.onOpen(n.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									ctx.onOpen(n.id);
								}
							}}
							onMouseEnter={(e) => ctx.onHover(n.id, e.currentTarget)}
							onMouseLeave={() => ctx.onHover(null)}
							className="glass-row flex h-7 cursor-pointer items-center gap-[7px] rounded-[10px] px-2 text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
							title={title}
						>
							<StatusGlyph state={n.state} />
							<span
								className={clsx(
									"min-w-0 flex-1 truncate",
									n.state === "done" && "text-[var(--text-60)]",
									n.state === "waiting" && "text-[var(--text-40)]",
									(n.state === "running" || n.state === "failed") && "font-semibold",
								)}
							>
								{title}
							</span>
							{role && (
								<span
									className={clsx(
										"shrink-0 rounded-md px-1.5 text-[10.5px] font-medium",
										ROLE_TINT[roleTone(role)],
									)}
								>
									{role}
								</span>
							)}
							{st && st.total > 0 && (
								<button
									type="button"
									aria-expanded={!isCollapsed}
									aria-label={`${isCollapsed ? "展开" : "收起"} ${title} 的 ${st.total} 个下级子代理`}
									title={isCollapsed ? "展开下级子代理" : "收起下级子代理"}
									onClick={(e) => {
										e.stopPropagation();
										ctx.onToggle(n.id);
									}}
									onKeyDown={(e) => e.stopPropagation()}
									className="flex h-[18px] shrink-0 items-center gap-0.5 whitespace-nowrap rounded-md px-1 text-[10.5px] text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
								>
									{isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
									<span>{st.total}</span>
									{st.running > 0 && <span className="text-[var(--status-info)]">· {st.running} 运行</span>}
								</button>
							)}
							{ctx.perRowModel && model && (
								<span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-40)]">{model}</span>
							)}
						</div>
						{sub && (
							<div
								className={clsx(
									"ml-[28px] truncate pb-1 text-[11px]",
									act.error ? "text-[var(--status-error)]" : "text-[var(--text-40)]",
								)}
								title={sub}
							>
								{sub}
							</div>
						)}
						{n.children.length > 0 && (
							<ul>
								<TreeRows nodes={n.children} ctx={ctx} />
							</ul>
						)}
					</li>
				);
			})}
		</>
	);
}

export function TopCapsule() {
	const settings = useSettings((s) => s.settings);
	const loadSettings = useSettings((s) => s.load);
	const selectedSessionId = useUi((s) => s.selectedSessionId);

	const { parentFile, subagents, rows } = useSessionSubagents(selectedSessionId);
	const [sheetId, setSheetId] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const [hover, setHover] = useState<{ id: string; el: Element } | null>(null);
	const [now, setNow] = useState(() => Date.now());
	const anchorRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const seenRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		void loadSettings();
	}, [loadSettings]);

	// Fresh session: collapse everything and forget which subagents were seen.
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the session id on purpose
	useEffect(() => {
		setOpen(false);
		setSheetId(null);
		setShowAll(false);
		setHover(null);
		seenRef.current = new Set();
		setCollapsed(new Set());
	}, [selectedSessionId]);

	// A new unfinished subagent re-expands the panel.
	useEffect(() => {
		if (shouldAutoExpand(seenRef.current, subagents)) setOpen(true);
		for (const id of Object.keys(subagents)) seenRef.current.add(id);
	}, [subagents]);

	const counts = subagentCounts(subagents);
	const total = counts.running + counts.queued + counts.done + counts.failed;

	// Tick running elapsed times while the panel is open.
	useEffect(() => {
		if (!open || counts.running === 0) return;
		setNow(Date.now());
		const t = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(t);
	}, [open, counts.running]);

	const tree = useMemo(() => buildSubagentTree(subagents), [subagents]);
	const stats = useMemo(() => descendantStats(tree), [tree]);
	// Collapsed parents hide their descendants before the row cap is applied,
	// so hidden rows never count toward the "还有 N 个" overflow.
	const visibleTree = useMemo(() => collapseTree(tree, collapsed), [tree, collapsed]);
	const capped = useMemo(
		() => (showAll ? { roots: visibleTree, hidden: 0, hiddenAllDone: true } : capTree(visibleTree, MAX_VISIBLE_ROWS)),
		[visibleTree, showAll],
	);
	const visibleIds = useMemo(() => flattenTree(capped.roots).map((n) => n.id), [capped]);
	const toggleCollapsed = (id: string) =>
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	const parentName = useMemo(() => {
		const m: Record<string, string> = {};
		for (const n of flattenTree(tree)) {
			for (const c of n.children) m[c.id] = n.id;
		}
		return m;
	}, [tree, subagents]);

	// ↑ / ↓ move the open detail between rows, in the order the tree shows them.
	useEffect(() => {
		if (!open || !sheetId) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
			const t = e.target as Node | null;
			if (t !== document.body && !(t && panelRef.current?.contains(t))) return;
			const i = visibleIds.indexOf(sheetId);
			if (i < 0) return;
			const next = visibleIds[i + (e.key === "ArrowDown" ? 1 : -1)];
			if (!next) return;
			e.preventDefault();
			setSheetId(next);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, sheetId, visibleIds]);
	// Escape / outside click collapses the panel (not while a detail sheet is open).
	useEffect(() => {
		if (!open || sheetId) return;
		const onDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (anchorRef.current?.contains(t)) return;
			if (t instanceof Element && t.closest('[data-layer]')) return;
			setOpen(false);
		};
		// Bubble phase: surfaces that own Esc (ask panel, approval card,
		// composer menus) claim it first; only act on unclaimed Esc pressed
		// from the panel itself or from nowhere in particular.
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || isEscapeClaimed(e)) return;
			if (document.querySelector('[data-layer="lightbox"], [data-layer="modal"], [aria-modal="true"]')) return;
			const active = document.activeElement;
			if (
				active &&
				active !== document.body &&
				!anchorRef.current?.contains(active)
			) {
				return;
			}
			claimEscape(e);
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown, true);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown, true);
			document.removeEventListener("keydown", onKey);
		};
	}, [open, sheetId]);

	if (settings && !settings.capsuleVisible) {
		return null;
	}
	if (total === 0) {
		return null;
	}

	const modelOf = (id: string) =>
		formatShortModel(rows[id]?.model ?? subagents[id]?.progress?.resolvedModel);
	const modelSet = new Set(Object.keys(subagents).map(modelOf).filter(Boolean));
	const sharedModel = modelSet.size === 1 ? [...modelSet][0] : "";
	const perRowModel = modelSet.size > 1;
	const ctx: RowCtx = {
		stats,
		collapsed,
		onToggle: toggleCollapsed,
		subagents,
		rows,
		selectedId: sheetId,
		now,
		onOpen: (id) => setSheetId(id),
		onHover: (id, el) => setHover(id && el ? { id, el } : null),
		perRowModel,
	};
	const hoverInfo = hover ? subagents[hover.id] : undefined;
	const hoverState = hover ? flattenTree(tree).find((n) => n.id === hover.id)?.state : undefined;

	return (
		<div ref={anchorRef} className="pointer-events-none absolute right-4 top-3 z-30 flex max-w-[calc(100%-2rem)] justify-end">
			{!open && (
				<button
					type="button"
					onClick={() => setOpen(true)}
					aria-expanded={false}
					style={{ "--glass-radius": "999px" } as CSSProperties}
					className="liquid-glass pointer-events-auto relative inline-flex h-8 items-center gap-1.5 py-0 pl-2.5 pr-2 text-[12px] text-[var(--text)]"
					title="展开子代理（Subagents）状态面板"
				>
					<Bot className="h-[15px] w-[15px] shrink-0 text-[var(--accent)]" />
					<span className="text-[12.5px] font-semibold">子代理</span>
					<SummaryBadge counts={counts} />
					<ChevronDown className="-ml-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-60)]" />
				</button>
			)}
			{open && (
				<div
					role="region"
					aria-label="子代理状态"
					className="liquid-glass pointer-events-auto w-[400px] max-w-full p-2 text-[12.5px] text-[var(--text)]"
				>
					<div ref={panelRef} className="outline-none">
					<div className="flex items-center gap-1.5 py-1 pl-1.5 pr-0.5">
						<Bot className="h-[15px] w-[15px] shrink-0 text-[var(--accent)]" />
						<span className="shrink-0 whitespace-nowrap text-[12.5px] font-semibold">子代理</span>
						<span className="flex min-w-0 flex-1 items-center gap-1.5">
							<SummaryBadge counts={counts} small />
						</span>
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="grid h-[22px] w-[22px] place-items-center rounded-full text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							title="收起为胶囊"
							aria-label="收起子代理面板"
						>
							<ChevronUp className="h-3.5 w-3.5" />
						</button>
					</div>
					{sharedModel && (
						<div className="pb-1 pl-[27px] text-[11px] text-[var(--text-40)]" title="所有子代理使用的模型">
							全部使用 {sharedModel}
						</div>
					)}

					<div className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain" data-subagent-scroll>
						<ul className="sa-tree sa-tree-root">
							<TreeRows nodes={capped.roots} ctx={ctx} />
						</ul>
					</div>
					{(capped.hidden > 0 || (showAll && flattenTree(visibleTree).length > MAX_VISIBLE_ROWS)) && (
						<button
							type="button"
							onClick={() => setShowAll(!showAll)}
							className="mt-1 ml-[15px] flex h-[26px] w-[calc(100%-15px)] items-center gap-1 rounded-[10px] px-2 text-left text-[12px] text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						>
							{showAll ? "收起多余的行" : moreLabel(capped.hidden, capped.hiddenAllDone)}
							{showAll ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
						</button>
					)}
					</div>
				</div>
			)}

			{hover && hoverInfo && hoverState && open && (
				<SubagentHoverCard
					id={hover.id}
					info={hoverInfo}
					row={rows[hover.id]}
					state={hoverState}
					elapsed={elapsedMs(hoverInfo, rows[hover.id], hoverState, now)}
					parentName={parentName[hover.id]}
					anchor={hover.el}
				/>
			)}

			{sheetId && rows[sheetId] && (
				<SubagentSheet
					key={sheetId}
					parentFile={parentFile}
					row={rows[sheetId]}
					onClose={() => setSheetId(null)}
					onPrev={visibleIds.indexOf(sheetId) > 0 ? () => setSheetId(visibleIds[visibleIds.indexOf(sheetId) - 1]) : undefined}
					onNext={
						visibleIds.indexOf(sheetId) >= 0 && visibleIds.indexOf(sheetId) < visibleIds.length - 1
							? () => setSheetId(visibleIds[visibleIds.indexOf(sheetId) + 1])
							: undefined
					}
				/>
			)}
		</div>
	);
}
