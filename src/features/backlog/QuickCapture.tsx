import { useEffect, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
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
	const [anchor] = useState(() => ({ x: 0, y: 0 }));

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
		<FloatingLayer
			anchor={anchor}
			placement="center"
			layer="modal"
			onDismiss={closeModal}
			role="dialog"
			aria-label={t("backlog.quickCaptureAriaLabel")}
			className="w-[520px] max-w-[calc(100vw-32px)] rounded-2xl !bg-[var(--bg-panel)] p-4"
		>
			<div className="mb-2 px-1 text-[13px] font-medium text-[var(--text)]">{t("backlog.quickCaptureTitle")}</div>
			<IdeaCaptureBox
				variant="quick"
				autoFocus
				sessionId={targetSessionId}
				onSubmitted={() => {
					toast.success(t("backlog.quickCaptureSuccess"));
					closeModal();
				}}
			/>
		</FloatingLayer>
	);
}
