---- MODULE SnapshotAgreement_rules ----
EXTENDS SnapshotAgreement
StatechartTLC == INSTANCE TLC
StatechartBroken == (IF SameAppMemorySample THEN {} ELSE {"SameAppMemorySample"})
StatechartRules == StatechartBroken = {} \/ StatechartTLC!PrintT(<<"statechart broken", [memPromise |-> memPromise, perfPromise |-> perfPromise, memoryInfo |-> memoryInfo, perfData |-> perfData], StatechartBroken>>)
====
