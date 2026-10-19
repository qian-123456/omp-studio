/**
 * [D] "MCP 服务器" settings section.
 *
 * Lists servers across every OMP-managed `mcp.json` file (project
 * `.omp/mcp.json` + `.mcp.json`, the active profile's user `mcp.json` +
 * `.mcp.json`, and project-root fallbacks), with enable/disable, add, edit and
 * delete. Env/header values are never rendered: the list shows key names only,
 * and the editor only adds/overwrites/removes keys — untouched values stay in
 * the file. Full JSON (auth/oauth/extra fields) stays in the file; each group
 * links to it.
 *
 * Runtime `mcp.*` settings (startup timeout, notifications, …) reuse
 * OmpConfigSection filtered to that prefix.
 */

import {
	AlertTriangle,
	ExternalLink,
	FolderInput,
	FolderOpen,
	Globe,
	Loader2,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import type { McpConfigSnapshot, McpKv, McpServerItem } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import {
	mcpConfigList,
	mcpServerMove,
	mcpServerRemove,
	mcpServerSetEnabled,
	mcpServerUpsert,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { NativeSelect } from "../../components/NativeSelect";
import { Segmented } from "../../components/Segmented";
import { useSessions } from "../../stores/sessions";
import {
	buildPatch,
	draftFrom,
	projectName,
	TRANSPORT_LABELS,
	transportLabel,
	validateDraft,
	type DraftErrors,
	type KvRow,
	type ServerDraft,
} from "./mcpDraft";
import { OmpConfigSection } from "./OmpConfigSection";
import { SectionHeader } from "./ui";
import { Switch } from "./Switch";

const FIELD_CLASS =
	"w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600 focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]";

function ScopeBadge({ scope, file }: { scope: string; file: string }) {
	const project = scope === "project";
	return (
		<span
			title={`${project ? "项目级：只在这个项目的会话中可用" : "全局：所有项目的会话都可用"}\n定义于 ${file}`}
			className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-medium ${
				project ? "bg-sky-500/15 text-sky-300" : "bg-[var(--well-bg)] text-neutral-400"
			}`}
		>
			{project ? "项目" : "全局"}
		</span>
	);
}

/** One server row. */
function ServerRow({
	server,
	busy,
	onToggle,
	onEdit,
	onRemove,
	onMoveToProject,
	onMoveToGlobal,
}: {
	server: McpServerItem;
	busy: boolean;
	onToggle: () => void;
	onEdit: () => void;
	onRemove: () => void;
	onMoveToProject?: () => void;
	onMoveToGlobal?: () => void;
}) {
	const endpoint = server.command ?? server.url ?? "（未填写命令或地址）";
	const keys = (list: McpKv[]) => list.map((kv) => kv.key).join("、");
	return (
		<div
			data-mcp-server={server.name}
			className="px-3.5 py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
		>
			<div className="flex items-center justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex min-w-0 items-center gap-2">
						<span className="truncate text-xs font-semibold text-neutral-100">
							{server.name}
						</span>
						<ScopeBadge scope={server.scope} file={server.sourceFile} />
						<span
							title={
								server.transport === "stdio"
									? "在本机启动一个程序作为工具服务 (stdio)"
									: "连接到一个远程网址提供的工具服务"
							}
							className="shrink-0 rounded bg-[var(--well-bg)] px-1 py-0.5 text-[9px] font-medium text-neutral-400"
						>
							{transportLabel(server.transport)}
						</span>
						{server.shadowed && (
							<span
								title="另一个优先级更高的配置文件里有同名服务器，这一条不会生效"
								className="shrink-0 rounded bg-[var(--well-bg)] px-1 py-0.5 text-[9px] text-neutral-500"
							>
								被同名覆盖
							</span>
						)}
						{server.denylisted && (
							<span
								title="已列入用户配置的停用列表 (disabledServers)"
								className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-300"
							>
								已停用
							</span>
						)}
					</div>
					<div className="mt-0.5 truncate font-mono text-[10px] text-neutral-500" title={endpoint}>
						{endpoint}
						{server.args.length > 0 && ` ${server.args.join(" ")}`}
					</div>
					{(server.env.length > 0 || server.headers.length > 0 || server.hasAuth) && (
						<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-neutral-500">
							{server.env.length > 0 && (
								<span title="值不在界面中显示">环境变量：{keys(server.env)}</span>
							)}
							{server.headers.length > 0 && (
								<span title="值不在界面中显示">请求头：{keys(server.headers)}</span>
							)}
							{server.hasAuth && <span>使用 OAuth 登录</span>}
						</div>
					)}
					{server.error && (
						<div className="mt-1 flex items-center gap-1 text-[10px] text-amber-300">
							<AlertTriangle className="h-3 w-3 shrink-0" />
							{server.error}
						</div>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{onMoveToProject && (
						<button
							type="button"
							disabled={busy}
							onClick={onMoveToProject}
							title="将此服务器移入当前所选项目，其他项目将不再加载"
							aria-label={`移入项目 ${server.name}`}
							className="inline-flex items-center gap-1 rounded-lg hairline bg-sky-500/10 px-2 py-1 text-[11px] font-medium text-sky-300 transition-all hover:bg-sky-500/20 active:scale-95 disabled:opacity-50"
						>
							<FolderInput className="h-3 w-3" />
							<span>移入当前项目</span>
						</button>
					)}
					{onMoveToGlobal && (
						<button
							type="button"
							disabled={busy}
							onClick={onMoveToGlobal}
							title="将此服务器移至全局配置，所有项目都可以使用"
							aria-label={`移至全局 ${server.name}`}
							className="inline-flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-1 text-[11px] font-medium text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50"
						>
							<Globe className="h-3 w-3" />
							<span>移至全局</span>
						</button>
					)}
					<button
						type="button"
						disabled={busy}
						onClick={onEdit}
						title="编辑"
						aria-label={`编辑 ${server.name}`}
						className="rounded-lg p-1 text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 disabled:opacity-50"
					>
						<Pencil className="h-3 w-3" />
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={onRemove}
						title="删除"
						aria-label={`删除 ${server.name}`}
						className="rounded-lg p-1 text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-rose-300 active:scale-95 disabled:opacity-50"
					>
						<Trash2 className="h-3 w-3" />
					</button>
					<span
						title={
							server.shadowed
								? "被同名服务器覆盖，无法单独启用"
								: server.enabled
									? "已启用，点击停用"
									: "已停用，点击启用"
						}
					>
						<Switch
							checked={server.enabled}
							disabled={busy || server.shadowed}
							onChange={onToggle}
						/>
					</span>
				</div>
			</div>
		</div>
	);
}

/**
 * Key/value editor for env vars or headers. Existing keys are listed by name
 * only (values are never shown); typing a value for an existing key overwrites it.
 */
function KvEditor({
	label,
	hint,
	existing,
	removed,
	adds,
	error,
	keyPlaceholder,
	addLabel,
	onRemoveExisting,
	onChangeAdds,
}: {
	label: string;
	hint: string;
	existing: McpKv[];
	removed: Set<string>;
	adds: KvRow[];
	error?: string;
	keyPlaceholder: string;
	addLabel: string;
	onRemoveExisting: (key: string) => void;
	onChangeAdds: (rows: KvRow[]) => void;
}) {
	const kept = existing.filter((kv) => !removed.has(kv.key));
	return (
		<div className="space-y-1">
			<div className="text-[10px] text-neutral-400">{label}</div>
			<div className="text-[10px] text-neutral-500">{hint}</div>
			<div className="space-y-1">
				{kept.map((kv) => (
					<div key={kv.key} className="flex items-center gap-1.5">
						<span className="w-40 truncate font-mono text-[11px] text-neutral-300">{kv.key}</span>
						<span className="flex-1 text-[11px] text-neutral-500">已设置（值不显示）</span>
						<button
							type="button"
							onClick={() => onRemoveExisting(kv.key)}
							title="删除此项"
							aria-label={`删除 ${kv.key}`}
							className="rounded p-0.5 text-neutral-500 transition-all hover:text-rose-300 active:scale-95"
						>
							<X className="h-3 w-3" />
						</button>
					</div>
				))}
				{adds.map((kv, i) => (
					<div key={i} className="flex items-center gap-1.5">
						<input
							value={kv.key}
							onChange={(e) =>
								onChangeAdds(adds.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
							}
							placeholder={keyPlaceholder}
							aria-label="名称"
							className="w-40 rounded hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none"
						/>
						<input
							type="password"
							autoComplete="off"
							value={kv.value}
							onChange={(e) =>
								onChangeAdds(adds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
							}
							placeholder="值（也可写 ${VAR} 引用本机环境变量）"
							aria-label="值"
							className="flex-1 rounded hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none"
						/>
						<button
							type="button"
							onClick={() => onChangeAdds(adds.filter((_, j) => j !== i))}
							title="移除此行"
							aria-label="移除此行"
							className="rounded p-0.5 text-neutral-500 transition-all hover:text-rose-300 active:scale-95"
						>
							<X className="h-3 w-3" />
						</button>
					</div>
				))}
				<button
					type="button"
					onClick={() => onChangeAdds([...adds, { key: "", value: "" }])}
					className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95"
				>
					<Plus className="h-2.5 w-2.5" />
					{addLabel}
				</button>
				{error && <div className="text-[10px] text-rose-400">{error}</div>}
			</div>
		</div>
	);
}

function FieldError({ msg }: { msg?: string }) {
	return msg ? <div className="text-[10px] text-rose-400">{msg}</div> : null;
}

export function McpSection({
	cwd,
	query = "",
	onNavigateSection,
}: {
	/** Selected session's cwd; project mcp.json files come from it. */
	cwd: string | null;
	/** Nav search query. */
	query?: string;
	onNavigateSection: (id: string) => void;
}) {
	const workspaces = useSessions((s) => s.workspaces);
	const [selectedCwd, setSelectedCwd] = useState<string | null>(() => cwd);
	const activeCwd = selectedCwd;

	const [snap, setSnap] = useState<McpConfigSnapshot | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [draft, setDraft] = useState<ServerDraft | null>(null);
	/** Errors are shown only after the first save attempt. */
	const [showErrors, setShowErrors] = useState(false);
	const formRef = useRef<HTMLDivElement>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		try {
			setSnap(await mcpConfigList(activeCwd));
			setLoadError(null);
		} catch (e) {
			setLoadError(errMsg(e));
		} finally {
			setLoading(false);
		}
	}, [activeCwd]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const q = query.trim().toLowerCase();
	const servers = useMemo(
		() =>
			(snap?.servers ?? []).filter(
				(s) =>
					!q ||
					s.name.toLowerCase().includes(q) ||
					s.sourceFile.toLowerCase().includes(q) ||
					(s.command ?? "").toLowerCase().includes(q) ||
					(s.url ?? "").toLowerCase().includes(q),
			),
		[snap, q],
	);

	const run = async (fn: () => Promise<unknown>, okMsg: string): Promise<boolean> => {
		if (busy) return false;
		setBusy(true);
		try {
			await fn();
			toast.success(okMsg);
			await reload();
			return true;
		} catch (e) {
			toast.error(errMsg(e));
			return false;
		} finally {
			setBusy(false);
		}
	};

	const errors: DraftErrors = useMemo(() => {
		if (!draft) return {};
		const names = (snap?.servers ?? [])
			.filter((s) => s.sourceFile === draft.path)
			.map((s) => s.name);
		return validateDraft(draft, names);
	}, [draft, snap]);
	const visibleErrors = showErrors ? errors : {};

	const openDraft = (next: ServerDraft) => {
		setShowErrors(false);
		setDraft(next);
		requestAnimationFrame(() =>
			formRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
		);
	};

	const saveDraft = async () => {
		if (!draft) return;
		if (Object.keys(errors).length > 0) {
			setShowErrors(true);
			return;
		}
		const name = draft.name.trim();
		const patch = buildPatch(draft);
		const original = draft.original;
		const ok = await run(async () => {
			await mcpServerUpsert(draft.path, name, patch, activeCwd);
			if (original && original.name !== name) {
				await mcpServerRemove(original.sourceFile, original.name, activeCwd);
			}
		}, `已保存「${name}」，新开的会话会使用它`);
		// Keep the form open on failure so nothing typed is lost.
		if (ok) setDraft(null);
	};

	const removeServer = async (s: McpServerItem) => {
		const confirmed = await confirmDialog(
			`从 ${s.sourceFile} 中删除 MCP 服务器「${s.name}」？此操作会改写该文件，无法撤销。`,
			{ title: "删除 MCP 服务器", danger: true, okLabel: "删除" },
		);
		if (!confirmed) return;
		await run(() => mcpServerRemove(s.sourceFile, s.name, activeCwd), `已删除「${s.name}」`);
	};

	const openFile = (path: string) => {
		void openPath(path).catch((e: unknown) => toast.error(`打开文件失败: ${errMsg(e)}`));
	};

	const groupedByFile = useMemo(() => {
		const m = new Map<string, McpServerItem[]>();
		for (const s of servers) {
			const list = m.get(s.sourceFile);
			if (list) list.push(s);
			else m.set(s.sourceFile, [s]);
		}
		return [...m.entries()];
	}, [servers]);

	const projectWritePath = useMemo(() => {
		if (!activeCwd) return null;
		const match = snap?.files.find((f) => f.scope === "project" && f.path.includes(".omp"));
		return match?.path ?? `${activeCwd}/.omp/mcp.json`;
	}, [snap, activeCwd]);

	const moveToProject = async (s: McpServerItem) => {
		if (!projectWritePath || !activeCwd) return;
		const pName = projectName(activeCwd);
		const confirmed = await confirmDialog(
			`将 MCP 服务器「${s.name}」移入项目「${pName}」？\n移入后该服务器仅在该项目中加载，其他项目新会话不再加载此工具，立即可节省上下文。`,
			{ title: "移入项目", okLabel: "移入项目" },
		);
		if (!confirmed) return;
		await run(
			() => mcpServerMove(s.sourceFile, projectWritePath, s.name, activeCwd),
			`已将「${s.name}」移入项目「${pName}」`,
		);
	};

	const moveToGlobal = async (s: McpServerItem) => {
		if (!snap?.defaultWritePath) return;
		const confirmed = await confirmDialog(
			`将 MCP 服务器「${s.name}」移至全局配置？\n移入后所有项目的新会话都会加载此工具。`,
			{ title: "移至全局", okLabel: "移至全局" },
		);
		if (!confirmed) return;
		await run(
			() => mcpServerMove(s.sourceFile, snap.defaultWritePath, s.name, activeCwd),
			`已将「${s.name}」移至全局配置`,
		);
	};

	const startAdd = () => {
		const targetPath = activeCwd && projectWritePath ? projectWritePath : (snap?.defaultWritePath ?? "");
		openDraft(draftFrom(null, targetPath));
	};
	const form = draft && (
		<div
			ref={formRef}
			className="space-y-3 rounded-xl hairline border-l-[3px] border-l-[var(--accent)] bg-[var(--bg-panel)] p-4 shadow-apple-card"
			onKeyDown={(e) => {
				if (e.key === "Escape") setDraft(null);
			}}
		>
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold text-neutral-200">
					{draft.original ? `编辑「${draft.original.name}」` : "添加 MCP 服务器"}
				</div>
				<button
					type="button"
					onClick={() => setDraft(null)}
					aria-label="关闭"
					className="rounded p-0.5 text-neutral-500 transition-all hover:text-neutral-300 active:scale-95"
				>
					<X className="h-3.5 w-3.5" />
				</button>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<label className="space-y-1">
					<span className="text-[10px] text-neutral-400">名称</span>
					<input
						autoFocus
						value={draft.name}
						onChange={(e) => setDraft({ ...draft, name: e.target.value })}
						placeholder="例如 filesystem"
						className={FIELD_CLASS}
					/>
					<FieldError msg={visibleErrors.name} />
				</label>
				<div className="space-y-1">
					<span className="text-[10px] text-neutral-400">连接方式</span>
					<Segmented
						options={(["stdio", "http", "sse"] as const).map((t) => ({
							value: t,
							label: TRANSPORT_LABELS[t],
							title:
								t === "stdio"
									? "在本机运行一个命令（最常见，如 npx 某个包）"
									: t === "http"
										? "连接远程 HTTP 地址（Streamable HTTP）"
										: "连接远程 SSE 地址（旧式推送协议）",
						}))}
						value={draft.type}
						onChange={(t) => setDraft({ ...draft, type: t })}
					/>
				</div>
			</div>

			{!draft.original && snap && (
				<label className="block space-y-1">
					<span className="text-[10px] text-neutral-400">保存到</span>
					<select
						value={draft.path}
						onChange={(e) => setDraft({ ...draft, path: e.target.value })}
						className={FIELD_CLASS}
					>
						{activeCwd && projectWritePath && (
							<option value={projectWritePath}>
								仅当前项目（{projectName(activeCwd)}）— {projectWritePath}
							</option>
						)}
						<option value={snap.defaultWritePath}>全局（所有项目通用）— {snap.defaultWritePath}</option>
						{snap.files
							.filter((f) => f.path !== snap.defaultWritePath && f.path !== projectWritePath)
							.map((f) => (
								<option key={f.path} value={f.path}>
									{f.scope === "project" ? "仅当前项目" : "全局"} — {f.path}
								</option>
							))}
					</select>
				</label>
			)}

			{draft.type === "stdio" ? (
				<>
					<label className="block space-y-1">
						<span className="text-[10px] text-neutral-400">命令</span>
						<input
							value={draft.command}
							onChange={(e) => setDraft({ ...draft, command: e.target.value })}
							placeholder="npx"
							className={`${FIELD_CLASS} font-mono`}
						/>
						<FieldError msg={visibleErrors.command} />
					</label>
					<label className="block space-y-1">
						<span className="text-[10px] text-neutral-400">参数（每行一个）</span>
						<textarea
							value={draft.args}
							onChange={(e) => setDraft({ ...draft, args: e.target.value })}
							rows={3}
							placeholder={"-y\n@modelcontextprotocol/server-filesystem"}
							className={`${FIELD_CLASS} font-mono`}
						/>
					</label>
					<label className="block space-y-1">
						<span className="text-[10px] text-neutral-400">工作目录（可选）</span>
						<input
							value={draft.cwd}
							onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
							placeholder="留空则使用会话所在目录"
							className={`${FIELD_CLASS} font-mono`}
						/>
					</label>
					<KvEditor
						label="环境变量"
						hint="传给该命令的环境变量，常用于填写 API 密钥。已保存的值不会显示；再次填写同名项即可覆盖。"
						existing={draft.original?.env ?? []}
						removed={draft.envRemoves}
						adds={draft.envAdds}
						error={visibleErrors.env}
						keyPlaceholder="API_KEY"
						addLabel="添加环境变量"
						onRemoveExisting={(k) =>
							setDraft({ ...draft, envRemoves: new Set([...draft.envRemoves, k]) })
						}
						onChangeAdds={(rows) => setDraft({ ...draft, envAdds: rows })}
					/>
				</>
			) : (
				<>
					<label className="block space-y-1">
						<span className="text-[10px] text-neutral-400">服务器地址</span>
						<input
							value={draft.url}
							onChange={(e) => setDraft({ ...draft, url: e.target.value })}
							placeholder="https://example.com/mcp"
							className={`${FIELD_CLASS} font-mono`}
						/>
						<FieldError msg={visibleErrors.url} />
					</label>
					<KvEditor
						label="请求头"
						hint="每次请求附带的 HTTP 头，常用于 Authorization 令牌。已保存的值不会显示；再次填写同名项即可覆盖。"
						existing={draft.original?.headers ?? []}
						removed={draft.headerRemoves}
						adds={draft.headerAdds}
						error={visibleErrors.headers}
						keyPlaceholder="Authorization"
						addLabel="添加请求头"
						onRemoveExisting={(k) =>
							setDraft({ ...draft, headerRemoves: new Set([...draft.headerRemoves, k]) })
						}
						onChangeAdds={(rows) => setDraft({ ...draft, headerAdds: rows })}
					/>
				</>
			)}

			<div className="flex flex-wrap items-start justify-between gap-3">
				<label className="flex items-center gap-2">
					<Switch
						checked={draft.instructions}
						onChange={(v) => setDraft({ ...draft, instructions: v })}
					/>
					<span className="text-[11px] text-neutral-300" title="服务器自带的使用说明 (instructions)">
						把该服务器的使用说明告诉模型
					</span>
				</label>
				<label className="space-y-1">
					<span className="flex items-center gap-2">
						<span className="text-[10px] text-neutral-400">超时（毫秒）</span>
						<input
							inputMode="numeric"
							value={draft.timeout}
							onChange={(e) => setDraft({ ...draft, timeout: e.target.value })}
							placeholder="默认"
							className="w-24 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none"
						/>
					</span>
					<FieldError msg={visibleErrors.timeout} />
				</label>
			</div>

			<div className="flex items-center justify-between gap-2 pt-1">
				<span className="text-[10px] text-neutral-500">保存后对新开的会话生效</span>
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => setDraft(null)}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-200"
					>
						取消
					</button>
					<button
						type="button"
						disabled={busy || (showErrors && Object.keys(errors).length > 0)}
						onClick={() => void saveDraft()}
						className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
					>
						{busy && <Loader2 className="h-3 w-3 animate-spin" />}
						保存
					</button>
				</div>
			</div>
		</div>
	);

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<SectionHeader
					title="MCP 服务器"
					description="MCP 服务器为 AI 提供额外的工具（如读写文件、查数据库、访问网页）。改动只对之后新开的会话生效。"
				/>
				<div className="flex flex-wrap items-center justify-between gap-3 pt-1">
					<div className="flex items-center gap-2 text-[11px] text-neutral-400">
						<FolderOpen className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
						<span className="shrink-0">配置目标项目：</span>
						{workspaces.length > 0 ? (
							<NativeSelect
								aria-label="选择要配置的项目"
								value={activeCwd ?? ""}
								onChange={(e) => {
									const val = e.target.value;
									setSelectedCwd(val === "" ? null : val);
								}}
								className="text-[11px]"
								containerClassName="w-[230px]"
							>
								<option value="">全部项目（仅全局视图）</option>
								{workspaces.map((w) => (
									<option key={w.id} value={w.path}>
										项目：{w.name}
									</option>
								))}
							</NativeSelect>
						) : activeCwd ? (
							<span className="font-medium text-neutral-200" title={activeCwd}>
								{projectName(activeCwd)}
							</span>
						) : (
							<span className="text-neutral-500">未选择项目（仅全局）</span>
						)}
					</div>
					{activeCwd && (
						<div className="text-[10px] text-neutral-500">
							项目专属文件：<span className="font-mono text-neutral-400">{projectName(activeCwd)}/.omp/mcp.json</span>
						</div>
					)}
				</div>
			</div>

			{loadError && (
				<div
					role="alert"
					className="flex items-start gap-1.5 rounded-xl hairline bg-rose-950/20 px-3 py-2 text-[11px] text-rose-300"
				>
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="min-w-0 flex-1 break-all">读取配置失败：{loadError}</span>
					<button
						type="button"
						onClick={() => void reload()}
						className="inline-flex shrink-0 items-center gap-1 text-rose-200 hover:underline"
					>
						<RefreshCw className="h-3 w-3" />
						重试
					</button>
				</div>
			)}

			{/* Server list grouped by defining file */}
			<div className="space-y-3" data-field-id="mcpServerList">
				<div className="flex items-center justify-between">
					<div className="text-xs font-medium text-neutral-200">
						已配置服务器
						<span className="ml-1.5 text-[10px] font-normal text-neutral-500">
							{snap?.servers.length ?? 0} 个
						</span>
					</div>
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							onClick={() => void reload()}
							disabled={busy || loading}
							title="重新读取配置文件"
							aria-label="重新读取配置文件"
							className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 transition-all hover:bg-[var(--bg-hover)] active:scale-95 disabled:opacity-50"
						>
							<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
						</button>
						<button
							type="button"
							onClick={startAdd}
							disabled={!snap}
							className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--bg)] shadow-sm transition-all hover:opacity-90 active:scale-95 disabled:opacity-50"
						>
							<Plus className="h-3 w-3" />
							<span>添加服务器</span>
						</button>
					</div>
				</div>

				{form}

				{!snap && !loadError && (
					<div className="flex justify-center py-6 text-neutral-500">
						<Loader2 aria-label="加载 MCP 服务器" className="h-4 w-4 animate-spin" />
					</div>
				)}

				{snap && servers.length === 0 && (
					<div className="space-y-2 rounded-xl hairline bg-[var(--bg-panel)] p-6 text-center text-xs text-neutral-500 shadow-apple-card">
						{q ? (
							<p>没有匹配「{query.trim()}」的服务器</p>
						) : (
							<>
								<p className="text-neutral-300">还没有配置 MCP 服务器</p>
								<p>添加后，AI 在新会话中就能使用它提供的工具。</p>
								{!draft && (
									<button
										type="button"
										onClick={startAdd}
										className="text-[var(--accent)] hover:underline"
									>
										添加第一个服务器
									</button>
								)}
							</>
						)}
					</div>
				)}

				{activeCwd && !groupedByFile.some(([file]) => file.startsWith(activeCwd)) && (
					<div className="rounded-xl hairline bg-sky-500/5 border-dashed border-sky-500/20 p-3.5 text-xs text-neutral-400">
						<div className="flex items-center gap-2 text-sky-300 font-medium mb-1">
							<FolderOpen className="h-3.5 w-3.5" />
							<span>项目「{projectName(activeCwd)}」尚未配置专属 MCP 服务器</span>
						</div>
						<p className="text-[11px] text-neutral-400">
							当前项目会继承下方全局服务器。若希望把特定的工具（如逆向分析、特定数据库）隔离在此项目内，可点击下方服务器的「移入当前项目」，或点上方「添加服务器」选择保存到此项目。
						</p>
					</div>
				)}

				{groupedByFile.map(([file, list]) => {
					const isProject = activeCwd && file.startsWith(activeCwd);
					return (
						<div key={file} className="space-y-1">
							<div className="flex items-center justify-between gap-1.5 px-1">
								<div className="flex min-w-0 items-center gap-2">
									<span
										className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${
											isProject ? "bg-sky-500/15 text-sky-300" : "bg-[var(--well-bg)] text-neutral-400"
										}`}
									>
										{isProject ? `项目专属（${projectName(activeCwd)}）` : "全局配置（所有项目）"}
									</span>
									<span
										className="truncate font-mono text-[10px] text-neutral-500"
										title={file}
									>
										{file}
									</span>
								</div>
								<button
									type="button"
									onClick={() => openFile(file)}
									title="用默认程序打开配置文件"
									aria-label="打开配置文件"
									className="shrink-0 rounded p-0.5 text-neutral-500 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-300 active:scale-95"
								>
									<ExternalLink className="h-3 w-3" />
								</button>
							</div>
							<div className="divide-y divide-[var(--border-divider)] overflow-hidden rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card">
								{list.map((s) => (
									<ServerRow
										key={s.name}
										server={s}
										busy={busy}
										onToggle={() =>
											void run(
												() => mcpServerSetEnabled(s.name, !s.enabled, activeCwd),
												s.enabled
													? `已停用「${s.name}」（新会话生效）`
													: `已启用「${s.name}」（新会话生效）`,
											)
										}
										onEdit={() => openDraft(draftFrom(s, ""))}
										onRemove={() => void removeServer(s)}
										onMoveToProject={
											s.scope === "user" && projectWritePath
												? () => void moveToProject(s)
												: undefined
										}
										onMoveToGlobal={
											s.scope === "project" &&
											snap?.defaultWritePath &&
											s.sourceFile !== snap.defaultWritePath
												? () => void moveToGlobal(s)
												: undefined
										}
									/>
								))}
							</div>
						</div>
					);
				})}
			</div>

			{/* Config files overview */}
			<div className="space-y-2">
				<div className="px-1 text-xs font-medium text-neutral-200">配置文件</div>
				<div className="divide-y divide-[var(--border-divider)] overflow-hidden rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card">
					{(snap?.files ?? []).map((f) => (
						<div key={f.path} className="flex items-center justify-between gap-3 px-3.5 py-2">
							<div className="min-w-0">
								<div className="truncate font-mono text-[11px] text-neutral-300" title={f.path}>
									{f.path}
								</div>
								<div className="mt-0.5 text-[10px] text-neutral-500">
									{f.scope === "project" ? "项目级" : "全局"}
									{f.exists ? "" : " · 尚未创建（添加服务器时自动创建）"}
									{f.parseError
										? ` · 格式错误：${f.parseError}`
										: f.disabledServers.length + f.enabledServers.length > 0
											? ` · 停用 ${f.disabledServers.length} 个 / 白名单 ${f.enabledServers.length} 个`
											: ""}
								</div>
							</div>
							{f.exists && (
								<button
									type="button"
									onClick={() => openFile(f.path)}
									title="用默认程序打开配置文件"
									aria-label="打开配置文件"
									className="shrink-0 rounded p-1 text-neutral-500 transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-300 active:scale-95"
								>
									<ExternalLink className="h-3 w-3" />
								</button>
							)}
						</div>
					))}
				</div>
			</div>

			{/* mcp.* runtime settings, same rows as the OMP config list */}
			<div data-field-id="mcpRuntimeOptions" className="space-y-2">
				<OmpConfigSection
					activeTab="tools"
					onTabChange={onNavigateSection}
					keyPrefix="mcp."
					title="运行时选项"
					hint="连接超时、通知等 MCP 通用行为 (mcp.*)"
					query={query}
				/>
			</div>
		</div>
	);
}
