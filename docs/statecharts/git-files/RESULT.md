# Git / 文件 / 存储生命周期审计

本次完成了：只读源码审计、五个有限模型、中文 Mermaid/PNG、公开入口隔离回放与逐文件覆盖表。未修改产品源码。

本次未完成：原生 Tauri/Rust 入口、真实浏览器窗口、真实进程/Trash 的端到端回放，以及图片 GC、目录树和其余 out-of-model 操作的状态机验证；不宣称全程序验证或产品已修复。

## 基线与边界

基线 `7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`。每个动作的源码引用在 `.tla`；`logs/source-citations.txt` 是技能 `uncitedConditions` 对全部模型的零未匹配条件证据。零未匹配只是语法级引用检查，不证明抽象完整。模型仅枚举有限文本/轮次/工作树，排除了平台故障细节和第三方内部状态。

消费者回放：`replay/git-files.replay.test.tsx` 的 8 项通过，实际导入 FilePreviewPanel、Zustand 与 useOrphans；IPC/确认框是外部边界 mock。`replay/extension-checkpoints.replay.ts` 的 4 项隔离 git 检查通过，实际调用扩展注册事件。它们是现有行为重现证据，不是修复验收。原生失败/占用输入被 mock 的后续结论不能提升为原生缺陷确认。

## 模型与图

所有 PNG 已逐个打开。概览较宽，阅读具体缺陷请优先打开编号 bug PNG；概览仅用于索引。`--cover` 的省略清单完整保存在各 summary.json。中文状态/动作/原因标签不使用模型标识符；工具内置 Legend/Works 等图例仍是英文。

### FileBuffer

[概览](FileBuffer/chart/chart.png) · [Mermaid](FileBuffer/chart/chart.mmd) · [编号路径](FileBuffer/chart/stories.md)

模型状态 36896；图状态 225，图边 229；cover 省略 63 个标签状态和 1164 条边（来自 `file-buffer/out/summary.json`）。

两个标签、有限文本版本；IPC 为读写边界 mock，验证真实 React/CodeMirror 与 Zustand；未验原生文件权限/浏览器窗口行为。后台磁盘写入在概览中可能合并为隐藏步骤，完整 TLC 与 replay 保留该事件。

### Worktree

[概览](Worktree/chart/chart.png) · [Mermaid](Worktree/chart/chart.mmd) · [编号路径](Worktree/chart/stories.md)

模型状态 658；图状态 249，图边 248；cover 省略 15 个标签状态和 1119 条边（来自 `worktree/out/summary.json`）。

一个会话工作树、一个旧提交工作树；原生 Rust/git/process 未调用；UI replay 只证明请求参数/快照/错误后列表，不能证明运行中进程真正被杀或目录真正删除。NoKillRunningRun 名称只指运行目录被删，非已证实进程死亡。

### Checkpoint

[概览](Checkpoint/chart/chart.png) · [Mermaid](Checkpoint/chart/chart.mmd) · [编号路径](Checkpoint/chart/stories.md)

模型状态 2498；图状态 235，图边 235；cover 省略 1 个标签状态和 390 条边（来自 `checkpoint/out/summary.json`）。

三轮、保留两轮抽象生产 KEEP_TURNS=50；同会话、单文件；公开扩展事件在隔离 git 仓库回放。撤回标记回放以 git ref 种子作为边界输入，不声称调用过 Rust undo_turn。NoSilentOverwrite 的最短路径是用户在轮次结束前改动，被同一快照捕获，属于归属设计问题，不是已证实无提示覆盖“轮后”编辑。

### BaseSync

[概览](BaseSync/chart/chart.png) · [Mermaid](BaseSync/chart/chart.mmd) · [编号路径](BaseSync/chart/stories.md)

模型状态 74；图状态 70，图边 39；cover 省略 0 个标签状态和 28 条边（来自 `base-sync/out/summary.json`）。

有限 ahead/behind 和快进失败原因；合并/快进历史压缩为布尔量，所谓合并提交也可能是快进 HEAD 变化；原生入口未回放，失败原子性是待确认设计契约。

### Storage

[概览](Storage/chart/chart.png) · [Mermaid](Storage/chart/chart.mmd) · [编号路径](Storage/chart/stories.md)

模型状态 22；图状态 22，图边 21；cover 省略 0 个标签状态和 26 条边（来自 `storage/out/summary.json`）。

单个会话；会话状态切换是 runtime 输入契约，不模拟底层启动/锁；只建模 skip_reason 与 delete_with 的检查/执行边界；未回放 native 竞态，未建模图片年龄、节流、部分删除失败、锁/Trash 平台语义。

## 核心源码契约

