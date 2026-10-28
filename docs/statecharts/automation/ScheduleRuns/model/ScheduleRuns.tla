------------------------------ MODULE ScheduleRuns ------------------------------
\* 定时任务（schedules）：到点领取、运行、结束、停用、删除的有限抽象。
\* 来源：src-tauri/src/schedules/{scheduler,runner,store,commands}.rs，db.rs 外键级联。
\* 一个任务、两个并发“令牌”（调度器 spawn_run 与手动 run_now），行为按代码原样建模。
EXTENDS Naturals

VARIABLES
  cadence,     \* Schedule.cadence：once / recurring（store.rs:65 next_run）
  enabled,     \* schedules.enabled（store.rs:9 列 enabled）
  due,         \* next_run_at 相对现在：none / future / due（store.rs:684-694）
  everRan,     \* schedules.last_run_at 是否有值（store.rs:663 record_run_start）
  hasRunRow,   \* schedule_runs 是否存在任何行（store.rs:387 count(*)）
  cap,         \* schedules.max_runs，0 表示 NULL（store.rs:459-462）
  runsDone,    \* schedules.runs_done，3 表示“3 次及以上”（store.rs:666）
  runCount,    \* status='running' 的 schedule_runs 行数（store.rs:787-793）
  exists,      \* schedules 行是否还在（store.rs:577 delete）
  sched,       \* 调度器令牌：idle / claimed / sawIdle（scheduler.rs:70-82, runner.rs:97-131）
  man,         \* 手动运行令牌：idle / sawIdle（runner.rs:43-95）
  lastStatus,  \* 最近一次运行状态（store.rs:387）
  startedAfterDelete \* 已删除任务是否仍启动了运行（runner.rs:120-131）

vars == <<cadence, enabled, due, everRan, hasRunRow, cap, runsDone, runCount, exists, sched, man, lastStatus, startedAfterDelete>>

Sat(n) == IF n >= 3 THEN 3 ELSE n + 1   \* 次数饱和抽象：只是模型上界

Capped == cap > 0 /\ runsDone >= cap \* store.rs:220 capped

Lifecycle ==   \* store.rs:216-236 derive_lifecycle（不含 end_at，本模型不建模结束时间）
  IF (IF cadence = "once" THEN (hasRunRow \/ everRan) ELSE Capped)
  THEN "completed"
  ELSE IF ~enabled THEN "paused" ELSE "active"

Init ==
  /\ cadence \in {"once", "recurring"}
  /\ enabled = TRUE
  /\ due = "future"
  /\ everRan = FALSE
  /\ hasRunRow = FALSE
  /\ cap \in (IF cadence = "once" THEN {0} ELSE {0, 2})   \* store.rs:459-462 once 不存上限
  /\ runsDone = 0
  /\ runCount = 0
  /\ exists = TRUE
  /\ sched = "idle"
  /\ man = "idle"
  /\ lastStatus = "none"
  /\ startedAfterDelete = FALSE

\* 一次运行真正开始后的计数与封顶（store.rs:663-675 record_run_start）
StartCount(done, c, en, d) ==
  LET nd == Sat(done)
      reached == c > 0 /\ nd >= c
  IN [runsDone |-> nd, enabled |-> IF reached THEN FALSE ELSE en, due |-> IF reached THEN "none" ELSE d]

TimeArrives ==
  /\ due = "future"   \* scheduler.rs:68 target_time <= now
  /\ due' = "due"
  /\ UNCHANGED <<cadence, enabled, everRan, hasRunRow, cap, runsDone, runCount, exists, sched, man, lastStatus, startedAfterDelete>>

SchedulerClaim ==
  /\ sched = "idle"                 \* 单个飞行中的调度令牌（模型界）：scheduler.rs:70-82
  /\ exists                         \* store.rs:684 FROM schedules
  /\ enabled                        \* store.rs:684 WHERE enabled = 1
  /\ due = "due"                    \* store.rs:690-694 next_run_at <= now
  /\ enabled' = (cadence /= "once") \* store.rs:631-654 once 先置 enabled=0
  /\ due' = IF cadence = "once" THEN "none" ELSE "future"   \* store.rs:633-642 advance_after_run
  /\ everRan' = TRUE                \* store.rs:647 last_run_at
  /\ sched' = "claimed"             \* runner.rs:35-40 spawn_run
  /\ UNCHANGED <<cadence, hasRunRow, cap, runsDone, runCount, exists, man, lastStatus, startedAfterDelete>>

