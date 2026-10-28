# 全项目状态图审计修复结果

本次以只读审计总表、反例与架构契约为输入，逐项处置全部84项规则级发现；审计文档及历史证据保持不变。

## 覆盖与处置

- 64项修复；17项补齐边界守卫并说明适用范围；3项依据架构与上游协议保留正常设计。
- 45项已重放缺陷均有对应行为回归条目；回归索引同时包含新增、强化及为防止边界退化而保留的现有用例。
- 另外修复实现观察、文件链接错误及原有类型/测试报错；不使用全局重构、错误抑制或编译目标放宽。
- 实现及最终验收已完成；检查、实际行为验证与未执行边界详见报告末尾。

## 分模块逐项结果

### 会话运行与占用

#### 1 — 退出事件早于注册表清理/遗留帧时，缓存仍记存活

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：退出事实优先于旧注册表快照；注册、退出清理与状态发布串行，旧进程退出不影响替代进程。
- 边界/理由：原项为竞争假说；新增最终状态守卫，不宣称已复现原生调度窗口。
- 回归索引：
  - `src-tauri/src/catalog/status.rs::tests::process_exit_rejects_late_start_dialog_and_end_until_restart`
  - `src-tauri/src/rpc/mod.rs::pid_guard_tests::process_exited_before_registration_never_publishes_started`
  - `src-tauri/src/rpc/process.rs::tests::old_process_exit_does_not_revoke_replacement_registration`

#### 2 — 退出后迟到的开始帧重新开启转圈

- 处置：修复（原证据：真实入口已重放）。
- 修改：退出后忽略迟到活动帧，只有新的进程启动事件才能解除终止保护。
- 回归索引：
  - `src/stores/live.test.ts::exit rejects late start, UI request and pending snapshots until explicit process restart`
  - `src-tauri/src/rpc/process.rs::tests::dead_handle_drops_activity_but_resolves_final_responses`

#### 3 — 退出后迟到的请求帧留下可回答卡片与等待状态

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：进程退出后拒绝迟到请求、旧待答快照及卡片，避免留下无法回答的等待状态。
- 边界/理由：不依赖上游是否自然产生该顺序，消费者自行拒绝退出后的请求。
- 回归索引：
  - `src-tauri/src/catalog/status.rs::tests::process_exit_rejects_late_start_dialog_and_end_until_restart`
  - `src/stores/live.test.ts::exit rejects late start, UI request and pending snapshots until explicit process restart`
  - `src-tauri/src/rpc/process.rs::tests::dead_handle_drops_activity_but_resolves_final_responses`

#### 4 — 回合终止后待答卡片仍保留

- 处置：修复（原证据：真实入口已重放）。
- 修改：回合真正结束或等待后台工作时，清空前后端待答卡片；传输错误同步清理。
- 回归索引：
  - `src/stores/live.test.ts::settling $type clears dialog cards (terminal and awaitingAsyncWork cases)`
  - `src-tauri/src/rpc/process.rs::tests::settled_dialog_cannot_be_answered_or_sent_twice`
  - `src-tauri/src/catalog/status.rs::tests::response_to_settled_dialog_cannot_restart_work`

#### 5 — 回答已结束回合的遗留卡片会把空闲状态改回处理中

- 处置：修复（原证据：真实入口已重放）。
- 修改：只允许消费当前仍待答的请求，重复或过期回答不写入，也不能凭空恢复处理中状态。
- 回归索引：
  - `src-tauri/src/catalog/status.rs::tests::response_to_settled_dialog_cannot_restart_work`
  - `src-tauri/src/catalog/status.rs::tests::idle_command_dialog_response_does_not_invent_agent_work`
  - `src-tauri/src/rpc/process.rs::tests::settled_dialog_cannot_be_answered_or_sent_twice`

#### 6 — 状态文件的进程号被复用后会话被误判外部占用

- 处置：修复（原证据：真实入口已重放）。
- 修改：状态文件记录进程出生标记；占用和接管重新核验身份，防止复用进程号误判或误杀；每轮按PID复用探测结果。
- 回归索引：
  - `src-tauri/src/catalog/external.rs::tests::reused_pid_and_legacy_status_do_not_claim_ownership`
  - `src-tauri/src/rpc/mod.rs::pid_guard_tests::ps_line_matching`
  - `src/test/ompWorkspaceStatus.test.ts::same-session partial context preserves its own file and birth identity`
  - `src-tauri/src/catalog/external.rs::tests::status_validation_samples_pid_once_per_sweep_and_rechecks_next_sweep`
  - `src/test/ompWorkspaceStatus.test.ts::samples process birth once at module load, not on status writes`

#### 7 — 挂起标记晚于退出重算写入时显示可能停在空闲

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：挂起标记写入主动触发目录状态发布，并在恢复锁释放前完成，避免退出与重新打开交错覆盖。
- 边界/理由：主动发布挂起结果，不再依赖文件监听最终修正。
- 回归索引：
  - `src-tauri/src/rpc/mod.rs::pid_guard_tests::suspension_publishes_after_exit_even_without_watcher`

### 输入、计划与侧聊

#### 8 — 点击停止后，本地 held 文本仍被自动发送

- 处置：修复（原证据：真实入口已重放）。
- 修改：明确停止先持久暂停暂存队列自动发送；迟到确认不解除新停止，内部打断不触发该暂停。
- 回归索引：
  - `src/features/chat/send.test.ts :: does not auto-send held text when the stop frame arrives %s (before response / after response)`
  - `src/features/chat/send.test.ts :: does not let an earlier prompt acknowledgement clear a newer stop`
  - `src/features/chat/send.test.ts :: does not pause held auto-send for an intentional interrupt`
  - `src/features/chat/send.test.ts :: keeps held auto-send paused when an explicit retry fails`
  - `src/features/chat/heldQueueDrain.test.tsx :: keeps stopped held items on remount and resume transitions`
  - `src/features/chat/heldQueueDrain.test.tsx :: restores the paused latch from storage and clears it when a session is pruned`

#### 9 — 批准先退出计划，创建执行会话失败后不能直接在面板重试

- 处置：修复（原证据：真实入口已重放）。
- 修改：执行目标接受命令后才退出原计划；失败复用目标，已接受的执行不因重试重复发送。
- 回归索引：
  - `src/features/chat/plan/planActions.test.ts :: accepts the destination run before exiting the source and selecting the destination`
  - `src/features/chat/plan/planActions.test.ts :: keeps the source review untouched when creation fails and allows an immediate retry`
  - `src/features/chat/plan/planActions.test.ts :: reuses the destination after send failure without leaving the source review`
  - `src/features/chat/plan/planActions.test.ts :: retries source finalization without executing again even if retry changes mode`
  - `src/features/chat/plan/planActions.test.ts :: coalesces simultaneous approvals into one destination and one execution`
  - `src/features/chat/plan/planActions.test.ts :: preserves %s execution in the source session (compact / keep)`
  - `src/features/chat/PlanPanel.approve.test.tsx :: keeps review and retry enabled after destination %s failure (create / send)`
  - `src/features/chat/PlanPanel.approve.test.tsx :: stays on review during destination send and ignores repeated approval clicks`

#### 10 — 侧聊首问发送失败仍保留用户回显

- 处置：修复（原证据：真实入口已重放）。
- 修改：首问被接受后才提交正式用户回显；失败向上传递，并清理临时预览。
- 回归索引：
  - `src/features/sidechat/sideChatActions.test.ts :: failed first asks leave no real pending echo and retry the same child with annotations and images`
  - `src/features/sidechat/SideChatPanel.test.tsx :: restores a failed first ask without an echo and retries its first-question boundary with quotes and images`
  - `src/features/sidechat/SideChatPanel.test.tsx :: shows a pending bubble, then asks before committing the echo and bound tab`

#### 11 — 侧聊首问发送失败后输入文字未回到草稿

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：首问失败恢复原文、批注及附件；保留已创建侧聊用于首问重试，不覆盖失败期间新输入。
- 回归索引：
  - `src/features/sidechat/SideChatPanel.test.tsx :: restores a failed first ask without an echo and retries its first-question boundary with quotes and images`
  - `src/features/sidechat/SideChatPanel.test.tsx :: does not overwrite newer typing when the pending create fails`
  - `src/features/sidechat/SideChatPanel.test.tsx :: does not overwrite newer typing when the pending ask fails`
  - `src/features/sidechat/SideChatPanel.test.tsx :: restores the text and retains staged images when creation fails`
  - `src/features/sidechat/sideChatActions.test.ts :: failed first asks leave no real pending echo and retry the same child with annotations and images`

