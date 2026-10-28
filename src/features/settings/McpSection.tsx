/**
 * [D] "MCP 服务器" settings section.
 *
 * One card lists every server by name. A server can be used in all projects (optionally
 * minus some) or only in chosen projects; placement is derived from the config files by
 * the backend (`mcp_catalog`) and changed with `mcp_server_set_scope`. Env/header values
 * are never rendered: only key names are shown, and the editor only adds/overwrites/removes
 * keys. Runtime `mcp.*` settings and the xd:// device switches render through
 * `<OmpSections page="mcp" />`.
 */

import { ChevronDown, ChevronRight, ExternalLink, Loader2, Plus, RefreshCw, Server, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../stores/language";
import { openPath } from "@tauri-apps/plugin-opener";
import { EmptyState } from "../../components/EmptyState";
import { Notice } from "../../components/Notice";
import { Segmented } from "../../components/Segmented";
import type { McpCatalog, McpScope, McpServerPatch, McpServerView } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import {
	mcpCatalog,
	mcpServerDelete,
	mcpServerSave,
	mcpServerSetEnabled,
	mcpServerSetScope,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { McpImportDialog } from "./McpImportDialog";
import { McpScopeDialog } from "./McpScopeDialog";
import type { PickerProject } from "./McpScopePicker";
import { McpServerEditor } from "./McpServerEditor";
import { McpServerRow, serverEndpoint } from "./McpServerRow";
import { projectName } from "./mcpDraft";
import type { ImportEntry } from "./mcpImport";
import { deriveProjects, scopeWithCurrent } from "./mcpProjects";
import { OmpSections } from "./OmpSettingsList";
import { SectionJumpBar } from "./SectionJumpBar";
import { Button, IconButton, SectionHeader, SettingsCard } from "./ui";

type Dialog =
	| { kind: "add" }
	| { kind: "import" }
	| { kind: "edit"; server: McpServerView }
	| { kind: "scope"; name: string };

type Filter = "all" | "current";

/** Where a delete will remove the server from, in plain words. */
function deleteTargets(view: McpServerView, names: (p: string) => string, t: (k: string, p?: Record<string, string | number>) => string): string {
	const parts: string[] = [];
	if (view.hasGlobal) parts.push(t("mcp.targetGlobal"));
	if (view.copyProjects.length > 0) parts.push(t("mcp.targetProjects", { projects: view.copyProjects.map(names).join(t("settingsModels.listSep")) }));
	return parts.length > 0 ? parts.join(t("mcp.targetAnd")) : t("mcp.targetConfigFiles");
}

export function McpSection({
	cwd,
	query = "",
}: {
	/** Selected session's cwd; decides the "current project". */
	cwd: string | null;
	/** Nav search query. */
	query?: string;
}) {
	const { t } = useT();
	const workspaces = useSessions((s) => s.workspaces);
	const { projects, current } = useMemo(() => deriveProjects(workspaces, cwd), [workspaces, cwd]);
	const paths = useMemo(() => projects.map((p) => p.path), [projects]);
	const pathsKey = paths.join("\n");
	const projectNames = useMemo(() => new Map(projects.map((p) => [p.path, p.name])), [projects]);

	const [catalog, setCatalog] = useState<McpCatalog | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const [filter, setFilter] = useState<Filter>("all");
	const [filesOpen, setFilesOpen] = useState(false);
	const seq = useRef(0);
	const pathsRef = useRef(paths);
	pathsRef.current = paths;
	const openDialog = (next: Dialog) => {
		if (!busyRef.current) setDialog(next);
	};

	const reload = useCallback(async () => {
		const mine = ++seq.current;
		setLoading(true);
		try {
			const next = await mcpCatalog(pathsRef.current);
			if (mine !== seq.current) return;
			setCatalog(next);
			setLoadError(null);
		} catch (e) {
			if (mine === seq.current) setLoadError(errMsg(e));
		} finally {
			if (mine === seq.current) setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload, pathsKey]);

	/** The parent owns writes, even if their dialog is closed or replaced. */
	const write = async (fn: () => Promise<unknown>): Promise<string | null> => {
		if (busyRef.current) return t("mcp.writeInProgress");
		busyRef.current = true;
		setBusy(true);
		try {
			await fn();
			await reload();
			return null;
		} catch (e) {
			return errMsg(e);
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	/** `write` + toast for the inline (non-dialog) actions. */
	const act = async (fn: () => Promise<unknown>, okMsg: string): Promise<boolean> => {
		if (busyRef.current) return false;
		const err = await write(fn);
		if (err) toast.error(err);
		else toast.success(okMsg);
		return err === null;
	};

	const pickerProjects: PickerProject[] = useMemo(() => {
		// The backend skips project folders that no longer exist; only offer the ones it saw.
		const wt = new Map((catalog?.projects ?? []).map((p) => [p.path, p.worktrees.length]));
		const live = catalog ? projects.filter((p) => wt.has(p.path)) : projects;
		return live.map((p) => ({ path: p.path, name: p.name, worktrees: wt.get(p.path) ?? 0 }));
	}, [projects, catalog]);

	const allServers = catalog?.servers ?? [];
	const existingNames = useMemo(() => allServers.map((s) => s.name), [allServers]);
	const nameOf = useCallback((p: string) => projectNames.get(p) ?? projectName(p), [projectNames]);
	const currentName = current ? nameOf(current) : null;
	const loadedHere = current
		? allServers.filter((s) => s.activeProjects.includes(current) && !s.denylisted).length
		: 0;

	const q = query.trim().toLowerCase();
	const visibleServers = useMemo(
		() =>
			allServers.filter((s) => {
				if (filter === "current" && current && !s.activeProjects.includes(current)) return false;
				if (!q) return true;
				const hay = [
					s.name,
					serverEndpoint(s),
					...[...s.activeProjects, ...s.excludedProjects, ...s.copyProjects].map(nameOf),
				];
				return hay.some((h) => h.toLowerCase().includes(q));
			}),
		[allServers, filter, current, q, nameOf],
	);

	const openFile = (path: string) => {
		void openPath(path).catch((e: unknown) => toast.error(t("mcp.openFileFailed", { error: errMsg(e) })));
	};

	const toggle = (s: McpServerView, enabled: boolean) =>
		void act(
			() => mcpServerSetEnabled(paths, s.name, enabled),
			enabled ? t("mcp.resumeEnabled", { name: s.name }) : t("mcp.pauseDisabled", { name: s.name }),
		);

	const remove = async (s: McpServerView) => {
		const confirmed = await confirmDialog(
			t("mcp.deleteConfirmText", { targets: deleteTargets(s, nameOf, t), name: s.name }),
			{ title: t("mcp.deleteConfirmTitle"), danger: true, okLabel: t("common.delete") },
		);
		if (!confirmed) return;
		await act(() => mcpServerDelete(paths, s.name), t("mcp.deletedToast", { name: s.name }));
	};

	const addToCurrent = (s: McpServerView) => {
		if (!current) return;
		void act(
			() => mcpServerSetScope(paths, s.name, scopeWithCurrent(s, paths, current)),
			t("mcp.addedToCurrentToast", { name: s.name }),
		);
	};

	const saveScope = async (s: McpServerView, scope: McpScope) => {
		if (await act(() => mcpServerSetScope(paths, s.name, scope), t("mcp.scopeUpdatedToast", { name: s.name })))
			setDialog(null);
	};

	const submitEditor = async (
		originalName: string | null,
		name: string,
		patch: McpServerPatch,
		scope: McpScope | null,
	): Promise<string | null> => {
		if (originalName && !allServers.some((s) => s.name === originalName)) return t("mcp.editorServerDeleted");
		const err = await write(() => mcpServerSave(paths, originalName, name, patch, scope));
		if (!err) {
			toast.success(t("mcp.savedToast", { name }));
			setDialog(null);
		}
		return err;
	};

	const importServers = async (
		entries: { name: string; entry: ImportEntry }[],
		scope: McpScope,
	): Promise<Map<string, string>> => {
		const failed = new Map<string, string>();
		let imported = 0;
		const err = await write(async () => {
			for (const { name, entry } of entries) {
				try {
					await mcpServerSave(paths, null, name, entry as McpServerPatch, scope);
					imported++;
				} catch (e) {
					failed.set(name, errMsg(e));
				}
			}
		});
		if (err) for (const { name } of entries) failed.set(name, err);
		if (imported > 0) toast.success(t("mcp.importedToast", { count: imported }));
		return failed;
	};

	// Keep the original editor mounted and its draft intact if a reload removes the server.
	const editing = dialog?.kind === "edit" ? dialog.server : undefined;
	const scoping = dialog?.kind === "scope" ? allServers.find((s) => s.name === dialog.name) : undefined;
	const brokenFiles = (catalog?.files ?? []).filter((f) => f.parseError);

	return (
		<div className="space-y-6">
			<SectionHeader
				title={t("mcp.sectionTitle")}
				description={t("mcp.sectionDesc")}
				actions={
					<>
						<IconButton
							icon={RefreshCw}
							label={t("mcp.reloadAria")}
							onClick={() => void reload()}
							disabled={busy || loading}
							className={loading ? "[&_svg]:animate-spin" : undefined}
						/>
						<Button icon={Upload} onClick={() => openDialog({ kind: "import" })} disabled={!catalog || busy}>
							{t("mcp.importBtn")}
						</Button>
						<Button
							variant="primary"
							icon={Plus}
							onClick={() => openDialog({ kind: "add" })}
							disabled={!catalog || busy}
						>
							{t("mcp.addServerBtn")}
						</Button>
					</>
				}
			/>
			<SectionJumpBar />

			{current && catalog && (
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="text-xs text-[var(--text-muted)]">
						{t("mcp.currentProjectLoadedSummary", { name: currentName ?? "", count: loadedHere })}
					</div>
					<Segmented<Filter>
						aria-label={t("mcp.filterAria")}
						options={[
							{ value: "all", label: t("mcp.filterAll") },
							{ value: "current", label: t("mcp.filterCurrent") },
						]}
						value={filter}
						onChange={setFilter}
					/>
				</div>
			)}

			{loadError && (
				<Notice
					tone="danger"
					action={
						<Button size="sm" icon={RefreshCw} onClick={() => void reload()}>
							{t("common.retry")}
						</Button>
					}
				>
					<span className="select-text break-all">{t("mcp.readConfigFailed", { error: loadError })}</span>
				</Notice>
			)}

			{brokenFiles.map((f) => (
				<Notice
					key={f.path}
					tone="danger"
					title={t("mcp.brokenConfigTitle")}
					action={
						<Button size="sm" icon={ExternalLink} onClick={() => openFile(f.path)}>
							{t("mcp.openFileBtn")}
						</Button>
					}
				>
					<div className="select-text break-all font-mono">{f.path}</div>
					<div className="select-text whitespace-pre-wrap break-all">{f.parseError}</div>
				</Notice>
			))}

			<div className="scroll-mt-4 space-y-6" data-field-id="mcpServerList" data-jump={t("mcp.jumpServers")}>
				{!catalog && !loadError && (
					<div className="flex justify-center py-6 text-[var(--text-dim)]">
						<Loader2 aria-label={t("mcp.loadingServersAria")} className="h-4 w-4 animate-spin" />
					</div>
				)}

				{catalog && (
					<SettingsCard title={t("mcp.configuredServersCardTitle")} clip>
						{visibleServers.length === 0 ? (
							allServers.length === 0 ? (
								<EmptyState
									icon={Server}
									title={t("mcp.noServersTitle")}
									description={t("mcp.noServersDesc")}
									action={
										<div className="flex items-center gap-2">
											<Button variant="primary" icon={Plus} onClick={() => openDialog({ kind: "add" })} disabled={busy}>
												{t("mcp.addServerBtn")}
											</Button>
											<Button icon={Upload} onClick={() => openDialog({ kind: "import" })} disabled={busy}>
												{t("mcp.importBtn")}
											</Button>
										</div>
									}
								/>
							) : (
								<EmptyState
									icon={Server}
									title={
										q
											? t("mcp.noMatchQuery", { query: query.trim() })
											: t("mcp.noServersInCurrent", { name: currentName ?? "" })
									}
									description={q ? undefined : t("mcp.switchToAllHint")}
								/>
							)
						) : (
							visibleServers.map((s) => (
								<McpServerRow
									key={s.name}
									view={s}
									projectNames={projectNames}
									current={current}
									busy={busy}
									onToggle={(enabled) => toggle(s, enabled)}
									onEdit={() => openDialog({ kind: "edit", server: s })}
									onDelete={() => void remove(s)}
									onPickProjects={() => openDialog({ kind: "scope", name: s.name })}
									onAddToCurrent={() => addToCurrent(s)}
								/>
							))
						)}
					</SettingsCard>
				)}
			</div>

			{catalog && catalog.files.length > 0 && (
				<div data-jump={t("mcp.jumpConfigFiles")} className="scroll-mt-4 space-y-2">
					<button
						type="button"
						aria-expanded={filesOpen}
						onClick={() => setFilesOpen(!filesOpen)}
						className="flex items-center gap-1 whitespace-nowrap px-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
					>
						{filesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
						{t("mcp.advancedConfigFiles")}
					</button>
					{filesOpen && (
						<SettingsCard>
							{catalog.files.map((f) => (
								<div key={f.path} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
									<div className="min-w-0">
										<div className="select-text break-all font-mono text-xs text-[var(--text)]">{f.path}</div>
										<div className="mt-0.5 break-all text-[11px] text-[var(--text-dim)]">
											{f.scope === "project" ? t("mcp.scopeProject", { name: f.project ? nameOf(f.project) : "" }) : t("mcp.scopeGlobal")}
											{!f.exists && t("mcp.fileNotCreated")}
											{f.parseError && t("mcp.fileFormatError", { error: f.parseError })}
											{f.disabledServers.length > 0 && t("mcp.fileDenylistedCount", { count: f.disabledServers.length })}
										</div>
									</div>
									{f.exists && (
										<IconButton
											icon={ExternalLink}
											label={t("mcp.openFileAria", { path: f.path })}
											title={t("mcp.openWithDefaultProgram")}
											size="sm"
											onClick={() => openFile(f.path)}
										/>
									)}
								</div>
							))}
						</SettingsCard>
					)}
				</div>
			)}

			<OmpSections page="mcp" />

			{dialog?.kind === "add" && (
				<McpServerEditor
					original={null}
					projects={pickerProjects}
					current={current}
					existingNames={existingNames}
					onSubmit={(name, patch, scope) => submitEditor(null, name, patch, scope)}
					onClose={() => setDialog(null)}
				/>
			)}
			{editing && (
				<McpServerEditor
					original={editing}
					unavailable={!allServers.some((s) => s.name === editing.name)}
					projects={pickerProjects}
					current={current}
					existingNames={existingNames}
					onSubmit={(name, patch, scope) => submitEditor(editing.name, name, patch, scope)}
					onClose={() => setDialog(null)}
				/>
			)}
			{scoping && (
				<McpScopeDialog
					view={scoping}
					projects={pickerProjects}
					current={current}
					busy={busy}
					onSave={(scope) => void saveScope(scoping, scope)}
					onClose={() => setDialog(null)}
				/>
			)}
			{dialog?.kind === "import" && (
				<McpImportDialog
					projects={pickerProjects}
					current={current}
					existingNames={existingNames}
					onImport={importServers}
					onClose={() => setDialog(null)}
				/>
			)}
		</div>
	);
}
