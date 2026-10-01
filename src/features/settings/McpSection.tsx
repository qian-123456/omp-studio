/**
 * [D] "MCP 服务器" settings section.
 *
 * Lists servers across every OMP-managed `mcp.json` file (project
 * `.omp/mcp.json` + `.mcp.json`, the active profile's user `mcp.json` +
 * `.mcp.json`, and project-root fallbacks), with enable/disable, add, edit and
 * delete. `env`/`header` values that look like secrets arrive masked from the
 * backend and are never editable in place — editing preserves the stored
 * value, deleting removes the key. Full JSON (auth/oauth/extra fields) stays
 * in the file; each row links to it.
 *
 * Runtime `mcp.*` settings (startup timeout, notifications, …) reuse
 * OmpConfigSection filtered to that prefix.
 */

import {
	AlertTriangle,
	ExternalLink,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import type {
	McpConfigSnapshot,
	McpKv,
	McpServerItem,
	McpServerPatch,
} from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import {
	mcpConfigList,
	mcpServerRemove,
	mcpServerSetEnabled,
	mcpServerUpsert,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { Switch } from "./Switch";
import { OmpConfigSection } from "./OmpConfigSection";

interface ServerDraft {
	/** Existing entry when editing; null when adding. */
	original: McpServerItem | null;
	name: string;
	path: string;
	type: "stdio" | "http" | "sse";
	command: string;
	/** One arg per line. */
	args: string;
	url: string;
	cwd: string;
	timeout: string;
	instructions: boolean;
	/** New env/header entries written verbatim; untouched keys are preserved. */
	envAdds: { key: string; value: string }[];
	headerAdds: { key: string; value: string }[];
	/** Keys to delete from env/headers. */
	envRemoves: Set<string>;
	headerRemoves: Set<string>;
}

function draftFrom(original: McpServerItem | null, defaultPath: string): ServerDraft {
	return {
		original,
		name: original?.name ?? "",
		path: original?.sourceFile ?? defaultPath,
		type:
			original?.transport === "http" || original?.transport === "sse"
				? original.transport
				: "stdio",
		command: original?.command ?? "",
		args: (original?.args ?? []).join("\n"),
		url: original?.url ?? "",
		cwd: original?.cwd ?? "",
		timeout:
			original?.timeoutMs != null ? String(original.timeoutMs) : "",
		instructions: original?.instructions ?? true,
		envAdds: [],
		headerAdds: [],
		envRemoves: new Set(),
		headerRemoves: new Set(),
	};
}

function buildPatch(d: ServerDraft): McpServerPatch {
	const patch: McpServerPatch = {};
	const command = d.command.trim();
	const url = d.url.trim();
	patch.type = d.type;
	if (d.type === "stdio") {
		if (command) patch.command = command;
		else patch.command = null;
		patch.url = null;
		patch.headers = null;
	} else {
		if (url) patch.url = url;
		else patch.url = null;
		patch.command = null;
		patch.args = null;
		patch.env = null;
		patch.cwd = null;
	}
	if (d.type === "stdio") {
		const args = d.args
			.split("\n")
			.map((a) => a.trim())
			.filter(Boolean);
		patch.args = args;
		patch.cwd = d.cwd.trim() || null;
		const env: Record<string, string | null> = {};
		for (const k of d.envRemoves) env[k] = null;
		for (const { key, value } of d.envAdds) {
			const k = key.trim();
			if (k) env[k] = value;
		}
		if (Object.keys(env).length > 0) patch.env = env;
	}
	if (d.type !== "stdio") {
		const headers: Record<string, string | null> = {};
		for (const k of d.headerRemoves) headers[k] = null;
		for (const { key, value } of d.headerAdds) {
			const k = key.trim();
			if (k) headers[k] = value;
		}
		if (Object.keys(headers).length > 0) patch.headers = headers;
	}
	if (d.timeout.trim()) {
		const n = Number(d.timeout.trim());
		patch.timeout = Number.isFinite(n) ? n : d.timeout.trim();
	} else if (d.original?.timeoutMs != null) {
		patch.timeout = null;
	}
	patch.instructions = d.instructions;
	return patch;
}

function kvValue(kv: McpKv): string {
	return kv.masked ? "********" : (kv.value ?? "");
}

/** One server row. */
function ServerRow({
	server,
	busy,
	onToggle,
	onEdit,
	onRemove,
}: {
	server: McpServerItem;
	busy: boolean;
	onToggle: () => void;
	onEdit: () => void;
	onRemove: () => void;
}) {
	const endpoint =
		server.command ?? server.url ?? "（缺少 command/url）";
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
						<span className="shrink-0 rounded bg-[var(--well-bg)] px-1 py-0.2 text-[9px] font-medium text-neutral-400">
							{server.transport}
						</span>
						{server.scope === "project" && (
							<span className="shrink-0 rounded bg-[var(--well-bg)] px-1 py-0.2 text-[9px] text-neutral-400">
								项目
							</span>
						)}
						{server.shadowed && (
							<span
								title="同名服务器在更高优先级的文件中已定义，此条目被忽略"
								className="shrink-0 rounded bg-[var(--well-bg)] px-1 py-0.2 text-[9px] text-neutral-500"
							>
								被覆盖
							</span>
						)}
						{server.denylisted && (
							<span
								title="已在用户配置 disabledServers 中停用"
								className="shrink-0 rounded bg-amber-500/15 px-1 py-0.2 text-[9px] text-amber-300"
							>
								停用列表
							</span>
						)}
					</div>
					<div
						className="mt-0.5 truncate font-mono text-[10px] text-neutral-500"
						title={endpoint}
					>
						{endpoint}
						{server.args.length > 0 && ` ${server.args.join(" ")}`}
					</div>
					{(server.env.length > 0 ||
						server.headers.length > 0 ||
						server.hasAuth) && (
						<div className="mt-1 flex flex-wrap gap-1">
							{server.env.map((kv) => (
								<span
									key={`env-${kv.key}`}
									className="rounded bg-[var(--well-bg)] px-1 py-0.2 font-mono text-[9px] text-neutral-500"
									title={kv.masked ? "密钥值已遮蔽" : undefined}
								>
									env:{kv.key}={kv.masked ? "••••" : kvValue(kv)}
								</span>
							))}
							{server.headers.map((kv) => (
								<span
									key={`h-${kv.key}`}
									className="rounded bg-[var(--well-bg)] px-1 py-0.2 font-mono text-[9px] text-neutral-500"
									title={kv.masked ? "密钥值已遮蔽" : undefined}
								>
									header:{kv.key}={kv.masked ? "••••" : kvValue(kv)}
								</span>
							))}
							{server.hasAuth && (
								<span className="rounded bg-[var(--well-bg)] px-1 py-0.2 text-[9px] text-neutral-500">
									OAuth
								</span>
							)}
						</div>
					)}
					{server.error && (
						<div className="mt-1 flex items-center gap-1 text-[10px] text-amber-300">
							<AlertTriangle className="h-3 w-3 shrink-0" />
							{server.error}
						</div>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1">
					<button
						type="button"
						disabled={busy}
						onClick={onEdit}
						title="编辑"
						className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all disabled:opacity-50"
					>
						<Pencil className="h-3 w-3" />
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={onRemove}
						title="删除"
						className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-rose-300 active:scale-95 transition-all disabled:opacity-50"
					>
						<Trash2 className="h-3 w-3" />
					</button>
					<Switch
						checked={server.enabled}
						disabled={busy || server.shadowed}
						onChange={onToggle}
					/>
				</div>
			</div>
		</div>
	);
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
	const [snap, setSnap] = useState<McpConfigSnapshot | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [draft, setDraft] = useState<ServerDraft | null>(null);

	const reload = useCallback(async () => {
		try {
			setSnap(await mcpConfigList(cwd));
			setLoadError(null);
		} catch (e) {
			setLoadError(errMsg(e));
		}
	}, [cwd]);

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

	const run = async (fn: () => Promise<unknown>, okMsg: string) => {
		if (busy) return;
		setBusy(true);
		try {
			await fn();
			toast.success(okMsg);
			await reload();
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	const saveDraft = () => {
		if (!draft) return;
		const name = draft.name.trim();
		if (!name) {
			toast.error("请填写服务器名称");
			return;
		}
		const patch = buildPatch(draft);
		const original = draft.original;
		void run(async () => {
			await mcpServerUpsert(draft.path, name, patch, cwd);
			if (original && original.name !== name) {
				await mcpServerRemove(original.sourceFile, original.name, cwd);
			}
		}, `已保存 ${name}（新会话生效）`);
		setDraft(null);
	};

	const openFile = (path: string) => {
		void openPath(path).catch((e: unknown) =>
			toast.error(`打开文件失败: ${errMsg(e)}`),
		);
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

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-sm font-semibold tracking-[-0.018em] text-neutral-100">
					MCP 服务器
				</h2>
				<p className="text-xs text-neutral-400">
					管理 OMP 读取的 mcp.json（项目 .omp/mcp.json、用户
					~/.omp/agent/mcp.json）；改动对新会话生效，密钥值在界面中遮蔽显示
				</p>
			</div>

			{loadError && (
				<div className="flex items-start gap-1.5 rounded-xl hairline bg-rose-950/20 px-3 py-2 text-[11px] text-rose-300">
					<AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
					<span className="break-all">{loadError}</span>
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
							disabled={busy}
							title="重新扫描"
							className="rounded-lg hairline bg-[var(--bg-active-fill)] p-1.5 text-neutral-300 hover:bg-[var(--bg-hover)] active:scale-95 transition-all disabled:opacity-50"
						>
							<RefreshCw className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							onClick={() =>
								setDraft(
									draftFrom(null, snap?.defaultWritePath ?? ""),
								)
							}
							className="inline-flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-[var(--bg-hover)] active:scale-95 transition-all"
						>
							<Plus className="h-3 w-3" />
							<span>添加服务器</span>
						</button>
					</div>
				</div>

				{snap && servers.length === 0 && (
					<div className="rounded-xl hairline bg-[var(--bg-panel)] p-6 text-center text-xs text-neutral-500 shadow-apple-card">
						{q ? "没有匹配的服务器" : "尚未配置 MCP 服务器"}
					</div>
				)}

				{groupedByFile.map(([file, list]) => (
					<div key={file} className="space-y-1">
						<div className="flex items-center gap-1.5 px-1">
							<span
								className="min-w-0 flex-1 truncate font-mono text-[10px] text-neutral-500"
								title={file}
							>
								{file}
							</span>
							<button
								type="button"
								onClick={() => openFile(file)}
								title="打开配置文件"
								className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-300 active:scale-95 transition-all"
							>
								<ExternalLink className="h-3 w-3" />
							</button>
						</div>
						<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card divide-y divide-[var(--border-divider)] overflow-hidden">
							{list.map((s) => (
								<ServerRow
									key={s.name}
									server={s}
									busy={busy}
									onToggle={() =>
										void run(
											() =>
												mcpServerSetEnabled(
													s.name,
													!s.enabled,
													cwd,
												),
											s.enabled
												? `已停用 ${s.name}`
												: `已启用 ${s.name}`,
										)
									}
									onEdit={() => setDraft(draftFrom(s, ""))}
									onRemove={() =>
										void run(
											() =>
												mcpServerRemove(
													s.sourceFile,
													s.name,
													cwd,
												),
											`已删除 ${s.name}`,
										)
									}
								/>
							))}
						</div>
					</div>
				))}
			</div>

			{/* Config files overview */}
			<div className="space-y-2">
				<div className="px-1 text-xs font-medium text-neutral-200">
					配置文件
				</div>
				<div className="rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card divide-y divide-[var(--border-divider)] overflow-hidden">
					{(snap?.files ?? []).map((f) => (
						<div
							key={f.path}
							className="flex items-center justify-between gap-3 px-3.5 py-2"
						>
							<div className="min-w-0">
								<div
									className="truncate font-mono text-[11px] text-neutral-300"
									title={f.path}
								>
									{f.path}
								</div>
								<div className="mt-0.5 text-[10px] text-neutral-500">
									{f.scope === "project" ? "项目级" : "用户级"}
									{f.exists ? "" : " · 不存在（添加服务器时自动创建）"}
									{f.parseError
										? ` · ${f.parseError}`
										: f.disabledServers.length +
												f.enabledServers.length >
											0
										? ` · 停用 ${f.disabledServers.length} / 白名单 ${f.enabledServers.length}`
										: ""}
								</div>
							</div>
							{f.exists && (
								<button
									type="button"
									onClick={() => openFile(f.path)}
									title="打开配置文件"
									className="shrink-0 rounded p-1 text-neutral-500 hover:bg-[var(--bg-hover)] hover:text-neutral-300 active:scale-95 transition-all"
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
					hint="MCP 连接超时与通知行为（mcp.*）"
					query={query}
				/>
			</div>

			{/* Add / edit sheet */}
			{draft && (
				<div className="rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card space-y-3">
					<div className="flex items-center justify-between">
						<div className="text-xs font-semibold text-neutral-200">
							{draft.original ? "编辑服务器" : "添加服务器"}
						</div>
						<button
							type="button"
							onClick={() => setDraft(null)}
							className="rounded p-0.5 text-neutral-500 hover:text-neutral-300 active:scale-95 transition-all"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<label className="space-y-1">
							<span className="text-[10px] text-neutral-400">名称</span>
							<input
								value={draft.name}
								onChange={(e) =>
									setDraft({ ...draft, name: e.target.value })
								}
								placeholder="my-server"
								className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
							/>
						</label>
						<label className="space-y-1">
							<span className="text-[10px] text-neutral-400">
								传输方式
							</span>
							<div className="inline-flex w-full rounded-lg hairline bg-[var(--well-bg)] p-0.5">
								{(["stdio", "http", "sse"] as const).map((t) => (
									<button
										key={t}
										type="button"
										onClick={() =>
											setDraft({ ...draft, type: t })
										}
										className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
											draft.type === t
												? "bg-[var(--bg-panel)] text-neutral-100 shadow-sm"
												: "text-neutral-400 hover:text-neutral-200"
										}`}
									>
										{t}
									</button>
								))}
							</div>
						</label>
					</div>

					{!draft.original && snap && (
						<label className="block space-y-1">
							<span className="text-[10px] text-neutral-400">
								写入文件
							</span>
							<select
								value={draft.path}
								onChange={(e) =>
									setDraft({ ...draft, path: e.target.value })
								}
								className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 text-xs text-neutral-200 outline-none"
							>
								<option value={snap.defaultWritePath}>
									用户级 — {snap.defaultWritePath}
								</option>
								{snap.files
									.filter(
										(f) =>
											f.path !== snap.defaultWritePath,
									)
									.map((f) => (
										<option key={f.path} value={f.path}>
											{f.scope === "project"
												? "项目级"
												: "用户级"}{" "}
											— {f.path}
										</option>
									))}
							</select>
						</label>
					)}

					{draft.type === "stdio" ? (
						<>
							<label className="block space-y-1">
								<span className="text-[10px] text-neutral-400">
									命令 (command)
								</span>
								<input
									value={draft.command}
									onChange={(e) =>
										setDraft({
											...draft,
											command: e.target.value,
										})
									}
									placeholder="npx"
									className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
								/>
							</label>
							<label className="block space-y-1">
								<span className="text-[10px] text-neutral-400">
									参数 (args)，每行一个
								</span>
								<textarea
									value={draft.args}
									onChange={(e) =>
										setDraft({
											...draft,
											args: e.target.value,
										})
									}
									rows={3}
									placeholder={"-y\n@modelcontextprotocol/server-filesystem"}
									className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
								/>
							</label>
						</>
					) : (
						<label className="block space-y-1">
							<span className="text-[10px] text-neutral-400">
								URL
							</span>
							<input
								value={draft.url}
								onChange={(e) =>
									setDraft({ ...draft, url: e.target.value })
								}
								placeholder="https://example.com/mcp"
								className="w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 font-mono text-xs text-neutral-200 outline-none placeholder:text-neutral-600"
							/>
						</label>
					)}

					{/* env / headers: existing entries shown masked; only adds/removes apply */}
					{draft.type === "stdio" &&
						(draft.original?.env ?? []).length +
							draft.envAdds.length >
							0 && (
							<div className="space-y-1">
								<span className="text-[10px] text-neutral-400">
									环境变量 (env)
								</span>
								<div className="space-y-1">
									{(draft.original?.env ?? []).map((kv) =>
										draft.envRemoves.has(kv.key) ? null : (
											<div
												key={kv.key}
												className="flex items-center gap-1.5"
											>
												<span className="w-40 truncate font-mono text-[11px] text-neutral-300">
													{kv.key}
												</span>
												<span
													className="flex-1 truncate font-mono text-[11px] text-neutral-500"
													title={
														kv.masked
															? "密钥值已遮蔽，修改请新增同名条目覆盖"
															: undefined
													}
												>
													{kv.masked
														? "••••••••"
														: kvValue(kv)}
												</span>
												<button
													type="button"
													onClick={() =>
														setDraft({
															...draft,
															envRemoves:
																new Set([
																	...draft.envRemoves,
																	kv.key,
																]),
														})
													}
													className="rounded p-0.5 text-neutral-500 hover:text-rose-300 active:scale-95 transition-all"
												>
													<X className="h-3 w-3" />
												</button>
											</div>
										),
									)}
									{draft.envAdds.map((kv, i) => (
										<div
											key={i}
											className="flex items-center gap-1.5"
										>
											<input
												value={kv.key}
												onChange={(e) =>
													setDraft({
														...draft,
														envAdds:
															draft.envAdds.map(
																(x, j) =>
																	j === i
																		? {
																				...x,
																				key: e
																					.target
																					.value,
																			}
																		: x,
															),
													})
												}
												placeholder="KEY"
												className="w-40 rounded hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none"
											/>
											<input
												value={kv.value}
												onChange={(e) =>
													setDraft({
														...draft,
														envAdds:
															draft.envAdds.map(
																(x, j) =>
																	j === i
																		? {
																				...x,
																				value: e
																					.target
																					.value,
																			}
																		: x,
															),
													})
												}
												placeholder="值（可用 ${VAR} 或变量名引用）"
												className="flex-1 rounded hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none"
											/>
											<button
												type="button"
												onClick={() =>
													setDraft({
														...draft,
														envAdds:
															draft.envAdds.filter(
																(_, j) => j !== i,
															),
													})
												}
												className="rounded p-0.5 text-neutral-500 hover:text-rose-300 active:scale-95 transition-all"
											>
												<X className="h-3 w-3" />
											</button>
										</div>
									))}
									<button
										type="button"
										onClick={() =>
											setDraft({
												...draft,
												envAdds: [
													...draft.envAdds,
													{ key: "", value: "" },
												],
											})
										}
										className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
									>
										<Plus className="h-2.5 w-2.5" />
										添加环境变量
									</button>
								</div>
							</div>
						)}

					{draft.type !== "stdio" &&
						(draft.original?.headers ?? []).length +
							draft.headerAdds.length >
							0 && (
							<div className="space-y-1">
								<span className="text-[10px] text-neutral-400">
									请求头 (headers)
								</span>
								<div className="space-y-1">
									{(draft.original?.headers ?? []).map((kv) =>
										draft.headerRemoves.has(kv.key) ? null : (
											<div
												key={kv.key}
												className="flex items-center gap-1.5"
											>
												<span className="w-40 truncate font-mono text-[11px] text-neutral-300">
													{kv.key}
												</span>
												<span
													className="flex-1 truncate font-mono text-[11px] text-neutral-500"
													title={
														kv.masked
															? "密钥值已遮蔽，修改请新增同名条目覆盖"
															: undefined
													}
												>
													{kv.masked
														? "••••••••"
														: kvValue(kv)}
												</span>
												<button
													type="button"
													onClick={() =>
														setDraft({
															...draft,
															headerRemoves:
																new Set([
																	...draft.headerRemoves,
																	kv.key,
																]),
														})
													}
													className="rounded p-0.5 text-neutral-500 hover:text-rose-300 active:scale-95 transition-all"
												>
													<X className="h-3 w-3" />
												</button>
											</div>
										),
									)}
									{draft.headerAdds.map((kv, i) => (
										<div
											key={i}
											className="flex items-center gap-1.5"
										>
											<input
												value={kv.key}
												onChange={(e) =>
													setDraft({
														...draft,
														headerAdds:
															draft.headerAdds.map(
																(x, j) =>
																	j === i
																		? {
																				...x,
																				key: e
																					.target
																					.value,
																			}
																		: x,
															),
													})
												}
												placeholder="Header"
												className="w-40 rounded hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none"
											/>
											<input
												value={kv.value}
												onChange={(e) =>
													setDraft({
														...draft,
														headerAdds:
															draft.headerAdds.map(
																(x, j) =>
																	j === i
																		? {
																				...x,
																				value: e
																					.target
																					.value,
																			}
																		: x,
															),
													})
												}
												placeholder="值（可用 ${VAR} 或变量名引用）"
												className="flex-1 rounded hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none"
											/>
											<button
												type="button"
												onClick={() =>
													setDraft({
														...draft,
														headerAdds:
															draft.headerAdds.filter(
																(_, j) => j !== i,
															),
													})
												}
												className="rounded p-0.5 text-neutral-500 hover:text-rose-300 active:scale-95 transition-all"
											>
												<X className="h-3 w-3" />
											</button>
										</div>
									))}
									<button
										type="button"
										onClick={() =>
											setDraft({
												...draft,
												headerAdds: [
													...draft.headerAdds,
													{ key: "", value: "" },
												],
											})
										}
										className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 active:scale-95 transition-all"
									>
										<Plus className="h-2.5 w-2.5" />
										添加请求头
									</button>
								</div>
							</div>
						)}

					<div className="flex items-center justify-between gap-3">
						<label className="flex items-center gap-2">
							<Switch
								checked={draft.instructions}
								onChange={(v) =>
									setDraft({ ...draft, instructions: v })
								}
							/>
							<span className="text-[11px] text-neutral-300">
								注入该服务器的 instructions 到系统提示
							</span>
						</label>
						<label className="flex items-center gap-2">
							<span className="text-[10px] text-neutral-400">
								超时 (ms)
							</span>
							<input
								value={draft.timeout}
								onChange={(e) =>
									setDraft({ ...draft, timeout: e.target.value })
								}
								placeholder="默认"
								className="w-24 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-[11px] text-neutral-200 outline-none"
							/>
						</label>
					</div>

					<div className="flex justify-end gap-2 pt-1">
						<button
							type="button"
							onClick={() => setDraft(null)}
							className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-all"
						>
							取消
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={saveDraft}
							className="rounded-lg bg-[#0A84FF] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
						>
							保存
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
