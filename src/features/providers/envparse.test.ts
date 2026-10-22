import { describe, expect, it } from "vitest";
import { maskKey, parseEnvText, slugify } from "./envparse";

describe("parseEnvText", () => {
	it("parses simple KEY=VALUE lines", () => {
		expect(parseEnvText("ANTHROPIC_API_KEY=sk-abc\nOPENAI_API_KEY=sk-xyz")).toEqual([
			{ key: "ANTHROPIC_API_KEY", value: "sk-abc" },
			{ key: "OPENAI_API_KEY", value: "sk-xyz" },
		]);
	});

	it("skips comments, blank and malformed lines", () => {
		const text = [
			"# a comment",
			"",
			"BROKEN",
			"=novalue",
			"KEY",
			"VALID=1",
		].join("\n");
		expect(parseEnvText(text)).toEqual([{ key: "VALID", value: "1" }]);
	});

	it("trims whitespace and strips surrounding quotes", () => {
		const text = '  SPACED =  trimmed  \nQUOTED="has spaces"\nSQ=\'single\'';
		expect(parseEnvText(text)).toEqual([
			{ key: "SPACED", value: "trimmed" },
			{ key: "QUOTED", value: "has spaces" },
			{ key: "SQ", value: "single" },
		]);
	});

	it("splits only at the first = and keeps values with = inside", () => {
		expect(parseEnvText("TOKEN=a=b=c")).toEqual([{ key: "TOKEN", value: "a=b=c" }]);
	});

	it("handles CRLF line endings", () => {
		expect(parseEnvText("A=1\r\nB=2\r\n")).toEqual([
			{ key: "A", value: "1" },
			{ key: "B", value: "2" },
		]);
	});

	it("rejects keys with invalid characters", () => {
		expect(parseEnvText("BAD-KEY=1\nBAD KEY=2\nGOOD_KEY=3")).toEqual([
			{ key: "GOOD_KEY", value: "3" },
		]);
	});
});

describe("maskKey", () => {
	it("keeps first 3 and last 4 chars for long secrets", () => {
		expect(maskKey("sk-1234567890abcdef")).toBe("sk-…cdef");
	});

	it("fully masks short secrets", () => {
		expect(maskKey("short")).toBe("•••••");
		expect(maskKey("12345678")).toBe("••••••••");
	});
});

describe("slugify", () => {
	it("lowercases and replaces invalid chars", () => {
		expect(slugify("My Gateway 2")).toBe("my-gateway-2");
		expect(slugify("硅基流动")).toBe("custom");
		expect(slugify("-Already-Slug-")).toBe("already-slug");
	});
});

import { sanitizeSlug } from "./envparse";
describe("sanitizeSlug", () => {
	it("keeps valid ids and makes lossy ids unique like the backend", () => {
		expect(sanitizeSlug("ok_id-1")).toBe("ok_id-1");
		expect(sanitizeSlug("CTAI-luna+plus")).toBe("CTAI-luna-plus-cb5cc89e");
		expect(sanitizeSlug("a  b//c")).toBe("a-b-c-2a43b649");
		expect(sanitizeSlug("+x+")).toBe("x-75070c87");
		expect(sanitizeSlug("")).toBe("provider-811c9dc5");
		expect(sanitizeSlug("+++")).toBe("provider-6c3e4e28");
		// Two ids that strip to the same ASCII must not share a workbench record.
		expect(sanitizeSlug("聪明 AI-散户")).toBe("AI-5d1cd3b8");
		expect(sanitizeSlug("别的 AI")).toBe("AI-6910b992");
	});
});
