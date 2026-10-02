/** Settings ▸ 模型角色 (`omp-roles`): header around ModelRolesSection. */
import { ModelRolesSection } from "../ModelRolesSection";
import { useSettingsNav } from "../settingsNav";
import { useSettingsProjectCwd } from "../useAppSettings";
import { SectionHeader } from "../ui";

export function RolesSection() {
	const { query } = useSettingsNav();
	const cwd = useSettingsProjectCwd();
	return (
		<div className="space-y-6" data-field-id="modelRolesPanel">
			<SectionHeader
				title="模型角色与回退链"
				description="为每类任务指定主力模型与回退顺序（对应 omp /model 的 Roles 视图），可全局设置或按项目覆盖"
			/>
			<ModelRolesSection query={query} cwd={cwd} />
		</div>
	);
}
