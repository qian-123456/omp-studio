import { describe, expect, it } from "vitest";
import {
	type AskDriverState,
	type AskSpec,
	askResultSummary,
	findOpenAsks,
	matchRequest,
	OTHER_OPTION,
	parseAskArgs,
	resolveRequest,
	unansweredQuestions,
	type AskAnswer,
} from "./askDriver";

const spec = (questions: unknown[]): AskSpec => {
	const s = parseAskArgs("call-1", { questions });
	if (!s) throw new Error("bad spec");
	return s;
};

const colour = {
	id: "c",
	question: "Pick a colour",
	options: [{ label: "Red" }, { label: "Blue", description: "calm" }],
	recommended: 1,
};
const langs = {
	id: "l",
	question: "Languages?",
	multi: true,
	options: [{ label: "TS" }, { label: "Rust" }, { label: "Go" }],
};
const DONE = "✓ Done selecting";

const select = (id: string, title: string, options: string[]) => ({
	type: "extension_ui_request",
	id,
	method: "select",
	title,
	options,
});

/** Drive a request through matchRequest + resolveRequest. */
function step(s: AskSpec, req: unknown, state?: AskDriverState) {
	const m = matchRequest(s, req);
	if (!m) return null;
	return resolveRequest(s.questions[m.qIndex], m, state);
}

describe("ask driver", () => {
	it("single-select answers with the decorated raw option", () => {
		const s = spec([colour]);
		const req = select("r1", "Pick a colour", ["Red", "Blue (Recommended)", OTHER_OPTION]);
		expect(step(s, req)).toEqual({ kind: "present" });
		const state = { answer: { selected: ["Blue"], custom: "" }, toggled: [] };
		expect(step(s, req, state)).toMatchObject({ kind: "auto", value: "Blue (Recommended)" });
	});

	it("Other goes through select then editor with the custom text", () => {
		const s = spec([colour]);
		const state = { answer: { selected: [], custom: " green " }, toggled: [] };
		const sel = select("r1", "Pick a colour", ["Red", "Blue (Recommended)", OTHER_OPTION]);
		expect(step(s, sel, state)).toMatchObject({ kind: "auto", value: OTHER_OPTION });
		const ed = { id: "r2", method: "editor", title: "Pick a colour" };
		expect(step(s, ed, state)).toMatchObject({ kind: "auto", value: "green" });
		// Editor without driver state (e.g. after reload) is not presentable.
		expect(step(s, ed)).toEqual({ kind: "fallback" });
	});

	it("multi-select toggles each label across re-sent selects, then Done", () => {
		const s = spec([langs]);
		let state: AskDriverState = {
			answer: { selected: ["TS", "Go"], custom: "" },
			toggled: [],
		};
		const values: string[] = [];
		let k = 0;
		for (let i = 0; i < 5; i++) {
			const title = k ? `(${k} selected) Languages?` : "Languages?";
			const opts = ["TS", "Rust", "Go", ...(k ? [DONE] : []), OTHER_OPTION];
			const r = step(s, select(`r${i}`, title, opts), state);
			if (r?.kind !== "auto") throw new Error(`unexpected ${r?.kind}`);
			values.push(r.value);
			if (r.value === DONE) break;
			state = { ...state, toggled: r.toggled };
			k = r.toggled.length;
		}
		expect(values).toEqual(["TS", "Go", DONE]);
	});

	it("multi-select falls back when omp's count disagrees with our toggles", () => {
		const s = spec([langs]);
		const req = select("r", "(2 selected) Languages?", ["TS", "Rust", "Go", DONE, OTHER_OPTION]);
		expect(step(s, req)).toEqual({ kind: "fallback" });
		const state = { answer: { selected: ["TS"], custom: "" }, toggled: [] };
		expect(step(s, req, state)).toEqual({ kind: "fallback" });
	});

	it("multi-question: indexes by (i/N) and ends multi loops via Other", () => {
		const s = spec([colour, langs]);
		const q1 = select("a", "Pick a colour (1/2)", ["Red", "Blue (Recommended)", OTHER_OPTION]);
		expect(matchRequest(s, q1)?.qIndex).toBe(0);
		const q2 = select("b", "(1 selected) Languages? (2/2)", ["TS", "Rust", "Go", OTHER_OPTION]);
		const m = matchRequest(s, q2);
		expect(m).toMatchObject({ qIndex: 1, total: 2, selectedCount: 1, doneOption: null });
		const state = { answer: { selected: ["Rust"], custom: "" }, toggled: ["Rust"] };
		expect(step(s, q2, state)).toMatchObject({ kind: "auto", value: OTHER_OPTION });
		const ed = { id: "c", method: "editor", title: "Languages? (2/2)" };
		expect(step(s, ed, state)).toMatchObject({ kind: "auto", value: "Selected: Rust" });
	});

	it("does not match unrelated or mismatched requests", () => {
		const s = spec([colour, langs]);
		expect(matchRequest(s, select("x", "Allow bash?", ["Allow", "Deny"]))).toBeNull();
		// Missing (i/N) suffix with N>1.
		expect(matchRequest(s, select("x", "Pick a colour", ["Red", "Blue", OTHER_OPTION]))).toBeNull();
		// Option set differs.
		expect(
			matchRequest(s, select("x", "Pick a colour (1/2)", ["Red", "Green", OTHER_OPTION])),
		).toBeNull();
		expect(matchRequest(s, { id: "x", method: "confirm", title: "Pick a colour (1/2)" })).toBeNull();
	});

	it("finds only unanswered ask calls, live first", () => {
		const args = { questions: [colour] };
		const items = [
			{ toolCalls: [{ id: "old", name: "ask", args, intent: null }], toolResult: null },
			{ toolCalls: [], toolResult: { toolCallId: "old" } },
			{ toolCalls: [{ id: "open", name: "ask", args, intent: null }], toolResult: null },
		] as never;
		const live = [{ toolCallId: "live", toolName: "ask", args, status: "running" }];
		expect(findOpenAsks(live, items).map((a) => a.toolCallId)).toEqual(["live", "open"]);
	});

	it("summarises single and multi-question results", () => {
		expect(
			askResultSummary({ question: "Q", selectedOptions: ["A", "B"], customInput: "c" }),
		).toEqual([{ question: "Q", answer: "A、B、c" }]);
		expect(askResultSummary({ results: [{ question: "Q1", selectedOptions: ["x"] }] })).toEqual([
			{ question: "Q1", answer: "x" },
		]);
		expect(askResultSummary({ foo: 1 })).toBeNull();
	});

	it("replays a whole multi-question answer in order against omp's protocol", () => {
		const s = spec([colour, langs, { ...colour, id: "c2", question: "Second colour" }]);
		const answers: AskAnswer[] = [
			{ selected: ["Blue"], custom: "" },
			{ selected: ["Go", "TS"], custom: "only backend" },
			{ selected: [], custom: "teal" },
		];
		const { sent, results } = simulateOmp(s, answers);
		expect(sent).toEqual([
			"Blue (Recommended)",
			"Go",
			"TS",
			OTHER_OPTION,
			"Selected: Go, TS; note: only backend",
			OTHER_OPTION,
			"teal",
		]);
		expect(results).toEqual([
			{ selected: ["Blue"] },
			{ custom: "Selected: Go, TS; note: only backend" },
			{ custom: "teal" },
		]);
	});

	it("single-question multi ends with Done, or Other when submitted empty", () => {
		const s = spec([langs]);
		expect(simulateOmp(s, [{ selected: ["Rust"], custom: "" }]).results).toEqual([
			{ selected: ["Rust"] },
		]);
		expect(simulateOmp(s, [{ selected: [], custom: "" }]).results).toEqual([
			{ custom: "Selected: none" },
		]);
	});

	it("reports unanswered questions from the pending one onward", () => {
		const s = spec([colour, langs, colour]);
		const a: (AskAnswer | undefined)[] = [];
		a[1] = { selected: [], custom: "" };
		expect(unansweredQuestions(s, a, 0)).toEqual([0, 2]);
		expect(unansweredQuestions(s, a, 1)).toEqual([2]);
		a[2] = { selected: [], custom: "x" };
		expect(unansweredQuestions(s, a, 1)).toEqual([]);
	});
});

