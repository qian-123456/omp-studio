/**
 * [D] Settings ▸ 模型角色 (`omp-roles`): page header and one 「角色分配」 table.
 *
 * The scope (global / one project) is page-level state owned by `RolesSection`
 * and arrives as props: it decides which config file every control below writes
 * to. Reloading and the 「批量替换模型」 flow are page-level actions and live in
 * the header.
 */
import { ArrowLeftRight, Loader2, Plus, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../stores/language";
import type { ModelRoleLayer, ModelRoleSnapshot } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { ompModelRolesRead, ompModelRolesSet } from "../../lib/ipc";
import type { ModelOption } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useModelCatalog, useModelOptions } from "../../stores/modelCatalog";
import { AddRoleForm } from "./AddRoleForm";
import { type AssignmentScope, type AssignmentTable, buildAssignmentRows, roleUsers } from "./agentModelAssignments";
import { ModelReplaceDialog } from "./modelReplace/ModelReplaceDialog";
import { useModelReplaceStore } from "./modelReplace/store";
import type { RoleScope } from "./modelRoleScope";
import { asStringList } from "./modelRoles";
import { type AssignmentContext, RoleAssignmentTable } from "./ModelRoleTables";
import { useOmpConfigStore } from "./ompConfigStore";
import { Notice } from "../../components/Notice";
import { Button, IconButton, SectionHeader, SettingsCard } from "./ui";
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

/** Cache key of one read: the project whose layers it read plus the session model it resolved with. */
const cacheKey = (cwd: string | null, sessionModel: string | null): string =>
	`${cwd ?? ""}\u0001${sessionModel ?? ""}`;

/**
 * Snapshot for one project and session model. Every backend call goes through one
 * queue, so reads and writes apply in the order they were issued. Snapshots are
 * kept per (project, session model) key, and one is only exposed for the key it
 * was read with, so switching scope can never show — or edit against — another
 * project's layers. A bulk replace rewrites the files behind our back, so its
 * revision drops the whole cache.
 *
 * Keeping them is what makes the scope row usable: a scope read once renders in
 * the very same commit that switches to it, instead of blanking the table to a
 * loading line and re-mounting it, which reflowed the whole settings page for a
 * few frames on every switch.
 */
