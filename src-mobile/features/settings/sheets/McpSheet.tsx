import { useState } from "react";
import { Plus, Edit2, ArrowLeft, Save } from "lucide-react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { toast } from "../../../ui/Toast";

interface McpServer {
	id: string;
	name: string;
	command: string;
	args: string;
	env: string;
	enabled: boolean;
}

const INITIAL_SERVERS: McpServer[] = [
	{
		id: "mcp-filesystem",
		name: "filesystem",
		command: "npx",
		args: "-y @modelcontextprotocol/server-filesystem /tmp",
		env: "",
		enabled: true,
	},
	{
		id: "mcp-postgres",
		name: "postgres",
		command: "npx",
		args: "-y @modelcontextprotocol/server-postgres postgresql://localhost/db",
		env: "DEBUG=1",
		enabled: false,
	},
];

export function McpSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [servers, setServers] = useState<McpServer[]>(INITIAL_SERVERS);
	const [editingServer, setEditingServer] = useState<McpServer | null>(null);
	const [isNew, setIsNew] = useState(false);

	const handleStartCreate = () => {
		const newServer: McpServer = {
			id: `mcp-${Date.now()}`,
			name: "",
			command: "npx",
			args: "",
			env: "",
			enabled: true,
		};
		setEditingServer(newServer);
		setIsNew(true);
	};

	const handleStartEdit = (server: McpServer) => {
		setEditingServer({ ...server });
		setIsNew(false);
	};

	const handleSave = () => {
		if (!editingServer) return;
		if (!editingServer.name.trim()) {
			toast("请填写服务器名称", { kind: "error" });
			return;
		}

		if (isNew) {
			setServers((prev) => [...prev, editingServer]);
			toast(`已添加 MCP 服务器 ${editingServer.name}`, { kind: "success" });
		} else {
			setServers((prev) => prev.map((s) => (s.id === editingServer.id ? editingServer : s)));
			toast(`MCP 服务器 ${editingServer.name} 已保存`, { kind: "success" });
		}
		setEditingServer(null);
	};

	const handleToggleEnable = (id: string, enabled: boolean) => {
		setServers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
		toast(enabled ? "已启用 MCP 服务器" : "已停用 MCP 服务器", { kind: "info" });
	};

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			fullHeight={Boolean(editingServer)}
			title={editingServer ? (isNew ? "添加 MCP 服务器" : `编辑 · ${editingServer.name}`) : "MCP 服务器"}
		>
			<div className="space-y-4 px-4 pb-8">
				{editingServer ? (
					/* Editor View (strictly no delete) */
					<div className="space-y-3.5">
						<div className="flex items-center justify-between">
							<button
								type="button"
								onClick={() => setEditingServer(null)}
								className="flex items-center gap-1 text-m-xs text-m-accent"
							>
								<ArrowLeft size={14} />
								<span>返回服务器列表</span>
							</button>

							<button
								type="button"
								onClick={handleSave}
								className="flex items-center gap-1.5 rounded-m-md bg-m-accent px-3 py-1.5 text-m-xs font-medium text-m-accent-text"
							>
								<Save size={14} />
								<span>保存配置</span>
							</button>
						</div>

						<div className="space-y-3 rounded-m-lg border border-m-border bg-m-bg-elev p-3">
							<div className="space-y-1">
								<label className="text-m-xs font-medium text-m-text-3">服务器名称</label>
								<input
									type="text"
									placeholder="如 filesystem, sqlite"
									value={editingServer.name}
									disabled={!isNew}
									onChange={(e) => setEditingServer({ ...editingServer, name: e.target.value })}
									className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text"
								/>
							</div>

							<div className="space-y-1">
								<label className="text-m-xs font-medium text-m-text-3">执行命令 (Command)</label>
								<input
									type="text"
									placeholder="如 npx, node, python"
									value={editingServer.command}
									onChange={(e) => setEditingServer({ ...editingServer, command: e.target.value })}
									className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text font-m-mono"
								/>
							</div>

							<div className="space-y-1">
								<label className="text-m-xs font-medium text-m-text-3">命令行参数 (Args)</label>
								<input
									type="text"
									placeholder="空格分隔的启动参数"
									value={editingServer.args}
									onChange={(e) => setEditingServer({ ...editingServer, args: e.target.value })}
									className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text font-m-mono"
								/>
							</div>

							<div className="space-y-1">
								<label className="text-m-xs font-medium text-m-text-3">环境变量 (Environment)</label>
								<input
									type="text"
									placeholder="KEY=VALUE （多项逗号或换行分隔）"
									value={editingServer.env}
									onChange={(e) => setEditingServer({ ...editingServer, env: e.target.value })}
									className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text font-m-mono"
								/>
							</div>
						</div>
						<p className="px-1 text-[11px] text-m-text-3">
							注：为避免移动端误触破坏工程服务配置，移动端仅支持查看、添加与编辑，不支持删除操作。
						</p>
					</div>
				) : (
					/* List View */
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<p className="text-m-xs text-m-text-3">
								通过模型上下文协议 (MCP) 挂载外部工具与数据源。
							</p>
							<button
								type="button"
								onClick={handleStartCreate}
								className="flex items-center gap-1 shrink-0 rounded-m-md bg-m-accent px-3 py-1.5 text-m-xs font-medium text-m-accent-text"
							>
								<Plus size={14} />
								<span>添加服务器</span>
							</button>
						</div>

						<div className="rounded-m-lg border border-m-border bg-m-bg-elev divide-y divide-m-border">
							{servers.map((server) => (
								<div key={server.id} className="flex items-center justify-between p-3">
									<div className="min-w-0 pr-3">
										<div className="flex items-center gap-2">
											<span className="font-m-mono text-m-sm font-semibold text-m-text">
												{server.name}
											</span>
											<span
												className={`rounded-m-pill px-1.5 py-0.2 text-[10px] ${
													server.enabled
														? "bg-m-success/10 text-m-success"
														: "bg-m-surface-2 text-m-text-3"
												}`}
											>
												{server.enabled ? "已启用" : "已停用"}
											</span>
										</div>
										<p className="mt-0.5 truncate font-m-mono text-[11px] text-m-text-3">
											{server.command} {server.args}
										</p>
									</div>

									<div className="flex items-center gap-2 shrink-0">
										<button
											type="button"
											onClick={() => handleToggleEnable(server.id, !server.enabled)}
											className="rounded-m-md border border-m-border px-2 py-1 text-m-xs text-m-text"
										>
											{server.enabled ? "停用" : "启用"}
										</button>
										<button
											type="button"
											aria-label={`编辑 ${server.name}`}
											onClick={() => handleStartEdit(server)}
											className="flex h-8 w-8 items-center justify-center rounded-m-md bg-m-surface text-m-text-2 active:bg-m-surface-hover"
										>
											<Edit2 size={14} />
										</button>
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		</BottomSheet>
	);
}
