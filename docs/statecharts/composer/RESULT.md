# 输入、计划、暂存队列与侧聊状态审计

## 本次完成了

源代码基线：`7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`。产品源码只读，没有产品修复或提交。
本切片提供七个有限状态模型、中文 Mermaid/PNG、编号反例和真实入口回放。下表数字只取各输出 `summary.json`；红色表示违反该图的读者规则，不自动等于已确认产品故障。

| 模型 | 模型状态/转换 | 图状态/转换 | 边界 |
|---|---:|---:|---|
| [plan-preview](plan-preview/chart/chart.png) | 660/2444 | 33/32 | 单调访问代次和写入代次各最多二次；更长历史不枚举。读写失败显式建模；运行中进程重载角色配置作为 ConfigReloads 边界。 |
| [held-queue](held-queue/chart/chart.png) | 337/1112 | 44/48 | 两条消息、单会话；发送抽象为接受或拒绝，运行时只输入 streaming 边沿；不推断服务端重复投递。 |
| [plan-stop](plan-stop/chart/chart.png) | 49/79 | 14/13 | 依赖用户停止产生 aborted 消息；最多一个提醒和有限停止次数，不模拟真实模型或工具。 |
| [plan-stop-boundary](plan-stop-boundary/chart/chart.png) | 83/138 | 18/19 | 与上一图相同，但假设停止不产生 aborted；只用于上游边界，不是已确认停止故障。 |
| [plan-approve](plan-approve/chart/chart.png) | 18/22 | 9/8 | 新上下文执行批准，创建会话成功/失败；不模拟 shell 导航内部。 |
| [sidechat](sidechat/chart/chart.png) | 20/25 | 14/13 | 一个新侧聊、一次首问和一次回传；未覆盖全体标签、附件、主工作区写权限和真实工具执行。 |
| [fork-plan-state](fork-plan-state/chart/chart.png) | 241/240 | 241/240 | 四个非头部事件，一次完整轮次分支；消息内容和其他 custom 记录省略，forkcut 实际回放补充验证。 |

`--cover` 省略的状态和转换逐项见每个 summary 的 `cover`。所有最终 PNG 均以 image read 打开检查；长总览应配合逐条 bug 图阅读。

## 证据分层

### 点击停止后，本地 held 文本仍被自动发送

- 规则：`StopDoesNotResendHeld`；分类：**reproduced consumer behavior**。
- 路径：运行中输入消息进入 held → 点击停止 → 终止事件使 streaming 归零 → 自动排空并发送 held prompt。
- 回放：replay/composer-replay.test.ts 中真实 abortTurn + QueuedBar 订阅；3/3 测试之一，断言复现行为而非期望修复。
- 源码/证据：`src/features/chat/send.ts:200-229`、`src/features/chat/QueuedBar.tsx:73-87`、`replay/run.log`。
- 修复：未提出产品修复；无 fixed 模型，不声称已修复。

### 批准先退出计划，创建执行会话失败后不能直接在面板重试

- 规则：`FailedApprovalCanRetryAtOnce`；分类：**reproduced consumer behavior**。
- 路径：点击批准并新建上下文执行 → 扩展退出计划模式 → 创建会话失败 → 计划面板不再提供批准按钮。
- 回放：真实 approvePlan 注入 createSession 拒绝验证命令顺序及错误；真实扩展注册命令回放验证 content 存在时批准后 enabled=false。面板按钮消失由源码佐证，未运行原生 UI。
- 源码/证据：`src/features/chat/plan/planActions.ts`、`src/features/chat/PlanPanel.tsx:66-67`、`extension/omp-workspace-plan.ts:434-446`、`replay/plan-extension-replay.mjs`。
- 修复：未提出产品修复；无 fixed 模型，不声称已修复。

### 侧聊首问发送失败仍保留用户回显

- 规则：`EchoMeansMessageSent`；分类：**reproduced consumer behavior**。
- 路径：创建侧聊成功 → 先写入用户回显 → 首次 ask 拒绝 → 回显未撤销。
- 回放：真实 sendFirstMessage，mock 仅 RPC；消费者 pendingUserEchoes 仍含文本；非真实服务端投递证明。
- 源码/证据：`src/features/sidechat/sideChatActions.ts:81-100`、`replay/composer-replay.test.ts`。
- 修复：未提出产品修复；无 fixed 模型，不声称已修复。

### 侧聊首问发送失败后输入文字未回到草稿

