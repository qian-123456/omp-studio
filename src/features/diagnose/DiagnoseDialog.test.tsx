// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";

const mocks = vi.hoisted(() => ({ build: vi.fn(), dispatch: vi.fn(), start: vi.fn(), close: vi.fn(), select: vi.fn(), t: (key: string) => key }));
vi.mock("../../lib/ipc", () => ({ diagnoseBuildPrompt: mocks.build, dispatchPrompt: mocks.dispatch, rpcStart: mocks.start }));
vi.mock("../../stores/language", () => ({ useT: () => ({ t: mocks.t }) }));
vi.mock("../../lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("../../components/Modal", () => ({ Modal: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div> }));
// Hoisted mock factories must load zustand before this test module's imports initialize.
vi.mock("../../stores/sessions", async () => {
 const { create } = await import("zustand");
 return { useSessions: create(() => ({ sessions: {} })) };
});
vi.mock("../../stores/ui", async () => {
 const { create } = await import("zustand");
 return { useUi: create(() => ({ modal: null, closeModal: mocks.close, selectSession: mocks.select })) };
});
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { DiagnoseDialog } from "./DiagnoseDialog";

const sessions = () => Object.fromEntries(["target", "first", "chosen"].map((id) => [id, { id, title: id, cwd: "/project", status: "idle", mode: "code" }]));
const open = (id = "target") => useUi.setState({ modal: { name: "diagnose", props: { sessionId: id } } });
const refresh = () => act(() => { useSessions.setState({ sessions: sessions() as never }); });
beforeEach(() => {
 vi.clearAllMocks();
 mocks.build.mockReset().mockResolvedValue("generated prompt");
 mocks.dispatch.mockReset().mockResolvedValue(undefined);
 mocks.start.mockReset().mockResolvedValue({ sessionId: "new-diagnoser" });
 useSessions.setState({ sessions: sessions() as never });
 open();
});
afterEach(cleanup);

describe("diagnosis dialog lifecycle", () => {
 it("preserves edited prompt and existing selection through catalog refresh", async () => {
  render(<DiagnoseDialog />);
  const prompt = await screen.findByRole("textbox");
  fireEvent.change(prompt, { target: { value: "user edited prompt" } });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "chosen" } });
  refresh();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("user edited prompt");
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("chosen");
  expect(mocks.build).toHaveBeenCalledTimes(1);
 });

 it("preserves new-session model and target type through catalog refresh", async () => {
  render(<DiagnoseDialog />);
  await screen.findByRole("textbox");
  fireEvent.click(screen.getByText("diagnose.tabNew"));
  fireEvent.change(screen.getByPlaceholderText("diagnose.modelPlaceholder"), { target: { value: "custom-model" } });
  refresh();
  expect((screen.getByPlaceholderText("diagnose.modelPlaceholder") as HTMLInputElement).value).toBe("custom-model");
  fireEvent.click(screen.getByText("diagnose.startDiagnosis"));
  await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(1));
  expect(mocks.start).toHaveBeenCalledWith({ cwd: "/project", mode: "code", model: "custom-model" });
 });

 it("keeps sending locked across refresh and rapid keyboard submissions", async () => {
  let finish!: () => void;
  mocks.dispatch.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<DiagnoseDialog />);
  const prompt = await screen.findByRole("textbox");
  fireEvent.click(screen.getByText("diagnose.startDiagnosis"));
  refresh();
  fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });
  fireEvent.keyDown(prompt, { key: "Enter", metaKey: true });
  expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  expect(screen.getByText("diagnose.startingDiagnosis").closest("button")?.disabled).toBe(true);
  expect(mocks.build).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
 });

 it("ignores a late prompt response from a previous target", async () => {
  let first!: (value: string) => void;
  mocks.build.mockImplementationOnce(() => new Promise<string>((resolve) => { first = resolve; }));
  render(<DiagnoseDialog />);
  act(() => { open("first"); });
  await screen.findByRole("textbox");
  await act(async () => { first("stale old prompt"); });
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("generated prompt");
 });

 it("unlocks explicit retry after dispatch failure", async () => {
  mocks.dispatch.mockRejectedValueOnce(new Error("send failed"));
  render(<DiagnoseDialog />);
  await screen.findByRole("textbox");
  fireEvent.click(screen.getByText("diagnose.startDiagnosis"));
  await screen.findByText("send failed");
  fireEvent.click(screen.getByText("diagnose.startDiagnosis"));
  await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledTimes(2));
 });

 it("does not let an earlier send close or navigate a reopened diagnosis", async () => {
  let finish!: () => void;
  mocks.dispatch.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<DiagnoseDialog />);
  await screen.findByRole("textbox");
  fireEvent.click(screen.getByText("diagnose.startDiagnosis"));
  act(() => { useUi.setState({ modal: null }); });
  act(() => { open("first"); });
  await screen.findByRole("textbox");
  await act(async () => { finish(); });
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.select).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("generated prompt");
 });
});
