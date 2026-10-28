# SettingsSkillsAudit 结果

基线：`7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`。产品代码只读，本目录之外零改动。本次不是整个程序的验证，只是下面“覆盖清单”里标为 modeled 的流程的有限抽象。

## 本次完成了
- 9 个有界 TLA+ 模型（TLC 1.7.4），每个都有 Mermaid 图、PNG（逐张用 read 打开过）、`stories.md`、`summary.json`、TLC 日志。
- 每个动作的每个条件旁都有 `文件:行号` 注释；`uncitedConditions` 对全部 11 个 .tla 返回 `[]`（`citecheck.log`）。OmpUpdateCheck 的检查请求读版本时机标为 `[INFERENCE]`；MCP 模型不再含推断 busy 守卫。
- 8 条违规都对应一个重放用例（`replay/settings.replay.test.tsx`，导入真实仓库模块，只在 Tauri IPC/opener/dialogs/toast/CodeMirror 控件边界放替身）。重放一次，9 个用例全部按预期失败，即 9 个断言复现了可疑问题（其中 FileEditor 有 2 个用例）。

## 本次未完成
- 覆盖清单里 `out-of-model` 与 `read-only` 的部分（子代理文件创建、应用自动更新、提示词组成、存储/关于分区、settings_mcp/plugins/skills 的 Rust 文件格式与原子性、SkillsPage、设置页壳）没有建模，也没有声明它们没问题。
- 没有运行真实 Rust 命令、真实 omp、真实安装/更新；OmpInstallCancel 的后端行为只是按 `omp_install.rs:366-374` 写的替身。
- 没有跑完整测试、构建、格式化。

## 模型清单（数字取自各自 summary.json）
| 模型 | 模型状态 | 模型迁移 | 图状态 | 图迁移 | 输出 |
|---|---|---|---|---|---|
| FileEditorBuffer | 450 | 1101 | 19 | 19 | `out/FileEditorBuffer` |
| PluginsCatalogLoad | 17 | 36 | 7 | 17 | `out/PluginsCatalogLoad` |
| MemoryFilesLoad | 17 | 36 | 7 | 17 | `out/MemoryFilesLoad` |
| OmpListReadModifyWrite | 10 | 14 | 6 | 8 | `out/OmpListReadModifyWrite` |
| ExtensionEnableRollback | 4 | 3 | 4 | 3 | `out/ExtensionEnableRollback` |
| OmpInstallCancel | 9 | 11 | 8 | 11 | `out/OmpInstallCancel` |
| OmpUpdateCheck | 20 | 40 | 12 | 29 | `out/OmpUpdateCheck` |
| McpEditorDialog | 4 | 6 | 4 | 6 | `out/McpEditorDialog` |

重新生成：见 `run.sh`（单个模型），每个模型的完整命令在 `result.json` 的 `models[].regenerate`。需要先导出 `TLA2TOOLS`、`JAVA`（主代理已就绪），`STATECHART=<HOME>/.agents/skills/statechart/scripts/statechart.mjs`。`PluginsCatalogLoad` 与 `MemoryFilesLoad` 用 `--fixed` 对照 `*Fixed.tla`。`FileEditorBuffer` 用 `--cover`，见 `out/FileEditorBuffer/summary.json` 的 `cover`。

## 模型边界（没有建模的东西）
- **FileEditorBuffer**：磁盘内容、文本均为整数编号；未建模 createContent、tooLarge、只读、预览页、草稿缓存跨挂载恢复、重试循环里的多次覆盖；编辑器模态确认框按完全模态处理；用 --cover 只画到每个稳定状态的最短路径。
- **PluginsCatalogLoad**：只有两个项目；没有建模 skillsList 的并行读取；Fixed 对照模型加入过期判断。
- **MemoryFilesLoad**：只有两个记忆项目；未建模 setRel(null)、文件选中与 FileEditor 挂载；Fixed 对照模型加入过期判断。
- **OmpListReadModifyWrite**：只建模“其他条目 A”与“被切换条目 B”；读取失败是非确定选择；未建模 configWriteChain 串行（skills/store.ts:115-139）与 PluginsSection 的 busy 串行，两者互相不串行是代码阅读结论，未建模。
- **ExtensionEnableRollback**：只建模启用 .disabled 扩展且重命名失败；未建模禁用分支和 revalidateCatalog。
- **OmpInstallCancel**：后端安装槽按 omp_install.rs 语义抽象；真实 Rust 命令未运行（不可启动安装）；未建模超时、窗口关闭、进度事件、recheck、自定义路径对话框。
- **OmpUpdateCheck**：checkSees 表示检查请求发出时的二进制版本，来自对 omp update 检查语义的假设 [INFERENCE]；未建模 autoUpdate 触发、外部更新处理 ompUpdateSessions。
- **McpEditorDialog**：仅父组件 dialog/allServers 的归属、目录重读与可见编辑器触发 onClose 的输入契约。完全排除写入、提交与编辑器内部控件。原 SingleWriter 通过结论撤回；最终由独立 McpWriteOwnership 保留同名原规则并检查，详情见下节。

