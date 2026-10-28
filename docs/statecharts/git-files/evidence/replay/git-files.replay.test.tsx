// @vitest-environment jsdom
// 回放：文件缓冲区 / 孤儿工作树清理。真实组件、真实 store、真实 hook；只在 lib/ipc 与确认对话框外部边界打桩。
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@uiw/react-codemirror";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const disk = new Map<string, string>();
  const state = { gate: null as Promise<void> | null };
  return {
    disk,
    state,
    readTextFile: vi.fn(async (path: string) => {
      const text = disk.get(path); // 先读到版本，再等待：模拟 await readTextFile 期间的时间窗
      if (state.gate) {
        const g = state.gate;
        state.gate = null;
        await g;
      }
      if (text === undefined) throw new Error("missing");
      return text;
    }),
    writeTextFile: vi.fn(async (path: string, content: string) => {
      disk.set(path, content);
    }),
    gitRepoRoot: vi.fn(),
    gitScanOrphans: vi.fn(),
    gitRemoveWorktree: vi.fn(),
    confirmDialog: vi.fn(async (..._a: unknown[]) => true),
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "<HOME>" }));
vi.mock("<repo>/src/lib/ipc", () => ({
  readTextFile: (p: string) => h.readTextFile(p),
  writeTextFile: (p: string, c: string) => h.writeTextFile(p, c),
  gitRepoRoot: (c: string) => h.gitRepoRoot(c),
  gitScanOrphans: () => h.gitScanOrphans(),
  gitRemoveWorktree: (...a: unknown[]) => h.gitRemoveWorktree(...a),
  gitListWorktrees: vi.fn(async () => []),
  listWorkspaceFiles: vi.fn(async () => []),
  validatePath: vi.fn(async () => ({ exists: true, isDir: false })),
}));
vi.mock("<repo>/src/lib/dialogs", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  confirmDialog: (...a: unknown[]) => h.confirmDialog(...a),
}));

import { FilePreviewPanel } from "<repo>/src/features/files/FilePreviewPanel";
import { useFilePreview } from "<repo>/src/stores/filePreview";
import { useOrphans } from "<repo>/src/features/git/OrphanBadge";

const A = "/work/a.md";
const B = "/work/b.md";

function type(text: string) {
  const dom = document.querySelector(".cm-editor") as HTMLElement;
  const view = EditorView.findFromDOM(dom);
  if (!view) throw new Error("no CodeMirror view");
  act(() => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });
}

async function openEdit(path: string) {
  act(() => {
    useFilePreview.getState().openFile(path, { mode: "edit" });
  });
}

beforeEach(() => {
  h.disk.clear();
  h.disk.set(A, "orig-A");
  h.disk.set(B, "orig-B");
  h.readTextFile.mockClear();
  h.writeTextFile.mockClear();
  h.confirmDialog.mockClear();
  h.state.gate = null;
  useFilePreview.setState({ tabs: [], activePath: null });
});
afterEach(cleanup);

describe("文件缓冲区回放", () => {
  it("切换标签再切回：未保存草稿丢失，且没有任何确认", async () => {
    await openEdit(A);
    render(<FilePreviewPanel />);
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    type("mine-A");
    expect(await screen.findByText("未保存")).toBeTruthy();

    act(() => useFilePreview.getState().openFile(B, { mode: "edit" })); // 点另一个标签
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("orig-B"));
    act(() => useFilePreview.getState().setActive(A)); // 切回
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("orig-A"));

    expect(screen.queryByText("未保存")).toBeNull();
    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(h.writeTextFile).not.toHaveBeenCalled();
    expect(h.disk.get(A)).toBe("orig-A"); // “mine-A” 哪儿都不存在了
  });

  it("关闭有未保存草稿的标签：标签直接消失，没有确认也没有保存", async () => {
    await openEdit(A);
    render(<FilePreviewPanel />);
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    type("mine-A");
    expect(await screen.findByText("未保存")).toBeTruthy();

    act(() => useFilePreview.getState().closeFile(A)); // 与 RightPanelHeader / Cmd+W 调用的同一入口
    expect(useFilePreview.getState().tabs).toHaveLength(0);
    expect(h.confirmDialog).not.toHaveBeenCalled();
    expect(h.writeTextFile).not.toHaveBeenCalled();
    expect(h.disk.get(A)).toBe("orig-A");
  });

  it("点重新加载：未保存草稿被直接覆盖，没有确认", async () => {
    await openEdit(A);
    render(<FilePreviewPanel />);
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    type("mine-A");
    expect(await screen.findByText("未保存")).toBeTruthy();

    fireEvent.click(screen.getByTitle("从磁盘重新加载"));
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("orig-A"));
    expect(screen.queryByText("未保存")).toBeNull();
    expect(h.confirmDialog).not.toHaveBeenCalled();
  });

  it("代理在窗口前台改了文件：保存直接覆盖，没有横幅也没有确认", async () => {
    await openEdit(A);
    render(<FilePreviewPanel />);
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    type("mine-A");
    h.disk.set(A, "theirs-A"); // 代理写盘；窗口一直在前台，没有 focus 事件
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(h.writeTextFile).toHaveBeenCalledWith(A, "mine-A"));
    expect(h.disk.get(A)).toBe("mine-A"); // 代理的版本被覆盖
    expect(screen.queryByText(/磁盘/)).toBeNull(); // 没有提示磁盘已变
    expect(h.confirmDialog).not.toHaveBeenCalled();
  });

  it("窗口聚焦后台重读返回前用户又输入：输入被磁盘内容覆盖", async () => {
    await openEdit(A);
    render(<FilePreviewPanel />);
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("orig-A"));
    h.disk.set(A, "theirs-A");
    let release!: () => void;
    h.state.gate = new Promise<void>((r) => (release = r));
    act(() => {
      window.dispatchEvent(new Event("focus")); // 聚焦：后台开始重读（此刻缓冲区无改动）
    });
    type("mine-A"); // 重读返回前用户开始输入
    expect(await screen.findByText("未保存")).toBeTruthy();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("theirs-A"));
    expect(screen.queryByText("未保存")).toBeNull();
    expect(h.confirmDialog).not.toHaveBeenCalled();
  });
});

