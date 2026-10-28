------------------------------ MODULE RuntimeStatus ------------------------------
\* 会话运行状态审计模型 (from-spec)：子进程 -> 读取循环 -> 事件总线 -> 目录状态推导 / 前端 live 存储。
\* 代码根目录: omp-workspace/.worktrees/bug-fix @ 7f85613。引用格式: 文件:行 条件说明。
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS NONE  \* 占位, 未使用
OpBound == 4      \* 模型边界: 环境与用户动作总数上限, 非代码常量
StartBound == 1   \* 模型边界: 进程启动次数上限, 非代码常量

VARIABLES
  childAlive,   \* src-tauri/src/rpc/process.rs:985 monitor 等待的 omp 子进程是否存活
  childTurn,    \* 子进程内部是否正在执行一轮 (上游语义: 仅由其输出帧间接观察)
  childAsync,   \* 子进程空闲但等待后台任务 (agent_end.awaitingAsyncWork)
  exitBad,      \* 子进程以非零码退出 (process.rs:993 exit_code)
  stdout,       \* 子进程已写出但读取循环尚未处理的帧 process.rs:942 read_loop
  registry,     \* rpc/mod.rs:33 REGISTRY 中是否有句柄
  exitEmitted,  \* process.rs:994 已发出 running=false 事件
  hStreaming,   \* process.rs:107 SessionHandle.streaming
  hAsync,       \* process.rs:119 awaiting_async_work
  hUi,          \* process.rs:121 handle.pending_ui 请求 id 集合
  bus,          \* state.rs AppEvent 广播队列, tasks.rs:267 run_bus_loop 消费
  rtLive,       \* status.rs:23 Runtime.live
  rtWorking,    \* status.rs:24 Runtime.phase == Working
  rtDlg,        \* status.rs:26 Runtime.dialogs 请求 id 集合
  pending,      \* 持久化 pending_kind (status.rs:236 DeriveInput.pending)
  meta,         \* catalog/mod.rs:517 meta.status + meta.live 的缓存结果
  suspended,    \* session_meta.suspended (rpc/mod.rs:688 set_suspended)
  ext,          \* catalog/external.rs:110 external_map 命中外部进程
  tail,         \* parse.rs:61 TailState 的抽象
  accepted,     \* mod.rs:512 tail_accepted
  superseded,   \* mod.rs:513 pending_superseded
  feStreaming,  \* src/stores/live.ts:176 SessionLive.streaming
  feUi,         \* live.ts:179 pendingUi 请求 id 集合
  ops, starts, fileDirty

vars == <<childAlive, childTurn, childAsync, exitBad, stdout, registry, exitEmitted,
          hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta,
          suspended, ext, tail, accepted, superseded, feStreaming, feUi, ops, starts, fileDirty>>

Kinds == {"working", "awaitingApproval", "awaitingAnswer", "review", "error", "idle",
          "external", "suspended", "interrupted"}

\* ---------- 纯函数: status.rs ----------
DlgPending(d) == IF d = {} THEN "none" ELSE IF 1 \in d THEN "approval" ELSE "question"   \* status.rs:41-49 (id1=Allow tool 标题)

AfterDlgClosed(d, p) ==   \* status.rs:194-199
  IF p \in {"approval", "question", "none"} THEN DlgPending(d) ELSE p

