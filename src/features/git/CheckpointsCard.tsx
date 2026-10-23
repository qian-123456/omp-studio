/**
 * First-use consent card for turn checkpoints ([C], contract §Feature).
 * Shown at the top of the selected worktree pane while
 * `settings.turnCheckpoints` is null (never asked). 开启/暂不 both persist the
 * choice through the shared settings store — once answered the card is gone.
 * The 「查看规则原文」 disclosure shows the exact rule text the extension
 * injects into app-launched sessions.
 */
import { useEffect, useState } from "react";
import { checkpointsRule } from "../../lib/ipc";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { ensureSettings, useSettings } from "../settings/store";
export function CheckpointsCard() {

	// undefined while settings load → hide until the answer is known.
	const answered = useSettings((s) => s.settings?.turnCheckpoints) !== null;
	const update = useSettings((s) => s.update);
	const [rule, setRule] = useState<string | null>(null);
	const [ruleError, setRuleError] = useState(false);
	const [ruleOpen, setRuleOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(ensureSettings, []);
	if (answered) return null;

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

	const answer = async (enable: boolean) => {
		setBusy(true);
		try {
			await update({ turnCheckpoints: enable });
			if (enable) toast.success("已开启对话检查点，新会话自动生效");
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="m-2.5 mb-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3">
			<div className="text-xs font-medium text-neutral-100">开启对话检查点</div>
			<div className="mt-1 text-[11px] leading-relaxed text-neutral-400">
				每轮对话自动留底，改坏了能一键撤回；Agent 做完并验证通过后会自动存档（不会推送到远端）。
				<div className="mt-0.5 text-neutral-500">对之后新开的会话生效。</div>
			</div>
			<div className="mt-2 flex items-center gap-2">
				<button
					type="button"
					disabled={busy}
					onClick={() => void answer(true)}
					className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
				>
					开启
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => void answer(false)}
					className="rounded px-2.5 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
				>
					暂不
				</button>
				<button
					type="button"
					aria-expanded={ruleOpen}
					onClick={() => void toggleRule()}
					className="ml-auto text-[11px] text-neutral-500 transition-colors hover:text-neutral-300"
				>
					查看规则原文
				</button>
			</div>
			{ruleOpen && (
				<pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-neutral-950/70 p-2 font-mono text-[10px] leading-relaxed text-neutral-400">
					{rule ?? (ruleError ? "规则文本读取失败" : "加载中…")}
				</pre>
			)}
		</div>
	);
}
