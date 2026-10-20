/**
 * Undo of an automatic fallback-model switch: puts the session back on the
 * original model (and thinking level) through the same `set_model` RPC the
 * model picker uses. omp records the switch as a `model_change` entry, which
 * the thread already renders as the 「模型切换 → X」 divider.
 */
import { ensureLive, isResumeCancelled } from "../../lib/ensureLive";
import { errMsg } from "../../lib/dialogs";
import { rpcSend } from "../../lib/ipc";
import { buildSetModelPayload, resolveCurrentModel } from "../../lib/models";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";
import type { FallbackInfo } from "../../stores/retryNotice";

/** The button shows only while the session still sits on the fallback model. */
export function canUndoFallback(fb: FallbackInfo | undefined, stateModel: unknown): boolean {
	if (!fb || fb.undone) return false;
	const cur = resolveCurrentModel(stateModel).value;
	return cur !== "" && (cur === fb.to || fb.to.endsWith(`/${cur}`));
}

export async function undoFallback(sessionId: string, fb: FallbackInfo): Promise<void> {
	const payload = buildSetModelPayload(fb.from);
	if (!payload) {
		toast.error(`无法切回原模型: ${fb.from}`);
		return;
	}
	try {
		if (!useLive.getState().sessions[sessionId]?.alive) await ensureLive(sessionId);
		await rpcSend(sessionId, payload);
		if (fb.thinking) {
			await rpcSend(sessionId, { type: "set_thinking_level", level: fb.thinking });
		}
		await rpcSend(sessionId, { type: "get_state" });
		useLive.getState().markFallbackUndone(sessionId, fb.id);
		toast.success("已切回原模型");
	} catch (err) {
		if (!isResumeCancelled(err)) toast.error(`切回原模型失败: ${errMsg(err)}`);
	}
}
