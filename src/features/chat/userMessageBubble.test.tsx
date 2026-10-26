// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("./imageTokens", async (orig) => ({ ...(await orig<Record<string, unknown>>()), getImageTokenPalette: () => ({ hex: "#888" }) }));
vi.mock("../../lib/ipc", () => ({ validatePath: vi.fn() }));
vi.mock("../privacy/SecretChip", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	PrivacyText: ({ text }: { text: string }) => <>{text}</>,
}));
vi.mock("../../lib/toast", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { UserMessageBubble } from "./ExecutionDisclosure";

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

	it("falls back to emptyText for marker-only messages", () => {
		const { container } = render(
			<UserMessageBubble text="🖼️ #1" emptyText="（附件）" images={[]} />,
		);
		expect(container.textContent).toContain("（附件）");
	});
});
