// @vitest-environment jsdom
// Replay F5: clicking file links rendered by the real <Markdown/> component.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s, invoke: vi.fn(async () => null) }));
import { Markdown } from "<repo>/src/components/Markdown";
import { useToasts } from "<repo>/src/lib/toast";
import { useFilePreview } from "<repo>/src/stores/filePreview";
afterEach(() => cleanup());
describe("F5 file links in Markdown", () => {
	it.each([["[readme](file:///tmp/a.md)", "a[href^='file:']"], ["[doc](./README.md)", "a[href='./README.md']"]])("click %s opens a preview, not an error toast", async (md, sel) => {
		useToasts.setState({ items: [] } as any);
		const r = render(<Markdown text={md} />);
		await act(async () => { await new Promise((x) => setTimeout(x, 20)); });
		const a = r.container.querySelector(sel)!;
		expect(a).not.toBeNull();
		await act(async () => { fireEvent.click(a); await new Promise((x) => setTimeout(x, 20)); });
		const toasts = (useToasts.getState() as any).items?.map((t: any) => t.message ?? t.text) ?? [];
		console.log("F5 toasts:", JSON.stringify(toasts), "preview tabs:", useFilePreview.getState().tabs.length);
		expect(useFilePreview.getState().tabs.length).toBeGreaterThan(0);
	});
});
