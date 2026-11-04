// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobilePanel } from "./MobilePanel";
import * as ipc from "../../lib/ipc";
import { tNow } from "../../stores/language";
import type { MobileStatus } from "../../lib/contracts";

const fixture = vi.hoisted(() => ({ settings: { mobilePort: 7788, mobileIpv6Port: 7789, tunnelMode: "off", ddnsEnabled: false }, save: vi.fn(), order: [] as string[], running: true, activePort: 7788 }));
vi.mock("../settings/useAppSettings", () => ({ useAppSettings: () => ({ settings: fixture.settings, save: fixture.save }) }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: vi.fn(), copyText: vi.fn(), errMsg: (error: unknown) => error instanceof Error ? error.message : String(error) }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../lib/ipc", () => ({ mobileStatus: vi.fn(), mobileStart: vi.fn(), mobileStop: vi.fn(), mobileCreatePairing: vi.fn(), mobileDdnsClearToken: vi.fn(), mobileDdnsSetToken: vi.fn(), mobileDdnsSync: vi.fn(), mobileIpv6Start: vi.fn(), mobileIpv6Stop: vi.fn(), mobileRevokeAll: vi.fn(), mobileListDevices: vi.fn(), mobileRenameDevice: vi.fn(), mobileDeviceWork: vi.fn(), mobileRevokeDevice: vi.fn(), tunnelCloudflaredLogin: vi.fn(), tunnelStart: vi.fn(), tunnelStop: vi.fn() }));
beforeEach(() => {
 vi.clearAllMocks();fixture.order=[];fixture.running=true;fixture.activePort=7788;fixture.settings.mobilePort=7788;
 vi.mocked(ipc.mobileListDevices).mockResolvedValue([]);
 vi.mocked(ipc.mobileStatus).mockImplementation(async () => ({ running: fixture.running, port: fixture.activePort, lanUrl: `http://fixture.invalid:${fixture.activePort}`, ipv6Running: false, cloudflaredInstalled: false } as MobileStatus));
 fixture.save.mockImplementation(async (change: { mobilePort?: number }) => { fixture.order.push("save");if(change.mobilePort)fixture.settings.mobilePort=change.mobilePort; });
 vi.mocked(ipc.mobileStop).mockImplementation(async () => { fixture.order.push("stop");fixture.running=false; });
 vi.mocked(ipc.mobileStart).mockImplementation(async () => { fixture.order.push("start");fixture.running=true;fixture.activePort=fixture.settings.mobilePort; return ipc.mobileStatus(); });
});
afterEach(() => { cleanup();vi.restoreAllMocks(); });
const openAdvanced = async () => {
 await waitFor(() => expect(ipc.mobileStatus).toHaveBeenCalled());
 return screen.getByRole("textbox", { name: tNow("mobile.portLabel") });
};
const submitPort = (input: HTMLElement) => fireEvent.submit(input.closest("form")!);

describe("desktop mobile port transactions", () => {
 it("does not create pairing on mount and rejects an invalid port without saving or restarting", async () => {
  render(<MobilePanel />);const input=await openAdvanced();
  expect(ipc.mobileCreatePairing).not.toHaveBeenCalled();
  fireEvent.change(input,{target:{value:"70000"}});submitPort(input);
  expect(screen.getByText(tNow("mobile.portValidation")).getAttribute("role")).toBe("alert");
  expect(fixture.save).not.toHaveBeenCalled();expect(ipc.mobileStop).not.toHaveBeenCalled();expect(ipc.mobileStart).not.toHaveBeenCalled();
 });
 it("keeps the running service untouched and shows full save failure", async () => {
  fixture.save.mockRejectedValue(new Error("settings locked\nfull failure detail"));
  render(<MobilePanel />);const input=await openAdvanced();fireEvent.change(input,{target:{value:"7790"}});
  await act(async()=>submitPort(input));
  expect(screen.getByText((_,node)=>node?.children.length===0&&node.textContent==="settings locked\nfull failure detail")).toBeTruthy();
  expect(fixture.running).toBe(true);expect(fixture.activePort).toBe(7788);expect(ipc.mobileStop).not.toHaveBeenCalled();expect(ipc.mobileStart).not.toHaveBeenCalled();
 });
 it.each([true,false])("saves before restart only when service is running %s", async (running) => {
  fixture.running=running;render(<MobilePanel />);const input=await openAdvanced();fireEvent.change(input,{target:{value:"7791"}});
  await act(async()=>submitPort(input));
  expect(fixture.order).toEqual(running?["save","stop","start"]:["save"]);
  expect(fixture.settings.mobilePort).toBe(7791);
  if(running){expect(fixture.activePort).toBe(7791);expect(screen.getByText("http://fixture.invalid:7791")).toBeTruthy();}
  else{expect(ipc.mobileStop).not.toHaveBeenCalled();expect(ipc.mobileStart).not.toHaveBeenCalled();}
 });
});

describe("paired devices", () => {
 const device = { id: "device-1", name: "Phone", userAgent: "Browser", createdAt: "2025-01-01T00:00:00Z", lastSeenAt: null };
 it("keeps browser diagnostics collapsed until requested", async () => {
  const agent = "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) AppleWebKit/605.1.15";
  vi.mocked(ipc.mobileListDevices).mockResolvedValue([{ ...device, userAgent: agent }]);
  render(<MobilePanel />);
  await screen.findByText(device.name);
  const details = screen.getByText(agent).closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(within(details).getByText(tNow("mobile.deviceDetails")));
  expect(details.open).toBe(true);
  fireEvent.click(within(details).getByText(tNow("mobile.deviceDetails")));
  expect(details.open).toBe(false);
 });
 it("keeps running work by default and revokes only the chosen device", async () => {
  vi.mocked(ipc.mobileListDevices).mockResolvedValue([device]);
  vi.mocked(ipc.mobileDeviceWork).mockResolvedValue([{ id: "run-1", kind: "session", title: "Task" }]);
  render(<MobilePanel />);
  fireEvent.click(await screen.findByRole("button", { name: tNow("mobile.deviceRemove") }));
  await screen.findByText(tNow("mobile.deviceSessionWorkContinues"));
  expect(screen.queryByLabelText(tNow("mobile.stopDeviceWork"))).toBeNull();
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: tNow("mobile.deviceRemove") }));
  await waitFor(() => expect(ipc.mobileRevokeDevice).toHaveBeenCalledWith("device-1", []));
 });
 it("sends only explicitly selected work IDs", async () => {
  vi.mocked(ipc.mobileListDevices).mockResolvedValue([device]);
  vi.mocked(ipc.mobileDeviceWork).mockResolvedValue([{ id: "run-1", kind: "session", title: "Task one" }, { id: "run-2", kind: "terminal", title: "Task two" }]);
  render(<MobilePanel />);
  fireEvent.click(await screen.findByRole("button", { name: tNow("mobile.deviceRemove") }));
  fireEvent.click(await screen.findByLabelText(tNow("mobile.stopDeviceWork")));
  expect(screen.queryByRole("checkbox", { name: /Task one/ })).toBeNull();
  fireEvent.click(screen.getByLabelText("Task two"));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: tNow("mobile.deviceRemove") }));
  await waitFor(() => expect(ipc.mobileRevokeDevice).toHaveBeenCalledWith("device-1", ["run-2"]));
 });
 it("does not allow removal when work lookup fails", async () => {
  vi.mocked(ipc.mobileListDevices).mockResolvedValue([device]);
  vi.mocked(ipc.mobileDeviceWork).mockRejectedValue(new Error("lookup failed"));
  render(<MobilePanel />);
  fireEvent.click(await screen.findByRole("button", { name: tNow("mobile.deviceRemove") }));
  await screen.findByText("lookup failed");
  expect((within(screen.getByRole("dialog")).getByRole("button", { name: tNow("mobile.deviceRemove") }) as HTMLButtonElement).disabled).toBe(true);
  expect(ipc.mobileRevokeDevice).not.toHaveBeenCalled();
 });
 it("renames a single device and reloads the records", async () => {
  vi.mocked(ipc.mobileListDevices).mockResolvedValue([device]);
  vi.mocked(ipc.mobileRenameDevice).mockResolvedValue();
  render(<MobilePanel />);
  fireEvent.click(await screen.findByRole("button", { name: tNow("mobile.deviceRename") }));
  fireEvent.change(screen.getByLabelText(tNow("mobile.deviceName")), { target: { value: " My phone " } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: tNow("common.save") }));
  await waitFor(() => expect(ipc.mobileRenameDevice).toHaveBeenCalledWith("device-1", "My phone"));
  await waitFor(() => expect(ipc.mobileListDevices).toHaveBeenCalledTimes(2));
 });
 it("switches transport views without starting services or generating a code", async () => {
  render(<MobilePanel />);
  const port = await openAdvanced();
  fireEvent.change(port, { target: { value: "7799" } });
  fireEvent.click(screen.getByRole("radio", { name: tNow("mobile.tabRemote") }));
  fireEvent.click(screen.getByLabelText(tNow("mobile.remoteTunnel")));
  fireEvent.click(screen.getByLabelText(tNow("mobile.remoteIpv6")));
  fireEvent.click(screen.getByRole("radio", { name: tNow("mobile.tabLan") }));
  expect((screen.getByRole("textbox", { name: tNow("mobile.portLabel") }) as HTMLInputElement).value).toBe("7799");
  expect(ipc.mobileCreatePairing).not.toHaveBeenCalled();
  expect(ipc.mobileIpv6Start).not.toHaveBeenCalled();
  expect(ipc.tunnelStart).not.toHaveBeenCalled();
 });
});
