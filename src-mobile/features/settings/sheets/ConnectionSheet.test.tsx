// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConnection } from "../../../core/stores/connection";
import { ConnectionSheet } from "./ConnectionSheet";

beforeEach(() => useConnection.setState({ phase: "open", error: null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("current device name", () => {
	it("saves an optional name for the authenticated device and allows restoring the default", async () => {
		const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetcher);
		render(<ConnectionSheet open onClose={() => {}} />);
		const input = screen.getByLabelText("设备名称（可选）");
		fireEvent.change(input, { target: { value: "  工作手机  " } });
		fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
		expect(fetcher).toHaveBeenCalledWith("/api/device/name", expect.objectContaining({ method: "POST", credentials: "same-origin", body: JSON.stringify({ name: "工作手机" }) }));
		await screen.findByRole("button", { name: "保存名称" });
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
		await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
		expect(fetcher.mock.calls[1][1].body).toBe(JSON.stringify({ name: "" }));
	});

	it("shows a revoked pairing and keeps the connection unauthorized", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
		render(<ConnectionSheet open onClose={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "保存名称" }));
		expect((await screen.findByRole("alert")).textContent).toContain("配对已失效或被撤销");
		expect(useConnection.getState().phase).toBe("unauthorized");
	});
});