ExecSkip ==
  /\ sched = "claimed"              \* runner.rs:97-98
  /\ runCount > 0                   \* runner.rs:103 has_active_run
  /\ exists                         \* runner.rs:106-113 create_run 需要外键
  /\ hasRunRow' = TRUE
  /\ lastStatus' = "skipped"        \* runner.rs:111-112
  /\ sched' = "idle"
  /\ UNCHANGED <<cadence, enabled, due, everRan, cap, runsDone, runCount, exists, man, startedAfterDelete>>

ExecCheck ==
  /\ sched = "claimed"              \* runner.rs:97-98
  /\ runCount = 0                   \* runner.rs:99-101 has_active_run=false
  /\ sched' = "sawIdle"             \* 检查与创建之间释放了数据库锁（runner.rs:98-122）
  /\ UNCHANGED <<cadence, enabled, due, everRan, hasRunRow, cap, runsDone, runCount, exists, man, lastStatus, startedAfterDelete>>

ExecCreate ==
  /\ sched = "sawIdle"              \* runner.rs:120-131
  /\ runCount' = IF exists THEN runCount + 1 ELSE runCount     \* runner.rs:122-129 create_run 外键失败被忽略
  /\ hasRunRow' = IF exists THEN TRUE ELSE hasRunRow           \* store.rs:734-738 INSERT
  /\ lastStatus' = IF exists THEN "running" ELSE lastStatus    \* runner.rs:126
  /\ startedAfterDelete' = (startedAfterDelete \/ ~exists)     \* runner.rs:137-148 继续启动会话，未检查任务是否还在
  /\ runsDone' = IF exists THEN StartCount(runsDone, cap, enabled, due).runsDone ELSE runsDone   \* store.rs:663-668
  /\ enabled' = IF exists THEN StartCount(runsDone, cap, enabled, due).enabled ELSE enabled      \* store.rs:669-672
  /\ due' = IF exists THEN StartCount(runsDone, cap, enabled, due).due ELSE due                  \* store.rs:669-672
  /\ sched' = "idle"
  /\ UNCHANGED <<cadence, everRan, cap, exists, man>>

ManualCheck ==
  /\ man = "idle"                   \* runner.rs:43
  /\ exists                         \* runner.rs:44-49 store::get 不存在则报错
  /\ runCount = 0                   \* runner.rs:51-58 has_active_run
  /\ man' = "sawIdle"               \* runner.rs:51-60 检查与创建之间释放锁
  /\ UNCHANGED <<cadence, enabled, due, everRan, hasRunRow, cap, runsDone, runCount, exists, sched, lastStatus, startedAfterDelete>>

ManualCreate ==
  /\ man = "sawIdle"                \* runner.rs:60-72
  /\ runCount' = IF exists THEN runCount + 1 ELSE runCount     \* runner.rs:63-71 create_run
  /\ hasRunRow' = IF exists THEN TRUE ELSE hasRunRow
  /\ lastStatus' = IF exists THEN "running" ELSE lastStatus
  /\ everRan' = IF exists THEN TRUE ELSE everRan                \* store.rs:666 record_run_start
  /\ runsDone' = IF exists THEN StartCount(runsDone, cap, enabled, due).runsDone ELSE runsDone   \* runner.rs:79 不检查上限
  /\ enabled' = IF ~exists THEN enabled
                ELSE IF cadence = "once" THEN FALSE ELSE StartCount(runsDone, cap, enabled, due).enabled   \* runner.rs:80-85
  /\ due' = IF ~exists THEN due
            ELSE IF cadence = "once" THEN "none" ELSE StartCount(runsDone, cap, enabled, due).due        \* runner.rs:80-85
  /\ man' = "idle"
  /\ UNCHANGED <<cadence, cap, exists, sched, startedAfterDelete>>

FinishOk ==
  /\ runCount > 0                   \* runner.rs:375-391 update_run
  /\ runCount' = runCount - 1
  /\ lastStatus' = "ok"             \* runner.rs:376-377
  /\ UNCHANGED <<cadence, enabled, due, everRan, hasRunRow, cap, runsDone, exists, sched, man, startedAfterDelete>>

FinishFail ==
  /\ runCount > 0                   \* runner.rs:139-148, 325-343 失败/超时/退出码
  /\ runCount' = runCount - 1
  /\ lastStatus' = "error"          \* runner.rs:378-380, 432-449
  /\ UNCHANGED <<cadence, enabled, due, everRan, hasRunRow, cap, runsDone, exists, sched, man, startedAfterDelete>>

UserDisable ==
  /\ exists                         \* store.rs:582-584 set_enabled
  /\ enabled                        \* store.rs:610 enabled 参数 false 仅对启用任务有意义
  /\ Lifecycle /= "completed"       \* ScheduleRow.tsx:254 已完成的任务其开关被禁用
  /\ enabled' = FALSE               \* store.rs:610-613
  /\ due' = "none"                  \* store.rs:605-607
  /\ UNCHANGED <<cadence, everRan, hasRunRow, cap, runsDone, runCount, exists, sched, man, lastStatus, startedAfterDelete>>

