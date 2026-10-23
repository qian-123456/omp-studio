/**
 * [D] Step 1 of 批量替换模型: every model currently referenced, grouped by kind
 * (missing from the catalogue / chat / search / judge / other), with its
 * reference count, every location it appears in (expandable) and a manual 测试
 * probe per row (never automatic; kinds without a real test show a hint).
 * A row's 替换 button picks it as the model to replace.
 *
 * Row layout: a one-line header (model · chips · first location + 「全部 N 处」
 * toggle · fixed-width actions). Expanding lists every location, one per line;
 * a probe result opens in its own full-width, wrapped, collapsible area under
 * the row, so the columns above never shift.
 */
import { AlertTriangle, ArrowRightLeft, ChevronDown, ChevronRight, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NativeSelect } from "../../../components/NativeSelect";
import { SearchInput } from "../../../components/SearchInput";
import type { ModelProbeResult, ModelUsageScan } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { modelProbe } from "../../../lib/ipc";
import { KIND_GROUP_ORDER, KIND_GROUP_TITLES, probeKindOf, useModelKindCatalog } from "./kinds";
import {
	buildOverview,
	filterOverviewRows,
	highlightParts,
	type OverviewRow,
	type ReplaceScope,
	scopeOptions,
	searchTerms,
	sourceMatches,
} from "./logic";
import { Chip } from "./parts";

/** Outcome of one probe: a result, or the error that prevented getting one. */
interface ProbeOutcome {
	ok: boolean;
	latencyMs: number | null;
	detail: string;
}