Derive(live, d, working, p, susp, extl, tl, acc, sup) ==   \* status.rs:246-287
  IF live THEN                                               \* status.rs:249
    IF d # {} THEN                                           \* status.rs:250-253 对话框优先
      (IF 1 \in d THEN [st |-> "awaitingApproval", pd |-> "approval"]
       ELSE [st |-> "awaitingAnswer", pd |-> "question"])
    ELSE LET settled == IF p \in {"review", "error"} THEN p ELSE "none"   \* status.rs:255
         IN IF working THEN [st |-> "working", pd |-> settled]            \* status.rs:256-258
            ELSE IF settled = "review" THEN [st |-> "review", pd |-> "review"]   \* status.rs:260
            ELSE IF settled = "error" THEN [st |-> "error", pd |-> "error"]      \* status.rs:261
            ELSE [st |-> "idle", pd |-> "none"]                                  \* status.rs:262
  ELSE IF extl THEN [st |-> "external", pd |-> IF p \in {"review", "error"} THEN p ELSE "none"]  \* status.rs:265-270
  ELSE IF p = "review" THEN [st |-> "review", pd |-> "review"]                   \* status.rs:272
  ELSE IF p = "error" /\ ~sup THEN [st |-> "error", pd |-> "error"]              \* status.rs:273
  ELSE IF susp THEN [st |-> "suspended", pd |-> "none"]                           \* status.rs:276-278
  ELSE IF ~acc /\ tl = "interrupted" THEN [st |-> "interrupted", pd |-> "interrupted"]   \* status.rs:279-281
  ELSE IF ~acc /\ tl = "error" THEN [st |-> "error", pd |-> "error"]             \* status.rs:279,282
  ELSE [st |-> "idle", pd |-> "none"]                                            \* status.rs:286

