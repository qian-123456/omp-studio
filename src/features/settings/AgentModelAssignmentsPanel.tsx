/**
 * [D] Settings ▸ 模型角色 (`omp-roles`): page header and one 「角色分配」 table.
 *
 * The scope (global / one project) is page-level state owned by `RolesSection`
 * and arrives as props: it decides which config file every control below writes
 * to. Reloading and the 「批量替换模型」 flow are page-level actions and live in
 * the header.
 */
import { ArrowLeftRight, Loader2, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelRoleLayer, ModelRoleSnapshot } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { ompModelRolesRead, ompModelRolesSet } from "../../lib/ipc";
import type { ModelOption } from "../../lib/models";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { type AssignmentScope, type AssignmentTable, buildAssignmentRows } from "./agentModelAssignments";
import { ModelReplaceDialog } from "./modelReplace/ModelReplaceDialog";
import { useModelReplaceStore } from "./modelReplace/store";
import type { RoleScope } from "./modelRoleScope";
import { type AssignmentContext, RoleAssignmentTable } from "./ModelRoleTables";
import { useOmpConfigStore } from "./ompConfigStore";
import { Button, IconButton, Notice, SectionHeader, SettingsCard } from "./ui";
import { useSettingsScopeSessionId, useSettingsSessionModel } from "./useAppSettings";

const EMPTY_LAYER: Record<string, string> = {};

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
	// A bulk replace rewrites these files behind our back; its revision re-reads the snapshot.
	const revision = useModelReplaceStore((s) => s.revision);
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
	}, [cwd, sessionModel, enqueue, revision]);

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

/**
 * Model-assignment panel: header and the single 「角色分配」 table. The page's
 * 「配置范围」 state is owned by `RolesSection`; `scopeBar` is its rendered row,
 * shown between the header and the table.
 */
export function AgentModelAssignmentsPanel({
	query = "",
	roleScope,
	scopeBar,
}: {
	query?: string;
	roleScope: RoleScope;
	scopeBar: ReactNode;
}) {
	const scopeSessionId = useSettingsScopeSessionId();
	const sessionModel = useSettingsSessionModel();
	const modelOptions = useModelOptions();
	// The bulk-replace dialog is a nested modal over the whole panel; it owns its own state.
	const [replaceOpen, setReplaceOpen] = useState(false);
	const { scope, projectPath, projectName } = roleScope;
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

	return (
		<div className="space-y-6" data-testid="model-roles-panel">
			<SectionHeader
				title="模型角色"
				description="不同用途（主力、轻量、子代理…）分别用哪个模型，可全局设置或按项目覆盖"
				actions={
					<>
						<Button icon={ArrowLeftRight} onClick={() => setReplaceOpen(true)} title="把某个模型一次性替换成另一个">
							批量替换
						</Button>
						<IconButton
							icon={RefreshCw}
							label="重新读取模型角色"
							onClick={reload}
							disabled={writing || loading}
						/>
					</>
				}
			/>

			{scopeBar}

			<SettingsCard clip>
				{error && (
					<div className="p-3">
						<Notice
							tone="danger"
							action={
								<Button size="sm" onClick={reload}>
									重新读取
								</Button>
							}
						>
							<span className="break-all">
								{snapshot ? `读取失败，保留上次结果：${error}` : `无法读取模型角色：${error}`}
							</span>
						</Notice>
					</div>
				)}

				{snapshot === null && !error && (
					<div className="flex items-center gap-2 px-4 py-3 text-xs text-[var(--text-dim)]">
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
						正在读取模型角色
					</div>
				)}

				{snapshot !== null && (
					<div key={`${scope}\u0001${projectPath ?? ""}`} data-field-id="modelRolesTable">
						<RoleAssignmentTable rows={rows} query={query.trim()} ctx={ctx} />
					</div>
				)}
			</SettingsCard>

			{replaceOpen && <ModelReplaceDialog onClose={() => setReplaceOpen(false)} />}
		</div>
	);
}
