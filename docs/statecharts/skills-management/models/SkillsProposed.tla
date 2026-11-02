---------------- MODULE SkillsProposed ----------------
EXTENDS Naturals, FiniteSets
\* catalog abstracts winner plus copy count for one skill, src-tauri/src/skills/commands.rs:402-423.
\* path abstracts directories on disk, src-tauri/src/skills/commands.rs:739-745.
\* pc records await boundaries, src/features/skills/store.ts:566-584.
VARIABLES catalog, path, trashingDirs, loading, error, deleteAnchor, dir, success, pc
vars == <<catalog, path, trashingDirs, loading, error, deleteAnchor, dir, success, pc>>
First(s) == IF 1 \in s THEN 1 ELSE 2
Init == /\ catalog \in {{1}, {1,2}}
        /\ path = catalog /\ trashingDirs = {} /\ loading = FALSE
        /\ error = "" /\ deleteAnchor = FALSE /\ dir = 0 /\ success = FALSE /\ pc = "idle"
OpenDelete ==
  /\ pc = "idle" \* src/features/skills/SkillsPage.tsx:1451-1454, row opens confirmation.
  /\ catalog # {} \* src/features/skills/SkillsPage.tsx:1451-1454, clicked row supplies skill.
  /\ deleteAnchor' = TRUE /\ dir' = First(catalog) /\ pc' = "confirm"
  /\ UNCHANGED <<catalog,path,trashingDirs,loading,error,success>>
CancelDelete ==
  /\ pc = "confirm" \* src/features/skills/SkillsPage.tsx:209-215.
  /\ deleteAnchor' = FALSE /\ pc' = "idle"
  /\ UNCHANGED <<catalog,path,trashingDirs,loading,error,dir,success>>
ConfirmDelete ==
  /\ pc = "confirm" \* src/features/skills/SkillsPage.tsx:934-938.
  /\ dir \notin trashingDirs \* src/features/skills/store.ts:567.
  /\ trashingDirs' = {dir} /\ pc' = "trash" /\ success' = FALSE
  /\ UNCHANGED <<catalog,path,loading,error,deleteAnchor,dir>>
TrashSucceeded ==
  /\ pc = "trash" \* src/features/skills/store.ts:570-573.
  /\ dir \in path \* src-tauri/src/skills/commands.rs:739-742, successful move of existing directory.
  /\ path' = path \ {dir} /\ success' = TRUE /\ pc' = "reload"
  /\ UNCHANGED <<catalog,trashingDirs,loading,error,deleteAnchor,dir>>
TrashFailed ==
  /\ pc = "trash" \* src/features/skills/store.ts:570,574-579, OS trash can fail.
  /\ error' = "trash" /\ pc' = "finish"
  /\ UNCHANGED <<catalog,path,trashingDirs,loading,deleteAnchor,dir,success>>
LoadCatalog ==
  /\ pc = "reload" \* src/features/skills/store.ts:573,324-325.
  /\ loading' = TRUE /\ error' = "" /\ pc' = "loading"
  /\ UNCHANGED <<catalog,path,trashingDirs,deleteAnchor,dir,success>>
LoadSucceeded ==
  /\ pc = "loading" \* src/features/skills/store.ts:327-341, concurrent requests excluded.
  /\ catalog' = path /\ loading' = FALSE /\ pc' = "finish"
  /\ UNCHANGED <<path,trashingDirs,error,deleteAnchor,dir,success>>
LoadFailed ==
  /\ pc = "loading" \* src/features/skills/store.ts:342-347, catch retains catalog.
\* Proposal: quarantine only the affected logical row until a verified rescan; no app fix implemented.
  /\ loading' = FALSE /\ error' = "refresh" /\ pc' = "finish" /\ catalog' = {}
  /\ UNCHANGED <<path,trashingDirs,deleteAnchor,dir,success>>
FinishDelete ==
  /\ pc = "finish" \* src/features/skills/store.ts:580-584; src/features/skills/SkillsPage.tsx:939-942.
  /\ trashingDirs' = {} /\ deleteAnchor' = FALSE /\ pc' = "idle"
  /\ UNCHANGED <<catalog,path,loading,error,dir,success>>
System == TrashSucceeded \/ TrashFailed \/ LoadCatalog \/ LoadSucceeded \/ LoadFailed \/ FinishDelete
Next == OpenDelete \/ CancelDelete \/ ConfirmDelete \/ System
Spec == Init /\ [][Next]_vars
Settled == ~ENABLED System
\* 删除操作结束后，列表不能继续把已移走的目录当成当前安装位置。
\* Mutators: src/features/skills/store.ts:317-348,566-584.
NoSettledStaleRow == Settled => catalog \subseteq path
\* 有限模型的状态和值必须有效。
TypeOK == /\ catalog \subseteq {1,2} /\ path \subseteq {1,2}
          /\ trashingDirs \subseteq {1,2} /\ loading \in BOOLEAN
          /\ success \in BOOLEAN /\ deleteAnchor \in BOOLEAN
          /\ dir \in {0,1,2} /\ error \in {"","trash","refresh"}
          /\ pc \in {"idle","confirm","trash","reload","loading","finish"}
====