#### 12 — 侧聊截断副本写失败可能继承父计划模式

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：侧聊副本准备失败直接报错，非空父记录不得回退为未经裁剪的父文件。
- 回归索引：
  - `src-tauri/src/rpc/sidechat.rs :: side_chat_fork_read_failure_is_an_error_not_original_file_fallback`
  - `src-tauri/src/rpc/sidechat.rs :: side_chat_without_parent_transcript_does_not_require_a_copy`
  - `src-tauri/src/rpc/forkcut.rs :: side_chat_copy_write_failure_is_propagated`
  - `src-tauri/src/rpc/forkcut.rs :: side_chat_copy_switches_plan_mode_off_even_when_nothing_is_cut`
  - `src-tauri/src/rpc/forkcut.rs :: pinned_fork_and_side_chat_do_not_import_tail_plan_state`

#### 13 — 完整轮次分支丢弃尾部计划开关，恢复成旧计划状态

- 处置：修复（原证据：真实入口已重放）。
- 修改：完整轮次分支保留尾部计划状态，但排除未完成消息；指定回复分支仍精确截断。
- 回归索引：
  - `src-tauri/src/rpc/forkcut.rs :: full_fork_keeps_plan_disable_after_last_complete_answer`
  - `src-tauri/src/rpc/forkcut.rs :: full_fork_keeps_tail_plan_snapshots_but_not_unfinished_messages`
  - `src-tauri/src/rpc/forkcut.rs :: full_fork_without_complete_turn_keeps_only_header_and_tail_plan_state`
  - `src-tauri/src/rpc/forkcut.rs :: pinned_fork_and_side_chat_do_not_import_tail_plan_state`

#### 14 — 停止消息是否标记 aborted 是提醒重启的上游边界

- 处置：保留正常设计（原证据：需要确认产品规则）。
- 修改：保留上游以aborted表示用户中止的边界，普通结束或工具调用不误判为取消。
- 边界/理由：上游用户取消使用aborted；普通stop/toolUse并非取消证据，过度拦截会破坏正常计划提醒。
- 回归索引：
  - `src/features/chat/plan/planReminder.test.ts :: does not queue a reminder after the latest assistant is aborted, but still publishes status`
  - `src/features/chat/plan/planReminder.test.ts :: queues one hidden continuation for a normal %s end without a plan (stop / toolUse)`
  - `src/features/chat/plan/planReminder.test.ts :: uses latest %s over an earlier aborted assistant (stop / toolUse)`
  - `src/features/chat/plan/planReminder.test.ts :: uses latest aborted over an earlier %s assistant (stop / toolUse)`
  - `src/features/chat/plan/planReminder.test.ts :: does not spend the reminder budget on abort and resets it only on input`
  - `src/features/chat/plan/planReminder.test.ts :: publishes a discovered plan for review without queuing a reminder`

#### 15 — 计划角色读取失败时未发送标签回退显示普通模型

- 处置：加固守卫（原证据：需要确认产品规则）。
- 修改：计划角色读取失败显示明确未知、错误和重试入口，不冒充普通模型，也不改写普通选择。
- 边界/理由：读取失败无法得知已保存模型；以明确未知和重试替代猜测回退。
- 回归索引：
  - `src/features/chat/Composer.planModel.test.tsx :: shows a recoverable role read failure instead of claiming the ordinary model is the plan model`
  - `src/features/chat/Composer.planModel.test.tsx :: ignores a failed role read after the pending plan chip is removed`
  - `src/features/chat/Composer.planModel.test.tsx :: shows the project plan model and thinking on a local draft with /plan selected, without sending`
  - `src/features/chat/Composer.planModel.test.tsx :: restores the ordinary draft model and thinking when the /plan chip is removed`

### 文件缓冲区、Git与清理

#### 16 — 未保存的修改在关闭标签时不会丢失。

- 处置：修复（原证据：真实入口已重放）。
- 修改：脏缓冲区按文件路径保留；关闭后重开恢复未保存文字，并移除误导性的“丢弃并退出”确认。
- 回归索引：
  - `src/features/files/FilePreviewPanel.buffer.test.tsx :: keeps the real dirty buffer after closeFile and reopening (finding 16)`
  - `src/features/files/FilePreviewPanel.buffer.test.tsx :: retains document edits after the center close action and reopening`
  - `src/features/editor/useFileBuffer.test.tsx :: retains dirty state across unmount and verifies disk on reopening`
  - `src/features/editor/useFileBuffer.test.tsx :: reloads a closed clean file rather than retaining stale cached text`

#### 17 — 未保存的修改在点重新载入时不会在没确认的情况下丢失。

- 处置：修复（原证据：真实入口已重放）。
- 修改：重载入口共用确认；取消不丢弃，确认期间或读取期间的新输入不能被旧授权覆盖。
- 回归索引：
  - `src/features/files/FilePreviewPanel.buffer.test.tsx :: confirms the toolbar and external-banner reload before discarding (finding 17)`
  - `src/features/files/FilePreviewPanel.buffer.test.tsx :: uses exactly one shared confirmation for document reload`
  - `src/features/editor/useFileBuffer.test.tsx :: requires reload confirmation and cancellation preserves the draft`
  - `src/features/editor/useFileBuffer.test.tsx :: reloads after explicit confirmation without clearing the draft on read failure`
  - `src/features/editor/useFileBuffer.test.tsx :: does not apply confirmation to edits typed after the dialog opened`
  - `src/features/editor/useFileBuffer.test.tsx :: preserves typing while an approved reload is reading`

#### 18 — 未保存的修改在切换标签时不会丢失。

- 处置：修复（原证据：真实入口已重放）。
- 修改：切换标签重用原缓冲区，同一路径的中间编辑器与右侧预览共享内容。
- 回归索引：
  - `src/features/files/FilePreviewPanel.buffer.test.tsx :: keeps drafts when switching tabs through the actual store (finding 18)`
  - `src/features/files/FilePreviewPanel.buffer.test.tsx :: keeps the same file synchronized between the document and right preview`
  - `src/features/editor/useFileBuffer.test.tsx :: shares the same path between the center and preview consumers`
  - `src/features/editor/useFileBuffer.test.tsx :: isolates a delayed read after the consumer changes paths`

#### 19 — 保存不会悄悄覆盖用户从没看到过的磁盘改动。

- 处置：加固守卫（原证据：真实入口已重放）。
- 修改：保存携带已读基线内容；后端同路径串行比较和替换，冲突保留草稿且不把关闭提醒视为覆盖授权。
- 边界/理由：应用内写入可串行并拒绝旧基线；独立外部写入者不参与锁，文件系统不存在跨进程比较并替换的绝对保证。
- 回归索引：
  - `src/features/editor/useFileBuffer.test.tsx :: rejects unseen disk changes without dropping the draft (finding 19)`
  - `src/features/files/FilePreviewPanel.buffer.test.tsx :: renders save conflicts and never treats keep-my-changes as overwrite permission`
  - `src/features/editor/useFileBuffer.test.tsx :: saves one snapshot while preserving concurrent typing and prevents duplicate saves`
  - `TerminalRepair owns backend real-file conflict/concurrency tests and their handoff`

#### 20 — 窗口聚焦后的后台刷新不会冲掉用户刚输入的文字。

- 处置：修复（原证据：真实入口已重放）。
- 修改：焦点刷新在返回时检查最新编辑状态；保存使早先刷新失效，脏文本保留并提示冲突。
- 回归索引：
  - `src/features/editor/useFileBuffer.test.tsx :: keeps input typed after a clean focus refresh started (finding 20)`
  - `src/features/editor/useFileBuffer.test.tsx :: refreshes clean buffers silently`
  - `src/features/editor/useFileBuffer.test.tsx :: ignores a stale focus response after saving`
  - `src/features/editor/useFileBuffer.test.tsx :: saves one snapshot while preserving concurrent typing and prevents duplicate saves`

#### 21 — 正在运行的时光机不会被「回收孤儿」删掉目录。

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：孤儿扫描及删除重新检查正在运行的时光机，启动、停止与清理共用互斥边界。
- 边界/理由：停止按钮仍可明确停止并移除自己的时光机；普通孤儿回收不能删除运行目录。
- 回归索引：
  - `src-tauri/src/git/tests.rs::running_time_machine_worktree_cannot_be_reclaimed_even_with_force`
  - `src-tauri/src/catalog/mod.rs::refresh_tests::cleanup_gate_blocks_start_and_pin_until_disposal_finishes`

#### 22 — 有会话在用的工作树不会被「回收孤儿」删掉。

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：孤儿回收携带专用标记并重新核验当前会话关联；明确的普通清理仍保留原有确认语义。
- 边界/理由：孤儿扫描仅为预览；明确确认的普通闲置工作树清理不被误禁用。
- 回归索引：
  - `src-tauri/src/git/tests.rs::orphan_cleanup_revalidates_session_ownership_after_scan`
  - `src-tauri/src/git/tests.rs::guarded_remove_rejects_alias_owner_but_not_path_prefix_neighbor`
  - `src/features/git/removeWorktree.flow.test.tsx::keeps explicitly confirmed idle-session cleanup distinct from orphan reclamation`
  - `src/features/git/removeWorktree.flow.test.tsx::requests mutation-time orphan ownership revalidation even when force is confirmed`
  - `src/features/git/OrphanBadge.lifecycle.test.tsx::reconciles a deleted directory after single branch cleanup fails`

