import { useEffect } from "react";
import { BookmarkPlus, X } from "lucide-react";
import { Modal } from "../../components/Modal";
import { onQuickCapture } from "../../lib/events";
import { toast } from "../../lib/toast";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";
import { useBacklog } from "./backlogStore";
import { IdeaCaptureBox } from "./IdeaCaptureBox";

/**
 * Global quick-capture layer. Always mounted; listens to the global shortcut
 * `quick-capture` and renders when `ui.modal?.name === "quick-capture"`.
 */
export function QuickCapture() {
	const { t } = useT();
	const modal = useUi((s) => s.modal);
	const openModal = useUi((s) => s.openModal);
	const closeModal = useUi((s) => s.closeModal);

	const isVisible = modal?.name === "quick-capture";
	const initialText = typeof modal?.props?.text === "string" ? modal.props.text : "";
	const targetSessionId = typeof modal?.props?.sessionId === "string" ? modal.props.sessionId : undefined;

	useEffect(() => {
		const unlisten = onQuickCapture(() => {
			openModal("quick-capture");
		});
		return () => {
			void unlisten.then((fn) => fn());
		};
	}, [openModal]);

	// An explicit prefill (selection bar) wins; otherwise the persisted unsaved draft is restored.
	useEffect(() => {
		if (isVisible && initialText) useBacklog.getState().setDraft({ text: initialText });
	}, [isVisible, initialText]);

	if (!isVisible) return null;

	return (
		<Modal
			onClose={closeModal}
			size="none"
			className="w-[510px] max-w-[calc(100vw-32px)] p-3 text-[var(--text)]"
			ariaLabel={t("backlog.quickCaptureAriaLabel")}
		>
			<div className="mb-1 flex shrink-0 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold tracking-[-0.018em] text-[var(--text)]">
					<BookmarkPlus className="h-4 w-4 text-[var(--accent)]" />
					<span>{t("backlog.quickCaptureTitle")}</span>
				</div>
				<button
					type="button"
					onClick={closeModal}
					title={t("components.closeEsc")}
					aria-label={t("common.close")}
					className="rounded-md p-1 text-[var(--text-dim)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>
			<IdeaCaptureBox
				variant="quick"
				autoFocus
				sessionId={targetSessionId}
				onSubmitted={() => {
					toast.success(t("backlog.quickCaptureSuccess"));
					closeModal();
				}}
			/>
		</Modal>
	);
}
