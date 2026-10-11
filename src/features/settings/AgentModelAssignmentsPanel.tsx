/**
 * [D] Settings ▸ 模型角色 (`omp-roles`): one 「角色分配」 table for roles and
 * sub-agents. Reads and writes go only through `omp_model_roles_read/set` — never
 * the generic config list or raw config text.
 *
 * Scope tabs (global | project, one scope at a time) come first. The scope always
 * starts at global on entry and never follows the selected session; a project is
 * only ever chosen explicitly.
 */
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import type { ModelRoleLayer, ModelRoleSnapshot, Workspace } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { ompModelRolesRead, ompModelRolesSet } from "../../lib/ipc";
import type { ModelOption } from "../../lib/models";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { useSessions } from "../../stores/sessions";
import { type AssignmentScope, type AssignmentTable, buildAssignmentRows } from "./agentModelAssignments";
import { type AssignmentContext, RoleAssignmentTable } from "./ModelRoleTables";
import { useOmpConfigStore } from "./ompConfigStore";
import { SettingsCard } from "./ui";
import { useSettingsScopeSessionId, useSettingsSessionModel } from "./useAppSettings";

const EMPTY_LAYER: Record<string, string> = {};

const REFRESH_BTN =
	"rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-50";

function basename(dir: string): string {
	return dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;
}

interface ModelRoleState {
	snapshot: ModelRoleSnapshot | null;
	loading: boolean;
	error: string | null;
	writing: boolean;
	reload: () => void;
	write: (scope: AssignmentScope, table: AssignmentTable, name: string, value: string | null) => Promise<void>;
}

/**
 * Snapshot for one project and session model. Every backend call goes through one
 * queue, so reads and writes apply in the order they were issued. A snapshot is
 * only exposed for the project it was read for, so switching scope or project can
 * never show — or edit against — the previous one's layers.
 */
function useModelRoleState(cwd: string | null, sessionModel: string | null): ModelRoleState {
	const [loaded, setLoaded] = useState<{ cwd: string | null; value: ModelRoleSnapshot } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reads, setReads] = useState(0);
	const [writes, setWrites] = useState(0);
	const latest = useRef({ cwd, sessionModel });
	latest.current = { cwd, sessionModel };
	const queue = useRef<Promise<unknown>>(Promise.resolve());

	const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
		const run = queue.current.then(task, task);
		queue.current = run.catch(() => undefined);
		return run;
	}, []);

	const refresh = useCallback(() => {
		const callCwd = cwd;
		const callModel = sessionModel;
		const isLatest = () => latest.current.cwd === callCwd && latest.current.sessionModel === callModel;
		setError(null);
		setReads((n) => n + 1);
		void enqueue(async () => {
			try {
				// A read superseded by a newer project or session model is skipped.
				if (!isLatest()) return;
				const value = await ompModelRolesRead(callCwd, callModel);
				if (isLatest()) setLoaded({ cwd: callCwd, value });
			} catch (e) {
				if (isLatest()) setError(errMsg(e));
			} finally {
				setReads((n) => n - 1);
			}
		});
	}, [cwd, sessionModel, enqueue]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const write = useCallback(
		(scope: AssignmentScope, table: AssignmentTable, name: string, value: string | null) => {
			const callCwd = cwd;
			const callModel = sessionModel;
			setWrites((n) => n + 1);
			return enqueue(async () => {
				try {
					const next = await ompModelRolesSet(callCwd, scope, table, name, value, callModel);
					// A response for a scope/project the user already left must not replace the current snapshot.
					if (latest.current.cwd === callCwd) setLoaded({ cwd: callCwd, value: next });
					// Config readers elsewhere (the model picker, other settings pages) must re-read before writing.
					useOmpConfigStore.getState().invalidate();
				} finally {
					setWrites((n) => n - 1);
				}
			});
		},
		[cwd, sessionModel, enqueue],
	);

	return {
		snapshot: loaded && loaded.cwd === cwd ? loaded.value : null,
		loading: reads > 0,
		error,
		writing: writes > 0,
		reload: refresh,
		write,
	};
}

interface ScopeBarProps {
	scope: AssignmentScope;
	onScope: (scope: AssignmentScope) => void;
	pick: string | null;
	onPick: (path: string | null) => void;
	sessionCwd: string | null;
	workspaces: Workspace[];
	busy: boolean;
	loading: boolean;
	onReload: () => void;
}

