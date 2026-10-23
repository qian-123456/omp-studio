import { describe, expect, it } from "vitest";
import { IMAGE_DELETED_MSG, NO_IMAGE_SENT_MSG, imageUnavailableMessage } from "./imageAvailability";

describe("imageUnavailableMessage", () => {
	it("says no image was attached when the message has no path", () => {
		expect(imageUnavailableMessage(null, null)).toBe(NO_IMAGE_SENT_MSG);
		expect(imageUnavailableMessage(undefined, null)).toBe(NO_IMAGE_SENT_MSG);
	});
	it("says the file was deleted when the path is missing on disk", () => {
		expect(imageUnavailableMessage("/a.png", false)).toBe(IMAGE_DELETED_MSG);
	});
	it("returns null when the file exists or could not be checked", () => {
		expect(imageUnavailableMessage("/a.png", true)).toBeNull();
		expect(imageUnavailableMessage("/a.png", null)).toBeNull();
	});
});
