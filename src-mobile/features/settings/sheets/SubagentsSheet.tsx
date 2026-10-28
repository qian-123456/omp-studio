import { Bot, Plus, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button, Chip, Field, inputCls, ListGroup, ListRow, TextField, toast } from "../../../ui";
import { SettingsSheet } from "../rows";

interface AgentDef {
	id: string;
	name: string;
	description: string;
	tools: string;
	model: string;
	prompt: string;
	isBuiltin: boolean;
}

const INITIAL_AGENTS: AgentDef[] = [
	{
		id: "scout",
		name: "scout",
		description: "代码库探索、快速分析与广泛模式检索（只读快速探针）",
		tools: "find, read, grep, glob, web_search",
		model: "@scout",
		prompt: "代码库探索与信息检索专家。在派发更重的改动之前，使用本代理梳理调用关系与事实。",
		isBuiltin: true,
	},
	{
		id: "task",
		name: "task",
		description: "通用多步骤执行代理，具备全部工具权限",
		tools: "*",
		model: "@task",
		prompt: "通用多步骤任务执行代理，严格按照需求交付完整改动与验证。",
		isBuiltin: true,
	},
	{
		id: "reviewer",
		name: "reviewer",
		description: "代码评审专家，负责质量与安全性分析",
		tools: "read, grep, find",
		model: "@reviewer",
		prompt: "代码审查专家。对照工程最佳实践对代码差异进行审阅，指出潜在隐患。",
		isBuiltin: true,
	},
	{
		id: "tester",
		name: "tester",
		description: "自动化测试与验证专家",
		tools: "bash, read, edit",
		model: "@tester",
		prompt: "自动化测试与验证专家，编写单元测试和端到端验证用例。",
		isBuiltin: true,
	},
];

const ICON = { size: 22, strokeWidth: 1.75 } as const;
const MONO_INPUT = "font-m-mono";

/** Prompt draft written for the user from the name and description. */
function draftPrompt(a: AgentDef): string {
	const name = a.name.trim() || "新子代理";
	const desc = a.description.trim() || "自定义专业领域任务";
	return `# ${name} 角色指令\n\n- 职责范围：${desc}\n- 执行准则：严格遵循六个月可维护性原则，不留 TODO。\n- 产出要求：提交完整验证与实现方案。`;
}

/**
 * Editor mode: `new` is a two-step flow (基本信息 → 提示词) with 上一步 keeping every field;
 * `edit` shows all fields on one page.
 */
type Mode = { kind: "new"; step: 1 | 2 } | { kind: "edit" };

