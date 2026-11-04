// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConnection } from "../core/stores/connection";
import { PairingNotice } from "./PairingNotice";

beforeEach(() => useConnection.setState({ phase: "open", error: null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows the backend default after pairing and can be dismissed without renaming", async () => {
	const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ name: "Safari · iPhone" }), { status: 200, headers: { "content-type": "application/json" } }));
	vi.stubGlobal("fetch", fetcher);
	render(<PairingNotice />);
	expect(await screen.findByText("设备名称：Safari · iPhone")).toBeDefined();
	fireEvent.click(screen.getByRole("button", { name: "关闭" }));
	expect(screen.queryByLabelText("配对成功")).toBeNull();
	expect(fetcher).toHaveBeenCalledTimes(1);
});

it("optionally renames the paired record and displays the returned name", async () => {
	let reads = 0;
	const fetcher = vi.fn(async (_url: string, init: RequestInit) => init.method === "POST"
		? new Response(null, { status: 204 })
		: new Response(JSON.stringify({ name: reads++ ? "工作手机" : "Safari" }), { status: 200, headers: { "content-type": "application/json" } }));
	vi.stubGlobal("fetch", fetcher);
	render(<PairingNotice />);
	await screen.findByText("设备名称：Safari");
	fireEvent.click(screen.getByRole("button", { name: "修改名称" }));
	fireEvent.change(screen.getByLabelText("设备名称（可选）"), { target: { value: "工作手机" } });
	fireEvent.click(screen.getByRole("button", { name: "保存" }));
	await screen.findByText("设备名称：工作手机");
	await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/device/name", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "工作手机" }) })));
});
