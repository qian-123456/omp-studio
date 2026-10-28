---- MODULE PlanPreview ----
\* Composer model-chip lifecycle for an unsent /plan chip versus backend plan mode.
EXTENDS Naturals
CONSTANT ConfigReloads
VARIABLES chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
          planAppliedRef, planModelApplied, modelRoleFile, statusPlanModel, extSettingsRole,
          ompProcessModel, draftModel, draftBeforePreview, readFlight, saveFlight

vars == <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
          planAppliedRef, planModelApplied, modelRoleFile, statusPlanModel, extSettingsRole,
          ompProcessModel, draftModel, draftBeforePreview, readFlight, saveFlight>>

Roles == {"A", "B"}
Maybe == {"none", "A", "B"}
Idle == [st |-> "idle", gen |-> 0, val |-> "none", cancelled |-> FALSE]
NoSave == [st |-> "idle", visit |-> 0, value |-> "none"]

TypeOK ==
  /\ chip \in {"none", "plan"}
  /\ planSend \in {"none", "sending"}
  /\ planMode \in BOOLEAN
  /\ planEditState \in Maybe
  /\ planRolesState \in Maybe
  /\ planVisit \in Nat
  /\ planRolesWrite \in Nat
  /\ planAppliedRef \in BOOLEAN
  /\ planModelApplied \in BOOLEAN
  /\ modelRoleFile \in Roles
  /\ statusPlanModel \in Maybe
  /\ extSettingsRole \in Roles
  /\ ompProcessModel \in {"O", "A", "B"}
  /\ draftModel \in {"O", "X"}
  /\ draftBeforePreview \in {"O", "X"}

\* Composer.tsx:586 backend plan mode, Composer.tsx:589-590 unsent chip counts as planning intent.
planPreview == planMode \/ chip = "plan"

\* planModelChoice.ts:49 precedence edit > status spec > effective role; Composer.tsx:859 passes
\* the status spec only while the backend is in plan mode; planModelChoice.ts:50 none resolves to null.
planChoice ==
  IF ~planPreview THEN "none"
  ELSE IF planEditState # "none" THEN planEditState
  ELSE IF planMode /\ statusPlanModel # "none" THEN statusPlanModel
  ELSE planRolesState

\* Composer.tsx:880 the chip shows planChoice else the ordinary session/draft model.
shownModel == IF planChoice # "none" THEN planChoice ELSE draftModel