/** Sub-agent definitions: list, create (with AI-written prompt) and edit. */
export function SubagentsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [agents, setAgents] = useState<AgentDef[]>(INITIAL_AGENTS);
	// The draft stays set while the editor sheet animates out, so its title does not flash.
	const [draft, setDraft] = useState<AgentDef | null>(null);
	const [mode, setMode] = useState<Mode>({ kind: "edit" });
	const [editorOpen, setEditorOpen] = useState(false);
	const [nameError, setNameError] = useState<string | null>(null);

	const patch = (p: Partial<AgentDef>) => setDraft((d) => (d ? { ...d, ...p } : d));

	const startCreate = () => {
		setDraft({ id: `agent-${Date.now()}`, name: "", description: "", tools: "*", model: "@task", prompt: "", isBuiltin: false });
		setMode({ kind: "new", step: 1 });
		setNameError(null);
		setEditorOpen(true);
	};

	const startEdit = (agent: AgentDef) => {
		setDraft({ ...agent });
		setMode({ kind: "edit" });
		setNameError(null);
		setEditorOpen(true);
	};

	const checkName = (): boolean => {
		if (draft?.name.trim()) return true;
		setNameError("请填写子代理名称");
		return false;
	};

	const aiWrite = () => {
		if (!draft) return;
		if (draft.prompt.trim()) {
			toast("提示词已有内容，清空后再让 AI 写", { kind: "info" });
			return;
		}
		patch({ prompt: draftPrompt(draft) });
		toast("AI 已写好提示词草稿，可以再改改", { kind: "success" });
	};

	const save = () => {
		if (!draft || !checkName()) return;
		const next = { ...draft, name: draft.name.trim() };
		if (mode.kind === "new") {
			setAgents((prev) => [...prev, next]);
			toast(`已创建子代理 ${next.name}`, { kind: "success" });
		} else {
			setAgents((prev) => prev.map((a) => (a.id === next.id ? next : a)));
			toast(`子代理 ${next.name} 已更新`, { kind: "success" });
		}
		setEditorOpen(false);
	};

	const showBasics = mode.kind === "edit" || mode.step === 1;
	const showPrompt = mode.kind === "edit" || mode.step === 2;

	const footer =
		mode.kind === "new" && mode.step === 1 ? (
			<div className="flex gap-3">
				<Button variant="tonal" block className="flex-1" onClick={() => setEditorOpen(false)}>
					取消
				</Button>
				<Button variant="primary" block className="flex-1" onClick={() => checkName() && setMode({ kind: "new", step: 2 })}>
					下一步
				</Button>
			</div>
		) : mode.kind === "new" ? (
			<div className="flex gap-3">
				<Button variant="tonal" block className="flex-1" onClick={() => setMode({ kind: "new", step: 1 })}>
					上一步
				</Button>
				<Button variant="primary" block className="flex-1" onClick={save}>
					创建
				</Button>
			</div>
		) : (
			<div className="flex gap-3">
				<Button variant="tonal" block className="flex-1" onClick={() => setEditorOpen(false)}>
					取消
				</Button>
				<Button variant="primary" block className="flex-1" onClick={save}>
					保存
				</Button>
			</div>
		);

	return (
		<SettingsSheet open={open} onClose={onClose} title="子代理管理" subtitle="主 AI 可以通过 task 工具把独立的子任务交给子代理处理。">
			<ListGroup>
				<ListRow icon={<Plus {...ICON} />} title={<span className="text-m-accent">新建子代理</span>} onClick={startCreate} chevron={false} />
			</ListGroup>

			<ListGroup title="已有子代理">
				{agents.map((a) => (
					<ListRow
						key={a.id}
						icon={<Bot {...ICON} />}
						title={<span className="font-m-mono break-all">{a.name}</span>}
						subtitle={a.description || undefined}
						right={a.isBuiltin ? <Chip>内置</Chip> : undefined}
						chevron
						onClick={() => startEdit(a)}
					/>
				))}
			</ListGroup>

			<SettingsSheet
				open={editorOpen && draft != null}
				onClose={() => setEditorOpen(false)}
				title={mode.kind === "new" ? "新建子代理" : `编辑 ${draft?.name ?? ""}`}
				subtitle={mode.kind === "new" ? (mode.step === 1 ? "第 1 步，共 2 步：基本信息" : "第 2 步，共 2 步：提示词") : undefined}
				footer={footer}
			>
				{draft && (
					<div className="flex flex-col gap-4 px-5 pt-2">
						{showBasics && (
							<>
								<Field label="名称" hint={draft.isBuiltin ? "内置子代理不能改名" : "例如 doc-writer"} error={nameError}>
									<TextField
										value={draft.name}
										disabled={draft.isBuiltin}
										placeholder="英文短名"
										autoCapitalize="off"
										spellCheck={false}
										onChange={(e) => {
											patch({ name: e.target.value });
											setNameError(null);
										}}
										className={MONO_INPUT}
									/>
								</Field>
								<Field label="职责描述" hint="一句话说明它负责什么，主 AI 据此决定什么时候交给它">
									<textarea
										value={draft.description}
										rows={2}
										placeholder="例如 只读的代码库探索"
										onChange={(e) => patch({ description: e.target.value })}
										className={`${inputCls} block resize-none`}
									/>
								</Field>
								<Field label="可用工具" hint="* 表示全部工具，或用逗号分隔，如 read, edit">
									<TextField
										value={draft.tools}
										autoCapitalize="off"
										spellCheck={false}
										onChange={(e) => patch({ tools: e.target.value })}
										className={MONO_INPUT}
									/>
								</Field>
								<Field label="模型" hint="模型角色如 @task，或 供应商/模型">
									<TextField
										value={draft.model}
										autoCapitalize="off"
										spellCheck={false}
										onChange={(e) => patch({ model: e.target.value })}
										className={MONO_INPUT}
									/>
								</Field>
							</>
						)}
						{showPrompt && (
							<Field label="系统提示词" hint="它的专属指令、工作范围和交回标准">
								<textarea
									value={draft.prompt}
									rows={10}
									placeholder="不知道怎么写？点下面的按钮让 AI 先写一版"
									autoCapitalize="off"
									spellCheck={false}
									onChange={(e) => patch({ prompt: e.target.value })}
									className={`${inputCls} m-selectable block resize-none rounded-m-lg ${MONO_INPUT}`}
								/>
							</Field>
						)}
						{showPrompt && (
							<div>
								<Button variant="accent" icon={<Wand2 size={18} strokeWidth={1.75} />} onClick={aiWrite}>
									让 AI 帮我写
								</Button>
							</div>
						)}
					</div>
				)}
			</SettingsSheet>
		</SettingsSheet>
	);
}
