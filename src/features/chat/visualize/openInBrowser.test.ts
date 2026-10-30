import { beforeEach, describe, expect, it, vi } from "vitest";

const { saveClipboardFile, openPath } = vi.hoisted(() => ({
	saveClipboardFile: vi.fn(),
	openPath: vi.fn(),
}));
vi.mock("../../../lib/ipc", () => ({ saveClipboardFile }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath }));

import { openHtmlInBrowser, utf8ToBase64 } from "./openInBrowser";

beforeEach(() => {
	saveClipboardFile.mockReset();
	openPath.mockReset();
});

describe("openHtmlInBrowser", () => {
	it("saves a .html file with utf-8 base64 content, then opens the returned path", async () => {
		saveClipboardFile.mockResolvedValue("/cache/ompws-clip-files/uuid-visualize-1.html");
		const path = await openHtmlInBrowser("<p>你好</p>");
		const [b64, name] = saveClipboardFile.mock.calls[0] as [string, string];
		expect(name).toMatch(/^visualize-\d+\.html$/);
		expect(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).toBe("<p>你好</p>");
		expect(openPath).toHaveBeenCalledWith("/cache/ompws-clip-files/uuid-visualize-1.html");
		expect(path).toBe("/cache/ompws-clip-files/uuid-visualize-1.html");
	});

	it("does not open anything when saving fails", async () => {
		saveClipboardFile.mockRejectedValue("disk full");
		await expect(openHtmlInBrowser("x")).rejects.toBe("disk full");
		expect(openPath).not.toHaveBeenCalled();
	});

	it("encodes large documents without overflowing", () => {
		expect(utf8ToBase64("a".repeat(200_000)).length).toBeGreaterThan(200_000);
	});
});
