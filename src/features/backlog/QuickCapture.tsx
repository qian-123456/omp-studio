import { useUi } from "../../stores/ui";

/**
 * [D] Global quick-capture modal. Always mounted; renders only when
 * `ui.modal.name === "quick-capture"`. Placeholder.
 */
export function QuickCapture() {
	const modal = useUi((s) => s.modal);
	if (modal?.name !== "quick-capture") return null;
	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24">
			<div className="w-[480px] rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-300">
				快速捕获 — TODO(module D)
			</div>
		</div>
	);
}
