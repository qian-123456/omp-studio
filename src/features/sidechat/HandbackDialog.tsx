/**
 * [B] 「回传给父会话」 dialog (整理成结论 mode). Opening automatically triggers a
 * summary turn in the side chat, streams a live preview while running, lets the
 * user edit the draft once ready, and either sends directly to the parent session
 * (「发送给主对话」) or stages in the parent's composer (「仅放入输入框」).
 */

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { Notice } from "../../components/Notice";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { buildHandbackText } from "./handbackLogic";
import { cancelHandback, startHandback, useHandback } from "./handbackRun";
import { HANDBACK_MODAL, insertInParentComposer, sendToParentSession } from "./sideChatActions";
import { useT } from "../../stores/language";
const BTN = "rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[var(--text)] text-[var(--bg-panel)] hover:opacity-80`;
const BTN_BORDER = `${BTN} border border-[var(--line)] text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]`;

export function HandbackDialog() {
	const { t } = useT();
	const modal = useUi((s) => s.modal);
	const closeModal = useUi((s) => s.closeModal);
	const childId = modal?.name === HANDBACK_MODAL && typeof modal.props.childId === "string" ? modal.props.childId : null;
	const run = useHandback((s) => (childId ? s.runs[childId] : undefined));
	const title = useSessions((s) => (childId ? s.sessions[childId]?.title : undefined));
	const liveText = useLive((s) => {
		if (!childId) return "";
		const content = s.sessions[childId]?.streamingMessage?.content;
		if (typeof content === "string") return content.trim();
		if (Array.isArray(content)) {
			return content
				.map((p) =>
					p && typeof p === "object" && "type" in p && p.type === "text" && "text" in p
						? String(p.text ?? "")
						: "",
				)
				.join("")
				.trim();
		}
		return "";
	});
	const [withTranscript, setWithTranscript] = useState(false);
	const [sending, setSending] = useState(false);

	if (!childId) return null;
	const phase = run?.phase ?? "running";

	const insert = () => {
		if (!run) return;
		const text = buildHandbackText(run.draft, withTranscript ? run.transcript : null);
		if (!insertInParentComposer(childId, text)) {
			toast.error(t("sidechat.handbackEmptyOrNoParent"));
			return;
		}
		closeModal();
		toast.success(t("sidechat.handbackInsertedToast"));
	};

	const send = async () => {
		if (!run || sending) return;
		const text = buildHandbackText(run.draft, withTranscript ? run.transcript : null);
		if (!text.trim()) {
			toast.error(t("sidechat.handbackEmptyOrNoParent"));
			return;
		}
		setSending(true);
		try {
			const ok = await sendToParentSession(childId, text);
			if (!ok) {
				toast.error(t("sidechat.handbackEmptyOrNoParent"));
				return;
			}
			closeModal();
			toast.success(t("sidechat.handbackSentToast"));
		} catch (err) {
			toast.error(errMsg(err));
		} finally {
			setSending(false);
		}
	};

	return (
		<FloatingLayer
			anchor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
			placement="center"
			layer="modal"
			onDismiss={closeModal}
			aria-label={t("sidechat.handbackDialogTitle")}
			className="flex max-h-[calc(100vh-4rem)] w-[560px] max-w-[calc(100vw-2rem)] flex-col gap-3 p-5 shadow-apple-modal"
		>
			<h3 className="text-sm font-semibold text-[var(--text)]">{t("sidechat.handbackDialogTitle")}</h3>
			{phase === "running" && (
				<div className="flex flex-col gap-2.5 py-2">
					<div className="flex items-center gap-2 text-xs text-[var(--text-60)]">
						<Loader2 size={14} className="shrink-0 animate-spin" />
						<span>{t("sidechat.handbackRunningNotice")}</span>
					</div>
					{liveText && (
						<div className="flex flex-col gap-1">
							<span className="text-[11px] text-[var(--text-40)]">
								{t("sidechat.handbackLivePreviewLabel")}
							</span>
							<div className="max-h-56 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 text-xs leading-relaxed whitespace-pre-wrap break-words text-[var(--text)]">
								{liveText}
							</div>
						</div>
					)}
				</div>
			)}
			{phase === "error" && (
				<Notice tone="danger">
					<span className="whitespace-pre-wrap break-words">{t("sidechat.handbackFailed", { error: run?.error ?? "" })}</span>
				</Notice>
			)}
			{phase === "ready" && run && (
				<>
					<p className="text-[11px] text-[var(--text-40)]">
						{t("sidechat.handbackDesc")}
					</p>
					<textarea
						value={run.draft}
						onChange={(e) => useHandback.getState().set(childId, { draft: e.target.value })}
						rows={12}
						aria-label={t("sidechat.handbackContent")}
						className="min-h-40 w-full flex-1 resize-y rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2.5 text-xs leading-relaxed text-[var(--text)] outline-none focus:border-[var(--text-30)]"
					/>
					<label className="flex items-center gap-2 text-xs text-[var(--text-60)]">
						<input
							type="checkbox"
							checked={withTranscript}
							onChange={(e) => setWithTranscript(e.target.checked)}
						/>
						{t("sidechat.includeFullConversation")}
					</label>
				</>
			)}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="min-w-0 break-words text-[11px] text-[var(--text-30)]">
					{title ? t("sidechat.sideChatPrefix", { title }) : ""}
				</span>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<button type="button" onClick={closeModal} className={BTN_BORDER}>
						{t("common.cancel")}
					</button>
					{phase === "running" ? (
						<button
							type="button"
							onClick={() => void cancelHandback(childId)}
							className={BTN_BORDER}
						>
							{t("sidechat.stopHandback")}
						</button>
					) : (
						<button
							type="button"
							disabled={sending}
							onClick={() => void startHandback(childId)}
							className={BTN_BORDER}
						>
							{t("sidechat.regenerate")}
						</button>
					)}
					{phase === "ready" && (
						<>
							<button
								type="button"
								disabled={sending || !run?.draft.trim()}
								onClick={insert}
								className={BTN_BORDER}
							>
								{t("sidechat.insertToComposer")}
							</button>
							<button
								type="button"
								disabled={sending || !run?.draft.trim()}
								onClick={() => void send()}
								className={BTN_PRIMARY}
							>
								{t("sidechat.sendToMain")}
							</button>
						</>
					)}
				</div>
			</div>
		</FloatingLayer>
	);
}
