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
	// The title tab hangs above the card edge, so the layer must not clip its overflow.
	return (
		<FloatingLayer
			anchor={anchor}
			placement="center"
			layer="modal"
			onDismiss={closeModal}
			role="dialog"
			aria-label={t("backlog.quickCaptureAriaLabel")}
			className="mt-6 w-[436px] max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] p-2.5 shadow-2xl"
			style={{ overflow: "visible" }}
		>
			{/* Top-left ear tab */}
			<div
				aria-hidden="true"
				className="absolute -top-[23px] left-3.5 inline-flex h-[24px] items-center gap-1.5 rounded-t-lg border border-b-0 border-[var(--line,var(--border-divider))] bg-[var(--bg-panel)] px-2.5 text-[11px] font-medium text-[var(--text-60)] after:absolute after:-bottom-px after:left-0 after:right-0 after:h-[2px] after:bg-[var(--bg-panel)]"
			>
				<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
				<span>{t("backlog.quickCaptureTitle")}</span>
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
		</FloatingLayer>
	);
}
