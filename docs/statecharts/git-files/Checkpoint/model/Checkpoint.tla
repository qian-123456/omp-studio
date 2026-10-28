---- MODULE Checkpoint ----
\* 每轮对话的快照存档、撤回（含级联）、存档清理。
\* 源码：extension/omp-workspace-checkpoints.ts、src-tauri/src/git/turns.rs、src/features/chat/turnChips.ts
EXTENDS Naturals, FiniteSets

\* 模型缩小：3 轮、只保留最近 2 轮存档（源码 KEEP_TURNS = 50，见 extension/omp-workspace-checkpoints.ts:55）。
Turns == 1..3
Keep == 2

VARIABLES
  cur,        \* 扩展里的 current：正在记录的轮次，0 为无；extension/omp-workspace-checkpoints.ts:468
  phase,      \* 每轮的阶段："idle" 未开始 "running" 进行中 "recorded" 已记录 "empty" 无改动 "orphan" 记录被中断
  refs,       \* refs/omp/turns/<sid>/<turn>/{before,after}："none" "before" "both"
  entry,      \* 会话文件里的 turn-checkpoint 条目是否存在；扩展 appendEntry(CHECKPOINT_TYPE)
  undoneRef,  \* refs/omp/undone/<sid>/<turn> 是否存在；turns.rs:562 写入
  fileV,      \* 被追踪文件当前内容："base" 初始 "t1" "t2" "t3" 各轮写入 "user" 用户之后又改
  snap,       \* 每轮开始前文件内容（before 快照）；扩展 snapshot
  aft,        \* 每轮结束时文件内容（after 快照）
  everUndone, \* 模型观测：该轮曾被撤回
  silentOverwrite, crossedExpired  \* 模型观测旗标，只由动作写入

vars == <<cur, phase, refs, entry, undoneRef, fileV, snap, aft, everUndone,
          silentOverwrite, crossedExpired>>

Content == {"base", "t1", "t2", "t3", "user"}
Recorded(t) == entry[t]
\* turns.rs:309 restorable = before 与 after 两个 ref 都存在
Restorable(t) == refs[t] = "both"
\* 级联：目标轮次及其后每个未撤回、有条目的轮次（turns.rs:439）
Cascade(k) == {t \in Turns : t >= k /\ entry[t] /\ ~undoneRef[t]}
Newest(S) == CHOOSE t \in S : \A u \in S : u <= t

Init ==
  /\ cur = 0
  /\ phase = [t \in Turns |-> "idle"]
  /\ refs = [t \in Turns |-> "none"]
  /\ entry = [t \in Turns |-> FALSE]
  /\ undoneRef = [t \in Turns |-> FALSE]
  /\ fileV = "base"
  /\ snap = [t \in Turns |-> "base"]
  /\ aft = [t \in Turns |-> "base"]
  /\ everUndone = [t \in Turns |-> FALSE]
  /\ silentOverwrite = FALSE /\ crossedExpired = FALSE

