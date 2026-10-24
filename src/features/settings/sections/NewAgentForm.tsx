/**
 * Settings ▸ 子代理 ▸ 「新建子代理」 form. Collects everything an agent file needs — name, when to
 * dispatch it (description), its own prompt, tools and model — and writes `agents/<name>.md`, so
 * the main agent can dispatch it through the task tool like the built-in `task` / `scout`.
 * 「让 AI 帮我写」 instead opens a new session whose draft carries what is filled in so far.
 */

import clsx from "clsx";
import { Check, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ModelSelect } from "../../../components/ModelSelect";
import { parseSelection } from "../../../components/modelSelectLogic";
import { NativeSelect } from "../../../components/NativeSelect";
import { createSession } from "../../../lib/createSession";
import { errMsg } from "../../../lib/dialogs";
import { ompAgentWrite } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { useComposer } from "../../../stores/composer";
import { useModelCatalog, useModelOptions } from "../../../stores/modelCatalog";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import { useT } from "../../../stores/language";
import { describeFileCommandError } from "../fileEditorLogic";
import { asRecord, BUILTIN_ROLES } from "../modelRoles";
import { useOmpConfigStore } from "../ompConfigStore";
import { Button, INPUT_CLASS, MODEL_PICKER_BUTTON_CLASS } from "../ui";
import {
	type AgentToolGroup,
	buildAgentDraftPrompt,
	buildAgentFile,
	checkNewAgentName,
	getAgentToolGroups,
	type NewAgentSpec,
	orderPickedTools,
	READONLY_AGENT_TOOLS,
} from "./agentDefs";
type ToolsMode = "default" | "readonly" | "custom";
type ModelMode = "inherit" | "role" | "model";

function getToolsOptions(t: (k: string, p?: Record<string, string | number>) => string): { value: ToolsMode; label: string; hint: string }[] {
	return [
		{ value: "default", label: t("agentDefs.form.toolDefault"), hint: t("agentDefs.form.toolDefaultHint") },
		{ value: "readonly", label: t("agentDefs.form.toolReadonly"), hint: t("agentDefs.form.toolReadonlyHint", { tools: READONLY_AGENT_TOOLS.join(", ") }) },
		{ value: "custom", label: t("agentDefs.form.toolCustom"), hint: t("agentDefs.form.toolCustomHint") },
	];
}

function getModelOptions(t: (k: string) => string): { value: ModelMode; label: string; hint: string }[] {
	return [
		{ value: "inherit", label: t("agentDefs.form.modelInherit"), hint: t("agentDefs.form.modelInheritHint") },
		{ value: "role", label: t("agentDefs.form.modelRole"), hint: t("agentDefs.form.modelRoleHint") },
		{ value: "model", label: t("agentDefs.form.modelModel"), hint: t("agentDefs.form.modelModelHint") },
	];
}

