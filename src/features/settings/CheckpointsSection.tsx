/**
 * Settings ▸ 会话 ▸ 对话检查点 ([C], contract §Feature).
 * Toggle bound to `settings.turnCheckpoints` (null = never asked → treated as
 * off here), plus the injected auto-commit rule text as a disclosure.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Segmented } from "../../components/Segmented";
import { checkpointsRule } from "../../lib/ipc";
import { useAppSettings } from "./useAppSettings";
import { SettingRow, SettingsCard, ToggleRow } from "./ui";

export function CheckpointsSection() {
	const { settings, save } = useAppSettings();
	const [rule, setRule] = useState<string | null>(null);
	const [ruleError, setRuleError] = useState(false);
	const [ruleOpen, setRuleOpen] = useState(false);

	const toggleRule = async () => {
		setRuleOpen((v) => !v);
		if (rule === null && !ruleError) {
			try {
				setRule(await checkpointsRule());
			} catch {
				setRuleError(true);
			}
		}
	};

	return (
		<SettingsCard title="对话检查点" footer="只对在本应用里新开的对话生效；正在进行的对话不受影响。">
			<ToggleRow
				fieldId="turnCheckpoints"
				label="每轮自动存档"
				description="每轮对话前悄悄保存项目现场，改坏了可以「撤回这一轮」。同时 AI 会在验证通过后把自己的改动提交成一个版本。"
				checked={settings?.turnCheckpoints === true}
				onChange={(v) => save({ turnCheckpoints: v })}
			/>
			<ToggleRow
				fieldId="queueAutoSend"
				label="排队消息自动发送"
				description="流式回合中输入的消息排队后，回合结束自动逐条发送；关闭则回合结束后手动确认。"
				checked={settings?.queueAutoSend !== false}
				onChange={(v) => save({ queueAutoSend: v })}
			/>
			<SettingRow
				fieldId="sendShortcut"
				label="发送快捷键"
				description="Enter 发送：按 Enter 直接发送，Shift + Enter 换行。⌘ Enter 发送：按 ⌘ Enter 发送，Enter 与 Shift + Enter 都换行。"
				hint="⌥ + 发送键：仅这一条消息临时改用下面「任务进行中发送新消息」的另一种方式（对话未在运行时无效）"
				control={
					<Segmented
						value={settings?.sendShortcut ?? "enter"}
						onChange={(v) => void save({ sendShortcut: v })}
						options={[
							{ value: "enter", label: "Enter 发送", title: "按 Enter 发送，Shift + Enter 换行" },
							{ value: "mod-enter", label: "⌘ Enter 发送", title: "按 ⌘ Enter 发送，Enter 换行" },
						]}
					/>
				}
			/>
			<SettingRow
				fieldId="followUpBehavior"
				label="任务进行中发送新消息"
				description="AI 还在回复时发送的消息如何处理。引导：消息立即插入正在进行的回合，AI 会据此调整；排队：等这一轮结束后按顺序自动发送；打断后发送：先停止当前回合，再发送这条消息。"
				hint="⌥ + 发送键：仅这一条消息临时切换 引导 ↔ 排队；打断后发送模式下 ⌥ 改为排队"
				control={
					<Segmented
						value={settings?.followUpBehavior ?? "steer"}
						onChange={(v) => void save({ followUpBehavior: v })}
						options={[
							{ value: "steer", label: "引导", title: "消息立即插入正在进行的回合，AI 会据此调整" },
							{ value: "queue", label: "排队", title: "等当前回合结束后按顺序自动发送" },
							{ value: "interrupt", label: "打断后发送", title: "先停止当前回合，再发送这条消息" },
						]}
					/>
				}
			/>
			<SettingRow
				label="AI 收到的存档规则"
				description="开启后，下面这段说明会附加给 AI。"
				onActivate={() => void toggleRule()}
				control={
					<span className="inline-flex items-center gap-1 text-[11px] text-neutral-400" aria-expanded={ruleOpen}>
						{ruleOpen ? "收起" : "查看原文"}
						{ruleOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
					</span>
				}
			>
				{ruleOpen && (
					<pre
						onClick={(e) => e.stopPropagation()}
						className="max-h-64 cursor-text select-text overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--well-bg)] hairline p-3 font-mono text-[11px] leading-relaxed text-neutral-300"
					>
						{rule ?? (ruleError ? "规则文本读取失败" : "加载中…")}
					</pre>
				)}
			</SettingRow>
		</SettingsCard>
	);
}