- 文件编辑：`src/features/editor/useFileBuffer.ts:48-75` 重置/聚焦读取，`:77-92` 保存；`src/features/files/FilePreviewPanel.tsx:145,163,214` 无确认 reload / 按路径重建；`src/stores/filePreview.ts:68-78` 关闭与切换。`DocView.tsx:91` 对 reload 有确认，不能推广到右侧文件预览。
- 文件写入：`src-tauri/src/services/commands.rs:37-46` 没有版本参数；`services/files.rs:73-92` 临时写入再 rename。`src-tauri/src/omp_files.rs` 的 stamped write 是另一调用契约，不能假定普通编辑保存也享有该冲突保护。
- 工作树：`src-tauri/src/git/worktree.rs:431-466` 先删目录、再删分支；`:484` 孤儿按会话引用筛选；`src/features/git/OrphanBadge.tsx:68-127` 请求使用当前快照并在整体成功后才更新列表。`src-tauri/src/git/tm.rs:253-408` 运行/停止独立于会话引用。
- 检查点：`extension/omp-workspace-checkpoints.ts:422-427` 切换直接清空 current；`:468-536` 开始/结束记录；`:309-323` 保留 50 轮并清理 undone；`src-tauri/src/git/turns.rs:301-311,414-575` 可撤回标志、级联预检与冲突检查。轮内用户编辑属于整轮快照的设计问题，不声称是轮后编辑绕过冲突检查。
- 基线同步：`src-tauri/src/git/base_sync.rs:100-128` 当前分支先并入、基础分支再快进；失败原子性需契约确认。
- 存储：`src-tauri/src/storage/mod.rs:436-451` 检查元数据再调用删除；`storage/sessions.rs` 的 skip_reason 与 `src-tauri/src/catalog/mod.rs:638-704` 真正执行的守卫不同。竞态模型允许两次检查间 runtime 输入变化，但未验证其原生可达调度。图片清理年龄/节流等明确不在模型内。

## 每条路径的结论

- **NoLossOnClose**（FileBuffer，reproduced consumer behavior）：未保存的修改在关闭标签时不会丢失。 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 按 file-buffer/out/stories.md 的编号 1 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoLossOnReload**（FileBuffer，reproduced consumer behavior）：未保存的修改在点重新载入时不会在没确认的情况下丢失。 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 按 file-buffer/out/stories.md 的编号 2 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoLossOnSwitch**（FileBuffer，reproduced consumer behavior）：未保存的修改在切换标签时不会丢失。 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 按 file-buffer/out/stories.md 的编号 3 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoClobber**（FileBuffer，reproduced consumer behavior）：保存不会悄悄覆盖用户从没看到过的磁盘改动。 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 按 file-buffer/out/stories.md 的编号 4 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoLossOnRefresh**（FileBuffer，reproduced consumer behavior）：窗口聚焦后的后台刷新不会冲掉用户刚输入的文字。 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 按 file-buffer/out/stories.md 的编号 5 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoKillRunningRun**（Worktree，trace-and-source-only hypothesis）：正在运行的时光机不会被「回收孤儿」删掉目录。 真实 useOrphans 证明使用旧扫描结果且提交无占用信息的删除请求；Rust 删除与进程影响未回放。 按 worktree/out/stories.md 的编号 1 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoRemoveInUse**（Worktree，trace-and-source-only hypothesis）：有会话在用的工作树不会被「回收孤儿」删掉。 真实 useOrphans 证明使用旧扫描结果且提交无占用信息的删除请求；Rust 删除与进程影响未回放。 按 worktree/out/stories.md 的编号 2 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoStaleListing**（Worktree，reproduced consumer behavior）：清理失败后，界面不会再显示一个磁盘上已经不存在的工作树。 真实 useOrphans.reclaim 收到原生边界的部分成功错误后，旧列表保留且没有再次扫描；真实目录删除部分来自源码，未在本测试执行。 按 worktree/out/stories.md 的编号 3 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoLeftoverSnapshots**（Checkpoint，reproduced consumer behavior）：没有正在记录的轮次时，不会留下只有开始快照、没有条目的残留存档。 公开扩展注册的 agent_start/agent_end/session_switch 事件，独立 mkdtemp git 仓库。前者验证切会话遗留 before ref 且以后不清理；后者在 52 轮中验证已种入 undone 标记随旧存档删除，条目仍保留；未调用 Rust 撤回。 按 checkpoint/out/stories.md 的编号 1 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoSilentOverwrite**（Checkpoint，design question）：撤回不会悄悄覆盖用户之后做的改动。 未回放 Rust undo_turn；最短路径用户在轮内改动，需决定整轮快照是否包含这些改动，不能归类为已确认的轮后编辑丢失。 按 checkpoint/out/stories.md 的编号 2 路径逐步读取；未提出/未建模修复；产品未修改。
- **UndoneStaysUndone**（Checkpoint，reproduced consumer behavior）：已经撤回过的轮次，在存档清理之后仍然显示为已撤回。 公开扩展注册的 agent_start/agent_end/session_switch 事件，独立 mkdtemp git 仓库。前者验证切会话遗留 before ref 且以后不清理；后者在 52 轮中验证已种入 undone 标记随旧存档删除，条目仍保留；未调用 Rust 撤回。 按 checkpoint/out/stories.md 的编号 3 路径逐步读取；未提出/未建模修复；产品未修改。
- **ErrorLeavesBranchUntouched**（BaseSync，design question）：同步或变基报错时，当前分支的提交历史保持同步前的样子。 源码显示当前分支先变更，随后基础分支快进可失败；需决定错误原子性契约，原生入口未执行。 按 base-sync/out/stories.md 的编号 1 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoTrashPinned**（Storage，trace-and-source-only hypothesis）：清理不会删掉检查之后才被置顶的会话。 未回放原生入口；只提供模型路径和源码，不能视为确认产品缺陷。 按 storage/out/stories.md 的编号 1 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoTrashStartedAfterCheck**（Storage，trace-and-source-only hypothesis）：清理不会删掉检查之后才被启动的会话。 未回放原生入口；只提供模型路径和源码，不能视为确认产品缺陷。 按 storage/out/stories.md 的编号 2 路径逐步读取；未提出/未建模修复；产品未修改。
- **NoTrashTerminalHeld**（Storage，trace-and-source-only hypothesis）：清理不会删掉被终端里的 omp 占用的会话。 未回放原生入口；只提供模型路径和源码，不能视为确认产品缺陷。 按 storage/out/stories.md 的编号 3 路径逐步读取；未提出/未建模修复；产品未修改。