- 规则：`FailedFirstMessageKeepsText`；分类：**trace-and-source-only hypothesis**。
- 路径：面板清空草稿 → 创建侧聊成功 → ask 失败仅提示错误。
- 回放：回放验证 action 的失败不抛出及 echo；没有渲染 SideChatPanel 输入框回放，不能当作完整 UI 复现。
- 源码/证据：`src/features/sidechat/SideChatPanel.tsx:457-472`、`src/features/sidechat/sideChatActions.ts:99-100`。
- 修复：未提出产品修复；无 fixed 模型，不声称已修复。

### 侧聊截断副本写失败可能继承父计划模式

- 规则：`SideChatNeverInheritsPlanMode`；分类：**trace-and-source-only hypothesis**。
- 路径：父处于计划模式 → 创建截断副本失败 → 退回原父文件分支。
- 回放：没有通过 Rust side_chat_create 注入磁盘失败；只有 trace 和错误回退源码证据。
- 源码/证据：`src-tauri/src/rpc/sidechat.rs:48-58`、`src-tauri/src/rpc/forkcut.rs:32-41`、`src-tauri/src/rpc/forkcut.rs:92-95`。
- 修复：未提出产品修复；无 fixed 模型，不声称已修复。

### 完整轮次分支丢弃尾部计划开关，恢复成旧计划状态

- 规则：`ForkKeepsParentPlanMode`；分类：**reproduced consumer behavior**。
- 路径：写入计划开启记录 → 助手完成回答 → 写入计划关闭记录 → LastCompleteTurn 截断 → 扩展 session_start 恢复副本。
- 回放：真实 forkcut::truncate 产生副本；真实扩展 session_start 对 parent/fork 分别发布 false/true。fork_session RPC 本身和原生 UI 未运行；这是组件间公开函数/注册回调合同复现。
- 源码/证据：`src-tauri/src/rpc/fork.rs:31-39`、`src-tauri/src/rpc/forkcut.rs:100-118`、`extension/omp-workspace-plan.ts:453-459`、`replay/forkcut-replay/src/main.rs`、`replay/fork-extension-replay.mjs`。
- 修复：未提出产品修复；无 fixed 模型，不声称已修复。

### 停止消息是否标记 aborted 是提醒重启的上游边界

- 规则：`StopDoesNotRestartGeneration`；分类：**design question**。
- 路径：无计划文件时停止 → 若最后消息不是 aborted → agent_end 发送一次提醒触发新轮次。
- 回放：真实扩展 handler：aborted 发送0次，stop/toolUse 各发送1次；没有证据证明上游用户停止会产出非 aborted。
- 源码/证据：`extension/omp-workspace-plan.ts:67-82`、`extension/omp-workspace-plan.ts:516-520`、`replay/plan-extension-replay.mjs`。
- 修复：未提出产品修复；无 fixed 模型，不声称已修复。

### 计划角色读取失败时未发送标签回退显示普通模型

- 规则：`SettledChipShowsSavedRole`；分类：**design question**。
- 路径：选中未发送计划标签 → 角色读取静默失败 → 稳定后仍显示普通模型。
- 回放：未回放失败角色读取的渲染组件。该无条件规则保留来暴露失败时的产品合同；它不是成功读写路径的缺陷，也不是模代次回绕产物。
- 源码/证据：`src/features/chat/Composer.tsx:884-894`、`src/features/chat/plan/planModelChoice.ts:49-50`、`plan-preview/PlanPreview-statechart/stories.md`。
- 修复：未提出产品修复；无 fixed 模型，不声称已修复。

## 成功、失败与建模修正

计划预览初版使用代次取模，可能把已过期的保存伪装成本次保存，产生模型自造残留错误。最终版已经删除取模，代次单调增加，TLC `CONSTRAINT HistoryBound` 只枚举访问/写入代次各不超过二的历史。约束不是产品 guard，也没有复用所有权标识；更长历史未验证。最终 `NoResidueAfterPreview`、普通模型不被预览改动、已开启计划的进程模型规则均通过。初版模回绕反例不是产品疑点，旧图已由生成器整目录替换。

保留无条件“稳定后显示已存计划模型”的原读者规则，因此角色读取明确失败时仍有红色反例：源码 catch 静默返回，没有角色快照，选择器回退普通模型。该失败与成功读取/保存路径分开陈述；没有增添虚构成功 guard 来消除反例。是否应显示错误/未知态属于设计问题，未当作已复现渲染缺陷。

停止模型分成两个配置：`StopMarksAborted=TRUE` 对应 handler 已明确识别的 aborted 合同；FALSE 只是上游假设边界。扩展回放能证明 handler 区分，不证明真实停止一定携带哪个 stopReason。

