import { describe, expect, it } from "vitest";
import type { ModelEntry } from "../../lib/contracts";
import {
	formatTokens,
	modelEntriesToRows,
	modelEntryId,
	modelEntrySpec,
	parseModelEntryLine,
	rowsToModelEntries,
	toModelEntries,
	type ModelRow,
} from "./modelEntry";

describe("modelEntry helpers", () => {
	it("extracts id correctly", () => {
		expect(modelEntryId("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
		expect(
			modelEntryId({ id: "gpt-4o", contextWindow: 128000, maxTokens: 4096 }),
		).toBe("gpt-4o");
	});

	it("normalizes into ModelSpec", () => {
		expect(modelEntrySpec("claude-sonnet-4-5")).toEqual({
			id: "claude-sonnet-4-5",
		});
		expect(
			modelEntrySpec({ id: "gpt-4o", contextWindow: 128000, maxTokens: 4096 }),
		).toEqual({
			id: "gpt-4o",
			contextWindow: 128000,
			maxTokens: 4096,
		});
	});

	it("converts ModelEntry array to editable rows", () => {
		const entries: ModelEntry[] = [
			"claude-sonnet-4-5",
			{ id: "gpt-4o", contextWindow: 128000, maxTokens: 4096 },
			{ id: "gemini-2.5-pro", contextWindow: 2000000 },
		];
		const rows = modelEntriesToRows(entries);
		expect(rows).toEqual([
			{ id: "claude-sonnet-4-5", name: null, contextWindow: "", maxTokens: "" },
			{ id: "gpt-4o", name: null, contextWindow: "128000", maxTokens: "4096" },
			{ id: "gemini-2.5-pro", name: null, contextWindow: "2000000", maxTokens: "" },
		]);
	});

	it("converts editable rows back to ModelEntry array", () => {
		const rows: ModelRow[] = [
			{ id: "claude-sonnet-4-5", contextWindow: "", maxTokens: "" },
			{ id: "gpt-4o", contextWindow: "128000", maxTokens: "4096" },
			{ id: "gemini-2.5-pro", contextWindow: "2000000", maxTokens: "" },
			{ id: "invalid-limits", contextWindow: "abc", maxTokens: "-5" },
			{ id: "  ", contextWindow: "100", maxTokens: "100" }, // should skip blank id
		];
		const entries = rowsToModelEntries(rows);
		expect(entries).toEqual([
			"claude-sonnet-4-5",
			{ id: "gpt-4o", contextWindow: 128000, maxTokens: 4096 },
			{ id: "gemini-2.5-pro", contextWindow: 2000000 },
			"invalid-limits",
		]);
	});

	it("round-trips entries -> rows -> entries", () => {
		const original: ModelEntry[] = [
			"model-a",
			{ id: "model-b", contextWindow: 32768, maxTokens: 4096 },
			{ id: "model-c", maxTokens: 8192 },
		];
		const rows = modelEntriesToRows(original);
		const roundTripped = rowsToModelEntries(rows);
		expect(roundTripped).toEqual(original);
	});

	it("parses lines and pipes", () => {
		expect(parseModelEntryLine("gpt-4o")).toBe("gpt-4o");
		expect(parseModelEntryLine("gpt-4o | 128000 | 4096")).toEqual({
			id: "gpt-4o",
			contextWindow: 128000,
			maxTokens: 4096,
		});
		expect(parseModelEntryLine("deepseek-chat||8192")).toEqual({
			id: "deepseek-chat",
			maxTokens: 8192,
		});

		const lines = "gpt-4o\nclaude-3-5|200000|8192\n\n";
		expect(toModelEntries(lines)).toEqual([
			"gpt-4o",
			{ id: "claude-3-5", contextWindow: 200000, maxTokens: 8192 },
		]);
	});

	it("formats tokens into human-friendly strings", () => {
		expect(formatTokens(200000)).toBe("200k");
		expect(formatTokens(32768)).toBe("32k");
		expect(formatTokens(4096)).toBe("4k");
		expect(formatTokens(1048576)).toBe("1m");
		expect(formatTokens(2000000)).toBe("2m");
		expect(formatTokens(128000)).toBe("128k");
		expect(formatTokens(500)).toBe("500");
		expect(formatTokens(64000)).toBe("64k");
		expect(formatTokens(65536)).toBe("64k");
	});
});
