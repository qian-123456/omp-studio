------------------------------ MODULE IdeaLifecycle ------------------------------
\* 想法（backlog）：捕获、派发给智能体（含重试/丢失）、完成、回收站、恢复与启动时清理。
\* 来源：src-tauri/src/backlog/{store,mod}.rs；src/features/backlog/{DispatchDialog,fillComposer,ideasActions,ideasLogic}.ts*。
EXTENDS Naturals

VARIABLES
  status,       \* backlog.status：inbox / dispatched / done / closed（backlog/store.rs:150）
  trashed,      \* backlog.deleted_at 是否有值（backlog/store.rs:171）
  purged,       \* 行是否已被永久删除（backlog/store.rs:210）
  stale,        \* updated_at 是否已早于 30 天（backlog/store.rs:226-229）
  trashOld,     \* deleted_at 是否已早于 7 天（backlog/store.rs:209）
  userRestored, \* 用户刚从回收站恢复且之后没有再改动（backlog/store.rs:180-189）
  delivered,    \* 提示词是否已真正送达某个会话（DispatchDialog.tsx:92-93 / fillComposer.ts:58-67）
  retry         \* 派发对话框里是否还留着“补写状态”的重试（DispatchDialog.tsx:66）

vars == <<status, trashed, purged, stale, trashOld, userRestored, delivered, retry>>

Init ==
  /\ status = "inbox" /\ trashed = FALSE /\ purged = FALSE /\ stale = FALSE /\ trashOld = FALSE
  /\ userRestored = FALSE /\ delivered = FALSE /\ retry = FALSE

\* 在派发对话框里发送成功并写入“已派发”
DialogSendOk ==
  /\ ~purged /\ ~trashed /\ status = "inbox"     \* ideasLogic.ts:27-38 仅待处理的想法可派发
  /\ ~delivered                                   \* DispatchDialog.tsx:58 已送出的不会再走发送路径
  /\ status' = "dispatched"                       \* DispatchDialog.tsx:107
  /\ delivered' = TRUE
  /\ stale' = FALSE                               \* backlog/store.rs:148 update 刷新 updated_at
  /\ UNCHANGED <<trashed, purged, trashOld, userRestored, retry>>

\* 发送成功但写“已派发”失败：对话框保留重试
DialogSendStatusFail ==
  /\ ~purged /\ ~trashed /\ status = "inbox"     \* ideasLogic.ts:27-38
  /\ ~delivered                                   \* DispatchDialog.tsx:58
  /\ delivered' = TRUE
  /\ retry' = TRUE                                \* ideasLogic.ts:222-230 pendingStatusUpdates 保留
  /\ UNCHANGED <<status, trashed, purged, stale, trashOld, userRestored>>

DialogRetryOk ==
  /\ retry /\ ~purged                             \* DispatchDialog.tsx:288 重试按钮
  /\ status' = "dispatched"                       \* DispatchDialog.tsx:107
  /\ retry' = FALSE
  /\ stale' = FALSE                               \* backlog/store.rs:148
  /\ UNCHANGED <<trashed, purged, trashOld, userRestored, delivered>>

\* 用户在出错时点取消或关闭对话框
DialogClose ==
  /\ retry                                        \* DispatchDialog.tsx:273-275 取消按钮只在 busy 时禁用
  /\ retry' = FALSE                               \* 组件卸载，pendingStatusUpdates 状态随之丢失（DispatchDialog.tsx:66）
  /\ UNCHANGED <<status, trashed, purged, stale, trashOld, userRestored, delivered>>

\* “放进输入框”后真正发送成功，写入“已派发”
FillSendOk ==
  /\ ~purged /\ ~trashed /\ status = "inbox"     \* fillComposer.ts:100-112 待处理想法放进输入框
  /\ ~delivered
  /\ status' = "dispatched"                       \* fillComposer.ts:67-71 markDispatched
  /\ delivered' = TRUE
  /\ stale' = FALSE                               \* backlog/store.rs:148
  /\ UNCHANGED <<trashed, purged, trashOld, userRestored, retry>>

