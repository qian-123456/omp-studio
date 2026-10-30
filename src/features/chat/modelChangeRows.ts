/** Client-side 「已切换模型」 dividers for a confirmed model switch.
 *
 * omp persists the `model_change` entry only after emitting `model_changed`, and
 * the transcript is not re-read until the turn ends. The store records the
 * confirmed switch from get_state / set_model; this splices it into the thread
 * at once and drops it as soon as the transcript carries the persisted entry
 * for the same model after the notice's anchor. */

import { tNow } from "../../stores/language";
import type { TranscriptItem } from "../../lib/contracts";
import { resolveCurrentModel } from "../../lib/models";
import type { ModelSwitchNotice } from "../../stores/live";

const ID_PREFIX = "model-notice-";

const noticeItem = (n: ModelSwitchNotice): TranscriptItem => ({
	id: `${ID_PREFIX}${n.id}`,
	parentId: null,
	ts: new Date(n.ts).toISOString(),
	kind: "model_change",
	text: n.pending ? tNow("chat.modelSwitch.appliesNextRequest") : null,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: n.model,
	stopReason: null,
	hidden: false,
});

export function withModelNotices(
	items: TranscriptItem[],
	notices: readonly ModelSwitchNotice[] | undefined,
): TranscriptItem[] {
	if (!notices || notices.length === 0) return items;
	const anchorIndex = new Map<string, number>();
	items.forEach((it, i) => anchorIndex.set(it.id, i));
	const after = new Map<number, ModelSwitchNotice[]>(); // item index (-1 = head) → notices
	for (const n of notices) {
		const idx = n.anchorId === null ? -1 : (anchorIndex.get(n.anchorId) ?? items.length - 1);
		const persisted = items
			.slice(idx + 1)
			.some((it) => it.kind === "model_change" && resolveCurrentModel(it.model).value === n.model);
		if (persisted) continue;
		after.set(idx, [...(after.get(idx) ?? []), n]);
	}
	if (after.size === 0) return items;
	const out: TranscriptItem[] = [];
	for (const n of after.get(-1) ?? []) out.push(noticeItem(n));
	items.forEach((it, i) => {
		out.push(it);
		for (const n of after.get(i) ?? []) out.push(noticeItem(n));
	});
	return out;
}
