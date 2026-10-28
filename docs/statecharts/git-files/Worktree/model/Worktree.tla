---- MODULE Worktree ----
\* 会话 worktree、时光机 worktree、孤儿扫描与回收、删除的部分失败。
\* 源码：src-tauri/src/git/worktree.rs、tm.rs、commands.rs；src/features/git/OrphanBadge.tsx、removeWorktree.tsx、WorktreeSection.tsx
EXTENDS Naturals

VARIABLES
  sWt,          \* 会话 worktree 目录是否存在：worktree.rs create/remove
  sBranch,      \* 会话 worktree 的分支："none" 无分支，"merged" 已并入基础分支，"unmerged" 有独有提交
  sDirty,       \* 会话 worktree 有无未提交改动：worktree.rs is_dirty
  sSession,     \* 目录内是否有目录库登记的会话：worktree.rs sessions_for_path
  tWt,          \* 时光机 worktree（.worktrees/tm-<sha>）目录是否存在
  tProc,        \* 时光机进程："none" 未跑过，"running" 在跑，"exited" 已退出：tm.rs Run.info.pid
  shownS,       \* 孤儿列表是否还显示会话 worktree：OrphanBadge.tsx orphans
  shownT,       \* 孤儿列表是否还显示时光机 worktree
  errShown,     \* 清理失败提示是否显示：OrphanBadge.tsx error
  killedLive, lostSession, lostDirty, staleList  \* 模型观测旗标，只由动作写入

vars == <<sWt, sBranch, sDirty, sSession, tWt, tProc, shownS, shownT, errShown,
          killedLive, lostSession, lostDirty, staleList>>

Init ==
  /\ sWt = "absent" /\ sBranch = "none" /\ sDirty = FALSE /\ sSession = FALSE
  /\ tWt = "absent" /\ tProc = "none"
  /\ shownS = FALSE /\ shownT = FALSE /\ errShown = FALSE
  /\ killedLive = FALSE /\ lostSession = FALSE /\ lostDirty = FALSE /\ staleList = FALSE

\* 新建会话 worktree，并在其中新建分支。
CreateWorktree ==
  /\ sWt = "absent"                              \* worktree.rs:338 目标目录已存在则拒绝
  /\ sBranch = "none"                            \* worktree.rs:353 分支已被另一工作树占用则拒绝
  /\ sWt' = "present"                            \* worktree.rs:390 git worktree add -b
  /\ sBranch' = "merged"                         \* worktree.rs:377 新分支从基准提交切出
  /\ UNCHANGED <<sDirty, sSession, tWt, tProc, shownS, shownT, errShown, killedLive, lostSession, lostDirty, staleList>>

\* 在该 worktree 里改文件或产生提交。
EditWorktree ==
  /\ sWt = "present"                             \* worktree.rs:151 dirty_count 只对存在的目录计数
  /\ ~sDirty                                     \* 抽象：从干净变脏
  /\ sDirty' = TRUE                              \* worktree.rs:160 is_dirty
  /\ UNCHANGED <<sWt, sBranch, sSession, tWt, tProc, shownS, shownT, errShown, killedLive, lostSession, lostDirty, staleList>>

CommitWorktree ==
  /\ sWt = "present"                             \* worktree.rs:272 ahead_behind 只对存在的目录计算
  /\ sBranch = "merged"                          \* 抽象：分支从已并入变为有独有提交
  /\ sBranch' = "unmerged"                       \* worktree.rs:272 ahead 大于 0
  /\ UNCHANGED <<sWt, sDirty, sSession, tWt, tProc, shownS, shownT, errShown, killedLive, lostSession, lostDirty, staleList>>

\* 会话在该 worktree 里开始 / 结束。
AttachSession ==
  /\ sWt = "present"                             \* worktree.rs:181 会话按 cwd 落在存在的 worktree 内
  /\ ~sSession                                   \* 抽象：从无会话变有会话
  /\ sSession' = TRUE                            \* worktree.rs:181 sessions_for_canon 命中
  /\ UNCHANGED <<sWt, sBranch, sDirty, tWt, tProc, shownS, shownT, errShown, killedLive, lostSession, lostDirty, staleList>>

DetachSession ==
  /\ sSession                                    \* 抽象：只有已有会话才会结束
  /\ sSession' = FALSE                           \* worktree.rs:181 sessions_for_canon 不再命中
  /\ UNCHANGED <<sWt, sBranch, sDirty, tWt, tProc, shownS, shownT, errShown, killedLive, lostSession, lostDirty, staleList>>

\* 点击「运行这个旧提交」：新建或复用 tm- worktree 并启动进程。
TmRun ==
  /\ tProc # "running"                           \* tm.rs:271 已有在跑的同提交运行直接返回
  /\ tWt' = "present"                            \* worktree.rs:417 create_detached 新建或复用
  /\ tProc' = "running"                          \* tm.rs:322 info.pid = child.id()
  /\ UNCHANGED <<sWt, sBranch, sDirty, sSession, shownS, shownT, errShown, killedLive, lostSession, lostDirty, staleList>>

TmExit ==
  /\ tProc = "running"                           \* tm.rs:335 child.wait 返回
  /\ tProc' = "exited"                           \* tm.rs:337 pid 置空
  /\ UNCHANGED <<sWt, sBranch, sDirty, sSession, tWt, shownS, shownT, errShown, killedLive, lostSession, lostDirty, staleList>>

