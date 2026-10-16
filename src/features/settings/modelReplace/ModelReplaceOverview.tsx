/**
 * [D] Step 1 of 批量替换模型: every model currently referenced, grouped by
 * selector, with its reference count, a 可能失效 badge when it is missing from
 * the model catalogue and a manual 测试 probe per row (never automatic).
 * Clicking a row's 选为来源 picks the source model X.
 */
import { AlertTriangle, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { HoverScrollText } from "../../../components/HoverScrollText";
import type { ModelProbeResult, ModelUsageScan } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { modelProbe } from "../../../lib/ipc";
import { buildOverview, type OverviewRow } from "./logic";
import { BTN_GHOST, Chip } from "./parts";

/** One row's probe state; each probe is a real one-shot call the user asked for. */
function ProbeCell({ selector }: { selector: string }) {
	const [probing, setProbing] = useState(false);
	const [result, setResult] = useState<ModelProbeResult | null>(null);
	const [error, setError] = useState<string | null>(null);

	const run = async () => {
		setProbing(true);
		setError(null);
		try {
			setResult(await modelProbe(selector));
		} catch (e) {
			setResult(null);
			setError(errMsg(e));
		} finally {
			setProbing(false);
		}
	};

	const failed = error !== null || (result !== null && !result.ok);
	const detail = error ?? result?.detail ?? "";
	// A probe runs a real `omp -p`, so its wall time includes omp startup (seconds).
	const latency = result === null ? "" : result.latencyMs >= 2000 ? `${(result.latencyMs / 1000).toFixed(1)}s` : `${result.latencyMs}ms`;
	return (
		<>
			<button
				type="button"
				onClick={() => void run()}
				disabled={probing}
				title={`用一次真实调用测试 ${selector}（含 omp 启动，通常几秒）`}
				className="shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50"
			>
				{probing ? <Loader2 className="h-3 w-3 animate-spin" /> : "测试"}
			</button>
			{probing && <span className="text-[10px] text-neutral-500">测试中…（真实调用）</span>}
			{!probing && (result || error) && (
				<span
					title={detail}
					className={`max-w-[220px] truncate text-[10px] ${failed ? "text-rose-300" : "text-emerald-300"}`}
				>
					{failed ? "不可用" : `可用 ${latency}`}
					{detail ? ` · ${detail}` : ""}
				</span>
			)}
		</>
	);
}

function OverviewRowView({
	row,
	catalogReady,
	onPick,
}: {
	row: OverviewRow;
	catalogReady: boolean;
	onPick: (selector: string) => void;
}) {
	return (
		<div className="flex items-center gap-2 border-t border-[var(--border-divider)] px-3 py-2 text-[11px]">
			<HoverScrollText
				text={row.selector}
				className="min-w-0 flex-[2]"
				innerClassName="font-mono text-neutral-200"
				title={row.selector}
			/>
			<Chip tone="neutral">{row.count} 处引用</Chip>
			{row.levels.length > 0 && (
				<Chip tone="info" title="已带思考等级引用">
					{row.levels.join("/")}
				</Chip>
			)}
			{catalogReady && !row.inCatalog && row.referencedAsModel && (
				<Chip tone="warn" title="模型目录里没有这个模型，可能已失效或被改名">
					可能失效
				</Chip>
			)}
			<HoverScrollText
				text={row.sources.join("、") + (row.extraSources > 0 ? ` 等 ${row.sources.length + row.extraSources} 处` : "")}
				className="min-w-0 flex-[3]"
				innerClassName="text-neutral-500"
				title={row.sources.join("、")}
			/>
			<ProbeCell selector={row.selector} />
			<button
				type="button"
				onClick={() => onPick(row.selector)}
				title={`把 ${row.selector} 作为要替换的模型`}
				className={BTN_GHOST}
			>
				选为来源
			</button>
		</div>
	);
}

export function ModelReplaceOverview({
	scan,
	loading,
	error,
	catalogKeys,
	onRescan,
	onPick,
}: {
	scan: ModelUsageScan | null;
	loading: boolean;
	error: string | null;
	catalogKeys: ReadonlySet<string>;
	onRescan: () => void;
	onPick: (selector: string) => void;
}) {
	const rows = useMemo(() => buildOverview(scan, catalogKeys), [scan, catalogKeys]);
	// An empty catalogue means "not loaded yet" or "omp unavailable": it says nothing about
	// any single model, so no row is flagged until the catalogue has entries.
	const catalogReady = catalogKeys.size > 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-between gap-3 px-3 pb-2">
				<p className="text-[11px] leading-5 text-neutral-400">
					下面是当前所有模型引用的使用情况。选一个模型作为「来源 X」，再把它的引用批量换成另一个模型。
				</p>
				<button
					type="button"
					onClick={onRescan}
					disabled={loading}
					title="重新扫描模型引用"
					className="inline-flex shrink-0 items-center gap-1.5 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-1 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50"
				>
					<RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
					重新扫描
				</button>
			</div>

			{error !== null && (
				<div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] leading-5 text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">
						{scan ? `扫描失败，保留上次结果：${error}` : `无法扫描模型引用：${error}`}
					</span>
				</div>
			)}

			{loading && scan === null && (
				<div className="flex items-center gap-2 px-3 py-6 text-xs text-neutral-400">
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
					正在扫描模型引用…
				</div>
			)}

			{scan !== null && rows.length === 0 && (
				<div className="px-3 py-6 text-xs text-neutral-500">
					没有扫描到任何模型引用。先在「模型角色」里给角色指定模型，或在定时任务里选择模型。
				</div>
			)}

			{rows.length > 0 && (
				<div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
					<div className="rounded-xl hairline">
						<div className="flex items-center gap-2 rounded-t-xl bg-[var(--well-bg)] px-3 py-1.5 text-[10px] text-neutral-500">
							<span className="min-w-0 flex-[2]">模型</span>
							<span className="flex-[3]">出现位置</span>
							<span className="flex-1" />
						</div>
						{rows.map((row) => (
							<OverviewRowView key={row.selector} row={row} catalogReady={catalogReady} onPick={onPick} />
						))}
					</div>
					{!catalogReady && (
						<p className="flex items-start gap-1.5 px-1 pt-2 text-[10px] leading-4 text-amber-300/80">
							<AlertTriangle className="mt-px h-3 w-3 shrink-0" />
							模型目录尚未加载（或 omp 不可用），暂时无法判断哪些模型已失效；可点「测试」逐个确认。
						</p>
					)}
					<p className="flex items-start gap-1.5 px-1 pt-2 text-[10px] leading-4 text-neutral-500">
						<PlayCircle className="mt-px h-3 w-3 shrink-0" />
						「测试」会用一次真实调用探测该模型（消耗少量 token），只在点击时执行。
					</p>
				</div>
			)}
		</div>
	);
}
