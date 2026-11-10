// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLive, isResumeCancelled, rejectResume } from "../../lib/ensureLive";
import { rpcEnsureLive } from "../../lib/ipc";
import { useUi } from "../../stores/ui";
import { ResumeMissingModelDialog } from "./ResumeMissingModelDialog";

const h = vi.hoisted(() => ({
	refresh: vi.fn(async () => {}),
	models: [{ provider: "provider-a", id: "model-a", name: "Model A" }, { provider: "provider-b", id: "model-b", name: "Model B" }],
}));
vi.mock("../../lib/ipc", () => ({ rpcEnsureLive: vi.fn() }));
vi.mock("../../stores/sessions", () => ({ useSessions: { getState: () => ({ sessions: {}, workspaces: [] }) } }));
vi.mock("../../stores/language", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("../../stores/modelCatalog", () => ({
	useModelOptions: () => h.models,
	useModelCatalog: Object.assign((select: (state: { loading: boolean }) => unknown) => select({ loading: false }), {
		getState: () => ({ refresh: h.refresh }),
	}),
}));
// Exercise the shared grouped picker contract without duplicating its own menu tests.
vi.mock("../../components/ModelSelect", () => ({
	ModelSelect: ({ models, currentValue, onSelect, disabled }: {
		models: typeof h.models; currentValue: string; onSelect: (key: string) => void; disabled: boolean;
	}) => <div data-testid="grouped-model-select" data-current={currentValue}>
		{models.map((m) => <button key={m.id} disabled={disabled} onClick={() => onSelect(`${m.provider}/${m.id}`)}>{m.provider}/{m.id}</button>)}
	</div>,
}));

beforeEach(() => {
	vi.mocked(rpcEnsureLive).mockReset();
	h.refresh.mockClear();
	useUi.getState().closeModal();
});
afterEach(() => {
	cleanup();
	rejectResume("model-dialog");
	useUi.getState().closeModal();
});

async function openRecovery() {
	vi.mocked(rpcEnsureLive).mockRejectedValueOnce("SESSION_MODEL_UNAVAILABLE:Could not restore model old/unavailable");
	const promise = ensureLive("model-dialog");
	const result = promise.catch((err) => err);
	render(<ResumeMissingModelDialog />);
	await screen.findByText("sessions.sessionModelUnavailableNotice");
	return { promise, result };
}

describe("ResumeMissingModelDialog", () => {
	it("leaves selection empty and resumes the original session only after an explicit available choice", async () => {
		const { promise } = await openRecovery();
		expect(screen.getByText("Could not restore model old/unavailable")).toBeTruthy();
		expect(h.refresh).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId("grouped-model-select").getAttribute("data-current")).toBe("");
		expect((screen.getByText("sessions.continueAction") as HTMLButtonElement).disabled).toBe(true);
		expect(rpcEnsureLive).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByText("provider-b/model-b"));
		vi.mocked(rpcEnsureLive).mockResolvedValueOnce({ sessionId: "model-dialog", sessionFile: "/original.jsonl", cwd: "/repo", pid: 2 });
		await act(async () => fireEvent.click(screen.getByText("sessions.continueAction")));
		await expect(promise).resolves.toMatchObject({ sessionId: "model-dialog", sessionFile: "/original.jsonl" });
		expect(rpcEnsureLive).toHaveBeenLastCalledWith("model-dialog", undefined, "provider-b/model-b");
	});

	it("shows retry errors inline and re-enables the explicit choice", async () => {
		const { result } = await openRecovery();
		fireEvent.click(screen.getByText("provider-a/model-a"));
		vi.mocked(rpcEnsureLive).mockRejectedValueOnce(new Error("selected model rejected"));
		fireEvent.click(screen.getByText("sessions.continueAction"));
		expect(await screen.findByRole("alert")).toHaveProperty("textContent", "selected model rejected");
		expect((screen.getByText("sessions.continueAction") as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(screen.getByText("common.cancel"));
		expect(isResumeCancelled(await result)).toBe(true);
	});

	it("disables choices and dismissal while resume is busy", async () => {
		const { promise } = await openRecovery();
		// ES2021 does not provide Promise.withResolvers.
		let finish!: (info: { sessionId: string; sessionFile: string; cwd: string; pid: number }) => void;
		vi.mocked(rpcEnsureLive).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
		fireEvent.click(screen.getByText("provider-a/model-a"));
		fireEvent.click(screen.getByText("sessions.continueAction"));
		await waitFor(() => expect(screen.getByText("sessions.resuming")).toBeTruthy());
		expect((screen.getByText("common.cancel") as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByText("provider-a/model-a") as HTMLButtonElement).disabled).toBe(true);
		await act(async () => finish({ sessionId: "model-dialog", sessionFile: "/original.jsonl", cwd: "/repo", pid: 2 }));
		await expect(promise).resolves.toMatchObject({ sessionId: "model-dialog" });
	});

	it("rejects silently on cancel and on unmount, without choosing a model", async () => {
		const { result } = await openRecovery();
		fireEvent.click(screen.getByText("common.cancel"));
		expect(isResumeCancelled(await result)).toBe(true);
		expect(rpcEnsureLive).toHaveBeenCalledTimes(1);
		cleanup();
		const next = await openRecovery();
		cleanup();
		expect(isResumeCancelled(await next.result)).toBe(true);
	});
});
