/** 「导入配置」 dialog: paste an MCP config from another tool, preview it, save each server. */

import { useT } from "../../stores/language";
import { useMemo, useRef, useState } from "react";
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
	onImport,
	onClose,
}: {
	projects: PickerProject[];
	current: string | null;
	/** Every server name in the catalog. */
	existingNames: string[];
	/** The parent owns the entire batch, including the final catalog reload. Returns errors by server name. */
	onImport: (entries: { name: string; entry: ImportEntry }[], scope: McpScope) => Promise<Map<string, string>>;
	onClose: () => void;
}) {
	const { t } = useT();
	const [text, setText] = useState("");
	const [singleName, setSingleName] = useState("");
	const [scope, setScope] = useState<McpScope>(() =>
		defaultAddScope(
			projects.map((p) => p.path),
			current,
		),
	);
	const [running, setRunning] = useState(false);
	const runningRef = useRef(false);
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
				? t("mcp.fillNameAboveFirst")
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
		if (runningRef.current || pending.length === 0 || invalid) return;
		runningRef.current = true;
		setRunning(true);
		try {
			const nextFailed = await onImport(pending, scope);
			const nextDone = new Set(done);
			for (const r of pending) if (!nextFailed.has(r.name)) nextDone.add(r.name);
			setDone(nextDone);
			setFailed(nextFailed);
			if (nextFailed.size === 0) onClose();
		} finally {
			runningRef.current = false;
			setRunning(false);
		}
	};

	return (
		<Modal title={t("mcp.importMcpConfig")} size="xl" closeOnBackdrop={false} onClose={onClose}>
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
				<label className="block space-y-1">
					<span className="text-[11px] text-[var(--text-muted)]">{t("mcp.pastePlaceholder")}</span>
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
						{t("mcp.importHelper")}
					</span>
				</label>

				{parsed.kind === "error" && text.trim() && (
					<div role="alert" className="select-text break-all text-xs text-[var(--status-error)]">
						{parsed.message}
					</div>
				)}

				{parsed.kind === "single" && (
					<label className="block space-y-1">
						<span className="text-[11px] text-[var(--text-muted)]">{t("mcp.singleNameLabel")}</span>
						<input
							value={singleName}
							onChange={(e) => setSingleName(e.target.value)}
							placeholder={t("mcp.singleNamePlaceholder")}
							className={FIELD_CLASS}
						/>
						{singleName.trim() && !NAME_RE.test(singleName.trim()) && (
							<span className="block text-[11px] text-[var(--status-error)]">{t("mcp.nameInvalid")}</span>
						)}
					</label>
				)}

				{rows.length > 0 && (
					<div className="rounded-xl hairline" aria-label={t("mcp.previewTitle")}>
						{rows.map((r, i) => (
							<div
								key={r.name || `unnamed-${i}`}
								data-import-row={r.name}
								className="space-y-1 border-b border-[var(--border-divider)] px-3 py-2 last:border-b-0"
							>
								<div className="flex flex-wrap items-center gap-1.5">
									<span className="break-all text-[13px] font-medium text-[var(--text)]">
										{r.name || t("mcp.unnamed")}
									</span>
									<Chip>{r.transport}</Chip>
									{done.has(r.name) && <Chip tone="success">{t("mcp.importedBadge")}</Chip>}
									{r.skip && <Chip tone="warning">{t("mcp.willSkip", { reason: r.skip })}</Chip>}
								</div>
								{r.endpoint && (
									<div className="break-all font-mono text-xs text-[var(--text-dim)]">{r.endpoint}</div>
								)}
								{failed.has(r.name) && (
									<div className="select-text whitespace-pre-wrap break-all text-xs text-[var(--status-error)]">
										{t("mcp.importFailed", { error: failed.get(r.name) ?? "" })}
									</div>
								)}
							</div>
						))}
					</div>
				)}

				{rows.length > 0 && (
					<div className="space-y-1.5">
						<div className="text-[13px] font-medium text-[var(--text)]">{t("mcp.whichProjects")}</div>
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
				<span className="text-[11px] text-[var(--text-dim)]">{t("mcp.takesEffectNewSessions")}</span>
				<div className="flex gap-2">
					<Button variant="ghost" onClick={onClose}>
						{t("common.close")}
					</Button>
					<Button
						variant="primary"
						loading={running}
						disabled={pending.length === 0 || invalid}
						onClick={() => void run()}
					>
						{t("mcp.importCount", { count: pending.length })}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
