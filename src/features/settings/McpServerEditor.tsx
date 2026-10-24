/**
 * Add / edit dialog for one MCP server. Existing env/header values are never shown (only
 * key names); typing a value for a key overwrites it. Placement is chosen with the shared
 * scope picker; on edit it is only sent when changed.
 */

import { useT } from "../../stores/language";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { useMemo, useState, type ClipboardEvent } from "react";
import { Modal } from "../../components/Modal";
import { Segmented } from "../../components/Segmented";
import type { McpKv, McpScope, McpServerPatch, McpServerView } from "../../lib/contracts";
import { McpScopePicker, type PickerProject } from "./McpScopePicker";
import {
	buildPatch,
	draftFrom,
	splitCommandLine,
	splitDraftCommand,
	TRANSPORT_LABELS,
	validateDraft,
	type KvRow,
	type ServerDraft,
} from "./mcpDraft";
import {
	defaultAddScope,
	hasMaskedSecrets,
	prefillScope,
	sameScope,
	scopeError,
} from "./mcpProjects";
import { Button, IconButton } from "./ui";
import { Switch } from "./Switch";

export const FIELD_CLASS =
	"w-full rounded-lg hairline bg-[var(--well-bg)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-dim)] focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]";
const LABEL_CLASS = "text-[11px] text-[var(--text-muted)]";

function FieldError({ msg }: { msg?: string }) {
	return msg ? <div className="text-[11px] text-[var(--status-error)]">{msg}</div> : null;
}

/** Key/value editor for env vars or headers (existing values stay hidden). */
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
	const { t } = useT();
	const kept = existing.filter((kv) => !removed.has(kv.key));
	return (
		<div className="space-y-1">
			<div className={LABEL_CLASS}>{label}</div>
			<div className="text-[11px] text-[var(--text-dim)]">{hint}</div>
			<div className="space-y-1">
				{kept.map((kv) => (
					<div key={kv.key} className="flex items-center gap-1.5">
						<span className="w-40 shrink-0 break-all font-mono text-xs text-[var(--text)]">{kv.key}</span>
						<span className="flex-1 text-xs text-[var(--text-dim)]">{t("mcp.valueHidden")}</span>
						<IconButton
							icon={X}
							label={t("mcp.deleteKvAria", { key: kv.key })}
							title={t("mcp.deleteThisItem")}
							size="sm"
							onClick={() => onRemoveExisting(kv.key)}
						/>
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
							aria-label={t("mcp.kvNameAria")}
							className="w-40 shrink-0 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none"
						/>
						<input
							type="password"
							autoComplete="off"
							value={kv.value}
							onChange={(e) =>
								onChangeAdds(adds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
							}
							placeholder={t("mcp.kvValuePlaceholder")}
							aria-label={t("mcp.kvValueAria")}
							className="min-w-0 flex-1 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none"
						/>
						<IconButton
							icon={X}
							label={t("mcp.removeThisRow")}
							size="sm"
							onClick={() => onChangeAdds(adds.filter((_, j) => j !== i))}
						/>
					</div>
				))}
				<Button
					size="sm"
					variant="ghost"
					icon={Plus}
					onClick={() => onChangeAdds([...adds, { key: "", value: "" }])}
				>
					{addLabel}
				</Button>
				<FieldError msg={error} />
			</div>
		</div>
	);
}