## 发现（均为可疑缺陷，已按真实入口重放）
1. **TypedTextKept**（FileEditorBuffer）：保存或重新读取进行时输入的文字会被结果覆盖
   - 路径：点保存→继续输入→保存成功返回；或 点重新读取→继续输入→读取结果返回
   - 重放：reproduced: replay/settings.replay.test.tsx 两个 FileEditorBuffer 用例失败（Expected 'v2 + typed during save' Received 'v2'；Expected 'typed while reloading' Received 'v1'）
   - 源码：FileEditor.tsx:96-101,139-153 (setDraft(text)/apply 无视期间输入), :346 editable 仅看 readOnly, :274 重新读取仅 loading 时禁用
   - 修复模型：not modeled
2. **PluginsMatchProject**（PluginsCatalogLoad）：切换项目后旧项目的插件目录晚到并覆盖新项目
   - 路径：换项目→新项目返回→旧项目返回
   - 重放：reproduced: PluginsCatalogLoad 用例失败（页面出现 plugin-of-a）
   - 源码：PluginsSection.tsx:91-110 reload 无序号/取消保护（对比 McpSection.tsx:85-98）
   - 修复模型：modeled: PluginsCatalogLoadFixed 模型，stories.md 将越界状态标为 fixed
3. **MemoryListMatchesProject**（MemoryFilesLoad）：切换记忆项目后旧项目文件列表晚到并覆盖
   - 路径：换记忆项目→新项目返回→旧项目返回
   - 重放：reproduced: MemoryFilesLoad 用例失败（出现 other-project）
   - 源码：MemoryFilesPanel.tsx:212-230 refreshFiles 无过期判断；:235-239 load/save 用当前 slug
   - 修复模型：modeled: MemoryFilesLoadFixed 模型，同上
4. **OtherEntriesKept**（OmpListReadModifyWrite）：omp config list 失败(found=false)时切换技能会用空列表整体覆盖 disabledExtensions
   - 路径：点开关→读列表失败→写回新列表
   - 重放：reproduced at store entrypoint: setSkillEnabled 在 found=false 时仍调用 ompConfigSet('disabledExtensions','["skill:new-one"]')；磁盘上原有条目是否因此丢失取决于 omp config set 对真实文件的行为，未运行真实 omp [INFERENCE]
   - 源码：skills/store.ts:127-135; PluginsSection.tsx:64-72 忽略 list.found；settings.rs:704-708 失败返回 found=false 空 entries
   - 修复模型：not modeled
5. **UiMatchesConfigAfterFailure**（ExtensionEnableRollback）：启用 .disabled 扩展时重命名失败：界面回滚为已禁用，但配置里已被改为启用
   - 路径：点启用→配置写入成功→重命名失败→界面回滚
   - 重放：reproduced at store entrypoint: 失败后 catalog 回到 enabled=false 而 ompConfigSet 已把 ext-a 从 disabledExtensions 移除
   - 源码：skills/store.ts:463-488
   - 修复模型：not modeled
6. **CancelHonored**（OmpInstallCancel）：取消点击早于后端登记安装时被后端当成空操作，随后安装仍成功
   - 路径：点开始→点取消(监听尚未就绪)→监听就绪、安装开始→安装结束成功
   - 重放：partially reproduced: 真实 ompInstall store + 真实 ipc.ts/events.ts，仅在 Tauri invoke 边界放了按 omp_install.rs:366-374 语义写的替身后端；证明 UI 在 omp_install_run 之前就把取消发出，替身后端因此丢弃取消；后端空操作语义本身来自读代码与 omp_install.rs 的 single_flight_and_idle_cancel 测试，未运行真实 Rust
   - 源码：ompInstall.ts:68-96,113-115; omp_install.rs:89-98,366-374
   - 修复模型：not modeled
