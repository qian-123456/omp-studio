# 自动化切片状态图审计

基线 7f85613a5ce16cae7ed5e0e3d24b51ecb4454658。from-spec 模型，只读审计，未改仓库。**不是整个程序的验证**，只在有界抽象内检查。

## 模型与计数

| 模型 | 模型状态 | 模型转移 | 图状态 | 图转移 | 正常 | 违规 | 混合 | 之后 |
|---|---|---|---|---|---|---|---|---|
| ScheduleRuns | 927 | 3490 | 19 | 21 | 19 | 15 | 1 | 0 |
| TodoReview | 39 | 136 | 11 | 27 | 11 | 0 | 0 | 0 |
| TodoRequest | 43 | 179 | 12 | 34 | 12 | 0 | 0 | 0 |
| IdeaLifecycle | 192 | 756 | 9 | 9 | 40 | 14 | 1 | 0 |
| InboxVisibility | 54 | 61 | 10 | 7 | 5 | 4 | 0 | 1 |
| DiagnoseDialog | 118 | 206 | 10 | 9 | 14 | 33 | 1 | 0 |
| AiDoctor | 37 | 40 | 37 | 40 | 7 | 30 | 0 | 0 |

图与故事在 out/<名>/（chart.png、bug-N.png、stories.md、summary.json）。TodoReview、TodoRequest 的全部不变量成立。

## 模型边界

- ScheduleRuns：次数以饱和值3截断；once 不建模 end_at；用两个令牌（定时器、手动）表示并发，未验证真实线程交错；上游 OMP 运行状态是外部输入；--cover 绘图
- TodoReview：仅待办的处理动作；会话状态由 runtime 切片拥有
- TodoRequest：仅审批/提问待办的检测与解决；不模拟上游 OMP 协议
- IdeaLifecycle：时间用布尔“超过30天/7天”抽象；图片、快捷键、真实 IPC 失败未建模
- InboxVisibility：通知策略与收件箱条目；系统通知（原生）未触发；会话关注度来自 runtime
- DiagnoseDialog：React effect 重跑以会话列表刷新抽象；未在浏览器渲染
- AiDoctor：两个会话 A/B，空闲模式；不含定时模式
- 上游 OMP 运行状态属 runtime 切片；手机端 HTTP/SSE 属 mobile；原生通知、快捷键、浏览器渲染均未执行。

## 发现

### CompletedNeverScheduled（ScheduleRuns）— reproduced consumer behavior
已完成的一次性任务被改期后列表仍显示已完成，但调度器会再次触发
- 步骤：手动运行一次性任务→完成→保存新的未来时间
- 复现：replay-rs/tests/replay.rs::repro_rescheduled_once_listed_completed_but_will_fire（真实 schedules/store.rs 的 upsert/list/find_due，内存库）；该测试断言缺陷存在，通过=复现成功，不是验收失败
- 证据：store.rs:216-236,459-499；ScheduleRow.tsx:254；out/schedule-runs/bug-*.png
- 修复建模：未建模修复

### RunsWithinCap（ScheduleRuns）— design question
手动运行可使已运行次数超过 max_runs
- 步骤：设次数上限2，手动运行3次
- 复现：replay-rs/tests/replay.rs::observe_manual_runs_exceed_max_runs 观察到 runs_done=3>max_runs=2；产品语义未明：手动强制运行可能有意绕过自动节奏上限，故不判为缺陷
- 证据：runner.rs:74-85；store.rs:663-675
- 修复建模：未建模修复

### ActiveRunsAtMostOne（ScheduleRuns）— trace-and-source-only hypothesis
定时器与手动运行在检查与创建之间可并发产生两个运行
- 步骤：定时器检查无活动运行→手动检查→两边创建
- 复现：未通过公开入口证明真实并发；仅有模型轨迹与源码（has_active_run 与 create_run 之间释放锁）
- 证据：runner.rs:43-131；store.rs:787
- 修复建模：未建模修复

### NoRunAfterDelete（ScheduleRuns）— trace-and-source-only hypothesis
任务被删除后已认领的运行仍写入
- 步骤：认领后删除任务
- 复现：未回放；FK 级联可能使写入被忽略，影响未验证
- 证据：runner.rs:120-148；db.rs:615-623
- 修复建模：未建模修复

### DeliveredIsRecorded（IdeaLifecycle）— trace-and-source-only hypothesis
放入输入框发送成功但记录已派发失败时被静默吞掉，想法仍显示待处理
- 步骤：放入输入框并发送→状态写入失败
- 复现：未回放（需 IPC 失败注入）；源码显示失败被吞
- 证据：fillComposer.ts:74-79；DispatchDialog.tsx:66,92-93
- 修复建模：未建模修复