function useModelRoleState(
	cwd: string | null,
	sessionModel: string | null,
	prefetchCwd: string | null,
): ModelRoleState {
	const [snapshots, setSnapshots] = useState<Record<string, ModelRoleSnapshot>>({});
	const [error, setError] = useState<string | null>(null);
	const [reads, setReads] = useState(0);
	const [writes, setWrites] = useState(0);
	// A bulk replace rewrites these files behind our back; its revision re-reads the snapshot.
	const revision = useModelReplaceStore((s) => s.revision);
	const latest = useRef({ cwd, sessionModel });
	latest.current = { cwd, sessionModel };
	const queue = useRef<Promise<unknown>>(Promise.resolve());
	const key = cacheKey(cwd, sessionModel);

	const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
		const run = queue.current.then(task, task);
		queue.current = run.catch(() => undefined);
		return run;
	}, []);

	// A bulk replace rewrites every layer behind our back: drop the cached ones (the shown
	// layer keeps its rows until the re-read lands, so the table never blanks) and re-read.
	const seenRevision = useRef(revision);
	useEffect(() => {
		if (seenRevision.current === revision) return;
		seenRevision.current = revision;
		setSnapshots((all) => (all[key] ? { [key]: all[key] } : {}));
	}, [revision, key]);

	const refresh = useCallback(() => {
		const callCwd = cwd;
		const callModel = sessionModel;
		const callKey = cacheKey(callCwd, callModel);
		const isLatest = () => latest.current.cwd === callCwd && latest.current.sessionModel === callModel;
		setError(null);
		setReads((n) => n + 1);
		void enqueue(async () => {
			try {
				// A read superseded by a newer project or session model is skipped.
				if (!isLatest()) return;
				const value = await ompModelRolesRead(callCwd, callModel);
				if (isLatest()) setSnapshots((all) => ({ ...all, [callKey]: value }));
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

	// Warm the other scope's key so the first switch to it renders its real rows instead
	// of a loading line. A failure is silent: the switch itself re-reads and reports it.
	const warmKey = cacheKey(prefetchCwd, sessionModel);
	const warm = useCallback(() => {
		if (warmKey === key || snapshots[warmKey]) return;
		void enqueue(async () => {
			try {
				const value = await ompModelRolesRead(prefetchCwd, sessionModel);
				setSnapshots((all) => (all[warmKey] ? all : { ...all, [warmKey]: value }));
			} catch {
				/* the switch to that scope re-reads and shows the error there */
			}
		});
	}, [prefetchCwd, sessionModel, warmKey, key, snapshots, enqueue]);

	useEffect(() => {
		warm();
	}, [warm]);

	const write = useCallback(
		(scope: AssignmentScope, table: AssignmentTable, name: string, value: string | null) => {
			const callCwd = cwd;
			const callModel = sessionModel;
			const callKey = cacheKey(callCwd, callModel);
			setWrites((n) => n + 1);
			return enqueue(async () => {
				try {
					const next = await ompModelRolesSet(callCwd, scope, table, name, value, callModel);
					// A response for a project the user already left still lands in that project's
					// cache entry; the shown table only reads the entry of the current key.
					setSnapshots((all) => ({ ...all, [callKey]: next }));
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
		snapshot: snapshots[key] ?? null,
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
	const [adding, setAdding] = useState(false);
	const { t } = useT();
	const { scope, projectPath, projectName, pick } = roleScope;
	// The scope the user can flip to next; warming its read keeps that flip from blanking the table.
	const otherCwd = scope === "global" ? pick : null;
	const { snapshot, loading, error, writing, reload, write } = useModelRoleState(projectPath, sessionModel, otherCwd);
	// Height of the last rendered table, reserved by the loader so the card never collapses.
	const tableRef = useRef<HTMLDivElement>(null);
	const [tableHeight, setTableHeight] = useState<number | undefined>(undefined);

	useEffect(() => {
		void useModelCatalog.getState().refresh();
		// `cycleOrder` (who the model switcher cycles through) counts as a caller of a role.
		void useOmpConfigStore.getState().load();
	}, []);
	const ompEntries = useOmpConfigStore((s) => s.entries);

	const guardedWrite = useCallback(
		(s: AssignmentScope, table: AssignmentTable, name: string, value: string | null) => {
			// Never write the project layer without an explicitly chosen project.
			if (s === "project" && projectPath === null) return Promise.reject(new Error(t("settingsModels.selectProjectFirstError")));
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
	const roleNames = useMemo(() => new Set(rows.filter((r) => r.kind === "role").map((r) => r.name)), [rows]);

	// Remember the table's rendered height so a later loading line can hold that space.
	useEffect(() => {
		const height = tableRef.current?.offsetHeight;
		if (height) setTableHeight(height);
	}, [snapshot, rows.length]);
	const users = useMemo(() => {
		const layers = projectLayer ? [projectLayer.modelRoles, globalRoles] : [globalRoles];
		const cycleOrder = asStringList(ompEntries.find((e) => e.key === "cycleOrder")?.value);
		return roleUsers(rows, layers, cycleOrder);
	}, [rows, projectLayer, globalRoles, ompEntries]);

	// The form writes into one scope; switching scope or project closes it.
	useEffect(() => setAdding(false), [scope, projectPath]);

	const onRoleAdded = (name: string) => {
		setAdding(false);
		toast.success(t("settingsModels.roleAddedToast", { name }));
		requestAnimationFrame(() => {
			// checkName only allows letters, digits and - _ ., so the attribute selector needs no escaping.
			const row = document.querySelector<HTMLElement>(`[data-row-kind="role"][data-row-name="${name}"]`);
			row?.scrollIntoView?.({ block: "nearest" });
		});
	};

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
		roleUsers: users,
	};

	return (
		<div className="space-y-6" data-testid="model-roles-panel">
			<SectionHeader
				title={t("settingsModels.panelTitle")}
				description={t("settingsModels.panelDesc")}
				actions={
					<>
						<Button
							variant="primary"
							icon={Plus}
							onClick={() => setAdding(true)}
							disabled={snapshot === null || adding}
							title={t("settingsModels.addRoleTitle")}
						>
							{t("settingsModels.addRoleBtn")}
						</Button>
						<Button icon={ArrowLeftRight} onClick={() => setReplaceOpen(true)} title={t("settingsModels.batchReplaceTitle")}>
							{t("settingsModels.batchReplaceBtn")}
						</Button>
						<IconButton
							icon={RefreshCw}
							label={t("settingsModels.reloadRolesAria")}
							onClick={reload}
							disabled={writing || loading}
						/>
					</>
				}
			/>

			{scopeBar}

			<SettingsCard clip jump={t("settingsModels.jumpRoleAssignments")}>
				{error && (
					<div className="p-3">
						<Notice
							tone="danger"
							action={
								<Button size="sm" onClick={reload}>
									{t("settingsModels.reloadBtn")}
								</Button>
							}
						>
							<span className="break-all">
								{snapshot ? t("settingsModels.readFailedWithSnapshot", { error }) : t("settingsModels.readFailedNoSnapshot", { error })}
							</span>
						</Notice>
					</div>
				)}

				{snapshot === null && !error && (
					// Reserve the table's height: a one-line loader collapsed the card and reflowed
					// the whole page for a few frames on every scope switch.
					<div className="flex items-center gap-2 px-4 py-3 text-xs text-[var(--text-dim)]" style={{ minHeight: tableHeight }}>
						<Loader2 className="h-3.5 w-3.5 animate-spin" />
						{t("settingsModels.loadingRolesText")}
					</div>
				)}

				{snapshot !== null && adding && (
					<AddRoleForm ctx={ctx} existing={roleNames} onAdded={onRoleAdded} onCancel={() => setAdding(false)} />
				)}

				{snapshot !== null && (
					<div ref={tableRef} data-field-id="modelRolesTable">
						<RoleAssignmentTable rows={rows} query={query.trim()} ctx={ctx} />
					</div>
				)}
			</SettingsCard>

			{replaceOpen && <ModelReplaceDialog onClose={() => setReplaceOpen(false)} />}
		</div>
	);
}
