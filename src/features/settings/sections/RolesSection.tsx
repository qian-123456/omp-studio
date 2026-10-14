/** Settings ▸ 模型角色 (`omp-roles`): header around the model-assignment panel. */
import { AgentModelAssignmentsPanel } from "../AgentModelAssignmentsPanel";
import { SideChatModelCard } from "../SideChatModelCard";
import { useSettingsNav } from "../settingsNav";
import { SectionHeader } from "../ui";

export function RolesSection() {
	const { query } = useSettingsNav();
	return (
		<div className="space-y-6" data-field-id="modelRolesPanel">
			<SectionHeader
				title="模型角色"
				description="展开一行即可配置，选定即自动保存；默认编辑全局，也可切到某个项目单独设置"
			/>
			<AgentModelAssignmentsPanel query={query} />
			<SideChatModelCard />
		</div>
	);
}
