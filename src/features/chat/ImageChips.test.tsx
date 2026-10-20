// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openPath = vi.fn(async (_p: string) => {});
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: (p: string) => openPath(p) }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("./Composer", () => ({ getImageTokenPalette: () => ({ hex: "#888" }) }));
vi.mock("../../lib/ipc", () => ({ validatePath: vi.fn() }));
vi.mock("../../lib/toast", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

import { AttachmentThumb } from "./ImageChips";

afterEach(() => {
	cleanup();
	openPath.mockClear();
});

describe("AttachmentThumb", () => {
	it("opens the preview when the loaded thumbnail is clicked", () => {
		const onOpen = vi.fn();
		render(<AttachmentThumb path="/a/b.png" index={1} variant="bubble" onOpen={onOpen} />);
		fireEvent.click(screen.getByAltText("图片 #1"));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it("a thumbnail that fails to load is still clickable and opens the file", () => {
		render(<AttachmentThumb path="/a/b.png" index={1} variant="bubble" onOpen={vi.fn()} />);
		fireEvent.error(screen.getByAltText("图片 #1"));
		fireEvent.click(screen.getByRole("button"));
		expect(openPath).toHaveBeenCalledWith("/a/b.png");
	});
});
