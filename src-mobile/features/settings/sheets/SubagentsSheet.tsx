import { useState } from "react";
import { Plus, Wand2, ChevronRight, ArrowLeft, Save } from "lucide-react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { toast } from "../../../ui/Toast";

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

export function SubagentsSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [agents, setAgents] = useState<AgentDef[]>(INITIAL_AGENTS);
	const [editingAgent, setEditingAgent] = useState<AgentDef | null>(null);
	const [isNew, setIsNew] = useState(false);

	const handleStartCreate = () => {
		const newAgent: AgentDef = {
			id: `agent-${Date.now()}`,
			name: "",
			description: "",
			tools: "*",
			model: "@task",
			prompt: "",
			isBuiltin: false,
		};
		setEditingAgent(newAgent);
		setIsNew(true);
	};

	const handleStartEdit = (agent: AgentDef) => {
		setEditingAgent({ ...agent });
		setIsNew(false);
	};

	const handleAiHelp = () => {
		if (!editingAgent) return;
		const name = editingAgent.name || "新子代理";
		const desc = editingAgent.description || "自定义专业领域任务";

		// Auto fill prompt and notify
		setEditingAgent((prev) =>
			prev
				? {
						...prev,
						prompt:
							prev.prompt ||
							`# ${name} 角色指令\n\n- 职责范围：${desc}\n- 执行准则：严格遵循六个月可维护性原则，不留 TODO。\n- 产出要求：提交完整验证与实现方案。`,
					}
				: null,
		);
		toast("AI 已协助生成提示词草稿，请根据需要微调", { kind: "success" });
	};

	const handleSave = () => {
		if (!editingAgent) return;
		if (!editingAgent.name.trim()) {
			toast("请填写子代理名称", { kind: "error" });
			return;
		}

		if (isNew) {
			setAgents((prev) => [...prev, editingAgent]);
			toast(`已成功创建子代理 ${editingAgent.name}`, { kind: "success" });
		} else {
			setAgents((prev) => prev.map((a) => (a.id === editingAgent.id ? editingAgent : a)));
			toast(`子代理 ${editingAgent.name} 已更新`, { kind: "success" });
		}
		setEditingAgent(null);
	};

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			fullHeight={Boolean(editingAgent)}
			title={editingAgent ? (isNew ? "新建子代理" : `编辑 · ${editingAgent.name}`) : "子代理管理"}
		>
			<div className="space-y-4 px-4 pb-8">
				{editingAgent ? (
					/* Editor View */
					<div className="space-y-3.5">
						<div className="flex items-center justify-between">
							<button
								type="button"
								onClick={() => setEditingAgent(null)}
								className="flex items-center gap-1 text-m-xs text-m-accent"
							>
								<ArrowLeft size={14} />
								<span>返回列表</span>
							</button>

							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={handleAiHelp}
									className="flex items-center gap-1.5 rounded-m-md border border-m-border bg-m-surface px-2.5 py-1.5 text-m-xs font-medium text-m-accent active:bg-m-surface-hover"
								>
									<Wand2 size={13} />
									<span>让 AI 帮我写</span>
								</button>
								<button
									type="button"
									onClick={handleSave}
									className="flex items-center gap-1.5 rounded-m-md bg-m-accent px-3 py-1.5 text-m-xs font-medium text-m-accent-text"
								>
									<Save size={14} />
									<span>保存</span>
								</button>
							</div>
						</div>

						<div className="space-y-3 rounded-m-lg border border-m-border bg-m-bg-elev p-3">
							<div className="space-y-1">
								<label className="text-m-xs font-medium text-m-text-3">名称 (Name)</label>
								<input
									type="text"
									placeholder="如 doc-writer, refactor-bot"
									value={editingAgent.name}
									disabled={editingAgent.isBuiltin}
									onChange={(e) => setEditingAgent({ ...editingAgent, name: e.target.value })}
									className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text"
								/>
							</div>

							<div className="space-y-1">
								<label className="text-m-xs font-medium text-m-text-3">职责描述 (Description)</label>
								<input
									type="text"
									placeholder="一句话说明负责什么、主 AI 什么时候该派发给它"
									value={editingAgent.description}
									onChange={(e) => setEditingAgent({ ...editingAgent, description: e.target.value })}
									className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text"
								/>
							</div>

							<div className="grid grid-cols-2 gap-2">
								<div className="space-y-1">
									<label className="text-m-xs font-medium text-m-text-3">可用工具 (Tools)</label>
									<input
										type="text"
										placeholder="* 或 read, edit"
										value={editingAgent.tools}
										onChange={(e) => setEditingAgent({ ...editingAgent, tools: e.target.value })}
										className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text"
									/>
								</div>
								<div className="space-y-1">
									<label className="text-m-xs font-medium text-m-text-3">模型 (Model)</label>
									<input
										type="text"
										placeholder="@task 或 provider/model"
										value={editingAgent.model}
										onChange={(e) => setEditingAgent({ ...editingAgent, model: e.target.value })}
										className="min-h-11 w-full rounded-m-md border border-m-border bg-m-bg px-3 text-m-sm text-m-text"
									/>
								</div>
							</div>

							<div className="space-y-1">
								<label className="text-m-xs font-medium text-m-text-3">系统提示词 (Prompt)</label>
								<textarea
									rows={8}
									placeholder="这个子代理特有的提示词指令、工作范围与交回标准"
									value={editingAgent.prompt}
									onChange={(e) => setEditingAgent({ ...editingAgent, prompt: e.target.value })}
									className="w-full rounded-m-md border border-m-border bg-m-bg p-3 font-m-mono text-m-xs leading-relaxed text-m-text outline-none focus:border-m-accent"
								/>
							</div>
						</div>
					</div>
				) : (
					/* List View */
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<p className="text-m-xs text-m-text-3">
								主 AI 可通过 task 工具直接调用子代理，按职责专注处理独立子步骤。
							</p>
							<button
								type="button"
								onClick={handleStartCreate}
								className="flex items-center gap-1 shrink-0 rounded-m-md bg-m-accent px-3 py-1.5 text-m-xs font-medium text-m-accent-text"
							>
								<Plus size={14} />
								<span>新建子代理</span>
							</button>
						</div>

						<div className="rounded-m-lg border border-m-border bg-m-bg-elev divide-y divide-m-border">
							{agents.map((agent) => (
								<button
									key={agent.id}
									type="button"
									onClick={() => handleStartEdit(agent)}
									className="flex w-full items-center justify-between p-3 text-left active:bg-m-surface-hover"
								>
									<div className="min-w-0 pr-2">
										<div className="flex items-center gap-2">
											<span className="font-m-mono text-m-sm font-semibold text-m-text">
												{agent.name}
											</span>
											{agent.isBuiltin && (
												<span className="rounded-m-pill bg-m-surface-2 px-1.5 py-0.2 text-[10px] text-m-text-3">
													内置
												</span>
											)}
										</div>
										<p className="mt-0.5 truncate text-m-xs text-m-text-3">{agent.description}</p>
									</div>
									<ChevronRight size={16} className="text-m-text-3 shrink-0" />
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</BottomSheet>
	);
}
