---- MODULE ReplaceLifecycle ----
EXTENDS Naturals
VARIABLES step, scanStale, value, record, direction, ok, undoValue
vars == <<step, scanStale, value, record, direction, ok, undoValue>>
\* src/features/settings/modelReplace/ModelReplaceDialog.tsx:73,102; src-tauri/src/model_replace.rs:624-632,989-1015
Init == /\ step = "overview" /\ scanStale = FALSE /\ value = "A" /\ record = FALSE /\ direction = "none" /\ ok = FALSE /\ undoValue = "none"
Preview ==
 /\ step = "overview" \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:181-197 choose source; configure collapsed
 /\ step' = "plan" /\ UNCHANGED <<scanStale,value,record,direction,ok,undoValue>>
ExternalEdit ==
 /\ step = "plan" \* src-tauri/src/model_replace.rs:556 stale comparator boundary
 /\ value' = "C" /\ UNCHANGED <<step,scanStale,record,direction,ok,undoValue>>
Apply ==
 /\ step = "plan" /\ ~scanStale \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:350-355 stale apply gate; src-tauri/src/model_replace.rs:1082-1099
 /\ step' = "results" /\ scanStale' = TRUE /\ direction' = "forward"
 /\ value' = IF value = "A" THEN "B" ELSE value
 /\ ok' = (value = "A") /\ record' = (value = "A") /\ UNCHANGED undoValue \* src-tauri/src/model_replace.rs:556,669-673,989-999
LaterEdit ==
 /\ record /\ direction = "forward" \* src-tauri/src/model_replace.rs:1111-1125 external edit boundary
 /\ value' = "C" /\ UNCHANGED <<step,scanStale,record,direction,ok,undoValue>>
Undo ==
 /\ record /\ direction = "forward" \* src-tauri/src/model_replace.rs:1120-1128
 /\ direction' = "undo" /\ value' = IF value = "B" THEN "A" ELSE value
 /\ ok' = (value = "B") /\ undoValue' = (IF value = "B" THEN "A" ELSE value) /\ UNCHANGED <<step,scanStale,record>> \* src-tauri/src/model_replace.rs:651-656,556
Next == Preview \/ ExternalEdit \/ Apply \/ LaterEdit \/ Undo
Spec == Init /\ [][Next]_vars
TypeOK == step \in {"overview","plan","results"} /\ value \in {"A","B","C"} /\ scanStale \in BOOLEAN /\ record \in BOOLEAN /\ direction \in {"none","forward","undo"} /\ ok \in BOOLEAN /\ undoValue \in {"none","A","B","C"}
\* 撤销成功时恢复原值，后续手动修改则保持不动。
UndoGuard == direction = "undo" => ((ok /\ undoValue = "A") \/ (~ok /\ undoValue = "C"))
====
