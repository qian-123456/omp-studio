/** Thinking-level chip + popover shared by the main composer and the side chat.
 * The visible label is the raw omp level name (low/high/xhigh/…, matching the
 * omp TUI); descriptions are tooltips / secondary row text. */

import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { useRef } from "react";
import { FloatingLayer } from "./FloatingLayer";

const THINKING_DESCS: Record<string, string> = {
	auto: "跟随模型的默认力度",
	off: "不启用深度推理思考",
	minimal: "轻度推理，适合简单问答",
	low: "较少推理步骤，响应较快",
	medium: "均衡推理与响应速度",
	high: "完整多步推理，适合复杂分析",
	xhigh: "高强度推理，适合复杂推演",
	max: "无限制深度推理，耗费最多预算",
};

export function thinkingLabel(level: string): { label: string; desc: string } {
	return { label: level, desc: THINKING_DESCS[level] ?? "" };
}

export function ThinkingLevelPicker({
	levels,
	value,
	open,
	onOpenChange,
	onSelect,
}: {
	levels: string[];
	value: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (level: string) => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const cur = thinkingLabel(value);
	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				onClick={() => onOpenChange(!open)}
				title={`思考等级: ${cur.label}${cur.desc ? ` (${cur.desc})` : ""}`}
				className="flex select-none items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]"
			>
				<span className="truncate">{cur.label}</span>
				<ChevronDown size={10} className="shrink-0 text-[var(--text-30,var(--text-dim))]" />
			</button>
			{open && (
				<FloatingLayer
					anchor={ref.current}
					placement="top-start"
					offset={6}
					layer="popover"
					ignoreRefs={[ref]}
					onDismiss={() => onOpenChange(false)}
					className="w-[260px] rounded-xl border-[var(--line,var(--border-divider))] !bg-[var(--bg-panel)] py-1"
				>
					<div className="border-b border-[var(--line,var(--border-divider))] px-2.5 py-1.5 text-[11px] text-[var(--text-40,var(--text-dim))]">
						思考等级
					</div>
					<div className="py-0.5">
						{levels.map((level) => {
							const opt = thinkingLabel(level);
							const selected = value === level;
							return (
								<button
									key={level}
									type="button"
									onClick={() => onSelect(level)}
									className={clsx(
										"flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs transition-colors",
										selected
											? "bg-[var(--bg-active-fill)] text-[var(--text)]"
											: "text-[var(--text-60,var(--text-muted))] hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]",
									)}
								>
									<div className="min-w-0 pr-2">
										<div className="font-medium">{opt.label}</div>
										{opt.desc && (
											<div className="text-[10px] text-[var(--text-40,var(--text-dim))]">{opt.desc}</div>
										)}
									</div>
									{selected && (
										<Check size={13} className="shrink-0 text-[var(--text-60,var(--text-muted))]" />
									)}
								</button>
							);
						})}
					</div>
				</FloatingLayer>
			)}
		</div>
	);
}