#### 23 — 清理失败后，界面不会再显示一个磁盘上已经不存在的工作树。

- 处置：修复（原证据：真实入口已重放）。
- 修改：部分删除失败仍刷新真实磁盘和共享列表；旧仓库响应不能覆盖新仓库，未验证卡片不残留。
- 回归索引：
  - `src-tauri/src/git/tests.rs::branch_cleanup_failure_leaves_disk_listing_reconciliable`
  - `src/features/git/OrphanBadge.lifecycle.test.tsx::reconciles a deleted directory after single branch cleanup fails`
  - `src/features/git/OrphanBadge.lifecycle.test.tsx::reconciles a deleted directory after batch branch cleanup fails`
  - `src/features/git/OrphanBadge.lifecycle.test.tsx::retains a still-present worktree when removal is refused`
  - `src/features/git/OrphanBadge.lifecycle.test.tsx::does not retain an unverified stale card when reconciliation fails`
  - `src/features/git/OrphanBadge.lifecycle.test.tsx::ignores an old repository reconciliation after the hook switches repositories`
  - `src/features/git/removeWorktree.flow.test.tsx::does not report partial branch-deletion failure as a successful removal`

#### 24 — 没有正在记录的轮次时，不会留下只有开始快照、没有条目的残留存档。

- 处置：修复（原证据：真实入口已重放）。
- 修改：检查点记住所属仓库；切会话、退出、快照或追加失败均清除本轮临时引用，子代理不打断父轮次。
- 回归索引：
  - `src/test/ompWorkspaceCheckpoints.test.ts::persists a changed turn and keeps both snapshots after lifecycle reset`
  - `src/test/ompWorkspaceCheckpoints.test.ts::cleans the originating ref pair on %s`
  - `src/test/ompWorkspaceCheckpoints.test.ts::abandons the old cwd before %s uses another repository`
  - `src/test/ompWorkspaceCheckpoints.test.ts::cleans an abandoned turn even when the replacement cwd is not a repository`
  - `src/test/ompWorkspaceCheckpoints.test.ts::does not consume a top-level turn for subagent lifecycle events`
  - `src/test/ompWorkspaceCheckpoints.test.ts::cleans the turn if the ending session differs`
  - `src/test/ompWorkspaceCheckpoints.test.ts::cleans both refs after %s failure`
  - `src/test/ompWorkspaceCheckpoints.test.ts::abandons the previous turn when replacement %s fails`
  - `src/test/ompWorkspaceCheckpoints.test.ts::removes both refs when checkpoint append fails: %s`
  - `src/test/ompWorkspaceCheckpoints.test.ts::removes both snapshots for an unchanged turn`

#### 25 — 撤回不会悄悄覆盖用户之后做的改动。

- 处置：加固守卫（原证据：需要确认产品规则）。
- 修改：撤回前明确告知整轮快照包含轮内用户编辑；保留轮后内容冲突检查，并新增暂存区改动保护。
- 边界/理由：快照无法区分轮内改动来源，必须明确同意整轮范围；轮后内容及暂存区另有冲突保护。
- 回归索引：
  - `src/features/chat/AnswerFooter.undo.test.tsx::discloses own edits recorded during 1 turns and preserves everything on cancel`
  - `src/features/chat/AnswerFooter.undo.test.tsx::discloses own edits recorded during 2 turns and preserves everything on cancel`
  - `src/features/chat/AnswerFooter.undo.test.tsx::never forces past post-turn user edits without a separate confirmation`
  - `src/features/chat/AnswerFooter.undo.test.tsx::sends a force override only after the user accepts the conflict warning`
  - `src-tauri/src/git/turns.rs::tests::undo_protects_later_worktree_and_unrelated_staged_edits_before_head_reset`
  - `Existing guard regression retained: src-tauri/src/git/turns.rs::tests::undo_conflict_blocks_then_force_proceeds`

#### 26 — 已经撤回过的轮次，在存档清理之后仍然显示为已撤回。

- 处置：修复（原证据：真实入口已重放）。
- 修改：清理可恢复快照不再清除已撤回标记，历史状态与待通知记录持续保留。
- 回归索引：
  - `src/test/ompWorkspaceCheckpoints.test.ts::prunes expired snapshot pairs but preserves undone history and pending notices`

#### 27 — 同步或变基报错时，当前分支的提交历史保持同步前的样子。

- 处置：加固守卫（原证据：需要确认产品规则）。
- 修改：同步失败在安全条件下恢复原分支；并发新提交、脏内容或切分支时保留用户工作并提供恢复位置。
- 边界/理由：普通失败安全恢复；外部并发Git操作不属于跨进程事务，优先保留用户工作并明确恢复边界。
- 回归索引：
  - `src-tauri/src/git/base_sync.rs::atomic_tests::dirty_base_checkout_is_rejected_before_feature_merge`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::second_phase_ref_rejection_rolls_back_feature_merge`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::second_phase_checked_out_ref_rejection_rolls_back_feature_merge`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::rollback_preserves_a_newer_user_commit`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::rollback_preserves_user_worktree_edits`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::sync_conflict_aborts_only_its_own_merge`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::rebase_conflict_aborts_only_its_own_rebase`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::pre_existing_clean_rebase_is_not_aborted`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::pre_existing_clean_merge_is_not_aborted`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::successful_sync_preserves_public_result_counts`
  - `src-tauri/src/git/base_sync.rs::atomic_tests::refused_rollback_ref_update_does_not_touch_index_or_files`

#### 28 — 清理不会删掉检查之后才被置顶的会话。

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：清理与置顶修改共用互斥边界，删除前直接重查数据库置顶值，而非信任旧预览。
- 边界/理由：自动回收与用户明确永久删除语义区分；自动回收使用最新置顶事实。
- 回归索引：
  - `src-tauri/src/storage/sessions.rs::tests::cleanup_revalidates_pin_live_and_terminal_changes_after_preview (pin case)`
  - `src-tauri/src/storage/sessions.rs::tests::cleanup_removes_still_unused_session_and_all_companions`
  - `src-tauri/src/catalog/mod.rs::refresh_tests::cleanup_gate_blocks_start_and_pin_until_disposal_finishes`

#### 29 — 清理不会删掉检查之后才被启动的会话。

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：清理先锁住最终检查与删除区间，遇到刚启动的空闲进程也拒绝清理，绝不为清理而停止它。
- 边界/理由：守卫覆盖应用内启动与删除交错，不以停止空闲进程来强行满足清理。
- 回归索引：
  - `src-tauri/src/storage/sessions.rs::tests::cleanup_revalidates_pin_live_and_terminal_changes_after_preview (live case)`
  - `src-tauri/src/catalog/mod.rs::refresh_tests::cleanup_gate_blocks_start_and_pin_until_disposal_finishes`
  - `Coordinated RuntimeRepair regression: deleting_session_retains_resume_lock_with_waiters`

#### 30 — 清理不会删掉被终端里的 omp 占用的会话。

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：清理前重新探测应用终端及外部占用；探测失败拒绝删除，不使用五秒前的目录快照。
- 边界/理由：外部命令行进程属于独立操作系统参与者；使用新鲜探测且失败关闭，不宣称跨进程删除事务。
- 回归索引：
  - `src-tauri/src/storage/sessions.rs::tests::cleanup_revalidates_pin_live_and_terminal_changes_after_preview (terminal case)`
  - `src-tauri/src/storage/sessions.rs::tests::cleanup_removes_still_unused_session_and_all_companions`
  - `src-tauri/src/catalog/mod.rs::refresh_tests::cleanup_external_probe_refuses_failure_or_partial_observation`
  - `src-tauri/src/catalog/mod.rs::refresh_tests::cleanup_external_probe_accepts_confirmed_empty_or_current_holder`

### 移动端连接、审批与基础设施

#### 31 — 网络恢复后横幅仍显示断开

- 处置：修复（原证据：真实入口已重放）。
- 修改：网络恢复且原事件连接仍打开时恢复横幅；已退役连接的迟到事件被忽略。
- 回归索引：
  - `src-mobile/core/sse.test.ts :: restores the banner when the still-open stream survives offline`
  - `src-mobile/core/sse.test.ts :: ignores frames from a retired stream after reconnect`

#### 32 — 离线事件覆盖未授权状态

- 处置：修复（原证据：真实入口已重放）。
- 修改：未授权状态不能被离线、迟到握手或成功探测覆盖，仅本次配对确认成功可重置。
- 回归索引：
  - `src-mobile/core/sse.test.ts :: keeps unauthorized terminal through offline, late hello and successful probes`
  - `src-mobile/core/sse.test.ts :: does not connect when a successful in-flight probe returns after revocation`
  - `src-mobile/core/sse.test.ts :: never retries after a 401 probe`

#### 33 — 超时恢复输入不代表服务器未接收

- 处置：修复（原证据：真实入口已重放）。
- 修改：派发前持久保存原文及附件；超时或HTTP错误显示“送达状态未知”，不谎称未发送。
- 回归索引：
  - `src-mobile/features/chat/deliverySafety.test.tsx :: accepted prompt with lost response is unknown, survives reload and never blindly resends`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: persists before dispatch and retains the original draft when storage fails`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: does not call an HTTP rejection proof of non-delivery`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: does not downgrade an acknowledged prompt when local record cleanup fails`
  - `src-mobile/features/chat/chat.test.tsx :: marks failed delivery unknown without restoring an apparently unsent draft`
  - `src-mobile/features/chat/chat.test.tsx :: shows an explicit unknown-delivery notice with original text, files and recovery actions`

