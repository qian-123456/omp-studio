---- MODULE RoleScope ----
EXTENDS Naturals
VARIABLES scope, table, global, project, effective, phase
vars == <<scope,table,global,project,effective,phase>>
\* src/features/settings/modelRoleScope.tsx:42-46; settings_model_roles.rs:377-395 finite model values for one named key
Init == /\ scope = "global" /\ table \in {"role","override"} /\ global = "G" /\ project = "P" /\ effective = "none" /\ phase = "unread"
ChooseProject ==
 /\ scope = "global" \* src/features/settings/modelRoleScope.tsx:134-140 available project fixture
 /\ scope' = "project" /\ phase' = "unread"
 /\ UNCHANGED <<table,global,project,effective>>
ChooseGlobal ==
 /\ scope = "project" \* src/features/settings/modelRoleScope.tsx:134-136
 /\ scope' = "global" /\ phase' = "unread"
 /\ UNCHANGED <<table,global,project,effective>>
Resolve ==
 /\ phase = "unread" \* src/features/settings/AgentModelAssignmentsPanel.tsx:89-108 scoped read
 /\ effective' = IF scope = "global" THEN global ELSE IF table = "override" /\ global # "none" THEN global ELSE IF project # "none" THEN project ELSE global
 /\ phase' = "read" /\ UNCHANGED <<scope,table,global,project>> \* src-tauri/src/settings_model_roles.rs:377-395 per-key layer precedence
DeleteGlobal ==
 /\ scope = "global" /\ global # "none" \* src/features/settings/AgentModelAssignmentsPanel.tsx:133-141 null deletes selected layer entry
 /\ global' = "none" /\ phase' = "unread"
 /\ UNCHANGED <<scope,table,project,effective>>
System == Resolve
Next == ChooseProject \/ ChooseGlobal \/ DeleteGlobal \/ System
Spec == Init /\ [][Next]_vars
TypeOK == scope \in {"global","project"} /\ table \in {"role","override"} /\ global \in {"none","G"} /\ project = "P" /\ effective \in {"none","G","P"} /\ phase \in {"read","unread"}
\* 全局页面的结果不混入项目配置。
GlobalIsolation == (phase = "read" /\ scope = "global") => effective = global
\* 项目角色优先，但全局点名覆盖优先。
Precedence == (phase = "read" /\ scope = "project" /\ global # "none" /\ project # "none") => effective = IF table = "role" THEN "P" ELSE "G"
====
