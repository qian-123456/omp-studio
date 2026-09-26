# 对齐修复——跨切片契约（所有切片开工前必读）

完整差距清单在 `.cache/ux-audit/align-report.md`（行号精确）。本文件只钉**契约**。

## 新 IPC（Slice B0 在 `src-tauri` + `src/lib/ipc.ts` 提供；前端切片先按签名写代码）

```ts
// ipc.ts wrappers（B0 负责实现并 register）
listModels(): Promise<Model[]>                    // 无 live 会话时也能用：优先 `omp models --json`，否则读 OMP 全局配置；数据形状同 parseModels 输出
gitRestoreFile(repo: string, path: string): Promise<void>   // git restore <path>（未跟踪文件用 git clean -f）
gitListBranches(repo: string): Promise<string[]>            // 本地+远程分支名（去远程前缀去重，当前分支排第一）
batchSessionUsage(ids: string[]): Promise<Record<string, UsageSummary>>  // 批量读 usage（catalog/usage.rs 既有逻辑复用）
saveClipboardImage(base64Png: string): Promise<string>      // 存到 cache dir /tmp 下 ompws-clip/<ts>.png，返回绝对路径
validatePath(path: string): Promise<{ exists: boolean; isDir: boolean }>  // 纯 fs 校验
allowedToolsList(): Promise<string[]>             // 读 OMP 全局 settings.toml 的 allowed-tools 白名单（没有该机制则返回 []，前端自动隐藏该档）
```

Tauri 命令名：`list_models` `git_restore_file` `git_list_branches` `batch_session_usage` `save_clipboard_image` `validate_path` `allowed_tools_list`。
所有命令注册进 `lib.rs` 的 `invoke_handler!`；前端 wrapper 加到 `src/lib/ipc.ts` 对应区域（★ 只有 B0 可以改 `ipc.ts`/`contracts.rs`/`contracts.ts`）。

## Store 层接口（各切片内实现，其他切片直接用现有公开 API）

- 侧聊回传父会话：用 `useComposer.addAnnotation(parentSessionId, { source: "message", text, itemId })` + `useUi.selectSession(parent)` —— **B5（侧聊）实现**，不给 composer store 加新字段。
- PTY 清理：`src/features/terminal/terminalRegistry.ts` 导出 `destroySessionTerminal(sessionId)`；在 `App.tsx`（或 sessions store）订阅 `sessions:removed` 事件调用 —— **B5 实现**，删除会话的 `deleteSession`/`archive` 走既有 store action，事件总线已存在（`sessions:removed` Tauri event，确认 store 已 listen）。
- `pendingSelection`/fork 调 SideChatPanel 已存在，直接用。

## 文件归属（越界改文件 = 冲突）

| 切片 | 独占文件 |
|---|---|
| B0 后端 | `src-tauri/**`、`src/lib/ipc.ts`、`src/lib/contracts.ts` |
| B1 Composer | `src/features/chat/Composer.tsx`、`src/stores/composer.ts`、`src/features/chat/HeldQueueBar.tsx`、`src/features/chat/heldQueue.ts` |
| B2 消息区 | `src/features/chat/{MessageList,ToolCard,PendingUiCard,markdown,DiffView,SelectionToolbar,send}.tsx/.ts` |
| B3 会话区 | `src/features/chat/SessionView.tsx`、`src/features/git/NewSessionDialog.tsx`、`src/features/sessions/**`、`src/stores/{sessions,ui}.ts` |
| B4 Git 面板 | `src/features/git/{GitPanel,ChangesSection,DiffModal,WorktreeSection,diff,helpers,removeWorktree,TimelineSection}.ts(x)`、`src/features/git/` 内新文件 |
| B5 侧聊+终端 | `src/features/sidechat/**`、`src/features/terminal/**`、`src/App.tsx`（仅注册 PTY 清理监听+返回会话快捷键） |

**共享文件仲裁**：`App.tsx` 归 B5；`NewSessionDialog.tsx` 归 B3；其他切片若发现必须改别人文件 → hub 留言给 Main 协调，不要直接改。

## 通用约定（沿用既有规则，不重复造轮子）

- 中文 UI；英文代码注释。无 formatter，保持现有风格。
- 异步按钮 disabled+spinner；catch → `toast.error`；破坏性操作 `confirmDialog`；隐藏 hover 按钮加 `focus:opacity-100`；Enter 有 `isComposing` 守卫；截断文本 `title` 给全文。
- 弹窗 Esc + 点击遮罩关闭；跨模块只用 `src/lib/*`。
- 验证只跑：`pnpm tsc --noEmit`、`pnpm vitest run`、`cd src-tauri && cargo check`。**不要跑项目全套 lint/格式化。**
- 写完报告：`Contract changes`（如有）+ 改动文件清单 + 未修项原因。