#### 34 — 超时后再次发送同一原文形成两个请求

- 处置：加固守卫（原证据：真实入口已重放）。
- 修改：发送中或送达未知时阻止普通及自动重发；风险确认后仅恢复输入，跨刷新保留原内容与保护。
- 边界/理由：没有新增服务端恰好一次投递保证；用户明确知悉重复风险后仍可选择重试，自动路径绝不盲目重发。
- 回归索引：
  - `src-mobile/features/chat/deliverySafety.test.tsx :: accepted prompt with lost response is unknown, survives reload and never blindly resends`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: cancel keeps the guard; explicit risk-confirmed recovery restores text and attachments without sending`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: a reload during an in-flight request is ambiguous too, while success clears only its session`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: leaving the page while confirmation is open cannot clear the saved uncertainty`

#### 35 — 全部允许请求不携带屏幕上的审批编号

- 处置：修复（原证据：真实入口已重放）。
- 修改：批量审批携带当时显示的请求编号；后端只处理交集并返回真正处理的编号，不回答新到请求。
- 回归索引：
  - `src-mobile/features/chat/deliverySafety.test.tsx :: batch carries only IDs from the rendered cards and tombstones acknowledged IDs`
  - `src-mobile/features/chat/chat.test.tsx :: shows 「全部允许」 only from two approvals and calls ui-respond-all`
  - `src-tauri/src/mobile/tests.rs :: batch_approve_answers_only_tool_approvals`
  - `src-tauri/src/mobile/tests.rs :: batch_approval_requires_seen_ids_and_never_answers_new_arrivals`

#### 36 — 较旧快照晚到使已回答卡片复活

- 处置：修复（原证据：真实入口已重放）。
- 修改：待答快照受请求代次约束；已回答的具体到达实例被过滤，同时允许同编号的新请求。
- 回归索引：
  - `src-mobile/features/chat/deliverySafety.test.tsx :: rejects an older snapshot arriving after a newer one`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: a response acknowledgement tombstones its card across stale snapshots`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: batch carries only IDs from the rendered cards and tombstones acknowledged IDs`
  - `src-mobile/features/chat/deliverySafety.test.tsx :: a new arrival reusing a request ID is not hidden by the old arrival's tombstone`

#### 37 — 配对 GET 可被非手机访问消耗

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：配对GET/HEAD只显示确认页，不消耗配对码；兑换改为有明确结果与跨站校验的POST。
- 回归索引：
  - `src-tauri/src/mobile/tests.rs::pairing_get_and_head_do_not_consume_code`
  - `src-tauri/src/mobile/tests.rs::pairing_post_rejects_cross_site_without_consuming_code`
  - `src-tauri/src/mobile/tests.rs::test_tls_pairing_sets_secure_cookie (adapted to POST)`

#### 38 — 前台查看状态未上报时仍可能推送

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：查看状态使用45秒有效期；手机前台每15秒续报，隐藏或离开清除，不让陈旧状态长期压制推送。
- 回归索引：
  - `src-tauri/src/mobile/tests.rs::foreground_presence_endpoint_tracks_viewing_and_background`
  - `src-tauri/src/mobile/push.rs::tests::stale_foreground_presence_does_not_suppress_notifications`
  - `src-tauri/src/mobile/push.rs::tests::presence_viewing_session_conditions (existing)`
  - `MobileClientRepair handoff: src-mobile/core/presence.test.ts client lifecycle regressions`

#### 39 — 同一会话短时间的后续审批可能被去重

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：审批推送按请求编号和到达时间识别，同会话不同审批不再被当作同一通知丢弃。
- 回归索引：
  - `src-tauri/src/mobile/push.rs::tests::distinct_approval_requests_are_not_rate_limited_together`

#### 40 — 停止服务后在途隧道仍能上线

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：隧道异步准备前登记可取消所有者，停止及监听器关闭使在途启动失效，发布前重新核验。
- 回归索引：
  - `src-tauri/src/mobile/tunnel.rs::tests::stop_cancels_pending_owner_and_rejects_late_publication`
  - `src-tauri/src/mobile/tunnel.rs::tests::stop_invalidates_start_waiting_for_the_start_lock`
  - `src-tauri/src/mobile/tunnel.rs::tests::stopped_origin_cannot_start_a_tunnel`

#### 41 — 并发启动可能遗留未登记隧道进程

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：隧道启动串行并使用唯一所有者；旧启动不能覆盖或清理新进程的登记。
- 回归索引：
  - `src-tauri/src/mobile/tunnel.rs::tests::concurrent_starts_return_the_same_owned_tunnel`
  - `src-tauri/src/mobile/tunnel.rs::tests::stale_owner_cannot_replace_or_clear_new_tunnel`

#### 42 — 运行时修改 DDNS 域名后证书可能不匹配

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：只有当前证书覆盖且已同步的域名才用于链接；改域名后保留已有IPv6指纹入口，重启监听器后启用新域名。
- 边界/理由：不自动更换证书指纹或重启监听器；新域名需监听器重启后才可被宣传。
- 回归索引：
  - `src-tauri/src/mobile/mod.rs::infra_tests::changed_ddns_hostname_is_not_advertised_under_old_certificate`

### 模型模板

#### 43 — 已确认保存的新模板列表被更早的读取覆盖

- 处置：修复（原证据：真实入口已重放）。
- 修改：确认保存使旧读取代次失效；旧成功、失败及收尾都不能覆盖新模板或清除后续请求状态。
- 回归索引：
  - `src/features/settings/modelTemplates/store.test.ts :: keeps a confirmed mutation after a pre-mutation read's late success`
  - `src/features/settings/modelTemplates/store.test.ts :: keeps a confirmed mutation after a pre-mutation read's late failure`
  - `src/features/settings/modelTemplates/store.test.ts :: detaches a superseded read so a normal read starts fresh and owns its loading lifecycle`
  - `src/features/settings/modelTemplates/store.test.ts :: preserves forced-read supersession after the older read's success`
  - `src/features/settings/modelTemplates/store.test.ts :: preserves forced-read supersession after the older read's failure`
  - `src/features/settings/modelTemplates/store.test.ts :: clears an existing read error on confirmed mutation but still reports a later read failure`
  - `src/features/settings/modelTemplates/store.test.ts :: does not supersede or duplicate an independent status read when publishing a mutation`
  - `src/features/settings/modelTemplates/store.test.ts :: keeps the newest forced status result after the old read's success`
  - `src/features/settings/modelTemplates/store.test.ts :: keeps the newest forced status result after the old read's failure`

### 隐私与供应商

#### 44 — 再次选择替换旧历史仍保留旧范围

- 处置：修复（原证据：真实入口已重放）。
- 修改：明确选择替换旧历史时清除当前会话旧范围限制，重新标记应用请求的跟踪选项，保留其他会话范围。
- 回归索引：
  - `src-tauri/src/privacy/store.rs :: future_scope_preserves_prefix_until_all_explicitly_clears_it`
  - `src-tauri/src/privacy/store.rs :: remark_applies_requested_tracking_without_changing_placeholder`
  - `src/lib/privacyExtension.test.ts :: masks prior history after all clears the selected session cutoff`
  - `src/lib/privacyExtension.test.ts :: resumes masking when a remark restores requested tracking`

#### 45 — 哈希相同不证明进程曾加载隐私块

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：区分请求哈希和已确认原生覆盖；写入失败保持不受保护状态，恢复相同内容也触发必要重启。
- 回归索引：
  - `src-tauri/src/privacy/mod.rs :: failed_native_sync_recovery_changes_coverage_even_for_identical_entries`
  - `src-tauri/src/privacy/mod.rs :: isolated_native_sync_never_claims_coverage_or_changes_global_file`
  - `src-tauri/src/privacy/mod.rs :: failed_snapshot_publication_revokes_native_coverage`
  - `src-tauri/src/rpc/privacy_ext.rs :: restart_only_when_stale_and_idle`
  - `src/lib/privacyExtension.test.ts :: rejects an unprotected spawn both before and after identical-content recovery`
  - `src/lib/privacyExtension.test.ts :: rejects matching failed publication markers from a previously protected process`
  - `src/lib/privacyExtension.test.ts :: rejects native snapshots with a cutoff in any session`
  - `src/lib/privacyExtension.test.ts :: cancels compaction when the privacy file disappears`
  - `src/lib/privacyExtension.test.ts :: cancels compaction for unreadable coverage metadata: %s`
  - `src/lib/privacyExtension.test.ts :: permits a valid empty snapshot without native tracked entries`

