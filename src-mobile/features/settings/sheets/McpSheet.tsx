import { Plus, Server } from "lucide-react";
import { useState } from "react";
import { Button, Chip, Field, inputCls, ListGroup, ListRow, Switch, TextField, toast } from "../../../ui";
import { SettingRow, SettingsSheet } from "../rows";

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

const ICON = { size: 22, strokeWidth: 1.75 } as const;
const MONO_INPUT = "font-m-mono";

/** MCP servers: view, add and edit. Deleting is desktop-only on purpose. */
export function McpSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [servers, setServers] = useState<McpServer[]>(INITIAL_SERVERS);
	// The draft stays set while the editor sheet animates out, so its title does not flash.
	const [draft, setDraft] = useState<McpServer | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [isNew, setIsNew] = useState(false);
	const [nameError, setNameError] = useState<string | null>(null);

	const openEditor = (server: McpServer, fresh: boolean) => {
		setDraft(server);
		setIsNew(fresh);
		setNameError(null);
		setEditorOpen(true);
	};

	const patch = (p: Partial<McpServer>) => setDraft((d) => (d ? { ...d, ...p } : d));

	const save = () => {
		if (!draft) return;
		const name = draft.name.trim();
		if (!name) {
			setNameError("请填写服务器名称");
			return;
		}
		const next = { ...draft, name };
		if (isNew) {
			setServers((prev) => [...prev, next]);
			toast(`已添加 MCP 服务器 ${name}`, { kind: "success" });
		} else {
			setServers((prev) => prev.map((s) => (s.id === next.id ? next : s)));
			toast(`MCP 服务器 ${name} 已保存`, { kind: "success" });
		}
		setEditorOpen(false);
	};

	return (
		<SettingsSheet open={open} onClose={onClose} title="MCP 服务器" subtitle="通过模型上下文协议（MCP）给智能体接入外部工具和数据。">
			<ListGroup>
				<ListRow
					icon={<Plus {...ICON} />}
					title={<span className="text-m-accent">添加服务器</span>}
					onClick={() => openEditor({ id: `mcp-${Date.now()}`, name: "", command: "npx", args: "", env: "", enabled: true }, true)}
					chevron={false}
				/>
			</ListGroup>

			<ListGroup title="已配置" note="为防止误触，手机上只能查看、添加和编辑，删除请在电脑上操作。">
				{servers.map((s) => (
					<ListRow
						key={s.id}
						icon={<Server {...ICON} />}
						title={<span className="font-m-mono break-all">{s.name}</span>}
						subtitle={<span className="font-m-mono break-all">{`${s.command} ${s.args}`.trim()}</span>}
						right={<Chip tone={s.enabled ? "success" : "neutral"}>{s.enabled ? "已启用" : "已停用"}</Chip>}
						chevron
						onClick={() => openEditor({ ...s }, false)}
					/>
				))}
			</ListGroup>

			<SettingsSheet
				open={editorOpen && draft != null}
				onClose={() => setEditorOpen(false)}
				title={isNew ? "添加 MCP 服务器" : `编辑 ${draft?.name ?? ""}`}
				footer={
					<div className="flex gap-3">
						<Button variant="tonal" block className="flex-1" onClick={() => setEditorOpen(false)}>
							取消
						</Button>
						<Button variant="primary" block className="flex-1" onClick={save}>
							{isNew ? "添加" : "保存"}
						</Button>
					</div>
				}
			>
				{draft && (
					<>
						<ListGroup>
							<SettingRow name="启用" hint="停用后新会话不再加载这个服务器">
								<Switch label="启用" checked={draft.enabled} onChange={(enabled) => patch({ enabled })} />
							</SettingRow>
						</ListGroup>

						<div className="flex flex-col gap-4 px-5 pt-4">
							<Field label="名称" hint={isNew ? undefined : "名称创建后不能修改"} error={nameError}>
								<TextField
									value={draft.name}
									disabled={!isNew}
									placeholder="例如 filesystem"
									autoCapitalize="off"
									spellCheck={false}
									onChange={(e) => {
										patch({ name: e.target.value });
										setNameError(null);
									}}
									className={MONO_INPUT}
								/>
							</Field>
							<Field label="启动命令">
								<TextField
									value={draft.command}
									placeholder="例如 npx、node、python"
									autoCapitalize="off"
									spellCheck={false}
									onChange={(e) => patch({ command: e.target.value })}
									className={MONO_INPUT}
								/>
							</Field>
							<Field label="命令参数" hint="用空格分隔">
								<textarea
									value={draft.args}
									rows={3}
									placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
									autoCapitalize="off"
									spellCheck={false}
									onChange={(e) => patch({ args: e.target.value })}
									className={`${inputCls} m-selectable block resize-none ${MONO_INPUT}`}
								/>
							</Field>
							<Field label="环境变量" hint="每行一个，格式 KEY=VALUE">
								<textarea
									value={draft.env}
									rows={3}
									placeholder="DEBUG=1"
									autoCapitalize="off"
									spellCheck={false}
									onChange={(e) => patch({ env: e.target.value })}
									className={`${inputCls} m-selectable block resize-none ${MONO_INPUT}`}
								/>
							</Field>
						</div>
					</>
				)}
			</SettingsSheet>
		</SettingsSheet>
	);
}
