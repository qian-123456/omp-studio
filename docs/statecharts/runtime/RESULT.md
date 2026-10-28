# 会话运行、流式状态与占用审计

基线：`7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`。产品源码只读；未修复产品。

## 模型与图

- `model/RuntimeStatus.tla` / `out/chart.png` / `out/chart.mmd`：一个会话、一次进程启动、最多四次用户或子进程动作、最多两条未读标准输出帧。建模真实 status::apply/derive、前端 reduceFrame/reduceProcess、监视器与读取循环交错。简化原生广播发送与前端事件为同一次送达，省略动画帧调度。
- `model-b/Ownership.tla` / `out-b/chart.png` / `out-b/chart.mmd`：状态文件、外部进程、进程号复用、空闲回收/挂起标记及目录缓存。
- 所有图和逐条反例 PNG 已打开检查，中文标签，编号路径按顺序可读。概览为索引；详细反例图是主要阅读入口。
- 原始 `stories.md`、`summary.json`、TLC 日志/图在各 out 目录保留。运行模型使用 --cover，省略列表保留于 summary.json。计数仅引用这些文件（见 result.json.models[].summary）。

## 结论与证据边界

- **NoGhostLive**：退出事件早于注册表清理/遗留帧时，缓存仍记存活。证据等级 `trace-and-source-only hypothesis`。路径：out/stories.md #1，步骤1–6。真实 apply/derive 重放验证退出后 agent_start 可重置 Working；最短注册表清理路径未在 Tauri/native 总线调度器复现。 代码：process.rs:985-1004；catalog/mod.rs:497；status.rs:87-91,159-165；replay-rs/tests/replay.rs。
- **NoGhostStreaming**：退出后迟到的开始帧重新开启转圈。证据等级 `reproduced consumer behavior`。路径：out/stories.md #2，步骤1–8。useLive.reduceProcess(false) 后 reduceFrame(agent_start)：alive=false、streaming=true。只确认真实消费者对给定顺序的行为；未证明真实 OS 调度触发概率。 代码：src/stores/live.ts:746-753,1525-1546；process.rs:942-982,985-1007；replay-js/live.replay.ts。
- **AwaitingNeedsProcess**：退出后迟到的请求帧留下可回答卡片与等待状态。证据等级 `trace-and-source-only hypothesis`。路径：out/stories.md #3，步骤1–11。真实消费者具备无活进程守卫的 append 行为；此请求帧变体未单独驱动原生读循环。与迟到开始帧共享生命周期缺口。 代码：status.rs:102-116；live.ts:1005-1031；process.rs:942-1007。
- **CardsMatchStatus**：回合终止后待答卡片仍保留。证据等级 `reproduced consumer behavior`。路径：out/stories.md #4，步骤1–11。真实 useLive.reduceFrame(confirm)->agent_end 后 pendingUi.length=1 且 streaming=false。真实 status::apply/derive 同顺序进入 Review。外部 omp 是否总会先撤销卡片，未假定。 代码：live.ts:930-962；status.rs:127-137；process.rs:297-304；replay-js/live.replay.ts；replay-rs/tests/replay.rs。
- **IdleNotWorking**：回答已结束回合的遗留卡片会把空闲状态改回处理中。证据等级 `reproduced consumer behavior`。路径：out/stories.md #5，步骤1–13。真实 status::apply/derive：confirm -> agent_end -> UiResponded，Review 变 Working，无 agent_start。未执行真实原生 stdin 写入。 代码：rpc/mod.rs:534-562；status.rs:140-145；replay-rs/tests/replay.rs。
- **ExternalIsRealOmp**：状态文件的进程号被复用后会话被误判外部占用。证据等级 `reproduced consumer behavior`。路径：out-b/stories.md #1，步骤1–4。真实 external_map + pid_alive，以当前测试进程作为状态文件中的复用 pid：返回 external holder。未实际强杀 omp 或逼迫 OS 复用 PID。 代码：catalog/external.rs:99-131；rpc/mod.rs:400-418,630-660；replay-rs/tests/replay.rs。
- **SuspendShown**：挂起标记晚于退出重算写入时显示可能停在空闲。证据等级 `trace-and-source-only hypothesis`。路径：out-b/stories.md #2，步骤1–4。未重放 native 竞争窗口：需要受控 Tauri AppState、原生进程退出/总线调度与 DB 写入屏障；源代码只读无法注入屏障。普通路径可能由文件监听刷新修正，模型未包含防抖时间保证。 代码：rpc/mod.rs:189-228,277,688-694；catalog/tasks.rs:318-331；process.rs:994。

