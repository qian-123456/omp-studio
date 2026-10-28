---- MODULE TemplateSnapshot ----
EXTENDS Naturals
VARIABLES snapshotGeneration, snapshotInflight, snapshot, committed, readValue
vars == <<snapshotGeneration, snapshotInflight, snapshot, committed, readValue>>
\* src/features/settings/modelTemplates/store.ts:33-44 maps request generation and displayed snapshot; committed is last mutation response observed at line 87.
Init == /\ snapshotGeneration = 0 /\ snapshotInflight = 0 /\ snapshot = "empty" /\ committed = FALSE /\ readValue = "empty"
Load ==
    /\ snapshotGeneration = 0 \* src/features/settings/modelTemplates/store.ts:47-48 first request
    /\ snapshotGeneration' = 1 /\ snapshotInflight' = 1 /\ readValue' = (IF committed THEN "new" ELSE "old")
    /\ UNCHANGED <<snapshot, committed>> \* src/features/settings/modelTemplates/store.ts:49
Publish ==
    /\ ~committed \* src/features/settings/modelTemplates/TemplateEditor.tsx:145-155 one completed save in the bound; RulesCard.tsx:440-442 is another publisher
    /\ snapshot' = "new" /\ committed' = TRUE
    /\ UNCHANGED <<snapshotGeneration, snapshotInflight, readValue>> \* src/features/settings/modelTemplates/store.ts:87
Resolve ==
    /\ snapshotInflight > 0 \* src/features/settings/modelTemplates/store.ts:50-52 pending read returns
    /\ snapshot' = IF snapshotInflight = snapshotGeneration THEN readValue ELSE snapshot
    /\ snapshotInflight' = 0 /\ UNCHANGED <<snapshotGeneration, committed, readValue>> \* src/features/settings/modelTemplates/store.ts:52,58
Fail ==
    /\ snapshotInflight > 0 \* src/features/settings/modelTemplates/store.ts:54-59
    /\ snapshotInflight' = 0 /\ UNCHANGED <<snapshotGeneration, snapshot, committed, readValue>>
System == Resolve \/ Fail
Next == Load \/ Publish \/ System
Spec == Init /\ [][Next]_vars
TypeOK == snapshotGeneration \in 0..1 /\ snapshotInflight \in 0..1 /\ snapshot \in {"empty","new","old"} /\ committed \in BOOLEAN /\ readValue \in {"empty","old","new"}
\* 已确认保存的新内容不能被更早开始的读取覆盖。
MutationSurvives == committed => snapshot = "new"
====
