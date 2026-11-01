---- MODULE RefreshOverlapFixed_rules ----
EXTENDS RefreshOverlapFixed
StatechartTLC == INSTANCE TLC
StatechartBroken == (IF NoOverlappingMemoryScans THEN {} ELSE {"NoOverlappingMemoryScans"})
StatechartRules == StatechartBroken = {} \/ StatechartTLC!PrintT(<<"statechart broken", [perfOpen |-> perfOpen, cancelled |-> cancelled, inFlight |-> inFlight, memPromise |-> memPromise], StatechartBroken>>)
====
