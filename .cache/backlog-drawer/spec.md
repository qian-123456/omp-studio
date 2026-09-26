# 收集箱（Backlog）改造：顶部整宽下拉抽屉

## 背景与目标

现状：`BacklogPage` 以 `centerView === "backlog"` 全屏替换主视图，打断对话心流。
目标：改为**顶部整宽下拉抽屉**，从顶栏向下滑出，覆盖在主内容之上（不卸载/不替换 SessionView），点遮罩或 Esc 收起。

用户已确认的形态决策：
- 形态：**整宽下拉抽屉**（从顶部沿整个内容宽度滑出，高度约 40%，可滚动）。
- 「派给当前」行为：**把条目内容填入当前会话 composer 输入框**（不直接发送）。

## 改动清单

### 1. 新文件 `src/features/backlog/drawerStore.ts`（backlog 模块自有文件 [D]）

```ts
// Zustand store: is the top backlog drawer open.
import { create } from "zustand";
interface BacklogDrawerState {
  open: boolean;
  setOpen(v: boolean): void;
  toggle(): void;
}
export const useBacklogDrawer = create<BacklogDrawerState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
```

### 2. 新文件 `src/features/backlog/BacklogDrawer.tsx`（[D]，替代 BacklogPage）

抽屉组件，挂在 App 根层（QuickCapture 同级）：

- 结构：`{open && (<div className="fixed inset-0 z-40">` 遮罩 `onMouseDown` 关闭 + 顶部抽屉面板 `</div>)}`。
  - 抽屉面板：`absolute left-0 right-0 top-10`（top-10 让出 40px 顶栏，保证顶栏按钮仍可点），`max-h-[40vh]` 或固定 `h-[40%]`，`border-b border-neutral-800 bg-neutral-900` + `shadow-2xl`，`overflow-y-auto`，可加简单 `translate-y` 过渡动画（可选，不做也行）。
  - `useEscapeKey(() => setOpen(false), open)`。
- 内容（紧凑版，复用 BacklogPage 的逻辑，删除页头/页脚冗余）：
  - 顶部一行：捕获输入框（单行 input，Enter 提交；保留 kind chips todo/bug/idea；保留「关联当前会话」checkbox，仅在有 selectedSessionId 时显示）。
  - 状态 tabs：inbox / dispatched / done / closed（带计数），与现状一致。
  - 列表：紧凑行（每行：kind 图标 + 文本截断 + 时间 + 操作按钮）。
- 操作按钮改造（核心交互变化）：
  - `status === "inbox"` 条目主按钮改为 **「填入当前」**（图标可用 `CornerDownLeft` 或 `PenLine`）：
    ```ts
    const handleFillCurrent = (item: BacklogItem) => {
      if (!selectedSessionId) { toast.error("没有选中的会话"); return; }
      useComposer.getState().setDraft(selectedSessionId, item.text);
      useComposer.getState().focusComposer(selectedSessionId);
      selectSession(selectedSessionId); // 确保 centerView 切回 session
      setOpen(false);
      toast.success("已填入输入框");
    };
    ```
    - 不改 item.status（还没发送，不算已派发）。
    - 无 selectedSessionId 时按钮禁用（`disabled` + title="先选中一个会话"）。
  - 旁边小按钮「…」或「派发」打开**原有的完整派发弹窗**（已有会话选择/新会话/工作区）——把 BacklogPage 里的 dispatch modal 整块搬过来，保留给"派到别的会话/新开会话"场景。
  - 保留：双击就地编辑、编辑/删除（hover 显示）、标记完成、关闭、重新派发（dispatched 状态）、放回收集箱。
  - refs 徽章、目标会话链接保留（紧凑显示）。
- 数据加载逻辑直接搬自 BacklogPage（loadItems / onBacklogChanged 订阅 / handleAdd / handleUpdateStatus / handleDelete / handleStartEdit / handleSaveEdit / handleOpenDispatch / handleExecuteDispatch）。

### 3. `src/App.tsx` 改动

- import `BacklogDrawer` + `useBacklogDrawer`。
- 顶栏 `navBtn("backlog", "收集箱", <Inbox/>)` 改为普通按钮：`onClick` 调 `useBacklogDrawer.getState().toggle()`，active 态判断改为 `backlogOpen`（`const backlogOpen = useBacklogDrawer(s => s.open)`）。navBtn helper 目前签名为 `(view, label, icon)` 且内部调 `setCenter(view)`——可为 backlog 单独写一个按钮，或给 navBtn 加 onClick/active 参数，选改动最小的方式。
- 在 `<QuickCapture />` 同级渲染 `<BacklogDrawer />`。
- `CenterView` 中 `case "backlog": return <BacklogPage/>` 删除（不再有全屏 backlog 视图）。

### 4. 删除 `src/features/backlog/BacklogPage.tsx`

全部逻辑迁移到 BacklogDrawer；dispatch modal 一并迁移。删除前确认无其他 import（grep `BacklogPage`）。
`QuickCapture.tsx` 不动（全局快捷键 CmdOrControl+Shift+I 仍走 modal，合理）。

### 5. `src/stores/ui.ts` 的 `CenterView` 类型

`"backlog"` 保留在 union 中（[LEAD] 文件冻结，不动），只是不再使用。报告中注明。

## 验收

- `pnpm tsc --noEmit` 通过。
- `pnpm vitest run` 通过。
- grep 确认无残留 `BacklogPage` / `setCenter("backlog")` 引用。
- 交互验收（代码层面核对即可，不启动 tauri dev）：
  - 点顶栏收集箱 → 顶部滑出抽屉，SessionView 不卸载（DOM 中仍存在，被遮罩盖住）。
  - 条目「填入当前」→ 当前会话 composer 草稿被填为条目文本、抽屉关闭、焦点到输入框。
  - Esc / 点遮罩 → 抽屉关闭。
  - 派发弹窗、编辑、删除、状态流转在抽屉内可用。