/** Minimal model of omp's RPC ask flow driven by the driver's responses. */
function simulateOmp(s: AskSpec, answers: AskAnswer[]) {
	const n = s.questions.length;
	const states = new Map<number, AskDriverState>(
		answers.map((answer, i) => [i, { answer, toggled: [] }]),
	);
	const sent: string[] = [];
	const results: { selected?: string[]; custom?: string }[] = [];
	let seq = 0;
	const ask = (req: Record<string, unknown>): string => {
		const m = matchRequest(s, { id: `r${seq++}`, ...req });
		if (!m) throw new Error(`unmatched ${JSON.stringify(req)}`);
		const st = states.get(m.qIndex);
		const r = resolveRequest(s.questions[m.qIndex], m, st);
		if (r.kind !== "auto") throw new Error(`driver stalled on ${JSON.stringify(req)}`);
		if (st) states.set(m.qIndex, { ...st, toggled: r.toggled });
		sent.push(r.value);
		return r.value;
	};
	s.questions.forEach((q, i) => {
		const suffix = n > 1 ? ` (${i + 1}/${n})` : "";
		const labels = q.options.map((o, j) => (j === q.recommended ? `${o.label} (Recommended)` : o.label));
		const other = () => {
			results.push({ custom: ask({ method: "editor", title: q.question + suffix }) });
		};
		if (!q.multi) {
			const v = ask({ method: "select", title: q.question + suffix, options: [...labels, OTHER_OPTION] });
			if (v === OTHER_OPTION) other();
			else results.push({ selected: [v.replace(" (Recommended)", "")] });
			return;
		}
		const chosen: string[] = [];
		for (let guard = 0; guard < 20; guard++) {
			const k = chosen.length;
			const title = `${k ? `(${k} selected) ` : ""}${q.question}${suffix}`;
			const done = k > 0 && n === 1 ? ["✓ Done selecting"] : [];
			const v = ask({ method: "select", title, options: [...labels, ...done, OTHER_OPTION] });
			if (v === OTHER_OPTION) return other();
			if (done.includes(v)) return results.push({ selected: chosen });
			const l = v.replace(" (Recommended)", "");
			const at = chosen.indexOf(l);
			if (at >= 0) chosen.splice(at, 1);
			else chosen.push(l);
		}
		throw new Error("multi loop did not finish");
	});
	return { sent, results };
}
