---- MODULE PartialFailureFixed ----
EXTENDS TLC
VARIABLES memPromise, srvPromise, perfPromise, memoryInfo, perfData, inFlight
vars == <<memPromise, srvPromise, perfPromise, memoryInfo, perfData, inFlight>>
\* MODEL ONLY: independently publish successful probe results; product unchanged.
\* Rejection is fault-injected at src/lib/ipc.ts:434-435. Normal OS scan
\* failures do not reject: src-tauri/src/services/commands.rs:11-15 returns Ok.
Init == /\ memPromise = "pending" /\ srvPromise = "pending" /\ perfPromise = "pending"
        /\ memoryInfo = "old" /\ perfData = "old" /\ inFlight = TRUE
getAppMemoryUsage ==
    /\ memPromise = "pending" \* src/components/BottomBar.tsx:96
    /\ memPromise' = "fulfilled"
    /\ memoryInfo' = "fresh"
    /\ UNCHANGED <<srvPromise, perfPromise, perfData, inFlight>>
perfBreakdown ==
    /\ perfPromise = "pending" \* src/components/BottomBar.tsx:98
    /\ perfPromise' = "fulfilled"
    /\ perfData' = "fresh"
    /\ UNCHANGED <<memPromise, srvPromise, memoryInfo, inFlight>>
servicesList ==
    /\ srvPromise = "pending" \* src/components/BottomBar.tsx:97
    /\ srvPromise' = "rejected"
    /\ UNCHANGED <<memPromise, perfPromise, memoryInfo, perfData, inFlight>>
poll ==
    /\ inFlight \* src/components/BottomBar.tsx:93
    /\ srvPromise = "rejected" \* src/components/BottomBar.tsx:99,111-114
    /\ inFlight' = FALSE
    /\ UNCHANGED <<memPromise, srvPromise, perfPromise, memoryInfo, perfData>>
System == getAppMemoryUsage \/ perfBreakdown \/ servicesList \/ poll
Next == System
Spec == Init /\ [][Next]_vars
Settled == ~ENABLED System
\* A rejected service-query IPC must not discard a completed memory sample.
\* Writes: src/components/BottomBar.tsx:99-114.
MemorySurvivesServiceFailure == Settled => memoryInfo = "fresh"
\* A rejected service-query IPC must not discard a completed distribution sample.
\* Writes: src/components/BottomBar.tsx:99-114.
DistributionSurvivesServiceFailure == Settled => perfData = "fresh"
====
