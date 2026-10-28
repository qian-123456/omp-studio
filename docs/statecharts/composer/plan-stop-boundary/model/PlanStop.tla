---- MODULE PlanStop ----
\* Bundled plan extension: turn end, hidden "write the plan" reminder and the user stop.
EXTENDS Naturals
CONSTANT StopMarksAborted
VARIABLES s_enabled, turn, planFileFound, reminders, lastStopReason, stoppedByUser, restartedAfterStop, stopClicks

vars == <<s_enabled, turn, planFileFound, reminders, lastStopReason, stoppedByUser, restartedAfterStop, stopClicks>>

TypeOK ==
  /\ s_enabled \in BOOLEAN
  /\ turn \in {"idle", "user", "reminder"}
  /\ planFileFound \in BOOLEAN
  /\ reminders \in 0..2
  /\ lastStopReason \in {"none", "stop", "aborted", "other"}
  /\ stoppedByUser \in BOOLEAN
  /\ restartedAfterStop \in BOOLEAN
  /\ stopClicks \in 0..3

\* omp-workspace-plan.ts:80-82: remind only when no plan file, reminders left and not aborted.
\* omp-workspace-plan.ts:67 REMINDER_MAX is 1; omp-workspace-plan.ts:70-77 reads the latest assistant stopReason.
ShouldRemind(found, reason) == ~found /\ reminders < 1 /\ reason # "aborted"

\* The turn ends: agent_end handler (omp-workspace-plan.ts:516-525).
TurnEnd(reason, userStop) ==
  /\ s_enabled  \* omp-workspace-plan.ts:517
  /\ s_enabled' = s_enabled
  /\ planFileFound' = planFileFound  \* omp-workspace-plan.ts:518 refreshPlan finds the file
  /\ lastStopReason' = reason
  /\ IF ShouldRemind(planFileFound, reason)
       THEN /\ reminders' = reminders + 1  \* omp-workspace-plan.ts:522
            /\ turn' = "reminder"  \* omp-workspace-plan.ts:523 triggerTurn true
            /\ restartedAfterStop' = (restartedAfterStop \/ userStop)
       ELSE /\ turn' = "idle"
            /\ UNCHANGED <<reminders, restartedAfterStop>>
  /\ stoppedByUser' = userStop

\* Reader sends a message in plan mode (omp-workspace-plan.ts:511-514 resets reminders).
SendMessage ==
  /\ turn = "idle"
  /\ s_enabled  \* omp-workspace-plan.ts:511-514
  /\ turn' = "user"
  /\ reminders' = 0
  /\ stoppedByUser' = FALSE
  /\ UNCHANGED <<s_enabled, planFileFound, lastStopReason, restartedAfterStop, stopClicks>>

\* The model writes the plan file during a turn (omp-workspace-plan.ts:401-411 later finds it).
ModelWritesPlan ==
  /\ turn # "idle"  \* omp-workspace-plan.ts:401-411 discovers file written during generation.
  /\ ~planFileFound
  /\ planFileFound' = TRUE
  /\ UNCHANGED <<s_enabled, turn, reminders, lastStopReason, stoppedByUser, restartedAfterStop, stopClicks>>

\* The turn ends by itself.
ModelFinishes ==
  /\ turn # "idle"
  /\ TurnEnd("stop", FALSE)
  /\ UNCHANGED stopClicks

\* Reader clicks stop (Composer.tsx:1625, send.ts:200); the last message is aborted when the runtime says so.
UserStopsTurn ==
  /\ turn # "idle"
  /\ stopClicks < 3
  /\ stopClicks' = stopClicks + 1
  /\ TurnEnd(IF StopMarksAborted THEN "aborted" ELSE "other", TRUE)

Init ==
  /\ s_enabled = TRUE /\ turn = "idle" /\ planFileFound = FALSE /\ reminders = 0
  /\ lastStopReason = "none" /\ stoppedByUser = FALSE /\ restartedAfterStop = FALSE /\ stopClicks = 0

ReaderAct == SendMessage \/ UserStopsTurn
System == ModelWritesPlan \/ ModelFinishes
Next == ReaderAct \/ System
Spec == Init /\ [][Next]_vars
Settled == ~ENABLED System

\* 用户点击停止后，系统不会悄悄再发一轮“写计划”的提醒。
StopDoesNotRestartGeneration == ~restartedAfterStop

====
