// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../core/api";
import { ChatCtx } from "../chat/ChatContext";
import { ChatController } from "../chat/chatStore";
import { PLAN_OFF, type ApprovedStatus } from "../../../src/features/chat/plan/planStatus";
import { WorkspacePanelBar } from "./WorkspacePanelBar";

const status = (value: ApprovedStatus) => ({ ...PLAN_OFF, approved: { planFile: null, planUrl: null, title: "Approved", content: "authoritative plan", prevContent: null, version: 1, status: value, error: null } });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("workspace plan navigation", () => {
 it("uses authoritative approved execution, not planning enabled, with no context-side loader", async () => {
  const request = vi.spyOn(apiModule, "api").mockResolvedValue({});
  const controller = new ChatController("fixture-context");
  controller.store.setState({ cstate: { planMode: true, planStatus: { ...PLAN_OFF, enabled: true } } });
  const view = render(<ChatCtx.Provider value={{ controller, openActions() {}, openStat() {} }}><WorkspacePanelBar sessionId={controller.id} current="files" /></ChatCtx.Provider>);
  expect(screen.queryByRole("link", { name: "计划" })).toBeNull();
  await act(async () => controller.store.setState({ cstate: { planMode: false, planStatus: status("executing") } }));
  expect(screen.getByRole("link", { name: "计划" }).getAttribute("href")).toBe("#/s/fixture-context/plan");
  await act(async () => controller.store.setState({ cstate: { planStatus: status("completed") } }));
  expect(screen.queryByRole("link", { name: "计划" })).toBeNull();
  view.rerender(<ChatCtx.Provider value={{ controller, openActions() {}, openStat() {} }}><WorkspacePanelBar sessionId={controller.id} current="plan" /></ChatCtx.Provider>);
  expect(screen.getByRole("link", { name: "计划" }).getAttribute("aria-current")).toBe("page");
  expect(request).not.toHaveBeenCalled();
  view.unmount();controller.dispose();
 });

 it("shares the session status request between multiple mounted panel consumers", async () => {
  const request = vi.spyOn(apiModule, "api").mockResolvedValue({ planStatus: status("completed"), streaming: false });
  render(<><WorkspacePanelBar sessionId="fixture-shared" current="files" /><WorkspacePanelBar sessionId="fixture-shared" current="git" /></>);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(request).toHaveBeenCalledWith("GET", "/sessions/fixture-shared/composer-state", undefined, { signal: expect.any(AbortSignal) });
  expect(screen.getAllByRole("navigation", { name: "会话工作区" })).toHaveLength(2);
 });
});
