# 全项目状态审计阅读入口

本次覆盖 10 个模块，建立 54 个有限状态模型。有限状态模型只穷举明确的输入和次数，不等于证明整个应用没有问题。产品代码未修改。

共 84 条规则级发现：
- 真实入口已重放：45 条。
- 模型与源码支持，尚未重放：30 条。
- 需要确认产品规则：9 条。

另有非模型实现观察，见各模块报告；不要把假说、设计问题或构建兼容性注记计作已确认产品缺陷。

## 怎么看

1. 先看下表的问题，再打开对应的编号路径。
2. 蓝色边框标出重现步骤，红色表示违反规则，橙色表示合并的显示状态在部分底层状态违反规则。
3. 总览图只作索引，可能很大；详细反例图和 stories.md 是主要阅读入口。
4. 标为已重放只说明真实消费者在指定输入顺序下出现了该行为；外部进程、网络或操作系统能否自然产生这个顺序，要继续看每条证据边界。
5. proposed fixed 图仅是模型对照，产品修复并未实施。

## 规则级发现

| 编号 | 模块 | 发现或被违反的规则 | 证据级别 | 编号路径 |
|---|---|---|---|---|
| 1 | runtime | 退出事件早于注册表清理/遗留帧时，缓存仍记存活 | 模型与源码支持，尚未重放 | [NoGhostLive](runtime/RuntimeStatus/chart/stories.md) |
| 2 | runtime | 退出后迟到的开始帧重新开启转圈 | 真实入口已重放 | [NoGhostStreaming](runtime/RuntimeStatus/chart/stories.md) |
| 3 | runtime | 退出后迟到的请求帧留下可回答卡片与等待状态 | 模型与源码支持，尚未重放 | [AwaitingNeedsProcess](runtime/RuntimeStatus/chart/stories.md) |
| 4 | runtime | 回合终止后待答卡片仍保留 | 真实入口已重放 | [CardsMatchStatus](runtime/RuntimeStatus/chart/stories.md) |
| 5 | runtime | 回答已结束回合的遗留卡片会把空闲状态改回处理中 | 真实入口已重放 | [IdleNotWorking](runtime/RuntimeStatus/chart/stories.md) |
| 6 | runtime | 状态文件的进程号被复用后会话被误判外部占用 | 真实入口已重放 | [ExternalIsRealOmp](runtime/Ownership/chart/stories.md) |
| 7 | runtime | 挂起标记晚于退出重算写入时显示可能停在空闲 | 模型与源码支持，尚未重放 | [SuspendShown](runtime/Ownership/chart/stories.md) |
| 8 | composer | 点击停止后，本地 held 文本仍被自动发送 | 真实入口已重放 | [StopDoesNotResendHeld](composer/held-queue/chart/stories.md) |
| 9 | composer | 批准先退出计划，创建执行会话失败后不能直接在面板重试 | 真实入口已重放 | [FailedApprovalCanRetryAtOnce](composer/plan-approve/chart/stories.md) |
| 10 | composer | 侧聊首问发送失败仍保留用户回显 | 真实入口已重放 | [EchoMeansMessageSent](composer/sidechat/chart/stories.md) |
| 11 | composer | 侧聊首问发送失败后输入文字未回到草稿 | 模型与源码支持，尚未重放 | [FailedFirstMessageKeepsText](composer/sidechat/chart/stories.md) |
| 12 | composer | 侧聊截断副本写失败可能继承父计划模式 | 模型与源码支持，尚未重放 | [SideChatNeverInheritsPlanMode](composer/sidechat/chart/stories.md) |
| 13 | composer | 完整轮次分支丢弃尾部计划开关，恢复成旧计划状态 | 真实入口已重放 | [ForkKeepsParentPlanMode](composer/fork-plan-state/chart/stories.md) |
| 14 | composer | 停止消息是否标记 aborted 是提醒重启的上游边界 | 需要确认产品规则 | [StopDoesNotRestartGeneration](composer/plan-stop-boundary/chart/stories.md) |
| 15 | composer | 计划角色读取失败时未发送标签回退显示普通模型 | 需要确认产品规则 | [SettledChipShowsSavedRole](composer/plan-preview/chart/stories.md) |
| 16 | git-files | 未保存的修改在关闭标签时不会丢失。 | 真实入口已重放 | [NoLossOnClose](git-files/FileBuffer/chart/stories.md) |
| 17 | git-files | 未保存的修改在点重新载入时不会在没确认的情况下丢失。 | 真实入口已重放 | [NoLossOnReload](git-files/FileBuffer/chart/stories.md) |
| 18 | git-files | 未保存的修改在切换标签时不会丢失。 | 真实入口已重放 | [NoLossOnSwitch](git-files/FileBuffer/chart/stories.md) |
| 19 | git-files | 保存不会悄悄覆盖用户从没看到过的磁盘改动。 | 真实入口已重放 | [NoClobber](git-files/FileBuffer/chart/stories.md) |
| 20 | git-files | 窗口聚焦后的后台刷新不会冲掉用户刚输入的文字。 | 真实入口已重放 | [NoLossOnRefresh](git-files/FileBuffer/chart/stories.md) |
| 21 | git-files | 正在运行的时光机不会被「回收孤儿」删掉目录。 | 模型与源码支持，尚未重放 | [NoKillRunningRun](git-files/Worktree/chart/stories.md) |
| 22 | git-files | 有会话在用的工作树不会被「回收孤儿」删掉。 | 模型与源码支持，尚未重放 | [NoRemoveInUse](git-files/Worktree/chart/stories.md) |
| 23 | git-files | 清理失败后，界面不会再显示一个磁盘上已经不存在的工作树。 | 真实入口已重放 | [NoStaleListing](git-files/Worktree/chart/stories.md) |
| 24 | git-files | 没有正在记录的轮次时，不会留下只有开始快照、没有条目的残留存档。 | 真实入口已重放 | [NoLeftoverSnapshots](git-files/Checkpoint/chart/stories.md) |
| 25 | git-files | 撤回不会悄悄覆盖用户之后做的改动。 | 需要确认产品规则 | [NoSilentOverwrite](git-files/Checkpoint/chart/stories.md) |
| 26 | git-files | 已经撤回过的轮次，在存档清理之后仍然显示为已撤回。 | 真实入口已重放 | [UndoneStaysUndone](git-files/Checkpoint/chart/stories.md) |
| 27 | git-files | 同步或变基报错时，当前分支的提交历史保持同步前的样子。 | 需要确认产品规则 | [ErrorLeavesBranchUntouched](git-files/BaseSync/chart/stories.md) |
| 28 | git-files | 清理不会删掉检查之后才被置顶的会话。 | 模型与源码支持，尚未重放 | [NoTrashPinned](git-files/Storage/chart/stories.md) |
| 29 | git-files | 清理不会删掉检查之后才被启动的会话。 | 模型与源码支持，尚未重放 | [NoTrashStartedAfterCheck](git-files/Storage/chart/stories.md) |
| 30 | git-files | 清理不会删掉被终端里的 omp 占用的会话。 | 模型与源码支持，尚未重放 | [NoTrashTerminalHeld](git-files/Storage/chart/stories.md) |
| 31 | mobile | 网络恢复后横幅仍显示断开 | 真实入口已重放 | [BannerMatchesStream](mobile/MobileConn/chart/stories.md) |
| 32 | mobile | 离线事件覆盖未授权状态 | 真实入口已重放 | [UnauthorizedSticky](mobile/MobileConn/chart/stories.md) |
| 33 | mobile | 超时恢复输入不代表服务器未接收 | 真实入口已重放 | [RestoredMeansNotSent](mobile/MobilePrompt/chart/stories.md) |
| 34 | mobile | 超时后再次发送同一原文形成两个请求 | 真实入口已重放 | [NoDuplicatePrompt](mobile/MobilePrompt/chart/stories.md) |
| 35 | mobile | 全部允许请求不携带屏幕上的审批编号 | 真实入口已重放 | [BatchOnlyAnswersSeen](mobile/MobilePending/chart/stories.md) |
| 36 | mobile | 较旧快照晚到使已回答卡片复活 | 真实入口已重放 | [NoAnsweredCardShown](mobile/MobilePending/chart/stories.md) |
| 37 | mobile | 配对 GET 可被非手机访问消耗 | 模型与源码支持，尚未重放 | [OnlyPhonePairs](mobile/MobilePairing/chart/stories.md) |
| 38 | mobile | 前台查看状态未上报时仍可能推送 | 模型与源码支持，尚未重放 | [NoPushWhileViewing](mobile/MobilePairing/chart/stories.md) |
| 39 | mobile | 同一会话短时间的后续审批可能被去重 | 模型与源码支持，尚未重放 | [NoApprovalDropped](mobile/MobilePairing/chart/stories.md) |
| 40 | mobile | 停止服务后在途隧道仍能上线 | 模型与源码支持，尚未重放 | [TunnelNeedsServer](mobile/MobileInfra/chart/stories.md) |
| 41 | mobile | 并发启动可能遗留未登记隧道进程 | 模型与源码支持，尚未重放 | [NoOrphanTunnel](mobile/MobileInfra/chart/stories.md) |
| 42 | mobile | 运行时修改 DDNS 域名后证书可能不匹配 | 模型与源码支持，尚未重放 | [LinkCoveredByCert](mobile/MobileInfra/chart/stories.md) |
| 43 | model-settings | 已确认保存的新模板列表被更早的读取覆盖 | 真实入口已重放 | [MutationSurvives](model-settings/TemplateSnapshot/chart/stories.md) |
| 44 | privacy-providers | 再次选择替换旧历史仍保留旧范围 | 真实入口已重放 | [HistoryReplacedWhenAsked](privacy-providers/PrivacyScope/chart/stories.md) |
| 45 | privacy-providers | 哈希相同不证明进程曾加载隐私块 | 模型与源码支持，尚未重放 | [CompactionHasNativeCoverage](privacy-providers/PrivacyNative/chart/stories.md) |
| 46 | privacy-providers | 未填写新密钥时保存模式选择未生效 | 模型与源码支持，尚未重放 | [SavedModeMatchesChoice](privacy-providers/ProviderKeys/chart/stories.md) |
| 47 | privacy-providers | 配置修改成功而凭据清理失败可留下孤立密钥 | 模型与源码支持，尚未重放 | [NoOrphanVaultKey](privacy-providers/ProviderKeys/chart/stories.md) |
| 48 | privacy-providers | 返回列表后的迟到成功事件不会刷新供应商 | 真实入口已重放 | [PanelShowsSavedLogin](privacy-providers/OauthLogin/chart/stories.md) |
| 49 | privacy-providers | 启动未完成就取消可能留下后台登录进程 | 模型与源码支持，尚未重放 | [NoOrphanLogin](privacy-providers/OauthLogin/chart/stories.md) |
| 50 | automation | 已完成的一次性任务被改期后列表仍显示已完成，但调度器会再次触发 | 真实入口已重放 | [CompletedNeverScheduled](automation/ScheduleRuns/chart/stories.md) |
| 51 | automation | 手动运行可使已运行次数超过 max_runs | 需要确认产品规则 | [RunsWithinCap](automation/ScheduleRuns/chart/stories.md) |
| 52 | automation | 定时器与手动运行在检查与创建之间可并发产生两个运行 | 模型与源码支持，尚未重放 | [ActiveRunsAtMostOne](automation/ScheduleRuns/chart/stories.md) |
| 53 | automation | 任务被删除后已认领的运行仍写入 | 模型与源码支持，尚未重放 | [NoRunAfterDelete](automation/ScheduleRuns/chart/stories.md) |
| 54 | automation | 放入输入框发送成功但记录已派发失败时被静默吞掉，想法仍显示待处理 | 模型与源码支持，尚未重放 | [DeliveredIsRecorded](automation/IdeaLifecycle/chart/stories.md) |
| 55 | automation | 已结束想法从回收站恢复后，下次启动又被自动移回回收站 | 真实入口已重放 | [RestoredStaysRestored](automation/IdeaLifecycle/chart/stories.md) |
| 56 | automation | 通知策略“不放入收件箱”仍有会话条目 | 需要确认产品规则 | [NoneMeansNothingInInbox](automation/InboxVisibility/chart/stories.md) |
| 57 | automation | “仅重要时提醒”下顺利完成的运行仍有会话条目 | 需要确认产品规则 | [ImportantOnlyWhenNeeded](automation/InboxVisibility/chart/stories.md) |
| 58 | automation | 同一运行同时出现会话条目与结果待办 | 需要确认产品规则 | [OneEntryPerRun](automation/InboxVisibility/chart/stories.md) |
| 59 | automation | 会话列表刷新重置诊断对话框里用户已改的提示词与选择 | 模型与源码支持，尚未重放 | [UserWorkPreserved](automation/DiagnoseDialog/chart/stories.md) |
| 60 | automation | 刷新把发送中状态清零，可重复发送诊断 | 模型与源码支持，尚未重放 | [SentAtMostOnce](automation/DiagnoseDialog/chart/stories.md) |
| 61 | automation | 自动诊断失败的会话每分钟被重试 | 真实入口已重放 | [FailedNotRetried](automation/AiDoctor/chart/stories.md) |
| 62 | automation | 失败较新会话的重复重试可持续阻挡较旧会话（有界观察与条件性推论） | 真实入口已重放 | [NoStarvation](automation/AiDoctor/chart/stories.md) |
| 63 | terminal-services | 启动响应前退出事件被消费，响应后标签持续显示运行中 | 真实入口已重放 | [ReadyMeansAlive](terminal-services/DrawerTerminal/chart/stories.md) |
| 64 | terminal-services | 启动失败后重试不触发新启动 | 真实入口已重放 | [OpeningMakesProgress](terminal-services/DrawerTerminal/chart/stories.md) |
| 65 | terminal-services | 启动响应前的数据被桥丢弃 | 真实入口已重放 | [OutputNotLost](terminal-services/DrawerTerminal/chart/stories.md) |
| 66 | terminal-services | 退出发生在会话登记之前可留下已死终端登记 | 模型与源码支持，尚未重放 | [RecordMeansAlive](terminal-services/SessionTerminal/chart/stories.md) |
| 67 | terminal-services | 会话删除与终端登记交错可遗留进程 | 模型与源码支持，尚未重放 | [DeletedSessionHasNoTerminal](terminal-services/SessionTerminal/chart/stories.md) |
| 68 | terminal-services | 较早请求晚返回覆盖当前开关列表 | 模型与源码支持，尚未重放 | [RowsMatchToggle](terminal-services/ServicesPanelPoll/chart/stories.md) |
| 69 | terminal-services | 成功保存的内容可能不是最后落盘内容，即使另一次保存报错 | 真实入口已重放 | [SuccessIsWhatLanded](terminal-services/FileWriteRace/chart/stories.md) |
| 70 | terminal-services | 报错的保存仍可能覆盖文件 | 真实入口已重放 | [FailedSaveDidNotLand](terminal-services/FileWriteRace/chart/stories.md) |
| 71 | terminal-services | 同毫秒同名缓存文件覆盖早先附件字节 | 真实入口已重放 | [EachAttachmentKeepsItsBytes](terminal-services/ClipboardNameCollision/chart/stories.md) |
| 72 | shell | 侧栏收起时打开其他空间的会话,重新展开后空间不跟随 | 真实入口已重放 | [SpaceMatchesSelection](shell/SpaceFollow/chart/stories.md) |
| 73 | shell | 首条消息发送期间打开设置,完成后落到空白起始页而非新会话 | 真实入口已重放 | [SendShowsSession](shell/DraftHandoff/chart/stories.md) |
| 74 | shell | 分支草稿开着时新建会话,中间区仍显示分支草稿 | 真实入口已重放 | [NewSessionVisible](shell/CenterPane/chart/stories.md) |
| 75 | shell | 会话列表加载期间打开设置/收件箱,启动恢复抢走页面 | 真实入口已重放 | [RestoreKeepsUserPage](shell/StartupRestore/chart/stories.md) |
| 76 | settings-skills | 保存或重新读取进行时输入的文字会被结果覆盖 | 真实入口已重放 | [TypedTextKept](settings-skills/FileEditorBuffer/chart/stories.md) |
| 77 | settings-skills | 切换项目后旧项目的插件目录晚到并覆盖新项目 | 真实入口已重放 | [PluginsMatchProject](settings-skills/PluginsCatalogLoad/chart/stories.md) |
| 78 | settings-skills | 切换记忆项目后旧项目文件列表晚到并覆盖 | 真实入口已重放 | [MemoryListMatchesProject](settings-skills/MemoryFilesLoad/chart/stories.md) |
| 79 | settings-skills | omp config list 失败(found=false)时切换技能会用空列表整体覆盖 disabledExtensions | 模型与源码支持，尚未重放 | [OtherEntriesKept](settings-skills/OmpListReadModifyWrite/chart/stories.md) |
| 80 | settings-skills | 启用 .disabled 扩展时重命名失败：界面回滚为已禁用，但配置里已被改为启用 | 真实入口已重放 | [UiMatchesConfigAfterFailure](settings-skills/ExtensionEnableRollback/chart/stories.md) |
| 81 | settings-skills | 取消点击早于后端登记安装时被后端当成空操作，随后安装仍成功 | 模型与源码支持，尚未重放 | [CancelHonored](settings-skills/OmpInstallCancel/chart/stories.md) |
| 82 | settings-skills | 更新成功后，更新前发出的检查结果晚到，仍显示有可用更新 | 真实入口已重放 | [NoStaleUpdateBadge](settings-skills/OmpUpdateCheck/chart/stories.md) |
| 83 | settings-skills | MCP 编辑弹窗打开时，目录重读发现服务器已被外部删除，弹窗无提示地消失（状态仍是 edit） | 需要确认产品规则 | [EditorVisibleWhenOpen](settings-skills/McpEditorDialog/chart/stories.md) |
| 84 | settings-skills | MCP空目录的添加入口绕过父 busy，保存中关闭弹窗再打开新弹窗可同时发出两次写入 | 真实入口已重放 | [SingleWriter](settings-skills/McpWriteOwnership/chart/stories.md) |

## 验证与限制

- [完整报告](REPORT.md)：源码覆盖清单、证据、有限边界和既有产品检查失败。
- [再生成命令](README.md#regenerating)：全部计算在外部临时目录运行；任何新增规则破坏或类型错误都会失败。
- [机器可读清单](manifest.json)：来源基线、文件哈希、模型和检验记录。
- 未启动真实提供商请求、安装、发布或原生服务；没有更改用户配置或真实会话。
- 独立复审请求遇到账户限流，未执行；不把派发成功或计划中的检查当作已完成证据。
