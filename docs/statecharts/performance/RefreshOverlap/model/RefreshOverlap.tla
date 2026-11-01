---- MODULE RefreshOverlap ----
EXTENDS Naturals, FiniteSets
VARIABLES perfOpen, cancelled, inFlight, memPromise
vars == <<perfOpen, cancelled, inFlight, memPromise>>
\* Closure indices 1=closed panel, 2=open panel. Each set records actual pending
\* getAppMemoryUsage promises or effect-local inFlight flags (BottomBar.tsx:84,96).
\* The finite scenario starts at mount and permits one panel opening.
Init == /\ perfOpen = FALSE /\ cancelled = FALSE /\ inFlight = {} /\ memPromise = {}
pollClosed ==
    /\ ~perfOpen /\ ~cancelled \* src/components/BottomBar.tsx:81,91,146
    /\ 1 \notin inFlight \* src/components/BottomBar.tsx:84,92
    /\ inFlight' = inFlight \cup {1}
    /\ memPromise' = memPromise \cup {1}
    /\ UNCHANGED <<perfOpen, cancelled>>
setPerfOpen ==
    /\ ~perfOpen \* src/components/BottomBar.tsx:221 (one opening in this bounded scenario)
    /\ perfOpen' = TRUE
    /\ UNCHANGED <<cancelled, inFlight, memPromise>>
cleanup ==
    /\ perfOpen /\ ~cancelled \* src/components/BottomBar.tsx:141-146 (effect rerun)
    /\ cancelled' = TRUE
    /\ UNCHANGED <<perfOpen, inFlight, memPromise>>
pollOpen ==
    /\ perfOpen /\ cancelled \* src/components/BottomBar.tsx:81,141-146
    /\ 2 \notin inFlight \* src/components/BottomBar.tsx:84,92 (new closure)
    /\ inFlight' = inFlight \cup {2}
    /\ memPromise' = memPromise \cup {2}
    /\ UNCHANGED <<perfOpen, cancelled>>
completeClosed ==
    /\ 1 \in memPromise \* src/components/BottomBar.tsx:99,113-114
    /\ memPromise' = memPromise \ {1}
    /\ inFlight' = inFlight \ {1}
    /\ UNCHANGED <<perfOpen, cancelled>>
completeOpen ==
    /\ 2 \in memPromise \* src/components/BottomBar.tsx:99,113-114
    /\ memPromise' = memPromise \ {2}
    /\ inFlight' = inFlight \ {2}
    /\ UNCHANGED <<perfOpen, cancelled>>
System == pollClosed \/ cleanup \/ pollOpen \/ completeClosed \/ completeOpen
Next == System \/ setPerfOpen
Spec == Init /\ [][Next]_vars
\* Opening the panel must not start a second memory scan before the first finishes.
\* Starts: src/components/BottomBar.tsx:84,92-96,139,146.
NoOverlappingMemoryScans == Cardinality(memPromise) <= 1
====
