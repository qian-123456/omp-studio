---- MODULE StartupRestore ----
\* Startup restore of the last session versus pages the user already opened while sessions load.
\* Source: src/App.tsx, src/stores/sessions.ts, src/stores/ui.ts, src/main.tsx.
EXTENDS Naturals

VARIABLES
    hasLoaded,    \* useSessions.hasLoaded (sessions.ts:337)
    restoredRef,  \* App.tsx restoredRef.current (App.tsx:311)
    centerView,   \* useUi.centerView (ui.ts:207)
    lastInMode,   \* last session exists in the active space: TRUE / FALSE (App.tsx:317-319)
    overridden    \* restore replaced a page the user had opened

vars == <<hasLoaded, restoredRef, centerView, lastInMode, overridden>>

TypeOK ==
    /\ hasLoaded \in BOOLEAN
    /\ restoredRef \in BOOLEAN
    /\ centerView \in {"home", "settings", "inbox", "session"}
    /\ lastInMode \in BOOLEAN
    /\ overridden \in BOOLEAN

\* A last session id is persisted (ui.ts:274); either it still lives in the active space or not.
Init ==
    /\ hasLoaded = FALSE
    /\ restoredRef = FALSE
    /\ centerView = "home"
    /\ lastInMode \in BOOLEAN
    /\ overridden = FALSE

\* Cmd+, or Cmd+I while the list is still loading (dispatcher.ts:84-86, 96-98; ui.ts:340-359).
UserOpenPage ==
    /\ centerView = "home" \* the app starts on home (ui.ts:269)
    /\ \E p \in {"settings", "inbox"} : centerView' = p
    /\ UNCHANGED <<hasLoaded, restoredRef, lastInMode, overridden>>

\* First listSessions succeeds (sessions.ts:337); a failed first load stays not loaded (sessions.ts:336).
FirstLoadSucceeds ==
    /\ ~hasLoaded
    /\ hasLoaded' = TRUE \* sessions.ts:337
    /\ UNCHANGED <<restoredRef, centerView, lastInMode, overridden>>

\* The restore effect (App.tsx:312-324).
RestoreEffect ==
    /\ hasLoaded \* App.tsx:313
    /\ ~restoredRef \* App.tsx:313
    /\ restoredRef' = TRUE \* App.tsx:314
    /\ IF lastInMode \* App.tsx:317-319 exists and matches the active space
       THEN centerView' = "session" \* App.tsx:320
       ELSE centerView' = IF centerView = "settings" THEN "settings" ELSE "home" \* App.tsx:322 leaveSession, ui.ts:312
    /\ overridden' = (centerView # "home" /\ centerView' # centerView)
    /\ UNCHANGED <<hasLoaded, lastInMode>>

Next == UserOpenPage \/ FirstLoadSucceeds \/ RestoreEffect

Spec == Init /\ [][Next]_vars

\* 用户在启动加载期间自己打开的页面，启动恢复不能把它抢走。
RestoreKeepsUserPage == ~overridden

====