#### 46 — 未填写新密钥时保存模式选择未生效

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：不填新密钥保留原材料，但落实所选明文或加密模式；外部引用不擅自转换。
- 回归索引：
  - `src-tauri/src/providers/ops.rs :: blank_key_upsert_honors_storage_mode_in_both_directions`
  - `src-tauri/src/providers/ops.rs :: blank_key_builtin_honors_storage_mode_in_both_directions`
  - `src-tauri/src/providers/ops.rs :: blank_key_mode_preserves_external_references`
  - `src-tauri/src/providers/ops.rs :: rename_and_blank_key_can_convert_encrypted_key_to_plaintext`
  - `src-tauri/src/providers/ops.rs :: missing_vault_or_command_like_secret_cannot_be_saved_as_plaintext`
  - `src/features/providers/ProviderPanel.test.tsx :: saves %s blank-key mode change from %s to %s`
  - `src/features/providers/ProviderPanel.test.tsx :: treats a blank-key storage-mode change as unsaved work`
  - `src/features/providers/ProviderPanel.test.tsx :: does not mark the original storage-mode selection as unsaved work`
  - `src/features/providers/ProviderPanel.test.tsx :: keeps missing-vault references in encrypted mode initially`
  - `src/features/providers/ProviderPanel.test.tsx :: keeps the dialog open when blank-key mode conversion fails`

#### 47 — 配置修改成功而凭据清理失败可留下孤立密钥

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：凭据修改及清理成功后才提交配置；后续失败补偿旧凭据，补偿失败明确报错，不返回假成功。
- 回归索引：
  - `src-tauri/src/providers/ops.rs :: cleanup_failure_keeps_config_and_original_encrypted_key (decrypt/set-key/upsert/authNone/builtin/authNone/delete/rename injected remove failures)`
  - `src-tauri/src/providers/ops.rs :: rename_destination_write_failure_restores_original_vault_entry`
  - `src-tauri/src/providers/ops.rs :: vault_snapshot_read_failure_does_not_modify_config_or_key`
  - `src-tauri/src/providers/ops.rs :: yaml_failure_restores_vault_changes`
  - `src-tauri/src/providers/ops.rs :: rollback_failure_is_reported_instead_of_hidden`

#### 48 — 返回列表后的迟到成功事件不会刷新供应商

- 处置：修复（原证据：真实入口已重放）。
- 修改：返回列表、关闭及取消完成后刷新供应商；迟到成功只刷新全局列表，不修改已离开的弹窗。
- 回归索引：
  - `src/features/providers/OauthLoginDialog.test.tsx :: reconciles saved providers when success arrives during cancellation`
  - `src/features/providers/OauthLoginDialog.test.tsx :: refreshes once for a normal successful completion`
  - `src/features/providers/OauthLoginDialog.test.tsx :: refreshes a late success even after cancellation failed`
  - `src/features/providers/OauthLoginDialog.test.tsx :: keeps the flow retryable and refreshes providers after cancel failure`
  - `src/features/providers/OauthLoginDialog.test.tsx :: cancels after start settles even when unmounted`

#### 49 — 启动未完成就取消可能留下后台登录进程

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：取消等待本次启动落定；原生终止失败保留可重试所有权，终止后清理并等待读取任务再释放位置。
- 回归索引：
  - `src/features/providers/OauthLoginDialog.test.tsx :: waits for a pending start before cancelling on Back`
  - `src/features/providers/OauthLoginDialog.test.tsx :: cancels after start settles even when unmounted`
  - `src/features/providers/OauthLoginDialog.test.tsx :: reconciles after a rejected start and still completes cancellation`
  - `src/features/providers/OauthLoginDialog.test.tsx :: keeps the flow retryable and refreshes providers after cancel failure`
  - `src/features/providers/OauthLoginDialog.test.tsx :: keeps the started login cancellable when status hydration fails`
  - `src/features/providers/OauthLoginDialog.test.tsx :: waits for pending start on confirmed dismissal`
  - `src/features/providers/OauthLoginDialog.test.tsx :: unlistens when the dialog unmounts before onProvidersOauth resolves`
  - `src-tauri/src/providers/oauth.rs :: cancellation_reaps_child_and_stops_reader_before_releasing_slot`

### 定时任务、想法与诊断

#### 50 — 已完成的一次性任务被改期后列表仍显示已完成，但调度器会再次触发

- 处置：修复（原证据：真实入口已重放）。
- 修改：真正改期的一次性任务重置当前执行完成标记，保留历史与累计次数；等价时刻不重复重置。
- 回归索引：
  - `src-tauri/src/schedules/tests.rs::rescheduled_once_has_a_new_occurrence_and_preserves_history`
  - `src-tauri/src/schedules/tests.rs::active_one_shot_cannot_be_rescheduled_and_equivalent_instant_stays_completed`
  - `src-tauri/src/schedules/tests.rs::test_derive_lifecycle_states (adapted current-occurrence fixture)`

#### 51 — 手动运行可使已运行次数超过 max_runs

- 处置：修复（原证据：需要确认产品规则）。
- 修改：手动与自动运行统一在认领前检查次数上限，达到上限不得重新恢复下次时间。
- 回归索引：
  - `src-tauri/src/schedules/tests.rs::manual_claim_enforces_cap_and_rolls_back_failed_claims`
  - `src-tauri/src/schedules/tests.rs::automatic_claim_rechecks_occurrence_and_cannot_exceed_cap`

#### 52 — 定时器与手动运行在检查与创建之间可并发产生两个运行

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：调度与手动运行在同一数据库互斥和事务中重新认领，消除检查到创建之间的双运行窗口。
- 回归索引：
  - `src-tauri/src/schedules/tests.rs::concurrent_manual_and_timer_dispatch_have_one_active_run`
  - `src-tauri/src/schedules/tests.rs::manual_and_timer_claims_share_active_guard_without_counting_skips`
  - `src-tauri/src/schedules/tests.rs::stale_timer_snapshot_cannot_claim_after_pause_or_delete`

#### 53 — 任务被删除后已认领的运行仍写入

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：运行中拒绝删除并展示原因；已删除、暂停或改期的任务不能由旧调度快照重新认领。
- 边界/理由：删除不是终止已认领执行的隐式方式，任务记录保留到运行结果落定。
- 回归索引：
  - `src-tauri/src/schedules/tests.rs::deletion_cannot_outlive_an_active_claim_or_create_an_orphan`
  - `src-tauri/src/schedules/tests.rs::stale_timer_snapshot_cannot_claim_after_pause_or_delete`
  - `src/features/schedules/schedulesStore.test.ts::keeps an active schedule and history when deletion is refused, showing the reason`

#### 54 — 放入输入框发送成功但记录已派发失败时被静默吞掉，想法仍显示待处理

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：派发记录失败显示持久错误；重试只补失败记录，不重复发送已经交付的内容。
- 回归索引：
  - `src/features/backlog/fillComposer.test.ts: keeps a persistent error and retries only failed delivery records without resending`

#### 55 — 已结束想法从回收站恢复后，下次启动又被自动移回回收站

- 处置：修复（原证据：真实入口已重放）。
- 修改：明确恢复写入持久豁免标记，启动归档不再把它移回回收站；用户明确改状态后解除豁免。
- 回归索引：
  - `src-tauri/src/backlog/store.rs: restored_finished_items_survive_restarts_until_explicit_status_change`
  - `src-tauri/src/db.rs: migrate_v22_preserves_restore_exemption_when_reentered`

#### 56 — 通知策略“不放入收件箱”仍有会话条目

- 处置：保留正常设计（原证据：需要确认产品规则）。
- 修改：保留“不生成完成结果待办”的既有策略，不以此隐藏独立的会话关注、审批或提问。
- 边界/理由：架构明确通知策略只管理完成结果待办，不管理独立会话关注；保持该设计。
- 回归索引：
  - `src/features/inbox/attention.test.ts::result-only notification policies do not suppress independent session attention`
  - `src-tauri/src/schedules/tests.rs::test_should_create_inbox_todo (existing exhaustive policy guard)`

#### 57 — “仅重要时提醒”下顺利完成的运行仍有会话条目

