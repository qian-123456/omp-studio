import { describe, expect, it } from "vitest";
import {
	defaultState,
	listAdd,
	listDedupe,
	listMove,
	listRemove,
	lookupDotPath,
	parseJsonFor,
	parseProjectConfig,
	recordToRows,
	rowsToRecord,
} from "./ompConfigEdit";
import { OMP_CONFIG_DEFAULTS } from "./ompConfigDefaults";

describe("defaultState", () => {
	const defaults = { a: true, list: [], unset: null, obj: { x: 1, y: [2] } };
	it("detects default vs modified with structural equality", () => {
		expect(defaultState("a", true, false, defaults)).toBe("default");
		expect(defaultState("a", false, false, defaults)).toBe("modified");
		expect(defaultState("list", [], false, defaults)).toBe("default");
		expect(defaultState("list", ["x"], false, defaults)).toBe("modified");
		expect(defaultState("obj", { y: [2], x: 1 }, false, defaults)).toBe("default");
		expect(defaultState("obj", { x: 1, y: [3] }, false, defaults)).toBe("modified");
	});
	it("treats unset (null/undefined) as equal to a null default", () => {
		expect(defaultState("unset", undefined, false, defaults)).toBe("default");
		expect(defaultState("unset", "", false, defaults)).toBe("modified");
	});
	it("is unknown for missing defaults and redacted values", () => {
		expect(defaultState("nope", 1, false, defaults)).toBe("unknown");
		expect(defaultState("a", true, true, defaults)).toBe("unknown");
	});
	it("ships extracted schema defaults", () => {
		expect(OMP_CONFIG_DEFAULTS["advisor.immuneTurns"]).toBe(3);
	});
});

describe("string list transforms", () => {
	it("adds trimmed, deduped, comma/newline-split items", () => {
		expect(listAdd(["a"], " b , a,\n c ,, ")).toEqual(["a", "b", "c"]);
	});
	it("removes, moves within bounds, dedupes", () => {
		expect(listRemove(["a", "b", "c"], 1)).toEqual(["a", "c"]);
		expect(listMove(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
		expect(listMove(["a", "b", "c"], 2, -2)).toEqual(["c", "a", "b"]);
		expect(listMove(["a", "b"], 0, -1)).toEqual(["a", "b"]);
		expect(listDedupe(["a", "b", "a"])).toEqual(["a", "b"]);
	});
});

describe("record rows", () => {
	it("round-trips string and nested values", () => {
		const value = { s: "x", n: 2, o: { k: [1] } };
		const rows = recordToRows(value);
		expect(rows.map((r) => r.kind)).toEqual(["string", "json", "json"]);
		expect(rowsToRecord(rows)).toEqual({ ok: true, value });
	});
	it("rejects empty keys, duplicates and invalid JSON with the row index", () => {
		expect(rowsToRecord([{ key: " ", text: "v", kind: "string" }])).toMatchObject({ ok: false, index: 0 });
		expect(rowsToRecord([{ key: " ", text: "", kind: "string" }])).toEqual({ ok: true, value: {} });
		expect(
			rowsToRecord([
				{ key: "a", text: "1", kind: "string" },
				{ key: " a ", text: "2", kind: "string" },
			]),
		).toMatchObject({ ok: false, index: 1 });
		expect(rowsToRecord([{ key: "a", text: "{", kind: "json" }])).toMatchObject({ ok: false, index: 0 });
	});
});

describe("parseJsonFor", () => {
	it("validates shape per value type", () => {
		expect(parseJsonFor("array", '["a"]')).toEqual({ ok: true, value: ["a"] });
		expect(parseJsonFor("array", "{}").ok).toBe(false);
		expect(parseJsonFor("record", "[]").ok).toBe(false);
		expect(parseJsonFor("record", "")).toEqual({ ok: true, value: {} });
		expect(parseJsonFor("record", "{bad").ok).toBe(false);
	});
});

describe("project override lookup", () => {
	const cfg = parseProjectConfig(
		"compaction:\n  enabled: false\ntask:\n  agentModelOverrides:\n    scout: a/b\n'retry.maxRetries': 7\nimages:\n  urls.credentials: {}\n",
	);
	it("finds nested and literal dotted keys", () => {
		expect(lookupDotPath(cfg, "compaction.enabled")).toEqual({ found: true, value: false });
		expect(lookupDotPath(cfg, "task.agentModelOverrides")).toEqual({ found: true, value: { scout: "a/b" } });
		expect(lookupDotPath(cfg, "retry.maxRetries")).toEqual({ found: true, value: 7 });
		expect(lookupDotPath(cfg, "images.urls.credentials")).toEqual({ found: true, value: {} });
	});
	it("misses absent keys and tolerates bad YAML", () => {
		expect(lookupDotPath(cfg, "compaction.strategy").found).toBe(false);
		expect(parseProjectConfig(": : [")).toEqual({});
		expect(parseProjectConfig("- a")).toEqual({});
	});
});
