---- MODULE TemplateSwitch ----
EXTENDS Naturals
VARIABLES phase, scope, preflight, force, drifted_roles, status, written
vars == <<phase,scope,preflight,force,drifted_roles,status,written>>
\* src-tauri/src/model_templates/apply.rs:306-328; rules.rs:553-555,716 scope and finite quota boundary
Init == /\ phase = "idle" /\ scope \in {"global","project"} /\ preflight = "unknown" /\ force = FALSE /\ drifted_roles = FALSE /\ status = "none" /\ written = FALSE
Hit ==
 /\ phase = "idle" \* src-tauri/src/model_templates/rules.rs:553-570 first threshold hit per scope
 /\ phase' = "preview" /\ preflight' \in {"ok","blocked","partial"}
 /\ UNCHANGED <<scope,force,drifted_roles,status,written>>
NoHit ==
 /\ phase = "idle" \* src-tauri/src/model_templates/rules.rs:557-560 absent window or below threshold
 /\ phase' = "done" /\ status' = "skipped"
 /\ UNCHANGED <<scope,preflight,force,drifted_roles,written>>
Refuse ==
 /\ phase = "preview" /\ preflight = "blocked" /\ ~force \* src-tauri/src/model_templates/apply.rs:328-352
 /\ phase' = "refused" /\ status' = "refused"
 /\ UNCHANGED <<scope,preflight,force,drifted_roles,written>>
Force ==
 /\ phase = "refused" \* src-tauri/src/model_templates/rules.rs:576-585 same-scope bottom line; ApplyPreview.tsx:169-170 explicit override
 /\ phase' = "preview" /\ force' = TRUE
 /\ UNCHANGED <<scope,preflight,drifted_roles,status,written>>
Write ==
 /\ phase = "preview" /\ (preflight # "blocked" \/ force) \* src-tauri/src/model_templates/apply.rs:328,355-378
 /\ phase' = "sessions" /\ written' = TRUE
 /\ UNCHANGED <<scope,preflight,force,drifted_roles,status>>
WriteFail ==
 /\ phase = "preview" /\ (preflight # "blocked" \/ force) \* src-tauri/src/model_templates/apply.rs:328,360-375
 /\ phase' = "done" /\ status' = "failed"
 /\ UNCHANGED <<scope,preflight,force,drifted_roles,written>>
Finish ==
 /\ phase = "sessions" \* src-tauri/src/model_templates/apply.rs:378-395 independent live-session results
 /\ phase' = "done" /\ status' \in (IF preflight = "partial" THEN {"partial"} ELSE {"applied","partial"})
 /\ UNCHANGED <<scope,preflight,force,drifted_roles,written>>
Drift ==
 /\ phase = "done" /\ written \* src-tauri/src/model_templates/rules.rs:276-287 manual edit detection
 /\ drifted_roles' = TRUE /\ UNCHANGED <<phase,scope,preflight,force,status,written>>
AutoRevert ==
 /\ phase = "done" /\ written /\ ~drifted_roles \* src-tauri/src/model_templates/rules.rs:693-716 current enabled auto-revert, window due abstracted true
 /\ phase' = "reverted" /\ written' = FALSE /\ status' = "restored"
 /\ UNCHANGED <<scope,preflight,force,drifted_roles>>
System == Refuse \/ Write \/ WriteFail \/ Finish \/ AutoRevert
Next == Hit \/ NoHit \/ Force \/ Drift \/ System
Spec == Init /\ [][Next]_vars
TypeOK == phase \in {"idle","preview","refused","sessions","done","reverted"} /\ scope \in {"global","project"} /\ preflight \in {"unknown","ok","blocked","partial"} /\ force \in BOOLEAN /\ drifted_roles \in BOOLEAN /\ written \in BOOLEAN /\ status \in {"none","skipped","refused","failed","partial","applied","restored"}
\* 额度阻止且未显式强制时不能写入配置。
QuotaGate == (preflight = "blocked" /\ ~force) => ~written
\* 已被手动修改的配置不能自动恢复。
DriftGate == drifted_roles => phase # "reverted"
====