\* Monotone counters; HistoryBound excludes states beyond two visits/writes, never reuses ownership tokens.
\* Composer.tsx:1041-1053 effect on [planMode, planPreview, sessionId]: bumps visit, drops edit
\* and (when preview ends) the roles snapshot; Composer.tsx:884-894 read effect cancels/starts a read.
Transition(m, c) ==
  LET pv == m \/ c = "plan"
      changed == (m # planMode) \/ (pv # planPreview)
      readChanged == pv # planPreview
  IN /\ planMode' = m
     /\ chip' = c
     /\ planVisit' = IF changed THEN planVisit + 1 ELSE planVisit
     /\ planEditState' = IF changed THEN "none" ELSE planEditState
     /\ planModelApplied' = IF m THEN planModelApplied ELSE FALSE
     /\ planAppliedRef' = IF changed THEN (m /\ planModelApplied /\ m) ELSE planAppliedRef
     /\ planRolesState' = IF changed /\ ~pv THEN "none" ELSE planRolesState
     /\ readFlight' =
          IF ~readChanged THEN readFlight
          ELSE IF pv THEN [st |-> "asked", gen |-> planRolesWrite, val |-> "none", cancelled |-> FALSE]
          ELSE [readFlight EXCEPT !.cancelled = (readFlight.st # "idle")]

\* Reader selects /plan from the slash menu; Composer.tsx:1284 sets the chip.
SelectPlanChip ==
  /\ chip = "none"
  /\ planSend = "none"  \* Composer.tsx:1284,1414 bounded non-overlapping slash dispatch.
  /\ Transition(planMode, "plan")
  /\ draftBeforePreview' = draftModel
  /\ UNCHANGED <<planSend, planRolesWrite, modelRoleFile, statusPlanModel, extSettingsRole,
                 ompProcessModel, draftModel, saveFlight>>

\* Reader deletes the chip (Composer.tsx:2080/2101/2308).
RemovePlanChip ==
  /\ chip = "plan"
  /\ Transition(planMode, "none")
  /\ UNCHANGED <<planSend, planRolesWrite, modelRoleFile, statusPlanModel, extSettingsRole,
                 ompProcessModel, draftModel, draftBeforePreview, saveFlight>>

\* Reader picks an ordinary model while no planning intent exists (Composer.tsx:1000-1003 stages it).
OrdinaryPick ==
  /\ ~planPreview  \* Composer.tsx:1000-1003 ordinary picker path.
  /\ planSend = "none"  \* Composer.tsx:1414 bounded non-overlapping slash dispatch.
  /\ draftModel' = IF draftModel = "O" THEN "X" ELSE "O"
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
                 planAppliedRef, planModelApplied, modelRoleFile, statusPlanModel, extSettingsRole,
                 ompProcessModel, draftBeforePreview, readFlight, saveFlight>>

\* Reader picks a model for the plan role (Composer.tsx:1023 preview or plan mode; 1026 captures visit).
PickPlanModel ==
  /\ planPreview  \* Composer.tsx:1023
  /\ saveFlight.st = "idle"
  /\ \E v \in Roles : saveFlight' = [st |-> "started", visit |-> planVisit, value |-> v]
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
                 planAppliedRef, planModelApplied, modelRoleFile, statusPlanModel, extSettingsRole,
                 ompProcessModel, draftModel, draftBeforePreview, readFlight>>

\* Backend writes the role config (Composer.tsx:965); whether the running omp process sees it is a boundary.
WriteRoleFile ==
  /\ saveFlight.st = "started"
  /\ modelRoleFile' = saveFlight.value
  /\ extSettingsRole' = IF ConfigReloads THEN saveFlight.value ELSE extSettingsRole
  /\ saveFlight' = [saveFlight EXCEPT !.st = "written"]
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
                 planAppliedRef, planModelApplied, statusPlanModel, ompProcessModel, draftModel,
                 draftBeforePreview, readFlight>>

\* The write reply reaches the composer (Composer.tsx:966-1034).
WriteReplyArrives ==
  /\ saveFlight.st = "written"
  /\ planRolesWrite' = planRolesWrite + 1  \* Composer.tsx:966
  /\ planRolesState' = IF planVisit = saveFlight.visit THEN saveFlight.value ELSE planRolesState  \* Composer.tsx:967
  /\ planEditState' = IF planVisit = saveFlight.visit THEN saveFlight.value ELSE planEditState  \* Composer.tsx:1028,1032
  /\ planAppliedRef' = IF planVisit = saveFlight.visit THEN TRUE ELSE planAppliedRef  \* Composer.tsx:1030
  /\ planModelApplied' = IF planVisit = saveFlight.visit /\ planMode THEN TRUE ELSE planModelApplied  \* Composer.tsx:1031
  /\ ompProcessModel' = IF planVisit = saveFlight.visit /\ planMode THEN saveFlight.value ELSE ompProcessModel  \* Composer.tsx:1034-1036
  /\ saveFlight' = NoSave
  /\ UNCHANGED <<chip, planSend, planMode, planVisit, modelRoleFile, statusPlanModel, extSettingsRole,
                 draftModel, draftBeforePreview, readFlight>>

\* The write fails (Composer.tsx:970-973 toast, nothing else changes).
WriteFails ==
  /\ saveFlight.st = "started"
  /\ saveFlight' = NoSave
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
                 planAppliedRef, planModelApplied, modelRoleFile, statusPlanModel, extSettingsRole,
                 ompProcessModel, draftModel, draftBeforePreview, readFlight>>

\* Backend answers the role read (Composer.tsx:888).
ReadExecutes ==
  /\ readFlight.st = "asked"
  /\ readFlight' = [readFlight EXCEPT !.st = "inflight", !.val = modelRoleFile]
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
                 planAppliedRef, planModelApplied, modelRoleFile, statusPlanModel, extSettingsRole,
                 ompProcessModel, draftModel, draftBeforePreview, saveFlight>>

\* The read reply reaches the composer; dropped when cancelled or older than a write (Composer.tsx:889).
ReadArrives ==
  /\ readFlight.st = "inflight"
  /\ planRolesState' = IF ~readFlight.cancelled /\ planRolesWrite = readFlight.gen THEN readFlight.val ELSE planRolesState
  /\ readFlight' = Idle
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planVisit, planRolesWrite,
                 planAppliedRef, planModelApplied, modelRoleFile, statusPlanModel, extSettingsRole,
                 ompProcessModel, draftModel, draftBeforePreview, saveFlight>>

\* The read fails silently (Composer.tsx:890 catch returns undefined).
ReadFails ==
  /\ readFlight.st \in {"asked", "inflight"}
  /\ readFlight' = Idle
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
                 planAppliedRef, planModelApplied, modelRoleFile, statusPlanModel, extSettingsRole,
                 ompProcessModel, draftModel, draftBeforePreview, saveFlight>>

\* Reader sends the /plan chip: Composer.tsx:1414 clears the chip before the command runs.
SendPlanChip ==
  /\ chip = "plan"
  /\ planSend = "none"
  /\ Transition(planMode, "none")
  /\ planSend' = "sending"
  /\ UNCHANGED <<planRolesWrite, modelRoleFile, statusPlanModel, extSettingsRole, ompProcessModel,
                 draftModel, draftBeforePreview, saveFlight>>

\* The extension enters plan mode (omp-workspace-plan.ts:414-430): applies and publishes the role it sees.
PlanCommandAccepted ==
  /\ planSend = "sending"
  /\ planSend' = "none"
  /\ IF planMode
       THEN /\ planMode' = planMode /\ UNCHANGED <<ompProcessModel, statusPlanModel>>
            /\ UNCHANGED <<chip, planEditState, planRolesState, planVisit, planAppliedRef,
                           planModelApplied, readFlight>>
       ELSE /\ ompProcessModel' = extSettingsRole  \* omp-workspace-plan.ts:427-428
            /\ statusPlanModel' = extSettingsRole  \* omp-workspace-plan.ts:390
            /\ Transition(TRUE, chip)
  /\ UNCHANGED <<planRolesWrite, modelRoleFile, extSettingsRole, draftModel, draftBeforePreview, saveFlight>>

\* The command fails: the chip returns (Composer.tsx:1425/1463).
PlanCommandFails ==
  /\ planSend = "sending"
  /\ planSend' = "none"
  /\ Transition(planMode, "plan")
  /\ UNCHANGED <<planRolesWrite, modelRoleFile, statusPlanModel, extSettingsRole, ompProcessModel,
                 draftModel, draftBeforePreview, saveFlight>>

\* Composer auto-applies the shown plan model once per visit (Composer.tsx:1055-1070).
AutoApplyPlanModel ==
  /\ planMode  \* Composer.tsx:1055
  /\ planChoice # "none"  \* Composer.tsx:1055
  /\ ~planAppliedRef  \* Composer.tsx:1055
  /\ ompProcessModel' = planChoice  \* Composer.tsx:1065
  /\ planAppliedRef' = TRUE  \* Composer.tsx:1059
  /\ planModelApplied' = TRUE  \* Composer.tsx:1060
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
                 modelRoleFile, statusPlanModel, extSettingsRole, draftModel, draftBeforePreview,
                 readFlight, saveFlight>>

\* A later user turn ends and the extension republishes the role it sees (omp-workspace-plan.ts:516-520,390).
StatusRepublished ==
  /\ planMode  \* omp-workspace-plan.ts:516-520
  /\ statusPlanModel' = extSettingsRole
  /\ UNCHANGED <<chip, planSend, planMode, planEditState, planRolesState, planVisit, planRolesWrite,
                 planAppliedRef, planModelApplied, modelRoleFile, extSettingsRole, ompProcessModel,
                 draftModel, draftBeforePreview, readFlight, saveFlight>>

\* Reader or approval leaves plan mode (omp-workspace-plan.ts:434-446 restores the earlier model).
DisablePlan ==
  /\ planMode
  /\ Transition(FALSE, chip)
  /\ statusPlanModel' = "none"
  /\ ompProcessModel' = "O"
  /\ UNCHANGED <<planSend, planRolesWrite, modelRoleFile, extSettingsRole, draftModel,
                 draftBeforePreview, saveFlight>>

\* Finite exploration bound only; not a production guard. Longer histories are omitted.
HistoryBound == planVisit <= 2 /\ planRolesWrite <= 2

Init ==
  /\ chip = "none" /\ planSend = "none" /\ planMode = FALSE
  /\ planEditState = "none" /\ planRolesState = "none"
  /\ planVisit = 0 /\ planRolesWrite = 0
  /\ planAppliedRef = FALSE /\ planModelApplied = FALSE
  /\ modelRoleFile = "A" /\ statusPlanModel = "none" /\ extSettingsRole = "A"
  /\ ompProcessModel = "O" /\ draftModel = "O" /\ draftBeforePreview = "O"
  /\ readFlight = Idle /\ saveFlight = NoSave

ReaderAct == SelectPlanChip \/ RemovePlanChip \/ OrdinaryPick \/ PickPlanModel \/ SendPlanChip \/ StatusRepublished \/ DisablePlan
System == WriteRoleFile \/ WriteReplyArrives \/ WriteFails \/ ReadExecutes \/ ReadArrives \/ ReadFails
          \/ PlanCommandAccepted \/ PlanCommandFails \/ AutoApplyPlanModel
Next == ReaderAct \/ System
Spec == Init /\ [][Next]_vars

Settled == ~ENABLED System

\* 只预览计划时，普通草稿的模型选择不会被改动。
PreviewKeepsOrdinaryChoice == (chip = "plan" /\ ~planMode) => draftModel = draftBeforePreview

\* 离开计划预览后，不残留旧的编辑、旧的角色快照，也不会让迟到的读取落地。
NoResidueAfterPreview ==
  ~planPreview => (planEditState = "none" /\ planRolesState = "none" /\ (readFlight.st = "idle" \/ readFlight.cancelled))

\* 事情稳定后，预览或计划中显示的模型就是已保存的计划角色。
SettledChipShowsSavedRole ==
  (Settled /\ planPreview /\ planSend = "none" /\ saveFlight.st = "idle") => shownModel = modelRoleFile

\* 事情稳定后，计划进行中运行的模型就是已保存的计划角色。
SettledProcessRunsSavedRole ==
  (Settled /\ planMode /\ planSend = "none" /\ saveFlight.st = "idle") => ompProcessModel = modelRoleFile

====