/** One scope at a time. The project defaults to the session's project and can be switched to any registered one. */
function ScopeBar({ scope, onScope, pick, onPick, sessionCwd, workspaces, busy, loading, onReload }: ScopeBarProps) {
	// A picked path that is no longer registered stays selectable so the select never shows a blank value.
	const unlisted = pick !== null && pick !== sessionCwd && !workspaces.some((w) => w.path === pick);
	return (
		<SettingsCard fieldId="modelRoleContext">
			<div className="space-y-2.5 p-3.5">
				<div className="flex flex-wrap items-center gap-2">
					<Segmented<AssignmentScope>
						size="sm"
						aria-label="配置范围"
						value={scope}
						disabled={busy}
						onChange={onScope}
						options={[
							{ value: "global", label: "全局", title: "写入全局配置，对所有项目生效" },
							{ value: "project", label: "项目", title: "只写入所选项目的配置，未设置的角色继承全局" },
						]}
					/>
					{scope === "project" && (
						<NativeSelect
							aria-label="选择要配置的项目"
							value={pick ?? ""}
							disabled={busy}
							onChange={(e) => onPick(e.target.value === "" ? null : e.target.value)}
							className="text-[11px]"
							containerClassName="min-w-0 max-w-[340px] flex-1"
						>
							{pick === null && <option value="">选择项目…</option>}
							{sessionCwd !== null && <option value={sessionCwd}>当前会话项目（{basename(sessionCwd)}）</option>}
							{unlisted && pick !== null && (
								<option value={pick}>
									{basename(pick)} — {pick}
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
					<button
						type="button"
						onClick={onReload}
						disabled={busy || loading}
						title="重新读取模型角色"
						aria-label="重新读取模型角色"
						className={`${REFRESH_BTN} ml-auto`}
					>
						<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
					</button>
				</div>
				<p className="text-[11px] leading-5 text-neutral-400">
					{scope === "global" ? (
						"全局：写入全局配置，对所有项目生效；不受当前会话所在项目影响。"
					) : pick !== null ? (
						<>
							项目：<span className="font-medium text-neutral-200">{workspaces.find((w) => w.path === pick)?.name ?? basename(pick)}</span>{" "}
							<span className="font-mono text-neutral-500" title={pick}>
								{pick}
							</span>
							<span className="text-neutral-500">　仅对在该目录启动的会话生效；未设置的角色继承全局</span>
						</>
					) : (
						<span className="text-amber-300/90">请先选择一个项目；未选择时不会写入任何项目配置。</span>
					)}
				</p>
			</div>
		</SettingsCard>
	);
}

/**
 * Model-assignment panel: scope bar and the single 「角色分配」 table.
 * `query` filters the table rows.
 */
export function AgentModelAssignmentsPanel({ query = "" }: { query?: string }) {
	const scopeSessionId = useSettingsScopeSessionId();
	const sessionModel = useSettingsSessionModel();
	const sessionCwd = useSessions((s) => (scopeSessionId ? (s.sessions[scopeSessionId]?.cwd ?? null) : null));
	const workspaces = useSessions((s) => s.workspaces);
	const modelOptions = useModelOptions();
	// Entering the page always starts at global; the scope never follows the selected session.
	const [scope, setScope] = useState<AssignmentScope>("global");
	const [picked, setPicked] = useState<string | null>(null);
	// The project tab starts on the session's project (else the first registered one); the user may switch freely.
	const pick = picked ?? sessionCwd ?? workspaces[0]?.path ?? null;
	// Global reads pass cwd = null so no project layer is ever mixed into the global view.
	const projectPath = scope === "project" ? pick : null;
	const { snapshot, loading, error, writing, reload, write } = useModelRoleState(projectPath, sessionModel);

	useEffect(() => {
		void useModelCatalog.getState().refresh();
	}, []);

	const guardedWrite = useCallback(
		(s: AssignmentScope, table: AssignmentTable, name: string, value: string | null) => {
			// Never write the project layer without an explicitly chosen project.
			if (s === "project" && projectPath === null) return Promise.reject(new Error("请先选择一个项目"));
			return write(s, table, name, value);
		},
		[write, projectPath],
	);

	const projectLayer: ModelRoleLayer | null = projectPath !== null ? (snapshot?.project ?? null) : null;
	const projectName = projectPath
		? (workspaces.find((w) => w.path === projectPath)?.name ?? basename(projectPath))
		: "";
	const globalRoles = snapshot?.global.modelRoles ?? EMPTY_LAYER;

	const rows = useMemo(
		() =>
			snapshot
				? buildAssignmentRows({
						global: snapshot.global,
						project: projectLayer,
						agents: snapshot.agents,
						sessionModel,
					})
				: [],
		[snapshot, projectLayer, sessionModel],
	);

	const ctx: AssignmentContext = {
		scope,
		models: modelOptions as ModelOption[] | null,
		projectName,
		sessionSelected: scopeSessionId !== null,
		globalPath: snapshot?.global.path ?? "",
		projectPath: projectLayer?.path ?? null,
		busy: writing,
		write: guardedWrite,
		roles: projectLayer ? { ...globalRoles, ...projectLayer.modelRoles } : globalRoles,
	};

	const needsProject = scope === "project" && projectPath === null;

	return (
		<div className="space-y-5" data-testid="model-roles-panel">
			<ScopeBar
				scope={scope}
				onScope={setScope}
				pick={pick}
				onPick={setPicked}
				sessionCwd={sessionCwd}
				workspaces={workspaces}
				busy={writing}
				loading={loading}
				onReload={reload}
			/>

			{needsProject && (
				<div className="rounded-xl hairline bg-amber-500/10 px-3.5 py-3 text-[11px] leading-5 text-amber-200" data-testid="project-guide">
					还没有可配置的项目：先在侧栏添加一个项目或打开一个会话；在此之前不会显示或写入任何项目配置。
				</div>
			)}

			{!needsProject && error && (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-xl hairline bg-rose-950/20 px-3 py-2 text-[11px] leading-5 text-rose-300"
				>
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">
						{snapshot ? `读取失败，保留上次结果：${error}` : `无法读取模型角色：${error}`}
					</span>
					<button
						type="button"
						onClick={reload}
						className="shrink-0 whitespace-nowrap rounded-md bg-rose-500/20 px-1.5 py-0.5 font-medium text-rose-100 hover:bg-rose-500/30 active:scale-95 transition-all"
					>
						重新读取
					</button>
				</div>
			)}

			{!needsProject && snapshot === null && !error && (
				<div className="flex items-center gap-2 text-xs text-neutral-500">
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
					正在读取模型角色…
				</div>
			)}

			{!needsProject && snapshot !== null && (
				<div key={`${scope}\u0001${projectPath ?? ""}`} className="space-y-3" data-field-id="modelRolesTable">
					<h2 className="text-sm font-semibold text-neutral-100">角色分配</h2>
					<RoleAssignmentTable rows={rows} query={query.trim()} ctx={ctx} />
				</div>
			)}
		</div>
	);
}
