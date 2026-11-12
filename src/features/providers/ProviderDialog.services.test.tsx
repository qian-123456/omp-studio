// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { tNow } from "../../stores/language";
const upsert = vi.hoisted(() => vi.fn(async (_config: unknown, _key: unknown, _mode: unknown) => {}));
const saveBuiltin = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./store", () => ({ useProviders: (select: (state: unknown) => unknown) => select({ rows: [], upsert, saveBuiltin, tests: {} }) }));
vi.mock("../../lib/ipc", () => ({ providerFetchModels: vi.fn(), providerReadEnvFile: vi.fn(), listModels: vi.fn(async () => ({ models: [], source: "cli", completeness: "unverified" })), ompModelsSetContextWindows: vi.fn(async () => {}) }));
vi.mock("../../stores/modelCatalog", () => ({ useModelCatalog: { getState: () => ({ refresh: vi.fn(async () => {}) }) } }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: vi.fn(async () => true), errMsg: String }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/home/u" }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
import { ProviderDialog } from "./ProviderDialog";
import { loadProviderWindows } from "../settings/contextWindow/core";
import type { ProviderRow } from "../../lib/contracts";
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });
it("adds an image service from an OpenAI connection without preset chat models", async () => {
 render(<ProviderDialog target={{ mode: "add" }} pickerCategory="other" onClose={vi.fn()} />);
 fireEvent.click(screen.getByRole("button", { name: new RegExp(tNow("providers.startFromPreset")) }));
 fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
 expect(screen.queryByDisplayValue("gpt-4o")).toBeNull();
 fireEvent.change(screen.getByLabelText(tNow("providers.newModelInputAria")), { target: { value: "my-image-model" } });
 fireEvent.click(screen.getByRole("button", { name: tNow("providers.addModelBtn") }));
 fireEvent.click(screen.getByRole("button", { name: tNow("common.save") }));
 await waitFor(() => expect(upsert).toHaveBeenCalled());
 expect(upsert.mock.calls[0][0]).toMatchObject({ api: "", models: [{ id: "my-image-model", kind: "image", api: "openai-images" }] });
});
it("keeps chat presets and the chat protocol unchanged", () => {
 render(<ProviderDialog target={{ mode: "add" }} onClose={vi.fn()} />);
 fireEvent.click(screen.getByRole("button", { name: new RegExp(tNow("providers.startFromPreset")) }));
 fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
 expect(screen.getByDisplayValue("gpt-4o")).toBeTruthy();
 expect(screen.getByDisplayValue("gpt-4.1")).toBeTruthy();
 expect(screen.getByDisplayValue("o3")).toBeTruthy();
 expect((screen.getByLabelText(tNow("providers.apiLabel")) as HTMLSelectElement).value).toBe("openai-completions");
 expect(screen.queryByLabelText(tNow("providers.servicePurpose"))).toBeNull();
});
it("offers service purposes but blocks internal runner APIs at provider level", async () => {
 render(<ProviderDialog target={{ mode: "add" }} pickerCategory="other" onClose={vi.fn()} />);
 const transcription = screen.getAllByRole("option").find((option) => option.getAttribute("value") === "stt") as HTMLOptionElement;
 expect(transcription.disabled).toBe(false);
 fireEvent.change(screen.getByLabelText(tNow("providers.apiLabel"), { selector: "#provider-api" }), { target: { value: "__other__" } });
 fireEvent.change(screen.getByLabelText(tNow("providers.otherApiAria")), { target: { value: "openai-images" } });
 fireEvent.click(screen.getByRole("button", { name: tNow("common.save") }));
 await screen.findAllByText(tNow("providers.unsupportedServiceProtocol"));
 expect(upsert).not.toHaveBeenCalled();
});
it("requires explicit model protocols when no provider protocol is selected", async () => {
 render(<ProviderDialog target={{ mode: "add" }} pickerCategory="other" onClose={vi.fn()} />);
 fireEvent.change(screen.getByLabelText(tNow("providers.newModelInputAria")), { target: { value: "image-id" } });
 fireEvent.click(screen.getByRole("button", { name: tNow("providers.addModelBtn") }));
 const modelApi = screen.getAllByRole("combobox").find((element) => (element as HTMLSelectElement).value === "openai-images")!;
 fireEvent.change(modelApi, { target: { value: "" } });
 fireEvent.click(screen.getByRole("button", { name: tNow("common.save") }));
 await screen.findByText(tNow("providers.explicitModelApisRequired"));
 expect(upsert).not.toHaveBeenCalled();
});
it("submits six mixed service capabilities with explicit model APIs and no provider default", async () => {
 render(<ProviderDialog target={{ mode: "add" }} pickerCategory="other" onClose={vi.fn()} />);
 fireEvent.click(screen.getByRole("button", { name: new RegExp(tNow("providers.startFromPreset")) }));
 fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
 const kinds = ["image", "stt", "tts", "embedding", "rerank", "video"];
 for (let index = 0; index < kinds.length; index++) {
  if (index > 0) {
   fireEvent.change(screen.getByLabelText(tNow("providers.servicePurpose"), { selector: "#provider-purpose" }), { target: { value: kinds[index] } });
  }
  fireEvent.change(screen.getByLabelText(tNow("providers.newModelInputAria")), { target: { value: `${kinds[index]}-id` } });
  fireEvent.click(screen.getByRole("button", { name: tNow("providers.addModelBtn") }));
 }
 fireEvent.click(screen.getByRole("button", { name: tNow("common.save") }));
 await waitFor(() => expect(upsert).toHaveBeenCalled());
 expect(upsert.mock.calls[0][0]).toMatchObject({ api: "", models: [
  { id: "image-id", kind: "image", api: "openai-images" },
  { id: "stt-id", kind: "stt", api: "openai-transcriptions" },
  { id: "tts-id", kind: "tts", api: "openai-speech" },
  { id: "embedding-id", kind: "embedding", api: "openai-embeddings" },
  { id: "rerank-id", kind: "rerank", api: "openrouter-rerank" },
  { id: "video-id", kind: "video", api: "openrouter-video" },
 ] });
});

