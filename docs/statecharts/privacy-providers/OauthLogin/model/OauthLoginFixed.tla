------------------------------ MODULE OauthLoginFixed ------------------------------
\* Model of: OauthLoginDialog.tsx (list/flow dialog) <-> providers/oauth.rs (single ACTIVE login child) <-> provider panel.
\* No network: the browser login result and OMP credential save are external boundary events.
VARIABLES
  phase,        \* dialog phase: list | flow | closed (OauthLoginDialog.tsx:35,63)
  listening,    \* event listener attached (unlistenRef set, OauthLoginDialog.tsx:197,314,325)
  uiFlowActive, \* isFlowActiveRef (OauthLoginDialog.tsx:73,180,148)
  uiDone,       \* flowState.completed: running | ok | failed (OauthLoginDialog.tsx:54-57)
  confirmOpen,  \* cancel-login confirmation open (OauthLoginDialog.tsx:299)
  pendingCancel,\* oauthLoginCancel call issued by the UI and not yet processed by the backend
  startState,   \* oauthLoginStart: none | inFlight | done (OauthLoginDialog.tsx:200)
  active,       \* oauth.rs ACTIVE holds a login child
  result,       \* OMP login outcome: pending | success | failed | cancelled
  credSaved,    \* OMP persisted credentials after a successful login (external boundary)
  panelStale    \* provider panel store does not show a saved credential

vars == <<phase, listening, uiFlowActive, uiDone, confirmOpen, pendingCancel, startState, active, result, credSaved, panelStale>>

TypeOK ==
  /\ phase \in {"list", "flow", "closed"} /\ listening \in BOOLEAN /\ uiFlowActive \in BOOLEAN
  /\ uiDone \in {"running", "ok", "failed"} /\ confirmOpen \in BOOLEAN /\ pendingCancel \in BOOLEAN
  /\ startState \in {"none", "inFlight", "done"} /\ active \in BOOLEAN
  /\ result \in {"pending", "success", "failed", "cancelled"} /\ credSaved \in BOOLEAN /\ panelStale \in BOOLEAN

Init ==
  /\ phase = "list" /\ listening = FALSE /\ uiFlowActive = FALSE /\ uiDone = "running"
  /\ confirmOpen = FALSE /\ pendingCancel = FALSE /\ startState = "none"
  /\ active = FALSE /\ result = "cancelled" /\ credSaved = FALSE /\ panelStale = FALSE

\* User picks a provider in the list
StartFlow ==
  /\ phase = "list"                                      \* OauthLoginDialog.tsx:417 list body
  /\ startState = "none"                                 \* one start per flow (flowIdRef, :177)
  /\ ~active                                             \* oauth.rs:285 otherwise "login already running" error
  /\ phase' = "flow"                                     \* OauthLoginDialog.tsx:179
  /\ listening' = TRUE                                   \* OauthLoginDialog.tsx:189-197 subscribe before start
  /\ uiFlowActive' = TRUE                                \* OauthLoginDialog.tsx:180
  /\ uiDone' = "running"                                 \* OauthLoginDialog.tsx:167-175 initial FlowState
  /\ startState' = "inFlight"                            \* OauthLoginDialog.tsx:200
  /\ UNCHANGED <<confirmOpen, pendingCancel, active, result, credSaved, panelStale>>

\* Backend handles the start command (command order versus a later cancel is not guaranteed by the IPC layer)
BackendStart ==
  /\ startState = "inFlight"                             \* oauth_login_start called
  /\ ~active                                             \* oauth.rs:285
  /\ startState' = "done"
  /\ active' = TRUE                                      \* oauth.rs:323-329
  /\ result' = "pending"                                 \* login frame is sent by reader_task, oauth.rs:380-390
  /\ UNCHANGED <<phase, listening, uiFlowActive, uiDone, confirmOpen, pendingCancel, credSaved, panelStale>>

