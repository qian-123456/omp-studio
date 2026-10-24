import { describe, expect, it } from "vitest";
import { imageUnavailableMessage } from "./imageAvailability";

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
