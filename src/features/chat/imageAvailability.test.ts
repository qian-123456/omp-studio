import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	validatePath: vi.fn(async (_path: string) => ({ exists: true })),
	info: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ({ validatePath: h.validatePath }));
vi.mock("../../lib/toast", () => ({ toast: { info: h.info } }));

import { imageUnavailableMessage, openImageOrExplain } from "./imageAvailability";

describe("imageUnavailableMessage", () => {
	it("says no image was attached when the message has no path", () => {
		expect(imageUnavailableMessage(null, null)).toBe("这条消息发送时没有附带图片");
		expect(imageUnavailableMessage(undefined, null)).toBe("这条消息发送时没有附带图片");
	});
	it("says the file was deleted when the path is missing on disk", () => {
		expect(imageUnavailableMessage("/a.png", false)).toBe("图片文件已被删除");
	});
	it("returns null when the file exists or could not be checked", () => {
		expect(imageUnavailableMessage("/a.png", true)).toBeNull();
		expect(imageUnavailableMessage("/a.png", null)).toBeNull();
	});
});

describe("openImageOrExplain", () => {
	beforeEach(() => {
		h.validatePath.mockReset().mockResolvedValue({ exists: true });
		h.info.mockReset();
	});

	it("does not open image #1 when the message has no image #2", async () => {
		const open = vi.fn();
		await openImageOrExplain([{ path: "/first.png" }], 2, open);
		expect(open).not.toHaveBeenCalled();
		expect(h.validatePath).not.toHaveBeenCalled();
		expect(h.info).toHaveBeenCalledWith("这条消息发送时没有附带图片");
	});

	it("keeps source positions when an earlier image has no preview path", async () => {
		const open = vi.fn();
		await openImageOrExplain([{ path: null }, { path: "/second.png" }, {}, { path: "/fourth.png" }], 4, open);
		expect(h.validatePath).toHaveBeenCalledWith("/fourth.png");
		expect(open).toHaveBeenCalledWith(1);
		expect(h.info).not.toHaveBeenCalled();
	});

	it("does not substitute a later image for a missing source slot", async () => {
		const open = vi.fn();
		await openImageOrExplain([{ path: null }, { path: "/second.png" }], 1, open);
		expect(open).not.toHaveBeenCalled();
		expect(h.validatePath).not.toHaveBeenCalled();
		expect(h.info).toHaveBeenCalledWith("这条消息发送时没有附带图片");
	});

	it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid image number %s", async (num) => {
		const open = vi.fn();
		await openImageOrExplain([{ path: "/first.png" }], num, open);
		expect(open).not.toHaveBeenCalled();
		expect(h.validatePath).not.toHaveBeenCalled();
		expect(h.info).toHaveBeenCalledWith("这条消息发送时没有附带图片");
	});

	it("opens each of two distinct source paths at its own gallery index", async () => {
		const open = vi.fn();
		await openImageOrExplain([{ path: "/first.png" }, { path: "/second.png" }], 1, open);
		await openImageOrExplain([{ path: "/first.png" }, { path: "/second.png" }], 2, open);
		expect(h.validatePath.mock.calls).toEqual([["/first.png"], ["/second.png"]]);
		expect(open.mock.calls).toEqual([[0], [1]]);
	});

	it("uses numbered identities when the collector appends a missing earlier slot", async () => {
		const open = vi.fn();
		const images = [
			{ path: "/second.png", marker: "[Image #2]" },
			{ path: null, marker: "[Image #1]" },
		];
		await openImageOrExplain(images, 1, open);
		expect(open).not.toHaveBeenCalled();
		expect(h.validatePath).not.toHaveBeenCalled();
		await openImageOrExplain(images, 2, open);
		expect(h.validatePath).toHaveBeenCalledWith("/second.png");
		expect(open).toHaveBeenCalledWith(0);
	});

	it("opens a high numbered marker without allocating or filling missing slots", async () => {
		const open = vi.fn();
		await openImageOrExplain([{ path: "/last.png", marker: "[图片 #999999]" }], 999999, open);
		expect(h.validatePath).toHaveBeenCalledWith("/last.png");
		expect(open).toHaveBeenCalledWith(0);
	});

	it("prefers an exact numbered marker over an unnumbered positional fallback", async () => {
		const open = vi.fn();
		await openImageOrExplain([
			{ path: "/legacy.png" },
			{ path: "/third.png", marker: "[Image #3]" },
			{ path: "/first.png", marker: "[Image #1]" },
		], 1, open);
		expect(h.validatePath).toHaveBeenCalledWith("/first.png");
		expect(open).toHaveBeenCalledWith(2);
	});

	it("does not use legacy fallback or a later duplicate for an explicitly missing marker", async () => {
		const open = vi.fn();
		await openImageOrExplain([
			{ path: "/legacy.png" },
			{ path: null, marker: "[Image #1]" },
			{ path: "/duplicate.png", marker: "[Image #1]" },
		], 1, open);
		expect(h.validatePath).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
		expect(h.info).toHaveBeenCalledWith("这条消息发送时没有附带图片");
	});

	it("opens a lone image #3 without using its array position as the number", async () => {
		const open = vi.fn();
		const images = [{ path: "/third.png", marker: "[Image #3]" }];
		await openImageOrExplain(images, 1, open);
		expect(open).not.toHaveBeenCalled();
		await openImageOrExplain(images, 3, open);
		expect(h.validatePath).toHaveBeenCalledWith("/third.png");
		expect(open).toHaveBeenCalledWith(0);
	});

	it("explains a deleted image without opening any other image", async () => {
		h.validatePath.mockResolvedValue({ exists: false });
		const open = vi.fn();
		await openImageOrExplain([{ path: "/first.png" }, { path: "/deleted.png" }], 2, open);
		expect(open).not.toHaveBeenCalled();
		expect(h.info).toHaveBeenCalledWith("图片文件已被删除");
	});
});