附加真实消费者重放（无独立模型）：
- 切换到无文件会话时沿用旧会话文件：真实扩展默认注册入口：session_start(old,/sessions/old.jsonl) -> session_switch(new,undefined)，new.json.sessionFile 等于旧文件。 extension/omp-workspace-status.ts:79-87；replay-js/ext.replay.ts。边界：未建独立 TLA 模型；不假定上游无文件 session_switch 的可达性。
- 迟到的子代理进度可以倒退终态：真实 useLive.reduceFrame：completed 生命周期后 running 进度把状态改回 running。 src/stores/live.ts:1171-1243；replay-js/live.replay.ts。边界：未建独立 TLA 模型；未假定上游保证或不保证帧顺序。

## 覆盖边界

本切片**不是整个程序或全部模块的形式化验证**。每个纳入目录的文件及状态见 `result.json.coverage`：modeled 仅代表该文件的执行/状态契约进入模型；read-only 是公开边界/关键守卫阅读；out-of-model 包含未独立审读的展示/格式化/测试模块，不能视为被验证。

- 目录扫描/标题/分页/用量/搜索索引/元数据存储，以及会话列表装载与更新合并，只读契约追踪，无完整时序穷举。
- 自动标题等待终止 agent_end、untitled 检测和单次尝试标记，只读；不调用提供商。
- RPC 分帧、握手、请求超时、命令响应 drain/fail_all、子代理文件热度推断和磁盘轮询不是独立模型。
- 聊天流式消息、工具/请求 live 行、重试归档、转录与乐观回显合并、批准选择和问答展示，除模型明确状态外，其细粒度行为不在穷举范围；原生 Webview/React 实际渲染验收未执行。
- 上游协议的非终止续跑、后台空闲、abort 输出均只采用当前代码守卫，不推断未见源代码的上游保证。模型允许“未先撤销对话框就结束”的输入；重放验证的是消费者如何处理，不证明上游必然发出该顺序。
- 接受/已读及 attention 优先级来源 status.rs:289-319、commands.rs:60-80,177-190，作为边界，不声称独立验证。
- Sidechat/fork/forkcut/plan/privacy 安装器由其他切片负责。没有改动它们。

## 未匹配条件

集成复核移除了旧代残留帧为空、请求去重、挂起写入期间禁止打开等无源码守卫；进程退出与进程号复用明确作为环境输入。目录刷新只建模非本应用存活分支，不声称它是实际定时器的全局守卫。当前两个模型均通过条件来源检查；有限动作/队列、单次启动及环境输入仍是证明边界。

未建立 proposed-fix 模型，未改产品代码；所有规则破坏均是审计发现或带边界的假说，不是修复完成。

## 重放与再生成

最终发布的统一再生成入口会复制模型到外部临时目录，并用精确的已知破坏规则集合验收。不能用通用“预期 exit 1”放过模型错误。
Rust scratch crate直接以 #[path] 编入真实源文件，无复制实现；step helper仅按真实公开 apply/derive 接口折叠，未调用原生 Tauri run_bus_loop。JS重放导入真实 useLive reducer/扩展默认注册入口。测试以缺陷仍存在为成功断言。

- 修正后的运行状态模型实跑 exit 0：35486 模型状态、57图状态、61图边；精确预期5条规则破坏。所有计数取自最终 summary.json。
- 修正后的占用模型实跑 exit 0：124 模型状态、32图状态、97图边；精确预期2条规则破坏。
- `CARGO_TARGET_DIR=.../target cargo test --offline --test replay` → exit 0：3 passed; 0 failed；直接 path 导入真实 contracts/parse/status/external 源码。最初缺依赖的编译尝试已通过 scratch manifest 修正。
- `./node_modules/.bin/vitest run --config <scratch>/runtime/replay-js/vitest.config.ts` → exit 0：2 test files / 4 tests passed；断言当前缺陷行为，不是产品契约通过。
- 条件来源检查：当前两个模型均无未引用条件。

再生成入口的精确预期集合：运行状态为 NoGhostLive,NoGhostStreaming,CardsMatchStatus,IdleNotWorking,AwaitingNeedsProcess；占用为 ExternalIsRealOmp,SuspendShown。修正后的模型已重新执行，未修改任何读者规则；TypeOK 失败永不视为产品缺陷或预期失败。
