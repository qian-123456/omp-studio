---- MODULE DraftHandoff ----
\* Local draft -> real session handoff racing with the settings overlay.
\* Source: src/features/sessions/draftSession.ts, pendingSession.ts, newSession.ts, src/stores/ui.ts.
EXTENDS Naturals

VARIABLES
    centerView,        \* useUi.centerView (ui.ts:207)
    previousCenterView,\* useUi.previousCenterView (ui.ts:208)
    selectedSessionId, \* useUi.selectedSessionId, "none" or "real" (ui.ts:209)
    pendingSelected,   \* usePendingSession.selectedId is set (pendingSession.ts:36)
    draftAlive,        \* usePendingSession.drafts[id] exists (pendingSession.ts:35)
    handoff,           \* draftSession.ts handoffs map: idle / inflight / done
    userLeft           \* the user went to another page while the process was starting

vars == <<centerView, previousCenterView, selectedSessionId, pendingSelected, draftAlive, handoff, userLeft>>

TypeOK ==
    /\ centerView \in {"session", "settings", "home"}
    /\ previousCenterView \in {"session", "home", "none"}
    /\ selectedSessionId \in {"none", "real"}
    /\ pendingSelected \in BOOLEAN
    /\ draftAlive \in BOOLEAN
    /\ handoff \in {"idle", "inflight", "done"}
    /\ userLeft \in BOOLEAN

\* A blank draft is shown in the session pane (openDraft, newSession.ts:57-70).
Init ==
    /\ centerView = "session"
    /\ previousCenterView = "none"
    /\ selectedSessionId = "none"
    /\ pendingSelected = TRUE
    /\ draftAlive = TRUE
    /\ handoff = "idle"
    /\ userLeft = FALSE

\* Enter in the composer -> sendFromDraft -> handoff (draftSession.ts:213-222, 145-173).
UserSendFromDraft ==
    /\ draftAlive \* draftSession.ts:146 draft must still exist
    /\ handoff = "idle" \* draftSession.ts:214 and 129-130 single flight
    /\ handoff' = "inflight"
    /\ UNCHANGED <<centerView, previousCenterView, selectedSessionId, pendingSelected, draftAlive, userLeft>>

\* Cmd+, or theme menu -> openSettings (ui.ts:350-359).
UserOpenSettings ==
    /\ centerView = "session" \* ui.ts:352-353 records the view underneath only when not already settings
    /\ centerView' = "settings"
    /\ previousCenterView' = "session"
    /\ UNCHANGED <<selectedSessionId, pendingSelected, draftAlive, handoff, userLeft>>

\* Esc / close button -> closeSettings (ui.ts:360-370).
UserCloseSettings ==
    /\ centerView = "settings" \* ui.ts:360 overlay is open
    /\ centerView' = previousCenterView \* ui.ts:362-364
    /\ UNCHANGED <<previousCenterView, selectedSessionId, pendingSelected, draftAlive, handoff, userLeft>>

\* Opening any full-page view while the draft shows: draft is deselected (newSession.ts:100-108).
UserLeaveToPage ==
    /\ centerView = "session" \* page switch from the session pane
    /\ centerView' = "home"
    /\ pendingSelected' = FALSE \* newSession.ts:105-107 select(null) when view is not session/settings
    /\ userLeft' = TRUE
    /\ UNCHANGED <<previousCenterView, selectedSessionId, draftAlive, handoff>>

\* The prewarmed process answers; handoff finishes (draftSession.ts:152-163).
HandoffComplete ==
    /\ handoff = "inflight" \* draftSession.ts:148-166 awaiting prewarmDraft
    /\ draftAlive \* draftSession.ts:151 draft must still exist
    /\ handoff' = "done"
    /\ draftAlive' = FALSE \* draftSession.ts:162 discard(id)
    /\ pendingSelected' = FALSE \* pendingSession.ts:138-143 discard clears selectedId
    /\ IF pendingSelected /\ selectedSessionId = "none" /\ centerView = "session" \* draftSession.ts:153-154 visible check
       THEN selectedSessionId' = "real" \* draftSession.ts:158 ui.selectSession(sessionId)
       ELSE UNCHANGED selectedSessionId
    /\ UNCHANGED <<centerView, previousCenterView, userLeft>>

Next == UserSendFromDraft \/ UserOpenSettings \/ UserCloseSettings \/ UserLeaveToPage \/ HandoffComplete

Spec == Init /\ [][Next]_vars

InSessionPane == centerView = "session" \/ (centerView = "settings" /\ previousCenterView = "session")

\* 用户发送第一条消息后一直没有离开，等处理完成，用户看到的必须是刚才发消息的那个会话。
SendShowsSession == (handoff = "done" /\ ~userLeft /\ InSessionPane) => selectedSessionId = "real"

====
