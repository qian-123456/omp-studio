// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConnection } from "../../core/stores/connection";
import { TerminalPage } from "./TerminalPage";

vi.mock("./WorkspacePanelBar", () => ({ WorkspacePanelBar: () => null }));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
	cols = 80; rows = 24; options = {};
	loadAddon() {} open() {} reset() {} dispose() {}
	onData() { return { dispose() {} }; }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

beforeEach(() => useConnection.setState({ phase: "open", error: null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("detaches a revoked terminal without stopping its computer process", async () => {
	const close = vi.fn();
	const events = vi.fn(function () { return { close, addEventListener: vi.fn() }; });
	const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ termId: "term-1" }), { status: 200, headers: { "content-type": "application/json" } }));
	vi.stubGlobal("fetch", fetcher);
	vi.stubGlobal("EventSource", events);
	vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
	const view = render(<TerminalPage route={{ name: "terminal", path: "/s/a/terminal", params: { id: "a" }, query: {} }} />);
	await waitFor(() => expect(events).toHaveBeenCalledTimes(1));
	act(() => useConnection.getState().setPhase("unauthorized", "revoked"));
	expect(close).toHaveBeenCalled();
	expect(screen.getByText("配对已失效或被撤销，请重新配对。")).toBeDefined();
	view.unmount();
	expect(fetcher.mock.calls.some(([, init]) => init.method === "DELETE")).toBe(false);
});
