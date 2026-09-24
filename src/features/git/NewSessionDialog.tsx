import { useUi } from "../../stores/ui";

/**
 * [C] New-session dialog. Always mounted; opened via
 * `ui.openModal("new-session", { workspaceId?, cwd? })`. Placeholder.
 */
export function NewSessionDialog() {
	const modal = useUi((s) => s.modal);
	if (modal?.name !== "new-session") return null;
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="w-[480px] rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-300">
				新会话 — TODO(module C)
			</div>
		</div>
	);
}
