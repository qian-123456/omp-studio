------------------------------ MODULE Ownership ------------------------------
\* 会话占用与挂起模型 (from-spec)：状态文件 / 外部进程 / 本应用进程 / 挂起标记 对"被外部占用""已挂起"显示的影响。
EXTENDS Naturals

VARIABLES
  statusFile,   \* extension/omp-workspace-status.ts:52-70 写出的状态文件: none / working / exited
  pidAlive,     \* catalog/external.rs:99 pid_alive(kill(pid,0)) 的结果
  pidIsOmp,     \* 该 pid 实际是否还是 omp 终端进程 (操作系统事实, 代码不校验)
  appAlive,     \* rpc/mod.rs:570 is_live: 本应用持有句柄与子进程
  suspendedDb,  \* session_meta.suspended (rpc/mod.rs:688)
  stopPending,  \* 空闲回收已关闭进程, 但尚未写挂起标记 (rpc/mod.rs:189-228)
  meta          \* catalog/mod.rs:517-520 缓存的显示结果: [st, live]

vars == <<statusFile, pidAlive, pidIsOmp, appAlive, suspendedDb, stopPending, meta>>

ExtNow == statusFile = "working" /\ pidAlive       \* external.rs:123-129 状态文件非 exited 且 pid 存活 => 外部占用

Show(live, ext, susp) ==                          \* status.rs:249-278 的相关分支
  IF live THEN "live" ELSE IF ext THEN "external" ELSE IF susp THEN "suspended" ELSE "idle"

Init == /\ statusFile = "none" /\ pidAlive = FALSE /\ pidIsOmp = FALSE /\ appAlive = FALSE
        /\ suspendedDb = FALSE /\ stopPending = FALSE /\ meta = [st |-> "idle", live |-> FALSE]

ExternalOmpStarts ==
  /\ ~appAlive /\ statusFile # "working"          \* 终端 omp 在本应用没持有时启动 (rpc/mod.rs:400-418 ensure_not_held 的对偶)
  /\ statusFile' = "working" /\ pidAlive' = TRUE /\ pidIsOmp' = TRUE   \* omp-workspace-status.ts:104-107 session_start 写 idle/working
  /\ UNCHANGED <<appAlive, suspendedDb, stopPending, meta>>

ExternalOmpExitsCleanly ==
  /\ statusFile = "working" /\ pidAlive /\ pidIsOmp   \* omp-workspace-status.ts:131-134 session_shutdown 写 exited
  /\ statusFile' = "exited" /\ pidAlive' = FALSE
  /\ UNCHANGED <<pidIsOmp, appAlive, suspendedDb, stopPending, meta>>

ExternalOmpKilled ==
  /\ pidAlive                                    \* 环境事件：任何被记录的进程可被强制关闭，不假定它仍是 omp
  /\ pidAlive' = FALSE
  /\ UNCHANGED <<statusFile, pidIsOmp, appAlive, suspendedDb, stopPending, meta>>

PidReusedByOtherProgram ==
  /\ ~pidAlive                                   \* 环境事件：PID 复用与状态文件内容无关；文件仅在后续检测时被读取
  /\ pidAlive' = TRUE /\ pidIsOmp' = FALSE
  /\ UNCHANGED <<statusFile, appAlive, suspendedDb, stopPending, meta>>

ExternalCheckLoop ==                              \* catalog/tasks.rs:218-250 周期检查
  /\ ~appAlive                                   \* src-tauri/src/catalog/status.rs:249-278 仅此模型的非本应用存活分支；不是定时器全局守卫
  /\ LET st == Show(FALSE, ExtNow, suspendedDb) IN meta' = [st |-> st, live |-> FALSE]   \* external.rs:110-131 + mod.rs:497-503
  /\ (meta.st = "external") # ExtNow                                                   \* tasks.rs:244-250 只有外部占用映射变化才重算
  /\ UNCHANGED <<statusFile, pidAlive, pidIsOmp, appAlive, suspendedDb, stopPending>>

