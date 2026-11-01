/**
 * Settings ▸ 模型角色 (`omp-roles`): one page-level 「配置范围」, then the model-assignment
 * table, the templates with auto switching, and the side-chat model card.
 * The first three read the same scope.
 */
import { useLayoutEffect } from "react";
import { useServiceModelConfiguration } from "../../../stores/modelKinds";
import { AgentModelAssignmentsPanel } from "../AgentModelAssignmentsPanel";
import { RoleScopeBar, useRoleScope } from "../modelRoleScope";
import { ModelTemplatesPanel } from "../modelTemplates";
import { SideChatModelCard } from "../SideChatModelCard";
import { useSettingsNav } from "../settingsNav";

export function RolesSection() {
	const { query } = useSettingsNav();
	const roleScope = useRoleScope();
	const origin = useServiceModelConfiguration((s) => s.origin);
	const returning = useServiceModelConfiguration((s) => s.returning);
	const { setScope, setPicked } = roleScope;
	useLayoutEffect(() => {
		if (!origin || !returning) return;
		setPicked(origin.projectPath);
		setScope(origin.scope);
		useServiceModelConfiguration.getState().finishReturn();
	}, [origin, returning, setScope, setPicked]);
	return (
		<div className="space-y-6" data-field-id="modelRolesPanel">
			<AgentModelAssignmentsPanel
				query={query}
				roleScope={roleScope}
				scopeBar={<RoleScopeBar roleScope={roleScope} />}
			/>
			<ModelTemplatesPanel scope={roleScope.scopeKey} projects={roleScope.projects} />
			<SideChatModelCard />
		</div>
	);
}
