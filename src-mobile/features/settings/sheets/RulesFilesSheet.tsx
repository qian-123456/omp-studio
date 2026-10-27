import { useState } from "react";
import { FileText, Save, ChevronRight, ArrowLeft } from "lucide-react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { toast } from "../../../ui/Toast";

interface RuleDoc {
	id: string;
	name: string;
	desc: string;
	content: string;
}

const DEFAULT_DOCS: RuleDoc[] = [
	{
		id: "agents-md",
		name: "AGENTS.md",
		desc: "全局或项目通用的代码开发与代理行为准则",
		content: `# AGENTS.md 规范指引

- 代码风格：简洁至上，避免不必要的抽象与无用封装。
- 自动化测试：所有改动完成后需通过类型与单元测试闭环。
- Git 规则：不得强推，改动范围严格限制在本次任务内。
`,
	},
	{
		id: "rules-md",
		name: "RULES.md",
		desc: "全局强制执行的硬性约束规则",
		content: `# RULES.md 核心铁律

1. 不可逆与花钱的操作必须先确认（git push、删除文件超过10个、部署等）。
2. 任何异常与报错不得静默忽略。
`,
	},
	{
		id: "append-system-md",
		name: "APPEND_SYSTEM.md",
		desc: "追加在系统主提示词末尾的补充指令",
		content: `# APPEND_SYSTEM.md

- 回复语言：默认使用简体中文。
- 终端调用：避免长等待交互命令，优先使用非交互式参数。
`,
	},
];

export function RulesFilesSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [docs, setDocs] = useState<RuleDoc[]>(DEFAULT_DOCS);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editContent, setEditContent] = useState<string>("");

	const selectedDoc = docs.find((d) => d.id === editingId);

	const handleStartEdit = (doc: RuleDoc) => {
		setEditingId(doc.id);
		setEditContent(doc.content);
	};

	const handleSave = () => {
		if (!editingId) return;
		setDocs((prev) =>
			prev.map((d) => (d.id === editingId ? { ...d, content: editContent } : d)),
		);
		setEditingId(null);
		toast("规则文件已保存", { kind: "success" });
	};

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			fullHeight={Boolean(editingId)}
			title={editingId ? `编辑 · ${selectedDoc?.name}` : "规则文件 (查看并编辑)"}
		>
			<div className="space-y-4 px-4 pb-8">
				{editingId && selectedDoc ? (
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<button
								type="button"
								onClick={() => setEditingId(null)}
								className="flex items-center gap-1 text-m-xs text-m-accent"
							>
								<ArrowLeft size={14} />
								<span>返回文件列表</span>
							</button>
							<button
								type="button"
								onClick={handleSave}
								className="flex items-center gap-1.5 rounded-m-md bg-m-accent px-3 py-1.5 text-m-xs font-medium text-m-accent-text"
							>
								<Save size={14} />
								<span>保存修改</span>
							</button>
						</div>

						<textarea
							aria-label="规则文件正文"
							value={editContent}
							onChange={(e) => setEditContent(e.target.value)}
							rows={16}
							className="w-full rounded-m-md border border-m-border bg-m-bg p-3 font-m-mono text-m-xs leading-relaxed text-m-text outline-none focus:border-m-accent"
						/>
					</div>
				) : (
					<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
						<p className="text-m-xs text-m-text-3">
							OMP 会按优先级自动读取以下规则文件并注入到智能体提示词中。点击即可在线查看并修改：
						</p>

						<div className="divide-y divide-m-border pt-1">
							{docs.map((doc) => (
								<button
									key={doc.id}
									type="button"
									onClick={() => handleStartEdit(doc)}
									className="flex w-full items-center justify-between py-3 text-left active:bg-m-surface-hover"
								>
									<div className="flex items-start gap-2.5 min-w-0 pr-2">
										<FileText size={18} className="shrink-0 text-m-text-2 mt-0.5" />
										<div className="min-w-0">
											<div className="text-m-sm font-semibold text-m-text">{doc.name}</div>
											<div className="truncate text-m-xs text-m-text-3">{doc.desc}</div>
										</div>
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