UserOpenSession ==                                 \* rpc/mod.rs:437-492 ensure_live
  /\ ~appAlive                                   \* src-tauri/src/rpc/mod.rs:442-450 已存活则直接返回；未存活的启动分支没有 stopPending 守卫
  /\ ~ExtNow                                       \* rpc/mod.rs:400-418 ensure_not_held: 外部占用则拒绝 SESSION_HELD
  /\ appAlive' = TRUE /\ suspendedDb' = FALSE      \* rpc/mod.rs:352-354 registry.insert, rpc/mod.rs:490
  /\ meta' = [st |-> "live", live |-> TRUE]
  /\ UNCHANGED <<statusFile, pidAlive, pidIsOmp, stopPending>>

UserTakeover ==                                    \* rpc/mod.rs:618-627 takeover_external
  /\ meta.st = "external"                       \* src-tauri/src/rpc/mod.rs:622-624 终止子步骤读取缓存 external_pid；不额外要求当前 ExtNow 或本应用已退出
  /\ pidIsOmp                                      \* rpc/mod.rs:651-657 pid_looks_like_omp: 非 omp 进程不会被终止
  /\ pidAlive' = FALSE                             \* rpc/mod.rs:630-648 terminate_pid
  /\ UNCHANGED <<statusFile, pidIsOmp, appAlive, suspendedDb, stopPending, meta>>

IdleReclaim ==                                     \* rpc/mod.rs:189-280 空闲回收
  /\ appAlive                                      \* rpc/mod.rs:178 handle.alive
  /\ appAlive' = FALSE /\ stopPending' = TRUE      \* rpc/mod.rs:277 shutdown.send(true)
  /\ UNCHANGED <<statusFile, pidAlive, pidIsOmp, suspendedDb, meta>>

ExitEventRecompute ==                              \* process.rs:994 退出事件 -> tasks.rs:330 重算
  /\ ~appAlive /\ meta.live                     \* src-tauri/src/rpc/process.rs:994-1004 running=false 事件之后；仅保留改变缓存的分支
  /\ meta' = [st |-> Show(FALSE, ExtNow, suspendedDb), live |-> FALSE]
  /\ UNCHANGED <<statusFile, pidAlive, pidIsOmp, appAlive, suspendedDb, stopPending>>

WriteSuspendedFlag ==                              \* rpc/mod.rs:224 set_suspended(true): 只更新数据库, 不触发重算 (rpc/mod.rs:688-694)
  /\ stopPending
  /\ suspendedDb' = TRUE /\ stopPending' = FALSE
  /\ UNCHANGED <<statusFile, pidAlive, pidIsOmp, appAlive, meta>>

Next == ExternalOmpStarts \/ ExternalOmpExitsCleanly \/ ExternalOmpKilled \/ PidReusedByOtherProgram
        \/ ExternalCheckLoop \/ UserOpenSession \/ UserTakeover \/ IdleReclaim \/ ExitEventRecompute \/ WriteSuspendedFlag
Spec == Init /\ [][Next]_vars

TypeOK == statusFile \in {"none", "working", "exited"} /\ meta.st \in {"idle", "live", "external", "suspended"}

Settled == ~ENABLED (ExternalCheckLoop \/ ExitEventRecompute \/ WriteSuspendedFlag)

\* 规则1: 周期检查跟上之后，会话显示被外部占用时，占用者必须真是一个仍在运行的 omp 终端。
ExternalIsRealOmp == (Settled /\ meta.st = "external") => (pidAlive /\ pidIsOmp)
\* 规则2: 空闲回收完成且显示刷新后，会话应显示已挂起。
SuspendShown == (Settled /\ ~appAlive /\ ~stopPending /\ ~ExtNow /\ suspendedDb) => meta.st = "suspended"
=============================================================================
