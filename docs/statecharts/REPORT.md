# omp-workspace statechart audit: report

Proposed fixed variants are MODEL-ONLY: they are checked in TLC to show what a change would do. Product code was not changed or repaired, and a green "fixed" state does not mean a fix has shipped. Findings are classified as reproduced consumer behavior (replayed against real entry points), trace-and-source-only hypotheses (a model trace plus code reading, not replayed), or design questions; the Kind column says which, and "unclassified" means the slice did not say.

Baseline commit: `7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`. Models are bounded TLC abstractions of the listed source files; see each model's Limits and each slice's coverage table. This is not a whole-program verification. Chart labels are Simplified Chinese by design.

## runtime: 会话运行、流式状态与占用审计

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| extension/omp-workspace-status.ts | omp-workspace-status.ts | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/catalog/commands.rs | commands.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/catalog/external.rs | external.rs | modeled | 有限模型覆盖状态/事件契约；不覆盖该文件全部分支。 |
| src-tauri/src/catalog/mod.rs | mod.rs | modeled | 有限模型覆盖状态/事件契约；不覆盖该文件全部分支。 |
| src-tauri/src/catalog/parse.rs | parse.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/catalog/scan.rs | scan.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/catalog/search.rs | search.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/catalog/status.rs | status.rs | modeled | 有限模型覆盖状态/事件契约；不覆盖该文件全部分支。 |
| src-tauri/src/catalog/store.rs | store.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/catalog/tasks.rs | tasks.rs | modeled | 有限模型覆盖状态/事件契约；不覆盖该文件全部分支。 |
| src-tauri/src/catalog/transcript.rs | transcript.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/catalog/usage.rs | usage.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/rpc/autotitle.rs | autotitle.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/rpc/commands.rs | commands.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/rpc/frame.rs | frame.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src-tauri/src/rpc/live_test.rs | live_test.rs | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src-tauri/src/rpc/mod.rs | mod.rs | modeled | 有限模型覆盖状态/事件契约；不覆盖该文件全部分支。 |
| src-tauri/src/rpc/process.rs | process.rs | modeled | 有限模型覆盖状态/事件契约；不覆盖该文件全部分支。 |
| src-tauri/src/rpc/subagents.rs | subagents.rs | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/features/chat/ActivityHeader.tsx | ActivityHeader.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/MessageList.tsx | MessageList.tsx | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/features/chat/PendingUiCard.tsx | PendingUiCard.tsx | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/features/chat/RequestStatsLine.tsx | RequestStatsLine.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/RetryNoticeList.test.tsx | RetryNoticeList.test.tsx | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/RetryNoticeList.tsx | RetryNoticeList.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/SessionView.tsx | SessionView.tsx | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/features/chat/ThinkingPreview.test.tsx | ThinkingPreview.test.tsx | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/ThinkingPreview.tsx | ThinkingPreview.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/ToolCard.test.tsx | ToolCard.test.tsx | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/ToolCard.tsx | ToolCard.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/approvalOptions.test.ts | approvalOptions.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/approvalOptions.ts | approvalOptions.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/ask/AskPanel.test.tsx | AskPanel.test.tsx | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/ask/AskPanel.tsx | AskPanel.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/ask/askDriver.test.ts | askDriver.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/ask/askDriver.ts | askDriver.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/flowNotice.test.ts | flowNotice.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/flowNotice.ts | flowNotice.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/historyRows.test.ts | historyRows.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/historyRows.ts | historyRows.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/localRows.test.ts | localRows.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/localRows.ts | localRows.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/messageTrace.test.ts | messageTrace.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/messageTrace.ts | messageTrace.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/streamingMarkdown.test.ts | streamingMarkdown.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/streamingMarkdown.ts | streamingMarkdown.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/subagents/SubagentHoverCard.tsx | SubagentHoverCard.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/subagents/SubagentSheet.test.tsx | SubagentSheet.test.tsx | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/subagents/SubagentSheet.tsx | SubagentSheet.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/subagents/TaskToolBlock.tsx | TaskToolBlock.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/subagents/TopCapsule.nested.test.tsx | TopCapsule.nested.test.tsx | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/subagents/TopCapsule.tsx | TopCapsule.tsx | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/subagents/counts.test.ts | counts.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/subagents/counts.ts | counts.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/subagents/diskPoller.test.ts | diskPoller.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/subagents/diskPoller.ts | diskPoller.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/subagents/merge.test.ts | merge.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/subagents/merge.ts | merge.ts | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/features/chat/subagents/subagentTree.test.ts | subagentTree.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/subagents/subagentTree.ts | subagentTree.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/features/chat/subagents/types.ts | types.ts | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/features/chat/subagents/useSessionSubagents.test.ts | useSessionSubagents.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/features/chat/subagents/useSessionSubagents.ts | useSessionSubagents.ts | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/features/chat/toolCardState.ts | toolCardState.ts | out-of-model | 展示/解析/合并的细粒度行为仅作为运行契约的边界列出；未单独穷举或完整审读。 |
| src/stores/frameBatch.test.ts | frameBatch.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/stores/frameBatch.ts | frameBatch.ts | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/stores/live.test.ts | live.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/stores/live.ts | live.ts | modeled | 有限模型覆盖状态/事件契约；不覆盖该文件全部分支。 |
| src/stores/retryNotice.test.ts | retryNotice.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/stores/retryNotice.ts | retryNotice.ts | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |
| src/stores/sessions.test.ts | sessions.test.ts | out-of-model | 已有回归测试未运行；非本次完整套件范围。 |
| src/stores/sessions.ts | sessions.ts | read-only | 读取公开边界及关键守卫；无独立穷举模型，不声称验证全部实现。 |

### Model RuntimeStatus

- Source: [RuntimeStatus.tla](runtime/RuntimeStatus/model/RuntimeStatus.tla), config [RuntimeStatus.cfg](runtime/RuntimeStatus/model/RuntimeStatus.cfg), map [RuntimeStatus.map.mjs](runtime/RuntimeStatus/model/RuntimeStatus.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](runtime/RuntimeStatus/chart/chart.mmd) / [chart.png](runtime/RuntimeStatus/chart/chart.png)
- Bug charts: [bug-1.mmd](runtime/RuntimeStatus/chart/bug-1.mmd) / [png](runtime/RuntimeStatus/chart/bug-1.png), [bug-2.mmd](runtime/RuntimeStatus/chart/bug-2.mmd) / [png](runtime/RuntimeStatus/chart/bug-2.png), [bug-3.mmd](runtime/RuntimeStatus/chart/bug-3.mmd) / [png](runtime/RuntimeStatus/chart/bug-3.png), [bug-4.mmd](runtime/RuntimeStatus/chart/bug-4.mmd) / [png](runtime/RuntimeStatus/chart/bug-4.png), [bug-5.mmd](runtime/RuntimeStatus/chart/bug-5.mmd) / [png](runtime/RuntimeStatus/chart/bug-5.png)
- Stories: [stories.md](runtime/RuntimeStatus/chart/stories.md); counts: [summary.json](runtime/RuntimeStatus/chart/summary.json)
- TLC logs: [RuntimeStatus-AwaitingNeedsProcess.out.gz](runtime/RuntimeStatus/chart/tlc/RuntimeStatus-AwaitingNeedsProcess.out.gz), [RuntimeStatus-CardsMatchStatus.out](runtime/RuntimeStatus/chart/tlc/RuntimeStatus-CardsMatchStatus.out), [RuntimeStatus-IdleNotWorking.out](runtime/RuntimeStatus/chart/tlc/RuntimeStatus-IdleNotWorking.out), [RuntimeStatus-NoGhostLive.out.gz](runtime/RuntimeStatus/chart/tlc/RuntimeStatus-NoGhostLive.out.gz), [RuntimeStatus-NoGhostStreaming.out.gz](runtime/RuntimeStatus/chart/tlc/RuntimeStatus-NoGhostStreaming.out.gz), [RuntimeStatus-RunningShowsBusy.out](runtime/RuntimeStatus/chart/tlc/RuntimeStatus-RunningShowsBusy.out), [RuntimeStatus-SpinnerMatchesTurn.out](runtime/RuntimeStatus/chart/tlc/RuntimeStatus-SpinnerMatchesTurn.out), [RuntimeStatus-TypeOK.out](runtime/RuntimeStatus/chart/tlc/RuntimeStatus-TypeOK.out), [RuntimeStatus.out](runtime/RuntimeStatus/chart/tlc/RuntimeStatus.out)
- From summary.json: 35486 model states, 77225 transitions, 57 chart states, 61 chart transitions, 5 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 单会话、有限请求 id；不模拟上游调度保证、工具执行副作用或网络。; 运行模型仅1次启动、4次用户/子进程动作、stdout最多2帧；不是全程序证明。; 占用模型对 PID 复用使用操作系统事实抽象；挂起模型省略文件监听防抖刷新。; 所有权模型仅取目录状态推导的非本应用存活分支；不验证本应用与外部持有者并存的冲突处理。暂停标记写入期间允许重新打开。; 接管动作只表示读取缓存外部进程号并终止的子步骤，恢复用单独打开动作抽象；不把操作系统事件写成产品守卫。; 运行模型定义中的用户接受、文件监听、外部占用、空闲回收动作不在 Next；其独立部分由 Ownership 覆盖，接受/已读细节只读。; 发现竞争路径未等同原生实时重现。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| NoGhostLive | 退出事件早于注册表清理/遗留帧时，缓存仍记存活 | trace-and-source-only hypothesis | out/stories.md #1，步骤1–6 | 真实 apply/derive 重放验证退出后 agent_start 可重置 Working；最短注册表清理路径未在 Tauri/native 总线调度器复现。 | process.rs:985-1004；catalog/mod.rs:497；status.rs:87-91,159-165；replay-rs/tests/replay.rs | 未建立修复模型；产品代码未修改 |
| NoGhostStreaming | 退出后迟到的开始帧重新开启转圈 | reproduced consumer behavior | out/stories.md #2，步骤1–8 | useLive.reduceProcess(false) 后 reduceFrame(agent_start)：alive=false、streaming=true。只确认真实消费者对给定顺序的行为；未证明真实 OS 调度触发概率。 | src/stores/live.ts:746-753,1525-1546；process.rs:942-982,985-1007；replay-js/live.replay.ts | 未建立修复模型；产品代码未修改 |
| AwaitingNeedsProcess | 退出后迟到的请求帧留下可回答卡片与等待状态 | trace-and-source-only hypothesis | out/stories.md #3，步骤1–11 | 真实消费者具备无活进程守卫的 append 行为；此请求帧变体未单独驱动原生读循环。与迟到开始帧共享生命周期缺口。 | status.rs:102-116；live.ts:1005-1031；process.rs:942-1007 | 未建立修复模型；产品代码未修改 |
| CardsMatchStatus | 回合终止后待答卡片仍保留 | reproduced consumer behavior | out/stories.md #4，步骤1–11 | 真实 useLive.reduceFrame(confirm)->agent_end 后 pendingUi.length=1 且 streaming=false。真实 status::apply/derive 同顺序进入 Review。外部 omp 是否总会先撤销卡片，未假定。 | live.ts:930-962；status.rs:127-137；process.rs:297-304；replay-js/live.replay.ts；replay-rs/tests/replay.rs | 未建立修复模型；产品代码未修改 |
| IdleNotWorking | 回答已结束回合的遗留卡片会把空闲状态改回处理中 | reproduced consumer behavior | out/stories.md #5，步骤1–13 | 真实 status::apply/derive：confirm -> agent_end -> UiResponded，Review 变 Working，无 agent_start。未执行真实原生 stdin 写入。 | rpc/mod.rs:534-562；status.rs:140-145；replay-rs/tests/replay.rs | 未建立修复模型；产品代码未修改 |

### Model Ownership

- Source: [Ownership.tla](runtime/Ownership/model/Ownership.tla), config [Ownership.cfg](runtime/Ownership/model/Ownership.cfg), map [Ownership.map.mjs](runtime/Ownership/model/Ownership.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](runtime/Ownership/chart/chart.mmd) / [chart.png](runtime/Ownership/chart/chart.png)
- Bug charts: [bug-1.mmd](runtime/Ownership/chart/bug-1.mmd) / [png](runtime/Ownership/chart/bug-1.png), [bug-2.mmd](runtime/Ownership/chart/bug-2.mmd) / [png](runtime/Ownership/chart/bug-2.png)
- Stories: [stories.md](runtime/Ownership/chart/stories.md); counts: [summary.json](runtime/Ownership/chart/summary.json)
- TLC logs: [Ownership-ExternalIsRealOmp.out](runtime/Ownership/chart/tlc/Ownership-ExternalIsRealOmp.out), [Ownership-SuspendShown.out](runtime/Ownership/chart/tlc/Ownership-SuspendShown.out), [Ownership-TypeOK.out](runtime/Ownership/chart/tlc/Ownership-TypeOK.out), [Ownership.out](runtime/Ownership/chart/tlc/Ownership.out)
- From summary.json: 124 model states, 413 transitions, 32 chart states, 97 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 单会话、有限请求 id；不模拟上游调度保证、工具执行副作用或网络。; 运行模型仅1次启动、4次用户/子进程动作、stdout最多2帧；不是全程序证明。; 占用模型对 PID 复用使用操作系统事实抽象；挂起模型省略文件监听防抖刷新。; 仅取目录状态推导的非本应用存活分支；不验证本应用与外部持有者并存的冲突处理。暂停标记写入期间允许重新打开。; 接管动作只表示读取缓存外部进程号并终止的子步骤，恢复用单独打开动作抽象；进程号复用、强制退出均是环境输入。; 运行模型定义中的用户接受、文件监听、外部占用、空闲回收动作不在 Next；其独立部分由 Ownership 覆盖，接受/已读细节只读。; 发现竞争路径未等同原生实时重现。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| ExternalIsRealOmp | 状态文件的进程号被复用后会话被误判外部占用 | reproduced consumer behavior | out-b/stories.md #1，步骤1–4 | 真实 external_map + pid_alive，以当前测试进程作为状态文件中的复用 pid：返回 external holder。未实际强杀 omp 或逼迫 OS 复用 PID。 | catalog/external.rs:99-131；rpc/mod.rs:400-418,630-660；replay-rs/tests/replay.rs | 未建立修复模型；产品代码未修改 |
| SuspendShown | 挂起标记晚于退出重算写入时显示可能停在空闲 | trace-and-source-only hypothesis | out-b/stories.md #2，步骤1–4 | 未重放 native 竞争窗口：需要受控 Tauri AppState、原生进程退出/总线调度与 DB 写入屏障；源代码只读无法注入屏障。普通路径可能由文件监听刷新修正，模型未包含防抖时间保证。 | rpc/mod.rs:189-228,277,688-694；catalog/tasks.rs:318-331；process.rs:994 | 未建立修复模型；产品代码未修改 |

### Additional observations (not model invariants; classification is per item)

- **切换到无文件会话时沿用旧会话文件**; kind: reproduced consumer behavior; reproduction: 真实扩展默认注册入口：session_start(old,/sessions/old.jsonl) -> session_switch(new,undefined)，new.json.sessionFile 等于旧文件。; evidence: extension/omp-workspace-status.ts:79-87；replay-js/ext.replay.ts; limit: 未建独立 TLA 模型；不假定上游无文件 session_switch 的可达性。
- **迟到的子代理进度可以倒退终态**; kind: reproduced consumer behavior; reproduction: 真实 useLive.reduceFrame：completed 生命周期后 running 进度把状态改回 running。; evidence: src/stores/live.ts:1171-1243；replay-js/live.replay.ts; limit: 未建独立 TLA 模型；未假定上游保证或不保证帧顺序。

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `node statechart.mjs from-spec model/RuntimeStatus.tla --out out --png --cover --title 会话运行状态 --expect-broken NoGhostLive,NoGhostStreaming,CardsMatchStatus,IdleNotWorking,AwaitingNeedsProcess` | 0 | 修正模型后实跑成功：35486 模型状态；精确预期5条规则破坏，无 TypeOK 失败。最终图像复核由集成验收记录。 |
| `node statechart.mjs from-spec model-b/Ownership.tla --out out-b --png --title 会话占用与挂起 --expect-broken ExternalIsRealOmp,SuspendShown` | 0 | 修正模型后实跑成功：124 模型状态、32图状态、97图边，精确预期两条规则破坏，无 TypeOK 失败。 |
| `CARGO_TARGET_DIR=.../target cargo test --offline --test replay` | 0 | 3 passed; 0 failed；直接 path 导入真实 contracts/parse/status/external 源码。最初缺依赖的编译尝试已通过 scratch manifest 修正。 |
| `./node_modules/.bin/vitest run --config <scratch>/runtime/replay-js/vitest.config.ts` | 0 | 2 test files / 4 tests passed；断言当前缺陷行为，不是产品契约通过。 |
| `uncitedConditions over both .tla` | 0 | 修正虚构守卫后两个模型均无未引用条件；环境事件和单分支抽象边界保留在模型注释与限制说明。 |

