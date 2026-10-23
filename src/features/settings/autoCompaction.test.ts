import { describe, expect, it } from "vitest";
import {
	describeStrategy,
	formatTokenShort,
	parsePercentInput,
	parseTokenInput,
	readThreshold,
	resolveMode,
	thresholdWrites,
} from "./autoCompactionLogic";

describe("parseTokenInput", () => {
	it.each([
		["200k", 200_000],
		["200K", 200_000],
		["30万", 300_000],
		["1.5M", 1_500_000],
		["250,000", 250_000],
		["128000", 128_000],
		[" 2w ", 20_000],
	])("%s → %d", (raw, n) => expect(parseTokenInput(raw)).toBe(n));

	it.each(["", "abc", "-5", "0", "1.5x", "k"])("rejects %j", (raw) => expect(parseTokenInput(raw)).toBeNull());
});

describe("parsePercentInput", () => {
	it("parses and clamps", () => {
		expect(parsePercentInput("80%")).toBe(80);
		expect(parsePercentInput("5")).toBe(10);
		expect(parsePercentInput("99")).toBe(95);
		expect(parsePercentInput("x")).toBeNull();
	});
});

describe("resolveMode", () => {
	it("tokens win over percent, unset = default", () => {
		expect(resolveMode(readThreshold(200000, 80))).toBe("tokens");
		expect(resolveMode(readThreshold(-1, 80))).toBe("percent");
		expect(resolveMode(readThreshold("-1", "75"))).toBe("percent");
		expect(resolveMode(readThreshold(undefined, -1))).toBe("default");
	});
});

describe("thresholdWrites (preset switching)", () => {
	it("token preset clears percent", () => {
		expect(thresholdWrites("tokens", 250_000)).toEqual([
			["compaction.thresholdTokens", "250000"],
			["compaction.thresholdPercent", "-1"],
		]);
	});
	it("percent preset clears tokens", () => {
		expect(thresholdWrites("percent", 80)).toEqual([
			["compaction.thresholdPercent", "80"],
			["compaction.thresholdTokens", "-1"],
		]);
	});
	it("reset unsets both", () => {
		expect(thresholdWrites("default")).toEqual([
			["compaction.thresholdTokens", "-1"],
			["compaction.thresholdPercent", "-1"],
		]);
	});
});

describe("describeStrategy", () => {
	it("formats each mode", () => {
		expect(describeStrategy({ tokens: 250_000, percent: -1 })).toBe(
			"当前策略：当会话达到 250,000 Token 时自动在后台生成摘要并压缩",
		);
		expect(describeStrategy({ tokens: -1, percent: 80 })).toBe("当前策略：当会话上下文达到模型窗口的 80% 时自动压缩");
		expect(describeStrategy({ tokens: -1, percent: -1 })).toBe("当前策略：使用系统默认（预留约 20,000 Token 时压缩）");
		expect(describeStrategy({ tokens: 1, percent: -1 }, false)).toContain("已关闭");
	});
	it("short labels", () => {
		expect(formatTokenShort(100_000)).toBe("100K");
		expect(formatTokenShort(1_500_000)).toBe("1.5M");
	});
});
