import { Smartphone, HelpCircle, Layers } from "lucide-react";
import { BottomSheet } from "../../../ui/BottomSheet";

export function GuideSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	return (
		<BottomSheet open={open} onClose={onClose} title="使用教程">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="flex items-center gap-2">
						<Smartphone size={18} className="text-m-accent" />
						<h3 className="text-m-sm font-semibold text-m-text">移动端手势与操作</h3>
					</div>
					<ul className="space-y-2 text-m-xs text-m-text-2 leading-relaxed">
						<li>• <strong className="text-m-text">下拉刷新：</strong> 在会话、配额与设置页面下拉可随时拉取最新数据。</li>
						<li>• <strong className="text-m-text">长按消息气泡：</strong> 可快捷唤出复制、重新生成、分支对话与纠偏菜单。</li>
						<li>• <strong className="text-m-text">下滑收起弹窗：</strong> 底栏与配置弹窗支持拖动把手下滑直接关闭。</li>
						<li>• <strong className="text-m-text">斜杠快捷指令：</strong> 在输入框输入 <code className="font-m-mono text-m-accent">/</code> 即可触发内置快捷技能。</li>
					</ul>
				</div>

				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="flex items-center gap-2">
						<Layers size={18} className="text-m-accent" />
						<h3 className="text-m-sm font-semibold text-m-text">多 Agent 协作工作流</h3>
					</div>
					<p className="text-m-xs text-m-text-3 leading-relaxed">
						主会话负责统筹分解大目标，通过 <code className="font-m-mono text-m-accent">task</code> 工具分发子任务给专属子代理（如 scout 负责检索，reviewer 负责审查代码），子任务独立执行并在完成后汇总。
					</p>
				</div>

				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="flex items-center gap-2">
						<HelpCircle size={18} className="text-m-accent" />
						<h3 className="text-m-sm font-semibold text-m-text">常见问题与技巧 (FAQ)</h3>
					</div>
					<div className="space-y-2 text-m-xs text-m-text-3 leading-relaxed">
						<div>
							<strong className="text-m-text">Q: 配额信息多久更新一次？</strong>
							<p>A: 进入「订阅与配额」页面时会自动拉取，亦可点击右上角刷新按钮随时同步。</p>
						</div>
						<div>
							<strong className="text-m-text">Q: 手机端能直接修改电脑上的代码吗？</strong>
							<p>A: 可以。手机端与电脑客户端实时同步，所有文件读写与命令均在电脑本地安全运行。</p>
						</div>
					</div>
				</div>
			</div>
		</BottomSheet>
	);
}
