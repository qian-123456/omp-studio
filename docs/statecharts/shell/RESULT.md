# 外壳/导航切片状态图审计结果

基线 7f85613。未修改任何产品文件。重新生成: `regenerate.sh`(需 TLA2TOOLS/JAVA)。

## 模型与边界
- **SpaceFollow** `models/space-follow/SpaceFollow.tla`;图 `models/space-follow/out/chart.png`、`bug-1.png`、`stories.md`、`summary.json`。modelStates=28 modelTransitions=78 chartStates=12 chartTransitions=38; fixed model keeps rule: works=8 fixed=4 wrong=0
- **DraftHandoff** `models/draft-handoff/DraftHandoff.tla`;图 `models/draft-handoff/out/chart.png`、`bug-1.png`、`stories.md`、`summary.json`。modelStates=19 modelTransitions=28 chartStates=12 chartTransitions=19; fixed model keeps rule: works=10 fixed=2 wrong=0
- **CenterPane** `models/center-pane/CenterPane.tla`;图 `models/center-pane/out/chart.png`、`bug-1.png`、`stories.md`、`summary.json`。modelStates=8 modelTransitions=22 chartStates=8 chartTransitions=24; fixed model keeps rule: works=7 fixed=1 wrong=0
- **StartupRestore** `models/startup-restore/StartupRestore.tla`;图 `models/startup-restore/out/chart.png`、`bug-1.png`、`stories.md`、`summary.json`。modelStates=20 modelTransitions=24 chartStates=14 chartTransitions=18; fixed model keeps rule: works=10 fixed=4 wrong=0

边界:用固定夹具(两个空间、一个会话/草稿)的有限抽象;不是整程序验证;只模型化「会话/草稿选择与页面」相关变量,运行时状态、右栏、拖拽宽度不在内。每个守卫在 .tla 中带 file:line 注释,检查脚本 uncited=0。

## 发现(均已用真实入口复现,日志 replay/replay.log)
1. **侧栏收起时打开其他空间的会话,重新展开后空间不跟随** — 规则 SpaceMatchesSelection;模型 SpaceFollow;步骤: Cmd+B 收起 → 收件箱等入口选其他空间会话(2 步,图 bug-1);复现: reproduced;证据: replay/app-shell.test.tsx F2: 渲染真实 App;收起后 selectSession('b'),重开后 activeMode=code,行 b 未渲染; 对照(侧栏开)跟随成功;代码: SessionSidebar.tsx:376-391, App.tsx:347, ui.ts:291-300; 直接调用 selectSession 的入口 InboxPage.tsx:66 等;修复模型: fixed model holds
2. **首条消息发送期间打开设置,完成后落到空白起始页而非新会话** — 规则 SendShowsSession;模型 DraftHandoff;步骤: 回车发送 → 打开设置 → 启动完成(3 步);复现: reproduced;证据: replay/handoff-settings.test.ts: sendFromDraft 进行中 openSettings,完成后 closeSettings,selectedSessionId=null;对照 forkDraft 同时序成功;代码: draftSession.ts:153-154 对比 forkDraft.ts:150-153,newSession.ts:100-108(设置期间保留草稿);修复模型: fixed model holds
3. **分支草稿开着时新建会话,中间区仍显示分支草稿** — 规则 NewSessionVisible;模型 CenterPane;步骤: 在运行会话点分支 → Cmd+N(2 步);复现: reproduced;证据: replay/app-shell.test.tsx F4: 渲染真实 App;可见 composer=fork-draft:…,而 pending 选中=local-draft:4;代码: App.tsx:121-130, newSession.ts:57-70, forkDraft.ts:130-136;修复模型: fixed model holds
4. **会话列表加载期间打开设置/收件箱,启动恢复抢走页面** — 规则 RestoreKeepsUserPage;模型 StartupRestore;步骤: 加载中打开页面 → 列表加载成功 → 恢复(3 步);复现: reproduced (设置页+上次会话在当前空间分支); 另一分支(上次会话不在当前空间→回首页)仅读码/模型 unverified;证据: replay/app-shell.test.tsx F3: 设置打开后加载完成,centerView=session,selected=a;代码: App.tsx:312-324, ui.ts:301-314;修复模型: fixed model holds
5. **Markdown 文件链接点击抛 ReferenceError: openFileLink is not defined** — 规则 (非状态机);模型 —;步骤: 点击 file:// 或相对路径链接;复现: reproduced;证据: replay/markdown-link.test.tsx 两例均 toast「打开链接失败: openFileLink is not defined」且预览页签 0;主线整套 Vitest fileLinkClick.test.tsx 6 例同因失败;代码: components/Markdown.tsx:295,299,340,515 使用但未导入(stores/filePreview.ts:176 导出);修复模型: n/a(类型诊断同源)

注意:模型的 StartupRestore 图第二条路径(上次会话不在当前空间→被带回首页)与 Markdown 之外,图中另一分支仅为模型+读码,未复现。F5 为缺失导入(类型诊断 TS2304),不是状态机缺陷,但与主线 fileLinkClick 失败吻合。另外 closeActive/dispatcher 对 previousCenterView 的默认值与 App 的 lastNonSettings 略有重复,读码未见可触发差异。

