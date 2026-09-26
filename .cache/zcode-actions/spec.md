# 模仿 ccgui 设置位置 + 模仿 zcode 头部 3 按钮（分享/Finder/终端）规格

## 变更目标

1. **设置挪到左侧栏最底端（模仿 ccgui 图 1）**：
   - 在 `SessionSidebar.tsx` 最底部增加固定 footer：`[ ⚙️ 设置 ]`（图标 + 文本），点击在中央打开设置（已在设置时点它切回会话）。
   - 在 `App.tsx` 顶栏左侧彻底移除设置按钮，顶栏左侧仅保留 macOS 交通灯与 `[ |< ]` 侧栏开关。

2. **会话标题栏右上角增加 zcode 风格 3 个操作按钮（模仿 zcode 图 2）**：
   位置：`SessionView.tsx` 顶部标题栏右侧 `flex-1` 之后。
   三个按钮依次为：
   - **Finder（访达）**：
     - 图标：`FolderOpen`（或 Finder 风格）。
     - 动作：点击调用 `@tauri-apps/plugin-opener` 的 `revealItemInDir(meta.cwd)`，失败时回退到 `openPath(meta.cwd)`；无 cwd 时禁用。
     - 悬浮提示：`在访达中显示 (${meta?.cwd ?? ""})`。
   - **Share（分享）**：
     - 图标：`Share2`（方框带向上箭头）。
     - 动作：点击弹出一个小巧的轻量下拉菜单（SharePopover），提供 2 个最实用动作：
       1. **复制为 Markdown**：遍历 `items` 提取格式化对话（User / Assistant / Tool），写入系统剪贴板并 toast 提示“已复制整场对话 Markdown”；
       2. **手机扫码查看**：调用 `mobileCreatePairing(false)` 获取 `qrSvg`，弹出极简二维码弹窗，手机扫码即可随时接力查看。
     - 支持 Esc 和点击外部关闭。
   - **Terminal（终端）**：
     - 用户强调保留文字：继续呈现为 `[ >_ 终端 ]` / `[ 💬 聊天 ]`（带有 `TerminalSquare` 图标 + 文字），点击切换视图模式。

## 详细改动

### 1. `src/features/sessions/SessionSidebar.tsx`
- 底部在 `undoItem` 下方挂载固定底栏：
  ```tsx
  <div className="flex shrink-0 items-center justify-between border-t border-neutral-800/80 px-3 py-2 bg-neutral-900/50">
    <button
      type="button"
      onClick={() => setCenter(centerView === "settings" ? (selectedSessionId ? "session" : "home") : "settings")}
      className={clsx(
        "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
        centerView === "settings"
          ? "bg-neutral-800 text-neutral-100 font-medium"
          : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200"
      )}
    >
      <SettingsIcon size={14} />
      <span>设置</span>
    </button>
  </div>
  ```
- 需要从 `lucide-react` import `Settings as SettingsIcon`，并从 `useUi` 获取 `centerView`, `setCenter`, `selectedSessionId`。

### 2. `src/App.tsx`
- 顶栏删除 `<button ... onClick={() => setCenter(...) } title="设置">` 按钮。
- 清理无用的 `Settings as SettingsIcon` import。

### 3. `src/features/chat/SessionView.tsx` 与分享菜单
- 在会话标题栏右侧放置 3 个按钮组：
  ```tsx
  <div className="flex items-center gap-1.5">
    {/* Finder */}
    <button
      type="button"
      disabled={!meta?.cwd}
      onClick={handleOpenInFinder}
      title={meta?.cwd ? `在访达中显示: ${meta.cwd}` : "无工作目录"}
      className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200 disabled:opacity-30 transition-colors"
    >
      <FolderOpen size={14} />
    </button>

    {/* Share */}
    <div className="relative">
      <button
        type="button"
        onClick={() => setShareOpen(!shareOpen)}
        title="分享与导出"
        className={clsx(
          "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
          shareOpen ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200"
        )}
      >
        <Share2 size={14} />
      </button>
      {/* Share Popover: 复制 Markdown / 手机扫码查看 */}
      {shareOpen && (
        <div ref={shareRef} className="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-lg border border-neutral-700 bg-neutral-900 p-1 text-xs shadow-xl">
          <button type="button" onClick={handleCopyMarkdown} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white">
            <Copy size={13} />
            <span>复制为 Markdown</span>
          </button>
          <button type="button" onClick={handleMobilePair} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-neutral-300 hover:bg-neutral-800 hover:text-white">
            <QrCode size={13} />
            <span>手机扫码查看</span>
          </button>
        </div>
      )}
    </div>

    {/* Terminal (保持文字与图标) */}
    <button
      type="button"
      onClick={toggleTerminal}
      className={clsx(
        "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
        viewMode === "terminal"
          ? "border border-indigo-500/40 bg-indigo-600/20 text-indigo-300"
          : "text-neutral-400 hover:bg-neutral-800/80 hover:text-neutral-200"
      )}
    >
      {viewMode === "chat" ? <><TerminalSquare size={13} /><span>终端</span></> : <><MessageSquare size={13} /><span>聊天</span></>}
    </button>
  </div>
  ```
- 手机扫码展示弹窗：可由 `qrInfo` 状态渲染一个轻量弹窗显示 `dangerouslySetInnerHTML={{ __html: qrSvg }}`，扫码直达；支持 Esc 关闭。
- Markdown 复制逻辑：从 `useLive.getState().sessions[sessionId]?.items` 读取当前消息流，按 `### User` / `### Assistant` 格式化导出并复制到剪贴板。

## 验收

- `pnpm tsc --noEmit` 通过。
- `pnpm vitest run` 通过。
- 左侧边栏最底端显示 `⚙ 设置`，点击进入设置页并高亮，再次点击切回。
- 顶栏无设置按钮，极其整洁。
- 会话标题栏右侧依次显示：Finder 图标按钮、Share 分享按钮、`[ >_ 终端 ]` 图文按钮。
- 点击 Finder 正常在访达打开当前路径。
- 点击 Share 展开菜单，可复制 Markdown 与手机扫码。