7. **NoStaleUpdateBadge**（OmpUpdateCheck）：更新成功后，更新前发出的检查结果晚到，仍显示有可用更新
   - 路径：开始检查→点更新→更新完成(自带复检因检查在途直接返回)→旧检查结果返回
   - 重放：reproduced at store entrypoint: runUpdate 成功后 status.updateAvailable 仍为 true；其中“旧检查返回旧版本结论”来自测试里让 ompUpdateCheck 延迟返回，真实后端是否如此需要真实 omp [INFERENCE]
   - 源码：ompUpdate.ts:66-72,105-134
   - 修复模型：not modeled
8. **EditorVisibleWhenOpen**（McpEditorDialog）：MCP 编辑弹窗打开时，目录重读发现服务器已被外部删除，弹窗无提示地消失（状态仍是 edit）
   - 路径：点编辑→服务器被外部删除后列表重读
   - 重放：reproduced: McpSection 用例失败（重读后 role=dialog 消失）；“服务器重新出现后弹窗是否自动弹回”由 dialog 状态仍为 edit 推知，未单独断言
   - 源码：McpSection.tsx:211 editing 由 allServers.find 派生、:400-409 渲染条件，dialog 状态不随之清理
   - 修复模型：not modeled

说明：失败的断言就是复现。`OmpInstallCancel` 的复现只证明“界面在后端登记之前就发出了取消”，后端丢弃取消这一半来自读码；`OmpUpdateCheck` 与 `OtherEntriesKept` 里依赖真实 omp 行为的那一半标为推断。

## 读码但未建模、未重放的观察
- `FileEditor.tsx:182-196` 的 `create()` 没有防重复点击，也没有设置 `saving`；`omp_files.rs write_checked` 在比较 stamp 与写入之间没有加锁。
- `PluginsSection.tsx updateOmpList` 与 `skills/store.ts updateOmpListSetting` 各自读改写同一个配置键，只有后者用 `configWriteChain` 串行；两个页面同时进行写入时可能互相覆盖，未重放。
- `stores/ompConfigStore.ts`：`invalidate()` 后的旧读取被丢弃，逻辑合理；`RawFilesDialog.tsx:131` 写后调用 `load(true)` 在同代有在途请求时会复用旧请求，仅读码。
- `visualize.rs`：`spawn_plugin_dir` 只检查 `plugin.json`；`SKILL.md` 写入失败时仍传 `--plugin-dir`，只读码。

## 验证命令与结果
- `node citecheck.mjs`：退出 0，全部 `[]`。
- 8 个模型的 `from-spec ... --png` 全部完成（日志 `logs_all.txt`、`logs_split.txt`、`logs_rerun.txt`、`logs_fe.txt` 与各自 `out/*/tlc/`）；`OmpUpdateCheck` 的输出在 `out/OmpUpdateCheck`。
- 重放：`cd repo && ./node_modules/.bin/vitest run --config <scratch>/settings-skills/replay/vitest.config.mjs`，退出 1，9 个用例失败（`replay/replay.log`）。

