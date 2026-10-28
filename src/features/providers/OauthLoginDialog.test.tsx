// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OauthUiEvent } from "../../lib/contracts";

const { onProvidersOauth, oauthLoginProviders, oauthLoginStart, oauthLoginCancel, oauthLoginStatus, reloadProviders, confirmDialog } = vi.hoisted(() => ({
	onProvidersOauth: vi.fn(),
	oauthLoginProviders: vi.fn(),
	oauthLoginStart: vi.fn(),
	oauthLoginCancel: vi.fn(),
	oauthLoginStatus: vi.fn(async () => null),
	reloadProviders: vi.fn(),
	confirmDialog: vi.fn(),
}));

vi.mock("../../lib/events", () => ({ onProvidersOauth }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog, errMsg: (e: unknown) => String(e) }));
vi.mock("../../lib/ipc", () => ({
	oauthLoginCancel,
	oauthLoginOpenUrl: vi.fn(),
	oauthLoginProviders,
	oauthLoginRespond: vi.fn(),
	oauthLoginStart,
	oauthLoginStatus,
}));
vi.mock("../settings/sections/ProviderBrandLogo", () => ({ ProviderBrandLogo: () => null }));
vi.mock("./store", () => ({ useProviders: (selector: (state: { load: typeof reloadProviders }) => unknown) => selector({ load: reloadProviders }) }));

import { OauthLoginDialog } from "./OauthLoginDialog";

afterEach(cleanup);

beforeEach(() => {
	vi.clearAllMocks();
	onProvidersOauth.mockResolvedValue(vi.fn());
	oauthLoginProviders.mockResolvedValue([{ id: "p1", name: "Provider One", available: true }]);
	oauthLoginStart.mockResolvedValue(undefined);
	oauthLoginCancel.mockResolvedValue(undefined);
	reloadProviders.mockResolvedValue(undefined);
	confirmDialog.mockResolvedValue(true);
});

function deferred<T>() {
	// This project targets ES2021; Promise.withResolvers requires ES2024.
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

describe("OauthLoginDialog listener registration", () => {
	it("unlistens when the dialog unmounts before onProvidersOauth resolves", async () => {
		const unlisten = vi.fn();
		let resolveListen: (fn: () => void) => void = () => {};
		onProvidersOauth.mockReturnValue(new Promise<() => void>((r) => (resolveListen = r)));
		oauthLoginProviders.mockResolvedValue([
			{ id: "p1", name: "Provider One", available: true },
		]);
		oauthLoginStart.mockResolvedValue(undefined);

		const { unmount } = render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(onProvidersOauth).toHaveBeenCalled());
		unmount();
		await act(async () => {
			resolveListen(unlisten);
		});
		expect(unlisten).toHaveBeenCalledTimes(1);
		expect(oauthLoginStart).not.toHaveBeenCalled();
		expect(screen.queryByText("上一步")).toBeNull();
	});
});

describe("OauthLoginDialog cancellation ownership", () => {
	it("waits for a pending start before cancelling on Back", async () => {
		const start = deferred<void>();
		oauthLoginStart.mockReturnValue(start.promise);
		render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(oauthLoginStart).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByText("上一步"));
		expect(oauthLoginCancel).not.toHaveBeenCalled();
		await act(async () => { start.resolve(); });
		await waitFor(() => expect(oauthLoginCancel).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByText("Provider One")).toBeTruthy());
		expect(reloadProviders).toHaveBeenCalledTimes(1);
	});

	it("cancels after start settles even when unmounted", async () => {
		const start = deferred<void>();
		oauthLoginStart.mockReturnValue(start.promise);
		const { unmount } = render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(oauthLoginStart).toHaveBeenCalledTimes(1));
		unmount();
		expect(oauthLoginCancel).not.toHaveBeenCalled();
		await act(async () => { start.resolve(); });
		await waitFor(() => expect(oauthLoginCancel).toHaveBeenCalledTimes(1));
		expect(reloadProviders).toHaveBeenCalledTimes(1);
	});

	it("reconciles saved providers when success arrives during cancellation", async () => {
		const cancel = deferred<void>();
		let listener!: (event: OauthUiEvent) => void;
		onProvidersOauth.mockImplementation(async (handler) => { listener = handler; return vi.fn(); });
		oauthLoginCancel.mockReturnValue(cancel.promise);
		render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(oauthLoginStart).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByText("上一步"));
		await waitFor(() => expect(oauthLoginCancel).toHaveBeenCalledTimes(1));
		act(() => listener({ kind: "completed", providerId: "p1", ok: true }));
		await act(async () => { cancel.resolve(); });
		await waitFor(() => expect(reloadProviders).toHaveBeenCalledTimes(2));
	});

	it("refreshes once for a normal successful completion", async () => {
		let listener!: (event: OauthUiEvent) => void;
		onProvidersOauth.mockImplementation(async (handler) => { listener = handler; return vi.fn(); });
		render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(oauthLoginStart).toHaveBeenCalledTimes(1));
		act(() => listener({ kind: "completed", providerId: "p1", ok: true }));
		expect(reloadProviders).toHaveBeenCalledTimes(1);
	});

	it("refreshes a late success even after cancellation failed", async () => {
		let listener!: (event: OauthUiEvent) => void;
		onProvidersOauth.mockImplementation(async (handler) => { listener = handler; return vi.fn(); });
		oauthLoginCancel.mockRejectedValueOnce(new Error("cancel failed"));
		render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(oauthLoginStart).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByText("上一步"));
		await waitFor(() => expect(screen.getByText("Error: cancel failed")).toBeTruthy());
		act(() => listener({ kind: "completed", providerId: "p1", ok: true }));
		expect(reloadProviders).toHaveBeenCalledTimes(2);
	});

	it("reconciles after a rejected start and still completes cancellation", async () => {
		const start = deferred<void>();
		oauthLoginStart.mockReturnValue(start.promise);
		render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(oauthLoginStart).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByText("上一步"));
		await act(async () => { start.reject(new Error("start failed")); });
		await waitFor(() => expect(oauthLoginCancel).toHaveBeenCalledTimes(1));
		expect(reloadProviders).toHaveBeenCalledTimes(1);
	});

	it("keeps the flow retryable and refreshes providers after cancel failure", async () => {
		oauthLoginCancel.mockRejectedValueOnce(new Error("cancel failed"));
		render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(oauthLoginStart).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByText("上一步"));
		await waitFor(() => expect(screen.getByText("Error: cancel failed")).toBeTruthy());
		expect(reloadProviders).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByText("上一步"));
		await waitFor(() => expect(oauthLoginCancel).toHaveBeenCalledTimes(2));
	});

	it("keeps the started login cancellable when status hydration fails", async () => {
		oauthLoginStatus.mockRejectedValueOnce(new Error("status failed"));
		render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(screen.getByText("Error: status failed")).toBeTruthy());
		fireEvent.click(screen.getByText("上一步"));
		await waitFor(() => expect(oauthLoginCancel).toHaveBeenCalledTimes(1));
	});

	it("waits for pending start on confirmed dismissal", async () => {
		const start = deferred<void>();
		const onClose = vi.fn();
		oauthLoginStart.mockReturnValue(start.promise);
		render(<OauthLoginDialog onClose={onClose} initialProviderId="p1" />);
		await waitFor(() => expect(oauthLoginStart).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByLabelText("关闭"));
		await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
		expect(oauthLoginCancel).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
		await act(async () => { start.resolve(); });
		await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
		expect(oauthLoginCancel).toHaveBeenCalledTimes(1);
	});
});
