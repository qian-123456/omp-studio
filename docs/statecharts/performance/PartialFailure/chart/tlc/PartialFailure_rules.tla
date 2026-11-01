---- MODULE PartialFailure_rules ----
EXTENDS PartialFailure
StatechartTLC == INSTANCE TLC
StatechartBroken == (IF MemorySurvivesServiceFailure THEN {} ELSE {"MemorySurvivesServiceFailure"}) \cup (IF DistributionSurvivesServiceFailure THEN {} ELSE {"DistributionSurvivesServiceFailure"})
StatechartRules == StatechartBroken = {} \/ StatechartTLC!PrintT(<<"statechart broken", [memPromise |-> memPromise, srvPromise |-> srvPromise, perfPromise |-> perfPromise, memoryInfo |-> memoryInfo, perfData |-> perfData, inFlight |-> inFlight], StatechartBroken>>)
====