- 处置：保留正常设计（原证据：需要确认产品规则）。
- 修改：保留“仅失败或曾需关注时生成结果待办”的策略，不把它扩展为屏蔽会话本身。
- 边界/理由：安静成功不生成结果待办，但会话关注仍按统一会话规则展示；保持该设计。
- 回归索引：
  - `src/features/inbox/attention.test.ts::result-only notification policies do not suppress independent session attention`
  - `src/features/inbox/attention.test.ts::does not hide actionable %s behind a result (awaiting_approval, awaiting_answer, running)`
  - `src-tauri/src/schedules/tests.rs::test_should_create_inbox_todo (existing exhaustive policy guard)`

#### 58 — 同一运行同时出现会话条目与结果待办

- 处置：修复（原证据：需要确认产品规则）。
- 修改：同次运行的结果待办替代对应终态会话条目；复用会话的新活动、运行中审批与提问仍保留。
- 回归索引：
  - `src/features/inbox/attention.test.ts::shows one result entry instead of duplicate %s session (unread, error)`
  - `src/features/inbox/attention.test.ts::keeps new activity in a reused session separate from an older run result`
  - `src/features/inbox/attention.test.ts::does not hide actionable %s behind a result (awaiting_approval, awaiting_answer, running)`
  - `src/features/inbox/attention.test.ts::closed results and todos without a run identity never hide sessions`

#### 59 — 会话列表刷新重置诊断对话框里用户已改的提示词与选择

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：诊断编辑只按本次打开和目标初始化，目录刷新不重置文字或选择，旧目标响应被忽略。
- 回归索引：
  - `src/features/diagnose/DiagnoseDialog.test.tsx: preserves edited prompt and existing selection through catalog refresh`
  - `src/features/diagnose/DiagnoseDialog.test.tsx: preserves new-session model and target type through catalog refresh`
  - `src/features/diagnose/DiagnoseDialog.test.tsx: ignores a late prompt response from a previous target`

#### 60 — 刷新把发送中状态清零，可重复发送诊断

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：同步发送锁保护所有入口，刷新不能解锁；迟到完成不关闭后来打开的对话框，失败允许明确重试。
- 回归索引：
  - `src/features/diagnose/DiagnoseDialog.test.tsx: keeps sending locked across refresh and rapid keyboard submissions`
  - `src/features/diagnose/DiagnoseDialog.test.tsx: unlocks explicit retry after dispatch failure`
  - `src/features/diagnose/DiagnoseDialog.test.tsx: does not let an earlier send close or navigate a reopened diagnosis`

#### 61 — 自动诊断失败的会话每分钟被重试

- 处置：修复（原证据：真实入口已重放）。
- 修改：派发前持久记录已尝试的活动水位；失败不再每分钟重试，手动重试和新活动仍可触发。
- 回归索引：
  - `src/features/heatmap/doctorStore.test.tsx: attempts each unchanged session once and reaches older sessions after a failure`
  - `src/features/heatmap/doctorStore.test.tsx: allows manual retry without new activity`
  - `src/features/heatmap/doctorStore.test.tsx: allows automatic diagnosis after new activity and another idle period`
  - `src/features/heatmap/doctorStore.test.tsx: keeps failed activity watermarks after scheduler remount`
  - `src/features/heatmap/doctorStore.test.tsx: loads persisted failed-activity watermarks after application reload`

#### 62 — 失败较新会话的重复重试可持续阻挡较旧会话（有界观察与条件性推论）

- 处置：修复（原证据：真实入口已重放）。
- 修改：自动队列排除已尝试且未变化的较新会话，使较旧会话能够继续获得诊断机会。
- 回归索引：
  - `src/features/heatmap/doctorStore.test.tsx: attempts each unchanged session once and reaches older sessions after a failure`
  - `src/features/heatmap/doctorStore.test.tsx: does not diagnose concurrently when a manual diagnosis is already running`

### 终端、服务与文件写入

#### 63 — 启动响应前退出事件被消费，响应后标签持续显示运行中

- 处置：修复（原证据：真实入口已重放）。
- 修改：启动前等待事件订阅就绪，先到退出事件按终端编号缓存并在绑定后重放，不再错误显示运行中。
- 回归索引：
  - `src/features/terminal/CommandTerminalPanel.lifecycle.test.tsx :: 63 keeps an exit received before the start response`

#### 64 — 启动失败后重试不触发新启动

- 处置：修复（原证据：真实入口已重放）。
- 修改：启动失败后的重试真正重建终端和启动状态，不依赖未变化的组件条件。
- 回归索引：
  - `src/features/terminal/CommandTerminalPanel.lifecycle.test.tsx :: 64 retries a failed start and reaches ready with a new request`

#### 65 — 启动响应前的数据被桥丢弃

- 处置：修复（原证据：真实入口已重放）。
- 修改：先到输出与退出共用有序握手队列，启动响应到达前的数据不再被丢弃。
- 回归索引：
  - `src/features/terminal/CommandTerminalPanel.lifecycle.test.tsx :: 65 replays data before the start response in byte order`
  - `src/features/terminal/CommandTerminalPanel.lifecycle.test.tsx :: closes a start response belonging to a removed tab`

#### 66 — 退出发生在会话登记之前可留下已死终端登记

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：登记与退出共享登记锁，并在插入前检查PTY存活，拒绝已退出终端。
- 边界/理由：原项为竞争假说；以受控登记/退出交错回归验证守卫，不操作用户真实进程。
- 回归索引：
  - `src-tauri/src/terminal/commands.rs :: registration_tests::exit_before_registration_never_records_a_dead_terminal`
  - `src-tauri/src/terminal/commands.rs :: registration_tests::exit_during_registration_cannot_be_reinserted_after_forget`

#### 67 — 会话删除与终端登记交错可遗留进程

- 处置：加固守卫（原证据：模型与源码支持，尚未重放）。
- 修改：终端开启从目录查找到登记均与会话删除共用互斥边界，防止会话已删却遗留进程。
- 边界/理由：原项为竞争假说；应用内开启与删除串行，回归使用独立登记表，不声称原生外部进程已重放。
- 回归索引：
  - `src-tauri/src/terminal/commands.rs :: registration_tests::session_deletion_waits_for_terminal_start_registration`

#### 68 — 较早请求晚返回覆盖当前开关列表

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：服务列表仅接受当前筛选、最新代次及仍挂载请求；旧错误与旧收尾也不能覆盖新状态。
- 回归索引：
  - `src/features/services/ServicesPanel.poll.test.tsx :: 68 ignores an older all-ports response after returning to dev-only`
  - `src/features/services/ServicesPanel.poll.test.tsx :: 68 ignores stale errors and lets a newer service event own dev rows`
  - `src/features/services/ServicesPanel.poll.test.tsx :: 68 ignores responses and events after unmount`

#### 69 — 成功保存的内容可能不是最后落盘内容，即使另一次保存报错

- 处置：修复（原证据：真实入口已重放）。
- 修改：同路径写入串行，每次使用独立且独占创建的临时文件，保留权限并原子替换自己的字节。
- 回归索引：
  - `src-tauri/src/services/files.rs :: tests::concurrent_saves_own_their_bytes_and_leave_no_temps`
  - `src-tauri/src/services/files.rs :: tests::atomic_save_preserves_existing_permissions`
  - `src-tauri/src/services/files.rs :: tests::concurrent_checked_saves_have_only_one_winner`

#### 70 — 报错的保存仍可能覆盖文件

- 处置：修复（原证据：真实入口已重放）。
- 修改：失败只清理自己成功创建的临时文件；失败保存的内容不会借另一次替换落盘。
- 回归索引：
  - `src-tauri/src/services/files.rs :: tests::failed_replace_does_not_land_or_leave_temp`
  - `src-tauri/src/services/files.rs :: tests::checked_saves_reject_stale_baselines_and_write_time_changes`
  - `src-tauri/src/services/files.rs :: tests::concurrent_saves_own_their_bytes_and_leave_no_temps`

#### 71 — 同毫秒同名缓存文件覆盖早先附件字节

- 处置：修复（原证据：真实入口已重放）。
- 修改：附件、粘贴图片和导入图片使用唯一独占目标，防止同名同毫秒互相覆盖，失败清理部分新文件。
- 回归索引：
  - `src-tauri/src/services/clipboard.rs :: tests::same_name_concurrent_attachments_retain_independent_bytes`
  - `src-tauri/src/services/commands.rs :: tests::concurrent_image_attachments_keep_their_bytes`

### 导航与启动

#### 72 — 侧栏收起时打开其他空间的会话,重新展开后空间不跟随

- 处置：修复（原证据：真实入口已重放）。
- 修改：空间跟随放在始终挂载的外壳中，侧栏关闭及会话资料晚到时也能同步。
- 回归索引：
  - `src/App.navigation.test.tsx :: 72: follows a cross-space selection with the sidebar unmounted`
  - `src/App.navigation.test.tsx :: 72: follows the selected session when its metadata arrives later`

#### 73 — 首条消息发送期间打开设置,完成后落到空白起始页而非新会话

