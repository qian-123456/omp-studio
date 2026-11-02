---- MODULE SkillsProposed_rules ----
EXTENDS SkillsProposed
StatechartTLC == INSTANCE TLC
StatechartBroken == (IF TypeOK THEN {} ELSE {"TypeOK"}) \cup (IF NoSettledStaleRow THEN {} ELSE {"NoSettledStaleRow"})
StatechartRules == StatechartBroken = {} \/ StatechartTLC!PrintT(<<"statechart broken", [catalog |-> catalog, path |-> path, trashingDirs |-> trashingDirs, loading |-> loading, error |-> error, deleteAnchor |-> deleteAnchor, dir |-> dir, success |-> success, pc |-> pc], StatechartBroken>>)
====
