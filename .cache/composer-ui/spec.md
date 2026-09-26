# Composer 输入框 UI / UX 深度优化规格（参考 zcode / codex / ccgui）

## 变更目标

综合用户给出的三张参考图（zcode、codex、ccgui），重构 `src/features/chat/Composer.tsx` 的视觉质感与交互细节，解决原输入框“中英混杂、塑料感重、控件笨拙、反馈迟钝”的问题。

## 详细改动点

### 1. 占位符（Placeholder）
- 非流式（空闲时）：`提出后续修改要求... (Enter 发送，Shift+Enter 换行，/ 命令，@ 文件)`
- 流式（运行中时）：`输入消息... (Enter 暂存，⌘Enter 插队)`
- 样式：`placeholder:text-neutral-500/60`，不抢占视线。

### 2. 左下角操作区（轻盈透气，左侧只放操作）
- **`+` 加号按钮**（参考 codex / zcode / ccgui）：
  - 规格：`flex h-6 w-6 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 transition-colors`
  - 图标：`Plus size={14}`
- **权限切换胶囊**（参考 zcode 的 `🛡️ 完全访问 ▾` 与 codex 的 `(!) Full access`）：
  - `approvalMode === "auto"`（全自动）：
    - 琥珀色调：`text-amber-400 hover:text-amber-300 hover:bg-amber-950/30 px-2 py-0.5 rounded-md`
    - 图标：`AlertCircle size={12} className="text-amber-400"`
    - 文字：`完全访问`
    - 尾部增加下拉箭头：`ChevronDown size={10} className="text-amber-500/70"`
  - `approvalMode !== "auto"`（写入需确认）：
    - 低调中性色：`text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60 px-2 py-0.5 rounded-md`
    - 图标：`ShieldCheck size={12} className="text-neutral-400"`
    - 文字：`需确认写入`
    - 尾部增加下拉箭头：`ChevronDown size={10} className="text-neutral-500"`
- **移出 ContextRing**：不再把上下文环塞在左边，挪到右下角与模型并列（与 zcode 图 1 排布一致）。

### 3. 右下角状态与选择区（参考 zcode 的流线排布）
排布顺序（从左到右）：
`[ ◯ 上下文环 ]`  `[ 🤖 模型名 ▾ ]`  `[ 🧠 思考等级 ▾ ]`  `[ 暂存胶囊 (如有) ]`  `[ ↑ 发送按钮 ]`

- **上下文 Token 环（ContextRing）**：
  - 放置在模型选择器左侧，拉开微弱间距。
- **模型选择器（Model Picker）**：
  - 摆脱原先笨重的厚底框，改用轻量无边框微胶囊：
    `flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 transition-colors`
  - 图标保持 `Bot size={11} className="text-neutral-400"`，尾部 `ChevronDown size={10}`。
- **思考等级（Thinking Level）**：
  - 同样采用轻量微胶囊，与模型选择器视觉完全统一：
    `flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors`
  - 图标 `Brain size={11}`，尾部 `ChevronDown size={10}`。
- **发送按钮（Send Button）动态激活——核心质感提升（参考 zcode & codex）**：
  - **无文字时（`!text.trim()`）**：
    `flex h-7 w-7 items-center justify-center rounded-full bg-neutral-800/80 text-neutral-500 cursor-not-allowed transition-all duration-200`
  - **有输入文字时（`text.trim()`）**：
    平滑激活为**纯白底色 + 纯黑向上箭头**（`bg-white text-neutral-950 hover:bg-neutral-200 active:scale-95 shadow-sm transition-all duration-150`）！
  - **Agent 运行中时（`streaming`）**：
    保持红框停止按钮 `[ ⏹ ]`，输入框有文字时显示 `[ 暂存 ]` 与 `[ ⚡ 插队 ]`。

### 4. 卡片整体边框与光影（Codex 质感）
- 外层容器：`rounded-2xl border border-neutral-800/80 bg-neutral-900/90 shadow-sm backdrop-blur-sm transition-all duration-200 focus-within:border-neutral-700 focus-within:ring-1 focus-within:ring-neutral-700/40`。
- Textarea 内边距：`px-3.5 pt-3 pb-1 text-[13px] leading-relaxed`，给光标和文字舒适的呼吸感。

## 验收标准

- `pnpm tsc --noEmit` 通过。
- `pnpm vitest run` 通过。
- 占位符显示为自然的中文提示。
- 左下角：`+` 按钮微圆角质感，权限模式带有 `▾` 下拉箭头，全自动时显示橙色 `完全访问`。
- 右下角：`ContextRing` 位于模型选择器左侧，模型与思考等级为轻量通透的无厚框微胶囊。
- 发送按钮在有文本输入时平滑变为亮白高对比度底色。