\* The browser login finishes and OMP stores the credential
LoginSucceeds ==
  /\ active                                              \* oauth.rs:408-431 frame loop
  /\ result = "pending"                                  \* completed frame arrives once
  /\ result' = "success"                                 \* oauth.rs:162-181 map_rpc_frame completed ok
  /\ credSaved' = TRUE                                   \* OMP side effect, external boundary
  /\ IF listening
       THEN /\ uiDone' = "ok"                            \* OauthLoginDialog.tsx:147-152
            /\ uiFlowActive' = FALSE                     \* OauthLoginDialog.tsx:148
            /\ panelStale' = FALSE                       \* OauthLoginDialog.tsx:153-155 reloadProviders on ok
       ELSE /\ UNCHANGED <<uiDone, uiFlowActive>>        \* handler detached, event dropped (:314-317, :325-329)
            /\ panelStale' = TRUE
  /\ UNCHANGED <<phase, listening, confirmOpen, pendingCancel, startState, active>>

LoginFails ==
  /\ active                                              \* oauth.rs:408
  /\ result = "pending"
  /\ result' = "failed"                                  \* oauth.rs:166-180 completed with error
  /\ IF listening THEN /\ uiDone' = "failed" /\ uiFlowActive' = FALSE ELSE UNCHANGED <<uiDone, uiFlowActive>>   \* OauthLoginDialog.tsx:147-152
  /\ UNCHANGED <<phase, listening, confirmOpen, pendingCancel, startState, active, credSaved, panelStale>>

\* Reader task ends and clears ACTIVE
BackendCleanup ==
  /\ active
  /\ result # "pending"                                  \* oauth.rs:447-459 after break from the loop
  /\ active' = FALSE
  /\ UNCHANGED <<phase, listening, uiFlowActive, uiDone, confirmOpen, pendingCancel, startState, result, credSaved, panelStale>>

\* 上一步: unlisten first, then cancel (OauthLoginDialog.tsx:324-342)
BackUnlisten ==
  /\ phase = "flow"                                      \* OauthLoginDialog.tsx:324 only reachable from the flow body
  /\ phase' = "list"                                     \* OauthLoginDialog.tsx:340
  /\ listening' = FALSE                                  \* OauthLoginDialog.tsx:326-329
  /\ pendingCancel' = (pendingCancel \/ uiFlowActive)    \* OauthLoginDialog.tsx:330-334 cancel only while the flow is active; an earlier cancel stays in flight
  /\ uiFlowActive' = FALSE                               \* OauthLoginDialog.tsx:331
  /\ startState' = IF startState = "done" THEN "none" ELSE startState   \* flow abandoned
  /\ UNCHANGED <<uiDone, confirmOpen, active, result, credSaved, panelStale>>

\* Cancel command processed by the backend
CancelCall ==
  /\ pendingCancel                                       \* UI issued oauthLoginCancel
  /\ startState # "inFlight"                              \* PROPOSED at OauthLoginDialog.tsx:200: await the start command before issuing cancel
  /\ pendingCancel' = FALSE
  /\ panelStale' = FALSE                                 \* PROPOSED at OauthLoginDialog.tsx:333: reload providers after every cancel
  /\ IF active
       THEN /\ active' = FALSE                           \* oauth.rs:489-494 take ACTIVE and kill the child
            /\ result' = IF result = "pending" THEN "cancelled" ELSE result
       ELSE UNCHANGED <<active, result>>                 \* oauth.rs:488 nothing to cancel
  /\ UNCHANGED <<phase, listening, uiFlowActive, uiDone, confirmOpen, startState, credSaved>>

\* X / Escape while the flow is running asks first
DismissAsk ==
  /\ phase = "flow"                                      \* OauthLoginDialog.tsx:298
  /\ uiDone = "running"                                  \* OauthLoginDialog.tsx:298 completed is null
  /\ ~confirmOpen
  /\ confirmOpen' = TRUE                                 \* OauthLoginDialog.tsx:299-303
  /\ UNCHANGED <<phase, listening, uiFlowActive, uiDone, pendingCancel, startState, active, result, credSaved, panelStale>>

