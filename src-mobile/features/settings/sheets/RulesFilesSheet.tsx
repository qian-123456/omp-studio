import { FileText } from "lucide-react";
import { useState } from "react";
import { Button, inputCls, ListGroup, ListRow, toast } from "../../../ui";
import { SettingsSheet } from "../rows";

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
		desc: "全局或项目通用的开发与代理行为准则",
		content: `# AGENTS.md 规范指引

- 代码风格：简洁至上，避免不必要的抽象与无用封装。
- 自动化测试：所有改动完成后需通过类型与单元测试闭环。
- Git 规则：不得强推，改动范围严格限制在本次任务内。
`,
	},
	{
		id: "rules-md",
		name: "RULES.md",
		desc: "全局强制执行的硬性约束",
		content: `# RULES.md 核心铁律

1. 不可逆与花钱的操作必须先确认（git push、删除文件超过10个、部署等）。
2. 任何异常与报错不得静默忽略。
`,
	},
	{
		id: "append-system-md",
		name: "APPEND_SYSTEM.md",
		desc: "追加在系统提示词末尾的补充指令",
		content: `# APPEND_SYSTEM.md

- 回复语言：默认使用简体中文。
- 终端调用：避免长等待交互命令，优先使用非交互式参数。
`,
	},
];

/** Rule files injected into the agent prompt: list + full-text editor sheet. */
export function RulesFilesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [docs, setDocs] = useState<RuleDoc[]>(DEFAULT_DOCS);
	// The edited id stays set while the editor sheet animates out, so its title does not flash.
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editContent, setEditContent] = useState("");

	const selectedDoc = docs.find((d) => d.id === editingId);

	const startEdit = (doc: RuleDoc) => {
		setEditingId(doc.id);
		setEditContent(doc.content);
		setEditorOpen(true);
	};

	const save = () => {
		if (!editingId) return;
		setDocs((prev) => prev.map((d) => (d.id === editingId ? { ...d, content: editContent } : d)));
		setEditorOpen(false);
		toast("规则文件已保存", { kind: "success" });
	};

	return (
		<SettingsSheet
			open={open}
			onClose={onClose}
			title="规则文件 (查看并编辑)"
			subtitle="OMP 会按顺序读取这些文件，放进智能体的提示词里。点开可以查看和修改。"
		>
			<ListGroup>
				{docs.map((doc) => (
					<ListRow
						key={doc.id}
						icon={<FileText size={22} strokeWidth={1.75} />}
						title={doc.name}
						subtitle={doc.desc}
						onClick={() => startEdit(doc)}
					/>
				))}
			</ListGroup>

			<SettingsSheet
				open={editorOpen && selectedDoc != null}
				onClose={() => setEditorOpen(false)}
				title={selectedDoc ? `编辑 ${selectedDoc.name}` : ""}
				subtitle={selectedDoc?.desc}
				footer={
					<div className="flex gap-3">
						<Button variant="tonal" block className="flex-1" onClick={() => setEditingId(null)}>
							取消
						</Button>
						<Button variant="primary" block className="flex-1" onClick={save}>
							保存
						</Button>
					</div>
				}
			>
				<div className="px-4">
					<textarea
						aria-label="规则文件正文"
						value={editContent}
						onChange={(e) => setEditContent(e.target.value)}
						rows={18}
						spellCheck={false}
						autoCapitalize="off"
						className={`${inputCls} m-selectable block resize-none rounded-m-lg font-m-mono`}
					/>
				</div>
			</SettingsSheet>
		</SettingsSheet>
	);
}
