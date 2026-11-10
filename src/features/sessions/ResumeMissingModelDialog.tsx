import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { ModelSelect } from "../../components/ModelSelect";
import { errMsg } from "../../lib/dialogs";
import { rejectResume, resumeSession, RESUME_MISSING_MODEL_MODAL } from "../../lib/ensureLive";
import { toModelKey } from "../../lib/models";
import { useT } from "../../stores/language";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { useUi } from "../../stores/ui";

export function ResumeMissingModelDialog() {
	const modal = useUi((s) => s.modal);
	if (modal?.name !== RESUME_MISSING_MODEL_MODAL) return null;
	const sessionId = typeof modal.props.sessionId === "string" ? modal.props.sessionId : "";
	const diagnostic = typeof modal.props.diagnostic === "string" ? modal.props.diagnostic : "";
	return <ResumeMissingModelForm key={sessionId} sessionId={sessionId} diagnostic={diagnostic} />;
}

function ResumeMissingModelForm({ sessionId, diagnostic }: { sessionId: string; diagnostic: string }) {
	const { t } = useT();
	const dialogRef = useRef<HTMLDivElement>(null);
	const models = useModelOptions();
	const loading = useModelCatalog((s) => s.loading);
	const [selected, setSelected] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const selectedOption = models?.find((m) => toModelKey(m.provider, m.id) === selected);

	useEffect(() => {
		void useModelCatalog.getState().refresh();
		dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
		return () => rejectResume(sessionId, undefined, RESUME_MISSING_MODEL_MODAL);
	}, [sessionId]);

	const cancel = () => {
		if (busy) return;
		rejectResume(sessionId);
	};
	const confirm = async () => {
		if (busy || !selectedOption) return;
		setBusy(true);
		setError(null);
		try {
			await resumeSession(sessionId, undefined, selected);
		} catch (err) {
			setError(errMsg(err));
			setBusy(false);
		}
	};

	return (
		<Modal
			onClose={cancel}
			ariaLabel={t("sessions.resumeSession")}
			size="none"
			className="w-[500px] max-w-[calc(100vw-2rem)]"
			closeOnBackdrop={!busy}
			closeOnEscape={!busy}
		>
			<div
				ref={dialogRef}
				className="flex min-h-0 flex-1 flex-col p-5 text-neutral-300"
				onKeyDown={(e) => {
					if (e.key !== "Escape") e.stopPropagation();
					if (e.key !== "Tab") return;
					const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(
						'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
					)).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
					const first = controls[0];
					const last = controls[controls.length - 1];
					if (e.shiftKey && document.activeElement === first) {
						e.preventDefault();
						last?.focus();
					} else if (!e.shiftKey && document.activeElement === last) {
						e.preventDefault();
						first?.focus();
					}
				}}
			>
				<div className="mb-3 flex shrink-0 items-center">
					<span className="flex-1 text-[15px] font-semibold tracking-tight text-[var(--text)]">
						{t("sessions.resumeSession")}
					</span>
					<button type="button" title={t("sessions.closeEsc")} aria-label={t("sessions.closeDialogAria")}
						disabled={busy} onClick={cancel}
						className="press-scale shrink-0 rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-100 transition-colors disabled:opacity-40">
						<X size={15} />
					</button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					<p className="mb-3 text-[12px] text-neutral-300">{t("sessions.sessionModelUnavailableNotice")}</p>
					{diagnostic && <p className="mb-3 whitespace-pre-wrap break-words rounded-lg hairline bg-[var(--bg)]/60 px-2.5 py-1.5 font-mono text-[11px] text-neutral-400">{diagnostic}</p>}
					<p className="mb-1 shrink-0 whitespace-nowrap text-xs text-neutral-400">{t("sessions.resumeModelLabel")}</p>
					<ModelSelect models={models} currentValue={selected} onSelect={setSelected}
						label={selectedOption?.id ?? t("sessions.selectResumeModel")} disabled={busy}
						buttonClass="press-scale flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-[var(--border-divider)] bg-[var(--bg-active-fill)] px-3 py-2 text-left text-xs text-neutral-200 transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40 [&>span]:whitespace-normal [&>span]:overflow-visible [&>span]:text-clip [&>span]:break-all"
						align="start" closeOnSelect />
					{!loading && !models?.length && <p role="status" className="mt-2 text-xs text-neutral-400">{t("sessions.noResumeModels")}</p>}
					<button type="button" disabled={busy || loading} onClick={() => void useModelCatalog.getState().refresh()}
						className="mt-2 block shrink-0 whitespace-nowrap rounded-full border border-[var(--border-divider)] bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs text-[#70b1ff] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-40">{t("sessions.refreshResumeModels")}</button>
					{error && <div role="alert" className="mt-2 whitespace-pre-wrap break-words text-xs text-rose-400">{error}</div>}
				</div>
				<div className="mt-2 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-3">
					<button type="button" disabled={busy} onClick={cancel}
						className="press-scale shrink-0 whitespace-nowrap rounded-lg border border-[var(--border-divider)] bg-[var(--bg-active-fill)] px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors disabled:opacity-40">{t("common.cancel")}</button>
					<button type="button" disabled={busy || !selectedOption} onClick={() => void confirm()}
						className="press-scale flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#0A84FF] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0A84FF]/90 disabled:opacity-40 transition-colors">
						{busy && <Loader2 size={12} className="shrink-0 animate-spin" />}
						{busy ? t("sessions.resuming") : t("sessions.continueAction")}
					</button>
				</div>
			</div>
		</Modal>
	);
}