\* 点停止并移除：先杀进程组，再强制删除 worktree。
TmStopRemove ==
  /\ tProc \in {"running", "exited"}             \* tm.rs:395 运行记录存在
  /\ tProc' = "exited"                           \* tm.rs:402 pid 置空
  /\ tWt' = "absent"                             \* tm.rs:408 worktree::remove force
  /\ UNCHANGED <<sWt, sBranch, sDirty, sSession, shownS, shownT, errShown, killedLive, lostSession, lostDirty, staleList>>

\* 孤儿扫描：落在 .worktrees 下且没有会话的 worktree 都算孤儿。
ScanOrphans ==
  /\ shownS' = (sWt = "present" /\ ~sSession)    \* worktree.rs:484 session_ids 为空才算孤儿
  /\ shownT' = (tWt = "present")                 \* worktree.rs:484 时光机目录从不挂会话，也不排除运行中的
  /\ UNCHANGED errShown                          \* OrphanBadge.tsx:52 扫描只重设列表，不清错误提示（错误由 :69 reclaim 清）
  /\ staleList' = FALSE                          \* OrphanBadge.tsx:52 列表重新来自磁盘
  /\ UNCHANGED <<sWt, sBranch, sDirty, sSession, tWt, tProc, killedLive, lostSession, lostDirty>>

\* 点「回收」某个会话 worktree：force 取决于用户勾选，是否删分支取决于勾选。
ReclaimSession(force, delBranch) ==
  /\ shownS                                      \* OrphanBadge.tsx:84 reclaimAll/回收都按 :29 已有快照，不重新扫描
  /\ sWt = "present"                             \* worktree.rs:443 不是该仓库的 worktree 则报错
  /\ ~(sDirty /\ ~force)                         \* worktree.rs:444 脏且未强制则拒绝
  /\ sWt' = "absent"                             \* worktree.rs:454 git worktree remove
  /\ lostSession' = (lostSession \/ sSession)    \* worktree.rs:431 删除时不核对会话
  /\ lostDirty' = (lostDirty \/ (sDirty /\ ~force))  \* worktree.rs:444 守卫已拒绝，此项应恒为假
  /\ sDirty' = FALSE                             \* worktree.rs:450 --force 丢弃改动
  /\ IF delBranch /\ sBranch # "none"            \* worktree.rs:458 delete_branch 且有分支
       THEN IF sBranch = "unmerged" /\ ~force    \* worktree.rs:460 非强制用 -d，未合并分支会失败
              THEN /\ sBranch' = sBranch         \* worktree.rs:461 分支保留
                   /\ errShown' = TRUE           \* worktree.rs:462 返回「已删除，但分支未删除」
                   /\ shownS' = shownS           \* OrphanBadge.tsx:77 出错分支不更新列表
                   /\ staleList' = TRUE          \* OrphanBadge.tsx:77 列表仍显示已被删除的目录
              ELSE /\ sBranch' = "none"          \* worktree.rs:461 git branch -d/-D
                   /\ shownS' = FALSE            \* OrphanBadge.tsx:74 成功后从列表移除
                   /\ UNCHANGED <<errShown, staleList>>
       ELSE /\ UNCHANGED <<sBranch, errShown, staleList>>
            /\ shownS' = FALSE                   \* OrphanBadge.tsx:74 成功后从列表移除
  /\ sSession' = sSession                        \* 目录库里的会话记录不随删除改变
  /\ UNCHANGED <<tWt, tProc, shownT, killedLive>>

\* 点「回收」时光机 worktree：同一条路径，不检查进程。
ReclaimTm(force) ==
  /\ shownT                                      \* OrphanBadge.tsx:68 回收只作用于 :29 已有快照里的项
  /\ tWt = "present"                             \* worktree.rs:443 不是该仓库的 worktree 则报错
  /\ tWt' = "absent"                             \* worktree.rs:454 git worktree remove
  /\ killedLive' = (killedLive \/ tProc = "running")  \* worktree.rs:431 删除前不查时光机进程
  /\ shownT' = FALSE                             \* OrphanBadge.tsx:74 成功后从列表移除
  /\ force \in BOOLEAN                           \* 抽象：强制与否不影响此守卫
  /\ UNCHANGED <<sWt, sBranch, sDirty, sSession, tProc, shownS, errShown, lostSession, lostDirty, staleList>>

Next ==
  \/ CreateWorktree \/ EditWorktree \/ CommitWorktree \/ AttachSession \/ DetachSession
  \/ TmRun \/ TmExit \/ TmStopRemove \/ ScanOrphans
  \/ \E f \in BOOLEAN, d \in BOOLEAN : ReclaimSession(f, d)
  \/ \E f \in BOOLEAN : ReclaimTm(f)

Spec == Init /\ [][Next]_vars

\* 正在运行的时光机不会被「回收孤儿」删掉目录。
NoKillRunningRun == ~killedLive
\* 有会话在用的工作树不会被「回收孤儿」删掉。
NoRemoveInUse == ~lostSession
\* 有未提交改动的工作树不会在没有强制的情况下被删掉。
NoSilentDirtyLoss == ~lostDirty
\* 清理失败后，界面不会再显示一个磁盘上已经不存在的工作树。
NoStaleListing == ~staleList
====
