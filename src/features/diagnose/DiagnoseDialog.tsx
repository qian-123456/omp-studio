import {
	ChevronDown,
	ChevronRight,
	FileText,
	Loader2,
	RefreshCw,
	Send,
	Stethoscope,
	X,
} from "lucide-react";
import { isComposing } from "../../lib/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { Notice } from "../../components/Notice";
import { errMsg } from "../../lib/dialogs";
import {
	diagnoseBuildPrompt,
	dispatchPrompt,
	rpcStart,
	} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { NativeSelect } from "../../components/NativeSelect";
import { useT } from "../../stores/language";

/**
 * [D] Diagnose dialog. Always mounted; opened via
 * `ui.openModal("diagnose", { sessionId })`.
 */
export function DiagnoseDialog() {
	const { t } = useT();
	const modal = useUi((s) => s.modal);
	const closeModal = useUi((s) => s.closeModal);
	const selectSession = useUi((s) => s.selectSession);
	const sessions = useSessions((s) => s.sessions);

	const isVisible = modal?.name === "diagnose";
	const targetSessionId =
		typeof modal?.props?.sessionId === "string" ? modal.props.sessionId : "";

	const [prompt, setPrompt] = useState<string>("");
	const [loadingPrompt, setLoadingPrompt] = useState(false);
	const [showPromptPreview, setShowPromptPreview] = useState(true);
	const [targetType, setTargetType] = useState<"existing" | "new">("existing");
	const [selectedExistingId, setSelectedExistingId] = useState<string>("");
	const [newSessionModel, setNewSessionModel] = useState<string>("");
	const [dispatching, setDispatching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sending = useRef(false);
	const promptRequest = useRef(0);
	const visit = useRef(0);

	const targetSession = targetSessionId ? sessions[targetSessionId] : undefined;

	const fetchPrompt = useCallback(() => {
		if (!targetSessionId) return;
		const request = ++promptRequest.current;
		setError(null);
		setLoadingPrompt(true);
		diagnoseBuildPrompt(targetSessionId)
			.then((p) => {
				if (request === promptRequest.current) setPrompt(p);
			})
			.catch((err) => {
				if (request !== promptRequest.current) return;
				const msg = errMsg(err);
				setError(t("diagnose.errorGeneratingPrompt", { error: msg }));
				toast.error(t("diagnose.errorGeneratingPrompt", { error: msg }));
			})
			.finally(() => {
				if (request === promptRequest.current) setLoadingPrompt(false);
			});
	}, [targetSessionId, t]);

	useEffect(() => {
		visit.current++;
		if (isVisible && targetSessionId) {
			setPrompt("");
			setDispatching(sending.current);
			setTargetType("existing");
			setNewSessionModel("");
			// Read once per opening, not on catalog refresh.
			const candidateIds = Object.keys(useSessions.getState().sessions).filter(
				(id) => id !== targetSessionId,
			);
			setSelectedExistingId(candidateIds[0] || "");
			fetchPrompt();
		}
		return () => { promptRequest.current++; };
	}, [isVisible, targetSessionId, fetchPrompt]);

	if (!isVisible) return null;

	const handleExecuteDiagnose = async () => {
		if (!prompt || loadingPrompt || sending.current) return;
		sending.current = true;
		const currentVisit = visit.current;
		setDispatching(true);
		setError(null);
		try {
			let diagnoserId = selectedExistingId;
			if (targetType === "new") {
				const cwd = targetSession?.cwd || ".";
				// The diagnoser lives in the diagnosed session's space.
				const info = await rpcStart({
					cwd,
					model: newSessionModel.trim() || undefined,
					mode: targetSession?.mode,
				});
				diagnoserId = info.sessionId;
			} else {
				if (!diagnoserId) throw new Error(t("diagnose.selectDiagnoserSession"));
			}

			await dispatchPrompt(diagnoserId, prompt);

			if (currentVisit !== visit.current) return;
			toast.success(t("diagnose.diagnosisStarted"));
			closeModal();
			selectSession(diagnoserId);
		} catch (err) {
			if (currentVisit !== visit.current) return;
			const msg = errMsg(err);
			setError(msg);
			toast.error(t("diagnose.errorStartingDiagnosis", { error: msg }));
		} finally {
			sending.current = false;
			setDispatching(false);
		}
	};

	const candidateSessions = Object.values(sessions).filter(
		(s) => s.id !== targetSessionId,
	);

	return (
		<Modal
			onClose={closeModal}
			size="none"
			ariaLabel={t("diagnose.title")}
			className="w-full max-w-xl max-h-[min(90vh,720px)] p-6 text-[var(--text)]"
		>
			<div
				className="flex min-h-0 flex-1 flex-col"
				onKeyDown={(e) => {
					if (isComposing(e)) return;
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
						e.preventDefault();
						if (!loadingPrompt && !dispatching && prompt && (targetType !== "existing" || selectedExistingId)) {
							void handleExecuteDiagnose();
						}
						return;
					}
					if (e.key === "Tab") {
						const controls = Array.from(
							e.currentTarget.querySelectorAll<HTMLElement>(
								'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
				<div className="mb-4 flex items-center justify-between border-b border-[var(--border-divider)] pb-3 shrink-0">
					<div className="flex items-center gap-2.5">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-400">
							<Stethoscope className="h-4 w-4" />
						</div>
						<div>
							<h2 id="diagnose-dialog-title" className="text-sm font-semibold text-[var(--text)]">
								{t("diagnose.title")}
							</h2>
							<p className="text-[11px] text-neutral-400">
								{t("diagnose.subtitle")}
							</p>
						</div>
					</div>
					<button
						type="button"
						title={t("diagnose.closeEsc")}
						aria-label={t("diagnose.closeDialog")}
						onClick={closeModal}
						className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				<div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">

				{error && (
					<div className="mb-4">
						<Notice
							tone="danger"
							action={
								<button
									type="button"
									onClick={fetchPrompt}
									disabled={loadingPrompt}
									className="inline-flex items-center gap-1 rounded bg-[var(--bg-hover)] px-2 py-1 text-xs text-neutral-200 hover:bg-[var(--bg-active-fill)] disabled:opacity-40"
								>
									<RefreshCw className={`h-3 w-3 ${loadingPrompt ? "animate-spin" : ""}`} />
									<span>{t("diagnose.retry")}</span>
								</button>
							}
						>
							<span className="select-text break-words">{error}</span>
						</Notice>
					</div>
				)}

				{/* Target Session Info Card */}
				<div className="rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)] p-3 text-xs">
					<div className="flex items-center justify-between">
						<span className="font-semibold text-neutral-300">
							{t("diagnose.diagnosedSession", { title: targetSession?.title || targetSessionId })}
						</span>
						<span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-medium text-rose-300">
							{targetSession?.status ?? t("diagnose.defaultAbnormal")}
						</span>
					</div>
					{targetSession?.cwd && (
						<div className="mt-1 break-all text-[11px] text-neutral-500" title={targetSession.cwd}>
							{t("diagnose.workingDirectory", { cwd: targetSession.cwd })}
						</div>
					)}
				</div>

				{/* Prompt Preview Accordion */}
				<div className="rounded-xl border border-[var(--border-divider)] bg-[var(--well-bg)]/60">
					<button
						onClick={() => setShowPromptPreview(!showPromptPreview)}
						className="flex w-full items-center justify-between p-3 text-xs font-medium text-neutral-400 hover:text-neutral-200"
					>
						<div className="flex items-center gap-1.5">
							<FileText className="h-3.5 w-3.5" />
							<span>{t("diagnose.promptTitle", { count: prompt ? t("diagnose.charCount", { count: prompt.length }) : t("diagnose.promptPreparing") })}</span>
						</div>
						{showPromptPreview ? (
							<ChevronDown className="h-4 w-4" />
						) : (
							<ChevronRight className="h-4 w-4" />
						)}
					</button>

					{showPromptPreview && (
						<div className="border-t border-[var(--border-divider)] p-3">
							{loadingPrompt ? (
								<div className="space-y-3 py-1">
									<div className="flex items-center gap-2 text-xs text-amber-400">
										<RefreshCw className="h-3.5 w-3.5 animate-spin" />
										<span>{t("diagnose.scanningTailErrors")}</span>
									</div>
									<div className="space-y-2 pt-1">
										<div className="h-3.5 w-3/4 animate-pulse rounded bg-neutral-800" />
										<div className="h-3.5 w-5/6 animate-pulse rounded bg-neutral-800" />
										<div className="h-3.5 w-2/3 animate-pulse rounded bg-neutral-800" />
									</div>
								</div>
							) : (
								<div className="space-y-2">
									<textarea
										value={prompt}
										onChange={(e) => setPrompt(e.target.value)}
										rows={8}
										placeholder={t("diagnose.promptPlaceholder")}
										className="w-full resize-y rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-[11px] font-mono text-neutral-200 placeholder-neutral-500 focus:border-amber-500 focus:outline-none"
									/>
									<div className="flex items-center justify-between text-[11px] text-neutral-500">
										<span>{t("diagnose.promptHint")}</span>
										<button
											type="button"
											onClick={fetchPrompt}
											disabled={loadingPrompt}
											className="inline-flex items-center gap-1 text-neutral-400 hover:text-amber-400 disabled:opacity-40"
											title={t("diagnose.regenerateTitle")}
										>
											<RefreshCw className={`h-3 w-3 ${loadingPrompt ? "animate-spin" : ""}`} />
											<span>{t("diagnose.regenerate")}</span>
										</button>
									</div>
								</div>
							)}
						</div>
					)}
				</div>

				{/* Diagnoser Target Selection */}
				<div className="space-y-3">
					<div className="text-xs font-semibold text-neutral-300">
						{t("diagnose.whichAgentLabel")}
					</div>

					<div className="flex rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-1 text-xs font-medium">
						<button
							type="button"
							onClick={() => setTargetType("existing")}
							className={`flex-1 rounded-md py-1.5 transition-colors ${
								targetType === "existing"
									? "bg-neutral-800 text-neutral-100"
									: "text-neutral-400 hover:text-neutral-200"
							}`}
						>
							{t("diagnose.tabExisting")}
						</button>
						<button
							type="button"
							onClick={() => setTargetType("new")}
							className={`flex-1 rounded-md py-1.5 transition-colors ${
								targetType === "new"
									? "bg-neutral-800 text-neutral-100"
									: "text-neutral-400 hover:text-neutral-200"
							}`}
						>
							{t("diagnose.tabNew")}
						</button>
					</div>

					{targetType === "existing" ? (
						candidateSessions.length === 0 ? (
							<div className="rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-3 text-xs text-neutral-500">
								{t("diagnose.noAvailableSessions")}
							</div>
						) : (
							<div>
								<label className="mb-1 block text-xs text-neutral-400">
									{t("diagnose.selectSessionLabel")}
								</label>
								<NativeSelect
									value={selectedExistingId}
									onChange={(e) => setSelectedExistingId(e.target.value)}
								>
									{candidateSessions.map((s) => {
										const modelLabel = s.model ? ` [${s.model}]` : "";
										const statusLabel =
											s.status === "working"
												? t("diagnose.statusWorking")
												: s.status === "idle"
													? t("diagnose.statusIdle")
													: s.status === "error"
														? t("diagnose.statusError")
														: s.status === "suspended"
															? t("diagnose.statusSuspended")
															: s.status;
										return (
											<option key={s.id} value={s.id}>
												{s.title || s.id}{modelLabel} · {statusLabel}
											</option>
										);
									})}
								</NativeSelect>
								</div>
						)
					) : (
						<div className="space-y-2">
							<div>
								<label className="mb-1 block text-xs text-neutral-400">
									{t("diagnose.modelLabel")}
								</label>
								<input
									type="text"
									value={newSessionModel}
									onChange={(e) => setNewSessionModel(e.target.value)}
									placeholder={t("diagnose.modelPlaceholder")}
									className="w-full rounded-lg hairline bg-[var(--well-bg)] px-3 py-2 text-xs text-neutral-100 placeholder-neutral-500 focus:ring-1 focus:ring-amber-500 focus:outline-none transition-all"
								/>
							</div>
							<div className="text-[11px] text-neutral-500">
								{t("diagnose.newSessionHint", { cwd: targetSession?.cwd ?? t("diagnose.currentDirectory") })}
							</div>
						</div>
					)}
				</div>

				</div>

				{/* Actions */}
				<div className="mt-4 flex items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-3 shrink-0">
					<button
						type="button"
						onClick={closeModal}
						className="rounded-lg px-4 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
					>
						{t("diagnose.cancel")}
					</button>
					<button
						type="button"
						disabled={
							loadingPrompt ||
							dispatching ||
							!prompt ||
							(targetType === "existing" && !selectedExistingId)
						}
						onClick={handleExecuteDiagnose}
						className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-neutral-950 hover:bg-amber-400 disabled:opacity-40 transition-colors"
					>
						{dispatching ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<Send className="h-3.5 w-3.5" />
						)}
						<span>{dispatching ? t("diagnose.startingDiagnosis") : t("diagnose.startDiagnosis")}</span>
					</button>
				</div>
			</div>
		</Modal>
	);
}
