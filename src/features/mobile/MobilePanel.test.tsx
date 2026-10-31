// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobilePanel } from "./MobilePanel";
import * as ipc from "../../lib/ipc";
import { tNow } from "../../stores/language";
import type { MobileStatus } from "../../lib/contracts";

const fixture = vi.hoisted(() => ({ settings: { mobilePort: 7788, mobileIpv6Port: 7789, tunnelMode: "off", ddnsEnabled: false }, save: vi.fn(), order: [] as string[], running: true, activePort: 7788 }));
vi.mock("../settings/useAppSettings", () => ({ useAppSettings: () => ({ settings: fixture.settings, save: fixture.save }) }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: vi.fn(), copyText: vi.fn(), errMsg: (error: unknown) => error instanceof Error ? error.message : String(error) }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../../lib/ipc", () => ({ mobileStatus: vi.fn(), mobileStart: vi.fn(), mobileStop: vi.fn(), mobileCreatePairing: vi.fn(), mobileDdnsClearToken: vi.fn(), mobileDdnsSetToken: vi.fn(), mobileDdnsSync: vi.fn(), mobileIpv6Start: vi.fn(), mobileIpv6Stop: vi.fn(), mobileRevokeAll: vi.fn(), tunnelCloudflaredLogin: vi.fn(), tunnelStart: vi.fn(), tunnelStop: vi.fn() }));
beforeEach(() => {
 vi.clearAllMocks();fixture.order=[];fixture.running=true;fixture.activePort=7788;fixture.settings.mobilePort=7788;
 vi.mocked(ipc.mobileStatus).mockImplementation(async () => ({ running: fixture.running, port: fixture.activePort, lanUrl: `http://fixture.invalid:${fixture.activePort}`, ipv6Running: false, cloudflaredInstalled: false } as MobileStatus));
 fixture.save.mockImplementation(async (change: { mobilePort?: number }) => { fixture.order.push("save");if(change.mobilePort)fixture.settings.mobilePort=change.mobilePort; });
 vi.mocked(ipc.mobileStop).mockImplementation(async () => { fixture.order.push("stop");fixture.running=false; });
 vi.mocked(ipc.mobileStart).mockImplementation(async () => { fixture.order.push("start");fixture.running=true;fixture.activePort=fixture.settings.mobilePort; return ipc.mobileStatus(); });
});
afterEach(() => { cleanup();vi.restoreAllMocks(); });
const openAdvanced = async () => {
 await waitFor(() => expect(ipc.mobileStatus).toHaveBeenCalled());
 const summary=screen.getByText(tNow("mobile.advancedTitle")).closest("summary")!;
 fireEvent.click(summary);summary.parentElement!.setAttribute("open","");
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
