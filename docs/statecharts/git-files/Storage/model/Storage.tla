---- MODULE Storage ----
\* 存储页「批量清理旧会话」：先检查再删除，期间会话可能被启动或被终端占用。
\* 源码：src-tauri/src/storage/mod.rs、storage/sessions.rs、catalog/mod.rs
EXTENDS Naturals

VARIABLES
  sess,      \* 会话状态："idle" 空闲 "liveIdle" 应用里已启动但空闲 "working" 正在回合 "terminalHeld" 被终端里的 omp 占用 "trashed" 已移入废纸篓
  pinned,    \* 是否置顶：catalog 元数据 pinned
  checked,   \* 本次清理的检查是否已通过：storage_trash_sessions 里的 skip_reason 为空
  checkedPinned,  \* 检查通过时会话是否置顶（模型观测，不改变行为）
  stoppedLive, trashedHeld, trashedPinned, trashedWorking  \* 模型观测旗标，只由动作写入

vars == <<sess, pinned, checked, checkedPinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

Init ==
  /\ sess = "idle" /\ pinned = FALSE /\ checked = FALSE /\ checkedPinned = FALSE
  /\ stoppedLive = FALSE /\ trashedHeld = FALSE /\ trashedPinned = FALSE /\ trashedWorking = FALSE

\* 应用里启动该会话、回合开始、回合结束、停止。
StartLive ==
  /\ sess = "idle"                               \* catalog/mod.rs:651 rpc::get_handle 才有句柄；会话原先没有进程
  /\ sess' = "liveIdle"                          \* catalog/mod.rs:652 handle.alive 为真
  /\ UNCHANGED <<pinned, checked, checkedPinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

BeginTurn ==
  /\ sess = "liveIdle"                           \* catalog/mod.rs:652 回合只在 alive 的会话里发生
  /\ sess' = "working"                           \* catalog/mod.rs:657 phase == Working
  /\ UNCHANGED <<pinned, checked, checkedPinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

EndTurn ==
  /\ sess = "working"                            \* catalog/mod.rs:657 只有 Working 阶段才会离开 Working
  /\ sess' = "liveIdle"                          \* catalog/mod.rs:657 phase 离开 Working
  /\ UNCHANGED <<pinned, checked, checkedPinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

StopLive ==
  /\ sess = "liveIdle"                           \* catalog/mod.rs:666 rpc::stop 作用于 alive 的会话
  /\ sess' = "idle"                              \* catalog/mod.rs:667 was_live = true，之后句柄不再存活
  /\ UNCHANGED <<pinned, checked, checkedPinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

\* 终端里的 omp 占用 / 释放该会话文件。
TerminalAttach ==
  /\ sess = "idle"                               \* catalog/mod.rs:497 external_pid 只在非 live 会话上计算
  /\ sess' = "terminalHeld"                      \* catalog/mod.rs:497 external_pid 为 Some
  /\ UNCHANGED <<pinned, checked, checkedPinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

TerminalRelease ==
  /\ sess = "terminalHeld"                       \* catalog/mod.rs:517 external_pid 为 Some 才会变回 None
  /\ sess' = "idle"                              \* catalog/mod.rs:497 external_pid 回到 None
  /\ UNCHANGED <<pinned, checked, checkedPinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

TogglePin ==
  /\ sess # "trashed"                            \* storage/mod.rs:436 已删除的会话取不到元数据
  /\ pinned' = ~pinned                           \* 元数据 pinned 翻转
  /\ UNCHANGED <<sess, checked, checkedPinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

\* 存储页点「清理」：先取元数据，按 skip_reason 检查。
TrashCheck ==
  /\ sess # "trashed"                            \* storage/mod.rs:436 找不到会话则跳过
  /\ ~checked                                    \* 抽象：每次清理只检查一次
  /\ sess \notin {"liveIdle", "working"}         \* sessions.rs:93 meta.live 为真则跳过
  /\ sess # "terminalHeld"                       \* sessions.rs:95 external_pid 为 Some 则跳过
  /\ ~pinned                                     \* sessions.rs:97 置顶则跳过
  /\ checked' = TRUE                             \* storage/mod.rs:450 通过后才算可删除
  /\ checkedPinned' = pinned                     \* 模型观测
  /\ UNCHANGED <<sess, pinned, stoppedLive, trashedHeld, trashedPinned, trashedWorking>>

\* 检查通过后真正删除：delete_with 只再检查进程句柄是否在回合中，不再检查终端占用与置顶。
TrashApply ==
  /\ checked                                     \* storage/mod.rs:451 检查通过后才调用 delete_with
  /\ sess # "trashed"                            \* catalog/mod.rs:699 文件已不存在则报会话不存在
  /\ sess # "working"                            \* catalog/mod.rs:658 回合进行中则拒绝并返回错误
  /\ sess' = "trashed"                           \* catalog/mod.rs:704 sessions::remove_files 移入废纸篓
  /\ stoppedLive' = (stoppedLive \/ sess = "liveIdle")   \* catalog/mod.rs:666 已启动的空闲会话会被先停掉
  /\ trashedHeld' = (trashedHeld \/ sess = "terminalHeld")  \* catalog/mod.rs:672 只关应用终端，不查外部 omp 占用
  /\ trashedPinned' = (trashedPinned \/ pinned)  \* catalog/mod.rs:638 delete_with 不看置顶
  /\ trashedWorking' = (trashedWorking \/ sess = "working")   \* catalog/mod.rs:658 守卫已拒绝，此项应恒为假
  /\ checked' = FALSE                            \* 本次清理结束
  /\ UNCHANGED <<pinned, checkedPinned>>

Next ==
  \/ StartLive \/ BeginTurn \/ EndTurn \/ StopLive
  \/ TerminalAttach \/ TerminalRelease \/ TogglePin
  \/ TrashCheck \/ TrashApply

Spec == Init /\ [][Next]_vars

\* 正在进行回合的会话不会被批量清理。
NoTrashWorking == ~trashedWorking
\* 清理不会删掉检查之后才被启动的会话。
NoTrashStartedAfterCheck == ~stoppedLive
\* 清理不会删掉被终端里的 omp 占用的会话。
NoTrashTerminalHeld == ~trashedHeld
\* 清理不会删掉检查之后才被置顶的会话。
NoTrashPinned == ~trashedPinned
====