function formatLatency(ms: number): string {
	// A probe runs a real omp call, so its wall time includes omp startup (seconds).
	return ms >= 2000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Full-width probe result: status line + collapsible, wrapped, selectable detail. */
function ProbeResultView({ outcome }: { outcome: ProbeOutcome }) {
	const [open, setOpen] = useState(!outcome.ok);
	const hasDetail = outcome.detail.trim() !== "";
	const summary = outcome.ok
		? `可用${outcome.latencyMs === null ? "" : ` · ${formatLatency(outcome.latencyMs)}`}`
		: "不可用";
	return (
		<div
			className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-[11px] leading-5 ${
				outcome.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
			}`}
		>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				disabled={!hasDetail}
				aria-expanded={open}
				className="flex w-full items-center gap-1 text-left font-medium disabled:cursor-default"
			>
				{hasDetail ? (
					open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
				) : null}
				{summary}
				{hasDetail && <span className="font-normal opacity-70">{open ? "（收起详情）" : "（展开详情）"}</span>}
			</button>
			{hasDetail && open && (
				<pre className="mt-1 max-h-48 select-text overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 opacity-90">
					{outcome.detail}
				</pre>
			)}
		</div>
	);
}

/** One shared grid for header + rows so every column lines up across rows. */
const ROW_GRID =
	"grid grid-cols-[minmax(0,1.6fr)_56px_112px_minmax(0,2fr)_168px] gap-x-3";

function OverviewRowView({
	row,
	terms,
	showGroupFlag,
	onReplace,
}: {
	row: OverviewRow;
	/** Lower-cased search terms to highlight. */
	terms: readonly string[];
	/** True once the kind catalogue is loaded (so `row.group` is meaningful). */
	showGroupFlag: boolean;
	onReplace: (row: OverviewRow) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [probing, setProbing] = useState(false);
	const [outcome, setOutcome] = useState<ProbeOutcome | null>(null);
	const probeKind = showGroupFlag ? probeKindOf(row.group) : "chat";
	const total = row.sources.length;
	// While searching, lead with a location that matches so the hit is visible without expanding.
	const first = row.sources.find((s) => sourceMatches(s, terms)) ?? row.sources[0];

	const run = async () => {
		if (probeKind === null) return;
		setProbing(true);
		setOutcome(null);
		try {
			const result: ModelProbeResult = await modelProbe(row.selector, probeKind);
			setOutcome({ ok: result.ok, latencyMs: result.latencyMs, detail: result.detail });
		} catch (e) {
			setOutcome({ ok: false, latencyMs: null, detail: errMsg(e) });
		} finally {
			setProbing(false);
		}
	};
	return (
		<div className="border-t border-[var(--border-divider)] px-4 py-2.5 text-[11px] transition-colors hover:bg-[var(--bg-hover)]/40">
			<div className={`${ROW_GRID} items-center`}>
				<span className="break-all font-mono text-xs leading-5 text-neutral-100" title={row.selector}>
					<Highlight text={row.selector} terms={terms} />
				</span>
				<span>
					<Chip tone="neutral">{row.count} 处</Chip>
				</span>
				<span className="flex flex-wrap gap-1">
					{row.levels.length > 0 ? (
						<Chip tone="info" title="已带思考等级引用">
							{row.levels.join("/")}
						</Chip>
					) : (
						<span className="text-neutral-600">—</span>
					)}
				</span>
				<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
					<span className="min-w-0 break-all text-neutral-400">
						{first ? <Highlight text={`${first.title} · ${first.scope}`} terms={terms} /> : ""}
					</span>
					{total > 1 && (
						<button
							type="button"
							onClick={() => setExpanded((v) => !v)}
							aria-expanded={expanded}
							title={expanded ? "收起位置列表" : "展开查看全部出现位置"}
							className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] text-[var(--accent)] transition-all hover:bg-[var(--bg-hover)] active:scale-95"
						>
							{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
							全部 {total} 处
						</button>
					)}
				</div>
				<div className="flex items-center justify-end gap-2">
					{probeKind === null ? (
						<span
							title="此类型暂不支持测试"
							className="whitespace-nowrap rounded-full bg-[var(--well-bg)] px-2.5 py-1 text-[10px] text-neutral-500"
						>
							不支持测试
						</span>
					) : (
						<button
							type="button"
							onClick={() => void run()}
							disabled={probing}
							title={`用一次真实调用测试 ${row.selector}（含 omp 启动，通常几秒）`}
							className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full hairline bg-[var(--well-bg)] px-3 py-1 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95 disabled:opacity-50"
						>
							{probing ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
							测试
						</button>
					)}
					<button
						type="button"
						onClick={() => onReplace(row)}
						title="把这个模型的所有引用换成另一个模型"
						className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--accent)] transition-all hover:bg-[color-mix(in_oklab,var(--accent)_28%,transparent)] active:scale-95"
					>
						<ArrowRightLeft className="h-3 w-3" />
						替换
					</button>
				</div>
			</div>
			{expanded && (
				<ul className="mt-1.5 space-y-0.5 rounded-lg bg-[var(--well-bg)] px-2.5 py-1.5">
					{row.sources.map((s) => (
						<li key={`${s.scope}\u0000${s.title}`} className="flex items-start gap-2 leading-5">
							<span className="w-20 shrink-0 break-all text-neutral-500">
								<Highlight text={s.scope} terms={terms} />
							</span>
							<span className="min-w-0 flex-1 break-all text-neutral-300">
								<Highlight text={s.title} terms={terms} />
							</span>
						</li>
					))}
				</ul>
			)}
			{probing && (
				<p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-500">
					<Loader2 className="h-3 w-3 animate-spin" />
					测试中…（真实调用）
				</p>
			)}
			{!probing && outcome !== null && <ProbeResultView outcome={outcome} />}
		</div>
	);
}

function Highlight({ text, terms }: { text: string; terms: readonly string[] }) {
	return (
		<>
			{highlightParts(text, terms).map((part, i) =>
				part.match ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and static per text
					<mark key={i} className="rounded-sm bg-[color-mix(in_oklab,var(--accent)_30%,transparent)] px-px text-inherit">
						{part.text}
					</mark>
				) : (
					part.text
				),
			)}
		</>
	);
}

export function ModelReplaceOverview({
	scan,
	loading,
	error,
	scope,
	query,
	onScopeChange,
	onQueryChange,
	onRescan,
	onReplace,
}: {
	scan: ModelUsageScan | null;
	loading: boolean;
	error: string | null;
	scope: ReplaceScope;
	query: string;
	onScopeChange: (scope: ReplaceScope) => void;
	onQueryChange: (query: string) => void;
	onRescan: () => void;
	onReplace: (row: OverviewRow) => void;
}) {
	const kindEntries = useModelKindCatalog((s) => s.entries);
	const kindBySelector = useModelKindCatalog((s) => s.kindBySelector);
	const kindLoading = useModelKindCatalog((s) => s.loading);
	const kindError = useModelKindCatalog((s) => s.error);
	useEffect(() => {
		void useModelKindCatalog.getState().load();
	}, []);

	// Only a loaded catalogue says anything about a model: while loading or after an
	// error no row is grouped or flagged as missing.
	const kindsReady = kindEntries !== null && kindError === null;
	const scopeOptions_ = useMemo(() => scopeOptions(scan), [scan]);
	const rows = useMemo(
		() => buildOverview(scan, kindsReady ? kindBySelector : null, scope),
		[scan, kindsReady, kindBySelector, scope],
	);
	const terms = useMemo(() => searchTerms(query), [query]);
	const visibleRows = useMemo(() => filterOverviewRows(rows, query), [rows, query]);
	const sections = useMemo(
		() =>
			KIND_GROUP_ORDER.map((group) => ({ group, rows: visibleRows.filter((r) => r.group === group) })).filter(
				(s) => s.rows.length > 0,
			),
		[visibleRows],
	);

	const rescan = () => {
		onRescan();
		void useModelKindCatalog.getState().load(true);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-between gap-4 px-4 pb-3">
				<p className="text-xs leading-5 text-neutral-400">
					下面是当前所有模型引用的使用情况。点某个模型右侧的「替换」，就能把它的所有引用批量换成另一个模型。
				</p>
				<button
					type="button"
					onClick={rescan}
					disabled={loading || kindLoading}
					title="重新扫描模型引用和模型目录"
					className="inline-flex shrink-0 items-center gap-1.5 rounded-full hairline bg-[var(--bg-active-fill)] px-3 py-1 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50"
				>
					<RefreshCw className={`h-3 w-3 ${loading || kindLoading ? "animate-spin" : ""}`} />
					重新扫描
				</button>
			</div>

			<div className="flex flex-wrap items-center gap-2 px-4 pb-3">
				<SearchInput
					className="min-w-48 flex-1"
					value={query}
					onChange={onQueryChange}
					placeholder="搜索模型名、供应商或位置"
					ariaLabel="搜索模型引用"
					iconSize={12}
					inputClassName="w-full rounded-lg hairline bg-[var(--bg-active-fill)] py-1.5 pl-8 pr-8 text-xs text-[var(--text)] placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
				/>
				<span className="shrink-0 text-[11px] text-neutral-500">范围</span>
				<NativeSelect
					aria-label="替换范围"
					value={scope}
					onChange={(e) => onScopeChange(e.target.value as ReplaceScope)}
					containerClassName="w-72"
					className="text-[11px]"
					title={scopeOptions_.find((o) => o.value === scope)?.title}
				>
					{scopeOptions_.map((o) => (
						<option key={o.value} value={o.value} title={o.title}>
							{o.label}
						</option>
					))}
				</NativeSelect>
			</div>

			{error !== null && (
				<div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] leading-5 text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">
						{scan ? `扫描失败，保留上次结果：${error}` : `无法扫描模型引用：${error}`}
					</span>
				</div>
			)}

			{kindError !== null && (
				<div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] px-3 py-2 text-[11px] leading-5 text-[var(--status-warning)]">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">
						无法加载模型目录，暂不分组，也无法判断哪些模型已失效：{kindError}
					</span>
				</div>
			)}

			{kindLoading && kindEntries === null && (
				<p className="mx-3 mb-2 flex items-center gap-2 text-[11px] text-neutral-400">
					<Loader2 className="h-3 w-3 animate-spin" />
					正在加载模型目录（用于分类，约需几秒）…
				</p>
			)}

			{loading && scan === null && (
				<div className="flex items-center gap-2 px-3 py-6 text-xs text-neutral-400">
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
					正在扫描模型引用…
				</div>
			)}

			{scan !== null && rows.length === 0 && (
				<div className="px-3 py-6 text-xs text-neutral-500">
					{scope === "all"
						? "没有扫描到任何模型引用。先在「模型角色」里给角色指定模型，或在定时任务里选择模型。"
						: "这个范围内没有模型引用。把范围改成「全部」可以看到所有位置。"}
				</div>
			)}

			{rows.length > 0 && visibleRows.length === 0 && (
				<div className="px-3 py-6 text-xs text-neutral-500">
					没有匹配「{query.trim()}」的模型引用。试试模型名、供应商或位置（如角色、项目名）的一部分。
				</div>
			)}

			{visibleRows.length > 0 && (
				<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
					{(kindsReady ? sections : [{ group: null, rows: visibleRows }]).map((section) => (
						<section
							key={section.group ?? "all"}
							className="overflow-hidden rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)]/40"
						>
							{section.group !== null && (
								<header className="flex items-center gap-2 bg-[var(--well-bg)] px-4 py-2.5 text-xs font-semibold text-neutral-200">
									<span
										aria-hidden
										className={`h-1.5 w-1.5 shrink-0 rounded-full ${section.group === "missing" ? "bg-[var(--status-warning)]" : "bg-[var(--accent)]"}`}
									/>
									{KIND_GROUP_TITLES[section.group]}
									<span className="rounded-full bg-[var(--bg-active-fill)] px-1.5 py-px text-[10px] font-normal text-neutral-400">
										{section.rows.length}
									</span>
								</header>
							)}
							<div className={`${ROW_GRID} border-t border-[var(--border-divider)] px-4 py-1.5 text-[10px] font-medium tracking-wide text-neutral-500`}>
								<span>模型</span>
								<span>引用</span>
								<span>思考等级</span>
								<span>出现位置</span>
								<span />
							</div>
							{section.rows.map((row) => (
								<OverviewRowView
									key={row.selector}
									row={row}
									terms={terms}
									showGroupFlag={kindsReady}
									onReplace={onReplace}
								/>
							))}
						</section>
					))}
					<p className="flex items-start gap-1.5 px-1 text-[10px] leading-4 text-neutral-500">
						<PlayCircle className="mt-px h-3 w-3 shrink-0" />
						「测试」会按模型类型用一次真实调用探测它（消耗少量 token），只在点击时执行。
					</p>
				</div>
			)}
		</div>
	);
}
