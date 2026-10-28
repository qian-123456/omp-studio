------------------------------ MODULE InboxVisibility ------------------------------
\* 一次定时运行结束后，在收件箱里的呈现：定时任务通知策略产生的待办，与运行所用会话本身带来的收件箱条目。
\* 来源：schedules/runner.rs:22-32,393-420；rpc/mod.rs:330-337（运行时：会话被标记为应用自有）；
\* catalog/status.rs:293-319（运行时：会话关注度）；src/features/inbox/attention.ts:63-109。
EXTENDS Naturals

VARIABLES
  policy,    \* 定时任务通知策略 all / important / none（contracts.rs ScheduleNotify，runner.rs:22）
  outcome,   \* 本次运行结果 none / ok / fail（runner.rs:376-380）
  attn,      \* 运行中是否停下来等过审批或回答（runner.rs:293,317-320）
  hasSess,   \* 运行是否已经拿到会话（runner.rs:246 / 失败发生在启动前则没有）
  sessRow,   \* 收件箱中该会话自身的条目是否显示（attention.ts:75-81）
  todoRow    \* 收件箱中的运行结果待办 none / open / done（runner.rs:414, attention.ts:88-90）

vars == <<policy, outcome, attn, hasSess, sessRow, todoRow>>

ShouldTodo(ok, a) ==   \* runner.rs:22-32 should_create_inbox_todo
  IF policy = "all" THEN TRUE ELSE IF policy = "important" THEN (~ok \/ a) ELSE FALSE

Init ==
  /\ policy \in {"all", "important", "none"} /\ outcome = "none" /\ attn \in BOOLEAN
  /\ hasSess = FALSE /\ sessRow = FALSE /\ todoRow = "none"

\* 会话跑完（待验收或空闲），会话是否出现在收件箱由运行时的关注度决定（此处作为外部输入，两种都可能）
RunOkWithSession ==
  /\ outcome = "none"                                  \* runner.rs:299-345 等待结束
  /\ outcome' = "ok" /\ hasSess' = TRUE                \* runner.rs:305-312 Review/Idle 视为成功
  /\ \E shown \in BOOLEAN : sessRow' = shown           \* catalog/status.rs:315 Review 为 Unread；rpc/mod.rs:334 会话为应用自有
  /\ todoRow' = IF ShouldTodo(TRUE, attn) THEN "open" ELSE "none"   \* runner.rs:393-414
  /\ UNCHANGED <<policy, attn>>

RunFailWithSession ==
  /\ outcome = "none"                                  \* runner.rs:299-345
  /\ outcome' = "fail" /\ hasSess' = TRUE              \* runner.rs:313-315,325-343 Error/Interrupted/退出非零/超时
  /\ sessRow' = TRUE                                   \* catalog/status.rs:303-311 出错未查看则为 Error 关注度
  /\ todoRow' = IF ShouldTodo(FALSE, attn) THEN "open" ELSE "none"  \* runner.rs:393-414
  /\ UNCHANGED <<policy, attn>>

RunFailBeforeSession ==
  /\ outcome = "none"                                  \* runner.rs:138-148,163-168,223-241
  /\ outcome' = "fail"                                 \* finish_with_error，没有会话
  /\ todoRow' = IF ShouldTodo(FALSE, FALSE) THEN "open" ELSE "none"  \* runner.rs:452
  /\ UNCHANGED <<policy, attn, hasSess, sessRow>>

UserViewsSession ==
  /\ sessRow                                           \* 用户打开该会话（last_seen_at 更新）
  /\ sessRow' = FALSE                                  \* catalog/status.rs:305-309 已查看则不再算
  /\ UNCHANGED <<policy, outcome, attn, hasSess, todoRow>>

UserDoneTodo ==
  /\ todoRow = "open"                                  \* todos/mod.rs:34-48
  /\ todoRow' = "done"                                 \* store.rs:321-327
  /\ UNCHANGED <<policy, outcome, attn, hasSess, sessRow>>

Next == RunOkWithSession \/ RunFailWithSession \/ RunFailBeforeSession \/ UserViewsSession \/ UserDoneTodo

Spec == Init /\ [][Next]_vars

TypeOK == policy \in {"all", "important", "none"} /\ outcome \in {"none", "ok", "fail"} /\ todoRow \in {"none", "open", "done"}

\* 通知策略选“不放入收件箱”时，这次运行不应在收件箱里出现任何条目。
NoneMeansNothingInInbox == (policy = "none") => ~(sessRow \/ todoRow = "open")

\* 通知策略选“仅在失败或需要审批时提醒”时，顺利完成且没停下来过的运行不应出现在收件箱里。
ImportantOnlyWhenNeeded == (policy = "important" /\ outcome = "ok" /\ ~attn) => ~(sessRow \/ todoRow = "open")

\* 同一次运行的结果不应同时以两个条目出现在收件箱。
OneEntryPerRun == ~(sessRow /\ todoRow = "open")

=============================================================================
