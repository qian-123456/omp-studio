// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { baseName, compactNumber, formatDuration, relTime, sessionName } from "./format";
import { imageFromBlob, imageFromDataUrl, normalizeImages } from "./images";

describe("relTime", () => {
	const now = Date.parse("2026-10-26T12:00:00Z");
	it("buckets by age", () => {
		expect(relTime("2026-10-26T11:59:30Z", now)).toBe("刚刚");
		expect(relTime("2026-10-26T11:50:00Z", now)).toBe("10 分钟前");
		expect(relTime("2026-10-26T09:00:00Z", now)).toBe("3 小时前");
		expect(relTime("2026-10-24T12:00:00Z", now)).toBe("2 天前");
		expect(relTime("2026-01-02T12:00:00Z", now)).toMatch(/^2026-01-0[23]$/);
		expect(relTime("", now)).toBe("");
		expect(relTime("garbage", now)).toBe("");
	});
});

describe("format helpers", () => {
	it("formats durations, counts, names", () => {
		expect(formatDuration(3000)).toBe("3s");
		expect(formatDuration(125_000)).toBe("2m 05s");
		expect(formatDuration(3_720_000)).toBe("1h 02m");
		expect(compactNumber(950)).toBe("950");
		expect(compactNumber(12_300)).toBe("12.3k");
		expect(compactNumber(200_000)).toBe("200k");
		expect(baseName("/a/b/proj/")).toBe("proj");
		expect(sessionName({ title: "", label: "#3" })).toBe("#3");
		expect(sessionName(null)).toBe("");
	});
});

describe("images", () => {
	it("imageFromDataUrl strips the prefix and folds image/jpg", () => {
		expect(imageFromDataUrl("data:image/png;base64,AAAA")).toEqual({ mime: "image/png", data: "AAAA" });
		expect(imageFromDataUrl("data:image/jpg;base64,QQ==")).toEqual({ mime: "image/jpeg", data: "QQ==" });
		expect(imageFromDataUrl("data:image/svg+xml;base64,AAAA")).toBeNull();
		expect(imageFromDataUrl("data:image/png;base64,")).toBeNull();
		expect(imageFromDataUrl("https://x/y.png")).toBeNull();
	});
	it("normalizeImages accepts {mime,data} and data URLs, rejects the rest before any request", () => {
		expect(normalizeImages([{ mime: "image/PNG", data: "AA" }, "data:image/webp;base64,BB", { mime: "image/gif", data: "data:image/gif;base64,CC" }])).toEqual([
			{ mime: "image/png", data: "AA" },
			{ mime: "image/webp", data: "BB" },
			{ mime: "image/gif", data: "CC" },
		]);
		expect(() => normalizeImages([{ mime: "image/svg+xml", data: "AA" }])).toThrow("仅支持");
		expect(() => normalizeImages(["data:text/plain;base64,AA"])).toThrow("仅支持");
		expect(() => normalizeImages([{ mime: "image/png", data: "" }])).toThrow("为空");
	});
	it("imageFromBlob reads a blob into bare base64 and rejects unsupported types", async () => {
		const png = new Blob(["A"], { type: "image/png" });
		await expect(imageFromBlob(png)).resolves.toEqual({ mime: "image/png", data: "QQ==" });
		await expect(imageFromBlob(new Blob(["x"], { type: "image/svg+xml" }))).rejects.toThrow("仅支持");
	});
});
