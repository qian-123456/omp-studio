---- MODULE CenterPaneFixed ----
\* Which draft the session pane shows when a fork draft and a local new-session draft coexist.
\* Source: src/App.tsx MainCenterView, src/features/sessions/forkDraft.ts, newSession.ts, pendingSession.ts.
EXTENDS Naturals

VARIABLES
    forkDraftOpen,   \* useForkDraft.draft !== null (forkDraft.ts:48)
    pendingSelected, \* usePendingSession.selectedId !== null (pendingSession.ts:36)
    lastRequest      \* what the user asked for last: none / newSession / fork / realSession

vars == <<forkDraftOpen, pendingSelected, lastRequest>>

TypeOK ==
    /\ forkDraftOpen \in BOOLEAN
    /\ pendingSelected \in BOOLEAN
    /\ lastRequest \in {"none", "newSession", "fork", "realSession"}

Init == /\ forkDraftOpen = FALSE /\ pendingSelected = FALSE /\ lastRequest = "none"

\* Fork icon on a running session -> startFork -> openForkDraft (forkDraft.ts:104-125, 199-203).
UserOpenForkDraft ==
    /\ forkDraftOpen' = TRUE \* forkDraft.ts:117-119 draft is set
    /\ lastRequest' = "fork"
    /\ UNCHANGED pendingSelected \* forkDraft.ts:106-125 never touches the pending selection

\* Cmd+N / New session button -> openDraft (newSession.ts:57-70).
UserNewSession ==
    /\ pendingSelected' = TRUE \* pendingSession.ts:109-112 open() selects the local draft
    /\ lastRequest' = "newSession"
    /\ forkDraftOpen' = FALSE \* proposed fix: openDraft closes the fork draft first like openForkDraft does (forkDraft.ts:105-107)

\* Discard fork button (ForkDraftView.tsx:88-91) or a completed send closes the fork draft (forkDraft.ts:96-102).
UserCloseForkDraft ==
    /\ forkDraftOpen \* forkDraft.ts:97
    /\ forkDraftOpen' = FALSE
    /\ UNCHANGED <<pendingSelected, lastRequest>>

\* Clicking a real session row: both drafts are dropped (forkDraft.ts:130-136, newSession.ts:100-108).
UserSelectRealSession ==
    /\ forkDraftOpen' = FALSE
    /\ pendingSelected' = FALSE
    /\ lastRequest' = "realSession"

Next == UserOpenForkDraft \/ UserNewSession \/ UserCloseForkDraft \/ UserSelectRealSession

Spec == Init /\ [][Next]_vars

\* App.tsx:121-130 picks fork draft, then pending draft, then start page.
Shown == IF forkDraftOpen THEN "fork" ELSE IF pendingSelected THEN "pending" ELSE "start"

\* 用户刚点了新建会话，中间区域就必须显示新的空白会话，而不是别的草稿。
NewSessionVisible == lastRequest = "newSession" => Shown = "pending"

====
