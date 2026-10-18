/** Thinking-level chip + popover shared by the main composer, the side chat,
 * schedules and settings. The visible label is the raw omp level name
 * (low/high/xhigh/…, matching the omp TUI); descriptions are tooltips /
 * secondary row text. When there are no levels the chip never disappears: it
 * is 「未配置思考等级」 (reasoning model, opens settings) or 「不支持思考」. */

import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import { useRef } from "react";
import { openSettingsTarget } from "../features/settings/settingsTargets";
import { thinkingChipState } from "../lib/models";
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
	reasoning,
	value,
	open,
	onOpenChange,
	onSelect,
	onConfigure = () => openSettingsTarget("providers"),
}: {
	/** Resolved levels (`resolveThinkingLevels`); empty = no levels for this model. */
	levels: string[];
	/** Catalog `reasoning` flag of the selected model; decides the chip when `levels` is empty. */
	reasoning?: boolean | null;
	value: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (level: string) => void;
	/** Opens model settings from the 「未配置思考等级」 chip; defaults to Settings ▸ API 供应商. */
	onConfigure?: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const cur = thinkingLabel(value);
	const chip = thinkingChipState(levels, reasoning);
	if (chip.kind === "unsupported") {
		return (
			<span
				title="这个模型不支持思考，没有可调的思考等级"
				className="shrink-0 select-none rounded-full bg-[var(--well-bg,var(--bg-hover))] px-2 py-0.5 text-[12px] text-[var(--text-30,var(--text-dim))]"
			>
				不支持思考
			</span>
		);
	}
	if (chip.kind === "unconfigured") {
		return (
			<button
				type="button"
				onClick={onConfigure}
				title="这个模型能思考，但没有配置思考等级。点击去供应商设置里补上"
				className="shrink-0 select-none rounded-full border border-[var(--line,var(--border-divider))] bg-[var(--well-bg,var(--bg-hover))] px-2 py-0.5 text-[12px] text-[var(--text-40,var(--text-dim))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]"
			>
				未配置思考等级
			</button>
		);
	}
	return (
		<div className="relative shrink-0" ref={ref}>
			<button
				type="button"
				onClick={() => onOpenChange(!open)}
				title={`思考等级: ${cur.label}${cur.desc ? ` (${cur.desc})` : ""}`}
				className="flex select-none items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]"
			>
				<span>{cur.label}</span>
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