### RestoredStaysRestored（IdeaLifecycle）— reproduced consumer behavior
已结束想法从回收站恢复后，下次启动又被自动移回回收站
- 步骤：完成想法，40天前修改→删除→恢复→启动清理
- 复现：replay-rs/tests/replay.rs::repro_restored_finished_idea_is_trashed_again_on_next_start（真实 backlog/store.rs delete/restore/archive_finished）；断言缺陷存在
- 证据：backlog/store.rs:210-229；backlog/mod.rs:24
- 修复建模：未建模修复

### NoneMeansNothingInInbox（InboxVisibility）— design question
通知策略“不放入收件箱”仍有会话条目
- 步骤：策略 none，运行中等待审批
- 复现：仅模型与源码；策略可能只管结果待办，产品语义未明
- 证据：schedules/runner.rs；catalog/status.rs:293-319；inbox/attention.ts
- 修复建模：未建模修复

### ImportantOnlyWhenNeeded（InboxVisibility）— design question
“仅重要时提醒”下顺利完成的运行仍有会话条目
- 步骤：同上
- 复现：同上
- 证据：同上
- 修复建模：未建模修复

### OneEntryPerRun（InboxVisibility）— design question
同一运行同时出现会话条目与结果待办
- 步骤：策略 all，运行失败
- 复现：同上
- 证据：同上
- 修复建模：未建模修复

### UserWorkPreserved（DiagnoseDialog）— trace-and-source-only hypothesis
会话列表刷新重置诊断对话框里用户已改的提示词与选择
- 步骤：打开对话框→修改→后台列表刷新
- 复现：unverified：未渲染组件；源码 effect 依赖 sessions（DiagnoseDialog.tsx:68-83）
- 证据：DiagnoseDialog.tsx:59,68-83
- 修复建模：未建模修复

### SentAtMostOnce（DiagnoseDialog）— trace-and-source-only hypothesis
刷新把发送中状态清零，可重复发送诊断
- 步骤：点击发送→列表刷新→再次点击
- 复现：unverified：未渲染组件
- 证据：DiagnoseDialog.tsx:73,384-388
- 修复建模：未建模修复

### FailedNotRetried（AiDoctor）— reproduced consumer behavior
自动诊断失败的会话每分钟被重试
- 步骤：空闲模式下会话A诊断失败
- 复现：replay-ts/aiDoctor.test.ts 驱动真实 useDoctorAutoScheduler（假定时器5分钟内尝试A共6次）；断言缺陷存在
- 证据：doctorStore.ts:139,192,210-219
- 修复建模：未建模修复

### NoStarvation（AiDoctor）— reproduced consumer behavior
失败较新会话的重复重试可持续阻挡较旧会话（有界观察与条件性推论）
- 步骤：空闲模式，较新A持续失败；另有较旧B；没有新活动或用户干预
- 复现：实测仅限5分钟：6次尝试均为A，B在观察窗口内未出现。不是无穷饥饿证明。源码排序和失败不写 diagnosedAt 支持条件性推论：若A持续失败、配置及候选顺序不变，后续tick仍优先A。TLA以2会话、tries饱和到3抽象检查状态不变量，未添加公平性或检查时序活性属性。
- 证据：doctorStore.ts:185-199,218-219
- 修复建模：未建模修复

## 其他实现缺陷

- prompts::render 对用户文本中的模板记号再次展开，结果依赖变量遍历顺序，非确定：replay-rs/tests/replay.rs::repro_render_reexpands_tokens_inside_user_text_nondeterministically：同一输入 300 次出现已展开与未展开两种结果（断言两者都出现）

回放测试是故意断言“缺陷存在”的复现证据，通过不代表产品正确。

## 覆盖表