侧聊不是沙箱权限证明：本模型不包含真实工具调用、文件写入、主工作树隔离机制或 upstream 工作目录语义。回传只覆盖侧会话忙碌检查与摘要生成/提取，主会话如何接收由 runtime/composer 相应入口合同负责。不可据此声称侧聊绝不会改主工作区。

## 回放与重现

- `replay/composer-replay.test.ts` 导入真实发送/action/store 入口，外部 RPC 在 I/O 边界 mock。`replay/run.log` 记录 3/3 通过。这些测试断言**当前错误行为**，是复现证据而不是产品回归修复。
- `replay/forkcut-replay/src/main.rs` 使用 `#[path = ...]` 导入基线真实 `forkcut.rs`（不是复制实现）；本地合成 JSONL，真实 `truncate(LastCompleteTurn)` 输出记录见 `replay/fork-cut-output.jsonl`。`replay/fork-extension-replay.mjs` 将副本/补回尾部关闭记录的父本交给真实扩展 `session_start`。观察值为 `parentPlanEnabledAfterResume:false`、`forkPlanEnabledAfterStart:true`。未执行 Tauri `fork_session` RPC，因此后半集成的 UI/目录元数据不在证据范围。
- `replay/plan-extension-replay.mjs` 使用真实扩展的注册命令/handler，模型与工具仅 mock 外部宿主接口。观察 aborted/stop/toolUse 的提醒次数为 0/1/1；存在计划文件时批准后状态为 enabled=false。脚本现将 TMPDIR 放在自身 scratch 子目录。
- replay 为本机源码定位，含绝对基线路径；如换机器，需更新这些入口路径。模型本身无此依赖，全部可搬迁。

```sh
sh regenerate.sh
# 在基线仓库运行（只执行外部 scratch 测试）
./node_modules/.bin/vitest run --config <scratch>/composer/replay/vitest.config.ts
# 在 replay 目录（离线 Rust 依赖必须已缓存）
CARGO_TARGET_DIR=forkcut-target cargo run --offline -q --manifest-path forkcut-replay/Cargo.toml
bun fork-extension-replay.mjs fork-cut-output.jsonl
bun plan-extension-replay.mjs
node uncited.mjs */*.tla
```

`regenerate.sh` 每条命令精确列出已知 broken symbols；通过模型无 expect 标记。增加其他违反应退出非零。各条最终命令已执行；本地没有声称执行过整份脚本。主整合代理负责最终搬迁后全量再生。七份模型 `uncitedConditions(text)` 结果均为空，保存在 `citation-check.json`。无 full build/lint/formatter/全套测试。

## 覆盖清单

此表是范围账本，不是全程序正确性声明。`modeled` 只表示其指定合同被有限抽象；`read-only` 不表示所有行都读过；未建模不隐含无问题。