\* 输入框发送成功但“已派发”写入失败：静默不再重试
FillSendUpdateFail ==
  /\ ~purged /\ ~trashed /\ status = "inbox"     \* fillComposer.ts:100-112
  /\ ~delivered
  /\ delivered' = TRUE                            \* fillComposer.ts:67-71 先清除 pending 再写状态
  /\ UNCHANGED <<status, trashed, purged, stale, trashOld, userRestored, retry>>   \* fillComposer.ts:74-79 失败被吞掉

UserSetStatus ==
  /\ ~purged /\ ~trashed                          \* ideasActions.ts:11-20 回收站中的条目不在列表里
  /\ \E s \in {"inbox", "dispatched", "done", "closed"} : s /= status /\ status' = s   \* ideasActions.ts:11 setIdeasStatus
  /\ stale' = FALSE                               \* backlog/store.rs:148
  /\ userRestored' = FALSE
  /\ UNCHANGED <<trashed, purged, trashOld, delivered, retry>>

UserTrash ==
  /\ ~purged /\ ~trashed                          \* backlog/store.rs:171 deleted_at IS NULL
  /\ trashed' = TRUE
  /\ trashOld' = FALSE
  /\ userRestored' = FALSE
  /\ UNCHANGED <<status, purged, stale, delivered, retry>>

UserRestore ==
  /\ ~purged /\ trashed                           \* backlog/store.rs:180-189 restore
  /\ trashed' = FALSE                             \* 只清 deleted_at，不刷新 updated_at（store.rs:183）
  /\ userRestored' = TRUE
  /\ UNCHANGED <<status, purged, stale, trashOld, delivered, retry>>

AgeFinished ==
  /\ ~purged /\ ~stale                            \* 时间流逝，updated_at 超过 30 天；行存在才可能变旧（backlog/store.rs:227-229 以 updated_at < cutoff 判断）
  /\ stale' = TRUE
  /\ UNCHANGED <<status, trashed, purged, trashOld, userRestored, delivered, retry>>

AgeTrash ==
  /\ ~purged /\ trashed /\ ~trashOld              \* 时间流逝，deleted_at 超过 7 天；仅回收站中的行带 deleted_at，行存在（backlog/store.rs:210-212 deleted_at < cutoff）
  /\ trashOld' = TRUE
  /\ UNCHANGED <<status, trashed, purged, stale, userRestored, delivered, retry>>

\* 应用启动：先把 30 天前的已结束想法移入回收站，再永久删除超过 7 天的回收站条目
AppStart ==
  /\ ~purged                                      \* 行仍存在
  /\ IF status \in {"done", "closed"} /\ ~trashed /\ stale     \* backlog/store.rs:227-229 status IN (done, closed) AND deleted_at IS NULL AND updated_at < cutoff
     THEN /\ trashed' = TRUE /\ trashOld' = FALSE /\ purged' = FALSE   \* backlog/store.rs:228 deleted_at = now
     ELSE /\ IF trashed /\ trashOld THEN purged' = TRUE ELSE purged' = purged                 \* backlog/store.rs:210-212 deleted_at < cutoff
          /\ UNCHANGED <<trashed, trashOld>>
  /\ UNCHANGED <<status, stale, userRestored, delivered, retry>>

Next == DialogSendOk \/ DialogSendStatusFail \/ DialogRetryOk \/ DialogClose \/ FillSendOk
        \/ FillSendUpdateFail \/ UserSetStatus \/ UserTrash \/ UserRestore \/ AgeFinished
        \/ AgeTrash \/ AppStart

Spec == Init /\ [][Next]_vars

TypeOK == status \in {"inbox", "dispatched", "done", "closed"}

\* 已经送达智能体的想法，要么被标成已派发，要么界面仍保留可重试的错误提示，不能悄悄停在待处理。
DeliveredIsRecorded == (delivered /\ ~purged) => (status /= "inbox" \/ retry)

\* 用户从回收站恢复的想法，在用户再次操作前，不会被应用启动时的清理又放回回收站。
RestoredStaysRestored == userRestored => ~trashed

=============================================================================
