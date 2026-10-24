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
	| { kind: "edit"; name: string }
	| { kind: "scope"; name: string };

type Filter = "all" | "current";

/** Where a delete will remove the server from, in plain words. */
function deleteTargets(view: McpServerView, names: (p: string) => string): string {
	const parts: string[] = [];
	if (view.hasGlobal) parts.push("全局配置");
	if (view.copyProjects.length > 0) parts.push(`项目 ${view.copyProjects.map(names).join("、")}`);
	return parts.length > 0 ? parts.join("和") : "配置文件";
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
	const workspaces = useSessions((s) => s.workspaces);
	const { projects, current } = useMemo(() => deriveProjects(workspaces, cwd), [workspaces, cwd]);
	const paths = useMemo(() => projects.map((p) => p.path), [projects]);
	const pathsKey = paths.join("\n");
	const projectNames = useMemo(() => new Map(projects.map((p) => [p.path, p.name])), [projects]);

	const [catalog, setCatalog] = useState<McpCatalog | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [dialog, setDialog] = useState<Dialog | null>(null);
	const [filter, setFilter] = useState<Filter>("all");
	const [filesOpen, setFilesOpen] = useState(false);
	const seq = useRef(0);
	const pathsRef = useRef(paths);
	pathsRef.current = paths;

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

	/** Run one write; resolves to an error message (not toasted) or null. Reloads on success unless told not to. */
	const write = async (fn: () => Promise<unknown>, reloadAfter = true): Promise<string | null> => {
		setBusy(true);
		try {
			await fn();
			if (reloadAfter) await reload();
			return null;
		} catch (e) {
			return errMsg(e);
		} finally {
			setBusy(false);
		}
	};
	/** `write` + toast for the inline (non-dialog) actions. */
	const act = async (fn: () => Promise<unknown>, okMsg: string): Promise<boolean> => {
		if (busy) return false;
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
		void openPath(path).catch((e: unknown) => toast.error(`打开文件失败: ${errMsg(e)}`));
	};

	const toggle = (s: McpServerView, enabled: boolean) =>
		void act(
			() => mcpServerSetEnabled(paths, s.name, enabled),
			enabled ? `已恢复使用「${s.name}」，新开的会话生效` : `已暂停「${s.name}」，新开的会话生效`,
		);

	const remove = async (s: McpServerView) => {
		const confirmed = await confirmDialog(
			`将从${deleteTargets(s, nameOf)}中删除 MCP 服务器「${s.name}」。此操作会改写配置文件，无法撤销。`,
			{ title: "删除 MCP 服务器", danger: true, okLabel: "删除" },
		);
		if (!confirmed) return;
		await act(() => mcpServerDelete(paths, s.name), `已删除「${s.name}」`);
	};

	const addToCurrent = (s: McpServerView) => {
		if (!current) return;
		void act(
			() => mcpServerSetScope(paths, s.name, scopeWithCurrent(s, paths, current)),
			`已把「${s.name}」加到当前项目，新开的会话生效`,
		);
	};

	const saveScope = async (s: McpServerView, scope: McpScope) => {
		if (await act(() => mcpServerSetScope(paths, s.name, scope), `已更新「${s.name}」的使用范围，新开的会话生效`))
			setDialog(null);
	};

	const submitEditor = async (
		originalName: string | null,
		name: string,
		patch: McpServerPatch,
		scope: McpScope | null,
	): Promise<string | null> => {
		const err = await write(() => mcpServerSave(paths, originalName, name, patch, scope));
		if (!err) {
			toast.success(`已保存「${name}」，新开的会话生效`);
			setDialog(null);
		}
		return err;
	};

	const importOne = (name: string, entry: ImportEntry, scope: McpScope) =>
		write(() => mcpServerSave(paths, null, name, entry as McpServerPatch, scope), false);

	const importFinished = (imported: number) => {
		if (imported > 0) toast.success(`已导入 ${imported} 个服务器，新开的会话生效`);
		void reload();
	};

	const editing = dialog?.kind === "edit" ? allServers.find((s) => s.name === dialog.name) : undefined;
	const scoping = dialog?.kind === "scope" ? allServers.find((s) => s.name === dialog.name) : undefined;
	const brokenFiles = (catalog?.files ?? []).filter((f) => f.parseError);

	return (
		<div className="space-y-6">
			<SectionHeader
				title="MCP 服务器"
				description="MCP 服务器是 AI 可以调用的外部工具。每个服务器可以用在所有项目，也可以只用在你选的项目；改动只对之后新开的会话生效。"
				actions={
					<>
						<IconButton
							icon={RefreshCw}
							label="重新读取配置文件"
							onClick={() => void reload()}
							disabled={busy || loading}
							className={loading ? "[&_svg]:animate-spin" : undefined}
						/>
						<Button icon={Upload} onClick={() => setDialog({ kind: "import" })} disabled={!catalog || busy}>
							导入配置
						</Button>
						<Button
							variant="primary"
							icon={Plus}
							onClick={() => setDialog({ kind: "add" })}
							disabled={!catalog || busy}
						>
							添加服务器
						</Button>
					</>
				}
			/>
			<SectionJumpBar />

			{current && catalog && (
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="text-xs text-[var(--text-muted)]">
						当前项目「{currentName}」的新会话会加载 {loadedHere} 个服务器
					</div>
					<Segmented<Filter>
						aria-label="服务器筛选"
						options={[
							{ value: "all", label: "全部服务器" },
							{ value: "current", label: "只看当前项目" },
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
							重试
						</Button>
					}
				>
					<span className="select-text break-all">读取配置失败：{loadError}</span>
				</Notice>
			)}

			{brokenFiles.map((f) => (
				<Notice
					key={f.path}
					tone="danger"
					title="配置文件格式有误，里面的服务器不会加载"
					action={
						<Button size="sm" icon={ExternalLink} onClick={() => openFile(f.path)}>
							打开文件
						</Button>
					}
				>
					<div className="select-text break-all font-mono">{f.path}</div>
					<div className="select-text whitespace-pre-wrap break-all">{f.parseError}</div>
				</Notice>
			))}

			<div className="scroll-mt-4 space-y-6" data-field-id="mcpServerList" data-jump="服务器">
				{!catalog && !loadError && (
					<div className="flex justify-center py-6 text-[var(--text-dim)]">
						<Loader2 aria-label="加载 MCP 服务器" className="h-4 w-4 animate-spin" />
					</div>
				)}

				{catalog && (
					<SettingsCard title="已配置服务器" clip>
						{visibleServers.length === 0 ? (
							allServers.length === 0 ? (
								<EmptyState
									icon={Server}
									title="还没有配置 MCP 服务器"
									description="添加后，AI 在新会话中就能使用它提供的工具。"
									action={
										<div className="flex items-center gap-2">
											<Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: "add" })}>
												添加服务器
											</Button>
											<Button icon={Upload} onClick={() => setDialog({ kind: "import" })}>
												导入配置
											</Button>
										</div>
									}
								/>
							) : (
								<EmptyState
									icon={Server}
									title={
										q
											? `没有匹配「${query.trim()}」的服务器`
											: `当前项目「${currentName}」还没有加载任何服务器`
									}
									description={q ? undefined : "切换到「全部服务器」，给想用的服务器点「加到当前项目」。"}
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
									onEdit={() => setDialog({ kind: "edit", name: s.name })}
									onDelete={() => void remove(s)}
									onPickProjects={() => setDialog({ kind: "scope", name: s.name })}
									onAddToCurrent={() => addToCurrent(s)}
								/>
							))
						)}
					</SettingsCard>
				)}
			</div>

			{catalog && catalog.files.length > 0 && (
				<div data-jump="配置文件" className="scroll-mt-4 space-y-2">
					<button
						type="button"
						aria-expanded={filesOpen}
						onClick={() => setFilesOpen(!filesOpen)}
						className="flex items-center gap-1 whitespace-nowrap px-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
					>
						{filesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
						配置文件（高级）
					</button>
					{filesOpen && (
						<SettingsCard>
							{catalog.files.map((f) => (
								<div key={f.path} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
									<div className="min-w-0">
										<div className="select-text break-all font-mono text-xs text-[var(--text)]">{f.path}</div>
										<div className="mt-0.5 break-all text-[11px] text-[var(--text-dim)]">
											{f.scope === "project" ? `项目 ${f.project ? nameOf(f.project) : ""}` : "全局"}
											{!f.exists && " · 尚未创建"}
											{f.parseError && ` · 格式错误：${f.parseError}`}
											{f.disabledServers.length > 0 && ` · 停用列表 ${f.disabledServers.length} 个`}
										</div>
									</div>
									{f.exists && (
										<IconButton
											icon={ExternalLink}
											label={`打开文件 ${f.path}`}
											title="用默认程序打开"
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
					onImportOne={importOne}
					onFinished={importFinished}
					onClose={() => setDialog(null)}
				/>
			)}
		</div>
	);
}
