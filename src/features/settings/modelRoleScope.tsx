/**
 * [D] Settings ▸ 模型角色: the page-level 「配置范围」 state and its row.
 *
 * One scope at a time (global, or one project). `RolesSection` owns the state and
 * renders the bar at the top of the page; the role table, the templates, the
 * rules and the switch log all read the same scope.
 */
import { type ReactNode, useMemo, useState } from "react";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import type { Workspace } from "../../lib/contracts";
import { useSessions } from "../../stores/sessions";
import type { AssignmentScope } from "./agentModelAssignments";
import { GLOBAL_SCOPE, projectBasename, scopeDisplayName, type ScopeProject } from "./modelTemplates/logic";
import { SettingRow, SettingsCard } from "./ui";
import { useSettingsScopeSessionId } from "./useAppSettings";

export interface RoleScope {
	scope: AssignmentScope;
	setScope: (scope: AssignmentScope) => void;
	/** The project the 项目 scope points at (null when none is available). */
	pick: string | null;
	setPicked: (path: string | null) => void;
	sessionCwd: string | null;
	workspaces: Workspace[];
	/** Every project that can be chosen: the session's project plus the registered ones. */
	projects: ScopeProject[];
	/** Project path for the project scope, else null (global reads must never mix a project layer in). */
	projectPath: string | null;
	/** Display name of `projectPath` (empty when global). */
	projectName: string;
	/** Backend scope string: `"global"` or the project's absolute path. */
	scopeKey: string;
}

/** Entering the page always starts at global; the scope never follows the selected session. */
export function useRoleScope(): RoleScope {
	const scopeSessionId = useSettingsScopeSessionId();
	const sessionCwd = useSessions((s) => (scopeSessionId ? (s.sessions[scopeSessionId]?.cwd ?? null) : null));
	const workspaces = useSessions((s) => s.workspaces);
	const [scope, setScope] = useState<AssignmentScope>("global");
	const [picked, setPicked] = useState<string | null>(null);
	// The project tab starts on the session's project (else the first registered one); the user may switch freely.
	const pick = picked ?? sessionCwd ?? workspaces[0]?.path ?? null;
	const projectPath = scope === "project" ? pick : null;

	const projects = useMemo<ScopeProject[]>(() => {
		const list: ScopeProject[] = workspaces.map((w) => ({ path: w.path, name: w.name }));
		if (sessionCwd !== null && !list.some((p) => p.path === sessionCwd)) {
			list.unshift({ path: sessionCwd, name: projectBasename(sessionCwd) });
		}
		return list;
	}, [workspaces, sessionCwd]);

	return {
		scope,
		setScope,
		pick,
		setPicked,
		sessionCwd,
		workspaces,
		projects,
		projectPath,
		projectName: projectPath === null ? "" : scopeDisplayName(projectPath, projects),
		scopeKey: projectPath ?? GLOBAL_SCOPE,
	};
}

/**
 * The scope row. One scope at a time: the project defaults to the session's
 * project and can be switched to any registered one. Without any project to
 * configure the 项目 option is disabled, so this row is the only place that
 * explains the scope — no second warning elsewhere.
 */
export function RoleScopeBar({
	roleScope,
	label = "配置范围",
	description,
	projectTitle = "只写入所选项目的配置，未设置的角色继承全局",
}: {
	roleScope: RoleScope;
	label?: string;
	/** Replaces the default role-specific explanation (the no-project hint still wins). */
	description?: ReactNode;
	/** Tooltip of the 项目 option when a project is available. */
	projectTitle?: string;
}) {
	const { scope, setScope, pick, setPicked, sessionCwd, workspaces, projects } = roleScope;
	// A picked path that is no longer registered stays selectable so the select never shows a blank value.
	const unlisted = pick !== null && pick !== sessionCwd && !workspaces.some((w) => w.path === pick);
	const pickName = pick === null ? "" : scopeDisplayName(pick, projects);
	return (
		<SettingsCard clip>
			<SettingRow
				label={label}
				description={
					scope === "project" && pick === null ? (
						"先在侧栏添加一个项目或打开一个会话。"
					) : description !== undefined ? (
						description
					) : scope === "project" ? (
						<span title={pick ?? undefined}>
							只写入「<span className="font-medium text-[var(--text)]">{pickName}</span>」，未设置的角色继承全局。
						</span>
					) : (
						"对所有项目生效，不受当前会话所在项目影响。"
					)
				}
				control={
					<>
						<Segmented<AssignmentScope>
							size="sm"
							aria-label={label}
							value={scope}
							onChange={setScope}
							options={[
								{ value: "global", label: "全局", title: "写入全局配置，对所有项目生效" },
								{
									value: "project",
									label: "项目",
									disabled: pick === null,
									title:
										pick === null
											? "先在侧栏添加一个项目或打开一个会话"
											: projectTitle,
								},
							]}
						/>
						{scope === "project" && pick !== null && (
							<NativeSelect
								aria-label="选择要配置的项目"
								value={pick}
								onChange={(e) => setPicked(e.target.value === "" ? null : e.target.value)}
								className="text-[11px]"
								containerClassName="w-[220px]"
							>
								{sessionCwd !== null && (
									<option value={sessionCwd}>当前会话项目（{projectBasename(sessionCwd)}）</option>
								)}
								{unlisted && (
									<option value={pick}>
										{projectBasename(pick)} — {pick}
									</option>
								)}
								{workspaces
									.filter((w) => w.path !== sessionCwd)
									.map((w) => (
										<option key={w.id} value={w.path}>
											{w.name} — {w.path}
										</option>
									))}
							</NativeSelect>
						)}
					</>
				}
			/>
		</SettingsCard>
	);
}
