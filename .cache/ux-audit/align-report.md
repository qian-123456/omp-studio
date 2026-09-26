# omp-workspace vs Codex App / ZCode 核心功能对齐审查

合并自 AlignSidebar / AlignChat / AlignPanels 三个只读侦察报告，已剔除原创模块（待办、收集箱、服务、热力图、手机端、设置）。
抽查 4 处 🔴 结论全部属实。分级：🔴 差距明显 / 🟡 细节粗糙 / 🔵 整块缺失。
标记 ◆ = 前端可独立修复；◇ = 需要新后端 IPC；✕ = 受上游/架构阻塞（短期不可修）。

## 一、中栏消息区（AlignChat）

### 🔴
1. ◆ 消息操作条缺「引用」按钮，且固定在消息右上而非底部 — `MessageList.tsx:144-170`
2. ◆ 审批弹窗只有「确认/取消 + 复选框」，不是三档并列按钮 — `PendingUiCard.tsx:104-141`
3. ◇ 审批「本会话始终允许」不持久化为全局工具白名单 — `PendingUiCard.tsx:46-49`
4. ◆ Annotation pill 无法编辑批注；划选引用时也没有批注输入框 — `Composer.tsx:493` / `SelectionToolbar.tsx:114`
5. ◆ 暂存列表 `key={i-text.length}` 导致编辑时每次按键重建 textarea、丢焦点（实测属实的 Bug）— `HeldQueueBar.tsx:106`

### 🔵
6. ◇ Composer 无 `@` 文件补全 — `Composer.tsx:128`
7. ◇ 无法拖拽文件 / 粘贴图片进入上下文 — `Composer.tsx:554`

### 🟡（13 项，择要）
- 流式无尾部光标；流式进行中 thinking 默认折叠无脉冲；无思考耗时
- 工具卡 running/pending 与 done 底色无区分；无执行耗时
- 顶栏状态灯只看 `meta.status`，streaming 中可能显示 idle — `SessionView.tsx:100`
- 输入历史不持久化（内存 Zustand）— `composer.ts:79`
- DiffView 的正则只认 ` 38|t` 私有格式，标准 `@@` diff 行号全丢 — `DiffView.tsx:16`
- 代码块无行号、无超长折叠；未指定语言只显示 CODE

## 二、左栏会话列表（AlignSidebar）

### 🔴
8. ◆ 标题行单行塞 11 个元素，280px 侧栏下标题只剩 3~5 字 — `SessionRow.tsx:505`
9. ◇ 每行 mount 各发一次 `sessionUsage` IPC（N+1），且会话进行中永不刷新 — `SessionRow.tsx:198`
10. ◆ 鼠标点击行后焦点不落列表容器，↑↓ 键盘导航直接失灵 — `SessionSidebar.tsx:516`
11. ◆ ↑↓ 键立即切换会话（无 highlight/selection 分离、无防抖），快速滚动触发 IPC 风暴 — `SessionSidebar.tsx:357`
12. ◆ 置顶仅作组内排序权重，工作区一折叠置顶就被埋 — `grouping.ts:98`
13. ◆ 归档当前选中会话后 `selectedSessionId` 悬空，键盘导航瘫痪 — `SessionSidebar.tsx:374`
14. ◆ 分组/折叠状态全在组件内存，`Cmd+B` 收起再展开就全重置 — `SessionSidebar.tsx:106`
15. ◆ 折叠组内部 working/error 状态不向上冒泡，折叠后失联 — `SessionSidebar.tsx:563`
16. ◆ `working` 无文字徽标（只有绿点；4 个待处理状态有 pill）— `SessionRow.tsx:64`

### 🔵（3 项）
- ◆ 多选 + 批量操作整块缺失 — `SessionSidebar.tsx:349`
- ◆ 树节点 ←/→ 折叠展开缺失；「全部折叠/展开」按钮缺失
- （🟡 其余 11 项略：重命名用全屏模态而非内联、右键菜单无快捷键标注且项目神隐跳动、`Cmd+F` 聚焦搜索缺失、骨架屏失真等）

## 三、侧聊 / Git / 终端（AlignPanels）

### 🔴
17. ✕ 侧聊不是真 fork：后端只把 `git status`/摘要注入 system prompt，UI 却显示「继承上下文 ~N tokens」（token 还是累加错值，误导）— `rpc/sidechat.rs` / `SideChatPanel.tsx:300`
18. ◆ 主视图打开侧聊后无父会话面包屑/返回按钮，与父会话割裂 — `SessionView.tsx`
19. ◇ 侧聊结论无法回传父会话（可先做轻量版：末条回复作为 annotation 注入父 Composer）— `SideChatPanel.tsx`
20. ◆ DiffModal 无 Split 双栏、无语法高亮；与 DiffView 两套 diff 实现互不复用 — `DiffModal.tsx`
21. ◆ 清理正在使用的 worktree 无保护，会直接删掉运行中 Agent 的 CWD — `WorktreeSection.tsx:226`
22. ◇ NewSessionDialog 只在有 live 会话时才能拉模型列表，冷启动模型面板全空 — `NewSessionDialog.tsx:94`
23. ✕ 终端与 RPC 通道互斥：进终端要挂起 Agent、回聊天要断终端 — `TerminalView.tsx:583`
24. ◆ 删除/归档会话不清理 `terminalRegistry`，PTY 幽灵残留 — `TerminalView.tsx:56`

### 🟡（15 项，择要）
- `/fork` 空参数直接发 RPC — `Composer.tsx:257`
- 侧聊 `localeCompare` 排序，`#1.10` 排在 `#1.2` 前
- DiffModal 跨 hunk 选择把中间未改行也算进批注行号区间 — `diff.ts:80`
- 「放弃改动」走 `dispatchPrompt` 让 Agent 干活而非 `git restore` — `ChangesSection.tsx:82`
- 终端搜索无命中计数；右键菜单无边界翻转

## 汇总

| 等级 | 数量 | 前端可修 | 需后端 IPC | 上游阻塞 |
|---|---|---|---|---|
| 🔴 | 20 | 15 | 4 | 4* |
| 🔵 | 6 | 3 | 3 | — |
| 🟡 | ~39 | 绝大多数 | 少数 | — |

*真 fork 对话树、终端/RPC 并行、全局白名单持久化、附件管线 4 项依赖 omp 上游能力或架构改动。