it("persists a zero-model provider default on save and restores it on reopening", async () => {
 const builtin = { id: "empty-provider", origin: "builtin", models: [], extraModels: [], key: { kind: "missing" }, api: "openai-completions", authNone: false } as unknown as ProviderRow;
 const target = { mode: "edit" as const, row: builtin };
 const view = render(<ProviderDialog target={target} onClose={vi.fn()} />);
 fireEvent.change(screen.getByLabelText(tNow("providers.colContextWindow")), { target: { value: "64000" } });
 expect(loadProviderWindows()).toEqual({});
 fireEvent.click(screen.getByRole("button", { name: tNow("common.save") }));
 await waitFor(() => expect(loadProviderWindows()["empty-provider"]).toBe(64000));
 view.unmount();
 render(<ProviderDialog target={target} onClose={vi.fn()} />);
 expect((screen.getByLabelText(tNow("providers.colContextWindow")) as HTMLInputElement).value).toBe("64000");
 fireEvent.change(screen.getByLabelText(tNow("providers.newModelInputAria")), { target: { value: "added-model" } });
 fireEvent.click(screen.getByRole("button", { name: tNow("providers.addModelBtn") }));
 expect((screen.getByLabelText(tNow("providers.contextWindowAria", { index: 1 })) as HTMLInputElement).value).toBe("64000");
});

it("rejects an invalid provider window without persisting", async () => {
 const builtin = { id: "bad-window", origin: "builtin", models: [], extraModels: [], key: { kind: "missing" }, api: "openai-completions", authNone: false } as unknown as ProviderRow;
 render(<ProviderDialog target={{ mode: "edit", row: builtin }} onClose={vi.fn()} />);
 fireEvent.change(screen.getByLabelText(tNow("providers.colContextWindow")), { target: { value: "2000001" } });
 fireEvent.click(screen.getByRole("button", { name: tNow("common.save") }));
 expect(loadProviderWindows()).toEqual({});
 expect(saveBuiltin).not.toHaveBeenCalled();
});
