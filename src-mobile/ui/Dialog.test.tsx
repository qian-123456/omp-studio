// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/nav", () => ({ nav: { back: vi.fn(), pushLayer: vi.fn(() => vi.fn()) } }));

import { nav } from "../core/nav";
import { confirm, DialogHost } from "./Dialog";

afterEach(cleanup);

describe("confirm()", () => {
	it("resolves true on confirm and false on cancel", async () => {
		render(<DialogHost />);
		let p!: Promise<boolean>;
		act(() => {
			p = confirm({ title: "删除", message: "确认删除?", confirmText: "删除", danger: true });
		});
		fireEvent.click(await screen.findByText("删除", { selector: "button" }));
		await expect(p).resolves.toBe(true);

		act(() => {
			p = confirm("继续?");
		});
		fireEvent.click(await screen.findByText("取消"));
		await expect(p).resolves.toBe(false);
	});

	it("queues concurrent confirms and shows them one at a time", async () => {
		render(<DialogHost />);
		let first!: Promise<boolean>;
		let second!: Promise<boolean>;
		act(() => {
			first = confirm("第一个");
			second = confirm("第二个");
		});
		expect(await screen.findByText("第一个")).toBeTruthy();
		expect(screen.queryByText("第二个")).toBeNull();
		fireEvent.click(screen.getByText("取消"));
		await expect(first).resolves.toBe(false);
		expect(await screen.findByText("第二个")).toBeTruthy();
		fireEvent.click(screen.getByText("确定"));
		await expect(second).resolves.toBe(true);
	});

	it("resolves false when dismissed through the layer (back gesture)", async () => {
		const push = vi.mocked(nav.pushLayer);
		push.mockClear();
		render(<DialogHost />);
		let p!: Promise<boolean>;
		act(() => {
			p = confirm("返回键");
		});
		await screen.findByText("返回键");
		const close = push.mock.calls[0]?.[0];
		expect(close).toBeTypeOf("function");
		act(() => close?.());
		await expect(p).resolves.toBe(false);
	});
});