| 路径 | 功能 | 状态 | 原因 |
|---|---|---|---|
| src-tauri/src/schedules/scheduler.rs | 定时任务调度：启动补跑、到点查询 | modeled | ScheduleRuns 模型 |
| src-tauri/src/schedules/runner.rs | 定时任务运行：手动运行、认领、结束、失败 | modeled | ScheduleRuns、InboxVisibility 模型 |
| src-tauri/src/schedules/store.rs | 定时任务存储：生命周期、次数、删除 | modeled | ScheduleRuns 模型 |
| src-tauri/src/schedules/commands.rs | 定时任务 IPC 入口 | read-only | 只读追踪入口；无独立状态 |
| src-tauri/src/schedules/mod.rs | 定时任务模块入口 | read-only | 只读；无状态 |
| src-tauri/src/schedules/tests.rs | 既有测试夹具 | read-only | 仅作回放夹具参考 |
| src-tauri/src/todos/mod.rs | 待办处理动作 done/ignore/reopen | modeled | TodoReview 模型 |
| src-tauri/src/todos/store.rs | 待办存储 | modeled | TodoReview、TodoRequest 模型；既有单测 |
| src-tauri/src/todos/detect.rs | 待办检测：审批与提问 | modeled | TodoRequest 模型 |
| src-tauri/src/todos/summary.rs | 待办摘要生成 | read-only | 只读阅读；去重逻辑未建模 |
| src-tauri/src/todos/omp.rs | 待办调用 OMP | out-of-model | 上游 OMP 语义属外部边界 |
| src-tauri/src/todos/sessions.rs | 待办关联会话 | read-only | 只读阅读 |
| src-tauri/src/todos/diagnose.rs | 待办诊断 | read-only | 只读阅读 |
| src-tauri/src/todos/commands.rs | 待办 IPC 入口 | read-only | 只读阅读 |
| src-tauri/src/todos/transcript.rs | 待办读取会话记录 | read-only | 未阅读细节；无独立生命周期 |
| src-tauri/src/backlog/store.rs | 想法存储、归档、回收、清除 | modeled | IdeaLifecycle 模型 |
| src-tauri/src/backlog/mod.rs | 想法启动清理 | modeled | IdeaLifecycle 模型 |
| src-tauri/src/backlog/commands.rs | 想法 IPC 入口 | read-only | 只读阅读 |
| src-tauri/src/backlog/shortcut.rs | 想法全局快捷键 | read-only | 原生快捷键行为未执行，属模型限制 |
| src-tauri/src/backlog/prompt.rs | 想法派发提示词 | read-only | 仅阅读；模板渲染问题见 implementationFindings |
| src-tauri/src/backlog/images.rs | 想法图片 | read-only | 只读阅读 |
| src-tauri/src/notify/mod.rs | 系统通知可见性 | read-only | 原生通知未触发；可见性规则仅阅读 |
| src-tauri/src/notify/commands.rs | 通知 IPC 入口 | read-only | 只读阅读 |
| src-tauri/src/prompts.rs | 提示词模板渲染 | read-only | 由回放测试覆盖一个实现缺陷，未建状态图 |
| src/features/schedules/schedulesStore.ts | 定时任务前端状态 | read-only | 只读阅读 |
| src/features/schedules/ScheduleRow.tsx | 定时任务行 | modeled | ScheduleRuns 引用其开关与运行按钮保护 |
| src/features/schedules/scheduleUtils.ts | 生命周期展示 | modeled | ScheduleRuns 引用 lifecycleOf |
| src/features/schedules/SchedulesPage.tsx | 定时任务页 | read-only | 只读阅读 |
| src/features/schedules/ScheduleEditorPage.tsx | 定时任务编辑页 | read-only | 未深入阅读 |
| src/features/schedules/humanCadence.ts | 节奏文案 | read-only | 纯函数，无状态 |
| src/features/schedules/promptImages.ts | 提示词图片 | read-only | 未阅读 |
| src/features/todos/store.ts | 待办前端状态 | modeled | TodoReview 模型 |
| src/features/backlog/backlogStore.ts | 想法前端状态 | modeled | IdeaLifecycle 模型 |
| src/features/backlog/DispatchDialog.tsx | 想法派发对话框 | modeled | IdeaLifecycle 模型 |
| src/features/backlog/fillComposer.ts | 想法放入输入框 | modeled | IdeaLifecycle 模型 |
| src/features/backlog/ideasActions.ts | 想法动作 | modeled | IdeaLifecycle 模型 |
| src/features/backlog/ideasLogic.ts | 想法阶段推导 | modeled | IdeaLifecycle 模型 |
| src/features/backlog/IdeasPanel.tsx | 想法面板 | read-only | 仅展示 |
| src/features/inbox/attention.ts | 收件箱分组与关注度 | modeled | InboxVisibility 模型 |
| src/features/inbox/useInboxBadge.ts | 收件箱角标 | modeled | InboxVisibility 模型 |
| src/features/inbox/InboxPage.tsx | 收件箱页面 | read-only | 仅展示 |
| src/features/diagnose/DiagnoseDialog.tsx | 诊断对话框 | modeled | DiagnoseDialog 模型 |
| src/features/heatmap/doctorStore.ts | AI 医生状态与自动调度 | modeled | AiDoctor 模型 |
| src/features/heatmap/doctor.ts | 诊断提示词与解析 | read-only | 纯函数 |
| src/features/heatmap/distribution.ts | 分布与骨架提取 | read-only | 纯函数 |
| src/features/heatmap/HeatmapPanel.tsx | 热力图面板 | read-only | 仅展示；原生渲染未执行 |
| src/features/heatmap/DoctorView.tsx | 医生视图 | read-only | 仅展示 |
| src/features/heatmap/SystemicIssuesCard.tsx | 系统性问题卡片 | read-only | 仅展示 |

