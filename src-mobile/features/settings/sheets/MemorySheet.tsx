import { useState } from "react";
import { Save, ArrowLeft, ChevronRight } from "lucide-react";
import { BottomSheet } from "../../../ui/BottomSheet";
import { toast } from "../../../ui/Toast";

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
		title: "全局记忆笔记 (MEMORY.md)",
		path: "~/.omp/agent/MEMORY.md",
		content: `# 全局工程经验记忆

- 代码重构：保持最小修改面，六个月可维护性优先于过早抽象。
- 自动化：测试用例直接运行并捕获终端输出，拒绝伪造通过。
- 移动端适配：保证 44px 最小点击热区与 iOS 安全区域底部间距。
`,
	},
];

const DEFAULT_SKILLS: SkillItem[] = [
	{
		name: "agents-sdk",
		description: "构建、调试与审查 Cloudflare Agents SDK 应用程序",
		source: "内置技能",
	},
	{
		name: "workers-best-practices",
		description: "生产级 Cloudflare Workers 架构规范与最佳实践",
		source: "内置技能",
	},
	{
		name: "ego-browser",
		description: "轻量级 Web 自动化、填表、截图与视觉回归测试",
		source: "内置技能",
	},
];

export function MemorySheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const [memories, setMemories] = useState<MemoryNote[]>(DEFAULT_MEMORIES);
	const [skills] = useState<SkillItem[]>(DEFAULT_SKILLS);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editContent, setEditContent] = useState("");

	const selectedMemory = memories.find((m) => m.id === editingId);

	const handleStartEdit = (m: MemoryNote) => {
		setEditingId(m.id);
		setEditContent(m.content);
	};

	const handleSave = () => {
		if (!editingId) return;
		setMemories((prev) =>
			prev.map((m) => (m.id === editingId ? { ...m, content: editContent } : m)),
		);
		setEditingId(null);
		toast("记忆笔记已保存", { kind: "success" });
	};

	return (
		<BottomSheet
			open={open}
			onClose={onClose}
			fullHeight={Boolean(editingId)}
			title={editingId ? `编辑记忆 · ${selectedMemory?.title}` : "记忆管理"}
		>
			<div className="space-y-4 px-4 pb-8">
				{editingId && selectedMemory ? (
					/* Editor View */
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<button
								type="button"
								onClick={() => setEditingId(null)}
								className="flex items-center gap-1 text-m-xs text-m-accent"
							>
								<ArrowLeft size={14} />
								<span>返回列表</span>
							</button>

							<button
								type="button"
								onClick={handleSave}
								className="flex items-center gap-1.5 rounded-m-md bg-m-accent px-3 py-1.5 text-m-xs font-medium text-m-accent-text"
							>
								<Save size={14} />
								<span>保存笔记</span>
							</button>
						</div>

						<textarea
							aria-label="记忆笔记正文"
							value={editContent}
							onChange={(e) => setEditContent(e.target.value)}
							rows={16}
							className="w-full rounded-m-md border border-m-border bg-m-bg p-3 font-m-mono text-m-xs leading-relaxed text-m-text outline-none focus:border-m-accent"
						/>
					</div>
				) : (
					/* List View */
					<div className="space-y-4">
						{/* Memories section */}
						<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
							<div className="flex items-center justify-between">
								<h3 className="text-m-xs font-semibold text-m-text">跨会话记忆笔记 (可查看与编辑)</h3>
								<span className="text-[11px] text-m-text-3">点击编辑</span>
							</div>

							<div className="divide-y divide-m-border">
								{memories.map((m) => (
									<button
										key={m.id}
										type="button"
										onClick={() => handleStartEdit(m)}
										className="flex w-full items-center justify-between py-3 text-left active:bg-m-surface-hover"
									>
										<div className="min-w-0 pr-2">
											<div className="text-m-sm font-semibold text-m-text">{m.title}</div>
											<div className="font-m-mono text-[11px] text-m-text-3 truncate">{m.path}</div>
										</div>
										<ChevronRight size={16} className="text-m-text-3 shrink-0" />
									</button>
								))}
							</div>
						</div>

						{/* Skills section (strictly no delete) */}
						<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
							<div className="flex items-center justify-between">
								<h3 className="text-m-xs font-semibold text-m-text">已加载技能库 (只读展示，不可删除)</h3>
								<span className="rounded-m-pill bg-m-surface-2 px-2 py-0.5 text-[10px] text-m-text-3">
									保护模式
								</span>
							</div>
							<p className="text-[11px] text-m-text-3 leading-relaxed">
								技能由全局或项目约定托管，移动端仅支持查看与调度，不提供删除操作以防止工程脚本破坏。
							</p>

							<div className="divide-y divide-m-border pt-1">
								{skills.map((s) => (
									<div key={s.name} className="py-2.5">
										<div className="flex items-center justify-between">
											<span className="font-m-mono text-m-xs font-medium text-m-text">{s.name}</span>
											<span className="text-[10px] text-m-text-3">{s.source}</span>
										</div>
										<p className="mt-0.5 text-[11px] text-m-text-3">{s.description}</p>
									</div>
								))}
							</div>
						</div>
					</div>
				)}
			</div>
		</BottomSheet>
	);
}
