---- MODULE BaseSync ----
\* 工作树与本地基础分支的「变基」和「双向同步」。
\* 源码：src-tauri/src/git/base_sync.rs
EXTENDS Naturals

VARIABLES
  behind,      \* 基础分支比当前分支多出的提交；base_sync.rs:100 HEAD..base
  ahead,       \* 当前分支比基础分支多出的提交；base_sync.rs:114 base..HEAD
  dirty,       \* 工作区有无未提交改动；base_sync.rs:34 worktree::is_dirty
  conflictBase,\* 合并/变基时与基础分支是否冲突；base_sync.rs:101、base_sync.rs:73
  mainBlocks,  \* 检出基础分支的工作区是否有挡住快进的改动；base_sync.rs:119
  mergedHere,  \* 当前分支是否已经多了一个并入基础分支的合并提交；base_sync.rs:101
  result,      \* 界面看到的结果："none" "ok" "error"
  step,        \* 同步进行到哪一步："idle" "merged"
  halfDone     \* 模型观测：报错后当前分支的历史已被改动

vars == <<behind, ahead, dirty, conflictBase, mainBlocks, mergedHere, result, step, halfDone>>

Init ==
  /\ behind \in BOOLEAN /\ ahead \in BOOLEAN /\ dirty \in BOOLEAN
  /\ conflictBase \in BOOLEAN /\ mainBlocks \in BOOLEAN
  /\ mergedHere = FALSE /\ result = "none" /\ step = "idle" /\ halfDone = FALSE

\* 点「与基础分支同步」：先做前置检查，再并入基础分支。
SyncMerge ==
  /\ step = "idle"                               \* base_sync.rs:100 guard 通过后才开始一次同步
  /\ ~dirty                                      \* base_sync.rs:34 工作区有改动则拒绝
  /\ behind                                      \* base_sync.rs:102 merged_from_base 大于 0 才并入
  /\ ~conflictBase                               \* base_sync.rs:103 merge 成功不进入冲突分支
  /\ behind' = FALSE                             \* base_sync.rs:103 git merge --no-edit base
  /\ mergedHere' = TRUE                          \* base_sync.rs:103 当前分支多了一个合并提交
  /\ ahead' = TRUE                               \* base_sync.rs:109 合并提交使当前分支领先基础分支
  /\ step' = "merged"                            \* base_sync.rs:109 进入快进阶段
  /\ UNCHANGED <<dirty, conflictBase, mainBlocks, result, halfDone>>

\* 并入时冲突：中止合并，分支保持原样。
SyncConflict ==
  /\ step = "idle"                               \* base_sync.rs:100 guard 通过后才开始一次同步
  /\ ~dirty                                      \* base_sync.rs:34 工作区有改动则拒绝
  /\ behind                                      \* base_sync.rs:102 merged_from_base 大于 0 才并入
  /\ conflictBase                                \* base_sync.rs:103 merge 返回错误即冲突分支
  /\ result' = "error"                           \* base_sync.rs:106 返回冲突文件列表
  /\ UNCHANGED <<behind, ahead, dirty, conflictBase, mainBlocks, mergedHere, step, halfDone>>  \* base_sync.rs:105 merge --abort 还原

\* 没有要并入的内容时直接进入快进。
SyncSkipMerge ==
  /\ step = "idle"                               \* base_sync.rs:100 guard 通过后才开始一次同步
  /\ ~dirty                                      \* base_sync.rs:34 工作区有改动则拒绝
  /\ ~behind                                     \* base_sync.rs:102 merged_from_base 为 0 跳过并入
  /\ step' = "merged"                            \* base_sync.rs:109 直接进入快进阶段
  /\ UNCHANGED <<behind, ahead, dirty, conflictBase, mainBlocks, mergedHere, result, halfDone>>

\* 快进基础分支。
SyncFastForward ==
  /\ step = "merged"                             \* base_sync.rs:109 并入阶段结束后才计算快进数量
  /\ result' = IF ahead /\ mainBlocks THEN "error" ELSE "ok"  \* base_sync.rs:116 检出基础分支的工作区 merge --ff-only 失败即报错
  /\ halfDone' = (ahead /\ mainBlocks /\ mergedHere)          \* base_sync.rs:117 报错时没有回滚第 103 行已提交的合并
  /\ ahead' = IF ahead /\ mainBlocks THEN ahead ELSE FALSE    \* base_sync.rs:116 快进成功后基础分支追平
  /\ step' = "idle"                              \* base_sync.rs:128 本次同步结束
  /\ UNCHANGED <<behind, dirty, conflictBase, mainBlocks, mergedHere>>

\* 点「变基到基础分支」：冲突时中止，分支保持原样。
RebaseOk ==
  /\ step = "idle"                               \* base_sync.rs:71 变基从 guard 通过开始
  /\ ~dirty                                      \* base_sync.rs:34 工作区有改动则拒绝
  /\ ~conflictBase                               \* base_sync.rs:72 rebase 成功不进入错误分支
  /\ behind' = FALSE                             \* base_sync.rs:72 git rebase base
  /\ result' = "ok"                              \* base_sync.rs:73 返回成功输出
  /\ UNCHANGED <<ahead, dirty, conflictBase, mainBlocks, mergedHere, step, halfDone>>

RebaseConflict ==
  /\ step = "idle"                               \* base_sync.rs:71 变基从 guard 通过开始
  /\ ~dirty                                      \* base_sync.rs:34 工作区有改动则拒绝
  /\ conflictBase                                \* base_sync.rs:72 rebase 返回错误即冲突分支
  /\ result' = "error"                           \* base_sync.rs:77 返回冲突文件列表
  /\ UNCHANGED <<behind, ahead, dirty, conflictBase, mainBlocks, mergedHere, step, halfDone>>  \* base_sync.rs:76 rebase --abort 还原

Next == SyncMerge \/ SyncConflict \/ SyncSkipMerge \/ SyncFastForward \/ RebaseOk \/ RebaseConflict

Spec == Init /\ [][Next]_vars

\* 同步或变基报错时，当前分支的提交历史保持同步前的样子。
ErrorLeavesBranchUntouched == ~halfDone
====
