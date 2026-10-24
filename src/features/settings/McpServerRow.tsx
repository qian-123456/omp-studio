/** One MCP server row: identity, status chips, endpoint, placement ("用在：") and actions. */

import { Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { McpServerView } from "../../lib/contracts";
import { projectName, transportLabel } from "./mcpDraft";
import { Chip, IconButton } from "./ui";
import { Switch } from "./Switch";

const PILL_CLASS =
	"whitespace-nowrap rounded-full hairline px-2.5 py-1 text-[11px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50";

export function serverEndpoint(view: McpServerView): string {
	const d = view.definition;
	const base = d.command ?? d.url ?? "未填写命令或地址";
	return d.args.length > 0 ? `${base} ${d.args.join(" ")}` : base;
}

export function McpServerRow({
	view,
	projectNames,
	current,
	busy,
	onToggle,
	onEdit,
	onDelete,
	onPickProjects,
	onAddToCurrent,
}: {
	view: McpServerView;
	/** project path → display name */
	projectNames: ReadonlyMap<string, string>;
	current: string | null;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onEdit: () => void;
	onDelete: () => void;
	onPickProjects: () => void;
	onAddToCurrent: () => void;
}) {
	const d = view.definition;
	const nameOf = (p: string) => projectNames.get(p) ?? projectName(p);
	const custom = new Set(view.customProjects);
	const on = view.mode !== "off" && !view.denylisted;
	const keys = (list: { key: string }[]) => list.map((kv) => kv.key).join("、");

	const projectChip = (p: string) => (
		<Chip
			key={p}
			tone={p === current ? "accent" : "neutral"}
			title={custom.has(p) ? "这个项目里的配置和其他地方不同" : p}
		>
			{nameOf(p)}
			{custom.has(p) && <span className="opacity-70">· 单独配置</span>}
		</Chip>
	);

	let placement: ReactNode;
	if (view.mode === "all") {
		placement = (
			<>
				<Chip tone="accent" title="包括以后新加的项目">
					所有项目
				</Chip>
				{view.excludedProjects.length > 0 && (
					<>
						<span className="whitespace-nowrap text-[11px] text-[var(--text-dim)]">除了</span>
						{view.excludedProjects.map(projectChip)}
					</>
				)}
			</>
		);
	} else if (view.mode === "projects") {
		placement = view.activeProjects.map(projectChip);
	} else {
		placement = (
			<>
				<Chip>暂未使用</Chip>
				{view.copyProjects.length > 0 && (
					<span className="text-[11px] text-[var(--text-dim)]">
						之前用在：{view.copyProjects.map(nameOf).join("、")}
					</span>
				)}
			</>
		);
	}

	const canAddToCurrent = current !== null && !view.activeProjects.includes(current);

	return (
		<div
			data-mcp-server={view.name}
			className="flex items-start justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-[var(--bg-hover)]"
		>
			<div className="min-w-0 flex-1 space-y-1">
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="break-all text-[13px] font-medium text-[var(--text)]">{view.name}</span>
					<Chip
						title={
							d.transport === "stdio"
								? "在本机启动一个程序作为工具服务"
								: "连接到一个远程网址提供的工具服务"
						}
					>
						{transportLabel(d.transport)}
					</Chip>
					{view.mode === "off" && <Chip tone="warning">已停用</Chip>}
					{view.denylisted && (
						<Chip tone="warning" title="打开右侧开关会把它从停用列表里移除">
							被停用列表屏蔽
						</Chip>
					)}
					{d.error && <Chip tone="danger">配置有误</Chip>}
				</div>
				<div className="break-all font-mono text-xs text-[var(--text-dim)]">{serverEndpoint(view)}</div>
				{(d.env.length > 0 || d.headers.length > 0 || d.hasAuth || d.hasOauth) && (
					<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--text-dim)]">
						{d.env.length > 0 && <span title="值不在界面中显示">环境变量：{keys(d.env)}</span>}
						{d.headers.length > 0 && <span title="值不在界面中显示">请求头：{keys(d.headers)}</span>}
						{(d.hasAuth || d.hasOauth) && <span>使用 OAuth 登录</span>}
					</div>
				)}
				{d.error && (
					<div className="select-text whitespace-pre-wrap break-all text-xs text-[var(--status-error)]">
						{d.error}
					</div>
				)}
				<div className="flex flex-wrap items-center gap-1.5 pt-0.5" data-testid="mcp-placement">
					<span className="whitespace-nowrap text-[11px] text-[var(--text-muted)]">用在：</span>
					{placement}
				</div>
				<div className="flex flex-wrap items-center gap-1.5 pt-1">
					<button type="button" className={PILL_CLASS} disabled={busy} onClick={onPickProjects}>
						选择项目
					</button>
					{canAddToCurrent && (
						<button type="button" className={PILL_CLASS} disabled={busy} onClick={onAddToCurrent}>
							加到当前项目
						</button>
					)}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-0.5">
				<IconButton icon={Pencil} label={`编辑 ${view.name}`} title="编辑" disabled={busy} onClick={onEdit} />
				<IconButton
					icon={Trash2}
					variant="danger"
					label={`删除 ${view.name}`}
					title="删除"
					disabled={busy}
					onClick={onDelete}
				/>
				<span
					className="ml-2"
					title={
						on
							? "已启用，点击暂停。暂停后会记住选好的项目，再打开即可恢复"
							: view.denylisted
								? "被停用列表屏蔽，点击打开会把它从停用列表里移除"
								: "已暂停，点击恢复使用，会沿用之前选好的项目"
					}
				>
					<Switch
						checked={on}
						disabled={busy}
						ariaLabel={`启用 ${view.name}`}
						onChange={() => onToggle(!on)}
					/>
				</span>
			</div>
		</div>
	);
}