- 处置：修复（原证据：真实入口已重放）。
- 修改：首发完成保留已打开的设置页，并把其返回目标更新为真实新会话，不回到消失的草稿。
- 回归索引：
  - `src/features/sessions/draftSession.test.ts :: 73: first-send handoff keeps settings open and returns to the created session`
  - `src/features/sessions/draftSession.test.ts :: 73: a first-send completion cannot take over a different page under settings`

#### 74 — 分支草稿开着时新建会话,中间区仍显示分支草稿

- 处置：修复（原证据：真实入口已重放）。
- 修改：新建会话明确清除分支草稿优先级；无工作区时回到正确起始页。
- 回归索引：
  - `src/App.navigation.test.tsx :: 74: new-session navigation replaces a fork draft in the rendered center`
  - `src/App.navigation.test.tsx :: 74: new-session without a workspace clears fork priority and shows the launcher`

#### 75 — 会话列表加载期间打开设置/收件箱,启动恢复抢走页面

- 处置：修复（原证据：真实入口已重放）。
- 修改：启动恢复仅在未被用户操作的起始页执行；设置、收件箱及返回首页均取消旧恢复意图。
- 回归索引：
  - `src/App.navigation.test.tsx :: 75: preserves settings opened before startup loading completes`
  - `src/App.navigation.test.tsx :: 75: preserves inbox opened before startup loading completes`
  - `src/App.navigation.test.tsx :: 75: a last session outside the launch space (b) cannot clear a user page`
  - `src/App.navigation.test.tsx :: 75: a last session outside the launch space (missing) cannot clear a user page`
  - `src/App.navigation.test.tsx :: 75: returning home during loading is still explicit navigation`
  - `src/App.navigation.test.tsx :: 75: still restores the last session on an untouched launch page`

### 设置、技能、插件与MCP

#### 76 — 保存或重新读取进行时输入的文字会被结果覆盖

- 处置：修复（原证据：真实入口已重放）。
- 修改：保存只推进已保存基线，不覆盖后续输入；重读按编辑代次应用，跳过旧结果时不采用未见过的新版本标记。
- 回归索引：
  - `src/features/settings/settingsFileRaces.test.tsx: keeps typing during save dirty and uses the saved snapshot stamp for the next write`
  - `src/features/settings/settingsFileRaces.test.tsx: does not adopt an unseen disk snapshot or stamp when typing during reload`
  - `src/features/settings/settingsFileRaces.test.tsx: adopts a completed reload when there is no intervening edit`
  - `src/features/settings/settingsFileRaces.test.tsx: keeps the buffer and stamp when reload fails after typing`
  - `src/features/settings/settingsFileRaces.test.tsx: preserves typing while the conflict dialog's reload is pending`
  - `src/features/settings/settingsFileRaces.test.tsx: ignores a previous editor's pending load after unmount`

#### 77 — 切换项目后旧项目的插件目录晚到并覆盖新项目

- 处置：修复（原证据：真实入口已重放）。
- 修改：插件与扩展列表及读取收尾都绑定当前项目和代次，切项目清旧数据，忽略旧项目结果。
- 回归索引：
  - `src/features/settings/settingsFileRaces.test.tsx: ignores the previous project's success including its extension list`
  - `src/features/settings/settingsFileRaces.test.tsx: does not let an old failure clear the active project's pending indicator or error`
  - `src/features/settings/settingsFileRaces.test.tsx: rejects an earlier request even when switching back to the same project`
  - `src/features/settings/settingsFileRaces.test.tsx: clears the previous project's visible rows while the next project loads`
  - `src/features/settings/settingsFileRaces.test.tsx: does not let old success clear the current project's error`

#### 78 — 切换记忆项目后旧项目文件列表晚到并覆盖

- 处置：修复（原证据：真实入口已重放）。
- 修改：记忆列表、错误和删除完成绑定当前项目，旧项目结果不能替换新列表或关闭新编辑器。
- 回归索引：
  - `src/features/settings/settingsFileRaces.test.tsx: ignores a previous project's late success`
  - `src/features/settings/settingsFileRaces.test.tsx: ignores a previous project's late failure`
  - `src/features/settings/settingsFileRaces.test.tsx: keeps the latest list when a prior request for the same project returns last`
  - `src/features/settings/settingsFileRaces.test.tsx: does not let old success clear the selected memory project's error`
  - `src/features/settings/settingsFileRaces.test.tsx: does not close the new project's editor when an old skill deletion finishes`

#### 79 — omp config list 失败(found=false)时切换技能会用空列表整体覆盖 disabledExtensions

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：技能与插件共用串行读改写队列；读取失败禁止基于空列表写回，保留其他配置条目。
- 回归索引：
  - `src/features/skills/store.configTransactions.test.ts :: does not write after found=false (config command failed)`
  - `src/features/skills/store.configTransactions.test.ts :: does not write after found=false (null)`
  - `src/features/skills/store.configTransactions.test.ts :: does not write after a rejected read`
  - `src/features/skills/store.configTransactions.test.ts :: never invokes the mutation or follow-up after an unsuccessful read`
  - `src/features/skills/store.configTransactions.test.ts :: serializes skill and shared plugin-list writes without dropping either entry`
  - `src/features/skills/store.configTransactions.test.ts :: allows a later successful write after a failed read`
  - `src/features/skills/store.configTransactions.test.ts :: preserves the no-op contract for an unchanged list`
  - `src/features/skills/store.configTransactions.test.ts :: allows writes when the key is absent from a successfully read config`
  - `src/features/settings/PluginsSection.transactions.test.tsx :: does not write or change the rendered toggle after a found=false config read`
  - `src/features/settings/PluginsSection.transactions.test.tsx :: does not write or change the rendered toggle after a rejected config read`
  - `src/features/settings/PluginsSection.transactions.test.tsx :: waits for a skills-list transaction before reading and preserves both pages' entries`

#### 80 — 启用 .disabled 扩展时重命名失败：界面回滚为已禁用，但配置里已被改为启用

- 处置：修复（原证据：真实入口已重放）。
- 修改：重命名处于同一配置事务中；失败恢复刚读取的旧配置，补偿失败报告双重错误并重读实际状态。
- 回归索引：
  - `src/features/skills/store.configTransactions.test.ts :: does not rename or write when reading config fails`
  - `src/features/skills/store.configTransactions.test.ts :: does not rename when the config write fails`
  - `src/features/skills/store.configTransactions.test.ts :: restores the persisted snapshot, not stale UI config, after rename failure`
  - `src/features/skills/store.configTransactions.test.ts :: finishes rollback before another shared-list writer can run`
  - `src/features/skills/store.configTransactions.test.ts :: reports both failures and reloads actual state if compensation fails`
  - `src/features/skills/store.configTransactions.test.ts :: commits the renamed extension and refreshed config on success`

#### 81 — 取消点击早于后端登记安装时被后端当成空操作，随后安装仍成功

- 处置：修复（原证据：模型与源码支持，尚未重放）。
- 修改：每次安装使用唯一请求身份，登记前取消可被本次安装消费；旧取消不影响新尝试，取消记录有界清理。
- 回归索引：
  - `src/stores/ompInstall.test.ts :: honors cancellation while the progress listener setup resolves`
  - `src/stores/ompInstall.test.ts :: honors cancellation while the progress listener setup rejects`
  - `src/stores/ompInstall.test.ts :: still installs without progress events when deferred listener setup fails without cancellation`
  - `src/stores/ompInstall.test.ts :: forwards running cancellation after deferred setup and permits retry`
  - `src/stores/ompInstall.test.ts :: keeps a running install cancellable after a cancel invoke fails`
  - `src-tauri/src/omp_install.rs :: tests::request_scoped_commands_preserve_single_flight_and_retry`
  - `src-tauri/src/omp_install.rs :: tests::cancel_before_begin_is_consumed_and_finished_request_is_cleaned_up`
  - `src-tauri/src/omp_install.rs :: tests::mismatched_and_late_cancels_do_not_cancel_another_request`
  - `src-tauri/src/omp_install.rs :: tests::rejected_request_drops_pending_cancel_without_retiring_the_active_owner`
  - `src-tauri/src/omp_install.rs :: tests::cancellation_records_stay_bounded_across_request_lifecycles`

#### 82 — 更新成功后，更新前发出的检查结果晚到，仍显示有可用更新

- 处置：修复（原证据：真实入口已重放）。
- 修改：更新成功使旧检查全链路失效并强制复检；旧结果、错误与收尾不再恢复更新徽标。
- 回归索引：
  - `src/stores/ompUpdate.test.ts :: rechecks after successful update even while a pre-update check is pending`
  - `src/stores/ompUpdate.test.ts :: ignores stale errors without clearing the new post-update check's busy state`
  - `src/stores/ompUpdate.test.ts :: does not auto-update again when a superseded check reports an old available version`
  - `src/stores/ompUpdate.test.ts :: keeps a pending check valid when the attempted update fails`

