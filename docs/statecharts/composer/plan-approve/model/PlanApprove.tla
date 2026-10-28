---- MODULE PlanApprove ----
\* Approving a reviewed plan with "fresh context" (execute) mode.
EXTENDS Naturals
VARIABLES s_enabled, planFile, approveBusy, execSession, approveFailed, retriesPossible

vars == <<s_enabled, planFile, approveBusy, execSession, approveFailed, retriesPossible>>

TypeOK ==
  /\ s_enabled \in BOOLEAN
  /\ planFile \in {"none", "written"}
  /\ approveBusy \in {"idle", "exitSent", "exited", "failed"}
  /\ execSession \in {"none", "started"}
  /\ approveFailed \in BOOLEAN
  /\ retriesPossible \in BOOLEAN

\* PlanPanel.tsx:56 the review dock only exists while plan mode is enabled; PlanPanel.tsx:57 needs content.
dockVisible == s_enabled /\ planFile = "written"

\* Reader presses approve (PlanPanel.tsx:471-481, planActions.ts:29-52).
ClickApprove ==
  /\ dockVisible  \* PlanPanel.tsx:56-61
  /\ approveBusy = "idle"  \* PlanPanel.tsx:522 disabled while busy
  /\ approveBusy' = "exitSent"  \* planActions.ts:48 sends /plan-action approve execute
  /\ UNCHANGED <<s_enabled, planFile, execSession, approveFailed, retriesPossible>>

\* The extension leaves plan mode and publishes enabled:false (omp-workspace-plan.ts:604-621, 434-446, 372-374).
ExtensionExits ==
  /\ approveBusy = "exitSent"
  /\ s_enabled
  /\ s_enabled' = FALSE
  /\ approveBusy' = "exited"
  /\ UNCHANGED <<planFile, execSession, approveFailed, retriesPossible>>

\* A fresh session starts and runs the plan file (planActions.ts:49-52).
CreateSessionOk ==
  /\ approveBusy = "exited"
  /\ execSession' = "started"
  /\ approveBusy' = "idle"
  /\ UNCHANGED <<s_enabled, planFile, approveFailed, retriesPossible>>

\* Creating the session fails after plan mode was already left (planActions.ts:49 throws, PlanPanel.tsx:476-477 toasts).
CreateSessionFails ==
  /\ approveBusy = "exited"
  /\ approveFailed' = TRUE
  /\ approveBusy' = "idle"
  /\ UNCHANGED <<s_enabled, planFile, execSession, retriesPossible>>

\* Reader turns plan mode on again from the composer (PlanPanel.tsx:66-67, omp-workspace-plan.ts:414-430).
ReEnablePlan ==
  /\ ~s_enabled
  /\ approveBusy = "idle"  \* PlanPanel.tsx:66-67, bounded sequential re-enable abstraction.
  /\ s_enabled' = TRUE
  /\ planFile' = "none"  \* omp-workspace-plan.ts:417-424 enter() resets content and version
  /\ UNCHANGED <<approveBusy, execSession, approveFailed, retriesPossible>>

\* A planning turn ends and the plan file is found again (omp-workspace-plan.ts:518).
PlanRepublished ==
  /\ s_enabled  \* omp-workspace-plan.ts:518
  /\ planFile = "none"
  /\ planFile' = "written"
  /\ UNCHANGED <<s_enabled, approveBusy, execSession, approveFailed, retriesPossible>>

Init ==
  /\ s_enabled = TRUE /\ planFile = "written" /\ approveBusy = "idle" /\ execSession = "none"
  /\ approveFailed = FALSE /\ retriesPossible = FALSE

ReaderAct == ClickApprove \/ ReEnablePlan \/ PlanRepublished
System == ExtensionExits \/ CreateSessionOk \/ CreateSessionFails
Next == ReaderAct \/ System
Spec == Init /\ [][Next]_vars
Settled == ~ENABLED System

\* 批准失败并提示错误后，用户仍能在计划面板里直接重试批准。
FailedApprovalCanRetryAtOnce == (approveFailed /\ approveBusy = "idle" /\ execSession = "none") => dockVisible
====
