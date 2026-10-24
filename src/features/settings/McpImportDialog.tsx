/** 「导入配置」 dialog: paste an MCP config from another tool, preview it, save each server. */

import { useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import type { McpScope } from "../../lib/contracts";
import { McpScopePicker, type PickerProject } from "./McpScopePicker";
import { NAME_RE } from "./mcpDraft";
import { describeEntry, importSkipReason, parseMcpImport, type ImportEntry } from "./mcpImport";
import { defaultAddScope, scopeError } from "./mcpProjects";
import { Button, Chip } from "./ui";
import { FIELD_CLASS } from "./McpServerEditor";

export function McpImportDialog({
	projects,
	current,
	existingNames,
	onImportOne,
	onFinished,
	onClose,
}: {
	projects: PickerProject[];
	current: string | null;
	/** Every server name in the catalog. */
	existingNames: string[];
	/** Save one server; resolves to an error message or null. Must not reload the catalog. */
	onImportOne: (name: string, entry: ImportEntry, scope: McpScope) => Promise<string | null>;
	/** Called once after a run with the number of servers imported (reloads + toasts). */
	onFinished: (imported: number) => void;
	onClose: () => void;
}) {
	const [text, setText] = useState("");
	const [singleName, setSingleName] = useState("");
	const [scope, setScope] = useState<McpScope>(() =>
		defaultAddScope(
			projects.map((p) => p.path),
			current,
		),
	);
	const [running, setRunning] = useState(false);
	const [done, setDone] = useState<Set<string>>(() => new Set());
	const [failed, setFailed] = useState<Map<string, string>>(() => new Map());

	const parsed = useMemo(() => parseMcpImport(text), [text]);
	const entries = useMemo(() => {
		if (parsed.kind === "servers") return parsed.servers;
		if (parsed.kind === "single") return [{ name: singleName.trim(), entry: parsed.entry }];
		return [];
	}, [parsed, singleName]);

	const rows = entries.map((e) => ({
		...e,
		...describeEntry(e.entry),
		skip: done.has(e.name)
			? null
			: parsed.kind === "single" && !e.name
				? "请先在上面填写名称"
				: importSkipReason(e.name, e.entry, existingNames),
	}));
	const pending = rows.filter((r) => !done.has(r.name) && !r.skip);
	const hasSecrets = entries.some(
		(e) =>
			(e.entry.env && typeof e.entry.env === "object" && Object.keys(e.entry.env).length > 0) ||
			(e.entry.headers && typeof e.entry.headers === "object" && Object.keys(e.entry.headers).length > 0),
	);
	const invalid = scopeError(scope) !== null;

	const run = async () => {
		setRunning(true);
		const nextDone = new Set(done);
		const nextFailed = new Map<string, string>();
		let ok = 0;
		for (const r of pending) {
			const err = await onImportOne(r.name, r.entry, scope);
			if (err) nextFailed.set(r.name, err);
			else {
				nextDone.add(r.name);
				ok++;
			}
		}
		setDone(nextDone);
		setFailed(nextFailed);
		setRunning(false);
		onFinished(ok);
		if (nextFailed.size === 0 && ok > 0) onClose();
	};

	return (
		<Modal title="导入 MCP 配置" size="xl" closeOnBackdrop={false} onClose={onClose}>
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
				<label className="block space-y-1">
					<span className="text-[11px] text-[var(--text-muted)]">把 MCP 配置粘贴到这里</span>
					<textarea
						autoFocus
						value={text}
						onChange={(e) => {
							setText(e.target.value);
							setFailed(new Map());
						}}
						rows={8}
						spellCheck={false}
						placeholder={'{\n  "mcpServers": {\n    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"] }\n  }\n}'}
						className={`${FIELD_CLASS} font-mono`}
					/>
					<span className="block text-[11px] text-[var(--text-dim)]">
						支持 Claude / Cursor / VS Code 等工具的 MCP 配置，允许带注释和多余的逗号。
					</span>
				</label>

				{parsed.kind === "error" && text.trim() && (
					<div role="alert" className="select-text break-all text-xs text-[var(--status-error)]">
						{parsed.message}
					</div>
				)}

				{parsed.kind === "single" && (
					<label className="block space-y-1">
						<span className="text-[11px] text-[var(--text-muted)]">这是一个服务器的配置，给它起个名字</span>
						<input
							value={singleName}
							onChange={(e) => setSingleName(e.target.value)}
							placeholder="例如 filesystem"
							className={FIELD_CLASS}
						/>
						{singleName.trim() && !NAME_RE.test(singleName.trim()) && (
							<span className="block text-[11px] text-[var(--status-error)]">名称只能包含字母、数字、- _ .</span>
						)}
					</label>
				)}

				{rows.length > 0 && (
					<div className="rounded-xl hairline" aria-label="导入预览">
						{rows.map((r) => (
							<div
								key={r.name || "(未命名)"}
								data-import-row={r.name}
								className="space-y-1 border-b border-[var(--border-divider)] px-3 py-2 last:border-b-0"
							>
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="break-all text-[13px] font-medium text-[var(--text)]">
										{r.name || "（未命名）"}
									</span>
									<Chip>{r.transport}</Chip>
									{done.has(r.name) && <Chip tone="success">已导入</Chip>}
									{r.skip && <Chip tone="warning">将跳过：{r.skip}</Chip>}
								</div>
								{r.endpoint && (
									<div className="break-all font-mono text-xs text-[var(--text-dim)]">{r.endpoint}</div>
								)}
								{failed.has(r.name) && (
									<div className="select-text whitespace-pre-wrap break-all text-xs text-[var(--status-error)]">
										导入失败：{failed.get(r.name)}
									</div>
								)}
							</div>
						))}
					</div>
				)}

				{rows.length > 0 && (
					<div className="space-y-1.5">
						<div className="text-[13px] font-medium text-[var(--text)]">用在哪些项目</div>
						<McpScopePicker
							projects={projects}
							current={current}
							value={scope}
							onChange={setScope}
							copiesHaveSecrets={hasSecrets}
						/>
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-divider)] px-4 py-3">
				<span className="text-[11px] text-[var(--text-dim)]">导入后对新开的会话生效</span>
				<div className="flex gap-2">
					<Button variant="ghost" onClick={onClose}>
						关闭
					</Button>
					<Button
						variant="primary"
						loading={running}
						disabled={pending.length === 0 || invalid}
						onClick={() => void run()}
					>
						{`导入 ${pending.length} 个`}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
