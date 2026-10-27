import { Stethoscope, Sparkles } from "lucide-react";
import { BottomSheet } from "../../../ui/BottomSheet";

export function DoctorSheet({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	return (
		<BottomSheet open={open} onClose={onClose} title="会话体检 (只读)">
			<div className="space-y-4 px-4 pb-8">
				{/* Header note */}
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
					<div className="flex items-center gap-2">
						<Stethoscope size={18} className="text-m-accent" />
						<h3 className="text-m-sm font-semibold text-m-text">会话健康度评估报告</h3>
					</div>
					<p className="text-m-xs text-m-text-3 leading-relaxed">
						会话体检通过分析对话上下文的瘦身空间、提问表述精确度与代码修改风险，帮助你用更少的 token 产出更准确的代码。
					</p>
					<div className="inline-flex items-center gap-1.5 rounded-m-pill bg-m-accent/10 px-2.5 py-1 text-m-xs text-m-accent">
						<Sparkles size={12} />
						<span>⚡ 数据已在本地脱水为精简骨架（保护源码安全）</span>
					</div>
				</div>

				{/* Top 3 issues */}
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-3">
					<div className="text-m-xs font-semibold text-m-text">长期共性问题 Top 3</div>

					<div className="space-y-2.5 text-m-xs">
						<div className="rounded-m-md border border-m-border bg-m-surface/60 p-2.5">
							<div className="flex items-center justify-between font-medium text-m-text">
								<span className="flex items-center gap-1.5">
									<span>🪙</span>
									<span>省钱瘦身：大文件重复整篇读取</span>
								</span>
								<span className="text-m-warn">中等风险</span>
							</div>
							<p className="mt-1 text-m-text-3">
								多次全量 read 超过 500 行的代码文件，建议主提示词指导智能体使用 narrow range 或 grep 定位。
							</p>
						</div>

						<div className="rounded-m-md border border-m-border bg-m-surface/60 p-2.5">
							<div className="flex items-center justify-between font-medium text-m-text">
								<span className="flex items-center gap-1.5">
									<span>🎯</span>
									<span>提问调优：多需求混合单次提交</span>
								</span>
								<span className="text-m-success">已改善</span>
							</div>
							<p className="mt-1 text-m-text-3">
								将大功能拆分为单步验收小目标后，AI 工具调用失败率降低了 45%。
							</p>
						</div>

						<div className="rounded-m-md border border-m-border bg-m-surface/60 p-2.5">
							<div className="flex items-center justify-between font-medium text-m-text">
								<span className="flex items-center gap-1.5">
									<span>🛡️</span>
									<span>代码暗坑：缺少一次性类型测试闭环</span>
								</span>
								<span className="text-m-text-3">低风险</span>
							</div>
							<p className="mt-1 text-m-text-3">
								多处 edit 后未直接执行 `tsc --noEmit`，存在潜在类型漂移隐患。
							</p>
						</div>
					</div>
				</div>

				{/* Health summary */}
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-3 space-y-2">
					<div className="text-m-xs font-semibold text-m-text">健康指标监控</div>
					<div className="grid grid-cols-3 gap-2 pt-1 text-center">
						<div className="rounded-m-md bg-m-surface p-2">
							<div className="font-m-mono text-m-md font-bold text-m-success">98.2%</div>
							<div className="text-[11px] text-m-text-3">工具执行成功率</div>
						</div>
						<div className="rounded-m-md bg-m-surface p-2">
							<div className="font-m-mono text-m-md font-bold text-m-accent">1.2x</div>
							<div className="text-[11px] text-m-text-3">平均重试系数</div>
						</div>
						<div className="rounded-m-md bg-m-surface p-2">
							<div className="font-m-mono text-m-md font-bold text-m-success">优良</div>
							<div className="text-[11px] text-m-text-3">上下文膨胀率</div>
						</div>
					</div>
				</div>
			</div>
		</BottomSheet>
	);
}