\* 一次事件消费后的统一尾部: 持久化 pending 并重新推导 (tasks.rs:318-331, mod.rs:410-570)
Settle(live1, work1, dlg1, np) ==
  LET d == Derive(live1 \/ registry, dlg1, work1, np, suspended, ext, tail, accepted,
                  IF np # pending THEN FALSE ELSE superseded)   \* mod.rs:497-513 live = rt.live 或 注册表
  IN /\ rtLive' = live1 /\ rtWorking' = work1 /\ rtDlg' = dlg1
     /\ pending' = d.pd
     /\ superseded' = IF np # pending \/ d.pd # np THEN FALSE ELSE superseded
     /\ meta' = [st |-> d.st, live |-> (live1 \/ registry)]

Init ==
  /\ childAlive = FALSE /\ childTurn = FALSE /\ childAsync = FALSE /\ exitBad = FALSE
  /\ stdout = <<>> /\ registry = FALSE /\ exitEmitted = TRUE
  /\ hStreaming = FALSE /\ hAsync = FALSE /\ hUi = {} /\ bus = <<>>
  /\ rtLive = FALSE /\ rtWorking = FALSE /\ rtDlg = {} /\ pending = "none"
  /\ meta = [st |-> "idle", live |-> FALSE]
  /\ suspended = FALSE /\ ext = FALSE /\ tail = "empty" /\ accepted = FALSE /\ superseded = FALSE
  /\ feStreaming = FALSE /\ feUi = {} /\ ops = 0 /\ starts = 0 /\ fileDirty = FALSE

TypeOK == /\ meta.st \in Kinds /\ pending \in {"none","review","error","approval","question","interrupted"}
          /\ tail \in {"empty","clean","interrupted","error"}

\* ---------- 用户 / 客户端动作 ----------
UserStartProcess ==   \* 读者: 打开会话并继续 -> ensure_live -> start
  /\ ~registry                         \* rpc/mod.rs:442 没有现存句柄才会拉起
  /\ ~childAlive                       \* rpc/mod.rs:441-450 旧进程已退出 (restart 轮询 get_handle 为空)
  /\ ~ext                              \* rpc/mod.rs:400-418 ensure_not_held: 外部占用则拒绝
  /\ starts < StartBound               \* 模型边界
  /\ registry' = TRUE                  \* rpc/mod.rs:352-354 registry.insert
  /\ childAlive' = TRUE /\ childTurn' = FALSE /\ childAsync' = FALSE
  /\ exitEmitted' = FALSE              \* rpc/mod.rs:355-365 发出 running=true
  /\ hStreaming' = FALSE /\ hAsync' = FALSE /\ hUi' = {}   \* process.rs:793-799 新句柄初始值
  /\ suspended' = FALSE                \* rpc/mod.rs:490 set_suspended(false)
  /\ bus' = Append(bus, "procUp")
  /\ feUi' = feUi /\ feStreaming' = feStreaming  \* live.ts:1527 reduceProcess(running=true) 仅 alive=true
  /\ starts' = starts + 1
  /\ UNCHANGED <<exitBad, stdout, rtLive, rtWorking, rtDlg, pending, meta, ext, tail, accepted, superseded, ops, fileDirty>>

UserPrompt ==   \* 读者: 发送消息 -> send_prompt
  /\ registry /\ childAlive            \* rpc/mod.rs:495-500 ensure_live 后须有存活句柄; process.rs:617 send_command 拒绝死进程
  /\ ops < OpBound                     \* 模型边界
  /\ bus' = Append(bus, "prompt")      \* rpc/mod.rs:508-510 emit PromptSent
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, registry, exitEmitted, hStreaming, hAsync, hUi,
                 rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, feUi, starts, fileDirty>>

UserRespond(id) ==   \* 读者: 在卡片上回答/批准 -> ui_respond
  /\ id \in feUi                       \* 前端卡片存在 (live.ts:1005 pendingUi)
  /\ registry /\ childAlive            \* rpc/mod.rs:534-536 get_handle 且 process.rs:719 send_raw 拒绝死进程
  /\ ops < OpBound
  /\ hUi' = hUi \ {id}                 \* rpc/mod.rs:552-556 pending_ui.retain
  /\ feUi' = feUi \ {id}               \* live.ts:1556 dismissUi
  /\ bus' = Append(bus, IF id = 1 THEN "resp1" ELSE "resp2")   \* rpc/mod.rs:558-562 UiResponded
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, registry, exitEmitted, hStreaming, hAsync,
                 rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, starts, fileDirty>>

UserAccept ==   \* 读者: 标记已读/接受 -> accept_session / mark_seen
  /\ ops < OpBound
  /\ bus' = Append(bus, "accepted")    \* catalog/commands.rs:187 emit SessionAccepted
  /\ accepted' = TRUE                  \* catalog/commands.rs:184 store::accept 写 accepted_at
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, registry, exitEmitted, hStreaming, hAsync, hUi,
                 rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, superseded, feStreaming, feUi, starts, fileDirty>>

\* ---------- 子进程输出 (上游语义为边界, 只取代码处理的帧类型) ----------
ChildStartTurn ==
  /\ childAlive /\ ~childTurn          \* 上游边界: 空闲进程开始一轮 (agent_start 帧 status.rs:87)
  /\ Len(stdout) < 2 /\ ops < OpBound
  /\ childTurn' = TRUE /\ childAsync' = FALSE
  /\ stdout' = Append(stdout, "start")
  /\ tail' = "interrupted" /\ accepted' = FALSE /\ superseded' = TRUE /\ fileDirty' = TRUE   \* 用户消息写入转录, parse.rs:81 non_terminal
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, exitBad, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, feStreaming, feUi, starts>>

ChildAsk(id) ==
  /\ childAlive /\ childTurn           \* 上游边界: 一轮中请求对话框 (status.rs:102 extension_ui_request)
  /\ Len(stdout) < 2 /\ ops < OpBound   \* 仅有限队列与动作边界；请求 id 不假定上游去重
  /\ stdout' = Append(stdout, IF id = 1 THEN "ask1" ELSE "ask2")
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, feUi, starts, fileDirty>>

ChildCancelUi(id) ==
  /\ childAlive /\ id \in hUi          \* 上游边界: 取消已发出的请求 (status.rs:117 method=cancel)
  /\ Len(stdout) < 2 /\ ops < OpBound
  /\ stdout' = Append(stdout, IF id = 1 THEN "cancel1" ELSE "cancel2")
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, feUi, starts, fileDirty>>

ChildEndTurn ==
  /\ childAlive /\ childTurn           \* 上游边界: 终止 agent_end (status.rs:127, isTerminal 缺省)
  /\ Len(stdout) < 2 /\ ops < OpBound
  /\ childTurn' = FALSE /\ childAsync' = FALSE
  /\ stdout' = Append(stdout, "end")
  /\ tail' = "clean" /\ fileDirty' = TRUE
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, exitBad, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, accepted, superseded, feStreaming, feUi, starts>>

ChildEndWithError ==
  /\ childAlive /\ childTurn           \* 上游边界: 以 stopReason=error 结束 (status.rs:128-132)
  /\ Len(stdout) < 2 /\ ops < OpBound
  /\ childTurn' = FALSE /\ childAsync' = FALSE
  /\ stdout' = Append(stdout, "endErr")
  /\ tail' = "error" /\ fileDirty' = TRUE
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, exitBad, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, accepted, superseded, feStreaming, feUi, starts>>

ChildEndAwaitingAsync ==
  /\ childAlive /\ childTurn           \* 上游边界: isTerminal=false 且 awaitingAsyncWork=true (status.rs:207-208)
  /\ Len(stdout) < 2 /\ ops < OpBound
  /\ childTurn' = FALSE /\ childAsync' = TRUE
  /\ stdout' = Append(stdout, "endAsync")
  /\ tail' = "clean" /\ fileDirty' = TRUE
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, exitBad, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, accepted, superseded, feStreaming, feUi, starts>>

ChildEndScheduledContinuation ==
  /\ childAlive /\ childTurn           \* 上游边界: isTerminal=false 的计划续跑 (status.rs:201-205)
  /\ Len(stdout) < 2 /\ ops < OpBound
  /\ stdout' = Append(stdout, "endCont")
  /\ ops' = ops + 1
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, feUi, starts, fileDirty>>

ChildExit(bad) ==
  /\ childAlive                        \* 子进程可随时崩溃/被关闭, 与读取循环是否读完无关 (process.rs:985 child.wait)
  /\ childAlive' = FALSE /\ childTurn' = FALSE /\ childAsync' = FALSE
  /\ exitBad' = bad
  /\ fileDirty' = TRUE                 \* 退出会写 session_exit 记录 (parse.rs:74 exit)
  /\ UNCHANGED <<stdout, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, feUi, ops, starts>>

\* ---------- 读取循环: 帧 -> 句柄状态 + 前端 + 总线 ----------
PopFrame == /\ stdout # <<>> /\ stdout' = Tail(stdout)    \* process.rs:942-966 逐行读取, 不检查进程是否已退出

DeliverStart ==
  /\ PopFrame /\ Head(stdout) = "start"
  /\ hStreaming' = TRUE /\ hAsync' = FALSE                 \* process.rs:292-296 agent_start
  /\ feStreaming' = TRUE                                   \* live.ts:746-753 agent_start 置 streaming
  /\ bus' = Append(bus, "start")                           \* process.rs:372 emit_frame -> 总线
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hUi, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feUi, ops, starts, fileDirty>>

DeliverAsk ==
  /\ PopFrame /\ Head(stdout) \in {"ask1", "ask2"}
  /\ LET id == IF Head(stdout) = "ask1" THEN 1 ELSE 2 IN
       /\ hUi' = hUi \cup {id}                             \* process.rs:267-277 push pending_ui (不会因 agent_end 清除)
       /\ feUi' = feUi \cup {id}                           \* live.ts:1005-1031 追加 pendingUi
  /\ bus' = Append(bus, Head(stdout))
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hStreaming, hAsync, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, ops, starts, fileDirty>>

DeliverCancel ==
  /\ PopFrame /\ Head(stdout) \in {"cancel1", "cancel2"}
  /\ LET id == IF Head(stdout) = "cancel1" THEN 1 ELSE 2 IN
       /\ hUi' = hUi \ {id}                                \* process.rs:278-289 cancel 清除
       /\ feUi' = feUi \ {id}                              \* live.ts:1007-1015 cancel 过滤
  /\ bus' = Append(bus, Head(stdout))
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hStreaming, hAsync, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, ops, starts, fileDirty>>

DeliverEnd ==
  /\ PopFrame /\ Head(stdout) \in {"end", "endErr"}
  /\ hStreaming' = FALSE /\ hAsync' = FALSE                \* process.rs:297-304 终止 agent_end
  /\ feStreaming' = FALSE                                  \* live.ts:930-962 终止 agent_end (不清 pendingUi)
  /\ bus' = Append(bus, Head(stdout))
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hUi, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feUi, ops, starts, fileDirty>>

DeliverEndAwaitingAsync ==
  /\ PopFrame /\ Head(stdout) = "endAsync"
  /\ hStreaming' = FALSE /\ hAsync' = TRUE                 \* process.rs:297-303 awaitingAsyncWork
  /\ feStreaming' = FALSE                                  \* live.ts:935-948 awaitingAsyncWork 停止转圈
  /\ bus' = Append(bus, "endAsync")
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hUi, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feUi, ops, starts, fileDirty>>

DeliverEndContinuation ==
  /\ PopFrame /\ Head(stdout) = "endCont"
  /\ bus' = Append(bus, "endCont")                         \* process.rs:297 守卫不满足, 无变化; live.ts:936 isTerminal=false 且非 async 保持
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, registry, exitEmitted, hStreaming, hAsync, hUi, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, feUi, ops, starts, fileDirty>>

\* ---------- 进程监视 ----------
MonitorEmitExit ==
  /\ ~childAlive /\ ~exitEmitted       \* process.rs:986 child.wait 返回后立即发出, 不等待 stdout 读完
  /\ hUi' = {} /\ exitEmitted' = TRUE  \* process.rs:991 pending_ui.clear
  /\ feUi' = {} /\ feStreaming' = FALSE  \* live.ts:1527-1545 reduceProcess(running=false)
  /\ bus' = Append(bus, IF exitBad THEN "exitBad" ELSE "exitOk")   \* process.rs:994-998
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, registry, hStreaming, hAsync, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, ops, starts, fileDirty>>

MonitorUnregister ==
  /\ exitEmitted /\ ~childAlive /\ registry     \* process.rs:1000-1004 事件之后才移除注册表
  /\ registry' = FALSE
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, suspended, ext, tail, accepted, superseded, feStreaming, feUi, ops, starts, fileDirty>>

\* ---------- 总线消费: status::apply + 持久化 + 重新推导 ----------
BusPop == /\ bus # <<>> /\ bus' = Tail(bus)       \* tasks.rs:267-278 单消费者按序处理
Ev == Head(bus)
Rest == UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, registry, exitEmitted, hStreaming, hAsync, hUi, suspended, ext, tail, accepted, feStreaming, feUi, ops, starts, fileDirty>>

ConsumeAgentStart ==
  /\ BusPop /\ Ev = "start"
  /\ Settle(TRUE, TRUE, rtDlg, pending)            \* status.rs:87-91 live=true, Working
  /\ Rest
ConsumeAsk ==
  /\ BusPop /\ Ev \in {"ask1", "ask2"}
  /\ LET id == IF Ev = "ask1" THEN 1 ELSE 2
         d1 == rtDlg \cup {id}
     IN Settle(TRUE, rtWorking, d1, DlgPending(d1))  \* status.rs:102-116 live=true, 记入对话框, pending=对话框类型
  /\ Rest
ConsumeCancel ==
  /\ BusPop /\ Ev \in {"cancel1", "cancel2"}
  /\ LET id == IF Ev = "cancel1" THEN 1 ELSE 2
         d1 == rtDlg \ {id}
     IN Settle(rtLive, rtWorking, d1, AfterDlgClosed(d1, pending))   \* status.rs:117-125
  /\ Rest
ConsumeAgentEnd ==
  /\ BusPop /\ Ev \in {"end", "endErr", "endAsync"}   \* status.rs:127 agent_end_settles
  /\ Settle(rtLive, FALSE, {}, IF Ev = "endErr" THEN "error" ELSE "review")   \* status.rs:128-137 清空对话框, Error/Review
  /\ Rest
ConsumeContinuation ==
  /\ BusPop /\ Ev = "endCont"                       \* status.rs:127 守卫不成立: 无变化
  /\ UNCHANGED <<rtLive, rtWorking, rtDlg, pending, meta, superseded>>
  /\ Rest
ConsumeProcessUp ==
  /\ BusPop /\ Ev = "procUp"
  /\ Settle(TRUE, rtWorking, rtDlg, IF pending \in {"interrupted", "error"} THEN "none" ELSE pending)   \* status.rs:152-158
  /\ Rest
ConsumeProcessExit ==
  /\ BusPop /\ Ev \in {"exitOk", "exitBad"}
  /\ Settle(FALSE, FALSE, {},
            IF Ev = "exitBad" THEN "error"
            ELSE IF pending \in {"approval", "question"} THEN "none" ELSE pending)   \* status.rs:159-172
  /\ Rest
ConsumePrompt ==
  /\ BusPop /\ Ev = "prompt"
  /\ Settle(rtLive, rtWorking, rtDlg, IF pending \in {"review", "question"} THEN DlgPending(rtDlg) ELSE pending)   \* status.rs:147-151
  /\ Rest
ConsumeAccepted ==
  /\ BusPop /\ Ev = "accepted"
  /\ Settle(rtLive, rtWorking, rtDlg, "none")       \* status.rs:173-175
  /\ Rest
ConsumeResponded ==
  /\ BusPop /\ Ev \in {"resp1", "resp2"}
  /\ LET id == IF Ev = "resp1" THEN 1 ELSE 2
         d1 == rtDlg \ {id}
     IN Settle(rtLive, IF ~rtWorking /\ rtLive THEN TRUE ELSE rtWorking, d1, AfterDlgClosed(d1, pending))   \* status.rs:140-146 已空闲的存活会话回到 Working
  /\ Rest

\* ---------- 其他触发的重新推导 ----------
FileRefresh ==
  /\ fileDirty                                       \* tasks.rs:147-160 文件监听 -> refresh_paths
  /\ LET d == Derive(rtLive \/ registry, rtDlg, rtWorking, pending, suspended, ext, tail, accepted, superseded)   \* mod.rs:497-513
     IN /\ meta' = [st |-> d.st, live |-> (rtLive \/ registry)]
        /\ pending' = d.pd
        /\ superseded' = IF d.pd # pending THEN FALSE ELSE superseded
  /\ fileDirty' = FALSE
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, suspended, ext, tail, accepted, feStreaming, feUi, ops, starts>>

ExternalOpens ==
  /\ ~registry /\ ~ext                               \* external.rs:110-131 非本应用持有的存活进程; 本应用句柄存在时不算外部 (mod.rs:499-503)
  /\ ext' = TRUE
  /\ LET d == Derive(rtLive \/ registry, rtDlg, rtWorking, pending, suspended, TRUE, tail, accepted, superseded)   \* tasks.rs:244-250 external 变化触发全量重算
     IN /\ meta' = [st |-> d.st, live |-> (rtLive \/ registry)] /\ pending' = d.pd
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, suspended, tail, accepted, superseded, feStreaming, feUi, ops, starts, fileDirty>>

ExternalCloses ==
  /\ ext                                             \* external.rs:123-129 状态文件中的进程已不存活
  /\ ext' = FALSE
  /\ LET d == Derive(rtLive \/ registry, rtDlg, rtWorking, pending, suspended, FALSE, tail, accepted, superseded)
     IN /\ meta' = [st |-> d.st, live |-> (rtLive \/ registry)] /\ pending' = d.pd
  /\ UNCHANGED <<childAlive, childTurn, childAsync, exitBad, stdout, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, suspended, tail, accepted, superseded, feStreaming, feUi, ops, starts, fileDirty>>

IdleSuspend ==
  /\ registry /\ childAlive                          \* rpc/mod.rs:178 handle.alive
  /\ ~hStreaming /\ ~hAsync                          \* rpc/mod.rs:179-181 streaming/settled/awaiting_async_work
  /\ hUi = {}                                        \* rpc/mod.rs:183 pending_ui 为空
  /\ ~childTurn /\ ~childAsync                       \* rpc/mod.rs:248-252 get_state 权威确认已空闲
  /\ stdout = <<>>                                   \* rpc/mod.rs:239 activity_version 未变 (期间无新帧)
  /\ childAlive' = FALSE /\ suspended' = TRUE        \* rpc/mod.rs:277 关闭 stdin; rpc/mod.rs:224 set_suspended(true)
  /\ fileDirty' = TRUE
  /\ UNCHANGED <<childTurn, childAsync, exitBad, stdout, registry, exitEmitted, hStreaming, hAsync, hUi, bus, rtLive, rtWorking, rtDlg, pending, meta, ext, tail, accepted, superseded, feStreaming, feUi, ops, starts>>

Next ==
  \/ UserStartProcess \/ UserPrompt \/ (\E i \in {1, 2} : UserRespond(i))
  \/ ChildStartTurn \/ (\E i \in {1, 2} : ChildAsk(i)) \/ (\E i \in {1, 2} : ChildCancelUi(i))
  \/ ChildEndTurn \/ ChildEndWithError \/ ChildEndAwaitingAsync \/ ChildEndScheduledContinuation
  \/ ChildExit(FALSE) \/ ChildExit(TRUE)
  \/ DeliverStart \/ DeliverAsk \/ DeliverCancel \/ DeliverEnd \/ DeliverEndAwaitingAsync \/ DeliverEndContinuation
  \/ MonitorEmitExit \/ MonitorUnregister
  \/ ConsumeAgentStart \/ ConsumeAsk \/ ConsumeCancel \/ ConsumeAgentEnd \/ ConsumeContinuation
  \/ ConsumeProcessUp \/ ConsumeProcessExit \/ ConsumePrompt \/ ConsumeResponded

Spec == Init /\ [][Next]_vars

Drained == stdout = <<>> /\ bus = <<>>

\* 规则1: 进程退出且消息处理完后，会话不应仍显示为进行中或等待。
NoGhostLive == (Drained /\ exitEmitted /\ ~registry) =>
  (~meta.live /\ meta.st \notin {"working", "awaitingApproval", "awaitingAnswer"})
\* 规则2: 进程退出且消息处理完后，界面不应仍显示正在处理。
NoGhostStreaming == (Drained /\ exitEmitted) => ~feStreaming
\* 规则3: 存活进程上，只要界面还有待回答卡片，会话状态就应是等待。
CardsMatchStatus == (Drained /\ childAlive /\ feUi # {}) => meta.st \in {"awaitingApproval", "awaitingAnswer"}
\* 规则4: 进程存活且当前没有任何回合在跑时，会话不应显示处理中。
IdleNotWorking == (Drained /\ childAlive /\ ~childTurn) => meta.st # "working"
\* 规则5: 回合在跑时，会话要么处理中要么在等待用户。
RunningShowsBusy == (Drained /\ childAlive /\ childTurn) => meta.st \in {"working", "awaitingApproval", "awaitingAnswer"}
\* 规则6: 存活进程上，界面转圈与回合是否在跑一致。
SpinnerMatchesTurn == (Drained /\ childAlive) => (feStreaming = childTurn)
\* 规则7: 非零退出且处理完后，会话应显示出错。
BadExitShowsError == (Drained /\ exitEmitted /\ ~registry /\ exitBad /\ ~ext) => meta.st = "error"
\* 规则9: 等待用户回答只会出现在存活的会话上。
AwaitingNeedsProcess == (Drained /\ exitEmitted /\ meta.st \in {"awaitingApproval", "awaitingAnswer"}) => (childAlive /\ feUi # {})
=============================================================================