| 路径 | 功能 | 状态 | 原因 |
|---|---|---|---|
| `src/features/chat/Composer.tsx` | 输入、待发计划标签、停止、模型预览 | modeled | 预览/派发/停止/held 合同进入模型；附件具体内容不进入状态空间。 |
| `src/features/chat/plan` | 计划角色选择与状态 | modeled | 预览、状态发布、角色读写、取消所有权。 |
| `src/features/chat/HeldQueueBar.tsx` | 逐条即时发送 | modeled | 与批量发送共享忙碌预留，失败恢复。 |
| `src/features/chat/QueuedBar.tsx` | held 自动排空 | modeled | 停止后 streaming 下降沿触发自动发送。 |
| `src/features/chat/heldQueue.ts` | held 队列存取与预留 | modeled | 两消息有界抽象；持久化介质失败不建模。 |
| `src/features/chat/send.ts` | 发送与中止 | modeled | 公开 abortTurn、prompt 边界回放。 |
| `src/features/chat/PlanPanel.tsx` | 计划审批界面 | modeled | 模式退出后审批按钮不可用，创建新会话失败不回滚。 |
| `src/features/sidechat/sideChatActions.ts` | 创建侧聊和首问 | modeled | 创建成功后先回显再发问；失败只提示。 |
| `src/features/sidechat/SideChatPanel.tsx` | 侧聊文本清空/恢复 | modeled | 首问创建失败恢复与发送失败不恢复区分。 |
| `src/features/sidechat/handbackRun.ts` | 回传生成 | modeled | 忙碌/空闲/生成/提取摘要；主会话提交下游不推断。 |
| `src-tauri/src/rpc/sidechat.rs` | 侧聊复制与提问 | modeled | 截断副本失败时退回父文件；外部 ask 边界。 |
| `src-tauri/src/rpc/fork.rs` | 普通分支 | modeled | 仅无 pin 的 LastCompleteTurn 分支合同。 |
| `src-tauri/src/rpc/forkcut.rs` | 记录截断和计划状态 | modeled | 真实 Rust 入口回放；普通分支保留截断前的 custom 状态。 |
| `extension/omp-workspace-plan.ts` | 计划运行时扩展 | modeled | 注册命令、结束提醒、启动恢复与批准退出。 |
| `src/stores/composer.ts` | 草稿和附件存储 | read-only | 读取草稿/持久化/替换入口；payload、撤销和跨窗口存储不进入有限模型。 |
| `src/features/chat/slash` | 斜杠命令解析、执行与状态 | read-only | 阅读执行器合同；计划标签 dispatch 成功/失败进入 preview 模型；其他命令仅输入输出边界。 |
| `src/features/sidechat/handbackLogic.ts` | 摘要提示与内容提取 | read-only | 回传输入输出合同；文本解析纯函数不单独建图。 |
| `src/features/sidechat/viewStore.ts` | 标签视图所有权 | read-only | 阅读创建、绑定、关闭接口；多标签竞争不建模。 |
| `src-tauri/src/rpc/plan_ext.rs` | 扩展安装 | read-only | 部署/安装代码，无用户对话状态转换建模。 |
| `src/features/sidechat/sideChatAttachments.ts` | 侧聊附件生命周期 | out-of-model | 不推断上传与持久化成功；另列构建兼容性注记。 |
| `src/features/sidechat/HandbackDialog.tsx` | 回传编辑对话框 | out-of-model | 模型仅包含摘要 ready/error，不穷举编辑、复制和提交。 |
| `src/features/sidechat/sideChatTitle.ts` | 标题生成 | out-of-model | 输出文案纯转换，无独立状态建模。 |
| `src/features/chat/AddMenuPopover.tsx` | 添加菜单 | out-of-model | 呈现/选项不单独建模。 |
| `src/features/chat/ContextPillBar.tsx` | 上下文选择和草稿 pill | out-of-model | 不是执行/计划状态权威来源；具体选择操作不单独建模。 |
| `src/features/chat/ImageChips.tsx` | 附件展示 | out-of-model | 文件字节、缩略图、token 估算和文件附件处理均作为不透明输入。 |
| `src/features/chat/editDrafts.ts` | 编辑草稿 | out-of-model | 不建模编辑原消息后的所有转换。 |
| `src/features/chat/privacy` | 秘密标记 | out-of-model | privacy-providers 切片所有。 |
| `src/features/chat/subagents` | 子代理显示 | out-of-model | runtime 切片所有。 |
| `src/features/chat/visualize` | 可视化消息 | out-of-model | 呈现与桥接，不属于本切片 submit/plan/held 生命周期。 |
| `src/features/chat/share` | 消息分享 | out-of-model | 不属于本切片 submit/plan/held 生命周期。 |
| `src/features/chat/sketch` | 草图编辑 | out-of-model | 附件 payload 内部状态不进入本模型。 |
| `src/features/chat/find` | 消息查找 | out-of-model | 视图导航归 shell；查找索引不进入本模型。 |
| `src/features/chat/ask` | 追问面板 | out-of-model | 运行时输入请求由 runtime 切片负责；本切片不重复。 |

## 本次未完成

未执行真实原生/浏览器端到端验收，未连接 provider，未证明磁盘故障下的侧聊回退，未证明主工作区隔离，不涵盖附件字节、上传/图像可用性、所有 slash 命令、完整草稿编辑和所有侧聊标签交错。详细边界见 coverage 与 models.limits。没有修复产品，也没有 fixed MODEL，不声称任何候选修复已验证。

构建兼容性单列：`src/features/sidechat/sideChatAttachments.ts:48` 的 `Promise.withResolvers` TS2550 为合同已报告兼容性注记；本切片未重跑类型检查，不与生命周期发现混为一谈。

## 发布文件边界

发布 `result.json`、本报告、`regenerate.sh`、`uncited.mjs`、`citation-check.json`、七个模型目录（包括 generated PNG/Mermaid/stories/summary/tlc/log），以及 replay 源码和日志即可。排除 `replay/node_modules` 软链、`replay/forkcut-target`、Rust target 缓存和临时 runtime 目录；它们不是交付所需依赖。模型依赖仅标准 TLA+ 库，外置 statechart 工具/Java/JAR 由主代理统一配置。
