// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceInfo } from "../../lib/contracts";
import { ServicesPanel } from "./ServicesPanel";

const h = vi.hoisted(() => ({
    requests: [] as { all: boolean; resolve: (rows: ServiceInfo[]) => void; reject: (error: Error) => void }[],
    changed: null as null | ((rows: ServiceInfo[]) => void),
    error: vi.fn(),
    t: (key: string) => key,
}));
vi.mock("../../stores/language", () => ({ useT: () => ({ t: h.t }) }));
vi.mock("../../lib/ipc", () => ({
    servicesList: (all: boolean) => new Promise<ServiceInfo[]>((resolve, reject) => {
        h.requests.push({ all, resolve, reject });
    }),
    servicesStop: vi.fn(),
    termClose: vi.fn(async () => {}),
}));
vi.mock("../../lib/events", () => ({
    onServicesChanged: async (changed: (rows: ServiceInfo[]) => void) => {
        h.changed = changed;
        return () => { h.changed = null; };
    },
    onTerminalData: vi.fn(),
    onTerminalExit: vi.fn(),
}));
vi.mock("../../lib/hooks", () => ({ useShortPath: () => (path: string) => path }));
vi.mock("../../lib/toast", () => ({ toast: { error: h.error, success: vi.fn() } }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn(), revealItemInDir: vi.fn() }));

const row = (name: string): ServiceInfo => ({
    pid: 42, name, port: 3000, cwd: null, command: name, url: "http://localhost:3000", sessionId: null, startedByApp: false, memoryKb: null,
});
beforeEach(() => { h.requests.length = 0; h.changed = null; h.error.mockClear(); });
afterEach(cleanup);

describe("services list request ownership", () => {
    it("68 ignores an older all-ports response after returning to dev-only", async () => {
        render(<ServicesPanel />);
        await waitFor(() => expect(h.requests).toHaveLength(1));
        const toggle = screen.getByRole("checkbox");
        fireEvent.click(toggle);
        await waitFor(() => expect(h.requests).toHaveLength(2));
        fireEvent.click(toggle);
        await waitFor(() => expect(h.requests).toHaveLength(3));
        expect(h.requests.map((r) => r.all)).toEqual([false, true, false]);
        await act(async () => { h.requests[2].resolve([row("current-dev")]); });
        expect(await screen.findByText("current-dev")).toBeTruthy();
        await act(async () => { h.requests[1].resolve([row("stale-all")]); h.requests[0].resolve([row("initial")]); });
        expect(screen.queryByText("stale-all")).toBeNull();
        expect(screen.queryByText("initial")).toBeNull();
        expect(screen.getByText("current-dev")).toBeTruthy();
    });

    it("68 ignores stale errors and lets a newer service event own dev rows", async () => {
        render(<ServicesPanel />);
        await waitFor(() => expect(h.requests).toHaveLength(1));
        await act(async () => { h.changed?.([row("event-dev")]); });
        expect(await screen.findByText("event-dev")).toBeTruthy();
        await act(async () => { h.requests[0].reject(new Error("stale")); });
        expect(h.error).not.toHaveBeenCalled();
        expect(screen.getByText("event-dev")).toBeTruthy();
    });

    it("68 ignores responses and events after unmount", async () => {
        const view = render(<ServicesPanel />);
        await waitFor(() => expect(h.requests).toHaveLength(1));
        const changed = h.changed;
        view.unmount();
        await act(async () => {
            changed?.([row("late-event")]);
            h.requests[0].reject(new Error("late"));
        });
        expect(h.error).not.toHaveBeenCalled();
    });
});
