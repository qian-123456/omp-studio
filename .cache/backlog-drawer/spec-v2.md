# 收集箱改造 v2：顶部胶囊段 + 锚定下拉面板

## 变更目标（覆盖 v1 抽屉方案）

上一轮实现的是"顶部整宽下拉抽屉"。本轮改为：**顶栏右侧胶囊（TopCapsule）里新增「收集箱」段，与「待处理」「子任务」并列**；点击展开锚定在胶囊下方的下拉面板（popover，约 480px 宽），点外面/Esc 收起。顶栏分段导航里的「收集箱」按钮移除。

## 具体改动

### 1. `src/features/backlog/drawerStore.ts` → `backlogStore.ts`（重命名并扩展）

```ts
import { create } from "zustand";
import type { BacklogItem } from "../../lib/contracts";
import { onBacklogChanged } from "../../lib/events";
import { backlogList } from "../../lib/ipc";

interface BacklogState {
  /** Panel open (anchored popover under top capsule). */
  open: boolean;
  items: BacklogItem[];
  loading: boolean;
  setOpen(v: boolean): void;
  toggle(): void;
  load(): Promise<void>;
}

let subscribed = false;
export const useBacklog = create<BacklogState>((set, get) => ({
  open: false,
  items: [],
  loading: false,
  setOpen: (v) => set({ open: v }),
  toggle: () => set((s) => ({ open: !s.open })),
  load: async () => {
    set({ loading: true });
    try {
      const items = await backlogList();
      set({ items });
    } finally {
      set({ loading: false });
    }
    if (!subscribed) {
      subscribed = true;
      void onBacklogChanged(() => { void get().load(); });
    }
  },
}));
```
（订阅逻辑也可放组件 effect；以现有 BacklogDrawer 的订阅写法为准，选一个即可，不要重复订阅。）
更新 `drawerStore.test.ts` → `backlogStore.test.ts`，覆盖 open/toggle/load 行为。

### 2. `src/features/backlog/BacklogDrawer.tsx` → `BacklogPanel.tsx`（改锚定弹层）

- 外层容器改为：
  ```tsx
  if (!open) return null;
  <div className="fixed inset-0 z-40" onMouseDown={close}>  {/* 透明点击捕获层，无黑色遮罩 */}
    <div
      className="absolute right-2 top-11 flex w-[480px] max-w-[calc(100vw-2rem)] max-h-[70vh] flex-col rounded-xl border border-neutral-700/80 bg-neutral-900 shadow-2xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      ...原抽屉内容（捕获输入行 + 状态 tabs + 紧凑列表 + dispatch modal）...
    </div>
  </div>
  ```
  - 无遮罩变暗（或极浅 `bg-black/20`，可选），因为面板小、对对话区视觉干扰低。
  - 列表区域 `overflow-y-auto`；面板整体 `max-h-[70vh]`。
- 保留全部现有功能：快速捕获输入（含 kind chips + 关联当前会话）、4 状态 tabs、条目行操作（「填入当前」= setDraft+focusComposer+selectSession+关面板、「派发…」弹窗、双击就地编辑、标记完成/关闭/放回收集箱、删除、refs 徽章、目标会话链接）、dispatch modal 整块保留。
- items 数据改用 `useBacklog` store（不再组件内 useState+loadItems）；组件挂载或 open 时 `void load()`。

### 3. `src/features/todos/TopCapsule.tsx`：新增「收集箱」段

在胶囊 pill 里「待处理」段之后（子任务段之前的位置，即插入 divider + button）：
```tsx
<div className="h-3.5 w-[1px] bg-neutral-700" />
<button
  type="button"
  onClick={() => { toggleBacklog(); setOpenTodoPopover(false); setOpenSubPopover(false); }}
  className={/* 与其他段一致的 pill 样式；backlogOpen 时 bg-neutral-700 text-neutral-100 */}
  title="收集箱"
>
  <Inbox className="h-3.5 w-3.5 text-amber-400" />
  <span>收集箱</span>
  <span className="rounded bg-amber-500/20 px-1 py-0.2 text-[10px] text-amber-300">
    {inboxCount}
  </span>
</button>
```
- `inboxCount = items.filter(i => i.status === "inbox").length`，数据来自 `useBacklog`；TopCapsule mount 时 `void useBacklog.getState().load()`（确保计数有数据）。
- 点击外部关闭逻辑（containerRef）对 backlog 面板无效（面板不在 container 内），所以 BacklogPanel 用自己的全屏透明捕获层处理外部点击——已在上面的方案覆盖。
- 注意 Esc：`useEscapeKey` 已在 BacklogPanel 内部处理。

### 4. `src/App.tsx`

- 顶栏分段导航中的「收集箱」按钮删除（capsule 成为唯一入口）；nav 只剩 首页/设置。
- `<BacklogDrawer />` 改为 `<BacklogPanel />`（import 同步改）。
- 移除 `useBacklogDrawer` 相关代码。

### 5. 清理

- 删除 `drawerStore.ts` / `drawerStore.test.ts` 旧文件（重命名后）。
- grep 确认无 `drawerStore`/`BacklogDrawer`/`useBacklogDrawer` 残留。
- `QuickCapture.tsx` 不动。

## 验收

- `pnpm tsc --noEmit` 通过；`pnpm vitest run` 通过。
- 胶囊显示「收集箱 N」（N = inbox 数）；点击切换面板开合，且与「待处理」「子任务」弹层互斥。
- 「填入当前」把条目写入当前会话 composer 草稿并聚焦、面板关闭；无选中会话时禁用。
- 点面板外任意处 / Esc 关闭；SessionView 不被卸载（对话不中断）。