function ToolPicker({
	picked,
	disabled,
	onToggle,
	toolGroups,
}: {
	picked: ReadonlySet<string>;
	disabled: boolean;
	onToggle: (name: string) => void;
	toolGroups: readonly AgentToolGroup[];
}) {
	return (
		<div className="space-y-2 rounded-lg hairline bg-[var(--bg-panel)] p-3">
			{toolGroups.map((g) => (
				<div key={g.title} role="group" aria-label={g.title} className="flex flex-wrap items-center gap-1.5">
					<span className="w-16 shrink-0 text-[11px] text-[var(--text-dim)]">{g.title}</span>
					{g.tools.map((t) => {
						const on = picked.has(t.name);
						return (
							<button
								key={t.name}
								type="button"
								role="checkbox"
								aria-checked={on}
								aria-label={`${t.name} ${t.label}`}
								disabled={disabled}
								onClick={() => onToggle(t.name)}
								className={clsx(
									"flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50",
									on
										? "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--text)] ring-1 ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
										: "hairline text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
								)}
							>
								{on && <Check size={11} className="shrink-0" />}
								<span className="font-mono">{t.name}</span>
								<span className={on ? "text-[var(--text-muted)]" : "text-[var(--text-dim)]"}>{t.label}</span>
							</button>
						);
					})}
				</div>
			))}
		</div>
	);
}
// (ToolPicker and getModelOptions moved above)
function Segmented<T extends string>({
	label,
	value,
	options,
	disabled,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string; hint: string }[];
	disabled: boolean;
	onChange: (v: T) => void;
}) {
	return (
		<div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="radio"
					aria-checked={value === o.value}
					title={o.hint}
					disabled={disabled}
					onClick={() => onChange(o.value)}
					className={clsx(
						"rounded-full px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
						value === o.value
							? "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--text)] ring-1 ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
							: "hairline bg-[var(--bg-panel)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
	return (
		<div className="space-y-1.5">
			<div className="text-xs font-medium text-[var(--text)]">{label}</div>
			{children}
			<p className="text-[11px] text-[var(--text-dim)]">{hint}</p>
		</div>
	);
}

export function NewAgentForm({
	dir,
	scopeLabel,
	taken,
	aiCwd,
	onCreated,
	onCancel,
}: {
	dir: string;
	scopeLabel: string;
	taken: ReadonlySet<string>;
	aiCwd: string | null;
	onCreated: (name: string) => void;
	onCancel: () => void;
}) {
	const { t } = useT();
	const toolsOptions = useMemo(() => getToolsOptions(t), [t]);
	const modelOptions = useMemo(() => getModelOptions(t), [t]);
	const toolGroups = useMemo(() => getAgentToolGroups(t), [t]);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [prompt, setPrompt] = useState("");
	const [toolsMode, setToolsMode] = useState<ToolsMode>("default");
	/** 「自己选」 starts from the read-only set; picks survive switching presets back and forth. */
	const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(READONLY_AGENT_TOOLS));
	const [modelMode, setModelMode] = useState<ModelMode>("inherit");
	const [role, setRole] = useState("");
	const [model, setModel] = useState<string | null>(null);
	const [pending, setPending] = useState<"create" | "ai" | null>(null);
	const [error, setError] = useState<string | null>(null);

	const models = useModelOptions();
	const configEntries = useOmpConfigStore((s) => s.entries);
	useEffect(() => {
		void useOmpConfigStore.getState().load();
	}, []);
	useEffect(() => {
		if (modelMode === "model") void useModelCatalog.getState().refresh();
	}, [modelMode]);

	/** Built-in roles first, then the custom ones from the global config. */
	const roleNames = useMemo(() => {
		const custom = Object.keys(asRecord(configEntries.find((e) => e.key === "modelRoles")?.value));
		return [...new Set([...BUILTIN_ROLES.map((r) => r.id), ...custom])];
	}, [configEntries]);

	const tools = toolsMode === "default" ? null : toolsMode === "readonly" ? READONLY_AGENT_TOOLS : orderPickedTools(picked);
	const togglePicked = (name: string) => {
		const next = new Set(picked);
		if (!next.delete(name)) next.add(name);
		setPicked(next);
		setError(null);
	};
	const modelValue = modelMode === "role" ? (role ? `@${role}` : null) : modelMode === "model" ? model : null;
	const locked = pending !== null;
	const edit = <T,>(setter: (v: T) => void) => (v: T) => {
		setter(v);
		setError(null);
	};

	const submit = async () => {
		if (locked) return;
		const checked = checkNewAgentName(name, taken, t);
		if (!checked.ok) return setError(checked.error);
		if (!description.trim()) return setError(t("agentDefs.validation.descRequired"));
		if (!prompt.trim()) return setError(t("agentDefs.validation.promptRequired"));
		if (toolsMode === "custom" && tools?.length === 0) return setError(t("agentDefs.validation.toolsRequired"));
		if (modelMode === "role" && !role) return setError(t("agentDefs.validation.roleRequired"));
		if (modelMode === "model" && !model) return setError(t("agentDefs.validation.modelRequired"));
		const spec: NewAgentSpec = { name: checked.name, description, prompt, tools, model: modelValue };
		setPending("create");
		try {
			await ompAgentWrite(`${dir}/${checked.name}.md`, buildAgentFile(spec), null);
			onCreated(checked.name);
		} catch (e) {
			setError(t("agentDefs.rows.createFailed", { error: describeFileCommandError(e) }));
		} finally {
			setPending(null);
		}
	};

	const askAi = async () => {
		if (locked || !aiCwd) return;
		setPending("ai");
		try {
			const draft = buildAgentDraftPrompt(
				{
					name,
					description,
					prompt,
					tools: toolsMode === "custom" && tools?.length === 0 ? undefined : tools,
					model: modelMode === "inherit" ? null : (modelValue ?? undefined),
				},
				{ dir, scopeLabel },
			);
			const workspaceId = useSessions.getState().workspaces.find((w) => w.path === aiCwd)?.id ?? null;
			const { sessionId, stub } = await createSession({ cwd: aiCwd, workspaceId });
			useSessions.getState().upsert([stub]);
			useComposer.getState().setDraft(sessionId, draft);
			useUi.getState().selectSession(sessionId);
			toast.success(t("agentDefs.form.askAiCreated"));
		} catch (e) {
			setError(t("agentDefs.form.askAiFailed", { error: errMsg(e) }));
			setPending(null);
		}
	};

	return (
		<div data-testid="new-agent-form" className="space-y-4 border-b border-[var(--border-divider)] bg-[var(--well-bg)]/40 px-4 py-4">
			<p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
				{t("agentDefs.form.lead", { scopeLabel })}
			</p>

			<Field label={t("agentDefs.form.nameLabel")} hint={t("agentDefs.form.nameHint")}>
				<input
					aria-label={t("agentDefs.form.nameAria")}
					value={name}
					autoFocus
					spellCheck={false}
					disabled={locked}
					placeholder="docs-writer"
					onChange={(e) => edit(setName)(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							e.stopPropagation();
							onCancel();
						}
					}}
					className={clsx(INPUT_CLASS, "w-64 font-mono")}
				/>
			</Field>

			<Field label={t("agentDefs.form.descLabel")} hint={t("agentDefs.form.descHint")}>
				<input
					aria-label={t("agentDefs.form.descAria")}
					value={description}
					disabled={locked}
					placeholder={t("agentDefs.form.descPlaceholder")}
					onChange={(e) => edit(setDescription)(e.target.value)}
					className={clsx(INPUT_CLASS, "w-full")}
				/>
			</Field>

			<Field label={t("agentDefs.form.promptLabel")} hint={t("agentDefs.form.promptHint")}>
				<textarea
					aria-label={t("agentDefs.form.promptAria")}
					value={prompt}
					disabled={locked}
					rows={5}
					placeholder={t("agentDefs.form.promptPlaceholder")}
					onChange={(e) => edit(setPrompt)(e.target.value)}
					className={clsx(INPUT_CLASS, "w-full resize-y leading-relaxed")}
				/>
			</Field>

			<Field label={t("agentDefs.form.toolsLabel")} hint={toolsOptions.find((o) => o.value === toolsMode)?.hint ?? ""}>
				<Segmented label={t("agentDefs.form.toolsLabel")} value={toolsMode} options={toolsOptions} disabled={locked} onChange={edit(setToolsMode)} />
				{toolsMode === "custom" && <ToolPicker picked={picked} disabled={locked} onToggle={togglePicked} toolGroups={toolGroups} />}
			</Field>

			<Field label={t("agentDefs.form.modelLabel")} hint={modelOptions.find((o) => o.value === modelMode)?.hint ?? ""}>
				<Segmented label={t("agentDefs.form.modelLabel")} value={modelMode} options={modelOptions} disabled={locked} onChange={edit(setModelMode)} />
				{modelMode === "role" && (
					<NativeSelect aria-label={t("agentDefs.form.reuseRoleAria")} value={role} disabled={locked} onChange={(e) => edit(setRole)(e.target.value)}>
						<option value="">{t("agentDefs.form.selectRole")}</option>
						{roleNames.map((r) => (
							<option key={r} value={r}>
								@{r}
							</option>
						))}
					</NativeSelect>
				)}
				{modelMode === "model" && (
					<ModelSelect
						disabled={locked}
						closeOnSelect
						direction="down"
						align="start"
						widthClass="w-[360px]"
						label={model === null ? t("agentDefs.form.selectModel") : parseSelection(model).selector}
						buttonClass={clsx(MODEL_PICKER_BUTTON_CLASS, model === null && "italic text-[var(--text-muted)]")}
						models={models}
						currentValue={model ?? ""}
						thinking
						allowCustom
						onSelect={(v) => edit(setModel)(v.trim() || null)}
					/>
				)}
			</Field>

			{error && (
				<p role="alert" className="select-text break-all text-[11px] text-[var(--status-error)]">
					{error}
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button variant="primary" size="sm" loading={pending === "create"} disabled={locked} onClick={() => void submit()}>
					{t("agentDefs.form.createSubagent")}
				</Button>
				{aiCwd && (
					<Button
						size="sm"
						icon={Sparkles}
						loading={pending === "ai"}
						disabled={locked}
						title={t("agentDefs.form.askAiTitle", { cwd: aiCwd })}
						onClick={() => void askAi()}
					>
						{t("agentDefs.form.askAi")}
					</Button>
				)}
				<Button size="sm" variant="ghost" disabled={locked} onClick={onCancel}>
					{t("agentDefs.form.cancel")}
				</Button>
			</div>
		</div>
	);
}
