/**
 * [D] 批量替换模型 dialog (Settings ▸ 模型角色 header):
 * scan overview → pick source X, target Y and thinking level → preview →
 * apply → results (per-item retry + switching live sessions) with a history
 * view for undo. Nested modal: `createPortal` to `document.body` at
 * `Z_LAYER.modal` so it stays above the settings modal (§12).
 */
import { AlertTriangle, ArrowLeft, History, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z_LAYER } from "../../../components/FloatingLayer";
import type {
	ModelReplaceEdit,
	ModelReplaceItemResult,
	ModelReplaceRecord,
	ModelUsageScan,
} from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { isComposing } from "../../../lib/hooks";
import {
	modelReplaceApply,
	modelReplaceHistory,
	modelReplaceUndo,
	modelUsageScan,
} from "../../../lib/ipc";
import { useCatalogModels } from "../useAppSettings";
import { buildPlan, mergeResults, projectNameMap, type RowOverride } from "./logic";
import { ModelReplaceHistory, type UndoOutcome } from "./ModelReplaceHistory";
import { ModelReplaceOverview } from "./ModelReplaceOverview";
import { ModelReplacePlanPreview } from "./ModelReplacePlanPreview";
import { ModelReplaceResults } from "./ModelReplaceResults";
import { invalidateAfterModelReplace } from "./store";
import { BTN_GHOST, BTN_PRIMARY, LevelSelect, TargetPicker } from "./parts";

type Step = "overview" | "configure" | "preview" | "results" | "history";

const STEP_ORDER: Step[] = ["overview", "configure", "preview", "results"];

const STEP_LABELS: Record<Step, string> = {
	overview: "选择来源",
	configure: "选择目标",
	preview: "预览改动",
	results: "执行结果",
	history: "历史记录",
};

const FIELD_LABEL = "w-16 shrink-0 text-[11px] text-neutral-500";

