/** Settings ▸ 模型角色 (`omp-roles`): the model-assignment panel plus the side-chat model card. */
import { AgentModelAssignmentsPanel } from "../AgentModelAssignmentsPanel";
import { SideChatModelCard } from "../SideChatModelCard";
import { useSettingsNav } from "../settingsNav";

export function RolesSection() {
	const { query } = useSettingsNav();
	return (
		<div className="space-y-6" data-field-id="modelRolesPanel">
			<AgentModelAssignmentsPanel query={query} />
			<SideChatModelCard />
		</div>
	);
}
