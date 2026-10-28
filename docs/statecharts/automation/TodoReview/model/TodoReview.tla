------------------------------ MODULE TodoReview ------------------------------
\* 待办队列（todos）中“会话待验收”待办的生命周期：产生、用户处理、对账收尾。
\* 来源：src-tauri/src/todos/{mod,store,detect}.rs。会话状态由运行时提供，这里只当作输入。
EXTENDS Naturals

VARIABLES
  sess,        \* 会话状态 working / review / idle（SessionStatus，detect.rs:223-227）
  reviewTodo,  \* todos 行 dedupe_key=review:{sid} 的状态（detect.rs:84-91）
  detect,      \* 设置 system_detection（todos/mod.rs:24-26）
  fresh        \* 刚完成一次对账、之后没有新事件（detect.rs:467-497）

vars == <<sess, reviewTodo, detect, fresh>>

Closed(s) == s \in {"done", "ignored"}

Init == /\ sess = "working" /\ reviewTodo = "none" /\ detect = TRUE /\ fresh = FALSE

TurnEndsReview ==
  /\ sess = "working"                     \* detect.rs:223-224 new=Review 由运行时给出
  /\ sess' = "review"
  /\ reviewTodo' = IF detect THEN "open" ELSE reviewTodo   \* detect.rs:229,237 !enabled 直接返回；upsert(..., true) 会重开已关闭的
  /\ fresh' = FALSE
  /\ UNCHANGED <<detect>>

NewTurn ==
  /\ sess \in {"review", "idle"}          \* detect.rs:168-172 PromptSent
  /\ sess' = "working"
  /\ reviewTodo' = IF reviewTodo = "open" THEN "done" ELSE reviewTodo   \* store.rs:245-259 resolve_session_kinds
  /\ fresh' = FALSE
  /\ UNCHANGED <<detect>>

UserAcceptReview ==
  /\ reviewTodo = "open"                  \* todos/mod.rs:34-48 act(done)
  /\ sess = "review"                      \* todos/mod.rs:50-54 只有 Review 待办才发出 SessionAccepted
  /\ reviewTodo' = "done"                 \* store.rs:321-327 set_status
  /\ sess' = "idle"                       \* 运行时收到 SessionAccepted 后离开待验收（外部输入，非本模块）
  /\ fresh' = FALSE
  /\ UNCHANGED <<detect>>

UserIgnoreReview ==
  /\ reviewTodo = "open"                  \* todos/mod.rs:37 action=ignore
  /\ reviewTodo' = "ignored"              \* store.rs:321-327
  /\ fresh' = FALSE
  /\ UNCHANGED <<sess, detect>>

UserReopenReview ==
  /\ Closed(reviewTodo)                   \* todos/mod.rs:38 action=reopen，不检查原因是否还在
  /\ reviewTodo' = "open"                 \* store.rs:321-327
  /\ fresh' = FALSE
  /\ UNCHANGED <<sess, detect>>

ToggleDetection ==
  /\ detect' = ~detect                    \* settings.system_detection 可随时切换（todos/mod.rs:24-26）
  /\ fresh' = FALSE
  /\ UNCHANGED <<sess, reviewTodo>>

Reconcile ==
  /\ ~fresh                               \* detect.rs:116-122 周期对账
  /\ reviewTodo' =
       IF detect /\ sess = "review" /\ reviewTodo = "none" THEN "open"      \* detect.rs:353-361 insert_absent
       ELSE IF reviewTodo = "open" /\ sess /= "review" THEN "done"          \* detect.rs:388-400 !still_pending 则收尾
       ELSE reviewTodo
  /\ fresh' = TRUE
  /\ UNCHANGED <<sess, detect>>

Next == TurnEndsReview \/ NewTurn \/ UserAcceptReview \/ UserIgnoreReview
        \/ UserReopenReview \/ ToggleDetection \/ Reconcile

Spec == Init /\ [][Next]_vars

TypeOK == /\ sess \in {"working", "review", "idle"} /\ reviewTodo \in {"none", "open", "done", "ignored"}

\* 对账之后，仍打开的“待验收”待办必须对应一个确实待验收的会话。
ReviewOpenMatchesSession == fresh => (reviewTodo = "open" => sess = "review")

\* 开启系统检测并对账之后，确实待验收的会话不会没有待办。
ReviewNeverMissed == (fresh /\ detect /\ sess = "review") => reviewTodo /= "none"

\* 会话验收后，旧的待验收待办不会仍处于待处理。
AcceptedNotPending == (sess = "idle" /\ fresh) => reviewTodo /= "open"

=============================================================================
