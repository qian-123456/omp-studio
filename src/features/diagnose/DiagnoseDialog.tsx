import { useUi } from "../../stores/ui";

/**
 * [D] Diagnose dialog. Always mounted; opened via
 * `ui.openModal("diagnose", { sessionId })`. Placeholder.
 */
export function DiagnoseDialog() {
	const modal = useUi((s) => s.modal);
	if (modal?.name !== "diagnose") return null;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-[480px] rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-300">
				诊断会话 {String(modal.props.sessionId ?? "")} — TODO(module D)
			</div>
		</div>
	);
}
