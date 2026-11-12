// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ServiceConfigDialog } from "./ServiceConfigDialog";
import { serviceCapability } from "./serviceCapabilities";
const mocks = vi.hoisted(() => ({ key: vi.fn(), read: vi.fn(), write: vi.fn(), configLoad: vi.fn() }));
vi.mock("../../lib/ipc", () => ({ serviceConfigRead: mocks.read, serviceConfigWrite: mocks.write }));
vi.mock("./store", () => ({ useProviders: { getState: () => ({ setKey: mocks.key }) } }));
vi.mock("../settings/ompConfigStore", () => ({ useOmpConfigStore: { getState: () => ({ load: mocks.configLoad }) } }));
vi.mock("../../stores/language", () => ({ useT: () => ({ t: (key: string) => key }), tNow: (key: string) => key }));
vi.mock("../../components/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div> }));
const entry = (engine: string) => ({ selector: `web/${engine}`, provider: "web", kind: "search" });
beforeEach(() => { vi.clearAllMocks(); mocks.key.mockResolvedValue({}); mocks.configLoad.mockResolvedValue(undefined); });
afterEach(cleanup);
describe("service configuration", () => {
	it.each(["brave", "tavily"])("writes %s credentials to the real supplier without changing the selector", async (engine) => {
		const model = entry(engine); const close = vi.fn();
		render(<ServiceConfigDialog capability={serviceCapability(model)} selector={model.selector} onClose={close} onAdvanced={vi.fn()} />);
		expect(screen.getByText(model.selector)).toBeTruthy();
		expect(screen.getByText("common.save").closest("button")?.disabled).toBe(true);
		fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "synthetic-key" } });
		fireEvent.click(screen.getByText("common.save"));
		await waitFor(() => expect(mocks.key).toHaveBeenCalledWith(engine, "synthetic-key"));
		expect(close).not.toHaveBeenCalled(); expect(await screen.findByText("providers.serviceSaved")).toBeTruthy();
	});
	it("can reference an environment variable instead of storing the key", async () => {
		const model = entry("brave");
		mocks.key.mockResolvedValue({ key: { kind: "envVar", envVar: "BRAVE_API_KEY", envSet: false } });
		render(<ServiceConfigDialog capability={serviceCapability(model)} selector={model.selector} onClose={vi.fn()} onAdvanced={vi.fn()} />);
		fireEvent.click(screen.getByLabelText(/providers\.keyInputModeEnv/));
		fireEvent.change(screen.getByLabelText("providers.envNameLabel"), { target: { value: "my-key" } });
		fireEvent.click(screen.getByText("common.save"));
		expect(mocks.key).not.toHaveBeenCalled();
		expect((await screen.findByRole("alert")).textContent).toContain("providers.envNameInvalid");
		fireEvent.change(screen.getByLabelText("providers.envNameLabel"), { target: { value: "BRAVE_API_KEY" } });
		fireEvent.click(screen.getByText("common.save"));
		await waitFor(() => expect(mocks.key).toHaveBeenCalledWith("brave", "BRAVE_API_KEY"));
	});
	it("offers keyless engines without a save action or credential write", () => {
		const model = entry("duckduckgo");
		render(<ServiceConfigDialog capability={serviceCapability(model)} selector={model.selector} onClose={vi.fn()} onAdvanced={vi.fn()} />);
		expect(screen.getByText("providers.serviceKeylessHint")).toBeTruthy();
		expect(screen.queryByText("common.save")).toBeNull(); expect(mocks.key).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
	});
	it("keeps Kimi separate from Moonshot and unknown services advanced", () => {
		expect(serviceCapability(entry("kimi"))).toEqual({ supplier: "kimi", method: "advanced" });
		expect(serviceCapability(entry("unknown"))).toEqual({ supplier: "unknown", method: "advanced" });
		expect(serviceCapability({ provider: "openai", selector: "openai/new", kind: "future-kind" }).method).toBe("advanced");
	});
	it("preserves blank secrets, submits only changed fields with stamp, refreshes shared config", async () => {
		const snapshot = { target: "searxng", stamp: "original", values: { endpoint: "https://old.example" }, secrets: { token: true, basicUsername: false, basicPassword: true } };
		mocks.read.mockResolvedValue(snapshot); mocks.write.mockResolvedValue({ ...snapshot, stamp: "new", values: { endpoint: "https://new.example" } });
		render(<ServiceConfigDialog capability={serviceCapability(entry("searxng"))} selector="web/searxng" onClose={vi.fn()} onAdvanced={vi.fn()} />);
		const endpoint = await screen.findByLabelText("providers.serviceField_endpoint");
		expect((screen.getByLabelText("providers.serviceField_token") as HTMLInputElement).value).toBe("");
		fireEvent.change(endpoint, { target: { value: "https://new.example" } }); fireEvent.click(screen.getByText("common.save"));
		await waitFor(() => expect(mocks.write).toHaveBeenCalledWith("searxng", { endpoint: "https://new.example" }, "original"));
		expect(mocks.configLoad).toHaveBeenCalledWith(true);
	});
	it("keeps failed saves open without success", async () => {
		mocks.key.mockRejectedValue(new Error("synthetic failure")); const close = vi.fn();
		render(<ServiceConfigDialog capability={serviceCapability(entry("brave"))} selector="web/brave" onClose={close} onAdvanced={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "synthetic-key" } }); fireEvent.click(screen.getByText("common.save"));
		expect((await screen.findByRole("alert")).textContent).toContain("synthetic failure"); expect(close).not.toHaveBeenCalled(); expect(screen.queryByText("providers.serviceSaved")).toBeNull();
	});
});
