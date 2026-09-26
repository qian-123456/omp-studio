# 界面精简与自动恢复规格

## 背景与目标

用户明确反馈：
1. 彻底砍掉「恢复」按钮，改为**点进会话自动静默恢复/重连**，全自动无需人操心。
2. 彻底砍掉「验收」与「验收并归档」两颗大按钮，改为行为消除（发消息自动消待办，已由系统事件支持）。
3. 坚决保留「终端」文字（图标 + 文字 `[ >_ 终端 ]`），不缩成纯图标。
4. 顶栏左侧彻底砍掉「首页」，「设置 ⚙️」单列为图标按钮。

## 详细改动

### 1. `src/features/chat/SessionView.tsx`

- **移除手动「验收」和「验收并归档」按钮**（删除原有 `meta?.pending === "review"` 代码段）。
- **移除手动「恢复」按钮**（删除原有 `(status === "interrupted" || status === "suspended" || !live?.alive)` 渲染按钮段）。
- **增加进入会话自动静默重连机制**：
  ```tsx
  // Auto-resume / reconnect if the session is not alive and not external
  useEffect(() => {
    if (external) return;
    if (!live?.alive || status === "interrupted" || status === "suspended") {
      rpcEnsureLive(sessionId).catch((err) => {
        console.warn(`[SessionView] auto-resume ${sessionId} failed:`, err);
      });
    }
  }, [sessionId, external, live?.alive, status]);
  ```
- **保留 `external`「接管」按钮**（仅当接管终端外部进程时）。
- **保留 `[ >_ 终端 ]` 按钮**（图标 + 文字，原样保持，点击手感扎实清晰）。
- 清理不再使用的 imports（如 `CheckCheck`, `RefreshCw` 如果无其他用途）。

### 2. `src/App.tsx`

- **删除「首页」导航按钮**，删除 `Home` 图标 import。
- **将「设置 ⚙️」单列为独立图标按钮**：
  移除旧的 `<nav className="flex items-center rounded-lg border border-neutral-800/80 bg-neutral-900/70 p-0.5">` 容器，直接放置一个与左栏开关同规格的设置按钮：
  ```tsx
  <button
    type="button"
    onClick={() => setCenter(centerView === "settings" ? (selectedSessionId ? "session" : "home") : "settings")}
    className={clsx(
      "flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800/70 hover:text-neutral-200 transition-colors",
      centerView === "settings" && "bg-neutral-800 text-neutral-100"
    )}
    title="设置"
  >
    <SettingsIcon size={14} />
  </button>
  ```
- 清理旧的 `navBtn` helper 如果不再需要。

## 验收标准

- `pnpm tsc --noEmit` 通过。
- `pnpm vitest run` 通过。
- 第二层会话标题栏右侧不再显示「验收」「验收并归档」「恢复」按钮；「终端」保留图文形式。
- 切入未运行会话时触发 `rpcEnsureLive` 自动唤醒。
- 顶栏左侧无「首页」，设置单列为一个紧凑的 `⚙️` 图标。