describe("孤儿工作树回收回放", () => {
  const wt = (path: string, extra: object = {}) => ({
    path,
    branch: "omp/task-1",
    head: "abc",
    dirty: 0,
    sessionIds: [] as string[],
    ahead: 1,
    behind: 0,
    ...extra,
  });
  const repo = "/repo";

  // 点单个「回收」：真实的清理确认弹窗出现，用户点「确认清理」。
  async function reclaimViaDialog(result: { current: ReturnType<typeof useOrphans> }) {
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.reclaim(result.current.orphans[0]);
    });
    fireEvent.click(await screen.findByText("确认清理"));
    await act(async () => {
      await pending;
    });
  }

  beforeEach(() => {
    h.gitRepoRoot.mockReset().mockResolvedValue(repo);
    h.gitScanOrphans.mockReset();
    h.gitRemoveWorktree.mockReset();
  });

  it("删目录成功、删分支失败：界面仍显示已不存在的孤儿，也不刷新", async () => {
    h.gitScanOrphans.mockResolvedValue([wt(`${repo}/.worktrees/task-1`)]);
    h.gitRemoveWorktree.mockRejectedValue("worktree 已删除，但分支 omp/task-1 未删除：not fully merged");
    const { result } = renderHook(() => useOrphans(repo));
    await waitFor(() => expect(result.current.orphans).toHaveLength(1));
    await reclaimViaDialog(result);
    expect(h.gitRemoveWorktree).toHaveBeenCalledTimes(1); // 目录已被后端删除
    expect(result.current.error).toMatch(/已删除，但分支/);
    expect(result.current.orphans).toHaveLength(1); // 列表仍显示
    expect(h.gitScanOrphans).toHaveBeenCalledTimes(1); // 没有重新扫描
  });

  it("扫描之后会话才进入该目录：全部回收仍按旧快照强制删除，不重新扫描", async () => {
    const dirtyWt = wt(`${repo}/.worktrees/task-2`, { dirty: 3 });
    h.gitScanOrphans.mockResolvedValue([dirtyWt]);
    h.gitRemoveWorktree.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOrphans(repo));
    await waitFor(() => expect(result.current.orphans).toHaveLength(1));
    // 此刻后端目录库里已有会话在该目录工作；前端快照仍是 sessionIds=[]
    h.gitScanOrphans.mockResolvedValue([]);
    await act(async () => {
      await result.current.reclaimAll();
    });
    expect(h.gitScanOrphans).toHaveBeenCalledTimes(1); // 没有二次扫描
    expect(h.gitRemoveWorktree).toHaveBeenCalledWith(repo, dirtyWt.path, true, true);
  });

  it("时光机目录出现在孤儿列表里，并且回收时前端不带任何进程信息", async () => {
    const tm = wt(`${repo}/.worktrees/tm-0123abcd`, { branch: null });
    h.gitScanOrphans.mockResolvedValue([tm]);
    h.gitRemoveWorktree.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOrphans(repo));
    await waitFor(() => expect(result.current.orphans).toHaveLength(1));
    await reclaimViaDialog(result);
    expect(h.gitRemoveWorktree).toHaveBeenCalledWith(repo, tm.path, false, false);
  });
});
