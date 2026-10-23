/**
 * [D] 批量替换模型 dialog (Settings ▸ 模型角色 header):
 * scan overview → pick source X, target Y (per kind) and — for chat models —
 * a thinking level → preview → apply → results (per-item retry + switching
 * live sessions) with a history view for undo. Every step after the first can
 * go back: 「上一步」, the header step pills and the history view's return
 * button all keep the source, target, level, row overrides and checks; those
 * only reset when the source changes. Leaving the results page ends that run
 * (its record is in the history), drops the per-item outcome and re-scans, so
 * the next apply plans against what is on disk now and can never re-send the
 * rows the last run already rewrote; 「返回总览」 additionally starts over
 * (fresh source, no target) instead of closing the dialog. Nested
 * modal: `createPortal` to `document.body` at `Z_LAYER.modal` so it stays
 * above the settings modal (§12).
 */
import { AlertTriangle, ArrowLeft, History, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../../components/Modal";
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
import { groupTakesThinkingLevel, type KindGroup, kindGroup, useModelKindCatalog } from "./kinds";
import {
	buildPlan,
	levelsForSelector,
	mergeResults,
	type OverviewRow,
	type OverviewSource,
	projectNameMap,
	type RowOverride,
	type ReplaceScope,
	sanitizeOverrides,
	scopeLabel,
	supportedLevel,
} from "./logic";
import { ModelReplaceHistory, type UndoOutcome } from "./ModelReplaceHistory";
import { ModelReplaceOverview } from "./ModelReplaceOverview";
import { ModelReplacePlanPreview } from "./ModelReplacePlanPreview";
import { ModelReplaceResults } from "./ModelReplaceResults";
import { invalidateAfterModelReplace } from "./store";
import { BTN_GHOST, BTN_PRIMARY, LevelSelect, TargetPicker, tabOfGroup } from "./parts";

type Step = "overview" | "configure" | "preview" | "results" | "history";

const STEP_ORDER: Step[] = ["overview", "configure", "preview", "results"];

const STEP_LABELS: Record<Step, string> = {
	overview: "选择来源",
	configure: "选择目标",
	preview: "预览改动",
	results: "执行结果",
	history: "历史记录",
};

const FIELD_LABEL = "w-20 shrink-0 text-[11px] text-neutral-500";

export function ModelReplaceDialog({ onClose }: { onClose: () => void }) {
	const kinds = useModelKindCatalog();
	const { load: loadKinds } = kinds;
	const [step, setStep] = useState<Step>("overview");
	const [scan, setScan] = useState<ModelUsageScan | null>(null);
	const [scanLoading, setScanLoading] = useState(false);
	const [scanError, setScanError] = useState<string | null>(null);
	const [fromModel, setFromModel] = useState("");
	const [fromGroup, setFromGroup] = useState<KindGroup>("chat");
	const [fromSources, setFromSources] = useState<OverviewSource[]>([]);
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
	const [historyReturn, setHistoryReturn] = useState<Step>("overview");
	const [scope, setScope] = useState<ReplaceScope>("all");
	const [query, setQuery] = useState("");
	/**
	 * The cached scan predates the last apply: its rows still hold the values the
	 * run rewrote. Cleared only by a successful rescan, so a plan built from it can
	 * never be applied (the backend rejects stale edits anyway, but the user must
	 * not be sent there in the first place).
	 */
	const [scanStale, setScanStale] = useState(false);
	/** Identifies the current apply/retry run; a response for an abandoned run is dropped. */
	const runRef = useRef(0);
	/** Writes started so far; a scan that spans one of them is stale. */
	const writeGenRef = useRef(0);
	/** Writes currently on their way to the backend. */
	const writesInFlightRef = useRef(0);
	/** A rescan was asked for while a write was running; it runs as soon as the write lands. */
	const rescanPendingRef = useRef(false);
	/** Identifies the newest scan request; an older response must not replace it. */
	const scanRef = useRef(0);

	const rescan = useCallback(async () => {
		// Never scan across a write: the config file may be mid-splice, so the result
		// would describe neither the old nor the new state. The write re-runs it.
		if (writesInFlightRef.current > 0) {
			rescanPendingRef.current = true;
			return;
		}
		const request = ++scanRef.current;
		const genAtStart = writeGenRef.current;
		setScanLoading(true);
		setScanError(null);
		try {
			const next = await modelUsageScan();
			// Only the newest request may install a scan (返回总览 can start one while
			// an abandoned run's rescan is still in flight).
			if (request !== scanRef.current) return;
			setScan(next);
			// A write landed while this scan ran: its rows may already be old.
			setScanStale(writeGenRef.current !== genAtStart);
		} catch (e) {
			if (request === scanRef.current) setScanError(errMsg(e));
		} finally {
			if (request === scanRef.current) setScanLoading(false);
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
		void loadKinds();
	}, [loadKinds]);


	const projectNames = useMemo(() => projectNameMap(scan?.projects ?? []), [scan]);
	const toGroup: KindGroup | null = toModel ? kindGroup(kinds.kindBySelector.get(toModel)) : null;
	// Thinking levels only mean something for chat models; other kinds never get a suffix.
	const isChat = toGroup !== null && groupTakesThinkingLevel(toGroup);
	// The levels come from the chosen target's catalog entry; none = no level control, no suffix.
	const levels = useMemo(() => (isChat ? levelsForSelector(kinds.entries, toModel) : []), [isChat, kinds.entries, toModel]);
	const takesLevel = levels.length > 0;
	const effectiveLevel = supportedLevel(level, levels);
	const effectiveOverrides = useMemo(
		() => sanitizeOverrides(overrides, toModel, effectiveLevel, kinds.entries),
		[overrides, toModel, effectiveLevel, kinds.entries],
	);
	const plan = useMemo(
		() =>
			scan && fromModel && toModel
				? buildPlan({ scan, fromModel, toModel, level: effectiveLevel, overrides: effectiveOverrides, checked, scope })
				: null,
		[scan, fromModel, toModel, effectiveLevel, effectiveOverrides, checked, scope],
	);

	const pickSource = (row: OverviewRow) => {
		if (row.selector !== fromModel) {
			setToModel("");
			setLevel(null);
			setOverrides({});
			setChecked({});
		}
		// Choosing a source starts a new replacement; the previous run's outcome stays
		// in 历史记录, but it is no longer this flow's results page.
		setResults([]);
		setRecordId(null);
		setFromModel(row.selector);
		setFromGroup(row.group);
		setFromSources(row.sources);
		setError(null);
		setStep("configure");
	};

	const pickTarget = (selector: string) => {
		const nextGroup = kindGroup(kinds.kindBySelector.get(selector));
		// Row overrides stay on the target's kind; a level the new target lacks falls back to 模型默认.
		if (nextGroup !== toGroup) setOverrides({});
		if (!groupTakesThinkingLevel(nextGroup) || !supportedLevel(level, levelsForSelector(kinds.entries, selector))) setLevel(null);
		setToModel(selector);
	};

	const applyEdits = useCallback(
		async (edits: ModelReplaceEdit[], record: string | null) => {
			if (edits.length === 0) return;
			const run = ++runRef.current;
			writeGenRef.current += 1;
			writesInFlightRef.current += 1;
			setBusy(true);
			setError(null);
			try {
				const response = await modelReplaceApply(fromModel, toModel, edits, record);
				// The write landed either way: every reader must re-read, and the cached
				// scan no longer describes what is on disk.
				invalidateAfterModelReplace();
				setScanStale(true);
				if (run !== runRef.current) {
					// The user already left this run (返回总览 / 上一步 / 历史记录). Its outcome
					// belongs to a page that is gone; refresh what the write changed.
					void rescan();
					return;
				}
				setResults((previous) => (record === null ? response.results : mergeResults(previous, response.results)));
				setRecordId(response.recordId ?? record);
				// Advance only from the page the apply was launched from. If the user went
				// back to an earlier step (or into 历史记录) while the write was running,
				// leave them there — the results pill now leads to the outcome.
				setStep((current) => (current === "preview" || current === "results" ? "results" : current));
			} catch (e) {
				// A write that failed must not disappear just because the user moved on.
				setError(errMsg(e));
			} finally {
				writesInFlightRef.current -= 1;
				setBusy(false);
				// Whatever asked for a scan while this write was running gets it now.
				if (writesInFlightRef.current === 0 && rescanPendingRef.current) {
					rescanPendingRef.current = false;
					void rescan();
				}
			}
		},
		[fromModel, toModel, rescan],
	);

	const undo = useCallback(
		async (id: string) => {
			setUndoingId(id);
			writeGenRef.current += 1;
			writesInFlightRef.current += 1;
			setError(null);
			try {
				const response = await modelReplaceUndo(id);
				setUndoOutcome({ recordId: id, results: response.results });
				invalidateAfterModelReplace();
				// Undo rewrites the same files: the cached scan is stale again, so a later
				// plan must wait for a fresh one instead of offering values already restored.
				setScanStale(true);
				await loadHistory();
			} catch (e) {
				setError(errMsg(e));
			} finally {
				setUndoingId(null);
				writesInFlightRef.current -= 1;
				if (writesInFlightRef.current === 0 && rescanPendingRef.current) {
					rescanPendingRef.current = false;
					void rescan();
				}
			}
		},
		[loadHistory, rescan],
	);

	const openHistory = () => {
		if (step !== "history") setHistoryReturn(step);
		setStep("history");
		void loadHistory();
	};

	/**
	 * Leaving the results page ends that run. Its record is already in 历史记录, and
	 * keeping the per-item outcome would let 重试失败项 / 应用 re-send rows the run
	 * already rewrote against a scan that still shows the old values. So the outcome
	 * is dropped, the next apply opens a new record, and the scan is re-read before
	 * anything can be planned again (`scanStale` blocks applying until it lands).
	 */
	const endRun = () => {
		runRef.current += 1;
		setResults([]);
		setRecordId(null);
		// A write still in flight defers this scan to its own completion (`rescan`), so
		// the new rows never describe a half-written config.
		void rescan();
	};

	const startOver = () => {
		endRun();
		setError(null);
		setFromModel("");
		setFromSources([]);
		setToModel("");
		setLevel(null);
		setOverrides({});
		setChecked({});
		setResults([]);
		setRecordId(null);
		setStep("overview");
	};

	/** Move between steps, keeping source, target, level, overrides and checks. */
	const goToStep = (target: Step) => {
		if (target === step) return;
		// 历史记录 is an overlay: the step it was opened from is still the one being left.
		const from = step === "history" ? historyReturn : step;
		// Leaving the results page ends that run: its rows must never be re-sent, and
		// the plan has to be rebuilt from a fresh scan.
		if (from === "results" && target !== "results") endRun();
		// A pill clicked from 历史记录 becomes the step that view returns to.
		if (step === "history") setHistoryReturn(target);
		setStep(target);
	};

	/**
	 * Which steps the header pills may open. Earlier steps are always a way back and
	 * the results page stays reachable while its outcome does; a forward jump from
	 * the overview would open the target step with no source, so it stays
	 * unavailable. From 历史记录 the pills behave as if the user were still on the
	 * step they opened it from.
	 */
	const canOpenStep = (target: Step): boolean => {
		if (target === step) return false;
		if (target === "results") return results.length > 0;
		const current = step === "history" ? historyReturn : step;
		return STEP_ORDER.indexOf(target) < STEP_ORDER.indexOf(current);
	};

	/**
	 * Where 历史记录 goes back to. A run that has been left (返回总览) no longer has
	 * a results page, so the return target degrades to the overview instead of a
	 * blank step.
	 */
	const historyBack: Step =
		historyReturn === "results" && results.length === 0 ? "overview" : historyReturn;
	const historyBackLabel =
		historyBack === "results" ? "返回结果" : `返回${STEP_LABELS[historyBack]}`;
	/** Why 应用 is unavailable although a plan exists (stale scan after an apply). */
	const applyBlocked =
		scanStale && step === "preview"
			? scanError !== null
				? `上次替换已经写入，重新扫描失败，暂时不能再次应用：${scanError}。回到第一步可以重试扫描。`
				: "上次替换已经写入，正在重新扫描模型引用；扫描完成前不能再次应用。"
			: null;

	return (
		<Modal
			onClose={onClose}
			size="none"
			ariaLabel="批量替换模型"
			className="h-[min(85vh,780px)] w-[900px] max-w-[calc(100vw-2rem)] overflow-hidden p-4 text-[var(--text)]"
		>
			<div
				className="flex min-h-0 flex-1 flex-col"
				onKeyDown={(e) => {
					// Keep keys inside the dialog from reaching the settings modal underneath;
					// Escape must still reach Modal's window listener.
					if (e.key !== "Escape") e.stopPropagation();
					if (isComposing(e)) return;
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
							{STEP_ORDER.map((s, i) => {
								const reachable = canOpenStep(s);
								const chipClass = `rounded-full px-2 py-0.5 text-[10px] ${
									step === s
										? "bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-[var(--accent)]"
										: reachable
											? "bg-[var(--well-bg)] text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95"
											: "bg-[var(--well-bg)] text-neutral-500"
								}`;
								return reachable ? (
									<button key={s} type="button" onClick={() => goToStep(s)} className={chipClass} title={`回到「${STEP_LABELS[s]}」`}>
										{i + 1} {STEP_LABELS[s]}
									</button>
								) : (
									<span key={s} className={chipClass} aria-current={step === s ? "step" : undefined}>
										{i + 1} {STEP_LABELS[s]}
									</span>
								);
							})}
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
							scope={scope}
							query={query}
							onScopeChange={setScope}
							onQueryChange={setQuery}
							onRescan={() => void rescan()}
							onReplace={pickSource}
						/>
					)}

					{step === "configure" && (
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="rounded-xl hairline">
								<div className="flex items-start gap-3 border-b border-[var(--border-divider)] px-3 py-2.5">
									<span className={`${FIELD_LABEL} pt-0.5`}>要替换的模型</span>
									<div className="min-w-0 flex-1">
										<div className="break-words font-mono text-xs text-neutral-200">{fromModel}</div>
										{fromSources.length > 0 && (
											<div className="mt-2">
												<div className="mb-1 text-[11px] text-neutral-500">出现在以下 {fromSources.length} 处：</div>
												<ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg bg-[var(--well-bg)] px-2.5 py-1.5 text-[11px]">
													{fromSources.map((s) => (
														<li key={`${s.scope}\u0000${s.title}`} className="flex items-start gap-2 leading-5">
															<span className="w-28 shrink-0 break-words text-neutral-500">{s.scope}</span>
															<span className="min-w-0 flex-1 break-words text-neutral-300">{s.title}</span>
														</li>
													))}
												</ul>
											</div>
										)}
									</div>
									<button type="button" onClick={() => setStep("overview")} className={BTN_GHOST}>
										重新选择
									</button>
								</div>
								<div className={`flex items-start gap-3 px-3 py-2.5 ${takesLevel ? "border-b border-[var(--border-divider)]" : ""}`}>
									<span className={`${FIELD_LABEL} pt-1.5`}>统一目标</span>
									<div className="min-w-0 flex-1">
										<TargetPicker
											value={toModel}
											entries={kinds.entries}
											loading={kinds.loading}
											error={kinds.error}
											initialGroup={tabOfGroup(toGroup ?? fromGroup)}
											caption="只列出模型目录里的模型"
											onSelect={pickTarget}
										/>
										<p className="mt-1 text-[10px] text-neutral-500">
											{toGroup !== null && !isChat
												? "这类模型不使用思考等级，不会写入等级后缀。"
												: isChat && !takesLevel
													? "这个模型没有可选的思考等级，不会写入等级后缀。"
													: "所有行默认换成它，个别行可在下一步单独指定；仅模型目录中的模型"}
										</p>
									</div>
								</div>
								{takesLevel && (
									<div className="flex items-center gap-3 px-3 py-2.5">
										<span className={FIELD_LABEL}>思考等级</span>
										<LevelSelect value={effectiveLevel} levels={levels} onChange={setLevel} ariaLabel="思考等级" containerClassName="w-44" />
										<span className="min-w-0 break-all text-[10px] text-neutral-500">
											{effectiveLevel ? `写入 ${toModel}:${effectiveLevel}` : "「模型默认」不写入等级后缀"}
										</span>
									</div>
								)}
							</div>
							<p className="px-1 pt-3 text-[11px] leading-5 text-neutral-500">
								替换范围：{scopeLabel(scope, projectNames)}
								{scope === "all" ? "（所有位置）" : "；只改这个范围内的位置，返回第一步可更改"}。
							</p>
							<p className="px-1 pt-2 text-[11px] leading-5 text-neutral-500">
								匹配规则：只看模型选择器本身（忽略结尾的思考等级后缀，如 :off、:high），同名但不同供应商的模型不会被替换；
								「@角色」别名不会被改写。
							</p>
						</div>
					)}

					{step === "preview" && plan && (
						<ModelReplacePlanPreview
							scopeLabel={scopeLabel(scope, projectNames)}
							plan={plan}
							fromModel={fromModel}
							entries={kinds.entries}
							kindsLoading={kinds.loading}
							kindsError={kinds.error}
							targetGroup={toGroup ?? "chat"}
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
							level={effectiveLevel}
							liveSwitch={isChat}
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
						{step === "configure" && (
							<button type="button" onClick={() => goToStep("overview")} className={BTN_GHOST}>
								<ArrowLeft className="mr-1 inline h-3 w-3" />
								上一步
							</button>
						)}
						{step === "preview" && (
							// Navigation never waits for a write: only the actions that would
							// send another one (应用 / 重试失败项) are disabled meanwhile.
							<button type="button" onClick={() => goToStep("configure")} className={BTN_GHOST}>
								<ArrowLeft className="mr-1 inline h-3 w-3" />
								上一步
							</button>
						)}
						{step === "results" && (
							<button
								type="button"
								onClick={() => goToStep("preview")}
								className={BTN_GHOST}
								title="回到「预览改动」，保留这次的目标和勾选；再次应用会记成新的一次替换"
							>
								<ArrowLeft className="mr-1 inline h-3 w-3" />
								上一步
							</button>
						)}
						{step === "history" && (
							<button type="button" onClick={() => goToStep(historyBack)} className={BTN_GHOST}>
								<ArrowLeft className="mr-1 inline h-3 w-3" />
								{historyBackLabel}
							</button>
						)}
					</div>
					<div className="flex items-center gap-2">
						{applyBlocked !== null && (
							<span role="status" className="flex min-w-0 items-start gap-1.5 text-[11px] leading-4 text-[var(--status-warning)]">
								<AlertTriangle className="mt-px h-3 w-3 shrink-0" />
								<span className="min-w-0 break-all">{applyBlocked}</span>
							</span>
						)}
						{step === "configure" && (
							<button
								type="button"
								onClick={() => goToStep("preview")}
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
								disabled={busy || scanStale || plan.edits.length === 0}
								className={BTN_PRIMARY}
							>
								{busy ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}
								应用 {plan.edits.length} 项
							</button>
						)}
						{step === "results" && (
							<button type="button" onClick={startOver} className={BTN_PRIMARY}>
								返回总览
							</button>
						)}
					</div>
				</div>
			</div>
		</Modal>
	);
}
