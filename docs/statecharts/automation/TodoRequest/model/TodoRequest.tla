------------------------------ MODULE TodoRequest ------------------------------
\* 待办队列中“审批/提问请求”待办的生命周期：弹出请求、用户回答、进程退出、对账收尾。
\* 来源：src-tauri/src/todos/{mod,store,detect}.rs。请求本身由运行时的 RPC 帧提供。
EXTENDS Naturals

VARIABLES
  live,       \* 会话 RPC 进程是否存活（detect.rs:473-474）
  uiPending,  \* RPC 中是否有未回答的对话框请求（detect.rs:475-481）
  uiTodo,     \* todos 行 dedupe_key=ui:{sid}:{rid} 的状态（detect.rs:19-21）
  detect,     \* 设置 system_detection（todos/mod.rs:24-26）
  fresh       \* 刚完成一次对账、之后没有新事件（detect.rs:467-497）

vars == <<live, uiPending, uiTodo, detect, fresh>>

Closed(s) == s \in {"done", "ignored"}

Init == /\ live = TRUE /\ uiPending = FALSE /\ uiTodo = "none" /\ detect = TRUE /\ fresh = FALSE

DialogRequest ==
  /\ live /\ ~uiPending                   \* detect.rs:129 收到 extension_ui_request 对话框帧
  /\ uiPending' = TRUE
  /\ uiTodo' = IF detect /\ uiTodo = "none" THEN "open" ELSE uiTodo   \* detect.rs:130-141 !enabled 直接返回；upsert(..., false)：已关闭的不重开（store.rs:198-205）
  /\ fresh' = FALSE
  /\ UNCHANGED <<live, detect>>

UiAnswered ==
  /\ uiPending                            \* detect.rs:149-155 UiResponded
  /\ uiPending' = FALSE
  /\ uiTodo' = IF uiTodo = "open" THEN "done" ELSE uiTodo   \* store.rs:226-232 resolve_key
  /\ fresh' = FALSE
  /\ UNCHANGED <<live, detect>>

ProcessExit ==
  /\ live                                 \* detect.rs:156-167 RpcProcess running=false
  /\ live' = FALSE
  /\ uiPending' = FALSE
  /\ uiTodo' = IF uiTodo = "open" THEN "done" ELSE uiTodo   \* store.rs:235-242 resolve_prefix
  /\ fresh' = FALSE
  /\ UNCHANGED <<detect>>

ProcessStart ==
  /\ ~live                                \* 会话被恢复，进程重新存活（rpc/mod.rs:324）
  /\ live' = TRUE
  /\ fresh' = FALSE
  /\ UNCHANGED <<uiPending, uiTodo, detect>>

UserIgnoreUi ==
  /\ uiTodo = "open"                      \* todos/mod.rs:37 action=ignore
  /\ uiTodo' = "ignored"                  \* store.rs:321-327
  /\ fresh' = FALSE
  /\ UNCHANGED <<live, uiPending, detect>>

UserDoneUi ==
  /\ uiTodo = "open"                      \* todos/mod.rs:36 action=done；非 Review 不通知运行时（mod.rs:50）
  /\ uiTodo' = "done"                     \* store.rs:321-327
  /\ fresh' = FALSE
  /\ UNCHANGED <<live, uiPending, detect>>

UserReopenUi ==
  /\ Closed(uiTodo)                       \* todos/mod.rs:38 action=reopen
  /\ uiTodo' = "open"                     \* store.rs:321-327
  /\ fresh' = FALSE
  /\ UNCHANGED <<live, uiPending, detect>>

ToggleDetection ==
  /\ detect' = ~detect                    \* settings.system_detection 可随时切换（todos/mod.rs:24-26）
  /\ fresh' = FALSE
  /\ UNCHANGED <<live, uiPending, uiTodo>>

Reconcile ==
  /\ ~fresh                               \* detect.rs:116-122 周期对账
  /\ uiTodo' =
       IF detect /\ live /\ uiPending /\ uiTodo = "none" THEN "open"        \* detect.rs:443-449 insert_absent
       ELSE IF uiTodo = "open" /\ ~live THEN "done"                          \* detect.rs:427-434 会话不存活
       ELSE IF uiTodo = "open" /\ live /\ ~uiPending THEN "done"            \* detect.rs:453-460 请求已不在 pending 且已超过 30 秒
       ELSE uiTodo
  /\ fresh' = TRUE
  /\ UNCHANGED <<live, uiPending, detect>>

Next == DialogRequest \/ UiAnswered \/ ProcessExit \/ ProcessStart \/ UserIgnoreUi
        \/ UserDoneUi \/ UserReopenUi \/ ToggleDetection \/ Reconcile

Spec == Init /\ [][Next]_vars

TypeOK == /\ live \in BOOLEAN /\ uiPending \in BOOLEAN /\ uiTodo \in {"none", "open", "done", "ignored"}

\* 对账之后，仍打开的“审批/提问”待办必须对应一个确实还在等待回答的请求。
UiOpenMatchesRequest == fresh => (uiTodo = "open" => (live /\ uiPending))

\* 开启系统检测并对账之后，确实待回答的请求不会没有待办。
RequestNeverMissed == (fresh /\ detect /\ live /\ uiPending) => uiTodo /= "none"

=============================================================================
