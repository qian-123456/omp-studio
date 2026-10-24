/**
 * Feedback text for a model pick in the composer. omp applies `set_model`
 * to the session immediately (and records a `model_change` entry), but a turn
 * that is already running keeps the model it started with — the new one is
 * used from the next request. Say so instead of a bare "switched".
 */
import { formatShortModel } from "./turnGrouping";

export function modelSwitchNotice(
	modelKey: string,
	turnRunning: boolean,
): { kind: "success" | "info"; text: string; ttlMs?: number } {
	const name = formatShortModel(modelKey) || modelKey;
	if (turnRunning) {
		return {
			kind: "info",
			text: `已切换到 ${name}。当前这一轮仍由原模型完成，下一轮起使用新模型`,
			ttlMs: 7000,
		};
	}
	return { kind: "success", text: "已切换模型" };
}
