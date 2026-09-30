/**
 * Settings ▸ 对话检查点 ([C], contract §Feature).
 * A Switch bound to `settings.turnCheckpoints` (null = never asked → treated as
 * off here), the injected auto-commit rule text as a disclosure, and the note
 * that the change only applies to newly started sessions.
 */
import { useState } from "react";
import { checkpointsRule } from "../../lib/ipc";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useSettings } from "./store";
import { Switch } from "./Switch";

export function CheckpointsSection() {
	const enabled = useSettings((s) => s.settings?.turnCheckpoints) === true;
	const update = useSettings((s) => s.update);
	const [rule, setRule] = useState<string | null>(null);
	const [ruleError, setRuleError] = useState(false);
	const [ruleOpen, setRuleOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const toggle = async (next: boolean) => {
		setBusy(true);
		try {
			await update({ turnCheckpoints: next });
		} catch (e) {
			toast.error(`保存失败: ${errMsg(e)}`);
		} finally {
			setBusy(false);
		}
	};

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
		<div
			data-field-id="turnCheckpoints"
			className="space-y-4 rounded-xl hairline bg-[var(--bg-panel)] p-4 shadow-apple-card transition-all"
		>
			<div className="flex items-center justify-between gap-4">
				<div>
					<div className="text-xs font-medium text-neutral-200">对话检查点</div>
					<div className="text-[11px] text-neutral-400">
						每一轮对话悄悄保存现场，可「撤回这一轮」；Agent 同时遵守自动存档规则（验证通过后把自己的改动保存成版本）
					</div>
				</div>
				<Switch checked={enabled} onChange={(v) => void toggle(v)} disabled={busy} />
			</div>

			<div className="border-t border-[var(--border-divider)] pt-4">
				<button
					type="button"
					aria-expanded={ruleOpen}
					onClick={() => void toggleRule()}
					className="text-[11px] text-neutral-400 transition-colors hover:text-neutral-200"
				>
					{ruleOpen ? "收起规则原文" : "查看规则原文"}（Agent 会收到这些指令）
				</button>
				{ruleOpen && (
					<pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[var(--well-bg)] hairline p-3 font-mono text-[11px] leading-relaxed text-neutral-300">
						{rule ?? (ruleError ? "规则文本读取失败" : "加载中…")}
					</pre>
				)}
			</div>

			<div className="border-t border-[var(--border-divider)] pt-4 text-[11px] text-neutral-500">
				只对在本应用里开的会话生效；改动对新开的会话生效，已在进行的会话不受影响。
			</div>
		</div>
	);
}
