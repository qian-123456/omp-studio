import { Brain, Lock, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button, Chip, inputCls, ListGroup, ListRow, toast } from "../../../ui";
import { SettingsSheet } from "../rows";

interface MemoryNote {
	id: string;
	title: string;
	path: string;
	content: string;
}

interface SkillItem {
	name: string;
	description: string;
	source: string;
}

const DEFAULT_MEMORIES: MemoryNote[] = [
	{
		id: "global-memory",
		title: "全局记忆笔记",
		path: "~/.omp/agent/MEMORY.md",
		content: `# 全局工程经验记忆

- 代码重构：保持最小修改面，六个月可维护性优先于过早抽象。
- 自动化：测试用例直接运行并捕获终端输出，拒绝伪造通过。
- 移动端适配：保证 44px 最小点击热区与 iOS 安全区域底部间距。
`,
	},
];

const DEFAULT_SKILLS: SkillItem[] = [
	{ name: "agents-sdk", description: "构建、调试与审查 Cloudflare Agents SDK 应用", source: "内置" },
	{ name: "workers-best-practices", description: "生产级 Cloudflare Workers 架构规范与最佳实践", source: "内置" },
	{ name: "ego-browser", description: "网页自动化、填表、截图与视觉回归测试", source: "内置" },
];

const ICON = { size: 22, strokeWidth: 1.75 } as const;

/** Cross-session memory notes (editable) and loaded skills (read-only, never deletable). */
export function MemorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [memories, setMemories] = useState<MemoryNote[]>(DEFAULT_MEMORIES);
	const [skills] = useState<SkillItem[]>(DEFAULT_SKILLS);
	// The edited id stays set while the editor sheet animates out, so its title does not flash.
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editContent, setEditContent] = useState("");

	const selected = memories.find((m) => m.id === editingId);

	const startEdit = (m: MemoryNote) => {
		setEditingId(m.id);
		setEditContent(m.content);
		setEditorOpen(true);
	};

	const save = () => {
		if (!editingId) return;
		setMemories((prev) => prev.map((m) => (m.id === editingId ? { ...m, content: editContent } : m)));
		setEditorOpen(false);
		toast("记忆笔记已保存", { kind: "success" });
	};

	return (
		<SettingsSheet open={open} onClose={onClose} title="记忆管理" subtitle="智能体在不同会话之间记住的经验，以及已经加载的技能。">
			<ListGroup title="跨会话记忆笔记">
				{memories.map((m) => (
					<ListRow
						key={m.id}
						icon={<Brain {...ICON} />}
						title={m.title}
						subtitle={<span className="font-m-mono break-all">{m.path}</span>}
						onClick={() => startEdit(m)}
					/>
				))}
			</ListGroup>

			<ListGroup title="已加载技能" note="技能由全局或项目配置管理，手机上只能查看，不能删除，以免误删工程脚本。">
				{skills.map((s) => (
					<ListRow
						key={s.name}
						icon={<Sparkles {...ICON} />}
						title={<span className="font-m-mono break-all">{s.name}</span>}
						subtitle={s.description}
						right={<Chip icon={<Lock size={12} strokeWidth={2} />}>{s.source}</Chip>}
					/>
				))}
			</ListGroup>

			<SettingsSheet
				open={editorOpen && selected != null}
				onClose={() => setEditorOpen(false)}
				title={selected ? `编辑${selected.title}` : ""}
				subtitle={selected ? <span className="font-m-mono break-all">{selected.path}</span> : undefined}
				footer={
					<div className="flex gap-3">
						<Button variant="tonal" block className="flex-1" onClick={() => setEditorOpen(false)}>
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
						aria-label="记忆笔记正文"
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
