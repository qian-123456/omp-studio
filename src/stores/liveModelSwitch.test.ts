import { beforeEach, describe, expect, it } from "vitest";
import type { TranscriptItem } from "../lib/contracts";
import { withModelNotices } from "../features/chat/modelChangeRows";
import { useLive } from "./live";

const SID = "s1";
const frame = (f: Record<string, unknown>) => useLive.getState().reduceFrame({ sessionId: SID, frame: f });
const live = () => useLive.getState().sessions[SID];
const state = (model: unknown, extra: Record<string, unknown> = {}) =>
	frame({ type: "response", command: "get_state", success: true, data: { model, isStreaming: false, ...extra } });

const item = (id: string, kind: TranscriptItem["kind"], extra: Partial<TranscriptItem> = {}) =>
	({
		id,
		parentId: null,
		ts: "2026-10-29T10:00:00.000Z",
		kind,
		text: null,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		...extra,
	}) as TranscriptItem;

beforeEach(() => {
	useLive.setState({ sessions: {} });
});

describe("model switch notice", () => {
	const seed = () => {
		useLive.getState().setItems(SID, [item("u1", "user"), item("a1", "assistant")], 10);
		state({ provider: "p", id: "m1" });
	};

	it("payload-less model_changed + new get_state yields exactly one notice", () => {
		seed();
		frame({ type: "model_changed" });
		expect(live().modelNotices ?? []).toHaveLength(0);
		state({ provider: "p", id: "m2" });
		expect(live().modelNotices).toMatchObject([{ model: "p/m2", anchorId: "a1" }]);
		// The same state reported again (e.g. after turn_end) adds nothing.
		state({ provider: "p", id: "m2" });
		expect(live().modelNotices).toHaveLength(1);
	});

	it("a no-op get_state (same model) adds no notice", () => {
		seed();
		frame({ type: "model_changed" });
		state({ provider: "p", id: "m1" });
		expect(live().modelNotices ?? []).toHaveLength(0);
	});

	it("the first snapshot of a session and an empty session never notice", () => {
		state({ provider: "p", id: "m1" });
		state({ provider: "p", id: "m2" });
		expect(live().modelNotices ?? []).toHaveLength(0);
	});

	it("a successful set_model notices once; the following get_state does not repeat it", () => {
		seed();
		frame({ type: "response", command: "set_model", success: true, data: { provider: "p", id: "m3" } });
		expect(live().modelNotices).toHaveLength(1);
		state({ provider: "p", id: "m3" });
		expect(live().modelNotices).toHaveLength(1);
		expect(live().state?.model).toEqual({ provider: "p", id: "m3" });
	});

	it("a failed set_model changes nothing", () => {
		seed();
		frame({ type: "response", command: "set_model", success: false, error: "Model not found" });
		expect(live().modelNotices ?? []).toHaveLength(0);
	});

	it("notices mid-turn too (applies from the next request)", () => {
		seed();
		state({ provider: "p", id: "m2" }, { isStreaming: true });
		expect(live().modelNotices).toHaveLength(1);
	});
});

describe("withModelNotices", () => {
	const items = [item("u1", "user"), item("a1", "assistant"), item("u2", "user")];
	const notice = { id: 1, model: "p/m2", anchorId: "a1", ts: Date.parse("2026-10-29T10:00:05.000Z") };

	it("splices a model_change divider right after its anchor", () => {
		const out = withModelNotices(items, [notice]);
		expect(out.map((i) => i.id)).toEqual(["u1", "a1", "model-notice-1", "u2"]);
		expect(out[2]).toMatchObject({ kind: "model_change", model: "p/m2" });
	});

	it("is replaced by the persisted model_change for the same model", () => {
		const persisted = [...items, item("m", "model_change", { model: "p/m2" })];
		expect(withModelNotices(persisted, [notice])).toBe(persisted);
	});

	it("a persisted entry for another model does not hide the notice", () => {
		const persisted = [...items, item("m", "model_change", { model: "p/other" })];
		expect(withModelNotices(persisted, [notice])).toHaveLength(5);
	});

	it("an older persisted entry before the anchor does not hide it", () => {
		const persisted = [item("m", "model_change", { model: "p/m2" }), ...items];
		expect(withModelNotices(persisted, [notice])).toHaveLength(5);
	});
});