## 覆盖清单
| 路径 | 功能 | 状态 | 原因 |
|---|---|---|---|
| src/features/settings/FileEditor.tsx, fileEditorLogic.ts | 共享文件编辑器 | modeled | FileEditorBuffer；与 git-files 的通用缓冲区只在边界上接触 |
| src/features/settings/sections/RulesFilesSection.tsx, rulesFiles.ts | 规则文件编辑入口 | read-only | 经 FileEditor 复用；读了入口使用，未单独建模 |
| src/features/settings/sections/MemoryFilesPanel.tsx, memoryFiles.ts | 记忆文件列表/选择/编辑 | modeled | MemoryFilesLoad；删除技能时编辑草稿处理仅读码 |
| src/features/settings/sections/AgentDefsPanel.tsx, NewAgentForm.tsx, agentDefs.ts | 子代理定义文件编辑/创建 | out-of-model | 未读完，创建流程未审；仅通过 FileEditor 共享边界覆盖 |
| src/features/settings/McpSection.tsx, McpServerRow.tsx, McpServerEditor.tsx, McpImportDialog.tsx, McpScopeDialog.tsx, McpScopePicker.tsx, mcpDraft.ts, mcpImport.ts, mcpProjects.ts | MCP 目录/启停/删除/作用域/导入 | modeled | McpEditorDialog；McpSection reload 序号保护与写入忙碌读码确认；导入循环 run() 读码，未建模；McpServerEditor 内部草稿未审 |
| src/features/settings/PluginsSection.tsx, sections/PluginsSettingsSection.tsx | 插件目录/启停/扩展 | modeled | PluginsCatalogLoad、OmpListReadModifyWrite；plugin 开关与扩展删除读码，未建模 |
| src/features/skills/store.ts, SkillsPage.tsx | 技能目录/启停/扩展启用 | modeled | OmpListReadModifyWrite、ExtensionEnableRollback；loadCatalog/revalidateCatalog 序号保护读码确认；SkillsPage.tsx 未读 |
| src/features/omp-install/OmpInstallDialog.tsx + stores/ompInstall.ts + omp_install.rs | 安装内核与取消 | modeled | OmpInstallCancel；未安装、未启动进程 |
| stores/ompUpdate.ts | omp 更新检查/执行 | modeled | OmpUpdateCheck |
| stores/appUpdate.ts, ompUpdateSessions.ts, ompUpdateSchedule.ts | 应用自动更新/会话陈旧同步/定时 | out-of-model | 未建模；ompUpdateSessions 仅读到 ompUpdate.ts 的外部更新回调边界 |
| stores/promptComposition.ts, sections/PromptCompositionSection.tsx, prompt_composition.rs | 提示词组成探测 | out-of-model | 未读；归本 slice，需后续补审 |
| stores/modelCatalog.ts | 模型目录刷新 | read-only | 仅作为 ompInstall/ompUpdate 触发的 refresh 调用，所有权按 ModelSettings 交接 |
| src/features/settings/store.ts, useAppSettings.ts | 应用设置乐观更新与保存队列 | read-only | 读码：update() 使用 lastConfirmed 重基与 saveQueue；未发现已确认问题，未建模，未重放 |
| src/features/settings/ompConfigStore.ts, OmpSettingsList.tsx, RawFilesDialog.tsx | omp 配置目录 store 与列表 | read-only | ompConfigStore 的 generation/inflight 保护读码确认；RawFilesDialog 写后 load(true) 复用同代在途请求的可能性仅读码 [INFERENCE]，未建模 |
| src/features/settings/SettingsOverlay.tsx, SettingsPage.tsx, settingsNav.ts, navigation.ts, nestedModal.ts, settingsTargets.ts, SectionJumpBar.tsx | 设置页壳与导航 | out-of-model | 归 ShellNavigation 边界；仅读 SettingsOverlay |
| src/features/settings/sections/StorageSection.tsx, AboutSection.tsx, GeneralSection.tsx, AdvancedSection.tsx, SessionsSection.tsx, NotificationsSection.tsx, InboxSection.tsx, MobileSettingsSection.tsx, AppearanceSection.tsx, ShortcutsSection.tsx, GuideSection.tsx, ContextWindowSection.tsx, FallbackSection.tsx, RolesSection.tsx | 其余设置分区 | out-of-model | 未审；存储/关于含自动更新入口，需后续补审 |
| src/features/settings/model*/, ModelRulesSection, AgentModelAssignmentsPanel, FallbackChain*, AutoCompactionCard, SideChatModelCard, sections/ProvidersSection.tsx, PrivacySection.tsx | 模型/提供商/隐私设置 | out-of-model | 归 ModelSettingsAudit / PrivacyProvidersAudit |
| src-tauri/src/settings.rs | 设置保存、omp config、omp 信息/更新命令 | read-only | 读了 omp_config_list/set 与错误返回；其余未审 |
| src-tauri/src/settings_mcp.rs | MCP 配置读写命令 | out-of-model | 仅读命令列表；文件格式与写入原子性未审 |
| src-tauri/src/settings_plugins.rs | 插件命令 | out-of-model | 仅读命令列表 |
| src-tauri/src/skills/* | 技能目录命令 | out-of-model | 仅读命令列表 |
| src-tauri/src/omp_files.rs | 规则/记忆/子代理文件读写 | read-only | write_checked 比较 stamp 后写（无锁，检查与写之间的 TOCTOU 仅读码） |
| src-tauri/src/visualize.rs + resources/plugins/omp-workspace-visualize | 内置 visualize 插件安装与启停 | read-only | 读码：启动时 write_if_changed 写 plugin.json 与 SKILL.md；spawn_plugin_dir 只检查 plugin.json 存在，SKILL.md 写失败时仍传 --plugin-dir（读码观察，未重放）；visualizeEnabled 只影响新建会话 |

## 目录说明
`models/` TLA+/cfg/map；`out/<模型>/` chart.mmd、bug-N.mmd、PNG、stories.md、summary.json、tlc/；`replay/` 重放测试及配置（`settings.replay.tpl` 为模板，`@R@` 替换为仓库 src 绝对路径；`node_modules` 为指向仓库的符号链接）；`mkmap.py`、`build_result.py`、`run.sh`、`citecheck.mjs` 为生成辅助脚本。

## 附加说明
- 失败的重放用例是复现证据，不是验收失败。
- 模型里的修复只出现在 PluginsCatalogLoadFixed / MemoryFilesLoadFixed，只说明那种修法在模型里满足规则，不代表产品已修复。
- 附带的读码观察已放入 result.json 的 `implementationFindings`。
- EditorVisibleWhenOpen 归类为 design question（弹窗静默消失是否算缺陷由产品决定）；CancelHonored 与 OmpUpdateCheck 的真实后端半边未运行。

## 证据口径更正
- OtherEntriesKept：已重放的只是前端在失败读取后无条件下发空列表基础的写入；持久丢失与真实 CLI 行为未验证（外部边界），整体归类 trace-and-source-only hypothesis。
- NoStaleUpdateBadge：在构造的合法异步顺序下复现了前端陈旧响应归属；真实 CLI/版本探测未执行。
- CancelHonored：前端 + 读码的部分证据；EditorVisibleWhenOpen 保持 design question。

## MCP 模型纠正（最终有效）
仅父组件 dialog/allServers 的归属、目录重读与可见编辑器触发 onClose 的输入契约。完全排除写入、提交与编辑器内部控件。原 SingleWriter 通过结论撤回；最终由独立 McpWriteOwnership 保留同名原规则并检查，详情见下节。
- 删除了错误 conflation 的写入变量和动作，CloseEditor 只表达 McpSection.tsx:400-407 可见子组件的 onClose 输入契约，不声称按钮可随意触发。EditorVisibleWhenOpen 原规则保持不变。
- 重新生成仅此模型：4 状态、6 迁移、1 条反例；退出码 1 表示 TLC 发现期望的设计问题反例。新的 overview 与 bug-1 PNG 均已打开检查。没有重跑其他重放。

## MCP写入归属补充（最终结论，替代先前 OPEN 状态）
- 保留纠正后的 McpEditorDialog 父弹窗生命周期模型，另增 McpWriteOwnership，原 SingleWriter 规则不改。实际读取了 McpServerEditor.save/关闭按钮、McpImportDialog.run/关闭按钮、共享 Button loading disabled 和父组件所有入口。
- 父 busy 只守住 act 与主添加/导入按钮；空目录卡片的添加/导入没有 disabled=busy。子组件保存态只属于当前挂载实例；关闭按钮不禁用保存态，也没有取消请求；新实例 saving=false，submitEditor 不检查父 busy。
- TLC：19 模型状态、29 迁移、5 状态违反 SingleWriter，2 类反例（保存后关闭→新编辑保存；保存后关闭→导入）。overview 与两张反例 PNG 都已打开检查。
- 新增真实入口重放 replay/mcp-ownership.replay.test.tsx，只运行这1个用例，未重跑其他用例。结果：期望 mcpServerSave 1 次、实际 2 次，两个请求都未返回。这是复现证据，不是验收失败；原生持久化后果未验证。原输出 artifact://588。
- 仅重复编辑分支已重放；编辑→导入分支仍是模型+源码证据。
- 模型边界：两次写入均尚未返回的有限前缀（writes<2 为探索上限，不是产品守卫）；合法草稿/合法非空导入输入；目录固定为空或非空；不建模完成、失败恢复、真实 Rust 持久化或同一渲染批次多次点击。包含 parent act、editor.save 与 import.run 的各自实际入口守卫。子组件关闭不会取消在途请求。

## 严格再生成命令
所有 `models[].regenerate` 与 `run.sh` 均明确指定唯一已知失败符号 `--expect-broken <规则名>`；不会把任意退出码1都视为成功，也不接受额外违规。仅元数据/脚本更新，没有再次运行 TLC。
