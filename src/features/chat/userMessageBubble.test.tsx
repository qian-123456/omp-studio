// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("./imageTokens", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getImageTokenPalette: () => ({ hex: "#888" }) }));
vi.mock("../../lib/ipc", () => ({ validatePath: vi.fn(async () => ({ exists: true })) }));
vi.mock("../privacy/SecretChip", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	PrivacyText: ({ text }: { text: string }) => <>{text}</>,
}));
vi.mock("../../lib/toast", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { UserMessageBubble } from "./ExecutionDisclosure";
import { makeUserEcho, useLive } from "../../stores/live";
import { openImageOrExplain } from "./imageAvailability";

afterEach(cleanup);

const TEXT =
	"[Image #1: /Users/x/ompws-clip/1.png] 包括这个问题 [Image #2: /Users/x/ompws-clip/2.png] 这种占位符";

describe("UserMessageBubble (queued / delivered mid-turn)", () => {
	it("renders inline markers as #N tokens, never raw text", () => {
		const { container } = render(<UserMessageBubble text={TEXT} />);
		expect(container.textContent).not.toContain("[Image");
		expect(container.textContent).not.toContain("/Users/");
		expect(container.textContent).toContain("🖼️#1");
		expect(container.textContent).toContain("🖼️#2");
		expect(container.textContent).toContain("包括这个问题");
	});

	it("shows a thumbnail for every marker path even when only one image is attached", () => {
		const { container } = render(
			<UserMessageBubble
				text={TEXT}
				images={[{ id: "a", path: "/Users/x/ompws-clip/1.png", marker: "[Image #1]" }]}
			/>,
		);
		expect(container.querySelectorAll("img")).toHaveLength(2);
	});

	it("renders one persisted blob and its clipboard marker as one thumbnail after reload", () => {
		const text = "[Image #1, 1000x419: /clip/original.png] inspect this";
		const item = makeUserEcho(text, [{
			id: "img-1", path: "/blobs/hash.png", marker: "[Image #1, 1000x419: /clip/original.png]",
		}]);
		useLive.getState().setItems("image-alias-reload", [item], 0);
		const loaded = useLive.getState().sessions["image-alias-reload"].items[0];
		const { container } = render(<UserMessageBubble text={loaded.text!} images={loaded.images} />);
		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(container.querySelector("img")?.getAttribute("src")).toContain("/blobs/hash.png");
		expect(container.textContent).toContain("🖼️#1");
	});

	it("keeps multiple live attachments in slot order without adding path aliases", () => {
		const text = "[Image #2: /clip/two.png] then [Image #1: /clip/one.png] compare";
		const item = makeUserEcho(text, [
			{ id: "img-1", path: "/blobs/one.webp", marker: "[图片 #1]" },
			{ id: "img-2", path: "/blobs/two.webp", marker: "[图片 #2]" },
		]);
		const { container, rerender } = render(<UserMessageBubble text={item.text!} images={item.images} />);
		expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
			"/blobs/one.webp", "/blobs/two.webp",
		]);
		rerender(<UserMessageBubble text={text} images={item.images} />);
		expect(container.querySelectorAll("img")).toHaveLength(2);
	});

	it("does not relabel a surviving #2 attachment when the collector appends unresolved #1", async () => {
		const item = makeUserEcho("[Image #1] then [Image #2]", [
			{ id: "two", path: "/blobs/two.png", marker: "[Image #2]" },
		]);
		expect(item.images?.map((image) => [image.marker, image.path])).toEqual([
			["[Image #2]", "/blobs/two.png"], ["[Image #1]", null],
		]);
		const open = vi.fn();
		await openImageOrExplain(item.images ?? [], 1, open);
		expect(open).not.toHaveBeenCalled();
		await openImageOrExplain(item.images ?? [], 2, open);
		expect(open).toHaveBeenCalledWith(0);
	});

	it("uses an inline path when the matching structured blob cannot resolve", () => {
		const { container } = render(<UserMessageBubble text="[Image #1: /clip/one.png]" images={[
			{ id: "img-1", path: null, marker: "[图片 #1]" },
		]} />);
		expect(container.querySelectorAll("img")).toHaveLength(1);
		expect(container.querySelector("img")?.getAttribute("src")).toBe("/clip/one.png");
	});

	it("falls back to emptyText for marker-only messages", () => {
		const { container } = render(
			<UserMessageBubble text="🖼️ #1" emptyText="（附件）" images={[]} />,
		);
		expect(container.textContent).toContain("（附件）");
	});
});