#### 83 — MCP 编辑弹窗打开时，目录重读发现服务器已被外部删除，弹窗无提示地消失（状态仍是 edit）

- 处置：修复（原证据：需要确认产品规则）。
- 修改：外部删除后保留编辑弹窗与草稿，展示说明并禁止保存；重新出现不丢草稿，主动关闭后不自动重开。
- 回归索引：
  - `src/features/settings/McpSection.test.tsx :: preserves the open editor and draft with an explanation after external deletion`

#### 84 — MCP空目录的添加入口绕过父 busy，保存中关闭弹窗再打开新弹窗可同时发出两次写入

- 处置：修复（原证据：真实入口已重放）。
- 修改：父级同步写锁覆盖空目录入口、关闭重开、整批导入和最终重读，子编辑器也禁止同步重复提交。
- 回归索引：
  - `src/features/settings/McpSection.test.tsx :: keeps empty-list add and import disabled after closing a saving editor until its reload finishes`
  - `src/features/settings/McpSection.test.tsx :: holds parent ownership across every import entry and closing the import dialog`
  - `src/features/settings/McpSection.test.tsx :: does not issue duplicate writes for same-batch keyboard submits`

## 附加实现观察与原有报错

- 状态扩展切换到无文件会话时清除旧文件；终态子代理不被迟到进度重新标记为运行。
- Markdown补齐真实文件预览入口；明确/相对链接、远程图片显式加载、Mermaid切换及原生右键菜单以行为回归验证。
- 修复Markdown事件监听器类型、模型角色测试动态键类型；侧聊移除不受ES2021支持的Promise API，不扩大编译目标。
- 无效配对码不能借既有登录态或可读会话被误报成功。
- 提示词模板单遍替换，用户正文中的模板记号不再次展开，结果不依赖遍历顺序。
- 设置文件创建同步防重入；技能和插件同键读改写共用串行事务。
- 受限配置文件版本检查与写入使用共享同路径锁；检查返回前保留原先的内容/版本基线。
- 可视化插件只有内嵌清单和技能正文均完整匹配时才加载，拒绝半安装状态。

## 契约变化

精确公共契约同步到架构文档；本段列出对调用者有影响的变化。

- 普通文件保存追加可选预期内容，冲突以`CONFLICT:`拒绝；应用内共享路径锁不被描述为跨进程事务。
- 工作树删除追加可选孤儿回收标记；明确普通清理语义保持不变，运行中的RPC/时光机始终受保护。
- 安装开始及取消均要求同一次尝试的请求身份；全部调用者同步迁移，不保留无参数旧入口。
- 配对GET/HEAD改为确认页；POST才兑换，返回本次握手结果。
- 批量审批要求显示快照中的编号列表，并返回成功处理编号；移动客户端与服务端需共同构建。
- 状态文件增加可选进程出生标记；旧格式要求原生文件占用佐证。
- 数据库升级至v22，新增可空的恢复豁免标记；无前端想法数据结构变化。
- 应用内启动、置顶、清理与会话终端登记共用互斥边界；锁顺序固定，退出回调不反向获取该锁。
- 原生隐私覆盖标记表达实际成功或失败状态；显式替换历史范围会清除当前会话旧限制。
- 暂存队列明确停止后跨刷新保持暂停；计划执行确认顺序、侧聊首问失败传播及MCP父级整批写入归属同步调整。

## 不作出的保证

- 不宣称独立外部文件/Git/命令行进程遵循应用内锁；无法安全回滚时保留用户工作并明确报告恢复边界。
- 不宣称移动端具备服务端恰好一次投递；未知送达必须由用户确认风险后恢复。
- 不把拥有配对码的主动POST客户端等同于可识别手机硬件；修复的是GET预取消耗和错误成功判断。
- 不以无真实提供商请求、安装、隧道或登录操作的受控验证，冒充这些外部服务的现场验收。

## 验收结果

以下结果来自最终实现，而非初次失败的中间版本。计数不叠加聚焦回归与扩展子集。

|检查|实际结果|
|---|---|
|TypeScript严格检查|退出0，0错误|
|前端完整单元测试|341文件、3063测试通过，0失败、0跳过|
|原生完整单元测试|发现851项；849通过、0失败、2项原有真实OMP集成检查按配置忽略|
|移动端生产构建|退出0|
|桌面生产构建|退出0|
|Rust格式检查|退出0|
|Rust编译检查|退出0|
|Rust全目标严格静态检查|退出0，警告作为错误处理|

实际执行命令：

```sh
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json --outputFile=.cache/statechart-repairs/vitest.json
node node_modules/vite/bin/vite.js build --config vite.mobile.config.ts
node node_modules/vite/bin/vite.js build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

前端完整测试已包含48项扩展行为回归：检查点22、运行状态3、隐私10、计划提醒13。另执行9文件79项聚焦回归，均通过。原有忽略项为`prompt_composition::tests::prompt_composition_live`与`rpc::live_test::live_rpc_prompt_with_approval`，均会启动真实OMP；本次不以真实用户会话/供应商请求替代隔离测试。

### 验收阶段发现并修正

- 首轮前端严格检查10条错误、9文件30项测试失败，另有10项已有测试因夹具缺少订阅契约未收集。最终全部恢复并通过。
- 移动端逐题回答曾提前移除卡片，令组件卸载并丢失忙碌、错误与重试状态。修复消费编号与可见卡片生命周期的区别；保留原来五项失败的行为断言，真实源码界面也证明已消费首题不重发、失败次题可编辑重试。
- 其他前端验收修正限定于回归夹具与严格兼容性：现有ES2021支持的延迟Promise、真实状态枚举、有效查询参数、DOM环境、卸载隔离与真实订阅接口。未更改编译严格度或用例预期来掩盖产品问题。
- 首轮原生测试848通过、1失败；失败夹具使用了既有合并策略明确拒绝的flow序列。改用策略支持的注释/block布局，保留“相同内容从失败恢复也必须更新覆盖标记”的全部断言，完整重跑通过。
- 原生严格静态检查的9项问题均修复：无条件写入恢复调用既有入口、移除多余借用、7处错误断言采用直接expect_err；未删减行为断言。
- 构建仍报告既有非阻断警告：大代码块、CSS高亮伪元素、混合动态/静态导入。本次未扩展为构建拆包或CSS整理。

### 真实临时目录行为验证

编译独立临时可执行程序，直接调用本次产品文件/附件逻辑；不是只断言模拟调用参数。全部观察为真：

- 外部修改造成预期内容冲突时不覆盖磁盘。
- 同基线并发保存仅一个成功。
- 16个同名附件的目标路径各异，16份实际字节均正确。
- 16个独立落盘目标的实际字节正确。
- 同目标并发写入最终为完整payload，无半写内容或残留暂存文件。

不宣称应用外写者遵循同一锁，最终比较到原子替换之间仍有跨进程竞态边界。线程均join；临时源码、程序与测试目录已清理。

### 隔离真实源码界面验证

使用仓库真实组件、状态逻辑与CodeMirror，独立浏览器空间验证13组场景：

- 桌面：脏文件关闭/重开/切换；冲突与重载确认；显式/相对文件链接；MCP删除编辑器/重现/在途保存；折叠侧栏跨空间选择；首次发送与设置页交接；Stop后跨卸载暂存不自动重发。
- 移动端：未知送达警告与重载保留；阻止盲目重发；取消/确认风险恢复；失效配对提示；乱序pending及已处理卡片防复活；最终逐题回答忙碌/失败/编辑重试。
- 浅/深色界面及390×844移动视口：无横向溢出，所检视标签无单字宽换行；保留11张脱敏截图。

边界：IPC、HTTP、磁盘、会话目录及启动均由明确隔离夹具提供；不证明原生窗口、IPC传输、后端持久化或真实供应商行为。来源未确认的现有原生应用未捕获、点击、重启或关闭。唯一浏览器空间已结束一次；所属服务器/编译子进程已退出、端口关闭，一次性夹具/执行脚本删除。

### 修改边界与证据

- 121个已有文件修改，27个新增文件，共148个任务文件；与14份修复交付及验收修正归属完全一致，无额外来源不明路径。
- `docs/statecharts/`跟踪差异为空，且无新增路径；审计原文与历史证据未改动。
- 提交前差异空白检查通过；开始暂存前索引为空。只按核准的148条明确路径暂存，不使用全量暂存；不推送。
- 精确命令输出与完整结果保存在本地忽略目录：前端`frontend-*.log`/`vitest.json`，原生`native-*.log`/`native-acceptance.json`，界面`surface/`，总结果`verification.json`。日志不是回归代码、不会混入提交。
- 架构契约已同步；本次未执行依赖安装、真实配对/凭证/供应商操作，也未启动或关闭真实用户会话。

完整实现、单元测试、构建与上述受控行为验收均已完成；真实OMP集成与原生窗口边界如前述，不以未执行场景冒充通过。
