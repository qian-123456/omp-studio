# SideChat 底部对话框优化规格

## 目标
重构 `src/features/sidechat/SideChatPanel.tsx` 底部的提问输入区，摆脱生硬的单行框与紫色粗糙按钮，使其设计语言与主 Composer（圆角卡片、透气间距、动态激活发送按钮）保持一致。

## 详细改动

### 1. 卡片式外层容器
- 原先：粗糙的 border-t + 裸露 textarea + 独立紫色按钮。
- 现在：
  - 容器外框：`rounded-xl border border-neutral-800/80 bg-neutral-900/90 shadow-sm focus-within:border-neutral-700 focus-within:ring-1 focus-within:ring-neutral-700/40 p-2.5 transition-all`
  - 如果有上下文继承（`parent`）或引用胶囊（`pendingSelection`），优雅收纳在卡片顶部微条内。

### 2. 文本输入域（Textarea）
- 样式：`w-full resize-none bg-transparent text-[12px] leading-relaxed text-neutral-100 placeholder:text-neutral-500/60 outline-none max-h-32 min-h-[44px]`。
- 占位符：`输入侧聊提问... (Enter 发送，Shift+Enter 换行)`。
- 自动按内容高度扩展，但最大限制约 120px，超出滚动。

### 3. 卡片底部操作栏（Footer）
- **左侧提示**：
  - 展示极简微文本：如 `💡 独立侧聊分支` 或空，轻量不抢视线。
- **右侧发送按钮**：
  - 规格：微型圆钮 `h-6 w-6 rounded-full flex items-center justify-center transition-all duration-150`。
  - 图标：`ArrowUp size={13}` 或 `Send size={12}`。
  - **未输入文本时（`!question.trim()`）**：
    `bg-neutral-800 text-neutral-500 cursor-not-allowed`。
  - **有文本输入时（`question.trim()`）**：
    平滑激活为纯白高亮底色 + 纯黑向上箭头（`bg-white text-neutral-950 hover:bg-neutral-200 active:scale-95 shadow-sm`）。
  - **繁忙中时（`busy`）**：
    显示 `Loader2 size={12} className="animate-spin text-neutral-400"`。

## 验收标准
- 侧聊底部输入框呈现现代化的卡片质感，内嵌自动高度文本域与底部操作条。
- 输入文本时发送按钮动态高亮。
- 快捷键（Enter 发送，Shift+Enter 换行）正常工作。
- `pnpm tsc --noEmit` 通过。
- `pnpm vitest run` 通过。
