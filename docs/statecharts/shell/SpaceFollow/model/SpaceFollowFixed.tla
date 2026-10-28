---- MODULE SpaceFollowFixed ----
\* Model of the sidebar "space follows selected session" effect.
\* Source: src/features/sessions/SessionSidebar.tsx, src/stores/ui.ts, src/App.tsx.
EXTENDS Naturals

CONSTANTS CodeMode, ResearchMode

VARIABLES
    activeMode,    \* useSidebarStore.activeMode  (sidebarStore.ts:109)
    selectedId,    \* useUi.selectedSessionId     (ui.ts:209)
    sidebarOpen,   \* useUi.sidebarOpen           (ui.ts:225)
    prevSelectedIdRef  \* SessionSidebar.prevSelectedIdRef (SessionSidebar.tsx:378)

vars == <<activeMode, selectedId, sidebarOpen, prevSelectedIdRef>>

Ids == {"none", "a", "b"}
Modes == {CodeMode, ResearchMode}
\* Fixture: session a lives in the code space, session b in the research space.
ModeOf(id) == IF id = "a" THEN CodeMode ELSE ResearchMode

TypeOK ==
    /\ activeMode \in Modes
    /\ selectedId \in Ids
    /\ prevSelectedIdRef \in Ids
    /\ sidebarOpen \in BOOLEAN

Init ==
    /\ activeMode = CodeMode
    /\ selectedId = "a"
    /\ sidebarOpen = TRUE
    /\ prevSelectedIdRef = "a"

\* Inbox, heatmap, schedules, search and others call selectSession directly (ui.ts:291-300).
\* While the sidebar is mounted its effect (SessionSidebar.tsx:381-391) runs right after the render,
\* so the follow is part of the same step; a collapsed sidebar has no such effect.
SelectSession ==
    \E id \in {"a", "b"} :
        /\ id # selectedId \* ui.ts:292-299 a new id replaces the selection
        /\ selectedId' = id
        /\ IF TRUE \* proposed fix: follow runs at App level (App.tsx:163-165 owns the selection)
           THEN /\ prevSelectedIdRef' = id \* SessionSidebar.tsx:383
                /\ activeMode' = ModeOf(id) \* SessionSidebar.tsx:385-387
           ELSE UNCHANGED <<activeMode, prevSelectedIdRef>>
        /\ UNCHANGED sidebarOpen

\* Cmd+B (dispatcher.ts:122-125) -> toggleSidebar (ui.ts:424-433); App.tsx:347 mounts the sidebar only when open.
ToggleSidebar ==
    /\ sidebarOpen' = ~sidebarOpen
    \* SessionSidebar.tsx:378-380: a freshly mounted sidebar seeds its ref from the current selection, so no follow runs.
    /\ prevSelectedIdRef' = prevSelectedIdRef
    /\ UNCHANGED <<activeMode, selectedId>>

\* The user picks another space in the sidebar header (SessionSidebar.tsx:1264 -> switchMode.ts:10-13).
UserSwitchMode ==
    \E m \in Modes :
        /\ sidebarOpen \* only rendered inside the open sidebar, App.tsx:347
        /\ m # activeMode \* switchMode.ts:11
        /\ activeMode' = m
        /\ selectedId' = "none" \* leaveSession, ui.ts:301-314
        /\ UNCHANGED <<sidebarOpen, prevSelectedIdRef>>

Next == SelectSession \/ ToggleSidebar \/ UserSwitchMode

Spec == Init /\ [][Next]_vars

\* 当前会话所属的空间，必须就是侧边栏正在显示的空间，这样选中的那一行总是看得见。
SpaceMatchesSelection == (selectedId = "none" \/ activeMode = ModeOf(selectedId))

====