export function McpServerEditor({
	original,
	projects,
	current,
	existingNames,
	onSubmit,
	onClose,
}: {
	/** Server being edited; null when adding. */
	original: McpServerView | null;
	projects: PickerProject[];
	current: string | null;
	/** Every server name in the catalog. */
	existingNames: string[];
	/** Resolves to an error message to show in the dialog, or null on success (parent closes it). */
	onSubmit: (name: string, patch: McpServerPatch, scope: McpScope | null) => Promise<string | null>;
	onClose: () => void;
}) {
	const { t } = useT();
	const paths = useMemo(() => projects.map((p) => p.path), [projects]);
	const [draft, setDraft] = useState<ServerDraft>(() => draftFrom(original?.definition ?? null));
	const [initialScope] = useState<McpScope>(() =>
		original ? prefillScope(original, paths, current) : defaultAddScope(paths, current),
	);
	const [scope, setScope] = useState<McpScope>(initialScope);
	const [showErrors, setShowErrors] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [splitNote, setSplitNote] = useState(false);
	const [moreOpen, setMoreOpen] = useState(
		() => original?.definition.timeoutMs != null || original?.definition.instructions === false,
	);

	const errors = useMemo(() => validateDraft(draft, existingNames), [draft, existingNames]);
	const visible = showErrors ? errors : {};
	const scopeInvalid = scopeError(scope) !== null;
	const secrets = original ? hasMaskedSecrets(original.definition) : false;
	const adding = !original;

	const applySplit = (d: ServerDraft): ServerDraft | null => {
		const next = splitDraftCommand(d);
		if (next) setSplitNote(true);
		return next;
	};

	const onCommandPaste = (e: ClipboardEvent<HTMLInputElement>) => {
		const text = e.clipboardData.getData("text");
		const el = e.currentTarget;
		const replacesAll = el.selectionStart === 0 && el.selectionEnd === el.value.length;
		if (!(replacesAll || draft.command.trim() === "") || draft.args.trim() !== "") return;
		const tokens = splitCommandLine(text.trim());
		if (tokens.length < 2) return;
		e.preventDefault();
		setSplitNote(true);
		setDraft({ ...draft, command: tokens[0]!, args: tokens.slice(1).join("\n") });
	};

	const save = async () => {
		if (saving) return;
		const d = splitDraftCommand(draft) ?? draft;
		if (d !== draft) {
			setDraft(d);
			setSplitNote(true);
		}
		const errs = validateDraft(d, existingNames);
		if (Object.keys(errs).length > 0 || scopeInvalid) {
			setShowErrors(true);
			return;
		}
		setSaving(true);
		setError(null);
		const message = await onSubmit(
			d.name.trim(),
			buildPatch(d),
			adding || !sameScope(scope, initialScope) ? scope : null,
		);
		setSaving(false);
		if (message) setError(message);
	};

	return (
		<Modal
			title={original ? t("mcp.editTitle", { name: original.name }) : t("mcp.addTitle")}
			size="xl"
			closeOnBackdrop={false}
			onClose={onClose}
		>
			<div
				className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
						e.preventDefault();
						void save();
					}
				}}
			>
				<div className="grid grid-cols-2 gap-2">
					<label className="space-y-1">
						<span className={LABEL_CLASS}>{t("mcp.nameLabel")}</span>
						<input
							autoFocus
							value={draft.name}
							onChange={(e) => setDraft({ ...draft, name: e.target.value })}
							placeholder={t("mcp.namePlaceholder")}
							className={FIELD_CLASS}
						/>
						<FieldError msg={visible.name} />
					</label>
					<div className="space-y-1">
						<span className={LABEL_CLASS}>{t("mcp.transportLabel")}</span>
						<div>
							<Segmented
								aria-label={t("mcp.transportLabel")}
								options={(["stdio", "http", "sse"] as const).map((transportType) => ({
									value: transportType,
									label: TRANSPORT_LABELS[transportType],
									title:
										transportType === "stdio"
											? t("mcp.transportStdioTitle")
											: transportType === "http"
												? t("mcp.transportHttpTitle")
												: t("mcp.transportSseTitle"),
								}))}
								value={draft.type}
								onChange={(transportType) => setDraft({ ...draft, type: transportType })}
							/>
						</div>
					</div>
				</div>

				{draft.type === "stdio" ? (
					<>
						<label className="block space-y-1">
							<span className={LABEL_CLASS}>{t("mcp.commandLabel")}</span>
							<input
								value={draft.command}
								onChange={(e) => setDraft({ ...draft, command: e.target.value })}
								onPaste={onCommandPaste}
								onBlur={() => {
									const next = applySplit(draft);
									if (next) setDraft(next);
								}}
								placeholder={t("mcp.commandPlaceholder")}
								className={`${FIELD_CLASS} font-mono`}
							/>
							{splitNote && (
								<div className="text-[11px] text-[var(--text-dim)]">
									{t("mcp.splitNote")}
								</div>
							)}
							<FieldError msg={visible.command} />
						</label>
						<label className="block space-y-1">
							<span className={LABEL_CLASS}>{t("mcp.argsLabel")}</span>
							<textarea
								value={draft.args}
								onChange={(e) => setDraft({ ...draft, args: e.target.value })}
								rows={3}
								placeholder={t("mcp.argsPlaceholder")}
								className={`${FIELD_CLASS} font-mono`}
							/>
						</label>
						<label className="block space-y-1">
							<span className={LABEL_CLASS}>{t("mcp.cwdLabel")}</span>
							<input
								value={draft.cwd}
								onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
								placeholder={t("mcp.cwdPlaceholder")}
								className={`${FIELD_CLASS} font-mono`}
							/>
						</label>
						<KvEditor
							label={t("mcp.envLabel")}
							hint={t("mcp.envHint")}
							existing={draft.original?.env ?? []}
							removed={draft.envRemoves}
							adds={draft.envAdds}
							error={visible.env}
							keyPlaceholder="API_KEY"
							addLabel={t("mcp.addEnv")}
							onRemoveExisting={(k) =>
								setDraft({ ...draft, envRemoves: new Set([...draft.envRemoves, k]) })
							}
							onChangeAdds={(rows) => setDraft({ ...draft, envAdds: rows })}
						/>
					</>
				) : (
					<>
						<label className="block space-y-1">
							<span className={LABEL_CLASS}>{t("mcp.urlLabel")}</span>
							<input
								value={draft.url}
								onChange={(e) => setDraft({ ...draft, url: e.target.value })}
								placeholder="https://example.com/mcp"
								className={`${FIELD_CLASS} font-mono`}
							/>
							<FieldError msg={visible.url} />
						</label>
						<KvEditor
							label={t("mcp.headersLabel")}
							hint={t("mcp.headersHint")}
							existing={draft.original?.headers ?? []}
							removed={draft.headerRemoves}
							adds={draft.headerAdds}
							error={visible.headers}
							keyPlaceholder="Authorization"
							addLabel={t("mcp.addHeader")}
							onRemoveExisting={(k) =>
								setDraft({ ...draft, headerRemoves: new Set([...draft.headerRemoves, k]) })
							}
							onChangeAdds={(rows) => setDraft({ ...draft, headerAdds: rows })}
						/>
					</>
				)}

				<div className="space-y-1.5">
					<div className="text-[13px] font-medium text-[var(--text)]">{t("mcp.whichProjects")}</div>
					<McpScopePicker
						projects={projects}
						current={current}
						value={scope}
						onChange={setScope}
						copiesHaveSecrets={
							secrets ||
							draft.envAdds.some((r) => r.key.trim() && r.value) ||
							draft.headerAdds.some((r) => r.key.trim() && r.value)
						}
					/>
				</div>

				<div>
					<button
						type="button"
						aria-expanded={moreOpen}
						onClick={() => setMoreOpen(!moreOpen)}
						className="flex items-center gap-1 whitespace-nowrap text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
					>
						{moreOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
						{t("mcp.moreOptions")}
					</button>
					{moreOpen && (
						<div className="mt-2 flex flex-wrap items-start justify-between gap-3">
							<label className="flex items-center gap-2">
								<Switch
									checked={draft.instructions}
									onChange={(v) => setDraft({ ...draft, instructions: v })}
								/>
								<span className="text-xs text-[var(--text)]" title={t("mcp.instructionsTitle")}>
									{t("mcp.instructionsLabel")}
								</span>
							</label>
							<label className="space-y-1">
								<span className="flex items-center gap-2">
									<span className={`${LABEL_CLASS} whitespace-nowrap`}>{t("mcp.timeoutLabel")}</span>
									<input
										inputMode="numeric"
										value={draft.timeout}
										onChange={(e) => setDraft({ ...draft, timeout: e.target.value })}
										placeholder={t("mcp.timeoutPlaceholder")}
										className="w-24 rounded-lg hairline bg-[var(--well-bg)] px-2 py-1 font-mono text-xs text-[var(--text)] outline-none"
									/>
								</span>
								<FieldError msg={visible.timeout} />
							</label>
						</div>
					)}
				</div>

				{error && (
					<div
						role="alert"
						className="select-text whitespace-pre-wrap break-all rounded-lg bg-[color-mix(in_srgb,var(--status-error)_9%,transparent)] px-3 py-2 text-xs text-[var(--status-error)]"
					>
						{error}
					</div>
				)}
			</div>
			<div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-divider)] px-4 py-3">
				<span className="text-[11px] text-[var(--text-dim)]">{t("mcp.saveShortcutHint")}</span>
				<div className="flex gap-2">
					<Button variant="ghost" onClick={onClose}>
						{t("common.cancel")}
					</Button>
					<Button variant="primary" loading={saving} disabled={scopeInvalid} onClick={() => void save()}>
						{t("common.save")}
					</Button>
				</div>
			</div>
		</Modal>
	);
}
