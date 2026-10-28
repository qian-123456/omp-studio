// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageFileToBase64 } from "./sideChatAttachments";

let resolversDescriptor: PropertyDescriptor | undefined;
beforeEach(() => {
	resolversDescriptor = Object.getOwnPropertyDescriptor(Promise, "withResolvers");
	// The supported webview/TypeScript target need not implement this newer API.
	Object.defineProperty(Promise, "withResolvers", { configurable: true, value: undefined });
});
afterEach(() => {
	vi.restoreAllMocks();
	if (resolversDescriptor) Object.defineProperty(Promise, "withResolvers", resolversDescriptor);
	else Reflect.deleteProperty(Promise, "withResolvers");
});

describe("side-chat image reading on supported older webviews", () => {
	it("reads image bytes without Promise.withResolvers", async () => {
		await expect(imageFileToBase64(new Blob(["hello"], { type: "image/png" })))
			.resolves.toBe("aGVsbG8=");
	});

	it("rejects the original FileReader error without Promise.withResolvers", async () => {
		const failure = new DOMException("image denied", "NotReadableError");
		vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(function (this: FileReader) {
			Object.defineProperty(this, "error", { value: failure });
			this.dispatchEvent(new ProgressEvent("error"));
		});
		await expect(imageFileToBase64(new Blob(["image"]))).rejects.toBe(failure);
	});

	it("rejects synchronous read failures as a promise instead of throwing", async () => {
		const failure = new Error("read failed synchronously");
		vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(() => { throw failure; });
		await expect(imageFileToBase64(new Blob(["image"]))).rejects.toBe(failure);
	});
});
