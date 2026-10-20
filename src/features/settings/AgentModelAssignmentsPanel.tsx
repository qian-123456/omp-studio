/**
 * [D] Settings ▸ 模型角色 (`omp-roles`): page header, one 「配置范围」 row and one
 * 「角色分配」 table, all inside a single card.
 *
 * The scope row is the table's first row: it decides which config file every
 * control below writes to, so it stays visible while the table loads and reads
 * as part of the table instead of a card of its own. Reloading and the
 * 「批量替换模型」 flow are page-level actions and live in the header.
 */
import { ArrowLeftRight, Loader2, RefreshCw } from "lucide-react";
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
import { ModelReplaceDialog } from "./modelReplace/ModelReplaceDialog";
import { useModelReplaceStore } from "./modelReplace/store";
import { type AssignmentContext, RoleAssignmentTable } from "./ModelRoleTables";
import { useOmpConfigStore } from "./ompConfigStore";
import { Button, IconButton, Notice, SectionHeader, SettingRow, SettingsCard } from "./ui";
import { useSettingsScopeSessionId, useSettingsSessionModel } from "./useAppSettings";

const EMPTY_LAYER: Record<string, string> = {};

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

interface ScopeRowProps {
	scope: AssignmentScope;
	onScope: (scope: AssignmentScope) => void;
	pick: string | null;
	onPick: (path: string | null) => void;
	sessionCwd: string | null;
	workspaces: Workspace[];
	busy: boolean;
}

/**
 * First row of the table card. One scope at a time: the project defaults to the
 * session's project and can be switched to any registered one. Without any
 * project to configure the 项目 option is disabled, so this row is the only
 * place that explains the scope — no second warning elsewhere.
 */
function ScopeRow({ scope, onScope, pick, onPick, sessionCwd, workspaces, busy }: ScopeRowProps) {
	// A picked path that is no longer registered stays selectable so the select never shows a blank value.
	const unlisted = pick !== null && pick !== sessionCwd && !workspaces.some((w) => w.path === pick);
	const projectName = pick === null ? "" : (workspaces.find((w) => w.path === pick)?.name ?? basename(pick));
	return (
		<SettingRow
			label="配置范围"
			description={
				scope === "project" && pick !== null ? (
					<span title={pick}>
						只写入「<span className="font-medium text-[var(--text)]">{projectName}</span>」，未设置的角色继承全局。
					</span>
				) : scope === "project" ? (
					"先在侧栏添加一个项目或打开一个会话。"
				) : (
					"对所有项目生效，不受当前会话所在项目影响。"
				)
			}
			control={
				<>
					<Segmented<AssignmentScope>
						size="sm"
						aria-label="配置范围"
						value={scope}
						disabled={busy}
						onChange={onScope}
						options={[
							{ value: "global", label: "全局", title: "写入全局配置，对所有项目生效" },
							{
								value: "project",
								label: "项目",
								disabled: pick === null,
								title:
									pick === null
										? "先在侧栏添加一个项目或打开一个会话"
										: "只写入所选项目的配置，未设置的角色继承全局",
							},
						]}
					/>
					{scope === "project" && pick !== null && (
						<NativeSelect
							aria-label="选择要配置的项目"
							value={pick}
							disabled={busy}
							onChange={(e) => onPick(e.target.value === "" ? null : e.target.value)}
							className="text-[11px]"
							containerClassName="w-[220px]"
						>
							{sessionCwd !== null && <option value={sessionCwd}>当前会话项目（{basename(sessionCwd)}）</option>}
							{unlisted && (
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
				</>
			}
		/>
	);
}

/**
 * Model-assignment panel: header, scope row and the single 「角色分配」 table.
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
	// The bulk-replace dialog is a nested modal over the whole panel; it owns its own state.
	const [replaceOpen, setReplaceOpen] = useState(false);
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

			<SettingsCard clip>
				<ScopeRow
					scope={scope}
					onScope={setScope}
					pick={pick}
					onPick={setPicked}
					sessionCwd={sessionCwd}
					workspaces={workspaces}
					busy={writing}
				/>

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
