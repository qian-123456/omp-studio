---- MODULE ForkPlanState ----
\* Full-session fork cut at the last complete turn versus the plan-mode entries the extension persists.
EXTENDS Naturals, Sequences
VARIABLES transcript, forkMode, forkPlanOn

vars == <<transcript, forkMode, forkPlanOn>>
Entry == {"answer", "planOn", "planOff"}

TypeOK ==
  /\ transcript \in Seq(Entry)
  /\ Len(transcript) <= 4
  /\ forkMode \in {"none", "lastComplete"}
  /\ forkPlanOn \in {"unknown", "on", "off"}

RECURSIVE LastIndex(_, _)
\* Index of the last entry satisfying the type, 0 when none.
LastIndex(s, kind) == IF s = <<>> THEN 0
  ELSE IF s[Len(s)] = kind THEN Len(s) ELSE LastIndex(SubSeq(s, 1, Len(s) - 1), kind)

\* omp-workspace-plan.ts:453-459 session_start reads the latest plan-state entry; none means off (omp-workspace-plan.ts:353).
PlanOnIn(s) ==
  LET a == LastIndex(s, "planOn") IN LET b == LastIndex(s, "planOff") IN a > b

\* forkcut.rs:100-118 complete_prefix_len keeps lines up to the last final assistant message;
\* forkcut.rs:115-118 with no complete turn only entries before the first message stay (none exist here before an answer).
CutLen(s) == IF LastIndex(s, "answer") > 0 THEN LastIndex(s, "answer") ELSE Len(s)

\* The extension persists its state after commands and turns (omp-workspace-plan.ts:357,429,444,519).
AppendPlanOn ==
  /\ forkMode = "none"  \* fork.rs:31-39 model records parent history before the single fork.
  /\ Len(transcript) < 4
  /\ transcript' = Append(transcript, "planOn")  \* omp-workspace-plan.ts:429
  /\ UNCHANGED <<forkMode, forkPlanOn>>

AppendPlanOff ==
  /\ forkMode = "none"  \* fork.rs:31-39 model records parent history before the single fork.
  /\ Len(transcript) < 4
  /\ transcript' = Append(transcript, "planOff")  \* omp-workspace-plan.ts:444
  /\ UNCHANGED <<forkMode, forkPlanOn>>

AppendAnswer ==
  /\ forkMode = "none"  \* fork.rs:31-39 model records parent history before the single fork.
  /\ Len(transcript) < 4
  /\ transcript' = Append(transcript, "answer")
  /\ UNCHANGED <<forkMode, forkPlanOn>>

\* fork.rs:31-35 fork_session without a pinned entry cuts at the last complete turn; fork.rs:36-39 loads the cut copy; plain fork keeps plan state (forkcut.rs:203-207).
ForkSession ==
  /\ forkMode = "none"
  /\ transcript # <<>>  \* forkcut.rs:100-118 bounded nonempty transcript fixture.
  /\ forkMode' = "lastComplete"
  /\ forkPlanOn' = IF PlanOnIn(SubSeq(transcript, 1, CutLen(transcript))) THEN "on" ELSE "off"
  /\ UNCHANGED transcript

Init == transcript = <<>> /\ forkMode = "none" /\ forkPlanOn = "unknown"
ReaderAct == AppendPlanOn \/ AppendPlanOff \/ AppendAnswer \/ ForkSession
Next == ReaderAct
Spec == Init /\ [][Next]_vars

\* 完整复制出的分支会话，计划模式的开关与父会话此刻一致。
ForkKeepsParentPlanMode == (forkMode = "lastComplete") => ((forkPlanOn = "on") = PlanOnIn(transcript))
====
