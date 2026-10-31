// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpSheet } from "./sheets/McpSheet";
import { SubagentsSheet } from "./sheets/SubagentsSheet";
import { RulesFilesSheet } from "./sheets/RulesFilesSheet";
import { MemorySheet } from "./sheets/MemorySheet";
import * as apiModule from "../../core/api";

vi.mock("../../core/nav", () => ({ nav: { pushLayer: () => () => {} } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("desktop-managed settings without mobile read APIs", () => {
 it.each([
  { title: "MCP 服务器", Sheet: McpSheet },
  { title: "子代理管理", Sheet: SubagentsSheet },
  { title: "规则文件", Sheet: RulesFilesSheet },
  { title: "记忆管理", Sheet: MemorySheet },
 ])("discloses unavailable data for $title and offers no fabricated editing", ({ title, Sheet }) => {
  const request = vi.spyOn(apiModule, "api"); const close = vi.fn();
  render(<Sheet open onClose={close} />);
  expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  expect(screen.getByText("由电脑管理")).toBeTruthy();
  expect(screen.getByText(/手机端尚无.*读取接口/)).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("switch")).toBeNull();
  expect(screen.queryByRole("button", { name: /保存|创建|添加|生成/ })).toBeNull();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(close).toHaveBeenCalledOnce();
 });
});
