# 顶部单排大一统规格（参考 zcode 单排设计）

## 目标
消除当前主界面顶部“App 顶栏 + SessionView 次级头部”两排重叠占用约 80px 高度的问题。将顶部合并为极简统一的单排 Header（h-10，40px），大幅增加对话和终端区域的有效垂直高度，对齐 zcode 的通透宽敞质感。

## 详细改动

### 1. `src/App.tsx` 顶栏重构
统一顶栏结构（从左到右）：
- **左侧**：
  - macOS 交通灯占位（`isMac ? "pl-[78px]" : "pl-2.5"`）
  - 侧边栏折叠按钮 `[ |< ]`
- **中间（当前视图信息）**：
  - 当 `centerView === "session"` 且存在 `activeSession` 时：
    - 若为侧聊分支（`activeSession.parentId`），显示返回父会话的面包屑：`[ ← 父会话名 ] /`
    - 会话运行状态小圆点（`STATUS_DOT[status]`）
    - 会话标题：单行截断，支持双击就地重命名（或点击编辑），带 tooltip 展示标题及路径 `cwd`
  - 当 `centerView !== "session"`（如设置、文档、待办）时：
    - 若有活跃会话，显示 `[ ← 返回 会话名 ]` 按钮
    - 页面标题文字（如“设置”、“文档”）
- **右侧（操作与胶囊整合在同一排）**：
  - 若在 session 视图：
    - `[ 📁 访达打开 ]` 按钮（仅当有 cwd 时可点）
    - `[ 🔗 分享/导出 ]` 按钮及 Popover（复制 Markdown、手机扫码配对）
    - `[ >_ 终端 ]` / `[ 💬 聊天 ]` 视图切换按钮（保持文字与图标）
  - `TopCapsule` 待办与收集箱胶囊（`[ ● 待处理 X/Y │ 📥 收集箱 N ]`）
  - 右侧栏折叠按钮 `[ 匚 ]`

### 2. `src/features/chat/SessionView.tsx` 去除冗余头部
- 移除 `SessionView` 顶部的 `<div className="relative flex shrink-0 items-center gap-2 border-b border-neutral-800/80 px-3.5 py-2">` 容器。
- 移出其中的双击改名、Finder、Share、Terminal 按钮逻辑（由 App 统一顶栏或者顶栏组件承载）。
- `SessionView` 内部的内容（消息流 `MessageList`、悬浮工具栏、Composer、或终端 `TerminalView`）直接从顶部铺开，顶端不再有次级分割线。

## 验收标准
- 顶部只有**唯这一排** Header（高度 40px），没有第二层分割栏。
- 会话标题、状态圆点、父会话返回、访达、分享、终端切换、TopCapsule、侧边栏折叠按钮全部在单单一排中有序排列，无换行溢出。
- `pnpm tsc --noEmit` 通过。
- `pnpm vitest run` 通过。
