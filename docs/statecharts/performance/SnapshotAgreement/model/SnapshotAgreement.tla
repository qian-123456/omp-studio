---- MODULE SnapshotAgreement ----
EXTENDS TLC
VARIABLES memPromise, perfPromise, memoryInfo, perfData
vars == <<memPromise, perfPromise, memoryInfo, perfData>>
\* small/large stand for two distinguishable formatted process-memory samples.
\* These are bounded environment inputs, not recorded production memory numbers.
Init == /\ memPromise = "pending" /\ perfPromise = "pending"
        /\ memoryInfo = "none" /\ perfData = "none"
getAppMemoryUsage ==
    /\ memPromise = "pending" \* src/components/BottomBar.tsx:96
    /\ memPromise' \in {"small", "large"} \* src-tauri/src/services/perf.rs:452-474,479-482
    /\ UNCHANGED <<perfPromise, memoryInfo, perfData>>
perfBreakdown ==
    /\ perfPromise = "pending" \* src/components/BottomBar.tsx:98
    /\ perfPromise' \in {"small", "large"} \* src-tauri/src/services/perf.rs:485-547,588-601
    /\ UNCHANGED <<memPromise, memoryInfo, perfData>>
poll ==
    /\ memPromise # "pending" /\ perfPromise # "pending" \* src/components/BottomBar.tsx:99
    /\ memoryInfo = "none" \* src/components/BottomBar.tsx:70,101-109 (one completed refresh)
    /\ memoryInfo' = memPromise \* src/components/BottomBar.tsx:101-106
    /\ perfData' = perfPromise \* src/components/BottomBar.tsx:109
    /\ UNCHANGED <<memPromise, perfPromise>>
System == getAppMemoryUsage \/ perfBreakdown \/ poll
Next == System
Spec == Init /\ [][Next]_vars
Settled == ~ENABLED System
\* The bottom bar and open panel must show the same app-memory sample after a refresh.
\* Writes: src/components/BottomBar.tsx:101-109,147,232-240; reads: PerfPopover.tsx:219.
SameAppMemorySample == Settled => memoryInfo = perfData
====
