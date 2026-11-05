// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraPhoto } from "../lib/mobileCameraTypes";
import { useLanguageStore } from "../stores/language";
import { PhoneCameraDialog } from "./PhoneCameraDialog";

const ipc = vi.hoisted(() => ({
	mobileCameraStart: vi.fn(), mobileCameraPoll: vi.fn(), mobileCameraAck: vi.fn(), mobileCameraStop: vi.fn(),
}));
vi.mock("../lib/ipc", () => ipc);
const photo: CameraPhoto = { id: "photo-1", path: "/images/one.jpg", name: "one.jpg", width: 10, height: 10, state: "received" };
const link = { captureId: "capture", url: "http://192.168.1.2/camera#token=secret", qrSvg: "<svg></svg>", expiresAt: "2099-01-01T00:00:00Z" };
const snapshot = { captureId: "capture", state: "connected" as const, expiresAt: link.expiresAt, photos: [photo] };

beforeEach(() => {
	vi.resetAllMocks();
	useLanguageStore.getState().setLocale("en-US");
	ipc.mobileCameraStart.mockResolvedValue(link);
	ipc.mobileCameraPoll.mockResolvedValue(snapshot);
	ipc.mobileCameraAck.mockResolvedValue(undefined);
	ipc.mobileCameraStop.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("PhoneCameraDialog", () => {
	it("renews an expired capture without reinserting a photo whose acknowledgement was lost", async () => {
		let expired = false;
		const renewed = { ...link, url: `${link.url}-renewed` };
		ipc.mobileCameraStart.mockResolvedValueOnce(link).mockImplementationOnce(async () => {
			expired = false;
			return renewed;
		});
		ipc.mobileCameraPoll.mockImplementation(async () => expired ? { ...snapshot, state: "expired" } : snapshot);
		ipc.mobileCameraAck.mockImplementationOnce(async () => {
			expired = true;
			throw new Error("acknowledgement lost");
		});
		const onPhoto = vi.fn().mockResolvedValue(true);
		render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		await screen.findByText("Connection ended");
		fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
		await waitFor(() => expect(ipc.mobileCameraStart).toHaveBeenLastCalledWith("en-US", "capture"));
		await screen.findByText("1 added");
		expect(onPhoto).toHaveBeenCalledTimes(1);
		expect(ipc.mobileCameraAck).toHaveBeenCalledTimes(2);
	});

	it("renews from compact status, showing loading while stop precedes start and preserving receipts", async () => {
		const second = { ...photo, id: "photo-2", name: "two.jpg" };
		const renewed = { ...link, url: `${link.url}-renewed`, qrSvg: "<svg><title>fresh</title></svg>" };
		let finishStop!: () => void;
		let finishStart!: (value: typeof link) => void;
		ipc.mobileCameraStop.mockImplementationOnce(() => new Promise<void>((resolve) => { finishStop = resolve; }));
		ipc.mobileCameraStart.mockResolvedValueOnce(link).mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve; }));
		ipc.mobileCameraPoll.mockResolvedValueOnce({ ...snapshot, photos: [photo, second] })
			.mockResolvedValue({ ...snapshot, state: "waiting", photos: [photo, second] });
		ipc.mobileCameraAck.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("acknowledgement lost")).mockResolvedValue(undefined);
		const onPhoto = vi.fn().mockResolvedValue(true);
		render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		await screen.findByText("1 added");
		await screen.findByRole("alert");
		expect(screen.queryByRole("dialog")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByText("Starting connection…")).toBeTruthy();
		expect(screen.queryByDisplayValue(link.url)).toBeNull();
		expect(screen.getByText("1 added")).toBeTruthy();
		await waitFor(() => expect(ipc.mobileCameraStop).toHaveBeenCalledWith("capture"));
		expect(ipc.mobileCameraStart).toHaveBeenCalledTimes(1);
		finishStop();
		await waitFor(() => expect(ipc.mobileCameraStart).toHaveBeenCalledTimes(2));
		expect(ipc.mobileCameraStart).toHaveBeenLastCalledWith("en-US", "capture");
		expect(screen.getByText("Starting connection…")).toBeTruthy();
		finishStart(renewed);
		expect(await screen.findByDisplayValue(renewed.url)).toBeTruthy();
		await screen.findByText("2 added");
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(onPhoto).toHaveBeenCalledTimes(2);
		expect(ipc.mobileCameraAck).toHaveBeenCalledTimes(3);
		expect(screen.getByRole("button", { name: "Reconnect" })).toBeTruthy();
	});

	it("opens without a duplicate connection during strict-mode remount", async () => {
		ipc.mobileCameraPoll.mockResolvedValue({ ...snapshot, state: "waiting", photos: [] });
		render(<StrictMode><PhoneCameraDialog onPhoto={vi.fn()} onClose={() => {}} /></StrictMode>);
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
		expect(ipc.mobileCameraStart).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("waits for an abandoned startup to stop before opening a new connection", async () => {
		let finishStart!: (value: typeof link) => void;
		let finishStop!: () => void;
		ipc.mobileCameraStart.mockImplementationOnce(() => new Promise((resolve) => { finishStart = resolve; }));
		ipc.mobileCameraStop.mockImplementationOnce(() => new Promise<void>((resolve) => { finishStop = resolve; }));
		ipc.mobileCameraPoll.mockResolvedValue({ ...snapshot, state: "waiting", photos: [] });
		const first = render(<PhoneCameraDialog onPhoto={vi.fn()} onClose={() => {}} />);
		await waitFor(() => expect(ipc.mobileCameraStart).toHaveBeenCalledTimes(1));
		first.unmount();
		render(<PhoneCameraDialog onPhoto={vi.fn()} onClose={() => {}} />);
		finishStart(link);
		await waitFor(() => expect(ipc.mobileCameraStop).toHaveBeenCalledWith("capture"));
		expect(ipc.mobileCameraStart).toHaveBeenCalledTimes(1);
		finishStop();
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
		expect(ipc.mobileCameraStart).toHaveBeenCalledTimes(2);
	});

	it("collapses after connection without stopping receipt and can reopen the QR code", async () => {
		ipc.mobileCameraPoll.mockResolvedValueOnce({ ...snapshot, state: "waiting", photos: [] });
		const onPhoto = vi.fn().mockResolvedValue(true);
		render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		expect(await screen.findByDisplayValue(link.url)).toBeTruthy();
		await screen.findByText("Phone connected", { exact: false });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(ipc.mobileCameraStop).not.toHaveBeenCalled();
		await waitFor(() => expect(onPhoto).toHaveBeenCalledWith(photo, expect.any(Function)));
		fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
		expect(screen.getByDisplayValue(link.url)).toBeTruthy();
		await waitFor(() => expect(ipc.mobileCameraPoll.mock.calls.length).toBeGreaterThan(2), { timeout: 2000 });
		expect(screen.getByDisplayValue(link.url)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Hide QR code" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(ipc.mobileCameraStop).not.toHaveBeenCalled();
	});

	it("adds a photo only once across repeated snapshots", async () => {
		const onPhoto = vi.fn().mockResolvedValue(true);
		render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		await waitFor(() => expect(ipc.mobileCameraPoll.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });
		expect(onPhoto).toHaveBeenCalledTimes(1);
		expect(ipc.mobileCameraAck).toHaveBeenCalledTimes(1);
	});

	it("does not reinsert a photo removed from the draft", async () => {
		const draft: string[] = [];
		const onPhoto = vi.fn(async (next: CameraPhoto) => { draft.push(next.id); return true; });
		render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		await waitFor(() => expect(draft).toEqual([photo.id]));
		draft.length = 0;
		await waitFor(() => expect(ipc.mobileCameraPoll.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });
		expect(draft).toEqual([]);
		expect(onPhoto).toHaveBeenCalledTimes(1);
	});

	it("retries a lost acknowledgement without inserting twice", async () => {
		ipc.mobileCameraAck.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
		const onPhoto = vi.fn().mockResolvedValue(true);
		render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		await waitFor(() => expect(ipc.mobileCameraAck.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });
		expect(onPhoto).toHaveBeenCalledTimes(1);
	});

	it("invalidates a late attachment when its owner unmounts", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const applied = vi.fn();
		const onPhoto = vi.fn(async (_photo: CameraPhoto, current: () => boolean) => {
			await gate;
			if (current()) applied();
			return current();
		});
		const view = render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		await waitFor(() => expect(onPhoto).toHaveBeenCalledTimes(1));
		view.unmount();
		release();
		expect(applied).not.toHaveBeenCalled();
		await waitFor(() => expect(ipc.mobileCameraStop).toHaveBeenCalledWith("capture"));
	});

	it("allows a failed attachment to be retried", async () => {
		const onPhoto = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
		render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		fireEvent.click(await screen.findByRole("button", { name: "Add again" }));
		await waitFor(() => expect(onPhoto).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(ipc.mobileCameraAck).toHaveBeenCalledWith("capture", photo.id));
	});

	it("keeps each failed photo retryable after later photos attach", async () => {
		const second = { ...photo, id: "photo-2", name: "two.jpg" };
		const third = { ...photo, id: "photo-3", name: "three.jpg" };
		ipc.mobileCameraPoll.mockResolvedValue({ ...snapshot, photos: [photo, second, third] });
		const attempts = new Map<string, number>();
		const onPhoto = vi.fn(async (item: CameraPhoto) => {
			const count = (attempts.get(item.id) ?? 0) + 1;
			attempts.set(item.id, count);
			if (item.id !== third.id && count === 1) throw new Error(`failed ${item.id}`);
			return true;
		});
		render(<PhoneCameraDialog onPhoto={onPhoto} onClose={() => {}} />);
		await waitFor(() => expect(ipc.mobileCameraAck).toHaveBeenCalledWith("capture", third.id), { timeout: 2500 });
		const alerts = screen.getAllByRole("alert");
		expect(alerts).toHaveLength(2);
		const firstAlert = alerts.find((alert) => alert.textContent?.includes("failed photo-1"))!;
		expect(alerts.some((alert) => alert.textContent?.includes("failed photo-2"))).toBe(true);
		fireEvent.click(within(firstAlert).getByRole("button", { name: "Add again" }));
		await waitFor(() => expect(ipc.mobileCameraAck).toHaveBeenCalledWith("capture", photo.id));
		expect(screen.getByRole("alert").textContent).toContain("failed photo-2");
		expect(attempts.get(second.id)).toBe(1);
		expect(attempts.get(third.id)).toBe(1);
	});

	it("stops the connection when the dialog closes", async () => {
		const onClose = vi.fn();
		const view = render(<PhoneCameraDialog onPhoto={vi.fn().mockResolvedValue(true)} onClose={onClose} />);
		await screen.findByRole("button", { name: "End connection" });
		fireEvent.click(screen.getByRole("button", { name: "End connection" }));
		expect(onClose).toHaveBeenCalledOnce();
		view.unmount();
		await waitFor(() => expect(ipc.mobileCameraStop).toHaveBeenCalledWith("capture"));
	});
});
