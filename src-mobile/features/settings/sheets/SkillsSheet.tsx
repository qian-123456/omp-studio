import { BottomSheet } from "../../../ui/BottomSheet";

interface CommandItem {
	name: string;
	desc: string;
	type: "skill" | "slash";
}

const ITEMS: CommandItem[] = [
	{ name: "/compact", desc: "手动触发当前会话上下文压缩瘦身", type: "slash" },
	{ name: "/doctor", desc: "诊断当前会话的健康度与提问改动模式", type: "slash" },
	{ name: "/diff", desc: "查看当前工作区未提交的 Git 改动差异", type: "slash" },
	{ name: "git-commit-task", desc: "按约定格式自动分析差异生成 Conventional Commit 提交信息", type: "skill" },
	{ name: "reverse-engineer", desc: "逆向反编译二进制工具包与协议分析", type: "skill" },
	{ name: "answer-me-with-html", desc: "用内联 HTML / SVG 动态渲染流程图、交互演示与对比表", type: "skill" },
];

export function SkillsSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	return (
		<BottomSheet open={open} onClose={onClose} title="技能与命令">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
					<p className="text-m-xs text-m-text-3">
						在输入框输入 / 可快捷触发斜杠命令；技能文件则在满足特定上下文时由智能体自动激活。
					</p>

					<div className="divide-y divide-m-border pt-1">
						{ITEMS.map((it) => (
							<div key={it.name} className="py-2.5">
								<div className="flex items-center justify-between">
									<span className="font-m-mono text-m-xs font-semibold text-m-text">{it.name}</span>
									<span className="rounded-m-pill bg-m-surface px-2 py-0.5 text-[10px] text-m-text-3">
										{it.type === "slash" ? "斜杠命令" : "自动技能"}
									</span>
								</div>
								<p className="mt-0.5 text-[11px] text-m-text-3 leading-relaxed">{it.desc}</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</BottomSheet>
	);
}