## 覆盖表
| 路径 | 功能 | 状态 | 原因 |
|---|---|---|---|
| src/App.tsx | 桌面外壳:中心视图选择/侧栏拖拽/启动恢复/错误边界 | modeled | 启动恢复(StartupRestore)、中心区草稿优先级(CenterPane)、侧栏挂载(SpaceFollow);拖拽宽度为单步 UI 状态,读码 |
| src/main.tsx | 启动:主题/会话事件/根错误边界 | read-only | RootErrorBoundary 只有 出错→重载 单向;初次加载失败 hasLoaded 保持 false(sessions.ts:336-337) 读码确认,无独立状态机 |
| src/stores/ui.ts | centerView/selectedSessionId/设置浮层/右栏记忆 | modeled | DraftHandoff、SpaceFollow、StartupRestore 引用其 selectSession/openSettings/closeSettings/leaveSession/toggleSidebar |
| src/features/sessions/pendingSession.ts, draftSession.ts, newSession.ts | 本地草稿创建/预热/移交/清理 | modeled | DraftHandoff 与 CenterPane |
| src/features/sessions/forkDraft.ts | 分支草稿 | modeled | CenterPane;其 visible 判定含设置浮层,作为 DraftHandoff 修复参照 |
| src/features/sessions/SessionSidebar.tsx, switchMode.ts, sidebarStore.ts, modes.ts, search/openSearchRow.ts | 空间(mode)隔离与跟随 | modeled | SpaceFollow |
| src/features/sessions/SessionRow.tsx, SessionDialogs.tsx, ResumeMissingCwdDialog.tsx, archiveUndo.ts, sessionActions.ts, grouping.ts 等 | 会话行/对话框/归档撤销/分组纯函数 | read-only | 选择入口已通过 grep 枚举(selectSession 55 处调用);归档撤销与会话生命周期由 runtime/git-files 切片拥有 |
| src/features/shortcuts/** | 键盘分发/绑定 | read-only | dispatcher.ts 按 设置浮层/模态层 门控(dispatcher.ts:99-109);无跨步骤状态,读码审计,未发现违反;不做键盘 GUI 自动化 |
| src/lib/nativeShortcuts.ts, escapeClaim.ts, features/settings/SettingsOverlay.tsx, nestedModal.ts | Esc 认领/Cmd+W 层关闭/焦点陷阱 | read-only | 认领协议与嵌套层判断读码一致,未生成模型;实际焦点需主线 GUI 验证 |
| src/features/home/**, guide/** | 起始页/指南 | read-only | 静态展示,无独立生命周期 |
| src/components/** | Modal/FloatingLayer/Toaster/CenterHeader/RightAside/Markdown 等 | read-only | Markdown 文件链接点击缺少 openFileLink 导入(F5,代码缺陷,非状态机);其余组件为受控展示 |
| src/stores/{displayPrefs,language,privacy,explorer,filePreview,locate,turnNav,worktrees,live,composer,sessions}.ts | 全局偏好/导航/显示 store | read-only | sessions.ts 加载状态(loading→error/ready)读码;live/composer 归 runtime/composer 切片 |
| src/lib/** (非功能专属) | ipc/contracts/theme/zoom/format 等 | read-only | 纯函数或 IPC 封装;loadState.ts 三态已读 |
| src-tauri/src/{lib,main,state,db,paths,contracts,ime,local_rows}.rs | Rust 装配/状态/数据库 | read-only | 仅清点,契约:前端 invoke 名称与 list_sessions/list_workspaces 假定;未做 Rust 状态机 |
| docs/**, site/**, .github/workflows/release.yml, scripts/dev.mjs | 文档/站点/构建发布 | out-of-model | 静态页与 CI 工作流,无应用内状态机;不声称验证 |

## 验证
- `statechart.mjs from-spec (x4, see regenerate.sh) with TLA2TOOLS/JAVA` → exit 0: 4 个规则按预期被破坏,4 个修复模型均通过
- `node models/cite-check.mjs models/*/*.tla (lib.mjs uncitedConditions)` → exit 0: 8 个 .tla 全部 uncited=0
- `node_modules/.bin/vitest run --config replay/vitest.config.ts` → exit 1: 8 例: 2 通过(2 个对照)、6 失败(F1×1、F2×1、F3×1、F4×1、F5×2)= 全部为复现断言失败; 日志 replay/replay.log

## 阻塞
- 未做 GUI/焦点实机验证(契约要求主线验证)
- Rust 文件与 docs/site/workflows 仅清点

## 修正说明
- result.json: slice=shell;findings 仅含 4 个模型规则;F5(Markdown openFileLink 缺失导入)移入 implementationFindings,仍保留在本文件发现 5。
- StartupRestore 的"上次会话不在当前空间→回首页"分支 unverified。
- GUI/原生未实测为限制(limits),无 blockers。
