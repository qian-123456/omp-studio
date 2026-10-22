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
import { describeFileCommandError } from "../fileEditorLogic";
import { asRecord, BUILTIN_ROLES } from "../modelRoles";
import { useOmpConfigStore } from "../ompConfigStore";
import { Button, INPUT_CLASS, MODEL_PICKER_BUTTON_CLASS } from "../ui";
import {
	AGENT_TOOL_GROUPS,
	buildAgentDraftPrompt,
	buildAgentFile,
	checkNewAgentName,
	type NewAgentSpec,
	orderPickedTools,
	READONLY_AGENT_TOOLS,
} from "./agentDefs";

type ToolsMode = "default" | "readonly" | "custom";
type ModelMode = "inherit" | "role" | "model";

const TOOLS_OPTIONS: { value: ToolsMode; label: string; hint: string }[] = [
	{ value: "default", label: "默认全部工具", hint: "和普通子代理一样，能读写文件、跑命令" },
	{ value: "readonly", label: "只读", hint: `只能查看和搜索：${READONLY_AGENT_TOOLS.join(", ")}` },
	{ value: "custom", label: "自己选", hint: "点选它能用的工具。MCP 和插件提供的工具 OMP 会自动带上，不用在这里选。" },
];

function ToolPicker({
	picked,
	disabled,
	onToggle,
}: {
	picked: ReadonlySet<string>;
	disabled: boolean;
	onToggle: (name: string) => void;
}) {
	return (
		<div className="space-y-2 rounded-lg hairline bg-[var(--bg-panel)] p-3">
			{AGENT_TOOL_GROUPS.map((g) => (
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

const MODEL_OPTIONS: { value: ModelMode; label: string; hint: string }[] = [
	{ value: "inherit", label: "跟随主会话", hint: "不写 model，用派它的那个会话的模型" },
	{ value: "role", label: "复用模型角色", hint: "写 @角色名，以后在「模型角色」页换模型即可" },
	{ value: "model", label: "指定模型", hint: "固定用某个模型" },
];

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
	/** `agents` directory of the scope being shown; the file lands at `<dir>/<name>.md`. */
	dir: string;
	/** Where the file goes, in words (e.g. 「全局版本」). */
	scopeLabel: string;
	/** Agent names this list already shows; those are edited in the list instead. */
	taken: ReadonlySet<string>;
	/** Working directory for the 「让 AI 帮我写」 session; null hides the button. */
	aiCwd: string | null;
	onCreated: (name: string) => void;
	onCancel: () => void;
}) {
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
		const checked = checkNewAgentName(name, taken);
		if (!checked.ok) return setError(checked.error);
		if (!description.trim()) return setError("请写一句「负责什么」，主 AI 只看这句话决定什么时候派它");
		if (!prompt.trim()) return setError("请写「工作要求」，这是子代理拿到任务后遵守的提示词");
		if (toolsMode === "custom" && tools?.length === 0) return setError("请至少选一个工具，或改选「默认全部工具」");
		if (modelMode === "role" && !role) return setError("请选择要复用的模型角色");
		if (modelMode === "model" && !model) return setError("请选择一个模型");
		const spec: NewAgentSpec = { name: checked.name, description, prompt, tools, model: modelValue };
		setPending("create");
		try {
			await ompAgentWrite(`${dir}/${checked.name}.md`, buildAgentFile(spec), null);
			onCreated(checked.name);
		} catch (e) {
			setError(`创建失败：${describeFileCommandError(e)}`);
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
			toast.success("已新建会话，需求已填入输入框，确认后再发送");
		} catch (e) {
			setError(`新建会话失败：${errMsg(e)}`);
			setPending(null);
		}
	};

	return (
		<div data-testid="new-agent-form" className="space-y-4 border-b border-[var(--border-divider)] bg-[var(--well-bg)]/40 px-4 py-4">
			<p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
				填好下面几项就能用：文件存为{scopeLabel}，主 AI 派发任务时会在 task 工具的子代理列表里看到它，并根据「负责什么」自己决定什么时候派它；你也可以直接说「用 xxx 子代理去做…」。已经开着的会话可以点名使用，要让主 AI 主动想到它，新开一个会话最稳妥。
			</p>

			<Field label="名字" hint="只用英文字母、数字、- 和 _，例如 docs-writer。派发时就用这个名字。">
				<input
					aria-label="子代理名字"
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

			<Field label="负责什么" hint="一句话写清它擅长什么、什么情况下该派它。主 AI 只看这句话决定要不要派它。">
				<input
					aria-label="负责什么"
					value={description}
					disabled={locked}
					placeholder="为改动过的公开接口补写或更新文档；改了 API 后应派它"
					onChange={(e) => edit(setDescription)(e.target.value)}
					className={clsx(INPUT_CLASS, "w-full")}
				/>
			</Field>

			<Field label="工作要求" hint="子代理拿到任务后遵守的提示词：怎么做、不能做什么、做完交回什么。">
				<textarea
					aria-label="工作要求"
					value={prompt}
					disabled={locked}
					rows={5}
					placeholder={"你是文档维护专家。\n先读相关代码，再更新对应文档；不要改代码。\n完成后列出改了哪些文件。"}
					onChange={(e) => edit(setPrompt)(e.target.value)}
					className={clsx(INPUT_CLASS, "w-full resize-y leading-relaxed")}
				/>
			</Field>

			<Field label="可用工具" hint={TOOLS_OPTIONS.find((o) => o.value === toolsMode)?.hint ?? ""}>
				<Segmented label="可用工具" value={toolsMode} options={TOOLS_OPTIONS} disabled={locked} onChange={edit(setToolsMode)} />
				{toolsMode === "custom" && <ToolPicker picked={picked} disabled={locked} onToggle={togglePicked} />}
			</Field>

			<Field label="模型" hint={MODEL_OPTIONS.find((o) => o.value === modelMode)?.hint ?? ""}>
				<Segmented label="模型" value={modelMode} options={MODEL_OPTIONS} disabled={locked} onChange={edit(setModelMode)} />
				{modelMode === "role" && (
					<NativeSelect aria-label="复用的模型角色" value={role} disabled={locked} onChange={(e) => edit(setRole)(e.target.value)}>
						<option value="">选择模型角色</option>
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
						label={model === null ? "选择模型" : parseSelection(model).selector}
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
					创建子代理
				</Button>
				{aiCwd && (
					<Button
						size="sm"
						icon={Sparkles}
						loading={pending === "ai"}
						disabled={locked}
						title={`在 ${aiCwd} 新开一个会话，把已填的内容交给 AI，由它问清楚后帮你写好文件`}
						onClick={() => void askAi()}
					>
						让 AI 帮我写
					</Button>
				)}
				<Button size="sm" variant="ghost" disabled={locked} onClick={onCancel}>
					取消
				</Button>
			</div>
		</div>
	);
}
