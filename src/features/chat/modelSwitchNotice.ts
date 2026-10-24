/**
 * Feedback text for a model pick in the composer. omp applies `set_model`
 * to the session immediately (and records a `model_change` entry), but a turn
 * that is already running keeps the model it started with — the new one is
 * used from the next request. Say so instead of a bare "switched".
 */
import { formatShortModel } from "./turnGrouping";
import { tNow } from "../../stores/language";

export function modelSwitchNotice(
	modelKey: string,
	turnRunning: boolean,
): { kind: "success" | "info"; text: string; ttlMs?: number } {
	const name = formatShortModel(modelKey) || modelKey;
	if (turnRunning) {
		return {
			kind: "info",
			text: tNow("chat.modelSwitch.switchedToPending", { name }),
			ttlMs: 7000,
		};
	}
	return { kind: "success", text: tNow("chat.modelSwitch.switched") };
}