DismissKeep ==
  /\ confirmOpen
  /\ confirmOpen' = FALSE                                \* OauthLoginDialog.tsx:304 not confirmed
  /\ UNCHANGED <<phase, listening, uiFlowActive, uiDone, pendingCancel, startState, active, result, credSaved, panelStale>>

\* Confirmed: cancel is awaited, then the listener is removed and the dialog closes
DismissConfirmed ==
  /\ confirmOpen                                         \* OauthLoginDialog.tsx:304
  /\ confirmOpen' = FALSE
  /\ phase' = "closed"                                   \* OauthLoginDialog.tsx:318 onClose
  /\ listening' = FALSE                                  \* OauthLoginDialog.tsx:314-317
  /\ uiFlowActive' = FALSE                               \* OauthLoginDialog.tsx:310
  /\ IF active
       THEN /\ active' = FALSE                           \* oauth.rs:489-494
            /\ result' = IF result = "pending" THEN "cancelled" ELSE result
       ELSE UNCHANGED <<active, result>>
  /\ startState' = IF startState = "done" THEN "none" ELSE startState
  /\ UNCHANGED <<uiDone, pendingCancel, credSaved, panelStale>>

\* Finished flow closes without a prompt
CloseFinished ==
  /\ phase \in {"flow", "list"}
  /\ (uiDone # "running" \/ phase = "list")              \* OauthLoginDialog.tsx:298 prompt only for an unfinished flow
  /\ ~confirmOpen                                        \* OauthLoginDialog.tsx:299 the confirm dialog is modal over the dialog
  /\ phase' = "closed"                                   \* OauthLoginDialog.tsx:318
  /\ listening' = FALSE                                  \* OauthLoginDialog.tsx:314-317
  /\ pendingCancel' = (pendingCancel \/ uiFlowActive)    \* OauthLoginDialog.tsx:352-355 unmount cleanup cancels an active flow; earlier cancel stays in flight
  /\ uiFlowActive' = FALSE
  /\ startState' = IF startState = "done" THEN "none" ELSE startState
  /\ UNCHANGED <<uiDone, confirmOpen, active, result, credSaved, panelStale>>

\* Parent removes the dialog while a flow is active (settings closed, sheet dismissed)
ParentUnmount ==
  /\ phase = "flow"                                      \* OauthLoginDialog.tsx:344-357 effect cleanup
  /\ phase' = "closed"
  /\ listening' = FALSE                                  \* OauthLoginDialog.tsx:348-351
  /\ pendingCancel' = (pendingCancel \/ uiFlowActive)    \* OauthLoginDialog.tsx:352-355 void oauthLoginCancel()
  /\ uiFlowActive' = FALSE
  /\ confirmOpen' = FALSE
  /\ startState' = IF startState = "done" THEN "none" ELSE startState
  /\ UNCHANGED <<uiDone, active, result, credSaved, panelStale>>

Next == StartFlow \/ BackendStart \/ LoginSucceeds \/ LoginFails \/ BackendCleanup \/ BackUnlisten
        \/ CancelCall \/ DismissAsk \/ DismissKeep \/ DismissConfirmed \/ CloseFinished \/ ParentUnmount

Spec == Init /\ [][Next]_vars

\* 登录成功且取消请求处理完之后，供应商列表必须显示新保存的授权。
PanelShowsSavedLogin == ~(credSaved /\ panelStale /\ ~pendingCancel)

\* 界面离开登录流程后，不能留下无人管理、仍在等待授权的登录进程。
NoOrphanLogin == ~(phase \in {"list", "closed"} /\ active /\ result = "pending" /\ ~pendingCancel /\ ~uiFlowActive /\ startState # "inFlight")
=================================================================================