Slice narrative: [runtime/RESULT.md](runtime/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [citation-check.json](runtime/evidence/citation-check.json)
- [replay-js/ext.replay.ts](runtime/evidence/replay-js/ext.replay.ts)
- [replay-js/live.replay.ts](runtime/evidence/replay-js/live.replay.ts)
- [replay-js/vitest.config.ts](runtime/evidence/replay-js/vitest.config.ts)
- [replay-observed.txt](runtime/evidence/replay-observed.txt)
- [replay-rs/Cargo.lock](runtime/evidence/replay-rs/Cargo.lock)
- [replay-rs/Cargo.toml](runtime/evidence/replay-rs/Cargo.toml)
- [replay-rs/src/lib.rs](runtime/evidence/replay-rs/src/lib.rs)
- [replay-rs/tests/replay.rs](runtime/evidence/replay-rs/tests/replay.rs)

## composer: 输入、计划、暂存队列与侧聊状态审计

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| src/features/chat/Composer.tsx | 输入、待发计划标签、停止、模型预览 | modeled | 预览/派发/停止/held 合同进入模型；附件具体内容不进入状态空间。 |
| src/features/chat/plan | 计划角色选择与状态 | modeled | 预览、状态发布、角色读写、取消所有权。 |
| src/features/chat/HeldQueueBar.tsx | 逐条即时发送 | modeled | 与批量发送共享忙碌预留，失败恢复。 |
| src/features/chat/QueuedBar.tsx | held 自动排空 | modeled | 停止后 streaming 下降沿触发自动发送。 |
| src/features/chat/heldQueue.ts | held 队列存取与预留 | modeled | 两消息有界抽象；持久化介质失败不建模。 |
| src/features/chat/send.ts | 发送与中止 | modeled | 公开 abortTurn、prompt 边界回放。 |
| src/features/chat/PlanPanel.tsx | 计划审批界面 | modeled | 模式退出后审批按钮不可用，创建新会话失败不回滚。 |
| src/features/sidechat/sideChatActions.ts | 创建侧聊和首问 | modeled | 创建成功后先回显再发问；失败只提示。 |
| src/features/sidechat/SideChatPanel.tsx | 侧聊文本清空/恢复 | modeled | 首问创建失败恢复与发送失败不恢复区分。 |
| src/features/sidechat/handbackRun.ts | 回传生成 | modeled | 忙碌/空闲/生成/提取摘要；主会话提交下游不推断。 |
| src-tauri/src/rpc/sidechat.rs | 侧聊复制与提问 | modeled | 截断副本失败时退回父文件；外部 ask 边界。 |
| src-tauri/src/rpc/fork.rs | 普通分支 | modeled | 仅无 pin 的 LastCompleteTurn 分支合同。 |
| src-tauri/src/rpc/forkcut.rs | 记录截断和计划状态 | modeled | 真实 Rust 入口回放；普通分支保留截断前的 custom 状态。 |
| extension/omp-workspace-plan.ts | 计划运行时扩展 | modeled | 注册命令、结束提醒、启动恢复与批准退出。 |
| src/stores/composer.ts | 草稿和附件存储 | read-only | 读取草稿/持久化/替换入口；payload、撤销和跨窗口存储不进入有限模型。 |
| src/features/chat/slash | 斜杠命令解析、执行与状态 | read-only | 阅读执行器合同；计划标签 dispatch 成功/失败进入 preview 模型；其他命令仅输入输出边界。 |
| src/features/sidechat/handbackLogic.ts | 摘要提示与内容提取 | read-only | 回传输入输出合同；文本解析纯函数不单独建图。 |
| src/features/sidechat/viewStore.ts | 标签视图所有权 | read-only | 阅读创建、绑定、关闭接口；多标签竞争不建模。 |
| src-tauri/src/rpc/plan_ext.rs | 扩展安装 | read-only | 部署/安装代码，无用户对话状态转换建模。 |
| src/features/sidechat/sideChatAttachments.ts | 侧聊附件生命周期 | out-of-model | 不推断上传与持久化成功；另列构建兼容性注记。 |
| src/features/sidechat/HandbackDialog.tsx | 回传编辑对话框 | out-of-model | 模型仅包含摘要 ready/error，不穷举编辑、复制和提交。 |
| src/features/sidechat/sideChatTitle.ts | 标题生成 | out-of-model | 输出文案纯转换，无独立状态建模。 |
| src/features/chat/AddMenuPopover.tsx | 添加菜单 | out-of-model | 呈现/选项不单独建模。 |
| src/features/chat/ContextPillBar.tsx | 上下文选择和草稿 pill | out-of-model | 不是执行/计划状态权威来源；具体选择操作不单独建模。 |
| src/features/chat/ImageChips.tsx | 附件展示 | out-of-model | 文件字节、缩略图、token 估算和文件附件处理均作为不透明输入。 |
| src/features/chat/editDrafts.ts | 编辑草稿 | out-of-model | 不建模编辑原消息后的所有转换。 |
| src/features/chat/privacy | 秘密标记 | out-of-model | privacy-providers 切片所有。 |
| src/features/chat/subagents | 子代理显示 | out-of-model | runtime 切片所有。 |
| src/features/chat/visualize | 可视化消息 | out-of-model | 呈现与桥接，不属于本切片 submit/plan/held 生命周期。 |
| src/features/chat/share | 消息分享 | out-of-model | 不属于本切片 submit/plan/held 生命周期。 |
| src/features/chat/sketch | 草图编辑 | out-of-model | 附件 payload 内部状态不进入本模型。 |
| src/features/chat/find | 消息查找 | out-of-model | 视图导航归 shell；查找索引不进入本模型。 |
| src/features/chat/ask | 追问面板 | out-of-model | 运行时输入请求由 runtime 切片负责；本切片不重复。 |

### Model plan-preview

- Source: [PlanPreview.tla](composer/plan-preview/model/PlanPreview.tla), config [PlanPreview.cfg](composer/plan-preview/model/PlanPreview.cfg), map [PlanPreview.map.mjs](composer/plan-preview/model/PlanPreview.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](composer/plan-preview/chart/chart.mmd) / [chart.png](composer/plan-preview/chart/chart.png)
- Bug charts: [bug-1.mmd](composer/plan-preview/chart/bug-1.mmd) / [png](composer/plan-preview/chart/bug-1.png), [bug-2.mmd](composer/plan-preview/chart/bug-2.mmd) / [png](composer/plan-preview/chart/bug-2.png)
- Stories: [stories.md](composer/plan-preview/chart/stories.md); counts: [summary.json](composer/plan-preview/chart/summary.json)
- TLC logs: [PlanPreview-NoResidueAfterPreview.out](composer/plan-preview/chart/tlc/PlanPreview-NoResidueAfterPreview.out), [PlanPreview-PreviewKeepsOrdinaryChoice.out](composer/plan-preview/chart/tlc/PlanPreview-PreviewKeepsOrdinaryChoice.out), [PlanPreview-SettledChipShowsSavedRole.out](composer/plan-preview/chart/tlc/PlanPreview-SettledChipShowsSavedRole.out), [PlanPreview-SettledProcessRunsSavedRole.out](composer/plan-preview/chart/tlc/PlanPreview-SettledProcessRunsSavedRole.out), [PlanPreview-TypeOK.out](composer/plan-preview/chart/tlc/PlanPreview-TypeOK.out), [PlanPreview.out](composer/plan-preview/chart/tlc/PlanPreview.out)
- From summary.json: 660 model states, 2444 transitions, 33 chart states, 32 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 单调访问代次和写入代次各最多二次；更长历史不枚举。读写失败显式建模；运行中进程重载角色配置作为 ConfigReloads 边界。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| SettledChipShowsSavedRole | 计划角色读取失败时未发送标签回退显示普通模型 | design question | 选中未发送计划标签; 角色读取静默失败; 稳定后仍显示普通模型 | 未回放失败角色读取的渲染组件。该无条件规则保留来暴露失败时的产品合同；它不是成功读写路径的缺陷，也不是模代次回绕产物。 | src/features/chat/Composer.tsx:884-894; src/features/chat/plan/planModelChoice.ts:49-50; plan-preview/PlanPreview-statechart/stories.md | 未提出产品修复；无 fixed 模型，不声称已修复。 |

### Model held-queue

- Source: [HeldQueue.tla](composer/held-queue/model/HeldQueue.tla), config [HeldQueue.cfg](composer/held-queue/model/HeldQueue.cfg), map [HeldQueue.map.mjs](composer/held-queue/model/HeldQueue.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](composer/held-queue/chart/chart.mmd) / [chart.png](composer/held-queue/chart/chart.png)
- Bug charts: [bug-1.mmd](composer/held-queue/chart/bug-1.mmd) / [png](composer/held-queue/chart/bug-1.png), [bug-2.mmd](composer/held-queue/chart/bug-2.mmd) / [png](composer/held-queue/chart/bug-2.png), [bug-3.mmd](composer/held-queue/chart/bug-3.mmd) / [png](composer/held-queue/chart/bug-3.png), [bug-4.mmd](composer/held-queue/chart/bug-4.mmd) / [png](composer/held-queue/chart/bug-4.png), [bug-5.mmd](composer/held-queue/chart/bug-5.mmd) / [png](composer/held-queue/chart/bug-5.png), [bug-6.mmd](composer/held-queue/chart/bug-6.mmd) / [png](composer/held-queue/chart/bug-6.png), [bug-7.mmd](composer/held-queue/chart/bug-7.mmd) / [png](composer/held-queue/chart/bug-7.png), [bug-8.mmd](composer/held-queue/chart/bug-8.mmd) / [png](composer/held-queue/chart/bug-8.png), [bug-9.mmd](composer/held-queue/chart/bug-9.mmd) / [png](composer/held-queue/chart/bug-9.png)
- Stories: [stories.md](composer/held-queue/chart/stories.md); counts: [summary.json](composer/held-queue/chart/summary.json)
- TLC logs: [HeldQueue-NoDuplicateDelivery.out](composer/held-queue/chart/tlc/HeldQueue-NoDuplicateDelivery.out), [HeldQueue-NoLostMessage.out](composer/held-queue/chart/tlc/HeldQueue-NoLostMessage.out), [HeldQueue-StopDoesNotResendHeld.out](composer/held-queue/chart/tlc/HeldQueue-StopDoesNotResendHeld.out), [HeldQueue-TypeOK.out](composer/held-queue/chart/tlc/HeldQueue-TypeOK.out), [HeldQueue.out](composer/held-queue/chart/tlc/HeldQueue.out)
- From summary.json: 337 model states, 1112 transitions, 44 chart states, 48 chart transitions, 9 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 两条消息、单会话；发送抽象为接受或拒绝，运行时只输入 streaming 边沿；不推断服务端重复投递。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| StopDoesNotResendHeld | 点击停止后，本地 held 文本仍被自动发送 | reproduced consumer behavior | 运行中输入消息进入 held; 点击停止; 终止事件使 streaming 归零; 自动排空并发送 held prompt | replay/composer-replay.test.ts 中真实 abortTurn + QueuedBar 订阅；3/3 测试之一，断言复现行为而非期望修复。 | src/features/chat/send.ts:200-229; src/features/chat/QueuedBar.tsx:73-87; replay/run.log | 未提出产品修复；无 fixed 模型，不声称已修复。 |

### Model plan-stop

- Source: [PlanStop.tla](composer/plan-stop/model/PlanStop.tla), config [PlanStop.cfg](composer/plan-stop/model/PlanStop.cfg), map [PlanStop.map.mjs](composer/plan-stop/model/PlanStop.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](composer/plan-stop/chart/chart.mmd) / [chart.png](composer/plan-stop/chart/chart.png)
- Stories: [stories.md](composer/plan-stop/chart/stories.md); counts: [summary.json](composer/plan-stop/chart/summary.json)
- TLC logs: [PlanStop-StopDoesNotRestartGeneration.out](composer/plan-stop/chart/tlc/PlanStop-StopDoesNotRestartGeneration.out), [PlanStop-TypeOK.out](composer/plan-stop/chart/tlc/PlanStop-TypeOK.out), [PlanStop.out](composer/plan-stop/chart/tlc/PlanStop.out)
- From summary.json: 49 model states, 79 transitions, 14 chart states, 13 chart transitions, 0 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 依赖用户停止产生 aborted 消息；最多一个提醒和有限停止次数，不模拟真实模型或工具。

### Model plan-stop-boundary

- Source: [PlanStop.tla](composer/plan-stop-boundary/model/PlanStop.tla), config [PlanStop.cfg](composer/plan-stop-boundary/model/PlanStop.cfg), map [PlanStop.map.mjs](composer/plan-stop-boundary/model/PlanStop.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](composer/plan-stop-boundary/chart/chart.mmd) / [chart.png](composer/plan-stop-boundary/chart/chart.png)
- Bug charts: [bug-1.mmd](composer/plan-stop-boundary/chart/bug-1.mmd) / [png](composer/plan-stop-boundary/chart/bug-1.png), [bug-2.mmd](composer/plan-stop-boundary/chart/bug-2.mmd) / [png](composer/plan-stop-boundary/chart/bug-2.png), [bug-3.mmd](composer/plan-stop-boundary/chart/bug-3.mmd) / [png](composer/plan-stop-boundary/chart/bug-3.png)
- Stories: [stories.md](composer/plan-stop-boundary/chart/stories.md); counts: [summary.json](composer/plan-stop-boundary/chart/summary.json)
- TLC logs: [PlanStop-StopDoesNotRestartGeneration.out](composer/plan-stop-boundary/chart/tlc/PlanStop-StopDoesNotRestartGeneration.out), [PlanStop-TypeOK.out](composer/plan-stop-boundary/chart/tlc/PlanStop-TypeOK.out), [PlanStop.out](composer/plan-stop-boundary/chart/tlc/PlanStop.out)
- From summary.json: 83 model states, 138 transitions, 18 chart states, 19 chart transitions, 3 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 与上一图相同，但假设停止不产生 aborted；只用于上游边界，不是已确认停止故障。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| StopDoesNotRestartGeneration | 停止消息是否标记 aborted 是提醒重启的上游边界 | design question | 无计划文件时停止; 若最后消息不是 aborted; agent_end 发送一次提醒触发新轮次 | 真实扩展 handler：aborted 发送0次，stop/toolUse 各发送1次；没有证据证明上游用户停止会产出非 aborted。 | extension/omp-workspace-plan.ts:67-82; extension/omp-workspace-plan.ts:516-520; replay/plan-extension-replay.mjs; replay/consumer-observations.json | 未提出产品修复；无 fixed 模型，不声称已修复。 |

### Model plan-approve

- Source: [PlanApprove.tla](composer/plan-approve/model/PlanApprove.tla), config [PlanApprove.cfg](composer/plan-approve/model/PlanApprove.cfg), map [PlanApprove.map.mjs](composer/plan-approve/model/PlanApprove.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](composer/plan-approve/chart/chart.mmd) / [chart.png](composer/plan-approve/chart/chart.png)
- Bug charts: [bug-1.mmd](composer/plan-approve/chart/bug-1.mmd) / [png](composer/plan-approve/chart/bug-1.png)
- Stories: [stories.md](composer/plan-approve/chart/stories.md); counts: [summary.json](composer/plan-approve/chart/summary.json)
- TLC logs: [PlanApprove-FailedApprovalCanRetryAtOnce.out](composer/plan-approve/chart/tlc/PlanApprove-FailedApprovalCanRetryAtOnce.out), [PlanApprove-TypeOK.out](composer/plan-approve/chart/tlc/PlanApprove-TypeOK.out), [PlanApprove.out](composer/plan-approve/chart/tlc/PlanApprove.out)
- From summary.json: 18 model states, 22 transitions, 9 chart states, 8 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 新上下文执行批准，创建会话成功/失败；不模拟 shell 导航内部。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| FailedApprovalCanRetryAtOnce | 批准先退出计划，创建执行会话失败后不能直接在面板重试 | reproduced consumer behavior | 点击批准并新建上下文执行; 扩展退出计划模式; 创建会话失败; 计划面板不再提供批准按钮 | 真实 approvePlan 注入 createSession 拒绝验证命令顺序及错误；真实扩展注册命令回放验证 content 存在时批准后 enabled=false。面板按钮消失由源码佐证，未运行原生 UI。 | src/features/chat/plan/planActions.ts; src/features/chat/PlanPanel.tsx:66-67; extension/omp-workspace-plan.ts:434-446; replay/plan-extension-replay.mjs; replay/consumer-observations.json | 未提出产品修复；无 fixed 模型，不声称已修复。 |

### Model sidechat

- Source: [SideChat.tla](composer/sidechat/model/SideChat.tla), config [SideChat.cfg](composer/sidechat/model/SideChat.cfg), map [SideChat.map.mjs](composer/sidechat/model/SideChat.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](composer/sidechat/chart/chart.mmd) / [chart.png](composer/sidechat/chart/chart.png)
- Bug charts: [bug-1.mmd](composer/sidechat/chart/bug-1.mmd) / [png](composer/sidechat/chart/bug-1.png), [bug-2.mmd](composer/sidechat/chart/bug-2.mmd) / [png](composer/sidechat/chart/bug-2.png), [bug-3.mmd](composer/sidechat/chart/bug-3.mmd) / [png](composer/sidechat/chart/bug-3.png), [bug-4.mmd](composer/sidechat/chart/bug-4.mmd) / [png](composer/sidechat/chart/bug-4.png), [bug-5.mmd](composer/sidechat/chart/bug-5.mmd) / [png](composer/sidechat/chart/bug-5.png)
- Stories: [stories.md](composer/sidechat/chart/stories.md); counts: [summary.json](composer/sidechat/chart/summary.json)
- TLC logs: [SideChat-EchoMeansMessageSent.out](composer/sidechat/chart/tlc/SideChat-EchoMeansMessageSent.out), [SideChat-FailedFirstMessageKeepsText.out](composer/sidechat/chart/tlc/SideChat-FailedFirstMessageKeepsText.out), [SideChat-SideChatNeverInheritsPlanMode.out](composer/sidechat/chart/tlc/SideChat-SideChatNeverInheritsPlanMode.out), [SideChat-TypeOK.out](composer/sidechat/chart/tlc/SideChat-TypeOK.out), [SideChat.out](composer/sidechat/chart/tlc/SideChat.out)
- From summary.json: 20 model states, 25 transitions, 14 chart states, 13 chart transitions, 5 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 一个新侧聊、一次首问和一次回传；未覆盖全体标签、附件、主工作区写权限和真实工具执行。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| EchoMeansMessageSent | 侧聊首问发送失败仍保留用户回显 | reproduced consumer behavior | 创建侧聊成功; 先写入用户回显; 首次 ask 拒绝; 回显未撤销 | 真实 sendFirstMessage，mock 仅 RPC；消费者 pendingUserEchoes 仍含文本；非真实服务端投递证明。 | src/features/sidechat/sideChatActions.ts:81-100; replay/composer-replay.test.ts | 未提出产品修复；无 fixed 模型，不声称已修复。 |
| FailedFirstMessageKeepsText | 侧聊首问发送失败后输入文字未回到草稿 | trace-and-source-only hypothesis | 面板清空草稿; 创建侧聊成功; ask 失败仅提示错误 | 回放验证 action 的失败不抛出及 echo；没有渲染 SideChatPanel 输入框回放，不能当作完整 UI 复现。 | src/features/sidechat/SideChatPanel.tsx:457-472; src/features/sidechat/sideChatActions.ts:99-100 | 未提出产品修复；无 fixed 模型，不声称已修复。 |
| SideChatNeverInheritsPlanMode | 侧聊截断副本写失败可能继承父计划模式 | trace-and-source-only hypothesis | 父处于计划模式; 创建截断副本失败; 退回原父文件分支 | 没有通过 Rust side_chat_create 注入磁盘失败；只有 trace 和错误回退源码证据。 | src-tauri/src/rpc/sidechat.rs:48-58; src-tauri/src/rpc/forkcut.rs:32-41; src-tauri/src/rpc/forkcut.rs:92-95 | 未提出产品修复；无 fixed 模型，不声称已修复。 |

### Model fork-plan-state

- Source: [ForkPlanState.tla](composer/fork-plan-state/model/ForkPlanState.tla), config [ForkPlanState.cfg](composer/fork-plan-state/model/ForkPlanState.cfg), map [ForkPlanState.map.mjs](composer/fork-plan-state/model/ForkPlanState.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](composer/fork-plan-state/chart/chart.mmd) / [chart.png](composer/fork-plan-state/chart/chart.png)
- Bug charts: [bug-1.mmd](composer/fork-plan-state/chart/bug-1.mmd) / [png](composer/fork-plan-state/chart/bug-1.png), [bug-10.mmd](composer/fork-plan-state/chart/bug-10.mmd) / [png](composer/fork-plan-state/chart/bug-10.png), [bug-11.mmd](composer/fork-plan-state/chart/bug-11.mmd) / [png](composer/fork-plan-state/chart/bug-11.png), [bug-12.mmd](composer/fork-plan-state/chart/bug-12.mmd) / [png](composer/fork-plan-state/chart/bug-12.png), [bug-13.mmd](composer/fork-plan-state/chart/bug-13.mmd) / [png](composer/fork-plan-state/chart/bug-13.png), [bug-14.mmd](composer/fork-plan-state/chart/bug-14.mmd) / [png](composer/fork-plan-state/chart/bug-14.png), [bug-15.mmd](composer/fork-plan-state/chart/bug-15.mmd) / [png](composer/fork-plan-state/chart/bug-15.png), [bug-16.mmd](composer/fork-plan-state/chart/bug-16.mmd) / [png](composer/fork-plan-state/chart/bug-16.png), [bug-17.mmd](composer/fork-plan-state/chart/bug-17.mmd) / [png](composer/fork-plan-state/chart/bug-17.png), [bug-18.mmd](composer/fork-plan-state/chart/bug-18.mmd) / [png](composer/fork-plan-state/chart/bug-18.png), [bug-19.mmd](composer/fork-plan-state/chart/bug-19.mmd) / [png](composer/fork-plan-state/chart/bug-19.png), [bug-2.mmd](composer/fork-plan-state/chart/bug-2.mmd) / [png](composer/fork-plan-state/chart/bug-2.png), [bug-20.mmd](composer/fork-plan-state/chart/bug-20.mmd) / [png](composer/fork-plan-state/chart/bug-20.png), [bug-21.mmd](composer/fork-plan-state/chart/bug-21.mmd) / [png](composer/fork-plan-state/chart/bug-21.png), [bug-22.mmd](composer/fork-plan-state/chart/bug-22.mmd) / [png](composer/fork-plan-state/chart/bug-22.png), [bug-23.mmd](composer/fork-plan-state/chart/bug-23.mmd) / [png](composer/fork-plan-state/chart/bug-23.png), [bug-24.mmd](composer/fork-plan-state/chart/bug-24.mmd) / [png](composer/fork-plan-state/chart/bug-24.png), [bug-25.mmd](composer/fork-plan-state/chart/bug-25.mmd) / [png](composer/fork-plan-state/chart/bug-25.png), [bug-3.mmd](composer/fork-plan-state/chart/bug-3.mmd) / [png](composer/fork-plan-state/chart/bug-3.png), [bug-4.mmd](composer/fork-plan-state/chart/bug-4.mmd) / [png](composer/fork-plan-state/chart/bug-4.png), [bug-5.mmd](composer/fork-plan-state/chart/bug-5.mmd) / [png](composer/fork-plan-state/chart/bug-5.png), [bug-6.mmd](composer/fork-plan-state/chart/bug-6.mmd) / [png](composer/fork-plan-state/chart/bug-6.png), [bug-7.mmd](composer/fork-plan-state/chart/bug-7.mmd) / [png](composer/fork-plan-state/chart/bug-7.png), [bug-8.mmd](composer/fork-plan-state/chart/bug-8.mmd) / [png](composer/fork-plan-state/chart/bug-8.png), [bug-9.mmd](composer/fork-plan-state/chart/bug-9.mmd) / [png](composer/fork-plan-state/chart/bug-9.png)
- Stories: [stories.md](composer/fork-plan-state/chart/stories.md); counts: [summary.json](composer/fork-plan-state/chart/summary.json)
- TLC logs: [ForkPlanState-ForkKeepsParentPlanMode.out](composer/fork-plan-state/chart/tlc/ForkPlanState-ForkKeepsParentPlanMode.out), [ForkPlanState-TypeOK.out](composer/fork-plan-state/chart/tlc/ForkPlanState-TypeOK.out), [ForkPlanState.out](composer/fork-plan-state/chart/tlc/ForkPlanState.out)
- From summary.json: 241 model states, 240 transitions, 241 chart states, 240 chart transitions, 25 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 四个非头部事件，一次完整轮次分支；消息内容和其他 custom 记录省略，forkcut 实际回放补充验证。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| ForkKeepsParentPlanMode | 完整轮次分支丢弃尾部计划开关，恢复成旧计划状态 | reproduced consumer behavior | 写入计划开启记录; 助手完成回答; 写入计划关闭记录; LastCompleteTurn 截断; 扩展 session_start 恢复副本 | 真实 forkcut::truncate 产生副本；真实扩展 session_start 对 parent/fork 分别发布 false/true。fork_session RPC 本身和原生 UI 未运行；这是组件间公开函数/注册回调合同复现。 | src-tauri/src/rpc/fork.rs:31-39; src-tauri/src/rpc/forkcut.rs:100-118; extension/omp-workspace-plan.ts:453-459; replay/forkcut-replay/src/main.rs; replay/fork-extension-replay.mjs; replay/consumer-observations.json | 未提出产品修复；无 fixed 模型，不声称已修复。 |

### Additional observations (not model invariants; classification is per item)

- **构建兼容性注记**; evidence: src/features/sidechat/sideChatAttachments.ts:48 uses Promise.withResolvers; TS2550 previously observed by main/contract, not rerun here.; kind: build compatibility note

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `Individual from-spec commands recorded in models[].regenerate (equivalent to regenerate.sh entries)` | 0 | Each model command completed with exit0 for its final expectations; corrected preview bg_153. Combined regenerate.sh has not been run locally; main owns final full relocated run. |
| `./node_modules/.bin/vitest run --config <scratch>/composer/replay/vitest.config.ts` | 0 | 3/3 reproduction evidence tests passed; replay/run.log |
| `CARGO_TARGET_DIR=forkcut-target cargo run --offline -q --manifest-path forkcut-replay/Cargo.toml; bun fork-extension-replay.mjs fork-cut-output.jsonl` | 0 | Parent restored plan=false, fork restored plan=true. |
| `bun plan-extension-replay.mjs` | 0 | aborted reminder0; stop/toolUse reminder1; after valid-file approve enabled=false. |
| `node uncited.mjs */*.tla` | 0 | citation-check.json: all seven arrays empty; source citations are traceability not whole-program proof. |

Slice narrative: [composer/RESULT.md](composer/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [citation-check.json](composer/evidence/citation-check.json)
- [replay/composer-replay.test.ts](composer/evidence/replay/composer-replay.test.ts)
- [replay/consumer-observations.json](composer/evidence/replay/consumer-observations.json)
- [replay/fork-cut-output.jsonl](composer/evidence/replay/fork-cut-output.jsonl)
- [replay/fork-extension-replay.mjs](composer/evidence/replay/fork-extension-replay.mjs)
- [replay/forkcut-replay/Cargo.lock](composer/evidence/replay/forkcut-replay/Cargo.lock)
- [replay/forkcut-replay/Cargo.toml](composer/evidence/replay/forkcut-replay/Cargo.toml)
- [replay/forkcut-replay/src/main.rs](composer/evidence/replay/forkcut-replay/src/main.rs)
- [replay/plan-extension-replay.mjs](composer/evidence/replay/plan-extension-replay.mjs)
- [replay/run.log](composer/evidence/replay/run.log)
- [replay/vitest.config.ts](composer/evidence/replay/vitest.config.ts)

## git-files: 工作树、文件缓冲区、检查点与存储清理状态图审计

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| extension/autocommit-rule.md | extension | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| extension/omp-workspace-checkpoints.ts | extension | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src-tauri/src/git/base_sync.rs | git | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src-tauri/src/git/checkpoints_ext.rs | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src-tauri/src/git/cmd.rs | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src-tauri/src/git/commands.rs | git | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| src-tauri/src/git/history.rs | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src-tauri/src/git/mod.rs | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src-tauri/src/git/status.rs | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src-tauri/src/git/tests.rs | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src-tauri/src/git/tm.rs | git | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src-tauri/src/git/turns.rs | git | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src-tauri/src/git/worktree.rs | git | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src-tauri/src/omp_files.rs | src | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| src-tauri/src/storage/fsutil.rs | storage | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src-tauri/src/storage/images.rs | storage | read-only | 已读图片引用/垃圾回收实现；30天年龄、24小时节流、部分失败和草稿引用未建模/未回放 |
| src-tauri/src/storage/mod.rs | storage | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src-tauri/src/storage/sessions.rs | storage | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src/features/editor/DocView.tsx | editor | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| src/features/editor/useFileBuffer.ts | editor | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src/features/explorer/FileExplorer.tsx | explorer | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/explorer/FileIcon.test.ts | explorer | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/explorer/FileIcon.tsx | explorer | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/explorer/FileTreeNode.tsx | explorer | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/explorer/WorkspaceCard.tsx | explorer | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/files/FileEditor.tsx | files | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/files/FilePreviewPanel.test.tsx | files | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/files/FilePreviewPanel.tsx | files | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src/features/git/BranchAssetSection.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/ChangesSection.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/CheckpointsCard.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/DiffModal.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/GitPanel.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/NewSessionDialog.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/OrphanBadge.test.ts | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/OrphanBadge.tsx | git | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src/features/git/OrphanBanner.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/TimelineSection.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/TmRunCard.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/WorktreeActionMenu.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/WorktreeCommitPopover.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/WorktreeGraph.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/WorktreeHoverCard.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/WorktreeSection.tsx | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/diff.test.ts | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/diff.ts | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/helpers.test.ts | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/helpers.ts | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/removeWorktree.tsx | git | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| src/features/git/turns.test.ts | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/features/git/turns.ts | git | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| src/features/git/useAutoRefresh.ts | git | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/stores/explorer.ts | stores | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| src/stores/filePreview.test.ts | stores | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/stores/filePreview.ts | stores | modeled | 相关生命周期进入有限模型；不代表该文件全部行为均已验证 |
| src/stores/turnNav.ts | stores | read-only | 用于边界/调用契约对照；未单独建立状态机 |
| src/stores/worktrees.test.ts | stores | out-of-model | 静态展示、辅助函数或额外操作未进入本轮模型；不作验证结论 |
| src/stores/worktrees.ts | stores | read-only | 用于边界/调用契约对照；未单独建立状态机 |

### Model FileBuffer

- Source: [FileBuffer.tla](git-files/FileBuffer/model/FileBuffer.tla), config [FileBuffer.cfg](git-files/FileBuffer/model/FileBuffer.cfg), map [FileBuffer.map.mjs](git-files/FileBuffer/model/FileBuffer.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](git-files/FileBuffer/chart/chart.mmd) / [chart.png](git-files/FileBuffer/chart/chart.png)
- Bug charts: [bug-1.mmd](git-files/FileBuffer/chart/bug-1.mmd) / [png](git-files/FileBuffer/chart/bug-1.png), [bug-2.mmd](git-files/FileBuffer/chart/bug-2.mmd) / [png](git-files/FileBuffer/chart/bug-2.png), [bug-3.mmd](git-files/FileBuffer/chart/bug-3.mmd) / [png](git-files/FileBuffer/chart/bug-3.png), [bug-4.mmd](git-files/FileBuffer/chart/bug-4.mmd) / [png](git-files/FileBuffer/chart/bug-4.png), [bug-5.mmd](git-files/FileBuffer/chart/bug-5.mmd) / [png](git-files/FileBuffer/chart/bug-5.png)
- Stories: [stories.md](git-files/FileBuffer/chart/stories.md); counts: [summary.json](git-files/FileBuffer/chart/summary.json)
- TLC logs: [FileBuffer-NoClobber.out.gz](git-files/FileBuffer/chart/tlc/FileBuffer-NoClobber.out.gz), [FileBuffer-NoLossOnClose.out.gz](git-files/FileBuffer/chart/tlc/FileBuffer-NoLossOnClose.out.gz), [FileBuffer-NoLossOnRefresh.out.gz](git-files/FileBuffer/chart/tlc/FileBuffer-NoLossOnRefresh.out.gz), [FileBuffer-NoLossOnReload.out.gz](git-files/FileBuffer/chart/tlc/FileBuffer-NoLossOnReload.out.gz), [FileBuffer-NoLossOnSwitch.out.gz](git-files/FileBuffer/chart/tlc/FileBuffer-NoLossOnSwitch.out.gz), [FileBuffer.out.gz](git-files/FileBuffer/chart/tlc/FileBuffer.out.gz)
- From summary.json: 36896 model states, 225120 transitions, 225 chart states, 229 chart transitions, 5 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 两个标签、有限文本版本；IPC 为读写边界 mock，验证真实 React/CodeMirror 与 Zustand；未验原生文件权限/浏览器窗口行为。后台磁盘写入在概览中可能合并为隐藏步骤，完整 TLC 与 replay 保留该事件。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| NoLossOnClose | 未保存的修改在关闭标签时不会丢失。 | reproduced consumer behavior | 按 file-buffer/out/stories.md 的编号 1 路径逐步读取 | 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 | file-buffer/out/bug-1.png; file-buffer/out/bug-1.mmd; file-buffer/out/stories.md; file-buffer/out/summary.json; replay/git-files.replay.test.tsx | 未提出/未建模修复；产品未修改 |
| NoLossOnReload | 未保存的修改在点重新载入时不会在没确认的情况下丢失。 | reproduced consumer behavior | 按 file-buffer/out/stories.md 的编号 2 路径逐步读取 | 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 | file-buffer/out/bug-2.png; file-buffer/out/bug-2.mmd; file-buffer/out/stories.md; file-buffer/out/summary.json; replay/git-files.replay.test.tsx | 未提出/未建模修复；产品未修改 |
| NoLossOnSwitch | 未保存的修改在切换标签时不会丢失。 | reproduced consumer behavior | 按 file-buffer/out/stories.md 的编号 3 路径逐步读取 | 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 | file-buffer/out/bug-3.png; file-buffer/out/bug-3.mmd; file-buffer/out/stories.md; file-buffer/out/summary.json; replay/git-files.replay.test.tsx | 未提出/未建模修复；产品未修改 |
| NoClobber | 保存不会悄悄覆盖用户从没看到过的磁盘改动。 | reproduced consumer behavior | 按 file-buffer/out/stories.md 的编号 4 路径逐步读取 | 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 | file-buffer/out/bug-4.png; file-buffer/out/bug-4.mmd; file-buffer/out/stories.md; file-buffer/out/summary.json; replay/git-files.replay.test.tsx | 未提出/未建模修复；产品未修改 |
| NoLossOnRefresh | 窗口聚焦后的后台刷新不会冲掉用户刚输入的文字。 | reproduced consumer behavior | 按 file-buffer/out/stories.md 的编号 5 路径逐步读取 | 真实 FilePreviewPanel / store 入口，IPC 与确认框仅在 I/O 边界 mock；8 项聚焦回放中的文件编辑用例通过，证明现有不安全行为，而非修复验收。 | file-buffer/out/bug-5.png; file-buffer/out/bug-5.mmd; file-buffer/out/stories.md; file-buffer/out/summary.json; replay/git-files.replay.test.tsx | 未提出/未建模修复；产品未修改 |

### Model Worktree

- Source: [Worktree.tla](git-files/Worktree/model/Worktree.tla), config [Worktree.cfg](git-files/Worktree/model/Worktree.cfg), map [Worktree.map.mjs](git-files/Worktree/model/Worktree.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](git-files/Worktree/chart/chart.mmd) / [chart.png](git-files/Worktree/chart/chart.png)
- Bug charts: [bug-1.mmd](git-files/Worktree/chart/bug-1.mmd) / [png](git-files/Worktree/chart/bug-1.png), [bug-2.mmd](git-files/Worktree/chart/bug-2.mmd) / [png](git-files/Worktree/chart/bug-2.png), [bug-3.mmd](git-files/Worktree/chart/bug-3.mmd) / [png](git-files/Worktree/chart/bug-3.png)
- Stories: [stories.md](git-files/Worktree/chart/stories.md); counts: [summary.json](git-files/Worktree/chart/summary.json)
- TLC logs: [Worktree-NoKillRunningRun.out](git-files/Worktree/chart/tlc/Worktree-NoKillRunningRun.out), [Worktree-NoRemoveInUse.out](git-files/Worktree/chart/tlc/Worktree-NoRemoveInUse.out), [Worktree-NoSilentDirtyLoss.out](git-files/Worktree/chart/tlc/Worktree-NoSilentDirtyLoss.out), [Worktree-NoStaleListing.out](git-files/Worktree/chart/tlc/Worktree-NoStaleListing.out), [Worktree.out](git-files/Worktree/chart/tlc/Worktree.out)
- From summary.json: 658 model states, 3215 transitions, 249 chart states, 248 chart transitions, 3 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 一个会话工作树、一个旧提交工作树；原生 Rust/git/process 未调用；UI replay 只证明请求参数/快照/错误后列表，不能证明运行中进程真正被杀或目录真正删除。NoKillRunningRun 名称只指运行目录被删，非已证实进程死亡。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| NoKillRunningRun | 正在运行的时光机不会被「回收孤儿」删掉目录。 | trace-and-source-only hypothesis | 按 worktree/out/stories.md 的编号 1 路径逐步读取 | 真实 useOrphans 证明使用旧扫描结果且提交无占用信息的删除请求；Rust 删除与进程影响未回放。 | worktree/out/bug-1.png; worktree/out/bug-1.mmd; worktree/out/stories.md; worktree/out/summary.json; replay/git-files.replay.test.tsx | 未提出/未建模修复；产品未修改 |
| NoRemoveInUse | 有会话在用的工作树不会被「回收孤儿」删掉。 | trace-and-source-only hypothesis | 按 worktree/out/stories.md 的编号 2 路径逐步读取 | 真实 useOrphans 证明使用旧扫描结果且提交无占用信息的删除请求；Rust 删除与进程影响未回放。 | worktree/out/bug-2.png; worktree/out/bug-2.mmd; worktree/out/stories.md; worktree/out/summary.json; replay/git-files.replay.test.tsx | 未提出/未建模修复；产品未修改 |
| NoStaleListing | 清理失败后，界面不会再显示一个磁盘上已经不存在的工作树。 | reproduced consumer behavior | 按 worktree/out/stories.md 的编号 3 路径逐步读取 | 真实 useOrphans.reclaim 收到原生边界的部分成功错误后，旧列表保留且没有再次扫描；真实目录删除部分来自源码，未在本测试执行。 | worktree/out/bug-3.png; worktree/out/bug-3.mmd; worktree/out/stories.md; worktree/out/summary.json; replay/git-files.replay.test.tsx | 未提出/未建模修复；产品未修改 |

### Model Checkpoint

- Source: [Checkpoint.tla](git-files/Checkpoint/model/Checkpoint.tla), config [Checkpoint.cfg](git-files/Checkpoint/model/Checkpoint.cfg), map [Checkpoint.map.mjs](git-files/Checkpoint/model/Checkpoint.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](git-files/Checkpoint/chart/chart.mmd) / [chart.png](git-files/Checkpoint/chart/chart.png)
- Bug charts: [bug-1.mmd](git-files/Checkpoint/chart/bug-1.mmd) / [png](git-files/Checkpoint/chart/bug-1.png), [bug-2.mmd](git-files/Checkpoint/chart/bug-2.mmd) / [png](git-files/Checkpoint/chart/bug-2.png), [bug-3.mmd](git-files/Checkpoint/chart/bug-3.mmd) / [png](git-files/Checkpoint/chart/bug-3.png)
- Stories: [stories.md](git-files/Checkpoint/chart/stories.md); counts: [summary.json](git-files/Checkpoint/chart/summary.json)
- TLC logs: [Checkpoint-NoCrossingExpired.out](git-files/Checkpoint/chart/tlc/Checkpoint-NoCrossingExpired.out), [Checkpoint-NoLeftoverSnapshots.out.gz](git-files/Checkpoint/chart/tlc/Checkpoint-NoLeftoverSnapshots.out.gz), [Checkpoint-NoSilentOverwrite.out.gz](git-files/Checkpoint/chart/tlc/Checkpoint-NoSilentOverwrite.out.gz), [Checkpoint-UndoneStaysUndone.out](git-files/Checkpoint/chart/tlc/Checkpoint-UndoneStaysUndone.out), [Checkpoint.out](git-files/Checkpoint/chart/tlc/Checkpoint.out)
- From summary.json: 2498 model states, 3770 transitions, 235 chart states, 235 chart transitions, 3 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 三轮、保留两轮抽象生产 KEEP_TURNS=50；同会话、单文件；公开扩展事件在隔离 git 仓库回放。撤回标记回放以 git ref 种子作为边界输入，不声称调用过 Rust undo_turn。NoSilentOverwrite 的最短路径是用户在轮次结束前改动，被同一快照捕获，属于归属设计问题，不是已证实无提示覆盖“轮后”编辑。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| NoLeftoverSnapshots | 没有正在记录的轮次时，不会留下只有开始快照、没有条目的残留存档。 | reproduced consumer behavior | 按 checkpoint/out/stories.md 的编号 1 路径逐步读取 | 公开扩展注册的 agent_start/agent_end/session_switch 事件，独立 mkdtemp git 仓库。前者验证切会话遗留 before ref 且以后不清理；后者在 52 轮中验证已种入 undone 标记随旧存档删除，条目仍保留；未调用 Rust 撤回。 | checkpoint/out/bug-1.png; checkpoint/out/bug-1.mmd; checkpoint/out/stories.md; checkpoint/out/summary.json; replay/extension-checkpoints.replay.ts | 未提出/未建模修复；产品未修改 |
| NoSilentOverwrite | 撤回不会悄悄覆盖用户之后做的改动。 | design question | 按 checkpoint/out/stories.md 的编号 2 路径逐步读取 | 未回放 Rust undo_turn；最短路径用户在轮内改动，需决定整轮快照是否包含这些改动，不能归类为已确认的轮后编辑丢失。 | checkpoint/out/bug-2.png; checkpoint/out/bug-2.mmd; checkpoint/out/stories.md; checkpoint/out/summary.json | 未提出/未建模修复；产品未修改 |
| UndoneStaysUndone | 已经撤回过的轮次，在存档清理之后仍然显示为已撤回。 | reproduced consumer behavior | 按 checkpoint/out/stories.md 的编号 3 路径逐步读取 | 公开扩展注册的 agent_start/agent_end/session_switch 事件，独立 mkdtemp git 仓库。前者验证切会话遗留 before ref 且以后不清理；后者在 52 轮中验证已种入 undone 标记随旧存档删除，条目仍保留；未调用 Rust 撤回。 | checkpoint/out/bug-3.png; checkpoint/out/bug-3.mmd; checkpoint/out/stories.md; checkpoint/out/summary.json; replay/extension-checkpoints.replay.ts | 未提出/未建模修复；产品未修改 |

### Model BaseSync

- Source: [BaseSync.tla](git-files/BaseSync/model/BaseSync.tla), config [BaseSync.cfg](git-files/BaseSync/model/BaseSync.cfg), map [BaseSync.map.mjs](git-files/BaseSync/model/BaseSync.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](git-files/BaseSync/chart/chart.mmd) / [chart.png](git-files/BaseSync/chart/chart.png)
- Bug charts: [bug-1.mmd](git-files/BaseSync/chart/bug-1.mmd) / [png](git-files/BaseSync/chart/bug-1.png)
- Stories: [stories.md](git-files/BaseSync/chart/stories.md); counts: [summary.json](git-files/BaseSync/chart/summary.json)
- TLC logs: [BaseSync-ErrorLeavesBranchUntouched.out](git-files/BaseSync/chart/tlc/BaseSync-ErrorLeavesBranchUntouched.out), [BaseSync.out](git-files/BaseSync/chart/tlc/BaseSync.out)
- From summary.json: 74 model states, 74 transitions, 70 chart states, 39 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 有限 ahead/behind 和快进失败原因；合并/快进历史压缩为布尔量，所谓合并提交也可能是快进 HEAD 变化；原生入口未回放，失败原子性是待确认设计契约。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| ErrorLeavesBranchUntouched | 同步或变基报错时，当前分支的提交历史保持同步前的样子。 | design question | 按 base-sync/out/stories.md 的编号 1 路径逐步读取 | 源码显示当前分支先变更，随后基础分支快进可失败；需决定错误原子性契约，原生入口未执行。 | base-sync/out/bug-1.png; base-sync/out/bug-1.mmd; base-sync/out/stories.md; base-sync/out/summary.json | 未提出/未建模修复；产品未修改 |

### Model Storage

- Source: [Storage.tla](git-files/Storage/model/Storage.tla), config [Storage.cfg](git-files/Storage/model/Storage.cfg), map [Storage.map.mjs](git-files/Storage/model/Storage.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](git-files/Storage/chart/chart.mmd) / [chart.png](git-files/Storage/chart/chart.png)
- Bug charts: [bug-1.mmd](git-files/Storage/chart/bug-1.mmd) / [png](git-files/Storage/chart/bug-1.png), [bug-2.mmd](git-files/Storage/chart/bug-2.mmd) / [png](git-files/Storage/chart/bug-2.png), [bug-3.mmd](git-files/Storage/chart/bug-3.mmd) / [png](git-files/Storage/chart/bug-3.png)
- Stories: [stories.md](git-files/Storage/chart/stories.md); counts: [summary.json](git-files/Storage/chart/summary.json)
- TLC logs: [Storage-NoTrashPinned.out](git-files/Storage/chart/tlc/Storage-NoTrashPinned.out), [Storage-NoTrashStartedAfterCheck.out](git-files/Storage/chart/tlc/Storage-NoTrashStartedAfterCheck.out), [Storage-NoTrashTerminalHeld.out](git-files/Storage/chart/tlc/Storage-NoTrashTerminalHeld.out), [Storage-NoTrashWorking.out](git-files/Storage/chart/tlc/Storage-NoTrashWorking.out), [Storage.out](git-files/Storage/chart/tlc/Storage.out)
- From summary.json: 22 model states, 47 transitions, 22 chart states, 21 chart transitions, 3 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 单个会话；会话状态切换是 runtime 输入契约，不模拟底层启动/锁；只建模 skip_reason 与 delete_with 的检查/执行边界；未回放 native 竞态，未建模图片年龄、节流、部分删除失败、锁/Trash 平台语义。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| NoTrashPinned | 清理不会删掉检查之后才被置顶的会话。 | trace-and-source-only hypothesis | 按 storage/out/stories.md 的编号 1 路径逐步读取 | 未回放原生入口；只提供模型路径和源码，不能视为确认产品缺陷。 | storage/out/bug-1.png; storage/out/bug-1.mmd; storage/out/stories.md; storage/out/summary.json | 未提出/未建模修复；产品未修改 |
| NoTrashStartedAfterCheck | 清理不会删掉检查之后才被启动的会话。 | trace-and-source-only hypothesis | 按 storage/out/stories.md 的编号 2 路径逐步读取 | 未回放原生入口；只提供模型路径和源码，不能视为确认产品缺陷。 | storage/out/bug-2.png; storage/out/bug-2.mmd; storage/out/stories.md; storage/out/summary.json | 未提出/未建模修复；产品未修改 |
| NoTrashTerminalHeld | 清理不会删掉被终端里的 omp 占用的会话。 | trace-and-source-only hypothesis | 按 storage/out/stories.md 的编号 3 路径逐步读取 | 未回放原生入口；只提供模型路径和源码，不能视为确认产品缺陷。 | storage/out/bug-3.png; storage/out/bug-3.mmd; storage/out/stories.md; storage/out/summary.json | 未提出/未建模修复；产品未修改 |

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `node cite-check.mjs file-buffer/FileBuffer.tla worktree/Worktree.tla checkpoint/Checkpoint.tla base-sync/BaseSync.tla storage/Storage.tla` | 0 | TOTAL_UNCITED 0；见 logs/source-citations.txt |
| `./node_modules/.bin/vitest run --config <scratch>/git-files/replay/vitest.config.mts` | 0 | 8 tests passed，重现现有消费者行为；不是产品修复验收。 |
| `<HOME>/.bun/bin/bun run <scratch>/git-files/replay/extension-checkpoints.replay.ts` | 0 | 4 个隔离 git fixture 检查通过；含正常轮、切换遗留、后续不清理与 52 轮 pruning。 |

Slice narrative: [git-files/RESULT.md](git-files/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [logs/base-sync.log](git-files/evidence/logs/base-sync.log)
- [logs/checkpoint.log](git-files/evidence/logs/checkpoint.log)
- [logs/file-buffer.log](git-files/evidence/logs/file-buffer.log)
- [logs/source-citations.txt](git-files/evidence/logs/source-citations.txt)
- [logs/storage.log](git-files/evidence/logs/storage.log)
- [logs/worktree-first.log](git-files/evidence/logs/worktree-first.log)
- [logs/worktree.log](git-files/evidence/logs/worktree.log)
- [replay/extension-checkpoints.replay.ts](git-files/evidence/replay/extension-checkpoints.replay.ts)
- [replay/git-files.replay.test.tsx](git-files/evidence/replay/git-files.replay.test.tsx)
- [replay/vitest.config.mts](git-files/evidence/replay/vitest.config.mts)

## mobile: 手机端连接、发送、审批、配对与服务生命周期审计

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| src-mobile/core | 连接、配对、API、会话列表 | modeled | 连接/请求/审批进入五个有界模型；规范化、偏好和普通导航不在模型内。 |
| src-mobile/app | 应用外壳、连接横幅、路由 | read-only | 连接横幅由真实 store 回放；路由、主题、视口与错误边界未建独立模型。 |
| src-mobile/features/chat | 发送、审批、历史与输入工具 | modeled | 发送所有权和审批快照有模型及真实 ChatController 回放；语音、附件、草图、模型选择和转录渲染未穷举。 |
| src-mobile/features/sessions | 列表、树、搜索、新建会话 | out-of-model | 会话列表作为连接恢复输入边界；独立导航、新建、删除和撤销未建模。 |
| src-mobile/features/settings | 模型设置、通知、配额、设置面板 | out-of-model | 推送订阅属于配对模型；其他设置应用/撤销由 model-settings/settings-skills/privacy-providers 边界承接，移动端面板自身竞态未建模。 |
| src-mobile/features/panels | 文件、git、终端、计划、侧聊、服务 | out-of-model | 请求结果为 git-files/runtime/terminal-services 外部契约；移动端轮询、切页、取消未穷举。 |
| src-mobile/features/subagents | 子代理轮询和展示 | read-only | 阅读 poller.ts；运行状态为 runtime 输入，未建立独立轮询模型。 |
| src-mobile/features/more | 想法、定时任务、技能、草图 | out-of-model | automation/settings-skills 提供外部操作契约；移动端编辑与保存时序未建模。 |
| src-mobile/ui | 通用控件与渲染 | out-of-model | 不将样式或纯渲染当生命周期；对话框、底部面板、刷新和可视化桥未做独立状态证明。 |
| src-mobile/styles | CSS | out-of-model | 样式无独立执行生命周期。 |
| src-mobile/sw.ts | 通知点击和目标解析 | read-only | 阅读入口；未模拟浏览器 worker、缓存或真实通知点击。 |
| src-mobile/main.tsx | 应用启动 | read-only | 阅读启动和配对入口；没有浏览器端启动验收。 |
| src-tauri/src/mobile/auth.rs | 单次配对和撤销 | modeled | 绑定配对模型；SQLite 和原生 HTTP 未执行。 |
| src-tauri/src/mobile/server.rs | 路由、认证、SSE | modeled | 配对及 SSE 契约；原生网络未启动。 |
| src-tauri/src/mobile/api/chat.rs | 发送和审批 API | modeled | 发送及批量审批模型；上游运行时视为边界，不推断其内部。 |
| src-tauri/src/mobile/push.rs | 订阅、在线标记、推送去重 | modeled | 配对推送模型；无实际推送投递。 |
| src-tauri/src/mobile/api/push.rs | 推送端点 | modeled | 订阅和前台状态接口进入配对模型；无 native replay。 |
| src-tauri/src/mobile/mod.rs | 服务运行/停止、IPv6 | modeled | 基础设施模型；未启停真实服务。 |
| src-tauri/src/mobile/tunnel.rs | 隧道进程生命周期 | modeled | 启动/停止抽象为异步动作；未创建隧道进程。 |
| src-tauri/src/mobile/ddns.rs | DDNS 同步 | modeled | 基础设施模型中抽象域名同步成功；提供商 HTTP 不在模型内。 |
| src-tauri/src/mobile/tls.rs | 证书生成 | read-only | 域名证书关系进入基础设施模型；加密和真实证书未验证。 |
| src-tauri/src/mobile/commands.rs | 桌面命令适配 | read-only | 阅读命令到服务入口；设置 UI 自身未建模。 |
| src-tauri/src/mobile/assets.rs | 静态资源发布 | read-only | 实际读取 mobile-dist；不是 legacy mobile 目录。 |
| src-tauri/src/mobile/ipv6.rs | 地址发现 | out-of-model | 网络环境输入；未运行接口发现。 |
| src-tauri/src/mobile/backend.rs | 后端能力适配 | out-of-model | 属于 runtime 等外部契约。 |
| src-tauri/src/mobile/last.rs | 上次访问持久化 | out-of-model | 独立持久化覆盖与排序未建模。 |
| src-tauri/src/mobile/tests.rs | 原生已有测试 | out-of-model | 本次未执行 cargo 测试。 |
| src-tauri/src/mobile/api | 其他 API：draft/files/ideas/left/media/misc/quota/voice | out-of-model | 聊天与推送除外；其他 API 作为外部业务边界，未覆盖原生副作用、语音和媒体。 |
| src-tauri/mobile | 旧版静态客户端 | out-of-model | 目录仍存在；assets.rs:15 与 vite.mobile.config.ts:23 指向 mobile-dist。旧版代码未建模。 |
| src/features/mobile/MobilePanel.tsx | 桌面手机连接设置 | out-of-model | 目录仍存在，935 行；原生命令属于本片，但面板表单状态/设置竞态未建模。 |
| vite.mobile.config.ts | 移动构建及 worker 入口 | read-only | 构建输出 mobile-dist 与 sw 独立入口；未做构建。 |

### Model MobileConn

- Source: [MobileConn.tla](mobile/MobileConn/model/MobileConn.tla), config [MobileConn.cfg](mobile/MobileConn/model/MobileConn.cfg), map [MobileConn.map.mjs](mobile/MobileConn/model/MobileConn.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](mobile/MobileConn/chart/chart.mmd) / [chart.png](mobile/MobileConn/chart/chart.png)
- Bug charts: [bug-1.mmd](mobile/MobileConn/chart/bug-1.mmd) / [png](mobile/MobileConn/chart/bug-1.png), [bug-2.mmd](mobile/MobileConn/chart/bug-2.mmd) / [png](mobile/MobileConn/chart/bug-2.png)
- Stories: [stories.md](mobile/MobileConn/chart/stories.md); counts: [summary.json](mobile/MobileConn/chart/summary.json)
- TLC logs: [MobileConn-BannerMatchesStream.out](mobile/MobileConn/chart/tlc/MobileConn-BannerMatchesStream.out), [MobileConn-OpenMeansStream.out](mobile/MobileConn/chart/tlc/MobileConn-OpenMeansStream.out), [MobileConn-TypeOK.out](mobile/MobileConn/chart/tlc/MobileConn-TypeOK.out), [MobileConn-UnauthorizedSticky.out](mobile/MobileConn/chart/tlc/MobileConn-UnauthorizedSticky.out), [MobileConn.out](mobile/MobileConn/chart/tlc/MobileConn.out)
- From summary.json: 79 model states, 257 transitions, 27 chart states, 27 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 有界抽象不是整程序验证; 无产品修复模型；所有破坏规则为预期审计结果; 总览省略 34 个投影状态、169 条投影转换

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| BannerMatchesStream | 网络恢复后横幅仍显示断开 | reproduced consumer behavior | 启动; 问候; 离线; 在线 | replay/conn.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。 | src-mobile/core/sse.ts:101-109,190-191; conn/out/stories.md; conn/out/tlc | 未做产品修复或修复后模型验证 |
| UnauthorizedSticky | 离线事件覆盖未授权状态 | reproduced consumer behavior | 标记未授权; 离线 | replay/conn.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。 | src-mobile/core/sse.ts:190-191; src-mobile/core/api.ts:39; conn/out/stories.md; conn/out/tlc | 未做产品修复或修复后模型验证 |

### Model MobilePrompt

- Source: [MobilePrompt.tla](mobile/MobilePrompt/model/MobilePrompt.tla), config [MobilePrompt.cfg](mobile/MobilePrompt/model/MobilePrompt.cfg), map [MobilePrompt.map.mjs](mobile/MobilePrompt/model/MobilePrompt.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](mobile/MobilePrompt/chart/chart.mmd) / [chart.png](mobile/MobilePrompt/chart/chart.png)
- Bug charts: [bug-1.mmd](mobile/MobilePrompt/chart/bug-1.mmd) / [png](mobile/MobilePrompt/chart/bug-1.png), [bug-2.mmd](mobile/MobilePrompt/chart/bug-2.mmd) / [png](mobile/MobilePrompt/chart/bug-2.png)
- Stories: [stories.md](mobile/MobilePrompt/chart/stories.md); counts: [summary.json](mobile/MobilePrompt/chart/summary.json)
- TLC logs: [MobilePrompt-NoDuplicatePrompt.out](mobile/MobilePrompt/chart/tlc/MobilePrompt-NoDuplicatePrompt.out), [MobilePrompt-RestoredMeansNotSent.out](mobile/MobilePrompt/chart/tlc/MobilePrompt-RestoredMeansNotSent.out), [MobilePrompt-TypeOK.out](mobile/MobilePrompt/chart/tlc/MobilePrompt-TypeOK.out), [MobilePrompt.out](mobile/MobilePrompt/chart/tlc/MobilePrompt.out)
- From summary.json: 18 model states, 28 transitions, 17 chart states, 27 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 有界抽象不是整程序验证; 无产品修复模型；所有破坏规则为预期审计结果

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| RestoredMeansNotSent | 超时恢复输入不代表服务器未接收 | reproduced consumer behavior | 发送; 服务器接收; 响应超时; 恢复原文 | replay/chat.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。 | src-mobile/features/chat/chatStore.ts:579-610; src-tauri/src/mobile/api/chat.rs:465-488; chat/out-prompt/stories.md; chat/out-prompt/tlc | 未做产品修复或修复后模型验证 |
| NoDuplicatePrompt | 超时后再次发送同一原文形成两个请求 | reproduced consumer behavior | 前一路径; 再次发送 | replay/chat.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。 | src-mobile/features/chat/chatStore.ts:601-607; chat/out-prompt/stories.md; chat/out-prompt/tlc | 未做产品修复或修复后模型验证 |

### Model MobilePending

- Source: [MobilePending.tla](mobile/MobilePending/model/MobilePending.tla), config [MobilePending.cfg](mobile/MobilePending/model/MobilePending.cfg), map [MobilePending.map.mjs](mobile/MobilePending/model/MobilePending.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](mobile/MobilePending/chart/chart.mmd) / [chart.png](mobile/MobilePending/chart/chart.png)
- Bug charts: [bug-1.mmd](mobile/MobilePending/chart/bug-1.mmd) / [png](mobile/MobilePending/chart/bug-1.png), [bug-2.mmd](mobile/MobilePending/chart/bug-2.mmd) / [png](mobile/MobilePending/chart/bug-2.png)
- Stories: [stories.md](mobile/MobilePending/chart/stories.md); counts: [summary.json](mobile/MobilePending/chart/summary.json)
- TLC logs: [MobilePending-BatchOnlyAnswersSeen.out](mobile/MobilePending/chart/tlc/MobilePending-BatchOnlyAnswersSeen.out), [MobilePending-NoAnsweredCardShown.out](mobile/MobilePending/chart/tlc/MobilePending-NoAnsweredCardShown.out), [MobilePending-TypeOK.out](mobile/MobilePending/chart/tlc/MobilePending-TypeOK.out), [MobilePending.out](mobile/MobilePending/chart/tlc/MobilePending.out)
- From summary.json: 3934 model states, 12088 transitions, 13 chart states, 12 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 有界抽象不是整程序验证; 无产品修复模型；所有破坏规则为预期审计结果; 总览省略 473 个投影状态、2933 条投影转换

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| BatchOnlyAnswersSeen | 全部允许请求不携带屏幕上的审批编号 | reproduced consumer behavior | 显示请求一; 服务器新增请求二; 全部允许 | replay/chat.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。 | src-mobile/features/chat/chatStore.ts:522; src-tauri/src/mobile/api/chat.rs:577-607; chat/out-pending/stories.md; chat/out-pending/tlc | 未做产品修复或修复后模型验证 |
| NoAnsweredCardShown | 较旧快照晚到使已回答卡片复活 | reproduced consumer behavior | 发出列表请求; 回答卡片; 较旧响应返回 | replay/chat.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。 | src-mobile/features/chat/chatStore.ts:378-393; chat/out-pending/stories.md; chat/out-pending/tlc | 未做产品修复或修复后模型验证 |

### Model MobilePairing

- Source: [MobilePairing.tla](mobile/MobilePairing/model/MobilePairing.tla), config [MobilePairing.cfg](mobile/MobilePairing/model/MobilePairing.cfg), map [MobilePairing.map.mjs](mobile/MobilePairing/model/MobilePairing.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](mobile/MobilePairing/chart/chart.mmd) / [chart.png](mobile/MobilePairing/chart/chart.png)
- Bug charts: [bug-1.mmd](mobile/MobilePairing/chart/bug-1.mmd) / [png](mobile/MobilePairing/chart/bug-1.png), [bug-2.mmd](mobile/MobilePairing/chart/bug-2.mmd) / [png](mobile/MobilePairing/chart/bug-2.png), [bug-3.mmd](mobile/MobilePairing/chart/bug-3.mmd) / [png](mobile/MobilePairing/chart/bug-3.png)
- Stories: [stories.md](mobile/MobilePairing/chart/stories.md); counts: [summary.json](mobile/MobilePairing/chart/summary.json)
- TLC logs: [MobilePairing-CodeSingleUse.out](mobile/MobilePairing/chart/tlc/MobilePairing-CodeSingleUse.out), [MobilePairing-NoApprovalDropped.out](mobile/MobilePairing/chart/tlc/MobilePairing-NoApprovalDropped.out), [MobilePairing-NoPushWhileViewing.out](mobile/MobilePairing/chart/tlc/MobilePairing-NoPushWhileViewing.out), [MobilePairing-OnlyPhonePairs.out](mobile/MobilePairing/chart/tlc/MobilePairing-OnlyPhonePairs.out), [MobilePairing-RevokedHasNoSubscription.out](mobile/MobilePairing/chart/tlc/MobilePairing-RevokedHasNoSubscription.out), [MobilePairing-TypeOK.out](mobile/MobilePairing/chart/tlc/MobilePairing-TypeOK.out), [MobilePairing.out](mobile/MobilePairing/chart/tlc/MobilePairing.out)
- From summary.json: 960 model states, 4244 transitions, 171 chart states, 320 chart transitions, 3 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 有界抽象不是整程序验证; 无产品修复模型；所有破坏规则为预期审计结果

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| OnlyPhonePairs | 配对 GET 可被非手机访问消耗 | trace-and-source-only hypothesis | 生成配对码; 链接预览访问 GET | 未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。 | src-tauri/src/mobile/server.rs:250-276; src-tauri/src/mobile/auth.rs:45; pairing/out/stories.md; pairing/out/tlc | 未做产品修复或修复后模型验证 |
| NoPushWhileViewing | 前台查看状态未上报时仍可能推送 | trace-and-source-only hypothesis | 配对; 订阅; 查看会话; 产生审批 | 未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。 | src-tauri/src/mobile/push.rs:431-439; src-tauri/src/mobile/api/push.rs; pairing/out/stories.md; pairing/out/tlc | 未做产品修复或修复后模型验证 |
| NoApprovalDropped | 同一会话短时间的后续审批可能被去重 | trace-and-source-only hypothesis | 订阅; 审批一; 30 秒内审批二 | 未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。 | src-tauri/src/mobile/push.rs:635-648; pairing/out/stories.md; pairing/out/tlc | 未做产品修复或修复后模型验证 |

### Model MobileInfra

- Source: [MobileInfra.tla](mobile/MobileInfra/model/MobileInfra.tla), config [MobileInfra.cfg](mobile/MobileInfra/model/MobileInfra.cfg), map [MobileInfra.map.mjs](mobile/MobileInfra/model/MobileInfra.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](mobile/MobileInfra/chart/chart.mmd) / [chart.png](mobile/MobileInfra/chart/chart.png)
- Bug charts: [bug-1.mmd](mobile/MobileInfra/chart/bug-1.mmd) / [png](mobile/MobileInfra/chart/bug-1.png), [bug-2.mmd](mobile/MobileInfra/chart/bug-2.mmd) / [png](mobile/MobileInfra/chart/bug-2.png), [bug-3.mmd](mobile/MobileInfra/chart/bug-3.mmd) / [png](mobile/MobileInfra/chart/bug-3.png)
- Stories: [stories.md](mobile/MobileInfra/chart/stories.md); counts: [summary.json](mobile/MobileInfra/chart/summary.json)
- TLC logs: [MobileInfra-LinkCoveredByCert.out](mobile/MobileInfra/chart/tlc/MobileInfra-LinkCoveredByCert.out), [MobileInfra-NoOrphanTunnel.out](mobile/MobileInfra/chart/tlc/MobileInfra-NoOrphanTunnel.out), [MobileInfra-TunnelNeedsServer.out](mobile/MobileInfra/chart/tlc/MobileInfra-TunnelNeedsServer.out), [MobileInfra-TypeOK.out](mobile/MobileInfra/chart/tlc/MobileInfra-TypeOK.out), [MobileInfra.out](mobile/MobileInfra/chart/tlc/MobileInfra.out)
- From summary.json: 192 model states, 1022 transitions, 65 chart states, 65 chart transitions, 3 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 有界抽象不是整程序验证; 无产品修复模型；所有破坏规则为预期审计结果; 总览省略 103 个投影状态、864 条投影转换

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| TunnelNeedsServer | 停止服务后在途隧道仍能上线 | trace-and-source-only hypothesis | 启动服务; 开始隧道; 停止服务; 隧道就绪 | 未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。 | src-tauri/src/mobile/tunnel.rs:151-271; src-tauri/src/mobile/mod.rs:144-186; infra/out/stories.md; infra/out/tlc | 未做产品修复或修复后模型验证 |
| NoOrphanTunnel | 并发启动可能遗留未登记隧道进程 | trace-and-source-only hypothesis | 两次启动; 各自就绪; 停止已登记隧道 | 未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。 | src-tauri/src/mobile/tunnel.rs:151-271; infra/out/stories.md; infra/out/tlc | 未做产品修复或修复后模型验证 |
| LinkCoveredByCert | 运行时修改 DDNS 域名后证书可能不匹配 | trace-and-source-only hypothesis | IPv6 启动; 修改域名; 后台同步 | 未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。 | src-tauri/src/mobile/mod.rs:188-249; src-tauri/src/mobile/tls.rs; infra/out/stories.md; infra/out/tlc | 未做产品修复或修复后模型验证 |

### Additional observations (not model invariants; classification is per item)

- **无效配对码仍可被报告为配对成功**; kind: reproduced consumer behavior; evidence: src-mobile/core/pair.ts; replay/pair.replay.test.ts; replay/replay.log; detail: pairWithCode 的 iframe load 后只以 GET /sessions 成功判定；回放以无效码和可读 sessions 得到 true。没有执行服务器配对。

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `TLA2TOOLS=... JAVA=... ./regen.sh` | 0 | 五个模型完成；12 条预期破坏规则均出现；TypeOK 均保持。连接总览之后用 --cover 重新生成 exit 0。 |
| `node check-citations.mjs conn/MobileConn.tla chat/MobilePrompt.tla chat/MobilePending.tla pairing/MobilePairing.tla infra/MobileInfra.tla` | 0 | 五个文件均为 []；这是语法引用检查，不保证行号解释完整。 |
| `./node_modules/.bin/vitest run --config <scratch>/mobile/replay/vitest.config.ts` | 0 | 原绝对路径配置 3 files / 6 tests passed，见 replay/replay.log。最终 cwd/相对路径配置亦已 smoke exit 0：3 files / 6 tests passed，23:03:34、2.35s，见 replay/portable-smoke.log。真实客户端 + mocked I/O 事件顺序，不是真实网络或服务器执行。 |
| `read all generated PNGs` | 0 | 17 张输出已打开；配对/基础设施总览很大，按 bug-N 路径阅读；配对 cover 因并行区域不能裁剪。 |
| `./node_modules/.bin/vitest run --config <scratch>/mobile/replay/vitest.config.ts` | 0 | 最终可迁移配置 smoke；3 files / 6 tests passed。只验证真实客户端 + mocked I/O。 |

Slice narrative: [mobile/RESULT.md](mobile/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [replay/chat.replay.test.ts](mobile/evidence/replay/chat.replay.test.ts)
- [replay/conn.replay.test.ts](mobile/evidence/replay/conn.replay.test.ts)
- [replay/pair.replay.test.ts](mobile/evidence/replay/pair.replay.test.ts)
- [replay/portable-smoke.log](mobile/evidence/replay/portable-smoke.log)
- [replay/replay.log](mobile/evidence/replay/replay.log)
- [replay/vitest.config.ts](mobile/evidence/replay/vitest.config.ts)

## model-settings: 模型设置、批量替换与模板自动切换状态审计

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| src-tauri/src/model_replace.rs | Scan / guarded apply / successful-edit history / inverted undo | modeled | ReplaceLifecycle models one guarded reference and undo result; scan projects/missing/errors, schedule/app-setting backends, partial batch, chain grouping, retry append and pruning read in source but not exhaustively modeled. |
| src-tauri/src/model_replace.rs | Catalog and real model probes | out-of-model | Catalog is an opaque capability input. Probe runners may spend provider quota; no real probe or CLI was executed. |
| src-tauri/src/model_templates/mod.rs | Scope validation and command contracts | modeled | TemplateSwitch uses global/project scope and command apply/undo boundaries; capture/snapshot/CRUD remain source-read-only. |
| src-tauri/src/model_templates/apply.rs | Fresh preview / quota preflight / write / session results / undo | modeled | TemplateSwitch models finite preflight/write/aggregate sessions; native session switching and manual template undo are source-read-only. Apply recomputes preview (306-307); GUI preview itself is not a CAS promise. |
| src-tauri/src/model_templates/rules.rs | Quota rule first hit / bottom line / auto revert / poller | modeled | TemplateSwitch bounds one eligible rule per valid scope and drift gating. Ordering, notification dedupe, missing projects, polling backoff and auto-revert eligibility predicates read in source, not separately explored. |
| src-tauri/src/model_templates/store.rs | Template/rule/history SQLite transactions | read-only | Read schema commands/upsert semantics: scope retained on template updates, bottom-line uniqueness per scope, dependent rule deletion, ordered rules. No config or DB writes were performed. |
| src-tauri/src/model_templates/usage.rs | Cached quota aggregation | read-only | fetch_usage uses cached report; window percentage and exhausted-account aggregation read. The model consumes verdicts instead of running provider/CLI reports. |
| src-tauri/src/model_templates/provider_map.rs | Usage-slug provider mapping | read-only | Exact mapping and verbatim fallback traced only; provider identity remains an I/O boundary. |
| src-tauri/src/settings_model_roles.rs | Scoped role resolution and guarded YAML edits | modeled | RoleScope models project-over-global roles and global-over-project named pins. Alias cycles/unset fallback, validation, byte preservation, atomic guarded writes, legacy refusal and batching read in source only. |
| src-tauri/src/settings_model_roles/chains.rs | Global fallback chain splice / rename / guarded write | read-only | Fresh locked read, grouped planning, verification and atomic write inspected. No source-level assertion replay or live config write. |
| src-tauri/src/settings_model_roles/discovery.rs | Agent catalog precedence / discovery | read-only | Project/user/extensions/plugins/builtin discovery and first-name-wins precedence inspected; no external catalog or arbitrary directory traversal model. |
| src/features/settings/modelReplace/ModelReplaceDialog.tsx | Scope / scan / preview / apply / retry / undo / late navigation | modeled | ReplaceOwnership models apply success/failure and start-over ownership; ReplaceLifecycle models stale stored value and undo; ModelCapability models target/level changes. Multiwrite, history read ordering and undo navigation are not fully explored. |
| src/features/settings/modelReplace/logic.ts | Plan building / matching / per-row thinking sanitization | modeled | ModelCapability uses supported levels and row override sanitization; aliases/globs/provider-sensitive matching, chain dedup/conflict and full buildPlan are source-read-only. |
| src/features/settings/modelReplace/kinds.ts | Model-kind grouping / catalog load | read-only | Catalog kind groups, probe-kind mapping, thinking eligibility and single-flight catalog load inspected. Catalog I/O not executed. |
| src/features/settings/modelReplace/parts.tsx | Target group and supported thinking picker | modeled | ModelCapability covers supported options and search target conversion; popover/search/rendering is source-read-only. |
| src/features/settings/modelReplace/ModelReplacePlanPreview.tsx | Checkbox and row override edit | modeled | ModelCapability abstracts one same-kind override with unsupported level removal. Rendering and every row permutation remain read-only. |
| src/features/settings/modelReplace/ModelReplaceResults.tsx | Result / retry-failed / selected live-session switch | read-only | Failed item retry and live RPC model/thinking/get_state contracts traced; Runtime owns downstream execution state. No actual session RPCs issued. |
| src/features/settings/modelReplace/ModelReplaceHistory.tsx | Expanded history / skipped undo outcomes | read-only | Stored edits, restored-value presentation and per-item errors inspected; UI expansion itself is not modeled. |
| src/features/settings/modelReplace/ModelReplaceOverview.tsx | Usage table / probe outcome UI | read-only | Usage selection/probe pending/success/error rendering inspected. Probe invocation is out of runtime audit to avoid API cost. |
| src/features/settings/modelReplace/store.ts | Cross-panel invalidation revision | read-only | Invalidate role/config/settings/schedule consumers traced. Consumer stores outside this slice retain their owners. |
| src/features/settings/modelTemplates/store.ts | Snapshot generation / mutation publication / status reads | modeled | TemplateSnapshot exposes late pre-save read overwriting a published successful mutation; confirmed through actual public store actions. Status reads/forced supersession are source-read-only, with forced-read control replayed. |
| src/features/settings/modelTemplates/index.tsx | Mount refresh / subscription ownership / capture / duplicate | read-only | Subscription cancellation cleanup and editor/apply modal ownership inspected; capture/navigation interleavings not separately verified. |
| src/features/settings/modelTemplates/TemplateEditor.tsx | Captured/duplicate draft / save / absent vs null roles | read-only | Save publishes full backend response via setSnapshot at 153. Pending busy/escape and null/absent editor values inspected, not independently modeled. |
| src/features/settings/modelTemplates/TemplatesCard.tsx | Scoped listing / confirmed deletion / restore | read-only | Scope filtering, dependent-rule warning and snapshot publication inspected. Confirm dialog and backend mutation I/O are not driven. |
| src/features/settings/modelTemplates/RulesCard.tsx | Rule save/toggle/order / full snapshot publication | read-only | Actual save caller of publication at 440-442 traced; the model begins at its returned snapshot, not a simulated UI click. Rule validation/CRUD not replayed. |
| src/features/settings/modelTemplates/ApplyPreview.tsx | Preview / refused force / applying result | modeled | TemplateSwitch models quota refusal and explicit force. Preview loading and modal rendering remain source-read-only; backend recomputes preview on apply. |
| src/features/settings/modelTemplates/SwitchLogCard.tsx | Scoped history / confirmed manual undo | read-only | Manual undo confirmation, IPC and refresh traced. Native undo not invoked. |
| src/features/settings/modelTemplates/logic.ts | Scope filters / quota provider labels / rule defaults | read-only | Scope helpers and quota presentation inspected; mapping remains an opaque provider identity boundary. |
| src/features/settings/AgentModelAssignmentsPanel.tsx | Queued scoped reads/writes and cached snapshots | modeled | RoleScope models scoped results; source ownership checks skip old-project read publication and queue writes. Full cache warming and cross-revision races remain read-only. |
| src/features/settings/ModelRoleTables.tsx | Role/agent editor status and selection | read-only | useSave mount ownership, pending/saved/error states, role choices and alias presentation inspected; not rendered or formally expanded. |
| src/features/settings/AddRoleForm.tsx | New model-role validation / save / cancel | read-only | Name uniqueness, value requirement, pending lock, scoped write and error preservation inspected; no role definition creation is implied. |
| src/features/settings/modelRoleScope.tsx | Global default / session project choice / navigation | modeled | RoleScope models explicit global/project selection; source no-project disabled state and project picker fallback are read-only. |
| src/features/settings/agentModelAssignments.ts | Role precedence / aliases / validation / fallback helper | read-only | Frontend mirrors resolver: unknown/cycle errors do not silently fall through; alias and syntactic capability handling inspected. Full agent-resolution chain not checked by RoleScope. |
| src/features/settings/modelRoles.ts | Builtin roles / suffixes / fallback chain types | read-only | Explicit absent/empty/list fallback meanings and known suffix splitting inspected; role values accept suffix syntax without a catalog capability guarantee. |
| src/features/settings/FallbackChainEditor.tsx | Draft reorder / apply / unset / disabled chain | read-only | Committed draft resync, valid cleaned rows, mode actions and record write inspected; whole-record RPC remains I/O. |
| src/features/settings/modelNormalization.ts | Model selector normalization/matching helpers | read-only | Pure display/match helpers inspected; no independently changing lifecycle to statechart. |
| src/features/settings/modelReplace/logic.test.ts | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| src/features/settings/modelReplace/ModelReplaceDialog.test.tsx | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| src/features/settings/modelTemplates/logic.test.ts | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| src/features/settings/AgentModelAssignmentsPanel.test.tsx | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| src/features/settings/AddRoleForm.test.tsx | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| src/features/settings/agentModelAssignments.test.ts | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| src/features/settings/modelRoles.test.ts | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| src/features/settings/FallbackChainEditor.test.tsx | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| src/features/settings/FallbackChainsSection.tsx | Global chain listing / cycle order / config reload | read-only | Read-only global fallback UI: role grouping, unset/empty/list inheritance hints, reload on save and shared cycle editor traced. Upstream runtime fallback algorithm stays opaque. |
| src/features/settings/ModelRulesSection.tsx | Model/provider fallback rule drafts / delete | read-only | Draft add validation, duplicate keys, confirmed deletion and full retry.fallbackChains write traced; not exhaustively modeled. |
| src/features/settings/FallbackSwitchesCard.tsx | Fallback switches / quota reserve policy | read-only | Pending lock, save/reload, master-disabled controls, usage-aware policy and percentage commit traced; runtime cooldown/fallback execution remains external. |
| src/features/settings/fallbackSwitches.ts | Fallback enum defaults / reserve validation | read-only | Pure enum narrowing and finite numeric 0..100 validation read; no independent runtime lifecycle. |
| src/components/ModelSelect.tsx | Role-backed selection boundary | read-only | Role override/global store loading and selected-role display path inspected. Generic picker, catalog refresh and live model application belong to their separate owners, not reimplemented here. |

### Model TemplateSnapshot

- Source: [TemplateSnapshot.tla](model-settings/TemplateSnapshot/model/TemplateSnapshot.tla), config [TemplateSnapshot.cfg](model-settings/TemplateSnapshot/model/TemplateSnapshot.cfg), map [TemplateSnapshot.map.mjs](model-settings/TemplateSnapshot/model/TemplateSnapshot.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](model-settings/TemplateSnapshot/chart/chart.mmd) / [chart.png](model-settings/TemplateSnapshot/chart/chart.png)
- Bug charts: [bug-1.mmd](model-settings/TemplateSnapshot/chart/bug-1.mmd) / [png](model-settings/TemplateSnapshot/chart/bug-1.png)
- Stories: [stories.md](model-settings/TemplateSnapshot/chart/stories.md); counts: [summary.json](model-settings/TemplateSnapshot/chart/summary.json)
- TLC logs: [TemplateSnapshot-MutationSurvives.out](model-settings/TemplateSnapshot/chart/tlc/TemplateSnapshot-MutationSurvives.out), [TemplateSnapshot-TypeOK.out](model-settings/TemplateSnapshot/chart/tlc/TemplateSnapshot-TypeOK.out), [TemplateSnapshot.out](model-settings/TemplateSnapshot/chart/tlc/TemplateSnapshot.out)
- From summary.json: 10 model states, 12 transitions, 6 chart states, 9 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: One snapshot read, one successful save publication; reply value captured at read start; errors terminate the read. Forced-read supersession is exercised by the consumer replay, not expanded in this model.

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| MutationSurvives | 已确认保存的新模板列表被更早的读取覆盖 | reproduced consumer behavior | 开始读取模板列表; 保存模板并显示新配置; 先前的读取返回配置，显示回旧配置 | Confirmed through actual public store load(true) and setSnapshot entrypoints: the saved-template snapshot is overwritten by before-save when an earlier read resolves. One focused replay test and four consumer-observable assertions passed; the newer-force-read control preserves saved-template. IPC/events mocked; no rendered desktop or native backend save was exercised. | snapshot-out/stories.md; snapshot-out/bug-1.mmd; snapshot-out/bug-1.png; snapshot-out/summary.json; snapshot-out/tlc/TemplateSnapshot-MutationSurvives.out; replay.test.ts; replay-result.json; replay.log; src/features/settings/modelTemplates/store.ts:46-59; src/features/settings/modelTemplates/store.ts:87; src/features/settings/modelTemplates/TemplateEditor.tsx:145-155; src/features/settings/modelTemplates/RulesCard.tsx:440-442 | Not modeled; no product fix made. |

### Model ReplaceLifecycle

- Source: [ReplaceLifecycle.tla](model-settings/ReplaceLifecycle/model/ReplaceLifecycle.tla), config [ReplaceLifecycle.cfg](model-settings/ReplaceLifecycle/model/ReplaceLifecycle.cfg), map [ReplaceLifecycle.map.mjs](model-settings/ReplaceLifecycle/model/ReplaceLifecycle.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](model-settings/ReplaceLifecycle/chart/chart.mmd) / [chart.png](model-settings/ReplaceLifecycle/chart/chart.png)
- Stories: [stories.md](model-settings/ReplaceLifecycle/chart/stories.md); counts: [summary.json](model-settings/ReplaceLifecycle/chart/summary.json)
- TLC logs: [ReplaceLifecycle-TypeOK.out](model-settings/ReplaceLifecycle/chart/tlc/ReplaceLifecycle-TypeOK.out), [ReplaceLifecycle-UndoGuard.out](model-settings/ReplaceLifecycle/chart/tlc/ReplaceLifecycle-UndoGuard.out), [ReplaceLifecycle.out](model-settings/ReplaceLifecycle/chart/tlc/ReplaceLifecycle.out)
- From summary.json: 8 model states, 7 transitions, 8 chart states, 7 chart transitions, 0 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: One scanned stored reference with three concrete values, one apply and at most one undo. A failed compare preserves the manual value. Batch partial results, retry accumulation, history pruning and later scans are source-read-only. undoValue captures the observable value at undo return, not a promise that future external writes cannot change it.

### Model ReplaceOwnership

- Source: [ReplaceOwnership.tla](model-settings/ReplaceOwnership/model/ReplaceOwnership.tla), config [ReplaceOwnership.cfg](model-settings/ReplaceOwnership/model/ReplaceOwnership.cfg), map [ReplaceOwnership.map.mjs](model-settings/ReplaceOwnership/model/ReplaceOwnership.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](model-settings/ReplaceOwnership/chart/chart.mmd) / [chart.png](model-settings/ReplaceOwnership/chart/chart.png)
- Stories: [stories.md](model-settings/ReplaceOwnership/chart/stories.md); counts: [summary.json](model-settings/ReplaceOwnership/chart/summary.json)
- TLC logs: [ReplaceOwnership-LeaveOwnsView.out](model-settings/ReplaceOwnership/chart/tlc/ReplaceOwnership-LeaveOwnsView.out), [ReplaceOwnership-TypeOK.out](model-settings/ReplaceOwnership/chart/tlc/ReplaceOwnership-TypeOK.out), [ReplaceOwnership.out](model-settings/ReplaceOwnership/chart/tlc/ReplaceOwnership.out)
- From summary.json: 10 model states, 10 transitions, 9 chart states, 8 chart transitions, 0 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: One nonempty apply, one start-over navigation and one deferred rescan. Success/failure of IPC is opaque. Navigation invalidates presentation ownership but does not cancel a started backend write. Rescan failure, overlapping multiple writes, unmount and restart are read-only/out-of-model.

### Model TemplateSwitch

- Source: [TemplateSwitch.tla](model-settings/TemplateSwitch/model/TemplateSwitch.tla), config [TemplateSwitch.cfg](model-settings/TemplateSwitch/model/TemplateSwitch.cfg), map [TemplateSwitch.map.mjs](model-settings/TemplateSwitch/model/TemplateSwitch.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](model-settings/TemplateSwitch/chart/chart.mmd) / [chart.png](model-settings/TemplateSwitch/chart/chart.png)
- Stories: [stories.md](model-settings/TemplateSwitch/chart/stories.md); counts: [summary.json](model-settings/TemplateSwitch/chart/summary.json)
- TLC logs: [TemplateSwitch-DriftGate.out](model-settings/TemplateSwitch/chart/tlc/TemplateSwitch-DriftGate.out), [TemplateSwitch-QuotaGate.out](model-settings/TemplateSwitch/chart/tlc/TemplateSwitch-QuotaGate.out), [TemplateSwitch-TypeOK.out](model-settings/TemplateSwitch/chart/tlc/TemplateSwitch-TypeOK.out), [TemplateSwitch.out](model-settings/TemplateSwitch/chart/tlc/TemplateSwitch.out)
- From summary.json: 52 model states, 54 transitions, 38 chart states, 36 chart transitions, 0 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: One valid scope and one first-hit rule; quota verdict is an opaque finite input. Force is either explicit confirmation or same-scope bottom line. One atomic write with success/failure and aggregate session outcomes; current enabled auto-revert with window due is fixed eligible, then drift prevents restoration. No concurrent native writes, DB failures after file commit, scheduler time progression, multi-rule ordering or live provider probes are explored.

### Model RoleScope

- Source: [RoleScope.tla](model-settings/RoleScope/model/RoleScope.tla), config [RoleScope.cfg](model-settings/RoleScope/model/RoleScope.cfg), map [RoleScope.map.mjs](model-settings/RoleScope/model/RoleScope.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](model-settings/RoleScope/chart/chart.mmd) / [chart.png](model-settings/RoleScope/chart/chart.png)
- Stories: [stories.md](model-settings/RoleScope/chart/stories.md); counts: [summary.json](model-settings/RoleScope/chart/summary.json)
- TLC logs: [RoleScope-GlobalIsolation.out](model-settings/RoleScope/chart/tlc/RoleScope-GlobalIsolation.out), [RoleScope-Precedence.out](model-settings/RoleScope/chart/tlc/RoleScope-Precedence.out), [RoleScope-TypeOK.out](model-settings/RoleScope/chart/tlc/RoleScope-TypeOK.out), [RoleScope.out](model-settings/RoleScope/chart/tlc/RoleScope.out)
- From summary.json: 30 model states, 59 transitions, 16 chart states, 14 chart transitions, 0 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: One global key, one existing project key, role vs named-override tables, global deletion and scope navigation. Project starts configured and is not deleted in this bound. Alias recursion, agent discovery and full override > declaration > task > session precedence are source-read-only, not fully verified by this per-layer model.

### Model ModelCapability

- Source: [ModelCapability.tla](model-settings/ModelCapability/model/ModelCapability.tla), config [ModelCapability.cfg](model-settings/ModelCapability/model/ModelCapability.cfg), map [ModelCapability.map.mjs](model-settings/ModelCapability/model/ModelCapability.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](model-settings/ModelCapability/chart/chart.mmd) / [chart.png](model-settings/ModelCapability/chart/chart.png)
- Stories: [stories.md](model-settings/ModelCapability/chart/stories.md); counts: [summary.json](model-settings/ModelCapability/chart/summary.json)
- TLC logs: [ModelCapability-KindIsolation.out](model-settings/ModelCapability/chart/tlc/ModelCapability-KindIsolation.out), [ModelCapability-SupportedThinking.out](model-settings/ModelCapability/chart/tlc/ModelCapability-SupportedThinking.out), [ModelCapability-TypeOK.out](model-settings/ModelCapability/chart/tlc/ModelCapability-TypeOK.out), [ModelCapability.out](model-settings/ModelCapability/chart/tlc/ModelCapability.out)
- From summary.json: 7 model states, 14 transitions, 7 chart states, 6 chart transitions, 0 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: Two chat targets with disjoint supported thinking levels, one search target and one row override. Model-default is a separate no-suffix value. Other model kinds, arbitrary catalogs, capability discovery, generic role suffix syntax and provider API compatibility are source-read-only/opaque.

### verificationLimitations

- No build, lint, formatter, full test suites, real provider probes or config writes were run.
- Parent reported baseline TS7053 in AgentModelAssignmentsPanel.test.tsx; no source fix or full typecheck rerun was performed.
- Native Tauri/SQLite/filesystem and live session/provider behavior is code-grounded boundary evidence only.

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `node "$STATECHART_SCRIPT" from-spec TemplateSnapshot.tla --config TemplateSnapshot.cfg --map TemplateSnapshot.map.mjs --out "$AUDIT_OUT/snapshot-out" --title "模板列表保存与迟到读取" --png --expect-broken MutationSurvives` | 0 | Expected MutationSurvives counterexample; TypeOK holds. |
| `node "$STATECHART_SCRIPT" from-spec ReplaceLifecycle.tla --config ReplaceLifecycle.cfg --map ReplaceLifecycle.map.mjs --out "$AUDIT_OUT/replace-out" --title "批量替换与保护性撤销" --png --cover` | 0 | All configured finite-model invariants hold; see summary and retained TLC logs. |
| `node "$STATECHART_SCRIPT" from-spec ReplaceOwnership.tla --config ReplaceOwnership.cfg --map ReplaceOwnership.map.mjs --out "$AUDIT_OUT/ownership-out" --title "离开替换流程后的迟到结果" --png --cover` | 0 | All configured finite-model invariants hold; see summary and retained TLC logs. |
| `node "$STATECHART_SCRIPT" from-spec TemplateSwitch.tla --config TemplateSwitch.cfg --map TemplateSwitch.map.mjs --out "$AUDIT_OUT/switch-out" --title "模板额度切换与恢复" --png --cover` | 0 | All configured finite-model invariants hold; see summary and retained TLC logs. |
| `node "$STATECHART_SCRIPT" from-spec RoleScope.tla --config RoleScope.cfg --map RoleScope.map.mjs --out "$AUDIT_OUT/scope-out" --title "模型角色与点名覆盖范围" --png --cover` | 0 | All configured finite-model invariants hold; see summary and retained TLC logs. |
| `node "$STATECHART_SCRIPT" from-spec ModelCapability.tla --config ModelCapability.cfg --map ModelCapability.map.mjs --out "$AUDIT_OUT/capability-out" --title "替换目标的类型与思考能力约束" --png --cover` | 0 | All configured finite-model invariants hold; see summary and retained TLC logs. |
| `OMP_REPO=<repo> node replay.mjs` | 0 | 1 focused replay passed; 4 assertions on actual production store state/subscriptions; forced-read control passed. See replay.log and replay-result.json. |
| `uncitedConditions over all six .tla files` | 0 | Zero unmatched source-guard conditions in citation-check.json. |

Slice narrative: [model-settings/RESULT.md](model-settings/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [citation-check.json](model-settings/evidence/citation-check.json)
- [replay-result.json](model-settings/evidence/replay-result.json)
- [replay.log](model-settings/evidence/replay.log)
- [replay.mjs](model-settings/evidence/replay.mjs)
- [replay.test.ts](model-settings/evidence/replay.test.ts)

## privacy-providers: 隐私保护与供应商凭据生命周期

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| extension/omp-workspace-privacy.ts | omp-workspace-privacy.ts | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src-tauri/src/privacy/classify.rs | classify.rs | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src-tauri/src/privacy/commands.rs | commands.rs | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src-tauri/src/privacy/files.rs | files.rs | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src-tauri/src/privacy/mod.rs | mod.rs | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src-tauri/src/privacy/store.rs | store.rs | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src-tauri/src/providers/commands.rs | commands.rs | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src-tauri/src/providers/config_yml.rs | config_yml.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/key_ref.rs | key_ref.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/migration.rs | migration.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/mod.rs | mod.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/models_yml_providers.rs | models_yml_providers.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/models_yml_write.rs | models_yml_write.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/oauth.rs | oauth.rs | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src-tauri/src/providers/omp_config.rs | omp_config.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/ops.rs | ops.rs | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src-tauri/src/providers/presets.rs | presets.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/rows.rs | rows.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/providers/vault.rs | vault.rs | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src-tauri/src/rpc/privacy_ext.rs | privacy_ext.rs | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src/features/chat/privacy/ComposerSecretOverlay.tsx | ComposerSecretOverlay.tsx | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/chat/privacy/LibraryPromptCard.tsx | LibraryPromptCard.tsx | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/chat/privacy/MarkSecretPopover.tsx | MarkSecretPopover.tsx | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src/features/chat/privacy/composerClipboard.ts | composerClipboard.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/chat/privacy/composerPrivacy.test.ts | composerPrivacy.test.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/chat/privacy/composerPrivacy.ts | composerPrivacy.ts | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/chat/privacy/useComposerPrivacy.ts | useComposerPrivacy.ts | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/privacy/SecretChip.tsx | SecretChip.tsx | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/privacy/render.test.ts | render.test.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/privacy/render.ts | render.ts | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/providers/KeyModeRadio.tsx | KeyModeRadio.tsx | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src/features/providers/ModelPickerModal.tsx | ModelPickerModal.tsx | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/providers/OauthLoginDialog.test.tsx | OauthLoginDialog.test.tsx | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/OauthLoginDialog.tsx | OauthLoginDialog.tsx | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src/features/providers/ProviderDialog.tsx | ProviderDialog.tsx | modeled | 有限抽象覆盖标记范围、原生同步、密钥持久化或登录生命周期；不等于全文件验证。 |
| src/features/providers/ProviderGroup.tsx | ProviderGroup.tsx | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/ProviderPanel.test.tsx | ProviderPanel.test.tsx | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/ProviderPanel.tsx | ProviderPanel.tsx | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/providers/ProviderRowView.tsx | ProviderRowView.tsx | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/SetKeyDialog.tsx | SetKeyDialog.tsx | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/providers/contextWindowOnSave.ts | contextWindowOnSave.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/envImport.ts | envImport.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/envparse.test.ts | envparse.test.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/envparse.ts | envparse.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/httpWarning.test.ts | httpWarning.test.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/httpWarning.ts | httpWarning.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/keyState.ts | keyState.ts | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/providers/modelEntry.test.ts | modelEntry.test.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/modelEntry.ts | modelEntry.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/presets.ts | presets.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/providerGroups.ts | providerGroups.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/providers/store.ts | store.ts | read-only | 已读取对应逻辑；展示、分类、发现或组合输入行为未独立形式化。 |
| src/features/settings/sections/PrivacySection.tsx | PrivacySection.tsx | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/settings/sections/ProviderBrandLogo.tsx | ProviderBrandLogo.tsx | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/features/settings/sections/ProvidersSection.tsx | ProvidersSection.tsx | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |
| src/stores/privacy.ts | privacy.ts | out-of-model | 辅助展示/解析/配置/凭据实现或现有测试；未独立建模，不能据此声称已验证。 |

### Model PrivacyScope

- Source: [PrivacyScope.tla](privacy-providers/PrivacyScope/model/PrivacyScope.tla), config [PrivacyScope.cfg](privacy-providers/PrivacyScope/model/PrivacyScope.cfg), map [PrivacyScope.map.mjs](privacy-providers/PrivacyScope/model/PrivacyScope.map.mjs), fixed model [PrivacyScopeFixed.tla](privacy-providers/PrivacyScope/model/PrivacyScopeFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](privacy-providers/PrivacyScope/chart/chart.mmd) / [chart.png](privacy-providers/PrivacyScope/chart/chart.png)
- Bug charts: [bug-1.mmd](privacy-providers/PrivacyScope/chart/bug-1.mmd) / [png](privacy-providers/PrivacyScope/chart/bug-1.png), [bug-2.mmd](privacy-providers/PrivacyScope/chart/bug-2.mmd) / [png](privacy-providers/PrivacyScope/chart/bug-2.png)
- Stories: [stories.md](privacy-providers/PrivacyScope/chart/stories.md); counts: [summary.json](privacy-providers/PrivacyScope/chart/summary.json)
- TLC logs: [PrivacyScope-HistoryReplacedWhenAsked.out](privacy-providers/PrivacyScope/chart/tlc/PrivacyScope-HistoryReplacedWhenAsked.out), [PrivacyScope-TypeOK.out](privacy-providers/PrivacyScope/chart/tlc/PrivacyScope-TypeOK.out), [PrivacyScope.out](privacy-providers/PrivacyScope/chart/tlc/PrivacyScope.out), [fixed/PrivacyScopeFixed-HistoryReplacedWhenAsked.out](privacy-providers/PrivacyScope/chart/tlc/fixed/PrivacyScopeFixed-HistoryReplacedWhenAsked.out), [fixed/PrivacyScopeFixed-TypeOK.out](privacy-providers/PrivacyScope/chart/tlc/fixed/PrivacyScopeFixed-TypeOK.out), [fixed/PrivacyScopeFixed.out](privacy-providers/PrivacyScope/chart/tlc/fixed/PrivacyScopeFixed.out)
- From summary.json: 73 model states, 268 transitions, 54 chart states, 190 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 有限值域、单条目/单供应商/单进程。外部文件写入与授权结果以事件输入；没有真实网络或真实凭据。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| HistoryReplacedWhenAsked | 再次选择替换旧历史仍保留旧范围 | reproduced consumer behavior | 先仅保护后续内容; 再选择同时替换旧历史; 旧消息仍含明文 | Rust store::mark 现有公开测试通过；真实 MarkSecretPopover 与 extension context 重放通过。跨 Rust/extension 的完整原生 IPC 未运行。track=false 分支只重放消费者，未重放 Rust 更新。 | src-tauri/src/privacy/store.rs:170; src-tauri/src/privacy/store.rs:204; replay/privacy.replay.test.tsx | 模型提议清除范围并恢复跟踪；不代表产品已修复。 |

### Model PrivacyNative

- Source: [PrivacyNative.tla](privacy-providers/PrivacyNative/model/PrivacyNative.tla), config [PrivacyNative.cfg](privacy-providers/PrivacyNative/model/PrivacyNative.cfg), map [PrivacyNative.map.mjs](privacy-providers/PrivacyNative/model/PrivacyNative.map.mjs), fixed model [PrivacyNativeFixed.tla](privacy-providers/PrivacyNative/model/PrivacyNativeFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](privacy-providers/PrivacyNative/chart/chart.mmd) / [chart.png](privacy-providers/PrivacyNative/chart/chart.png)
- Bug charts: [bug-1.mmd](privacy-providers/PrivacyNative/chart/bug-1.mmd) / [png](privacy-providers/PrivacyNative/chart/bug-1.png)
- Stories: [stories.md](privacy-providers/PrivacyNative/chart/stories.md); counts: [summary.json](privacy-providers/PrivacyNative/chart/summary.json)
- TLC logs: [PrivacyNative-CompactionHasNativeCoverage.out](privacy-providers/PrivacyNative/chart/tlc/PrivacyNative-CompactionHasNativeCoverage.out), [PrivacyNative-TypeOK.out](privacy-providers/PrivacyNative/chart/tlc/PrivacyNative-TypeOK.out), [PrivacyNative.out](privacy-providers/PrivacyNative/chart/tlc/PrivacyNative.out), [fixed/PrivacyNativeFixed-CompactionHasNativeCoverage.out](privacy-providers/PrivacyNative/chart/tlc/fixed/PrivacyNativeFixed-CompactionHasNativeCoverage.out), [fixed/PrivacyNativeFixed-TypeOK.out](privacy-providers/PrivacyNative/chart/tlc/fixed/PrivacyNativeFixed-TypeOK.out), [fixed/PrivacyNativeFixed.out](privacy-providers/PrivacyNative/chart/tlc/fixed/PrivacyNativeFixed.out)
- From summary.json: 98 model states, 301 transitions, 35 chart states, 119 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: 有限值域、单条目/单供应商/单进程。外部文件写入与授权结果以事件输入；没有真实网络或真实凭据。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| CompactionHasNativeCoverage | 哈希相同不证明进程曾加载隐私块 | trace-and-source-only hypothesis | 启动时隐私块写入失败; 相同内容重写成功; 压缩被放行 | 真实 extension session_before_compact 的哈希判定已重放；未启动实际 OMP 进程验证原生加载。 | src-tauri/src/privacy/mod.rs:120; src-tauri/src/rpc/privacy_ext.rs:39; replay/privacy.replay.test.tsx | 提议使用不可匹配启动标记；仅模型。 |

### Model ProviderKeys

- Source: [ProviderKeys.tla](privacy-providers/ProviderKeys/model/ProviderKeys.tla), config [ProviderKeys.cfg](privacy-providers/ProviderKeys/model/ProviderKeys.cfg), map [ProviderKeys.map.mjs](privacy-providers/ProviderKeys/model/ProviderKeys.map.mjs), fixed model [ProviderKeysFixed.tla](privacy-providers/ProviderKeys/model/ProviderKeysFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](privacy-providers/ProviderKeys/chart/chart.mmd) / [chart.png](privacy-providers/ProviderKeys/chart/chart.png)
- Bug charts: [bug-1.mmd](privacy-providers/ProviderKeys/chart/bug-1.mmd) / [png](privacy-providers/ProviderKeys/chart/bug-1.png), [bug-2.mmd](privacy-providers/ProviderKeys/chart/bug-2.mmd) / [png](privacy-providers/ProviderKeys/chart/bug-2.png)
- Stories: [stories.md](privacy-providers/ProviderKeys/chart/stories.md); counts: [summary.json](privacy-providers/ProviderKeys/chart/summary.json)
- TLC logs: [ProviderKeys-NoOrphanVaultKey.out](privacy-providers/ProviderKeys/chart/tlc/ProviderKeys-NoOrphanVaultKey.out), [ProviderKeys-SavedModeMatchesChoice.out](privacy-providers/ProviderKeys/chart/tlc/ProviderKeys-SavedModeMatchesChoice.out), [ProviderKeys-TypeOK.out](privacy-providers/ProviderKeys/chart/tlc/ProviderKeys-TypeOK.out), [ProviderKeys.out](privacy-providers/ProviderKeys/chart/tlc/ProviderKeys.out), [fixed/ProviderKeysFixed-NoOrphanVaultKey.out](privacy-providers/ProviderKeys/chart/tlc/fixed/ProviderKeysFixed-NoOrphanVaultKey.out), [fixed/ProviderKeysFixed-SavedModeMatchesChoice.out](privacy-providers/ProviderKeys/chart/tlc/fixed/ProviderKeysFixed-SavedModeMatchesChoice.out), [fixed/ProviderKeysFixed-TypeOK.out](privacy-providers/ProviderKeys/chart/tlc/fixed/ProviderKeysFixed-TypeOK.out), [fixed/ProviderKeysFixed.out](privacy-providers/ProviderKeys/chart/tlc/fixed/ProviderKeysFixed.out)
- From summary.json: 128 model states, 432 transitions, 68 chart states, 291 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 有限值域、单条目/单供应商/单进程。外部文件写入与授权结果以事件输入；没有真实网络或真实凭据。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| SavedModeMatchesChoice | 未填写新密钥时保存模式选择未生效 | trace-and-source-only hypothesis | 编辑加密供应商; 选择明文但保持密钥为空; 保存成功但后台保留原模式 | 真实 ProviderDialog 重放显示 key=null、mode=plaintext 且成功关闭；未调用 Rust ops 的完整保存入口。 | src/features/providers/ProviderDialog.tsx:301; src-tauri/src/providers/ops.rs:367; replay/providers.replay.test.tsx | 提议切换已有密钥存储；仅模型。 |
| NoOrphanVaultKey | 配置修改成功而凭据清理失败可留下孤立密钥 | trace-and-source-only hypothesis | 已有加密密钥; 写入明文或删除配置; 凭据清理失败 | 未重放实际 KeyStore 故障；模型与写入顺序证据。 | src-tauri/src/providers/ops.rs:185; src-tauri/src/providers/ops.rs:476 | 当前提议模型不解决该规则。 |

### Model OauthLogin

- Source: [OauthLogin.tla](privacy-providers/OauthLogin/model/OauthLogin.tla), config [OauthLogin.cfg](privacy-providers/OauthLogin/model/OauthLogin.cfg), map [OauthLogin.map.mjs](privacy-providers/OauthLogin/model/OauthLogin.map.mjs), fixed model [OauthLoginFixed.tla](privacy-providers/OauthLogin/model/OauthLoginFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](privacy-providers/OauthLogin/chart/chart.mmd) / [chart.png](privacy-providers/OauthLogin/chart/chart.png)
- Bug charts: [bug-1.mmd](privacy-providers/OauthLogin/chart/bug-1.mmd) / [png](privacy-providers/OauthLogin/chart/bug-1.png), [bug-2.mmd](privacy-providers/OauthLogin/chart/bug-2.mmd) / [png](privacy-providers/OauthLogin/chart/bug-2.png)
- Stories: [stories.md](privacy-providers/OauthLogin/chart/stories.md); counts: [summary.json](privacy-providers/OauthLogin/chart/summary.json)
- TLC logs: [OauthLogin-NoOrphanLogin.out](privacy-providers/OauthLogin/chart/tlc/OauthLogin-NoOrphanLogin.out), [OauthLogin-PanelShowsSavedLogin.out](privacy-providers/OauthLogin/chart/tlc/OauthLogin-PanelShowsSavedLogin.out), [OauthLogin-TypeOK.out](privacy-providers/OauthLogin/chart/tlc/OauthLogin-TypeOK.out), [OauthLogin.out](privacy-providers/OauthLogin/chart/tlc/OauthLogin.out), [fixed/OauthLoginFixed-NoOrphanLogin.out](privacy-providers/OauthLogin/chart/tlc/fixed/OauthLoginFixed-NoOrphanLogin.out), [fixed/OauthLoginFixed-PanelShowsSavedLogin.out](privacy-providers/OauthLogin/chart/tlc/fixed/OauthLoginFixed-PanelShowsSavedLogin.out), [fixed/OauthLoginFixed-TypeOK.out](privacy-providers/OauthLogin/chart/tlc/fixed/OauthLoginFixed-TypeOK.out), [fixed/OauthLoginFixed.out](privacy-providers/OauthLogin/chart/tlc/fixed/OauthLoginFixed.out)
- From summary.json: 323 model states, 970 transitions, 110 chart states, 399 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 有限值域、单条目/单供应商/单进程。外部文件写入与授权结果以事件输入；没有真实网络或真实凭据。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| PanelShowsSavedLogin | 返回列表后的迟到成功事件不会刷新供应商 | reproduced consumer behavior | 打开登录流程; 点上一步; 取消待处理时收到成功; 供应商未刷新 | 真实 OauthLoginDialog 与事件总线边界重放；有效监听控制组刷新一次，返回后监听为零且没有刷新。外部实际凭据保存未运行。 | src/features/providers/OauthLoginDialog.tsx:325; replay/providers.replay.test.tsx | 提议取消完成后刷新；仅部分路径改善，固定模型仍有坏状态。 |
| NoOrphanLogin | 启动未完成就取消可能留下后台登录进程 | trace-and-source-only hypothesis | 开始登录请求在途; 返回列表; 后台先处理取消; 启动后处理 | 真实 UI 重放确认启动未 resolve 时会发送 cancel；未验证原生 IPC 调度能否实现模型中的处理反序。 | src-tauri/src/providers/oauth.rs:488; src/features/providers/OauthLoginDialog.tsx:352; replay/providers.replay.test.tsx | 等待启动完成的提议阻止最短路径；固定模型未消除全部坏状态。 |

### Slice limits

- 未独立形式化：模型发现并发/替换、密钥批量导入、设置页编辑、mask/reveal、library prompt、剪贴板、fork 继承、提供商 migration。覆盖表中明确标注。
- 真实 OMP secrets.yml 启动加载、原生 IPC 调度、浏览器 OAuth、网络模型发现、系统密钥库与加密实现均是未执行的外部边界。
- 只使用合成字符串；未读取实际凭据、登录、联网或修改产品代码。

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `./node_modules/.bin/vitest run --config <slice>/replay/vitest.config.ts` | 0 | 2 files / 7 tests passed; reproduction evidence, not desired-contract acceptance |
| `CARGO_TARGET_DIR=<slice>/replay/cargo-target cargo test --offline --lib future_scope_records_cutoff_once_and_all_never_clears` | 0 | 1 passed; 754 filtered out |
| `uncitedConditions over all eight TLA files` | 0 | all returned [] |

Slice narrative: [privacy-providers/RESULT.md](privacy-providers/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [replay/observed-results.txt](privacy-providers/evidence/replay/observed-results.txt)
- [replay/privacy.replay.test.tsx](privacy-providers/evidence/replay/privacy.replay.test.tsx)
- [replay/providers.replay.test.tsx](privacy-providers/evidence/replay/providers.replay.test.tsx)
- [replay/vitest.config.ts](privacy-providers/evidence/replay/vitest.config.ts)

## automation: 自动化切片状态图审计：定时任务、待办、想法、收件箱、诊断

### Coverage

| Path | Feature | Status | Reason |
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

### Model ScheduleRuns

- Source: [ScheduleRuns.tla](automation/ScheduleRuns/model/ScheduleRuns.tla), config [ScheduleRuns.cfg](automation/ScheduleRuns/model/ScheduleRuns.cfg), map [ScheduleRuns.map.mjs](automation/ScheduleRuns/model/ScheduleRuns.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](automation/ScheduleRuns/chart/chart.mmd) / [chart.png](automation/ScheduleRuns/chart/chart.png)
- Bug charts: [bug-1.mmd](automation/ScheduleRuns/chart/bug-1.mmd) / [png](automation/ScheduleRuns/chart/bug-1.png), [bug-2.mmd](automation/ScheduleRuns/chart/bug-2.mmd) / [png](automation/ScheduleRuns/chart/bug-2.png), [bug-3.mmd](automation/ScheduleRuns/chart/bug-3.mmd) / [png](automation/ScheduleRuns/chart/bug-3.png), [bug-4.mmd](automation/ScheduleRuns/chart/bug-4.mmd) / [png](automation/ScheduleRuns/chart/bug-4.png)
- Stories: [stories.md](automation/ScheduleRuns/chart/stories.md); counts: [summary.json](automation/ScheduleRuns/chart/summary.json)
- TLC logs: [ScheduleRuns-ActiveRunsAtMostOne.out](automation/ScheduleRuns/chart/tlc/ScheduleRuns-ActiveRunsAtMostOne.out), [ScheduleRuns-CompletedNeverScheduled.out](automation/ScheduleRuns/chart/tlc/ScheduleRuns-CompletedNeverScheduled.out), [ScheduleRuns-DisabledNoFireTime.out](automation/ScheduleRuns/chart/tlc/ScheduleRuns-DisabledNoFireTime.out), [ScheduleRuns-EnabledHasFireTime.out](automation/ScheduleRuns/chart/tlc/ScheduleRuns-EnabledHasFireTime.out), [ScheduleRuns-NoRunAfterDelete.out](automation/ScheduleRuns/chart/tlc/ScheduleRuns-NoRunAfterDelete.out), [ScheduleRuns-RunsWithinCap.out](automation/ScheduleRuns/chart/tlc/ScheduleRuns-RunsWithinCap.out), [ScheduleRuns-TypeOK.out](automation/ScheduleRuns/chart/tlc/ScheduleRuns-TypeOK.out), [ScheduleRuns.out](automation/ScheduleRuns/chart/tlc/ScheduleRuns.out)
- From summary.json: 927 model states, 3490 transitions, 19 chart states, 21 chart transitions, 4 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 次数以饱和值3截断；once 不建模 end_at；用两个令牌（定时器、手动）表示并发，未验证真实线程交错；上游 OMP 运行状态是外部输入；--cover 绘图

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| CompletedNeverScheduled | 已完成的一次性任务被改期后列表仍显示已完成，但调度器会再次触发 | reproduced consumer behavior | 手动运行一次性任务→完成→保存新的未来时间 | replay-rs/tests/replay.rs::repro_rescheduled_once_listed_completed_but_will_fire（真实 schedules/store.rs 的 upsert/list/find_due，内存库）；该测试断言缺陷存在，通过=复现成功，不是验收失败 | store.rs:216-236,459-499；ScheduleRow.tsx:254；out/schedule-runs/bug-*.png | 未建模修复 |
| RunsWithinCap | 手动运行可使已运行次数超过 max_runs | design question | 设次数上限2，手动运行3次 | replay-rs/tests/replay.rs::observe_manual_runs_exceed_max_runs 观察到 runs_done=3>max_runs=2；产品语义未明：手动强制运行可能有意绕过自动节奏上限，故不判为缺陷 | runner.rs:74-85；store.rs:663-675 | 未建模修复 |
| ActiveRunsAtMostOne | 定时器与手动运行在检查与创建之间可并发产生两个运行 | trace-and-source-only hypothesis | 定时器检查无活动运行→手动检查→两边创建 | 未通过公开入口证明真实并发；仅有模型轨迹与源码（has_active_run 与 create_run 之间释放锁） | runner.rs:43-131；store.rs:787 | 未建模修复 |
| NoRunAfterDelete | 任务被删除后已认领的运行仍写入 | trace-and-source-only hypothesis | 认领后删除任务 | 未回放；FK 级联可能使写入被忽略，影响未验证 | runner.rs:120-148；db.rs:615-623 | 未建模修复 |

### Model TodoReview

- Source: [TodoReview.tla](automation/TodoReview/model/TodoReview.tla), config [TodoReview.cfg](automation/TodoReview/model/TodoReview.cfg), map [TodoReview.map.mjs](automation/TodoReview/model/TodoReview.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](automation/TodoReview/chart/chart.mmd) / [chart.png](automation/TodoReview/chart/chart.png)
- Stories: [stories.md](automation/TodoReview/chart/stories.md); counts: [summary.json](automation/TodoReview/chart/summary.json)
- TLC logs: [TodoReview-AcceptedNotPending.out](automation/TodoReview/chart/tlc/TodoReview-AcceptedNotPending.out), [TodoReview-ReviewNeverMissed.out](automation/TodoReview/chart/tlc/TodoReview-ReviewNeverMissed.out), [TodoReview-ReviewOpenMatchesSession.out](automation/TodoReview/chart/tlc/TodoReview-ReviewOpenMatchesSession.out), [TodoReview-TypeOK.out](automation/TodoReview/chart/tlc/TodoReview-TypeOK.out), [TodoReview.out](automation/TodoReview/chart/tlc/TodoReview.out)
- From summary.json: 39 model states, 136 transitions, 11 chart states, 27 chart transitions, 0 bug class(es), 0 broken propert(ies).
- Limits: 仅待办的处理动作；会话状态由 runtime 切片拥有

### Model TodoRequest

- Source: [TodoRequest.tla](automation/TodoRequest/model/TodoRequest.tla), config [TodoRequest.cfg](automation/TodoRequest/model/TodoRequest.cfg), map [TodoRequest.map.mjs](automation/TodoRequest/model/TodoRequest.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](automation/TodoRequest/chart/chart.mmd) / [chart.png](automation/TodoRequest/chart/chart.png)
- Stories: [stories.md](automation/TodoRequest/chart/stories.md); counts: [summary.json](automation/TodoRequest/chart/summary.json)
- TLC logs: [TodoRequest-RequestNeverMissed.out](automation/TodoRequest/chart/tlc/TodoRequest-RequestNeverMissed.out), [TodoRequest-TypeOK.out](automation/TodoRequest/chart/tlc/TodoRequest-TypeOK.out), [TodoRequest-UiOpenMatchesRequest.out](automation/TodoRequest/chart/tlc/TodoRequest-UiOpenMatchesRequest.out), [TodoRequest.out](automation/TodoRequest/chart/tlc/TodoRequest.out)
- From summary.json: 43 model states, 179 transitions, 12 chart states, 34 chart transitions, 0 bug class(es), 0 broken propert(ies).
- Limits: 仅审批/提问待办的检测与解决；不模拟上游 OMP 协议

### Model IdeaLifecycle

- Source: [IdeaLifecycle.tla](automation/IdeaLifecycle/model/IdeaLifecycle.tla), config [IdeaLifecycle.cfg](automation/IdeaLifecycle/model/IdeaLifecycle.cfg), map [IdeaLifecycle.map.mjs](automation/IdeaLifecycle/model/IdeaLifecycle.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](automation/IdeaLifecycle/chart/chart.mmd) / [chart.png](automation/IdeaLifecycle/chart/chart.png)
- Bug charts: [bug-1.mmd](automation/IdeaLifecycle/chart/bug-1.mmd) / [png](automation/IdeaLifecycle/chart/bug-1.png), [bug-2.mmd](automation/IdeaLifecycle/chart/bug-2.mmd) / [png](automation/IdeaLifecycle/chart/bug-2.png)
- Stories: [stories.md](automation/IdeaLifecycle/chart/stories.md); counts: [summary.json](automation/IdeaLifecycle/chart/summary.json)
- TLC logs: [IdeaLifecycle-DeliveredIsRecorded.out](automation/IdeaLifecycle/chart/tlc/IdeaLifecycle-DeliveredIsRecorded.out), [IdeaLifecycle-RestoredStaysRestored.out](automation/IdeaLifecycle/chart/tlc/IdeaLifecycle-RestoredStaysRestored.out), [IdeaLifecycle-TypeOK.out](automation/IdeaLifecycle/chart/tlc/IdeaLifecycle-TypeOK.out), [IdeaLifecycle.out](automation/IdeaLifecycle/chart/tlc/IdeaLifecycle.out)
- From summary.json: 192 model states, 756 transitions, 9 chart states, 9 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 时间用布尔“超过30天/7天”抽象；图片、快捷键、真实 IPC 失败未建模

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| DeliveredIsRecorded | 放入输入框发送成功但记录已派发失败时被静默吞掉，想法仍显示待处理 | trace-and-source-only hypothesis | 放入输入框并发送→状态写入失败 | 未回放（需 IPC 失败注入）；源码显示失败被吞 | fillComposer.ts:74-79；DispatchDialog.tsx:66,92-93 | 未建模修复 |
| RestoredStaysRestored | 已结束想法从回收站恢复后，下次启动又被自动移回回收站 | reproduced consumer behavior | 完成想法，40天前修改→删除→恢复→启动清理 | replay-rs/tests/replay.rs::repro_restored_finished_idea_is_trashed_again_on_next_start（真实 backlog/store.rs delete/restore/archive_finished）；断言缺陷存在 | backlog/store.rs:210-229；backlog/mod.rs:24 | 未建模修复 |

### Model InboxVisibility

- Source: [InboxVisibility.tla](automation/InboxVisibility/model/InboxVisibility.tla), config [InboxVisibility.cfg](automation/InboxVisibility/model/InboxVisibility.cfg), map [InboxVisibility.map.mjs](automation/InboxVisibility/model/InboxVisibility.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](automation/InboxVisibility/chart/chart.mmd) / [chart.png](automation/InboxVisibility/chart/chart.png)
- Bug charts: [bug-1.mmd](automation/InboxVisibility/chart/bug-1.mmd) / [png](automation/InboxVisibility/chart/bug-1.png), [bug-2.mmd](automation/InboxVisibility/chart/bug-2.mmd) / [png](automation/InboxVisibility/chart/bug-2.png), [bug-3.mmd](automation/InboxVisibility/chart/bug-3.mmd) / [png](automation/InboxVisibility/chart/bug-3.png)
- Stories: [stories.md](automation/InboxVisibility/chart/stories.md); counts: [summary.json](automation/InboxVisibility/chart/summary.json)
- TLC logs: [InboxVisibility-ImportantOnlyWhenNeeded.out](automation/InboxVisibility/chart/tlc/InboxVisibility-ImportantOnlyWhenNeeded.out), [InboxVisibility-NoneMeansNothingInInbox.out](automation/InboxVisibility/chart/tlc/InboxVisibility-NoneMeansNothingInInbox.out), [InboxVisibility-OneEntryPerRun.out](automation/InboxVisibility/chart/tlc/InboxVisibility-OneEntryPerRun.out), [InboxVisibility-TypeOK.out](automation/InboxVisibility/chart/tlc/InboxVisibility-TypeOK.out), [InboxVisibility.out](automation/InboxVisibility/chart/tlc/InboxVisibility.out)
- From summary.json: 54 model states, 61 transitions, 10 chart states, 7 chart transitions, 3 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 通知策略与收件箱条目；系统通知（原生）未触发；会话关注度来自 runtime

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| NoneMeansNothingInInbox | 通知策略“不放入收件箱”仍有会话条目 | design question | 策略 none，运行中等待审批 | 仅模型与源码；策略可能只管结果待办，产品语义未明 | schedules/runner.rs；catalog/status.rs:293-319；inbox/attention.ts | 未建模修复 |
| ImportantOnlyWhenNeeded | “仅重要时提醒”下顺利完成的运行仍有会话条目 | design question | 同上 | 同上 | 同上 | 未建模修复 |
| OneEntryPerRun | 同一运行同时出现会话条目与结果待办 | design question | 策略 all，运行失败 | 同上 | 同上 | 未建模修复 |

### Model DiagnoseDialog

- Source: [DiagnoseDialog.tla](automation/DiagnoseDialog/model/DiagnoseDialog.tla), config [DiagnoseDialog.cfg](automation/DiagnoseDialog/model/DiagnoseDialog.cfg), map [DiagnoseDialog.map.mjs](automation/DiagnoseDialog/model/DiagnoseDialog.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](automation/DiagnoseDialog/chart/chart.mmd) / [chart.png](automation/DiagnoseDialog/chart/chart.png)
- Bug charts: [bug-1.mmd](automation/DiagnoseDialog/chart/bug-1.mmd) / [png](automation/DiagnoseDialog/chart/bug-1.png), [bug-2.mmd](automation/DiagnoseDialog/chart/bug-2.mmd) / [png](automation/DiagnoseDialog/chart/bug-2.png)
- Stories: [stories.md](automation/DiagnoseDialog/chart/stories.md); counts: [summary.json](automation/DiagnoseDialog/chart/summary.json)
- TLC logs: [DiagnoseDialog-SentAtMostOnce.out](automation/DiagnoseDialog/chart/tlc/DiagnoseDialog-SentAtMostOnce.out), [DiagnoseDialog-TypeOK.out](automation/DiagnoseDialog/chart/tlc/DiagnoseDialog-TypeOK.out), [DiagnoseDialog-UserWorkPreserved.out](automation/DiagnoseDialog/chart/tlc/DiagnoseDialog-UserWorkPreserved.out), [DiagnoseDialog.out](automation/DiagnoseDialog/chart/tlc/DiagnoseDialog.out)
- From summary.json: 118 model states, 206 transitions, 10 chart states, 9 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: React effect 重跑以会话列表刷新抽象；未在浏览器渲染

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| UserWorkPreserved | 会话列表刷新重置诊断对话框里用户已改的提示词与选择 | trace-and-source-only hypothesis | 打开对话框→修改→后台列表刷新 | unverified：未渲染组件；源码 effect 依赖 sessions（DiagnoseDialog.tsx:68-83） | DiagnoseDialog.tsx:59,68-83 | 未建模修复 |
| SentAtMostOnce | 刷新把发送中状态清零，可重复发送诊断 | trace-and-source-only hypothesis | 点击发送→列表刷新→再次点击 | unverified：未渲染组件 | DiagnoseDialog.tsx:73,384-388 | 未建模修复 |

### Model AiDoctor

- Source: [AiDoctor.tla](automation/AiDoctor/model/AiDoctor.tla), config [AiDoctor.cfg](automation/AiDoctor/model/AiDoctor.cfg), map [AiDoctor.map.mjs](automation/AiDoctor/model/AiDoctor.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](automation/AiDoctor/chart/chart.mmd) / [chart.png](automation/AiDoctor/chart/chart.png)
- Bug charts: [bug-1.mmd](automation/AiDoctor/chart/bug-1.mmd) / [png](automation/AiDoctor/chart/bug-1.png), [bug-2.mmd](automation/AiDoctor/chart/bug-2.mmd) / [png](automation/AiDoctor/chart/bug-2.png)
- Stories: [stories.md](automation/AiDoctor/chart/stories.md); counts: [summary.json](automation/AiDoctor/chart/summary.json)
- TLC logs: [AiDoctor-FailedNotRetried.out](automation/AiDoctor/chart/tlc/AiDoctor-FailedNotRetried.out), [AiDoctor-NoStarvation.out](automation/AiDoctor/chart/tlc/AiDoctor-NoStarvation.out), [AiDoctor-TypeOK.out](automation/AiDoctor/chart/tlc/AiDoctor-TypeOK.out), [AiDoctor.out](automation/AiDoctor/chart/tlc/AiDoctor.out)
- From summary.json: 37 model states, 40 transitions, 37 chart states, 40 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 两个会话 A/B，空闲模式；不含定时模式

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| FailedNotRetried | 自动诊断失败的会话每分钟被重试 | reproduced consumer behavior | 空闲模式下会话A诊断失败 | replay-ts/aiDoctor.test.ts 驱动真实 useDoctorAutoScheduler（假定时器5分钟内尝试A共6次）；断言缺陷存在 | doctorStore.ts:139,192,210-219 | 未建模修复 |
| NoStarvation | 失败较新会话的重复重试可持续阻挡较旧会话（有界观察与条件性推论） | reproduced consumer behavior | 空闲模式，较新A持续失败；另有较旧B；没有新活动或用户干预 | 实测仅限5分钟：6次尝试均为A，B在观察窗口内未出现。不是无穷饥饿证明。源码排序和失败不写 diagnosedAt 支持条件性推论：若A持续失败、配置及候选顺序不变，后续tick仍优先A。TLA以2会话、tries饱和到3抽象检查状态不变量，未添加公平性或检查时序活性属性。 | doctorStore.ts:185-199,218-219 | 未建模修复 |

### Additional observations (not model invariants; classification is per item)

- **prompts::render 对用户文本中的模板记号再次展开，结果依赖变量遍历顺序，非确定**; kind: reproduced consumer behavior; file: src-tauri/src/prompts.rs; reproduction: replay-rs/tests/replay.rs::repro_render_reexpands_tokens_inside_user_text_nondeterministically：同一输入 300 次出现已展开与未展开两种结果（断言两者都出现）; note: 想法正文含 {{refs}} 时提示词内容不稳定

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `cd replay-rs && cargo test --offline` | 0 | 10 单元测试 + 4 回放测试通过（回放测试断言缺陷存在，属复现证据） |
| `vitest run --config replay-ts/vitest.config.ts（在仓库根）` | 0 | 1 通过；5分钟观察内失败会话A重试6次，B未被选中；未证明无穷饥饿 |
| `uncitedConditions(*.tla)` | 0 | 7 个模型均为空数组（IdeaLifecycle 已补充两处引用后复查为空） |
| `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec ScheduleRuns.tla --cover --png --out ../out/schedule-runs --expect-broken ActiveRunsAtMostOne,CompletedNeverScheduled,RunsWithinCap,NoRunAfterDelete` | 0 | 927 模型状态，19 图状态：正常19，违规15，混合1，之后0 |
| `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec TodoReview.tla --png --out ../out/todo-review` | 0 | 39 模型状态，11 图状态：正常11，违规0，混合0，之后0 |
| `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec TodoRequest.tla --png --out ../out/todo-request` | 0 | 43 模型状态，12 图状态：正常12，违规0，混合0，之后0 |
| `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec IdeaLifecycle.tla --cover --png --out ../out/idea-lifecycle --expect-broken DeliveredIsRecorded,RestoredStaysRestored` | 0 | 192 模型状态，9 图状态：正常40，违规14，混合1，之后0 |
| `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec InboxVisibility.tla --cover --png --out ../out/inbox-visibility --expect-broken NoneMeansNothingInInbox,ImportantOnlyWhenNeeded,OneEntryPerRun` | 0 | 54 模型状态，10 图状态：正常5，违规4，混合0，之后1 |
| `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec DiagnoseDialog.tla --cover --png --out ../out/diagnose-dialog --expect-broken UserWorkPreserved,SentAtMostOnce` | 0 | 118 模型状态，10 图状态：正常14，违规33，混合1，之后0 |
| `TLA2TOOLS=<TLA2TOOLS> JAVA=<JAVA> node <HOME>/.agents/skills/statechart/scripts/statechart.mjs from-spec AiDoctor.tla --png --out ../out/ai-doctor --expect-broken FailedNotRetried,NoStarvation` | 0 | 37 模型状态，37 图状态：正常7，违规30，混合0，之后0 |
| `functions.read each generated PNG` | 0 | 已打开并审阅全部20张PNG：中文状态及动作标签、bug路径从1开始连续编号。TodoReview/TodoRequest标签去除检测开关和对账瞬态后降为11/12图状态；IdeaLifecycle、DiagnoseDialog、InboxVisibility改用cover。完整状态/边省略清单在summary.json和stories.md；总览不是完整可达图。大图需原图缩放。图例为工具固定英文。 |
| `node <scratch>/publication/publish.mjs check <scratch> --repo <repo> --skill <HOME>/.agents/skills/statechart --slices automation` | 0 | 0 failure(s), 0 waived, 0 warning(s); 7 model(s) planned |

Slice narrative: [automation/RESULT.md](automation/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [replay-rs/Cargo.lock](automation/evidence/replay-rs/Cargo.lock)
- [replay-rs/Cargo.toml](automation/evidence/replay-rs/Cargo.toml)
- [replay-rs/src/lib.rs](automation/evidence/replay-rs/src/lib.rs)
- [replay-rs/tests/replay.rs](automation/evidence/replay-rs/tests/replay.rs)
- [replay-ts/aiDoctor.test.ts](automation/evidence/replay-ts/aiDoctor.test.ts)
- [replay-ts/vitest.config.ts](automation/evidence/replay-ts/vitest.config.ts)

## terminal-services: 终端、后台服务与文件缓存状态审计

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| src-tauri/src/terminal/commands.rs | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src-tauri/src/terminal/pty.rs | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src-tauri/src/terminal/shell_init.rs | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src-tauri/src/terminal/mod.rs | 环境、扩展、主题和既有测试 | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| src-tauri/src/terminal/extension.rs | 环境、扩展、主题和既有测试 | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| src-tauri/src/terminal/env.rs | 环境、扩展、主题和既有测试 | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| src-tauri/src/services/commands.rs | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src-tauri/src/services/perf.rs | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src-tauri/src/services/clipboard.rs | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src-tauri/src/services/files.rs | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src-tauri/src/services/trash.rs | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src-tauri/src/services/mod.rs | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src-tauri/src/services/scan.rs | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src/features/terminal/CommandTerminalPanel.tsx | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src/features/terminal/drawerRegistry.ts | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src/features/terminal/drawerStore.ts | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src/features/terminal/terminalTabs.ts | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src/features/terminal/terminalTheme.ts | 环境、扩展、主题和既有测试 | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| src/features/terminal/terminalTheme.test.ts | 环境、扩展、主题和既有测试 | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| src/features/terminal/drawerStore.test.ts | 环境、扩展、主题和既有测试 | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| src/features/services/ServicesPanel.tsx | 终端/会话/服务列表/文件缓存生命周期 | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| src/components/BottomBar.tsx | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src/features/chat/Composer.tsx | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src-tauri/src/catalog/mod.rs | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src-tauri/src/lib.rs | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| src/lib/ipc.ts | 边界追踪及只读辅助操作 | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |

### Model DrawerTerminal

- Source: [DrawerTerminal.tla](terminal-services/DrawerTerminal/model/DrawerTerminal.tla), config [DrawerTerminal.cfg](terminal-services/DrawerTerminal/model/DrawerTerminal.cfg), map [DrawerTerminal.map.mjs](terminal-services/DrawerTerminal/model/DrawerTerminal.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](terminal-services/DrawerTerminal/chart/chart.mmd) / [chart.png](terminal-services/DrawerTerminal/chart/chart.png)
- Bug charts: [bug-1.mmd](terminal-services/DrawerTerminal/chart/bug-1.mmd) / [png](terminal-services/DrawerTerminal/chart/bug-1.png), [bug-2.mmd](terminal-services/DrawerTerminal/chart/bug-2.mmd) / [png](terminal-services/DrawerTerminal/chart/bug-2.png), [bug-3.mmd](terminal-services/DrawerTerminal/chart/bug-3.mmd) / [png](terminal-services/DrawerTerminal/chart/bug-3.png)
- Stories: [stories.md](terminal-services/DrawerTerminal/chart/stories.md); counts: [summary.json](terminal-services/DrawerTerminal/chart/summary.json)
- TLC logs: [DrawerTerminal-ExitedMeansNotAlive.out](terminal-services/DrawerTerminal/chart/tlc/DrawerTerminal-ExitedMeansNotAlive.out), [DrawerTerminal-NoLeakAfterClose.out](terminal-services/DrawerTerminal/chart/tlc/DrawerTerminal-NoLeakAfterClose.out), [DrawerTerminal-OpeningMakesProgress.out](terminal-services/DrawerTerminal/chart/tlc/DrawerTerminal-OpeningMakesProgress.out), [DrawerTerminal-OutputNotLost.out.gz](terminal-services/DrawerTerminal/chart/tlc/DrawerTerminal-OutputNotLost.out.gz), [DrawerTerminal-ReadyMeansAlive.out](terminal-services/DrawerTerminal/chart/tlc/DrawerTerminal-ReadyMeansAlive.out), [DrawerTerminal-TypeOK.out](terminal-services/DrawerTerminal/chart/tlc/DrawerTerminal-TypeOK.out), [DrawerTerminal.out](terminal-services/DrawerTerminal/chart/tlc/DrawerTerminal.out)
- From summary.json: 1058 model states, 5828 transitions, 67 chart states, 66 chart transitions, 3 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 单标签、至多一代在途启动、至多三代进程；事件交错通过 I/O 替身重放，未证明原生事件传输实际排序。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| ReadyMeansAlive | 启动响应前退出事件被消费，响应后标签持续显示运行中 | reproduced consumer behavior | 打开终端; 进程退出通知先到达; 启动请求才返回; 所有通知处理完毕，标签仍运行中 | 真实组件重放通过；只证明给定事件顺序下的消费者行为，不证明原生传输必然发生该顺序 | replay/drawer-terminal.replay.test.tsx:126-143; logs/replay-js.log; src/features/terminal/drawerRegistry.ts:58-63; src/features/terminal/CommandTerminalPanel.tsx:248-259 | 未建修复模型；产品未修改 |
| OpeningMakesProgress | 启动失败后重试不触发新启动 | reproduced consumer behavior | 打开终端失败; 点击重试; 显示连接中但没有新启动请求 | 真实组件重放通过；观察窗口300毫秒，依赖未变化由源码补充证明 | replay/drawer-terminal.replay.test.tsx:162-178; logs/replay-js.log; src/features/terminal/CommandTerminalPanel.tsx:275-316 | 未建修复模型；产品未修改 |
| OutputNotLost | 启动响应前的数据被桥丢弃 | reproduced consumer behavior | 打开终端; 响应前第一段数据到达; 响应返回; 后续数据可写入但第一段未出现 | 真实组件和注册表重放通过；画布 write 为输出边界替身，原生事件顺序未验证 | replay/drawer-terminal.replay.test.tsx:145-160; logs/replay-js.log; src/features/terminal/drawerRegistry.ts:47-54 | 未建修复模型；产品未修改 |

### Model SessionTerminal

- Source: [SessionTerminal.tla](terminal-services/SessionTerminal/model/SessionTerminal.tla), config [SessionTerminal.cfg](terminal-services/SessionTerminal/model/SessionTerminal.cfg), map [SessionTerminal.map.mjs](terminal-services/SessionTerminal/model/SessionTerminal.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](terminal-services/SessionTerminal/chart/chart.mmd) / [chart.png](terminal-services/SessionTerminal/chart/chart.png)
- Bug charts: [bug-1.mmd](terminal-services/SessionTerminal/chart/bug-1.mmd) / [png](terminal-services/SessionTerminal/chart/bug-1.png), [bug-2.mmd](terminal-services/SessionTerminal/chart/bug-2.mmd) / [png](terminal-services/SessionTerminal/chart/bug-2.png)
- Stories: [stories.md](terminal-services/SessionTerminal/chart/stories.md); counts: [summary.json](terminal-services/SessionTerminal/chart/summary.json)
- TLC logs: [SessionTerminal-DeletedSessionHasNoTerminal.out](terminal-services/SessionTerminal/chart/tlc/SessionTerminal-DeletedSessionHasNoTerminal.out), [SessionTerminal-RecordMeansAlive.out](terminal-services/SessionTerminal/chart/tlc/SessionTerminal-RecordMeansAlive.out), [SessionTerminal-TypeOK.out](terminal-services/SessionTerminal/chart/tlc/SessionTerminal-TypeOK.out), [SessionTerminal.out](terminal-services/SessionTerminal/chart/tlc/SessionTerminal.out)
- From summary.json: 12 model states, 22 transitions, 12 chart states, 22 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 单会话与单个开启操作；原生会话删除/开启竞态未实际重放。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| RecordMeansAlive | 退出发生在会话登记之前可留下已死终端登记 | trace-and-source-only hypothesis | 打开会话终端; 进程退出，移除尚不存在的登记; 开启操作随后写入登记 | 未原生重放；需要可控 PTY 与会话命令调度，不算确认缺陷 | out/session-terminal/stories.md; src-tauri/src/terminal/commands.rs:56-57; src-tauri/src/terminal/commands.rs:216-218 | 未建修复模型；产品未修改 |
| DeletedSessionHasNoTerminal | 会话删除与终端登记交错可遗留进程 | trace-and-source-only hypothesis | 开始打开会话终端; 登记前删除会话; 开启操作继续写入登记 | 未原生重放；不算确认缺陷 | out/session-terminal/stories.md; src-tauri/src/catalog/mod.rs:635-672; src-tauri/src/terminal/commands.rs:29-32; src-tauri/src/terminal/commands.rs:216-218 | 未建修复模型；产品未修改 |

### Model ServicesPanelPoll

- Source: [ServicesPanelPoll.tla](terminal-services/ServicesPanelPoll/model/ServicesPanelPoll.tla), config [ServicesPanelPoll.cfg](terminal-services/ServicesPanelPoll/model/ServicesPanelPoll.cfg), map [ServicesPanelPoll.map.mjs](terminal-services/ServicesPanelPoll/model/ServicesPanelPoll.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](terminal-services/ServicesPanelPoll/chart/chart.mmd) / [chart.png](terminal-services/ServicesPanelPoll/chart/chart.png)
- Bug charts: [bug-1.mmd](terminal-services/ServicesPanelPoll/chart/bug-1.mmd) / [png](terminal-services/ServicesPanelPoll/chart/bug-1.png)
- Stories: [stories.md](terminal-services/ServicesPanelPoll/chart/stories.md); counts: [summary.json](terminal-services/ServicesPanelPoll/chart/summary.json)
- TLC logs: [ServicesPanelPoll-RowsMatchToggle.out](terminal-services/ServicesPanelPoll/chart/tlc/ServicesPanelPoll-RowsMatchToggle.out), [ServicesPanelPoll-TypeOK.out](terminal-services/ServicesPanelPoll/chart/tlc/ServicesPanelPoll-TypeOK.out), [ServicesPanelPoll.out](terminal-services/ServicesPanelPoll/chart/tlc/ServicesPanelPoll.out)
- From summary.json: 23 model states, 35 transitions, 14 chart states, 29 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: 至多两次切换、三个在途请求和一次变更事件；未实际组件重放。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| RowsMatchToggle | 较早请求晚返回覆盖当前开关列表 | trace-and-source-only hypothesis | 切换到全部; 切回仅开发服务; 新请求先完成; 旧请求最后完成 | 模型和源码证据；未真实组件重放，不算确认缺陷 | out/services-poll/stories.md; src/features/services/ServicesPanel.tsx:48-67 | 未建修复模型；产品未修改 |

### Model FileWriteRace

- Source: [FileWriteRace.tla](terminal-services/FileWriteRace/model/FileWriteRace.tla), config [FileWriteRace.cfg](terminal-services/FileWriteRace/model/FileWriteRace.cfg), map [FileWriteRace.map.mjs](terminal-services/FileWriteRace/model/FileWriteRace.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](terminal-services/FileWriteRace/chart/chart.mmd) / [chart.png](terminal-services/FileWriteRace/chart/chart.png)
- Bug charts: [bug-1.mmd](terminal-services/FileWriteRace/chart/bug-1.mmd) / [png](terminal-services/FileWriteRace/chart/bug-1.png), [bug-2.mmd](terminal-services/FileWriteRace/chart/bug-2.mmd) / [png](terminal-services/FileWriteRace/chart/bug-2.png)
- Stories: [stories.md](terminal-services/FileWriteRace/chart/stories.md); counts: [summary.json](terminal-services/FileWriteRace/chart/summary.json)
- TLC logs: [FileWriteRace-FailedSaveDidNotLand.out](terminal-services/FileWriteRace/chart/tlc/FileWriteRace-FailedSaveDidNotLand.out), [FileWriteRace-SuccessIsWhatLanded.out](terminal-services/FileWriteRace/chart/tlc/FileWriteRace-SuccessIsWhatLanded.out), [FileWriteRace-TypeOK.out](terminal-services/FileWriteRace/chart/tlc/FileWriteRace-TypeOK.out), [FileWriteRace.out](terminal-services/FileWriteRace/chart/tlc/FileWriteRace.out)
- From summary.json: 19 model states, 18 transitions, 16 chart states, 18 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 两次同路径写入；字节写入原子化，真实写入可能有更多交错；仅重放真实文件函数而非完整 IPC。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| SuccessIsWhatLanded | 成功保存的内容可能不是最后落盘内容，即使另一次保存报错 | reproduced consumer behavior | 两个写入共用进程号临时文件; 后一次写入覆盖临时内容; 第一次替换成功; 第二次替换报错但其内容已落盘 | 真实 files::write_text 并发重放300轮：297轮有失败，292轮成功调用与落盘内容不一致且失败调用内容落盘；完整 IPC/UI 未重放 | replay/rust/src/main.rs; logs/replay-rust.log; src-tauri/src/services/files.rs:85-93 | 未建修复模型；产品未修改 |
| FailedSaveDidNotLand | 报错的保存仍可能覆盖文件 | reproduced consumer behavior | 两个写入共用进程号临时文件; 后一次写入覆盖临时内容; 第一次替换成功; 第二次替换报错但其内容已落盘 | 真实 files::write_text 并发重放300轮：297轮有失败，292轮成功调用与落盘内容不一致且失败调用内容落盘；完整 IPC/UI 未重放 | replay/rust/src/main.rs; logs/replay-rust.log; src-tauri/src/services/files.rs:85-93 | 未建修复模型；产品未修改 |

### Model ClipboardNameCollision

- Source: [ClipboardNameCollision.tla](terminal-services/ClipboardNameCollision/model/ClipboardNameCollision.tla), config [ClipboardNameCollision.cfg](terminal-services/ClipboardNameCollision/model/ClipboardNameCollision.cfg), map [ClipboardNameCollision.map.mjs](terminal-services/ClipboardNameCollision/model/ClipboardNameCollision.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](terminal-services/ClipboardNameCollision/chart/chart.mmd) / [chart.png](terminal-services/ClipboardNameCollision/chart/chart.png)
- Bug charts: [bug-1.mmd](terminal-services/ClipboardNameCollision/chart/bug-1.mmd) / [png](terminal-services/ClipboardNameCollision/chart/bug-1.png)
- Stories: [stories.md](terminal-services/ClipboardNameCollision/chart/stories.md); counts: [summary.json](terminal-services/ClipboardNameCollision/chart/summary.json)
- TLC logs: [ClipboardNameCollision-EachAttachmentKeepsItsBytes.out](terminal-services/ClipboardNameCollision/chart/tlc/ClipboardNameCollision-EachAttachmentKeepsItsBytes.out), [ClipboardNameCollision-TypeOK.out](terminal-services/ClipboardNameCollision/chart/tlc/ClipboardNameCollision-TypeOK.out), [ClipboardNameCollision.out](terminal-services/ClipboardNameCollision/chart/tlc/ClipboardNameCollision.out)
- From summary.json: 9 model states, 8 transitions, 9 chart states, 8 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: 两个同名文件；毫秒碰撞作为外部输入；真实函数重放而非剪贴板 GUI。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| EachAttachmentKeepsItsBytes | 同毫秒同名缓存文件覆盖早先附件字节 | reproduced consumer behavior | 保存第一个同名附件; 同毫秒保存第二个附件; 两次返回同路径，第一份字节被替换 | 真实 save_clipboard_file_internal 连续2000对保存：1834对同路径且首份字节被替换；Tauri宏/未触及缓存路径解析是边界替身，GUI未重放 | replay/rust/src/main.rs; logs/replay-rust.log; src-tauri/src/services/clipboard.rs:228-231 | 未建修复模型；产品未修改 |

### modelLimits

- 未运行原生 PTY、操作系统剪贴板、真实浏览器/桌面操作。
- ServicesPanel 和 SessionTerminal 未真实入口重放，其发现为假设而非确认缺陷。
- 所有生成图均已目视检查；抽屉总览使用 --cover，省略991个具体模型状态；混合分组详情保留 summary.json。
- NoLeakAfterClose和ExitedMeansNotAlive仅在有限模型内未破坏，非全产品证明。
- 未修复产品，未运行全项目构建/测试。

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `./regenerate.sh (TLA2TOOLS/JAVA 环境已指定)` | 0 | 五个模型各自退出0；预期破坏规则单独登记，TypeOK未作为预期失败 |
| `node logs/uncited.mjs` | 0 | 五个模型未引用条件均为空；最后仅补充源码注释，未改变模型语义 |
| `./node_modules/.bin/vitest run --config <scratch>/terminal-services/replay/vitest.config.mts --root .` | 0 | 1文件4测试通过；复现证据而非产品验收 |
| `cargo run --offline --release (replay/rust)` | 0 | 真实文件函数与剪贴板保存函数复现，详见 logs/replay-rust.log |

Slice narrative: [terminal-services/RESULT.md](terminal-services/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [logs/clipboard-name.log](terminal-services/evidence/logs/clipboard-name.log)
- [logs/drawer-terminal.log](terminal-services/evidence/logs/drawer-terminal.log)
- [logs/file-write-race.log](terminal-services/evidence/logs/file-write-race.log)
- [logs/regenerate.log](terminal-services/evidence/logs/regenerate.log)
- [logs/replay-js.log](terminal-services/evidence/logs/replay-js.log)
- [logs/replay-rust.log](terminal-services/evidence/logs/replay-rust.log)
- [logs/services-poll.log](terminal-services/evidence/logs/services-poll.log)
- [logs/session-terminal.log](terminal-services/evidence/logs/session-terminal.log)
- [logs/uncited.log](terminal-services/evidence/logs/uncited.log)
- [logs/uncited.mjs](terminal-services/evidence/logs/uncited.mjs)
- [replay/drawer-terminal.replay.test.tsx](terminal-services/evidence/replay/drawer-terminal.replay.test.tsx)
- [replay/rust/Cargo.lock](terminal-services/evidence/replay/rust/Cargo.lock)
- [replay/rust/Cargo.toml](terminal-services/evidence/replay/rust/Cargo.toml)
- [replay/rust/src/main.rs](terminal-services/evidence/replay/rust/src/main.rs)
- [replay/rust/stub_macros/Cargo.toml](terminal-services/evidence/replay/rust/stub_macros/Cargo.toml)
- [replay/rust/stub_macros/src/lib.rs](terminal-services/evidence/replay/rust/stub_macros/src/lib.rs)
- [replay/rust/stub_tauri/Cargo.toml](terminal-services/evidence/replay/rust/stub_tauri/Cargo.toml)
- [replay/rust/stub_tauri/src/lib.rs](terminal-services/evidence/replay/rust/stub_tauri/src/lib.rs)
- [replay/vitest.config.mts](terminal-services/evidence/replay/vitest.config.mts)

## shell: Shell/导航/本地草稿/空间/启动 状态图审计

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| src/App.tsx | 桌面外壳:中心视图选择/侧栏拖拽/启动恢复/错误边界 | modeled | 启动恢复(StartupRestore)、中心区草稿优先级(CenterPane)、侧栏挂载(SpaceFollow);拖拽宽度为单步 UI 状态,读码 |
| src/main.tsx | 启动:主题/会话事件/根错误边界 | read-only | RootErrorBoundary 只有 出错→重载 单向;初次加载失败 hasLoaded 保持 false(sessions.ts:336-337) 读码确认,无独立状态机 |
| src/stores/ui.ts | centerView/selectedSessionId/设置浮层/右栏记忆 | modeled | DraftHandoff、SpaceFollow、StartupRestore 引用其 selectSession/openSettings/closeSettings/leaveSession/toggleSidebar |
| src/features/sessions/pendingSession.ts | 本地草稿创建/预热/移交/清理 | modeled | DraftHandoff 与 CenterPane |
| src/features/sessions/draftSession.ts | 本地草稿创建/预热/移交/清理 | modeled | DraftHandoff 与 CenterPane |
| src/features/sessions/newSession.ts | 本地草稿创建/预热/移交/清理 | modeled | DraftHandoff 与 CenterPane |
| src/features/sessions/forkDraft.ts | 分支草稿 | modeled | CenterPane;其 visible 判定含设置浮层,作为 DraftHandoff 修复参照 |
| src/features/sessions/SessionSidebar.tsx | 空间(mode)隔离与跟随 | modeled | SpaceFollow |
| src/features/sessions/switchMode.ts | 空间(mode)隔离与跟随 | modeled | SpaceFollow |
| src/features/sessions/sidebarStore.ts | 空间(mode)隔离与跟随 | modeled | SpaceFollow |
| src/features/sessions/modes.ts | 空间(mode)隔离与跟随 | modeled | SpaceFollow |
| src/features/sessions/search/openSearchRow.ts | 空间(mode)隔离与跟随 | modeled | SpaceFollow |
| src/features/sessions/SessionRow.tsx | 会话行/对话框/归档撤销/分组纯函数 | read-only | 选择入口已通过 grep 枚举(selectSession 55 处调用);归档撤销与会话生命周期由 runtime/git-files 切片拥有 |
| src/features/sessions/SessionDialogs.tsx | 会话行/对话框/归档撤销/分组纯函数 | read-only | 选择入口已通过 grep 枚举(selectSession 55 处调用);归档撤销与会话生命周期由 runtime/git-files 切片拥有 |
| src/features/sessions/ResumeMissingCwdDialog.tsx | 会话行/对话框/归档撤销/分组纯函数 | read-only | 选择入口已通过 grep 枚举(selectSession 55 处调用);归档撤销与会话生命周期由 runtime/git-files 切片拥有 |
| src/features/sessions/archiveUndo.ts | 会话行/对话框/归档撤销/分组纯函数 | read-only | 选择入口已通过 grep 枚举(selectSession 55 处调用);归档撤销与会话生命周期由 runtime/git-files 切片拥有 |
| src/features/sessions/sessionActions.ts | 会话行/对话框/归档撤销/分组纯函数 | read-only | 选择入口已通过 grep 枚举(selectSession 55 处调用);归档撤销与会话生命周期由 runtime/git-files 切片拥有 |
| src/features/sessions/grouping.ts | 会话行/对话框/归档撤销/分组纯函数 | read-only | 选择入口已通过 grep 枚举(selectSession 55 处调用);归档撤销与会话生命周期由 runtime/git-files 切片拥有 |
| src/features/shortcuts/** | 键盘分发/绑定 | read-only | dispatcher.ts 按 设置浮层/模态层 门控(dispatcher.ts:99-109);无跨步骤状态,读码审计,未发现违反;不做键盘 GUI 自动化 |
| src/lib/nativeShortcuts.ts | Esc 认领/Cmd+W 层关闭/焦点陷阱 | read-only | 认领协议与嵌套层判断读码一致,未生成模型;实际焦点需主线 GUI 验证 |
| src/lib/escapeClaim.ts | Esc 认领/Cmd+W 层关闭/焦点陷阱 | read-only | 认领协议与嵌套层判断读码一致,未生成模型;实际焦点需主线 GUI 验证 |
| src/features/settings/SettingsOverlay.tsx | Esc 认领/Cmd+W 层关闭/焦点陷阱 | read-only | 认领协议与嵌套层判断读码一致,未生成模型;实际焦点需主线 GUI 验证 |
| src/features/settings/nestedModal.ts | Esc 认领/Cmd+W 层关闭/焦点陷阱 | read-only | 认领协议与嵌套层判断读码一致,未生成模型;实际焦点需主线 GUI 验证 |
| src/features/home/** | 起始页/指南 | read-only | 静态展示,无独立生命周期 |
| guide/** | 起始页/指南 | read-only | 静态展示,无独立生命周期 |
| src/components/** | Modal/FloatingLayer/Toaster/CenterHeader/RightAside/Markdown 等 | read-only | 模型化子集:无;Markdown 文件链接点击仅做真实入口复现(F5,见 implementationFindings),其余组件读码。Markdown 文件链接点击缺少 openFileLink 导入(F5,代码缺陷,非状态机);其余组件为受控展示 |
| src/stores/{displayPrefs,language,privacy,explorer,filePreview,locate,turnNav,worktrees,live,composer,sessions}.ts | 全局偏好/导航/显示 store | read-only | sessions.ts 加载状态(loading→error/ready)读码;live/composer 归 runtime/composer 切片 |
| src/lib/** (非功能专属) | ipc/contracts/theme/zoom/format 等 | read-only | 纯函数或 IPC 封装;loadState.ts 三态已读 |
| src-tauri/src/{lib,main,state,db,paths,contracts,ime,local_rows}.rs | Rust 装配/状态/数据库 | read-only | 仅清点,契约:前端 invoke 名称与 list_sessions/list_workspaces 假定;未做 Rust 状态机 |
| docs/** | 文档/站点/构建发布 | out-of-model | 静态页与 CI 工作流,无应用内状态机;不声称验证 |
| site/** | 文档/站点/构建发布 | out-of-model | 静态页与 CI 工作流,无应用内状态机;不声称验证 |
| .github/workflows/release.yml | 文档/站点/构建发布 | out-of-model | 静态页与 CI 工作流,无应用内状态机;不声称验证 |
| scripts/dev.mjs | 文档/站点/构建发布 | out-of-model | 静态页与 CI 工作流,无应用内状态机;不声称验证 |

### Model SpaceFollow

- Source: [SpaceFollow.tla](shell/SpaceFollow/model/SpaceFollow.tla), config [SpaceFollow.cfg](shell/SpaceFollow/model/SpaceFollow.cfg), map [SpaceFollow.map.mjs](shell/SpaceFollow/model/SpaceFollow.map.mjs), fixed model [SpaceFollowFixed.tla](shell/SpaceFollow/model/SpaceFollowFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](shell/SpaceFollow/chart/chart.mmd) / [chart.png](shell/SpaceFollow/chart/chart.png)
- Bug charts: [bug-1.mmd](shell/SpaceFollow/chart/bug-1.mmd) / [png](shell/SpaceFollow/chart/bug-1.png)
- Stories: [stories.md](shell/SpaceFollow/chart/stories.md); counts: [summary.json](shell/SpaceFollow/chart/summary.json)
- TLC logs: [SpaceFollow-SpaceMatchesSelection.out](shell/SpaceFollow/chart/tlc/SpaceFollow-SpaceMatchesSelection.out), [SpaceFollow-TypeOK.out](shell/SpaceFollow/chart/tlc/SpaceFollow-TypeOK.out), [SpaceFollow.out](shell/SpaceFollow/chart/tlc/SpaceFollow.out), [fixed/SpaceFollowFixed-SpaceMatchesSelection.out](shell/SpaceFollow/chart/tlc/fixed/SpaceFollowFixed-SpaceMatchesSelection.out), [fixed/SpaceFollowFixed-TypeOK.out](shell/SpaceFollow/chart/tlc/fixed/SpaceFollowFixed-TypeOK.out), [fixed/SpaceFollowFixed.out](shell/SpaceFollow/chart/tlc/fixed/SpaceFollowFixed.out)
- From summary.json: 28 model states, 78 transitions, 12 chart states, 38 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: modelStates=28 modelTransitions=78 chartStates=12 chartTransitions=38; fixed model keeps rule: works=8 fixed=4 wrong=0

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| SpaceMatchesSelection | 侧栏收起时打开其他空间的会话,重新展开后空间不跟随 | reproduced consumer behavior | Cmd+B 收起 → 收件箱等入口选其他空间会话(2 步,图 bug-1) | reproduced | replay/app-shell.test.tsx F2: 渲染真实 App;收起后 selectSession('b'),重开后 activeMode=code,行 b 未渲染; 对照(侧栏开)跟随成功 | fixed model holds |

### Model DraftHandoff

- Source: [DraftHandoff.tla](shell/DraftHandoff/model/DraftHandoff.tla), config [DraftHandoff.cfg](shell/DraftHandoff/model/DraftHandoff.cfg), map [DraftHandoff.map.mjs](shell/DraftHandoff/model/DraftHandoff.map.mjs), fixed model [DraftHandoffFixed.tla](shell/DraftHandoff/model/DraftHandoffFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](shell/DraftHandoff/chart/chart.mmd) / [chart.png](shell/DraftHandoff/chart/chart.png)
- Bug charts: [bug-1.mmd](shell/DraftHandoff/chart/bug-1.mmd) / [png](shell/DraftHandoff/chart/bug-1.png)
- Stories: [stories.md](shell/DraftHandoff/chart/stories.md); counts: [summary.json](shell/DraftHandoff/chart/summary.json)
- TLC logs: [DraftHandoff-SendShowsSession.out](shell/DraftHandoff/chart/tlc/DraftHandoff-SendShowsSession.out), [DraftHandoff-TypeOK.out](shell/DraftHandoff/chart/tlc/DraftHandoff-TypeOK.out), [DraftHandoff.out](shell/DraftHandoff/chart/tlc/DraftHandoff.out), [fixed/DraftHandoffFixed-SendShowsSession.out](shell/DraftHandoff/chart/tlc/fixed/DraftHandoffFixed-SendShowsSession.out), [fixed/DraftHandoffFixed-TypeOK.out](shell/DraftHandoff/chart/tlc/fixed/DraftHandoffFixed-TypeOK.out), [fixed/DraftHandoffFixed.out](shell/DraftHandoff/chart/tlc/fixed/DraftHandoffFixed.out)
- From summary.json: 19 model states, 28 transitions, 12 chart states, 19 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: modelStates=19 modelTransitions=28 chartStates=12 chartTransitions=19; fixed model keeps rule: works=10 fixed=2 wrong=0

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| SendShowsSession | 首条消息发送期间打开设置,完成后落到空白起始页而非新会话 | reproduced consumer behavior | 回车发送 → 打开设置 → 启动完成(3 步) | reproduced | replay/handoff-settings.test.ts: sendFromDraft 进行中 openSettings,完成后 closeSettings,selectedSessionId=null;对照 forkDraft 同时序成功 | fixed model holds |

### Model CenterPane

- Source: [CenterPane.tla](shell/CenterPane/model/CenterPane.tla), config [CenterPane.cfg](shell/CenterPane/model/CenterPane.cfg), map [CenterPane.map.mjs](shell/CenterPane/model/CenterPane.map.mjs), fixed model [CenterPaneFixed.tla](shell/CenterPane/model/CenterPaneFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](shell/CenterPane/chart/chart.mmd) / [chart.png](shell/CenterPane/chart/chart.png)
- Bug charts: [bug-1.mmd](shell/CenterPane/chart/bug-1.mmd) / [png](shell/CenterPane/chart/bug-1.png)
- Stories: [stories.md](shell/CenterPane/chart/stories.md); counts: [summary.json](shell/CenterPane/chart/summary.json)
- TLC logs: [CenterPane-NewSessionVisible.out](shell/CenterPane/chart/tlc/CenterPane-NewSessionVisible.out), [CenterPane-TypeOK.out](shell/CenterPane/chart/tlc/CenterPane-TypeOK.out), [CenterPane.out](shell/CenterPane/chart/tlc/CenterPane.out), [fixed/CenterPaneFixed-NewSessionVisible.out](shell/CenterPane/chart/tlc/fixed/CenterPaneFixed-NewSessionVisible.out), [fixed/CenterPaneFixed-TypeOK.out](shell/CenterPane/chart/tlc/fixed/CenterPaneFixed-TypeOK.out), [fixed/CenterPaneFixed.out](shell/CenterPane/chart/tlc/fixed/CenterPaneFixed.out)
- From summary.json: 8 model states, 22 transitions, 8 chart states, 24 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: modelStates=8 modelTransitions=22 chartStates=8 chartTransitions=24; fixed model keeps rule: works=7 fixed=1 wrong=0

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| NewSessionVisible | 分支草稿开着时新建会话,中间区仍显示分支草稿 | reproduced consumer behavior | 在运行会话点分支 → Cmd+N(2 步) | reproduced | replay/app-shell.test.tsx F4: 渲染真实 App;可见 composer=fork-draft:…,而 pending 选中=local-draft:4 | fixed model holds |

### Model StartupRestore

- Source: [StartupRestore.tla](shell/StartupRestore/model/StartupRestore.tla), config [StartupRestore.cfg](shell/StartupRestore/model/StartupRestore.cfg), map [StartupRestore.map.mjs](shell/StartupRestore/model/StartupRestore.map.mjs), fixed model [StartupRestoreFixed.tla](shell/StartupRestore/model/StartupRestoreFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](shell/StartupRestore/chart/chart.mmd) / [chart.png](shell/StartupRestore/chart/chart.png)
- Bug charts: [bug-1.mmd](shell/StartupRestore/chart/bug-1.mmd) / [png](shell/StartupRestore/chart/bug-1.png)
- Stories: [stories.md](shell/StartupRestore/chart/stories.md); counts: [summary.json](shell/StartupRestore/chart/summary.json)
- TLC logs: [StartupRestore-RestoreKeepsUserPage.out](shell/StartupRestore/chart/tlc/StartupRestore-RestoreKeepsUserPage.out), [StartupRestore-TypeOK.out](shell/StartupRestore/chart/tlc/StartupRestore-TypeOK.out), [StartupRestore.out](shell/StartupRestore/chart/tlc/StartupRestore.out), [fixed/StartupRestoreFixed-RestoreKeepsUserPage.out](shell/StartupRestore/chart/tlc/fixed/StartupRestoreFixed-RestoreKeepsUserPage.out), [fixed/StartupRestoreFixed-TypeOK.out](shell/StartupRestore/chart/tlc/fixed/StartupRestoreFixed-TypeOK.out), [fixed/StartupRestoreFixed.out](shell/StartupRestore/chart/tlc/fixed/StartupRestoreFixed.out)
- From summary.json: 20 model states, 24 transitions, 14 chart states, 18 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: modelStates=20 modelTransitions=24 chartStates=14 chartTransitions=18; fixed model keeps rule: works=10 fixed=4 wrong=0

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| RestoreKeepsUserPage | 会话列表加载期间打开设置/收件箱,启动恢复抢走页面 | reproduced consumer behavior | 加载中打开页面 → 列表加载成功 → 恢复(3 步) | reproduced (设置页+上次会话在当前空间分支); 另一分支(上次会话不在当前空间→回首页)仅读码/模型 unverified | replay/app-shell.test.tsx F3: 设置打开后加载完成,centerView=session,selected=a | fixed model holds |

### Additional observations (not model invariants; classification is per item)

- **Markdown 文件链接点击抛 ReferenceError: openFileLink is not defined**; rule: (非状态机); model: —; steps: 点击 file:// 或相对路径链接; reproduction: reproduced; evidence: replay/markdown-link.test.tsx 两例均 toast「打开链接失败: openFileLink is not defined」且预览页签 0;主线整套 Vitest fileLinkClick.test.tsx 6 例同因失败; sourceCitations: components/Markdown.tsx:295,299,340,515 使用但未导入(stores/filePreview.ts:176 导出); fixModelStatus: n/a(类型诊断同源); kind: reproduced consumer behavior

### Slice limits

- GUI/键盘焦点/原生运行时未实测(产品 UI 未改动,审计不声称 GUI 证明)
- Rust 文件与 docs/site/workflows 仅清点
- StartupRestore 另一分支未复现

### replayNote

- replay 断言期望的正确行为,失败即为复现证据,不是验收失败;模型修复只说明模型,产品未修复

### Guard-citation proof

- `node models/cite-check.mjs models/*/*.tla` exit 0: 8 个 .tla(4 模型+4 修复模型)uncited=0

### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `statechart.mjs from-spec (x4, see regenerate.sh) with TLA2TOOLS/JAVA` | 0 | 4 个规则按预期被破坏,4 个修复模型均通过 |
| `node models/cite-check.mjs models/*/*.tla (lib.mjs uncitedConditions)` | 0 | 8 个 .tla 全部 uncited=0 |
| `node_modules/.bin/vitest run --config replay/vitest.config.ts` | 1 | 8 例: 2 通过(2 个对照)、6 失败(F1×1、F2×1、F3×1、F4×1、F5×2)= 全部为复现断言失败; 日志 replay/replay.log |
| `node models/cite-check.mjs models/*/*.tla` | 0 | 8 个 .tla(4 模型+4 修复模型)uncited=0 |

Slice narrative: [shell/RESULT.md](shell/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [replay/app-shell.test.tsx](shell/evidence/replay/app-shell.test.tsx)
- [replay/handoff-settings.test.ts](shell/evidence/replay/handoff-settings.test.ts)
- [replay/markdown-link.test.tsx](shell/evidence/replay/markdown-link.test.tsx)
- [replay/replay.log](shell/evidence/replay/replay.log)
- [replay/vitest.config.ts](shell/evidence/replay/vitest.config.ts)

## settings-skills: 设置、技能、插件、MCP、安装/更新状态图审计

### Coverage

| Path | Feature | Status | Reason |
|---|---|---|---|
| src/features/settings/FileEditor.tsx | 共享文件编辑器 | modeled | FileEditorBuffer；与 git-files 的通用缓冲区只在边界上接触 |
| src/features/settings/fileEditorLogic.ts | 共享文件编辑器 | modeled | FileEditorBuffer；与 git-files 的通用缓冲区只在边界上接触 |
| src/features/settings/sections/RulesFilesSection.tsx | 规则文件编辑入口 | read-only | 经 FileEditor 复用；读了入口使用，未单独建模 |
| src/features/settings/sections/rulesFiles.ts | 规则文件编辑入口 | read-only | 经 FileEditor 复用；读了入口使用，未单独建模 |
| src/features/settings/sections/MemoryFilesPanel.tsx | 记忆文件列表/选择/编辑 | modeled | MemoryFilesLoad；删除技能时编辑草稿处理仅读码 |
| src/features/settings/sections/memoryFiles.ts | 记忆文件列表/选择/编辑 | modeled | MemoryFilesLoad；删除技能时编辑草稿处理仅读码 |
| src/features/settings/sections/AgentDefsPanel.tsx | 子代理定义文件编辑/创建 | out-of-model | 未读完，创建流程未审；仅通过 FileEditor 共享边界覆盖 |
| src/features/settings/sections/NewAgentForm.tsx | 子代理定义文件编辑/创建 | out-of-model | 未读完，创建流程未审；仅通过 FileEditor 共享边界覆盖 |
| src/features/settings/sections/agentDefs.ts | 子代理定义文件编辑/创建 | out-of-model | 未读完，创建流程未审；仅通过 FileEditor 共享边界覆盖 |
| src/features/settings/McpSection.tsx | MCP 目录/启停/删除/作用域/导入 | modeled | EditorVisibleWhenOpen 由父组件归属生命周期模型覆盖；SingleWriter 由独立 McpWriteOwnership 保留原规则并发现反例，重复编辑入口已重放。 |
| src/features/settings/McpServerRow.tsx | MCP 目录/启停/删除/作用域/导入 | modeled | [modeled (partial)] McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/McpServerEditor.tsx | MCP 目录/启停/删除/作用域/导入 | modeled | [modeled (partial)] McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/McpImportDialog.tsx | MCP 目录/启停/删除/作用域/导入 | modeled | [modeled (partial)] McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/McpScopeDialog.tsx | MCP 目录/启停/删除/作用域/导入 | modeled | [modeled (partial)] McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/McpScopePicker.tsx | MCP 目录/启停/删除/作用域/导入 | modeled | [modeled (partial)] McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/mcpDraft.ts | MCP 目录/启停/删除/作用域/导入 | modeled | [modeled (partial)] McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/mcpImport.ts | MCP 目录/启停/删除/作用域/导入 | modeled | [modeled (partial)] McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/mcpProjects.ts | MCP 目录/启停/删除/作用域/导入 | modeled | [modeled (partial)] McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/PluginsSection.tsx | 插件目录/启停/扩展 | modeled | [modeled (partial)] PluginsCatalogLoad、OmpListReadModifyWrite；plugin 开关与扩展删除读码，未建模 |
| src/features/settings/sections/PluginsSettingsSection.tsx | 插件目录/启停/扩展 | modeled | [modeled (partial)] PluginsCatalogLoad、OmpListReadModifyWrite；plugin 开关与扩展删除读码，未建模 |
| src/features/skills/store.ts | 技能目录/启停/扩展启用 | modeled | [modeled (partial)] OmpListReadModifyWrite、ExtensionEnableRollback；loadCatalog/revalidateCatalog 序号保护读码确认；SkillsPage.tsx 未读 |
| src/features/skills/SkillsPage.tsx | 技能目录/启停/扩展启用 | modeled | [modeled (partial)] OmpListReadModifyWrite、ExtensionEnableRollback；loadCatalog/revalidateCatalog 序号保护读码确认；SkillsPage.tsx 未读 |
| src/features/omp-install/OmpInstallDialog.tsx | 安装内核与取消 | modeled | OmpInstallCancel；未安装、未启动进程 |
| src/stores/ompInstall.ts | 安装内核与取消 | modeled | OmpInstallCancel；未安装、未启动进程 |
| src-tauri/src/omp_install.rs | 安装内核与取消 | modeled | OmpInstallCancel；未安装、未启动进程 |
| src/stores/ompUpdate.ts | omp 更新检查/执行 | modeled | [modeled (partial)] OmpUpdateCheck |
| src/stores/appUpdate.ts | 应用自动更新/会话陈旧同步/定时 | out-of-model | 未建模；ompUpdateSessions 仅读到 ompUpdate.ts 的外部更新回调边界 |
| src/stores/ompUpdateSessions.ts | 应用自动更新/会话陈旧同步/定时 | out-of-model | 未建模；ompUpdateSessions 仅读到 ompUpdate.ts 的外部更新回调边界 |
| src/stores/ompUpdateSchedule.ts | 应用自动更新/会话陈旧同步/定时 | out-of-model | 未建模；ompUpdateSessions 仅读到 ompUpdate.ts 的外部更新回调边界 |
| src/stores/promptComposition.ts | 提示词组成探测 | out-of-model | 未读；归本 slice，需后续补审 |
| src/features/settings/sections/PromptCompositionSection.tsx | 提示词组成探测 | out-of-model | 未读；归本 slice，需后续补审 |
| src-tauri/src/prompt_composition.rs | 提示词组成探测 | out-of-model | 未读；归本 slice，需后续补审 |
| src/stores/modelCatalog.ts | 模型目录刷新 | read-only | [read-only boundary] 仅作为 ompInstall/ompUpdate 触发的 refresh 调用，所有权按 ModelSettings 交接 |
| src/features/settings/store.ts | 应用设置乐观更新与保存队列 | read-only | 读码：update() 使用 lastConfirmed 重基与 saveQueue；未发现已确认问题，未建模，未重放 |
| src/features/settings/useAppSettings.ts | 应用设置乐观更新与保存队列 | read-only | 读码：update() 使用 lastConfirmed 重基与 saveQueue；未发现已确认问题，未建模，未重放 |
| src/features/settings/ompConfigStore.ts | omp 配置目录 store 与列表 | read-only | ompConfigStore 的 generation/inflight 保护读码确认；RawFilesDialog 写后 load(true) 复用同代在途请求的可能性仅读码 [INFERENCE]，未建模 |
| src/features/settings/OmpSettingsList.tsx | omp 配置目录 store 与列表 | read-only | ompConfigStore 的 generation/inflight 保护读码确认；RawFilesDialog 写后 load(true) 复用同代在途请求的可能性仅读码 [INFERENCE]，未建模 |
| src/features/settings/sections/RawFilesDialog.tsx | omp 配置目录 store 与列表 | read-only | ompConfigStore 的 generation/inflight 保护读码确认；RawFilesDialog 写后 load(true) 复用同代在途请求的可能性仅读码 [INFERENCE]，未建模 |
| src/features/settings/SettingsOverlay.tsx | 设置页壳与导航 | out-of-model | 归 ShellNavigation 边界；仅读 SettingsOverlay |
| src/features/settings/SettingsPage.tsx | 设置页壳与导航 | out-of-model | 归 ShellNavigation 边界；仅读 SettingsOverlay |
| src/features/settings/settingsNav.ts | 设置页壳与导航 | out-of-model | 归 ShellNavigation 边界；仅读 SettingsOverlay |
| src/features/settings/navigation.ts | 设置页壳与导航 | out-of-model | 归 ShellNavigation 边界；仅读 SettingsOverlay |
| src/features/settings/nestedModal.ts | 设置页壳与导航 | out-of-model | 归 ShellNavigation 边界；仅读 SettingsOverlay |
| src/features/settings/settingsTargets.ts | 设置页壳与导航 | out-of-model | 归 ShellNavigation 边界；仅读 SettingsOverlay |
| src/features/settings/SectionJumpBar.tsx | 设置页壳与导航 | out-of-model | 归 ShellNavigation 边界；仅读 SettingsOverlay |
| src/features/settings/sections/StorageSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/AboutSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/GeneralSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/AdvancedSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/SessionsSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/NotificationsSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/InboxSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/MobileSettingsSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/AppearanceSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/ShortcutsSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/GuideSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/ContextWindowSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/FallbackSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/sections/RolesSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/model*/ | 模型/提供商/隐私设置 | out-of-model | [out-of-slice] 归 ModelSettingsAudit / PrivacyProvidersAudit |
| src/features/settings/ModelRulesSection.tsx | 模型/提供商/隐私设置 | out-of-model | [out-of-slice] 归 ModelSettingsAudit / PrivacyProvidersAudit |
| src/features/settings/AgentModelAssignmentsPanel.tsx | 模型/提供商/隐私设置 | out-of-model | [out-of-slice] 归 ModelSettingsAudit / PrivacyProvidersAudit |
| FallbackChain* | 模型/提供商/隐私设置 | out-of-model | [out-of-slice] 归 ModelSettingsAudit / PrivacyProvidersAudit |
| src/features/settings/AutoCompactionCard.tsx | 模型/提供商/隐私设置 | out-of-model | [out-of-slice] 归 ModelSettingsAudit / PrivacyProvidersAudit |
| src/features/settings/SideChatModelCard.tsx | 模型/提供商/隐私设置 | out-of-model | [out-of-slice] 归 ModelSettingsAudit / PrivacyProvidersAudit |
| src/features/settings/sections/ProvidersSection.tsx | 模型/提供商/隐私设置 | out-of-model | [out-of-slice] 归 ModelSettingsAudit / PrivacyProvidersAudit |
| src/features/settings/sections/PrivacySection.tsx | 模型/提供商/隐私设置 | out-of-model | [out-of-slice] 归 ModelSettingsAudit / PrivacyProvidersAudit |
| src-tauri/src/settings.rs | 设置保存、omp config、omp 信息/更新命令 | read-only | 读了 omp_config_list/set 与错误返回；其余未审 |
| src-tauri/src/settings_mcp.rs | MCP 配置读写命令 | out-of-model | 仅读命令列表；文件格式与写入原子性未审 |
| src-tauri/src/settings_plugins.rs | 插件命令 | out-of-model | 仅读命令列表 |
| src-tauri/src/skills/* | 技能目录命令 | out-of-model | 仅读命令列表 |
| src-tauri/src/omp_files.rs | 规则/记忆/子代理文件读写 | read-only | write_checked 比较 stamp 后写（无锁，检查与写之间的 TOCTOU 仅读码） |
| src-tauri/src/visualize.rs | 内置 visualize 插件安装与启停 | read-only | 读码：启动时 write_if_changed 写 plugin.json 与 SKILL.md；spawn_plugin_dir 只检查 plugin.json 存在，SKILL.md 写失败时仍传 --plugin-dir（读码观察，未重放）；visualizeEnabled 只影响新建会话 |
| src-tauri/resources/plugins/omp-workspace-visualize | 内置 visualize 插件安装与启停 | read-only | 读码：启动时 write_if_changed 写 plugin.json 与 SKILL.md；spawn_plugin_dir 只检查 plugin.json 存在，SKILL.md 写失败时仍传 --plugin-dir（读码观察，未重放）；visualizeEnabled 只影响新建会话 |

### Model FileEditorBuffer

- Source: [FileEditorBuffer.tla](settings-skills/FileEditorBuffer/model/FileEditorBuffer.tla), config [FileEditorBuffer.cfg](settings-skills/FileEditorBuffer/model/FileEditorBuffer.cfg), map [FileEditorBuffer.map.mjs](settings-skills/FileEditorBuffer/model/FileEditorBuffer.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/FileEditorBuffer/chart/chart.mmd) / [chart.png](settings-skills/FileEditorBuffer/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/FileEditorBuffer/chart/bug-1.mmd) / [png](settings-skills/FileEditorBuffer/chart/bug-1.png)
- Stories: [stories.md](settings-skills/FileEditorBuffer/chart/stories.md); counts: [summary.json](settings-skills/FileEditorBuffer/chart/summary.json)
- TLC logs: [FileEditorBuffer-TypedTextKept.out](settings-skills/FileEditorBuffer/chart/tlc/FileEditorBuffer-TypedTextKept.out), [FileEditorBuffer.out](settings-skills/FileEditorBuffer/chart/tlc/FileEditorBuffer.out)
- From summary.json: 450 model states, 1101 transitions, 19 chart states, 19 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Overview used --cover; omitted states/arrows are listed in summary.json `cover`.
- Limits: 磁盘内容、文本均为整数编号；未建模 createContent、tooLarge、只读、预览页、草稿缓存跨挂载恢复、重试循环里的多次覆盖；编辑器模态确认框按完全模态处理；用 --cover 只画到每个稳定状态的最短路径。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| TypedTextKept | 保存或重新读取进行时输入的文字会被结果覆盖 | reproduced consumer behavior | 点保存→继续输入→保存成功返回；或 点重新读取→继续输入→读取结果返回 | reproduced: replay/settings.replay.test.tsx 两个 FileEditorBuffer 用例失败（Expected 'v2 + typed during save' Received 'v2'；Expected 'typed while reloading' Received 'v1'） | FileEditor.tsx:96-101,139-153 (setDraft(text)/apply 无视期间输入), :346 editable 仅看 readOnly, :274 重新读取仅 loading 时禁用 | not modeled |

### Model PluginsCatalogLoad

- Source: [PluginsCatalogLoad.tla](settings-skills/PluginsCatalogLoad/model/PluginsCatalogLoad.tla), config [PluginsCatalogLoad.cfg](settings-skills/PluginsCatalogLoad/model/PluginsCatalogLoad.cfg), map [PluginsCatalogLoad.map.mjs](settings-skills/PluginsCatalogLoad/model/PluginsCatalogLoad.map.mjs), fixed model [PluginsCatalogLoadFixed.tla](settings-skills/PluginsCatalogLoad/model/PluginsCatalogLoadFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/PluginsCatalogLoad/chart/chart.mmd) / [chart.png](settings-skills/PluginsCatalogLoad/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/PluginsCatalogLoad/chart/bug-1.mmd) / [png](settings-skills/PluginsCatalogLoad/chart/bug-1.png), [bug-2.mmd](settings-skills/PluginsCatalogLoad/chart/bug-2.mmd) / [png](settings-skills/PluginsCatalogLoad/chart/bug-2.png)
- Stories: [stories.md](settings-skills/PluginsCatalogLoad/chart/stories.md); counts: [summary.json](settings-skills/PluginsCatalogLoad/chart/summary.json)
- TLC logs: [PluginsCatalogLoad-PluginsMatchProject.out](settings-skills/PluginsCatalogLoad/chart/tlc/PluginsCatalogLoad-PluginsMatchProject.out), [PluginsCatalogLoad.out](settings-skills/PluginsCatalogLoad/chart/tlc/PluginsCatalogLoad.out), [fixed/PluginsCatalogLoadFixed-PluginsMatchProject.out](settings-skills/PluginsCatalogLoad/chart/tlc/fixed/PluginsCatalogLoadFixed-PluginsMatchProject.out), [fixed/PluginsCatalogLoadFixed.out](settings-skills/PluginsCatalogLoad/chart/tlc/fixed/PluginsCatalogLoadFixed.out)
- From summary.json: 17 model states, 36 transitions, 7 chart states, 17 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 只有两个项目；没有建模 skillsList 的并行读取；Fixed 对照模型加入过期判断。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| PluginsMatchProject | 切换项目后旧项目的插件目录晚到并覆盖新项目 | reproduced consumer behavior | 换项目→新项目返回→旧项目返回 | reproduced: PluginsCatalogLoad 用例失败（页面出现 plugin-of-a） | PluginsSection.tsx:91-110 reload 无序号/取消保护（对比 McpSection.tsx:85-98） | modeled: PluginsCatalogLoadFixed 模型，stories.md 将越界状态标为 fixed |

### Model MemoryFilesLoad

- Source: [MemoryFilesLoad.tla](settings-skills/MemoryFilesLoad/model/MemoryFilesLoad.tla), config [MemoryFilesLoad.cfg](settings-skills/MemoryFilesLoad/model/MemoryFilesLoad.cfg), map [MemoryFilesLoad.map.mjs](settings-skills/MemoryFilesLoad/model/MemoryFilesLoad.map.mjs), fixed model [MemoryFilesLoadFixed.tla](settings-skills/MemoryFilesLoad/model/MemoryFilesLoadFixed.tla)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/MemoryFilesLoad/chart/chart.mmd) / [chart.png](settings-skills/MemoryFilesLoad/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/MemoryFilesLoad/chart/bug-1.mmd) / [png](settings-skills/MemoryFilesLoad/chart/bug-1.png), [bug-2.mmd](settings-skills/MemoryFilesLoad/chart/bug-2.mmd) / [png](settings-skills/MemoryFilesLoad/chart/bug-2.png)
- Stories: [stories.md](settings-skills/MemoryFilesLoad/chart/stories.md); counts: [summary.json](settings-skills/MemoryFilesLoad/chart/summary.json)
- TLC logs: [MemoryFilesLoad-MemoryListMatchesProject.out](settings-skills/MemoryFilesLoad/chart/tlc/MemoryFilesLoad-MemoryListMatchesProject.out), [MemoryFilesLoad.out](settings-skills/MemoryFilesLoad/chart/tlc/MemoryFilesLoad.out), [fixed/MemoryFilesLoadFixed-MemoryListMatchesProject.out](settings-skills/MemoryFilesLoad/chart/tlc/fixed/MemoryFilesLoadFixed-MemoryListMatchesProject.out), [fixed/MemoryFilesLoadFixed.out](settings-skills/MemoryFilesLoad/chart/tlc/fixed/MemoryFilesLoadFixed.out)
- From summary.json: 17 model states, 36 transitions, 7 chart states, 17 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 只有两个记忆项目；未建模 setRel(null)、文件选中与 FileEditor 挂载；Fixed 对照模型加入过期判断。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| MemoryListMatchesProject | 切换记忆项目后旧项目文件列表晚到并覆盖 | reproduced consumer behavior | 换记忆项目→新项目返回→旧项目返回 | reproduced: MemoryFilesLoad 用例失败（出现 other-project） | MemoryFilesPanel.tsx:212-230 refreshFiles 无过期判断；:235-239 load/save 用当前 slug | modeled: MemoryFilesLoadFixed 模型，同上 |

### Model OmpListReadModifyWrite

- Source: [OmpListReadModifyWrite.tla](settings-skills/OmpListReadModifyWrite/model/OmpListReadModifyWrite.tla), config [OmpListReadModifyWrite.cfg](settings-skills/OmpListReadModifyWrite/model/OmpListReadModifyWrite.cfg), map [OmpListReadModifyWrite.map.mjs](settings-skills/OmpListReadModifyWrite/model/OmpListReadModifyWrite.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/OmpListReadModifyWrite/chart/chart.mmd) / [chart.png](settings-skills/OmpListReadModifyWrite/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/OmpListReadModifyWrite/chart/bug-1.mmd) / [png](settings-skills/OmpListReadModifyWrite/chart/bug-1.png)
- Stories: [stories.md](settings-skills/OmpListReadModifyWrite/chart/stories.md); counts: [summary.json](settings-skills/OmpListReadModifyWrite/chart/summary.json)
- TLC logs: [OmpListReadModifyWrite-OtherEntriesKept.out](settings-skills/OmpListReadModifyWrite/chart/tlc/OmpListReadModifyWrite-OtherEntriesKept.out), [OmpListReadModifyWrite.out](settings-skills/OmpListReadModifyWrite/chart/tlc/OmpListReadModifyWrite.out)
- From summary.json: 10 model states, 14 transitions, 6 chart states, 8 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: 只建模“其他条目 A”与“被切换条目 B”；读取失败是非确定选择；未建模 configWriteChain 串行（skills/store.ts:115-139）与 PluginsSection 的 busy 串行，两者互相不串行是代码阅读结论，未建模。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| OtherEntriesKept | omp config list 失败(found=false)时切换技能会用空列表整体覆盖 disabledExtensions | trace-and-source-only hypothesis | 点开关→读列表失败→写回新列表 | 分两半：(1) 已重放：真实前端在 omp config list 读取失败(found=false)后，无条件下发以空列表为基础的 ompConfigSet('disabledExtensions','["skill:new-one"]')，即不安全的写入分发；(2) 未验证：磁盘上原有条目是否因此持久丢失取决于真实 omp CLI 行为，属外部边界，未运行。整体不变量违反按 trace-and-source-only hypothesis 归类。 | skills/store.ts:127-135; PluginsSection.tsx:64-72 忽略 list.found；settings.rs:704-708 失败返回 found=false 空 entries | not modeled |

### Model ExtensionEnableRollback

- Source: [ExtensionEnableRollback.tla](settings-skills/ExtensionEnableRollback/model/ExtensionEnableRollback.tla), config [ExtensionEnableRollback.cfg](settings-skills/ExtensionEnableRollback/model/ExtensionEnableRollback.cfg), map [ExtensionEnableRollback.map.mjs](settings-skills/ExtensionEnableRollback/model/ExtensionEnableRollback.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/ExtensionEnableRollback/chart/chart.mmd) / [chart.png](settings-skills/ExtensionEnableRollback/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/ExtensionEnableRollback/chart/bug-1.mmd) / [png](settings-skills/ExtensionEnableRollback/chart/bug-1.png)
- Stories: [stories.md](settings-skills/ExtensionEnableRollback/chart/stories.md); counts: [summary.json](settings-skills/ExtensionEnableRollback/chart/summary.json)
- TLC logs: [ExtensionEnableRollback-UiMatchesConfigAfterFailure.out](settings-skills/ExtensionEnableRollback/chart/tlc/ExtensionEnableRollback-UiMatchesConfigAfterFailure.out), [ExtensionEnableRollback.out](settings-skills/ExtensionEnableRollback/chart/tlc/ExtensionEnableRollback.out)
- From summary.json: 4 model states, 3 transitions, 4 chart states, 3 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: 只建模启用 .disabled 扩展且重命名失败；未建模禁用分支和 revalidateCatalog。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| UiMatchesConfigAfterFailure | 启用 .disabled 扩展时重命名失败：界面回滚为已禁用，但配置里已被改为启用 | reproduced consumer behavior | 点启用→配置写入成功→重命名失败→界面回滚 | reproduced at store entrypoint: 失败后 catalog 回到 enabled=false 而 ompConfigSet 已把 ext-a 从 disabledExtensions 移除 | skills/store.ts:463-488 | not modeled |

### Model OmpInstallCancel

- Source: [OmpInstallCancel.tla](settings-skills/OmpInstallCancel/model/OmpInstallCancel.tla), config [OmpInstallCancel.cfg](settings-skills/OmpInstallCancel/model/OmpInstallCancel.cfg), map [OmpInstallCancel.map.mjs](settings-skills/OmpInstallCancel/model/OmpInstallCancel.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/OmpInstallCancel/chart/chart.mmd) / [chart.png](settings-skills/OmpInstallCancel/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/OmpInstallCancel/chart/bug-1.mmd) / [png](settings-skills/OmpInstallCancel/chart/bug-1.png)
- Stories: [stories.md](settings-skills/OmpInstallCancel/chart/stories.md); counts: [summary.json](settings-skills/OmpInstallCancel/chart/summary.json)
- TLC logs: [OmpInstallCancel-CancelHonored.out](settings-skills/OmpInstallCancel/chart/tlc/OmpInstallCancel-CancelHonored.out), [OmpInstallCancel.out](settings-skills/OmpInstallCancel/chart/tlc/OmpInstallCancel.out)
- From summary.json: 9 model states, 11 transitions, 8 chart states, 11 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: 后端安装槽按 omp_install.rs 语义抽象；真实 Rust 命令未运行（不可启动安装）；未建模超时、窗口关闭、进度事件、recheck、自定义路径对话框。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| CancelHonored | 取消点击早于后端登记安装时被后端当成空操作，随后安装仍成功 | trace-and-source-only hypothesis | 点开始→点取消(监听尚未就绪)→监听就绪、安装开始→安装结束成功 | 部分：前端 + 读码。真实前端在 omp_install_run 之前发出取消（已重放，后端为替身）；后端空操作半边仅来自读 omp_install.rs:366-374，未运行真实 Rust。 | ompInstall.ts:68-96,113-115; omp_install.rs:89-98,366-374 | not modeled |

### Model OmpUpdateCheck

- Source: [OmpUpdateCheck.tla](settings-skills/OmpUpdateCheck/model/OmpUpdateCheck.tla), config [OmpUpdateCheck.cfg](settings-skills/OmpUpdateCheck/model/OmpUpdateCheck.cfg), map [OmpUpdateCheck.map.mjs](settings-skills/OmpUpdateCheck/model/OmpUpdateCheck.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/OmpUpdateCheck/chart/chart.mmd) / [chart.png](settings-skills/OmpUpdateCheck/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/OmpUpdateCheck/chart/bug-1.mmd) / [png](settings-skills/OmpUpdateCheck/chart/bug-1.png)
- Stories: [stories.md](settings-skills/OmpUpdateCheck/chart/stories.md); counts: [summary.json](settings-skills/OmpUpdateCheck/chart/summary.json)
- TLC logs: [OmpUpdateCheck-NoStaleUpdateBadge.out](settings-skills/OmpUpdateCheck/chart/tlc/OmpUpdateCheck-NoStaleUpdateBadge.out), [OmpUpdateCheck.out](settings-skills/OmpUpdateCheck/chart/tlc/OmpUpdateCheck.out)
- From summary.json: 20 model states, 40 transitions, 12 chart states, 29 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: checkSees 表示检查请求发出时的二进制版本，来自对 omp update 检查语义的假设 [INFERENCE]；未建模 autoUpdate 触发、外部更新处理 ompUpdateSessions。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| NoStaleUpdateBadge | 更新成功后，更新前发出的检查结果晚到，仍显示有可用更新 | reproduced consumer behavior | 开始检查→点更新→更新完成(自带复检因检查在途直接返回)→旧检查结果返回 | 已重放：在构造的合法异步顺序下（检查在途→更新完成→旧检查晚到），真实前端 ompUpdate store 的陈旧响应归属错误，更新成功后 status.updateAvailable 仍为 true。真实 CLI/版本探测未执行；该顺序是否在真实 omp 下出现属外部边界。 | ompUpdate.ts:66-72,105-134 | not modeled |

### Model McpEditorDialog

- Source: [McpEditorDialog.tla](settings-skills/McpEditorDialog/model/McpEditorDialog.tla), config [McpEditorDialog.cfg](settings-skills/McpEditorDialog/model/McpEditorDialog.cfg), map [McpEditorDialog.map.mjs](settings-skills/McpEditorDialog/model/McpEditorDialog.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/McpEditorDialog/chart/chart.mmd) / [chart.png](settings-skills/McpEditorDialog/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/McpEditorDialog/chart/bug-1.mmd) / [png](settings-skills/McpEditorDialog/chart/bug-1.png)
- Stories: [stories.md](settings-skills/McpEditorDialog/chart/stories.md); counts: [summary.json](settings-skills/McpEditorDialog/chart/summary.json)
- TLC logs: [McpEditorDialog-EditorVisibleWhenOpen.out](settings-skills/McpEditorDialog/chart/tlc/McpEditorDialog-EditorVisibleWhenOpen.out), [McpEditorDialog.out](settings-skills/McpEditorDialog/chart/tlc/McpEditorDialog.out)
- From summary.json: 4 model states, 6 transitions, 4 chart states, 6 chart transitions, 1 bug class(es), 0 broken propert(ies).
- Limits: 仅父组件 dialog/allServers 归属、目录重读与可见子组件 onClose 输入契约，不涵盖写入。SingleWriter 现由独立 McpWriteOwnership 检查；原混合模型的通过结论撤回。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| EditorVisibleWhenOpen | MCP 编辑弹窗打开时，目录重读发现服务器已被外部删除，弹窗无提示地消失（状态仍是 edit） | design question | 点编辑→服务器被外部删除后列表重读 | reproduced: McpSection 用例失败（重读后 role=dialog 消失）；“服务器重新出现后弹窗是否自动弹回”由 dialog 状态仍为 edit 推知，未单独断言 | McpSection.tsx:211 editing 由 allServers.find 派生、:400-409 渲染条件，dialog 状态不随之清理 | not modeled |

### Model McpWriteOwnership

- Source: [McpWriteOwnership.tla](settings-skills/McpWriteOwnership/model/McpWriteOwnership.tla), config [McpWriteOwnership.cfg](settings-skills/McpWriteOwnership/model/McpWriteOwnership.cfg), map [McpWriteOwnership.map.mjs](settings-skills/McpWriteOwnership/model/McpWriteOwnership.map.mjs)
- Overview chart (Chinese labels): [chart.mmd](settings-skills/McpWriteOwnership/chart/chart.mmd) / [chart.png](settings-skills/McpWriteOwnership/chart/chart.png)
- Bug charts: [bug-1.mmd](settings-skills/McpWriteOwnership/chart/bug-1.mmd) / [png](settings-skills/McpWriteOwnership/chart/bug-1.png), [bug-2.mmd](settings-skills/McpWriteOwnership/chart/bug-2.mmd) / [png](settings-skills/McpWriteOwnership/chart/bug-2.png)
- Stories: [stories.md](settings-skills/McpWriteOwnership/chart/stories.md); counts: [summary.json](settings-skills/McpWriteOwnership/chart/summary.json)
- TLC logs: [McpWriteOwnership-SingleWriter.out](settings-skills/McpWriteOwnership/chart/tlc/McpWriteOwnership-SingleWriter.out), [McpWriteOwnership.out](settings-skills/McpWriteOwnership/chart/tlc/McpWriteOwnership.out)
- From summary.json: 19 model states, 29 transitions, 19 chart states, 29 chart transitions, 2 bug class(es), 0 broken propert(ies).
- Limits: 两次写入均尚未返回的有限前缀（writes<2 为探索上限，不是产品守卫）；合法草稿/合法非空导入输入；目录固定为空或非空；不建模完成、失败恢复、真实 Rust 持久化或同一渲染批次多次点击。包含 parent act、editor.save 与 import.run 的各自实际入口守卫。子组件关闭不会取消在途请求。

| Rule | Title | Kind | Steps | Reproduction | Evidence | Fix model (model only) |
|---|---|---|---|---|---|---|
| SingleWriter | MCP空目录的添加入口绕过父 busy，保存中关闭弹窗再打开新弹窗可同时发出两次写入 | reproduced consumer behavior | 空目录→添加→保存合法草稿（请求未返回）→取消关闭→空目录卡片添加→再次保存 | 真实 McpSection + McpServerEditor 用户入口复现；两次 mcpServerSave 均未 resolve，期望1次实际2次。只替换 IPC 边界，没有替换父/子组件。下游原生写入影响未运行；仅重复编辑分支已重放，模型中的编辑→导入分支仍为 trace/source-only。 | src/features/settings/McpSection.tsx:105-119,189-204,308-312,390-407; src/features/settings/McpServerEditor.tsx:156,187-207,410-413; src/features/settings/McpImportDialog.tsx:69-86,177-184; src/features/settings/ui.tsx:471 | not modeled |

### Additional observations (not model invariants; classification is per item)

- **create() 无重复点击保护、不设置 saving**; evidence: src/features/settings/FileEditor.tsx:178-196; kind: trace-and-source-only hypothesis
- **PluginsSection.updateOmpList 与 skills/store updateOmpListSetting 对同一配置键读改写互不串行**; evidence: src/features/settings/PluginsSection.tsx:60-73; src/features/skills/store.ts:115-140; kind: trace-and-source-only hypothesis
- **write_checked 在 stamp 比较与写入之间无锁**; evidence: src-tauri/src/omp_files.rs:74-92; kind: trace-and-source-only hypothesis
- **SKILL.md 写入失败时 spawn_plugin_dir 仍只因 plugin.json 存在而传 --plugin-dir**; evidence: src-tauri/src/visualize.rs:50-85; kind: trace-and-source-only hypothesis

### openRules


### Verification run by the slice author

| Command | Exit | Result |
|---|---|---|
| `node citecheck.mjs (uncitedConditions over models/*.tla)` | 0 | 11 TLA inputs: see final citecheck output; all [] |
| `TLA2TOOLS/JAVA node statechart.mjs from-spec ... --png for 8 models (see run.sh and out/*/tlc)` | 0 | each broken rule reported; all PNG opened and visually inspected |
| `cd repo && ./node_modules/.bin/vitest run --config <scratch>/replay/vitest.config.mjs` | 1 | 9 test cases fail by design: each failing assertion is REPRODUCTION EVIDENCE of a suspected bug, not an acceptance failure (replay/replay.log) |
| `./node_modules/.bin/vitest run --config <scratch>/settings-skills/replay/vitest.config.mjs <scratch>/settings-skills/replay/mcp-ownership.replay.test.tsx` | 1 | 1 test failed by design: SingleWriter reproduction evidence; expected mcpServerSave once, received twice with both promises unresolved. Raw tool output artifact://588. Unrelated known replay tests not rerun. |

Slice narrative: [settings-skills/RESULT.md](settings-skills/RESULT.md)

### Archived replay evidence

Scrubbed observations and harness snapshots; placeholders such as <repo> are archival paths, not executable paths. The model-regeneration command does not rerun product replays.

- [replay/mcp-ownership.replay.test.tsx](settings-skills/evidence/replay/mcp-ownership.replay.test.tsx)
- [replay/replay.log](settings-skills/evidence/replay/replay.log)
- [replay/settings.replay.test.tsx](settings-skills/evidence/replay/settings.replay.test.tsx)
- [replay/vitest.config.mjs](settings-skills/evidence/replay/vitest.config.mjs)

## Current product baseline checks (not part of audit acceptance)

This table preserves verification records and their actual status; listing a command does not imply it ran. In particular, independent reviewer dispatches marked not-executed-rate-limited did not perform a review. Executed product checks ran against unmodified product code; their failures are recorded as found. Audit artifact acceptance (models, charts, citations, PNGs) is gated separately and does not depend on a clean product suite.

| Check | Command | Exit | Status | Detail |
|---|---|---|---|---|
| peer-review.json | `Independent reviewer dispatch for completed shell/automation and settings audit evidence` |  | not-executed-rate-limited | Optional second-reviewer model-to-code review; not claimed as completed evidence. Main continues local source and artifact verification. |
| runtime-visual-review.json | `` |  | executed | Final corrected RuntimeStatus and Ownership PNGs |
| tests.json | `./node_modules/.bin/vitest run --maxWorkers=2` | 1 | failed-current-product | Existing full frontend suite; audit makes no product edits. |
| typecheck.json | `./node_modules/.bin/tsc --noEmit` | 2 | failed-current-product | Baseline verification; this audit does not modify product code. (4 diagnostics, see manifest.json) |

## Waived gate checks

None.