\* 代理开始一轮：给工作区拍 before 快照。
StartTurn(t) ==
  /\ cur = 0                                     \* omp-workspace-checkpoints.ts:475 上一轮若未结束先清掉残留 before
  /\ phase[t] = "idle"                           \* omp-workspace-checkpoints.ts:481 每次 agent_start 生成新 turnId
  /\ (IF t = 1 THEN TRUE ELSE phase[t - 1] # "idle")  \* omp-workspace-checkpoints.ts:481 有限抽象按时间顺序分配轮次
  /\ (IF t = 1 THEN TRUE ELSE phase[t - 1] # "running")  \* omp-workspace-checkpoints.ts:475 前一轮当前快照已处理后开始下一轮
  /\ cur' = t                                    \* omp-workspace-checkpoints.ts:495 current = {sid, turnId, ...}
  /\ phase' = [phase EXCEPT ![t] = "running"]    \* omp-workspace-checkpoints.ts:493 before 引用写入后轮次开始
  /\ refs' = [refs EXCEPT ![t] = "before"]       \* omp-workspace-checkpoints.ts:493 updateRef(.../before)
  /\ snap' = [snap EXCEPT ![t] = fileV]          \* omp-workspace-checkpoints.ts:483 snapshot(before)
  /\ UNCHANGED <<entry, undoneRef, fileV, aft, everUndone, silentOverwrite, crossedExpired>>

\* 代理在这一轮里改了文件。
AgentEdit ==
  /\ cur # 0                                     \* omp-workspace-checkpoints.ts:500 只有 current 存在的轮次才会在 agent_end 记录
  /\ fileV' = CASE cur = 1 -> "t1" [] cur = 2 -> "t2" [] OTHER -> "t3"  \* 抽象：代理写入本轮内容
  /\ UNCHANGED <<cur, phase, refs, entry, undoneRef, snap, aft, everUndone, silentOverwrite, crossedExpired>>

\* 用户在轮次之外改同一个文件。
UserEdit ==
  /\ fileV # "user"                              \* 抽象：只有内容不同才算一次改动
  /\ fileV' = "user"                             \* 用户在编辑器或终端里改动
  /\ UNCHANGED <<cur, phase, refs, entry, undoneRef, snap, aft, everUndone, silentOverwrite, crossedExpired>>

\* 一轮结束且没有任何文件改动：删掉两个快照，不留条目。
EndTurnEmpty ==
  /\ cur # 0                                     \* omp-workspace-checkpoints.ts:502 turn 为空则直接返回
  /\ fileV = snap[cur]                           \* omp-workspace-checkpoints.ts:516 files 与 commits 都为空
  /\ phase' = [phase EXCEPT ![cur] = "empty"]    \* omp-workspace-checkpoints.ts:516 本轮不再保留
  /\ refs' = [refs EXCEPT ![cur] = "none"]       \* omp-workspace-checkpoints.ts:517 删掉 before 与 after
  /\ cur' = 0                                    \* omp-workspace-checkpoints.ts:501 current = null
  /\ UNCHANGED <<entry, undoneRef, fileV, snap, aft, everUndone, silentOverwrite, crossedExpired>>

\* 一轮结束且有文件改动：写 after、追加条目，并只保留最新几轮的存档。
EndTurnRecorded ==
  /\ cur # 0                                     \* omp-workspace-checkpoints.ts:502 turn 为空则直接返回
  /\ fileV # snap[cur]                           \* omp-workspace-checkpoints.ts:516 有文件改动才继续
  /\ phase' = [phase EXCEPT ![cur] = "recorded"] \* omp-workspace-checkpoints.ts:522 追加 turn-checkpoint 条目
  /\ entry' = [entry EXCEPT ![cur] = TRUE]       \* omp-workspace-checkpoints.ts:522 appendEntry(CHECKPOINT_TYPE)
  /\ aft' = [aft EXCEPT ![cur] = fileV]          \* omp-workspace-checkpoints.ts:510 snapshot(after)
  /\ LET r0 == [refs EXCEPT ![cur] = "both"]     \* omp-workspace-checkpoints.ts:512 updateRef(.../after)
         kept == {u \in Turns : r0[u] # "none"}
         newest == {u \in kept : Cardinality({w \in kept : w > u}) < Keep}  \* omp-workspace-checkpoints.ts:321 只保留最新 KEEP_TURNS 轮
     IN /\ refs' = [u \in Turns |-> IF u \in newest THEN r0[u] ELSE "none"]  \* omp-workspace-checkpoints.ts:322 其余 before/after 被删
        /\ undoneRef' = [u \in Turns |-> IF u \in newest \/ u \notin kept THEN undoneRef[u] ELSE FALSE]  \* omp-workspace-checkpoints.ts:323 被清理轮次的撤回标记一并删除
  /\ cur' = 0                                    \* omp-workspace-checkpoints.ts:501 current = null
  /\ UNCHANGED <<fileV, snap, everUndone, silentOverwrite, crossedExpired>>

\* 用户切换或新建会话（session_start / session_switch）时，进行中的轮次被丢弃。
SessionSwitchMidTurn ==
  /\ cur # 0                                     \* omp-workspace-checkpoints.ts:423 session_start 把 current 直接置空
  /\ cur' = 0                                    \* omp-workspace-checkpoints.ts:427 session_switch 把 current 直接置空
  /\ phase' = [phase EXCEPT ![cur] = "orphan"]   \* omp-workspace-checkpoints.ts:423 没有删除 before 引用
  /\ UNCHANGED <<refs, entry, undoneRef, fileV, snap, aft, everUndone, silentOverwrite, crossedExpired>>

\* 点「撤回这一轮」：界面先检查，再由后端预检、冲突检查，必要时用户确认后强制。
Undo(k, force) ==
  /\ cur = 0                                     \* turnChips.ts:13 sessionWorking 为真时按钮不可用
  /\ entry[k]                                    \* turns.rs:432 找不到这一轮则报错
  /\ Restorable(k)                               \* turnChips.ts:14 存档失效则按钮不可用
  /\ ~undoneRef[k]                               \* turns.rs:435 已撤回过则报错
  /\ LET cas == Cascade(k)
         newest == Newest(cas)
         conflict == fileV # aft[newest]         \* turns.rs:468 工作区内容与最新级联轮的 after 不同即冲突
     IN /\ \A t \in cas : Restorable(t)          \* turns.rs:444 级联里有存档失效的轮次则整体拒绝
        /\ (~conflict \/ force)                  \* turns.rs:476 有冲突且未 force 时只返回冲突，不写任何东西
        /\ fileV' = snap[k]                      \* turns.rs:548 git restore --source=before 恢复到所选轮次开始前
        /\ undoneRef' = [t \in Turns |-> undoneRef[t] \/ t \in cas]  \* turns.rs:562 每轮最后写 undone ref
        /\ everUndone' = [t \in Turns |-> everUndone[t] \/ t \in cas]
        /\ silentOverwrite' = (silentOverwrite \/ (fileV = "user" /\ ~conflict))  \* turns.rs:468 用户改动若未被冲突检查发现
        /\ crossedExpired' = (crossedExpired \/ \E t \in cas : ~Restorable(t))   \* turns.rs:444 预检应已拒绝
  /\ UNCHANGED <<cur, phase, refs, entry, snap, aft>>

Next ==
  \/ \E t \in Turns : StartTurn(t)
  \/ AgentEdit \/ UserEdit \/ EndTurnEmpty \/ EndTurnRecorded \/ SessionSwitchMidTurn
  \/ \E k \in Turns, f \in BOOLEAN : Undo(k, f)

Spec == Init /\ [][Next]_vars

\* 没有正在记录的轮次时，不会留下只有开始快照、没有条目的残留存档。
NoLeftoverSnapshots == \A t \in Turns : ~(refs[t] = "before" /\ cur # t)
\* 已经撤回过的轮次，在存档清理之后仍然显示为已撤回。
UndoneStaysUndone == \A t \in Turns : ~(everUndone[t] /\ entry[t] /\ ~undoneRef[t])
\* 撤回不会悄悄覆盖用户之后做的改动。
NoSilentOverwrite == ~silentOverwrite
\* 撤回不会越过存档已失效的轮次。
NoCrossingExpired == ~crossedExpired
====
