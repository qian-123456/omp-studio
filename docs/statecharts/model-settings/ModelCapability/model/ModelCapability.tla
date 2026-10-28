---- MODULE ModelCapability ----
EXTENDS Naturals
VARIABLES toModel, level, overrideModel, overrideLevel
vars == <<toModel,level,overrideModel,overrideLevel>>
\* src/features/settings/modelReplace/ModelReplaceDialog.tsx:77-83,163-171; logic.ts:73-84 scalar abstraction of one row override
Init == /\ toModel = "chatHigh" /\ level = "none" /\ overrideModel = "none" /\ overrideLevel = "none"
Levels(model) == CASE model = "chatHigh" -> {"high"} [] model = "chatLow" -> {"low"} [] OTHER -> {}
Supported(value, model) == IF value \in Levels(model) THEN value ELSE "none"
PickLevel ==
 /\ toModel = "chatHigh" /\ level = "none" \* src/features/settings/modelReplace/parts.tsx:46-59 only target-supported options
 /\ level' = "high" /\ UNCHANGED <<toModel,overrideModel,overrideLevel>>
PickLow ==
 /\ toModel = "chatHigh" \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:199-204 choose another chat target
 /\ toModel' = "chatLow" /\ level' = Supported(level,"chatLow")
 /\ UNCHANGED <<overrideModel,overrideLevel>>
PickSearch ==
 /\ toModel # "search" \* src/features/settings/modelReplace/ModelReplaceDialog.tsx:199-204 kind change drops overrides and thinking
 /\ toModel' = "search" /\ level' = "none" /\ overrideModel' = "none" /\ overrideLevel' = "none"
OverrideLow ==
 /\ toModel = "chatHigh" /\ overrideModel = "none" \* src/features/settings/modelReplace/ModelReplacePlanPreview.tsx:100-109 same-kind override only
 /\ overrideModel' = "chatLow" /\ overrideLevel' = Supported(level,"chatLow")
 /\ UNCHANGED <<toModel,level>>
Next == PickLevel \/ PickLow \/ PickSearch \/ OverrideLow
Spec == Init /\ [][Next]_vars
TypeOK == toModel \in {"chatHigh","chatLow","search"} /\ level \in {"none","high","low"} /\ overrideModel \in {"none","chatLow"} /\ overrideLevel \in {"none","high","low"}
\* 目标不支持的思考等级不能写入替换计划。
SupportedThinking == (level = "none" \/ level \in Levels(toModel)) /\ (overrideLevel = "none" \/ overrideLevel \in Levels(overrideModel))
\* 切换到非对话服务后不保留对话模型的行级覆盖。
KindIsolation == toModel = "search" => (level = "none" /\ overrideModel = "none")
====
