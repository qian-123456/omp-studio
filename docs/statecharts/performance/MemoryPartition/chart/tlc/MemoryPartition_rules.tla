---- MODULE MemoryPartition_rules ----
EXTENDS MemoryPartition
StatechartTLC == INSTANCE TLC
StatechartBroken == (IF SegmentsAddToTotal THEN {} ELSE {"SegmentsAddToTotal"})
StatechartRules == StatechartBroken = {} \/ StatechartTLC!PrintT(<<"statechart broken", [total_bytes |-> total_bytes, used_bytes |-> used_bytes, app |-> app, bar_omp_bytes |-> bar_omp_bytes, other_bytes |-> other_bytes, free_bytes |-> free_bytes], StatechartBroken>>)
====
