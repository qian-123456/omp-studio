---- MODULE ProposedDesign_rules ----
EXTENDS ProposedDesign
StatechartTLC == INSTANCE TLC
StatechartBroken == (IF TypeOK THEN {} ELSE {"TypeOK"}) \cup (IF NoFalseCompletion THEN {} ELSE {"NoFalseCompletion"}) \cup (IF NoUnknownCompletion THEN {} ELSE {"NoUnknownCompletion"}) \cup (IF NoEarlyCompletion THEN {} ELSE {"NoEarlyCompletion"})
StatechartRules == StatechartBroken = {} \/ StatechartTLC!PrintT(<<"statechart broken", [Step |-> Step, Step2 |-> Step2], StatechartBroken>>)
====
