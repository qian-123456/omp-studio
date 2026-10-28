---- MODULE ReplaceOwnership ----
EXTENDS Naturals
VARIABLES runRef, writesInFlightRef, results, scanStale, rescanPendingRef, step, error
vars == <<runRef,writesInFlightRef,results,scanStale,rescanPendingRef,step,error>>
\* src/features/settings/modelReplace/ModelReplaceDialog.tsx:73,84,87,102-112 one apply request with captured run number 1
Init == /\ runRef = 0 /\ writesInFlightRef = 0 /\ results = FALSE /\ scanStale = FALSE /\ rescanPendingRef = FALSE /\ step = "preview" /\ error = FALSE
Start ==
 /\ runRef = 0 \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:209-213 one nonempty apply
 /\ runRef' = 1 /\ writesInFlightRef' = 1
 /\ UNCHANGED <<results,scanStale,rescanPendingRef,step,error>>
Leave ==
 /\ runRef = 1 \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:290-310 start over calls endRun
 /\ runRef' = 2 /\ results' = FALSE /\ step' = "overview"
 /\ rescanPendingRef' = (writesInFlightRef > 0) \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:117-120
 /\ UNCHANGED <<writesInFlightRef,scanStale,error>>
Complete ==
 /\ writesInFlightRef = 1 \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:216-232
 /\ writesInFlightRef' = 0 /\ scanStale' = TRUE
 /\ results' = (runRef = 1) /\ step' = IF runRef = 1 THEN "results" ELSE step
 /\ UNCHANGED <<runRef,rescanPendingRef,error>> \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:221-238
Fail ==
 /\ writesInFlightRef = 1 \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:233-238 failures remain visible after navigation
 /\ writesInFlightRef' = 0 /\ error' = TRUE
 /\ UNCHANGED <<runRef,results,scanStale,rescanPendingRef,step>>
Scan ==
 /\ writesInFlightRef = 0 /\ rescanPendingRef \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:240-242
 /\ rescanPendingRef' = FALSE /\ scanStale' = FALSE
 /\ UNCHANGED <<runRef,writesInFlightRef,results,step,error>>
System == Complete \/ Fail \/ Scan
Next == Start \/ Leave \/ System
Spec == Init /\ [][Next]_vars
TypeOK == runRef \in 0..2 /\ writesInFlightRef \in 0..1 /\ results \in BOOLEAN /\ scanStale \in BOOLEAN /\ rescanPendingRef \in BOOLEAN /\ step \in {"preview","overview","results"} /\ error \in BOOLEAN
\* 已离开的替换流程不能被迟到结果重新打开。
LeaveOwnsView == runRef = 2 => (step = "overview" /\ ~results)
====