## 命令

- `cd replay-rs && cargo test --offline` → 0：10 单元测试 + 4 回放测试通过（回放测试断言缺陷存在，属复现证据）
- `vitest run --config replay-ts/vitest.config.ts（在仓库根）` → 0：1 通过；5分钟观察内失败会话A重试6次，B未被选中；未证明无穷饥饿
- `uncitedConditions(*.tla)` → 0：7 个模型均为空数组（IdeaLifecycle 已补充两处引用后复查为空）
- `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec ScheduleRuns.tla --cover --png --out ../out/schedule-runs --expect-broken ActiveRunsAtMostOne,CompletedNeverScheduled,RunsWithinCap,NoRunAfterDelete` → 0：927 模型状态，19 图状态：正常19，违规15，混合1，之后0
- `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec TodoReview.tla --png --out ../out/todo-review` → 0：39 模型状态，11 图状态：正常11，违规0，混合0，之后0
- `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec TodoRequest.tla --png --out ../out/todo-request` → 0：43 模型状态，12 图状态：正常12，违规0，混合0，之后0
- `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec IdeaLifecycle.tla --cover --png --out ../out/idea-lifecycle --expect-broken DeliveredIsRecorded,RestoredStaysRestored` → 0：192 模型状态，9 图状态：正常40，违规14，混合1，之后0
- `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec InboxVisibility.tla --cover --png --out ../out/inbox-visibility --expect-broken NoneMeansNothingInInbox,ImportantOnlyWhenNeeded,OneEntryPerRun` → 0：54 模型状态，10 图状态：正常5，违规4，混合0，之后1
- `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec DiagnoseDialog.tla --cover --png --out ../out/diagnose-dialog --expect-broken UserWorkPreserved,SentAtMostOnce` → 0：118 模型状态，10 图状态：正常14，违规33，混合1，之后0
- `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec AiDoctor.tla --png --out ../out/ai-doctor --expect-broken FailedNotRetried,NoStarvation` → 0：37 模型状态，37 图状态：正常7，违规30，混合0，之后0
- `functions.read each generated PNG` → 0：已打开并审阅全部20张PNG：中文状态及动作标签、bug路径从1开始连续编号。TodoReview/TodoRequest标签去除检测开关和对账瞬态后降为11/12图状态；IdeaLifecycle、DiagnoseDialog、InboxVisibility改用cover。完整状态/边省略清单在summary.json和stories.md；总览不是完整可达图。大图需原图缩放。图例为工具固定英文。
- `node <scratch>/publication/publish.mjs check <scratch> --repo <repo> --skill <HOME>/.agents/skills/statechart --slices automation` → 0：0 failure(s), 0 waived, 0 warning(s); 7 model(s) planned

## 再生成入口

见 result.json 中每个模型的 regenerate 字段（English entrypoint: node statechart.mjs from-spec <Model>.tla --png --out ../out/<name>）。

阻塞：无。

## PNG 实际审阅记录

以下20张均已通过 read 打开。中文状态、动作标签可读，bug步骤连续编号；图例仍为生成工具固定英文。TodoReview/TodoRequest仅合并展示检测开关和对账瞬态，未改变TLA模型；完整39/43状态仍被检查。IdeaLifecycle/DiagnoseDialog/InboxVisibility使用cover减少拥挤，省略清单保留在summary.json/stories.md。ScheduleRuns、AiDoctor总览须原图缩放。

- out/ai-doctor/bug-1.png
- out/ai-doctor/bug-2.png
- out/ai-doctor/chart.png
- out/diagnose-dialog/bug-1.png
- out/diagnose-dialog/bug-2.png
- out/diagnose-dialog/chart.png
- out/idea-lifecycle/bug-1.png
- out/idea-lifecycle/bug-2.png
- out/idea-lifecycle/chart.png
- out/inbox-visibility/bug-1.png
- out/inbox-visibility/bug-2.png
- out/inbox-visibility/bug-3.png
- out/inbox-visibility/chart.png
- out/schedule-runs/bug-1.png
- out/schedule-runs/bug-2.png
- out/schedule-runs/bug-3.png
- out/schedule-runs/bug-4.png
- out/schedule-runs/chart.png
- out/todo-request/chart.png
- out/todo-review/chart.png