UserEnable ==
  /\ exists                                       \* store.rs:582-584
  /\ ~enabled                                     \* commands.rs:42-48 enabled=true
  /\ ~(cadence = "once" /\ (everRan \/ lastStatus /= "none"))   \* store.rs:586-590 已执行的一次性任务不可启用
  /\ ~Capped                                      \* store.rs:593-595 已达上限
  /\ enabled' = TRUE                              \* store.rs:610-613
  /\ due' \in {"future", "due"}                   \* store.rs:596-604 next_run_bounded（一次性过期时返回原时刻即立即到点）
  /\ UNCHANGED <<cadence, everRan, hasRunRow, cap, runsDone, runCount, exists, sched, man, lastStatus, startedAfterDelete>>

RescheduleOnce ==
  /\ exists                                       \* store.rs:464 prev 存在
  /\ cadence = "once"                             \* store.rs:468
  /\ ~enabled                                     \* store.rs:465 draft.enabled && !prev.enabled
  /\ everRan                                      \* store.rs:473-475 已执行过；换了新时刻则不拦截
  /\ enabled' = TRUE                              \* store.rs:499 enabled = draft.enabled && next_run_at.is_some()
  /\ due' = "future"                              \* store.rs:494 next_run_bounded 新的未来时刻
  /\ UNCHANGED <<cadence, everRan, hasRunRow, cap, runsDone, runCount, exists, sched, man, lastStatus, startedAfterDelete>>

RaiseCap ==
  /\ exists                                       \* store.rs:464
  /\ cadence = "recurring"                        \* store.rs:459-462 上限仅对重复任务
  /\ Capped                                       \* store.rs:480-482 已封顶后的编辑
  /\ ~enabled                                     \* store.rs:465
  /\ cap' = 0                                     \* store.rs:482 去掉上限后重新计算触发时间
  /\ enabled' = TRUE                              \* store.rs:499
  /\ due' = "future"                              \* store.rs:494
  /\ UNCHANGED <<cadence, everRan, hasRunRow, runsDone, runCount, exists, sched, man, lastStatus, startedAfterDelete>>

UserDelete ==
  /\ exists                                       \* commands.rs:23-29 schedules_delete
  /\ exists' = FALSE                              \* store.rs:577
  /\ enabled' = FALSE                             \* 行已删除
  /\ due' = "none"
  /\ runCount' = 0                                \* db.rs:615-623 ON DELETE CASCADE 删除运行记录
  /\ hasRunRow' = FALSE
  /\ UNCHANGED <<cadence, everRan, cap, runsDone, sched, man, lastStatus, startedAfterDelete>>

AppRestart ==
  /\ runCount > 0                                 \* store.rs:801-808 recover_stale_runs 只处理 running
  /\ runCount' = 0                                \* scheduler.rs:25-34 启动时收尾
  /\ lastStatus' = "error"                        \* store.rs:803-806 status='error'
  /\ sched' = "idle"                              \* 进程重启丢失内存中的令牌
  /\ man' = "idle"
  /\ UNCHANGED <<cadence, enabled, due, everRan, hasRunRow, cap, runsDone, exists, startedAfterDelete>>

Next == TimeArrives \/ SchedulerClaim \/ ExecSkip \/ ExecCheck \/ ExecCreate
        \/ ManualCheck \/ ManualCreate \/ FinishOk \/ FinishFail
        \/ UserDisable \/ UserEnable \/ RescheduleOnce \/ RaiseCap \/ UserDelete \/ AppRestart

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ cadence \in {"once", "recurring"} /\ enabled \in BOOLEAN /\ due \in {"none", "future", "due"}
  /\ cap \in {0, 2} /\ runsDone \in 0..3 /\ runCount \in 0..3

\* 同一个定时任务任何时刻最多只有一个正在运行的记录。
ActiveRunsAtMostOne == runCount <= 1

\* 界面上显示“已完成”的任务，不应仍处于启用并带有下一次触发时间的状态。
CompletedNeverScheduled == Lifecycle = "completed" => ~(enabled /\ due /= "none")

\* 设置了运行次数上限的任务，已运行次数不应超过上限。
RunsWithinCap == cap > 0 => runsDone <= cap

\* 已被删除的定时任务不应再启动新的运行。
NoRunAfterDelete == ~startedAfterDelete

\* 启用中的任务必须有下一次触发时间。
EnabledHasFireTime == (exists /\ enabled) => due /= "none"

\* 已停用的任务不应保留下一次触发时间。
DisabledNoFireTime == ~enabled => due = "none"

=============================================================================