export function ModelReplaceDialog({ onClose }: { onClose: () => void }) {
	const { models, catalogKeys } = useCatalogModels();
	const [step, setStep] = useState<Step>("overview");
	const [scan, setScan] = useState<ModelUsageScan | null>(null);
	const [scanLoading, setScanLoading] = useState(false);
	const [scanError, setScanError] = useState<string | null>(null);
	const [fromModel, setFromModel] = useState("");
	const [toModel, setToModel] = useState("");
	const [level, setLevel] = useState<string | null>(null);
	const [overrides, setOverrides] = useState<Record<string, RowOverride>>({});
	const [checked, setChecked] = useState<Record<string, boolean>>({});
	const [results, setResults] = useState<ModelReplaceItemResult[]>([]);
	const [recordId, setRecordId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [history, setHistory] = useState<ModelReplaceRecord[]>([]);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string | null>(null);
	const [undoingId, setUndoingId] = useState<string | null>(null);
	const [undoOutcome, setUndoOutcome] = useState<UndoOutcome | null>(null);
	const dialogRef = useRef<HTMLDivElement>(null);

	const rescan = useCallback(async () => {
		setScanLoading(true);
		setScanError(null);
		try {
			setScan(await modelUsageScan());
		} catch (e) {
			setScanError(errMsg(e));
		} finally {
			setScanLoading(false);
		}
	}, []);

	const loadHistory = useCallback(async () => {
		setHistoryLoading(true);
		setHistoryError(null);
		try {
			setHistory(await modelReplaceHistory());
		} catch (e) {
			setHistoryError(errMsg(e));
		} finally {
			setHistoryLoading(false);
		}
	}, []);

	useEffect(() => {
		void rescan();
	}, [rescan]);

	useEffect(() => {
		dialogRef.current?.focus();
	}, []);

	const projectNames = useMemo(() => projectNameMap(scan?.projects ?? []), [scan]);
	const plan = useMemo(
		() =>
			scan && fromModel && toModel
				? buildPlan({ scan, fromModel, toModel, level, overrides, checked })
				: null,
		[scan, fromModel, toModel, level, overrides, checked],
	);

	const applyEdits = useCallback(
		async (edits: ModelReplaceEdit[], record: string | null) => {
			if (edits.length === 0) return;
			setBusy(true);
			setError(null);
			try {
				const response = await modelReplaceApply(fromModel, toModel, edits, record);
				setResults((previous) => mergeResults(previous, response.results));
				setRecordId(response.recordId ?? record);
				// Config, app settings and schedules changed behind the settings pages.
				invalidateAfterModelReplace();
				setStep("results");
			} catch (e) {
				setError(errMsg(e));
			} finally {
				setBusy(false);
			}
		},
		[fromModel, toModel],
	);

	const undo = useCallback(
		async (id: string) => {
			setUndoingId(id);
			setError(null);
			try {
				const response = await modelReplaceUndo(id);
				setUndoOutcome({ recordId: id, results: response.results });
				invalidateAfterModelReplace();
				await loadHistory();
			} catch (e) {
				setError(errMsg(e));
			} finally {
				setUndoingId(null);
			}
		},
		[loadHistory],
	);

	const openHistory = () => {
		setStep("history");
		void loadHistory();
	};

	return createPortal(
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] p-6 backdrop-blur-sm"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !busy) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-replace-title"
				tabIndex={-1}
				className="flex h-[min(88vh,780px)] w-[900px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-[var(--bg-panel)] p-4 text-[var(--text)] shadow-apple-modal hairline outline-none"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					// Escape must never reach the settings modal underneath.
					e.stopPropagation();
					if (isComposing(e)) return;
					if (e.key === "Escape") {
						e.preventDefault();
						if (!busy) onClose();
						return;
					}
					if (e.key === "Tab") {
						const controls = Array.from(
							e.currentTarget.querySelectorAll<HTMLElement>(
								'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
							),
						).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
						if (controls.length === 0) return;
						const first = controls[0];
						const last = controls[controls.length - 1];
						if (e.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							last?.focus();
						} else if (!e.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
							e.preventDefault();
							first?.focus();
						}
					}
				}}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-divider)] pb-3">
					<div className="min-w-0">
						<h2 id="model-replace-title" className="text-sm font-semibold text-[var(--text)]">
							批量替换模型
						</h2>
						<p className="mt-0.5 text-[11px] leading-5 text-neutral-400">
							把一处模型用法批量换成另一个模型：全局与项目配置、回退链、应用设置和定时任务。
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<div className="flex items-center gap-1">
							{STEP_ORDER.map((s, i) => (
								<span
									key={s}
									className={`rounded-full px-2 py-0.5 text-[10px] ${
										step === s
											? "bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]"
											: "bg-[var(--well-bg)] text-neutral-500"
									}`}
								>
									{i + 1} {STEP_LABELS[s]}
								</span>
							))}
						</div>
						<button
							type="button"
							onClick={openHistory}
							title="查看最近的批量替换并撤销"
							className="inline-flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-1 text-[11px] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95"
						>
							<History className="h-3 w-3" />
							历史记录
						</button>
						<button
							type="button"
							onClick={onClose}
							aria-label="关闭"
							title="关闭"
							className="rounded-lg p-1 text-neutral-500 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				</div>

				{error !== null && (
					<div role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] leading-5 text-rose-300">
						<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
						<span className="min-w-0 flex-1 break-all">{error}</span>
					</div>
				)}

				<div className="flex min-h-0 flex-1 flex-col pt-3">
					{step === "overview" && (
						<ModelReplaceOverview
							scan={scan}
							loading={scanLoading}
							error={scanError}
							catalogKeys={catalogKeys}
							onRescan={() => void rescan()}
							onPick={(selector) => {
								setFromModel(selector);
								setOverrides({});
								setChecked({});
								setStep("configure");
							}}
						/>
					)}

					{step === "configure" && (
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="rounded-xl hairline">
								<div className="flex items-center gap-3 border-b border-[var(--border-divider)] px-3 py-2.5">
									<span className={FIELD_LABEL}>来源 X</span>
									<span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-200" title={fromModel}>
										{fromModel}
									</span>
									<button type="button" onClick={() => setStep("overview")} className={BTN_GHOST}>
										重新选择
									</button>
								</div>
								<div className="flex items-center gap-3 border-b border-[var(--border-divider)] px-3 py-2.5">
									<span className={FIELD_LABEL}>目标 Y</span>
									<div className="min-w-0 flex-1">
										<TargetPicker
											value={toModel}
											models={models}
											caption="只列出模型目录里的模型"
											onSelect={setToModel}
										/>
									</div>
									<span className="text-[10px] text-neutral-500">仅模型目录中的模型</span>
								</div>
								<div className="flex items-center gap-3 px-3 py-2.5">
									<span className={FIELD_LABEL}>思考等级</span>
									<LevelSelect
										value={level}
										onChange={setLevel}
										ariaLabel="思考等级"
										containerClassName="w-32"
									/>
									<span className="text-[10px] text-neutral-500">
										{level ? `写入 ${toModel}:${level}` : "「模型默认」不写入等级后缀"}
									</span>
								</div>
							</div>
							<p className="px-1 pt-3 text-[11px] leading-5 text-neutral-500">
								匹配规则：只看模型选择器本身（忽略结尾的思考等级后缀），同名但不同供应商的模型不会被替换；
								「@角色」别名不会被改写。
							</p>
						</div>
					)}

					{step === "preview" && plan && (
						<ModelReplacePlanPreview
							plan={plan}
							fromModel={fromModel}
							models={models}
							overrides={overrides}
							onOverride={(rowId, override) =>
								setOverrides((previous) => {
									const next = { ...previous };
									if (override === null) delete next[rowId];
									else next[rowId] = override;
									return next;
								})
							}
							onToggle={(rowId, isChecked) => setChecked((previous) => ({ ...previous, [rowId]: isChecked }))}
						/>
					)}

					{step === "results" && (
						<ModelReplaceResults
							results={results}
							fromModel={fromModel}
							toModel={toModel}
							level={level}
							projectNames={projectNames}
							retrying={busy}
							onRetry={(edits) => void applyEdits(edits, recordId)}
						/>
					)}

					{step === "history" && (
						<ModelReplaceHistory
							records={history}
							loading={historyLoading}
							error={historyError}
							projectNames={projectNames}
							undoingId={undoingId}
							undoOutcome={undoOutcome}
							onReload={() => void loadHistory()}
							onUndo={(id) => void undo(id)}
						/>
					)}
				</div>

				<div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-divider)] pt-3">
					<div className="flex items-center gap-2">
						{step === "preview" && (
							<button type="button" onClick={() => setStep("configure")} className={BTN_GHOST} disabled={busy}>
								<ArrowLeft className="mr-1 inline h-3 w-3" />
								上一步
							</button>
						)}
						{step === "history" && (
							<button type="button" onClick={() => setStep("overview")} className={BTN_GHOST}>
								<ArrowLeft className="mr-1 inline h-3 w-3" />
								返回替换
							</button>
						)}
					</div>
					<div className="flex items-center gap-2">
						{step === "configure" && (
							<button
								type="button"
								onClick={() => setStep("preview")}
								disabled={toModel.trim() === ""}
								className={BTN_PRIMARY}
							>
								预览改动
							</button>
						)}
						{step === "preview" && plan && (
							<button
								type="button"
								onClick={() => void applyEdits(plan.edits, null)}
								disabled={busy || plan.edits.length === 0}
								className={BTN_PRIMARY}
							>
								{busy ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
								应用 {plan.edits.length} 项
							</button>
						)}
						{step === "results" && (
							<button type="button" onClick={onClose} className={BTN_PRIMARY}>
								完成
							</button>
						)}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}
