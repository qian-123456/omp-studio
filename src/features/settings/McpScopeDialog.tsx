/** 「选择项目」 dialog: change where one existing server loads. */

import { useState } from "react";
import { Modal } from "../../components/Modal";
import type { McpScope, McpServerView } from "../../lib/contracts";
import { McpScopePicker, type PickerProject } from "./McpScopePicker";
import { hasMaskedSecrets, prefillScope, scopeError } from "./mcpProjects";
import { Button } from "./ui";

export function McpScopeDialog({
	view,
	projects,
	current,
	busy,
	onSave,
	onClose,
}: {
	view: McpServerView;
	projects: PickerProject[];
	current: string | null;
	busy: boolean;
	onSave: (scope: McpScope) => void;
	onClose: () => void;
}) {
	const [initial] = useState(() =>
		prefillScope(
			view,
			projects.map((p) => p.path),
			current,
		),
	);
	const [scope, setScope] = useState<McpScope>(initial);
	const invalid = scopeError(scope) !== null;

	return (
		<Modal title={`“${view.name}” 用在哪些项目`} size="lg" onClose={onClose}>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
				<McpScopePicker
					projects={projects}
					current={current}
					value={scope}
					onChange={setScope}
					copiesHaveSecrets={hasMaskedSecrets(view.definition)}
				/>
			</div>
			<div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-divider)] px-4 py-3">
				<span className="text-[11px] text-[var(--text-dim)]">保存后对新开的会话生效</span>
				<div className="flex gap-2">
					<Button variant="ghost" onClick={onClose}>
						取消
					</Button>
					<Button
						variant="primary"
						loading={busy}
						disabled={invalid}
						onClick={() => onSave(scope)}
					>
						保存
					</Button>
				</div>
			</div>
		</Modal>
	);
}
