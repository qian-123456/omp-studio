------------------------ MODULE ExtensionEnableRollback ------------------------
\* 启用一个 .disabled 扩展：先写配置，再重命名文件；失败时只回滚界面。
EXTENDS Naturals

VARIABLES
  extPhase,        \* idle / cfgWritten / failed / done（skills/store.ts:470-495 try/catch 流程）
  extCfgDisabled,  \* 配置里该扩展被禁用 (skills/store.ts:472 updateOmpListSetting)
  extUiEnabled     \* 界面显示该扩展已启用 (skills/store.ts:463-469 乐观更新、:487-488 回滚)

vars == <<extPhase, extCfgDisabled, extUiEnabled>>
Init == extPhase = "idle" /\ extCfgDisabled = TRUE /\ extUiEnabled = FALSE

\* 点启用：乐观显示已启用并写配置 (skills/store.ts:463-472)
ExtEnableStart ==
  /\ extPhase = "idle"
  /\ extUiEnabled' = TRUE                      \* skills/store.ts:469
  /\ extCfgDisabled' = FALSE                   \* skills/store.ts:472
  /\ extPhase' = "cfgWritten"

\* 文件重命名失败：回滚界面，配置不回滚 (skills/store.ts:477 抛出 → :486-488)
ExtRenameFails ==
  /\ extPhase = "cfgWritten"
  /\ extPhase' = "failed"
  /\ extUiEnabled' = FALSE                     \* skills/store.ts:488
  /\ UNCHANGED extCfgDisabled

ExtRenameOk ==
  /\ extPhase = "cfgWritten"
  /\ extPhase' = "done"                        \* skills/store.ts:477-481
  /\ UNCHANGED <<extCfgDisabled, extUiEnabled>>

Next == ExtEnableStart \/ ExtRenameFails \/ ExtRenameOk
Spec == Init /\ [][Next]_vars

\* 规则：扩展启用失败回滚后，界面显示的状态与配置里的状态一致。
UiMatchesConfigAfterFailure == (extPhase = "failed") => (extUiEnabled = ~extCfgDisabled)
=====================================================================