## 再生成与命令

```
export TLA2TOOLS=<TLA2TOOLS>
export JAVA=<JAVA>
sh regenerate-all.sh
```

`regenerate-all.sh` 和 result.json 中每条命令显式传全部已知 `--expect-broken`；新增/消失规则均必须非零退出。先前探索轮无 expect 参数时退出 1 是预期发现，不是工具成功验证；当前 FileBuffer、Worktree、BaseSync 已按精确集合重生成为 0；Checkpoint、Storage 最后一次输出为已知反例 exit 1，严格集合脚本留给主代理统一迁址验收，不声称已执行该完整脚本。最初 Checkpoint 的序列下标 0 模型错误已修正为 IF 守卫并成功完整重跑，未作为产品缺陷。

聚焦回放命令（从仓库根目录；模型可搬迁，replay 配置仍按其顶部 REPO 定位源码）：

```
./node_modules/.bin/vitest run --config <scratch>/git-files/replay/vitest.config.mts
<HOME>/.bun/bin/bun run <scratch>/git-files/replay/extension-checkpoints.replay.ts
```

## 所有权覆盖表

`modeled` 只表示相关状态进入模型，不代表整个模块全部验证。`out-of-model` 明确未作状态验证结论。

| 文件 | 状态 | 原因 |
|---|---|---|
| `extension/autocommit-rule.md` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `extension/omp-workspace-checkpoints.ts` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src-tauri/src/git/base_sync.rs` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src-tauri/src/git/checkpoints_ext.rs` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src-tauri/src/git/cmd.rs` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src-tauri/src/git/commands.rs` | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| `src-tauri/src/git/history.rs` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src-tauri/src/git/mod.rs` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src-tauri/src/git/status.rs` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src-tauri/src/git/tests.rs` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src-tauri/src/git/tm.rs` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src-tauri/src/git/turns.rs` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src-tauri/src/git/worktree.rs` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src-tauri/src/omp_files.rs` | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| `src-tauri/src/storage/fsutil.rs` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src-tauri/src/storage/images.rs` | read-only | 已读图片引用/垃圾回收实现；30天年龄、24小时节流、部分失败和草稿引用未建模/未回放 |
| `src-tauri/src/storage/mod.rs` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src-tauri/src/storage/sessions.rs` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src/features/editor/DocView.tsx` | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| `src/features/editor/useFileBuffer.ts` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src/features/explorer/FileExplorer.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/explorer/FileIcon.test.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/explorer/FileIcon.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/explorer/FileTreeNode.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/explorer/WorkspaceCard.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/files/FileEditor.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/files/FilePreviewPanel.test.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/files/FilePreviewPanel.tsx` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src/features/git/BranchAssetSection.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/ChangesSection.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/CheckpointsCard.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/DiffModal.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/GitPanel.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/NewSessionDialog.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/OrphanBadge.test.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/OrphanBadge.tsx` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src/features/git/OrphanBanner.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/TimelineSection.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/TmRunCard.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/WorktreeActionMenu.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/WorktreeCommitPopover.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/WorktreeGraph.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/WorktreeHoverCard.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/WorktreeSection.tsx` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/diff.test.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/diff.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/helpers.test.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/helpers.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/removeWorktree.tsx` | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| `src/features/git/turns.test.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/features/git/turns.ts` | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| `src/features/git/useAutoRefresh.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/stores/explorer.ts` | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| `src/stores/filePreview.test.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/stores/filePreview.ts` | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| `src/stores/turnNav.ts` | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| `src/stores/worktrees.test.ts` | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| `src/stores/worktrees.ts` | read-only | 用于边界/调用契约对照；未单独建立状态机 |
