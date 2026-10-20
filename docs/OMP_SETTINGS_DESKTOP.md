# OMP 设置（桌面端）维护文档

本文面向维护者，说明设置页 omp 配置键的放置与可见性规则、模型角色与回退链编辑器的行为，以及 omp 升级后的同步步骤。实现代码集中在 `src/features/settings/`。

## 1. 背景与目标

桌面端以 `omp --mode rpc` 运行 omp（见 `docs/ARCHITECTURE.md` §7 的 `rpc_*` 命令族），全程无终端 UI。设置页此前直接镜像 omp TUI `/settings` 面板的标签页，并把键按 8 个类目堆成扁平列表，大量只影响终端渲染与交互的键（主题、状态栏、输入框、键位……）成为噪音，也难以找到想改的东西。

现在设置页**按用户意图组织**（导航见 `docs/ARCHITECTURE.md` §11 D），omp 配置键由 `ompPlacement.ts` 一处定义「键 → 桌面页面 / 小节」，并按三类处理：

- **桌面相关**：影响 agent 核心 / RPC 行为的键，放入对应桌面页面的小节展示（§3）。
- **TUI 专用**：只影响终端界面的键，整组隐藏（§2）。
- **模型角色与回退链**：`modelRoles`、`task.agentModelOverrides` 与 `retry.fallbackChains` 及六个回退开关键（`retry.modelFallback`、`retry.fallbackOn`、`retry.fallbackRevertPolicy`、`retry.usageAwareFallback`、`retry.usageReservePct`、`retry.usageReservePolicy`）由专用页「模型角色」「备用模型与重试」维护（§4）。

同时与 TUI 保持可对照的线索：只给已修改的行做标记（圆点 + tooltip 里的默认值 + 重置）；TUI 的 ⚠ 警告原样保留；TUI 里条件可见的键同样条件可见并给出提示；导航按页显示已修改数量；小节标题带 TUI 分组名；搜索同时匹配中文、英文 TUI 标签与配置键。

## 2. 可见性规则

判定规则：**影响 agent 核心或 RPC 行为的键展示；只影响终端 UI 渲染/交互的键隐藏**。隐藏 ≠ 删除——这些键的值原样保留在 `~/.omp/agent/config.yml`，TUI 里照常生效，只是不占用桌面端界面。

实现见 `src/features/settings/ompPlacement.ts`：`isDesktopRelevant(key)` 对隐藏键与专用编辑器键返回 `false`。

- **隐藏前缀**（`HIDDEN_PREFIXES`）：`theme.` `statusLine.` `composer.` `tui.` `display.` `terminal.` `startup.` `keybindings.` `paste.` `speech.` `stt.` `live.` `spelling.` `loop.` `gc.` `stream.` `collab.` `recap.` `commit.`
- **隐藏精确键**（`HIDDEN_KEYS`）：`symbolPreset` `colorBlindMode` `showHardwareCursor` `autocompleteMaxVisible` `emojiAutocomplete` `doubleEscapeAction` `treeFilterMode` `autoResume` `completion.notify` `error.notify` `read.toolResultPreview` `setupVersion` `hideThinkingBlock` `proseOnlyThinking` `expandThinkingBlocks` `branchSummary.enabled` `branchSummary.reserveTokens` `ask.notify` `git.enabled` `goal.statusInFooter` `read.renderMarkdown` `mcp.renderMarkdownResults` `task.showResolvedModelBadge` `tasks.todoClearDelay` `dev.autoqaConsent` `input.bareExitOnEmptySession` `input.bareSlashCommands` `worktree.onStart` `worktree.onExit` `memories.enabled` `tools.approvalMode`
- **专用编辑器键**（`EDITOR_KEYS` / `EDITOR_PREFIXES`，不进入通用行）：`modelRoles` `task.agentModelOverrides` `retry.fallbackChains` `retry.modelFallback` `retry.fallbackOn` `retry.fallbackRevertPolicy` `retry.usageAwareFallback` `retry.usageReservePct` `retry.usageReservePolicy` `cycleOrder` `modelRoleStorage` `extendedContext`，前缀 `compaction.` `contextPromotion.`。它们分别由「模型角色」「备用模型与重试」「上下文窗口」页维护（§4）。
- **放出的键**（旧版误隐藏）：`readLineNumbers`（改变模型可见的读取文本）、`shellMinimizer.*`（作用于 bash 工具）、`ttsr.*`（构建系统提示与会话判定时读取）。

证据摘要（对照 omp 18.8.0 源码与 18.12.2 二进制，共 557 个键）：

- 桌面启动命令是 `omp --mode rpc --approval-mode <m> --cwd <dir>`（`src-tauri/src/rpc/process.rs`），不是 `rpc-ui`，因此 `hasUI=false`、`tuiTranscript=false`；仅在交互 / TUI 路径读取的键（状态栏、`/loop`、协作、空闲回顾、分支摘要弹窗、通知等）在桌面无效，故隐藏。`/loop`、`/collab` 只有 `handleTui`，RPC 不执行。
- `gc.` / `stream.` / `commit.` 只被 `omp gc` / `omp stream`、`omp clip` / `omp commit` 这类 CLI 命令读取，桌面从不调用。
- `share.*` 与 `update.channel` **保留**：桌面「分享链接」运行 `omp share`，版本更新运行 `omp update` / `omp update --check`，它们都会读取这些键。
- `tools.approvalMode` 隐藏：桌面每次启动都传 `--approval-mode`，omp 把它作为运行时覆盖，配置值对桌面会话无效；真正的控制是「通用 ▸ 默认审批模式」。
- `dev.autoqaConsent` 是同意流程写入的状态值，按策略隐藏；`memories.enabled` 已被 `memory.backend` 取代；`worktree.onStart/onExit` 只在交互模式生效（RPC 固定为 `off` / `keep`）。
- 保留但存疑：`commands.enableClaudeProject` 等四个命令来源开关（RPC 会合并可用命令）、`marketplace.autoUpdate`（RPC 下也会运行，放在「插件」页）、`worktree.cleanSource`（`/wt` 在 RPC 可用）、`dev.autoqa*`。

## 3. 页面与小节放置

每个桌面相关键在 `ompPlacement.ts` 的 `RULES` 表里恰好属于一个小节（`ompSectionFor(key)`）：先按 `exact` 精确匹配（顺序即显示顺序），再按最长 `prefixes` 匹配；`*.enabled` 形式的工具开关归入 `tools.available`；都未命中则落入兜底 `advanced.other`。小节标题旁以灰字显示 TUI 分组名（`tui` 列）。

| 小节 id | 页面 | 标题 | TUI 组 | 匹配规则 |
|---|---|---|---|---|
| `general.system` | `general` | 系统 | Power | `power.sleepPrevention` |
| `privacy.omp` | `privacy` | 密钥脱敏与数据上报 | Privacy | `secrets.enabled` `telemetry.otlpExportEnabled` |
| `about.update` | `about` | omp 更新 | Startup & Updates | `update.channel` |
| `providers.catalog` | `providers`（slot `keys`） | 启用的模型与供应商 | Model | `enabledModels` `enabledProviders` `disabledProviders` `modelProviderOrder` `modelTags` `modelPresets` |
| `providers.advanced` | `providers`（slot `keys`） | 供应商高级选项 | Protocol | 一批 `providers.*` 精确键（端点、并发、WebSocket、缓存等）；前缀 `providers.` `provider.` `auth.` |
| `providers.resets` | `providers`（slot `quota`） | 额度用完时自动兑换 | Services | `codexResets.` `claudeResets.` |
| `thinking.level` | `thinking` | 思考 | Thinking | `defaultThinkingLevel` `providers.autoThinkingMaxEffort` `externalThinking` `omitThinking` `thinkingBudgets.` |
| `thinking.sampling` | `thinking` | 采样参数 | Sampling | `temperature` `topP` `topK` `minP` `presencePenalty` `repetitionPenalty` |
| `thinking.style` | `thinking` | 回复风格 | Prompt | `personality` `textVerbosity` |
| `thinking.tier` | `thinking` | 服务等级 | Sampling | `tier.` |
| `helper.advisor` | `helper-models` | 顾问模型 | Advisor | `advisor.` |
| `helper.prewalk` | `helper-models` | 预探 | Prewalk | `prewalk.` |
| `helper.images` | `helper-models` | 图片与识图 | Vision | `images.` |
| `helper.tiny` | `helper-models` | 本地小模型 | Tiny Model | `providers.tinyModelDevice` `providers.tinyModelDtype` |
| `fallback.retry` | `model-fallback` | 重试 | Retry & Fallback | `providers.anthropic.serverSideFallback` `retry.` |
| `fallback.timeouts` | `model-fallback` | 超时与并发 | Timeouts | `providers.streamFirstEventTimeoutSeconds` `providers.streamIdleTimeoutSeconds` `providers.maxInFlightRequests` |
| `fallback.guard` | `model-fallback` | 防死循环与意外停止 | Thinking | `features.unexpectedStopDetection` `model.loopGuard.` `model.toolCallLoopGuard.` |
| `context.snapcompact` | `context-window` | 实验：快照压缩 | Experimental | `snapcompact.` |
| `sessions.queue` | `sessions` | 消息排队与打断 | Input | `steeringMode` `followUpMode` `interruptMode` |
| `sessions.ask` | `sessions` | AI 提问 | Notifications | `ask.enabled` `ask.timeout` |
| `sessions.modes` | `sessions` | 计划与目标模式 | Modes | `plan.` `goal.` |
| `sessions.keywords` | `sessions` | 魔法关键词 | Magic Keywords | `magicKeywords.` |
| `sessions.title` | `sessions` | 会话标题 | Modes | `title.` |
| `sessions.share` | `sessions` | 分享 | Collab | `share.` |
| `rules.ttsr` | `agents-md` | 实时规则（TTSR） | Rules (TTSR) | `ttsr.` |
| `prompt.contents` | `prompt-composition` | 提示词包含的内容 | Prompt | `includeModelInPrompt` `includeWorkspaceTree` `inlineToolDescriptors` `skillful` `contextFiles.` `workspace.` |
| `tools.available` | `tools` | 可用工具 | Available Tools | 一批工具 `*.enabled` 开关（`astEdit` `astGrep` `checkpoint` `debug` `find` `glob` `grep` `launch` `security` `vault` 等） |
| `tools.approval` | `tools` | 工具审批规则 | Approvals | `tools.approval` |
| `tools.todo` | `tools` | 待办 | Todos | `todo.` |
| `tools.search` | `tools` | 代码搜索 | Grep & Browser | `grep.` `astGrep.` |
| `tools.browser` | `tools` | 浏览器 | Grep & Browser | `browser.` |
| `tools.computer` | `tools` | 电脑操控 | Computer | `computer.` |
| `tools.speech` | `tools` | 语音生成 | Services | `speechgen.` `tts.` |
| `tools.github` | `tools` | GitHub | GitHub | `github.` |
| `tools.ida` | `tools` | IDA Pro | IDA Pro | `ida.` |
| `tools.output` | `tools` | 输出长度限制 | Output Limits | `tools.artifact*` `tools.outputMaxColumns` |
| `tools.execution` | `tools` | 执行方式 | Execution | `images.questionTimeoutMs` `tools.abortOnFabricatedResult` `tools.intentTracing` `tools.maxTimeout` `tools.format` `async.` `tools.speculativeExecution.` |
| `tools.other` | `tools` | 其他工具设置 | Available Tools | `tools.` |
| `files.edit` | `files` | 编辑 | Editing | `edit.` |
| `files.read` | `files` | 读取 | Reading | `readLineNumbers` `read.` |
| `files.summary` | `files` | 读取摘要 | Read Summaries | `read.summarize.` |
| `files.lsp` | `files` | 代码诊断（LSP） | LSP | `lsp.` |
| `shell.bash` | `shell` | Bash | Bash | `shellPath` `bash.` `bashInterceptor.` |
| `shell.minimizer` | `shell` | 命令输出精简 | Bash | `shellMinimizer.` |
| `shell.eval` | `shell` | 代码运行 | Eval & Runtimes | `eval.` `python.` |
| `subagents.behavior` | `subagents` | 子代理 | Subagents | `task.` `tasks.` |
| `subagents.isolation` | `subagents` | 隔离与工作树 | Isolation | `task.isolation.` `isolation.` `worktree.` |
| `memory.general` | `memory` | 记忆 | General | `memory.backend` |
| `memory.autolearn` | `memory` | 自主学习 | Auto-Learn | `autolearn.` |
| `memory.local` | `memory` | 本地记忆参数 | General | `memories.` |
| `memory.hindsight` | `memory` | Hindsight | Hindsight | `hindsight.` |
| `memory.mnemopi` | `memory` | Mnemopi | Mnemopi | `mnemopi.` |
| `memory.sharpshooter` | `memory` | Sharpshooter | Sharpshooter | `sharpshooter.` |
| `skills.skills` | `skills` | 技能 | Skills | `skills.` |
| `skills.commands` | `skills` | 自定义命令 | Commands & Skills | `commands.` |
| `mcp.runtime` | `mcp` | MCP 运行参数 | Discovery & MCP | `mcp.` |
| `mcp.xdev` | `mcp` | 工具设备（xd://） | Discovery & MCP | `tools.xdev` `tools.xdevDocs` `tools.xdevInlineDevices` |
| `plugins.extensions` | `plugins` | 扩展 | Extensions | `extensions` `disabledExtensions` `marketplace.autoUpdate` `extensionHandlers.` |
| `web.tools` | `web` | 联网工具 | Available Tools | `web_search.enabled` `fetch.enabled` `providers.fetch` `providers.webSearchTimeoutSeconds` |
| `web.exa` | `web` | Exa | Services | `exa.` |
| `web.searxng` | `web` | SearXNG | Services | `searxng.` |
| `advanced.autoqa` | `advanced` | 问题自动上报 | Developer | `dev.` |
| `advanced.other` | `advanced` | 其他（兜底） | — | 其余桌面相关键；`ompPlacement.test.ts` 保证不应有桌面相关键落在这里 |

桌面页面与承载的小节（`ompSectionsForPage(page)`；页面 id 即导航 id，仅 `OmpHostPage` 中的页面承载 omp 键）：

- 通用 `general`：`general.system`；隐私 `privacy`：`privacy.omp`；版本与更新 `about`：`about.update`。
- 模型与供应商 `providers`：`providers.catalog`、`providers.advanced`（子页 `keys`），`providers.resets`（子页 `quota`）。
- 思考与采样 `thinking`：`thinking.*`；辅助模型 `helper-models`：`helper.*`；备用模型与重试 `model-fallback`：`fallback.*`；上下文窗口 `context-window`：`context.snapcompact`。
- 会话 `sessions`：`sessions.*`；规则文件 AGENTS.md `agents-md`：`rules.ttsr`；系统提示词构成 `prompt-composition`：`prompt.contents`。
- 工具 `tools`：`tools.*`；文件读写 `files`：`files.*`；命令行 `shell`：`shell.*`；子代理 `subagents`：`subagents.*`；记忆 `memory`：`memory.*`；技能与命令 `skills`：`skills.*`。
- MCP 服务器 `mcp`：`mcp.*`；插件 `plugins`：`plugins.extensions`；联网搜索 `web`：`web.*`。
- 高级 `advanced`：`advanced.autoqa`、`advanced.other`。

**条件可见**（`ompConditionMet` / `ompConditionHint`，取 omp 的 `ui.condition`，缺失时按键族推断；未设置的值按 `ompConfigDefaults.ts` 默认值求值，条件不满足时该行隐藏并显示中文提示）：`advisor.*` 需 `advisor.enabled`；`hindsight.*` / `mnemopi.*` / `sharpshooter.*` / `memories.*` 需 `memory.backend` 为对应后端；`autolearn.*` 需 `autolearn.enabled`；`providers.autoThinkingMaxEffort` 需 `defaultThinkingLevel=auto`；`retry.usage*` 相关行需 `retry.usageAwareFallback`；`plan.*` 需 `plan.enabled`，`plan.autosaveDir` 另需 `plan.autosave`。纯终端能力 / 平台 / 来源条件（`macOS`、`hasImageProtocol`、`nativeRendering`、`contextFilesExtraNotProject`）在桌面恒视为满足。

**对齐 TUI 的提示**：只有已修改（与默认不同）的行才标记——圆点、tooltip 内的默认值与重置按钮；带 `ui.warning` 的键显示 ⚠；每行可显示该键在终端 `/settings` 里的位置（`ompTuiLocation`，如「终端 /settings › Model › Thinking · Default Thinking Level」）；导航按页显示已修改数量（`modifiedCountsByPage`）；搜索匹配键名、中文标题、英文 TUI 标签、中文描述、小节标题与 TUI 组名（`ompSearchTerms`）。

导航「模型」组中，`模型角色`（`omp-roles`）与 `备用模型与重试`（`model-fallback`）含专用页面（§4）；`modelRoles`、`task.agentModelOverrides`、`retry.fallbackChains`、六个回退开关键、`cycleOrder`、`modelRoleStorage` 不出现在通用行里。

## 4. 模型角色与回退链

导航「模型」组里有两个独立页面，各自只写一类键：

- **模型角色**（`omp-roles`）：`AgentModelAssignmentsPanel.tsx` 渲染，只读写 `modelRoles.*` 与 `task.agentModelOverrides.*`。
- **备用模型与重试**（`model-fallback`）：`FallbackChainsSection.tsx` 渲染回退链，读写 `retry.fallbackChains.*`、`cycleOrder`、`modelRoleStorage`；顶部的 `FallbackSwitchesCard.tsx` 读写六个回退开关键（`retry.modelFallback` 总开关、`retry.fallbackOn`、`retry.fallbackRevertPolicy`、`retry.usageAwareFallback`、`retry.usageReservePct`、`retry.usageReservePolicy`），均为标量键，用 `omp config set <key> <value>` 即时保存。同页还承载三个普通小节（`fallback.retry` 重试、`fallback.timeouts` 超时与并发、`fallback.guard` 防死循环与意外停止，见 §3），由 `ompPlacement.ts` 放置，不属于本节的专用编辑器。

### 4.1 模型角色

- **读写通道**：`omp_model_roles_read` / `omp_model_roles_set`（`src/lib/ipc.ts` → `settings_model_roles.rs`）。前端不读取配置原文，也不整体重写任何 record。Rust 侧用保格式 YAML AST 只修改单个键，原子保存，符号链接写穿并保留权限；无法安全处理的结构直接拒绝写入。错误信息不含配置原文或密钥片段。
- **读写边界**：写入 IPC 的 `table` 只接受 `modelRoles` 与 `agentModelOverrides`（即 `task.agentModelOverrides`）两张表。快照只投影这两个键，同一配置文件中的其它键不返回、不记录；写入前后只在内存中比对其它键，以证明本次编辑没有触及它们。
- **代理发现的窄读取**：除两张模型表外，经用户批准，仅读取发现所需的扩展路径（`extensions`）、提供者启用名单（`enabledProviders` / `disabledProviders`）、插件注册表与 Claude `enabledPlugins` 布尔开关，并读取代理 Markdown 文件。其它配置内容与密钥不回传、不记录。
- **发现设置只读**：上述扩展路径、启用名单、插件开关均不会被本页面修改；`--extension`、`--plugin-dir` 等命令行临时根目录不属于持久配置，本页面不猜测其他进程的临时参数。
- **作用范围**：全局写 `~/.omp/agent/config.yml`（只有 `config.yaml` 存在时写 `config.yaml`）；项目写所选项目的 `<cwd>/.omp/config.yml`。页面顶部「全局 | 项目」Tab 一次只显示一个范围，**每次进入页面默认全局，不跟随当前会话**；全局读取传 `cwd = null`，因此不会混入任何项目层。切到「项目」时**默认选中当前会话所在项目**（没有会话时用第一个已注册 workspace），不得停在「未选择」；用户可改选任一已注册 workspace，所选项目在页面内保持。只有一个项目都没有时才显示引导，不渲染表格、不写任何项目配置。切换范围/项目后只显示对应快照，过期读写响应不会覆盖当前视图。
- **体验契约（用户纠正记录）**：①只有一张「角色分配」表——内置聊天角色、自定义角色、发现的子智能体、服务类角色按此顺序排在同一张表里，不再有单独的代理结果卡片或「高级：点名表」；②收起行只显示名字、最终模型、`@来源角色`、思考级别（项目范围另显示「继承全局」），前三层都没有值时显示「跟随当前会话 → 模型」；中文用途小字（如「轻量后台」）收起时不显示，展开后才出现；③每行展开后是「专属模型」与「复用角色模型」两种方式（不带序号，正在使用的一种以浅绿底色加「正在使用」标记；下拉切换 `@default` / `@smol` / `@slow` 等任意角色），二者存同一个字段、互相替换；**什么都没设置时两种方式都不标「正在使用」**，不得把「未设置」归到任何一类；子智能体的默认项标「（出厂设置）」「（定义中设置）」或「（未设置时默认使用）」；④ⓘ 面板写明读写字段与配置文件路径：角色行为 `modelRoles.<名字>`，子智能体行按优先级列出 4 层（`task.agentModelOverrides.<名字>`、定义里的 `model:`、`modelRoles.task`、当前会话模型）并标出生效层，项目点名被全局遮蔽时明确提示；⑤范围不跟随会话——默认全局。保存角色不修改正在运行的会话或子智能体。
- **覆盖规则**：`modelRoles` 按角色取值，项目值优先于全局，未设置的角色继承全局（显示「继承自全局」）。`agentModelOverrides` 中，全局点名无视项目；项目点名只补充全局未点名的代理。
- **子智能体实际模型**：`task.agentModelOverrides.<名字>` > 定义里的 `model:` > `modelRoles.task` > 会话当前模型，第一个能解析出模型的层生效（第 3 层只看 `modelRoles.task`，不看 `modelRoles.<名字>`）。`@角色` 别名递归解析；`@角色:思考级别`、逗号分隔的候选列表与 `*` / `*:级别`（即 `@default`）按后端规则解析，第一个能解析出模型的候选生效。未配置的内置角色（如 `smol`、`slow`、`task`）视为未设置，解析时跳过；未知角色与循环引用标为「无法解析」，不会把 `@别名` 显示成实际模型。出厂定义：`scout` / `sonic` 为 `@smol`，`reviewer` 为 `@slow`，`task` 为 `@task`，`security-reviewer` 未设置。无会话时明确显示「跟随当前会话（未选择会话）」。
- **值格式**：三种写法：`provider/模型[:思考级别]`、`@角色` 与 `@角色:思考级别`。字面选择器必须带 provider（裸模型名如 `gpt-4o` 会被拒绝）：provider 只允许字母、数字与 `- _ .`，且非空；`/` 之后的模型部分只允许字母、数字与 `- _ . / : +`，且非空。`@角色[:层级]` 的角色名只允许字母、数字与 `- _ .`（不超过 128 字符），冒号之后的层级必须非空、字符集与角色名相同，且整个引用只允许一个冒号。全部取值不超过 256 字符，不接受空格、逗号与 `*`，`@` 只能作为引用开头。所有角色（包括 image / web / speech / dictation / judge）都接受 `:思考级别`，不额外限制。
- **「通用」页联动**：「全局默认模型」只读显示 `modelRoles.default` 的当前值并跳转到本页，不再是第二个编辑入口，也不写入任何设置。
- **子智能体如何修改**：本页只写优先级第 1 层 `task.agentModelOverrides.<名字>`：「专属模型」写入模型名，「复用角色模型」选非默认角色时写入 `@角色名`（例如把出厂 `@smol` 的 scout 切到 `@slow`），选回默认项删除这一项，交给定义里的 `model:` 与 `modelRoles.task`。子智能体定义文件（含 OMP 出厂定义）从不修改，因为 OMP 升级会覆盖出厂定义。
- **后续改动的预防检查**：先读取本节体验契约，再走查默认全局（即使已有项目会话）、自由选择另一个项目、两步选择即时保存与失败保留原值、`@角色` 切换与选回默认删除点名、项目恢复继承、ⓘ 面板字段与遮蔽提示。收起行不得重复显示思考级别。验证通过隔离 IPC fixture 渲染真实组件；这是 UI 与请求目标验证，不冒充真实配置落盘验证。

### 4.2 回退链与切换（「备用模型与重试」页）

- **写入路径**：`omp config set` 只接受**顶层 schema 键**，`retry.fallbackChains` 是 record，因此每次修改都是「读取整份 record → 替换或删除该角色 → 整体写回」（`withChain`；移除某角色链 = 删键后整体写回）。

```bash
omp config set retry.fallbackChains '{"web":["web/parallel","web/exa"]}'   # 整份 record 重写
omp config set cycleOrder '["default","smol"]'                              # 普通数组键
```

- **回退链三态**：未设置（model-kind 角色走内置优先级表，chat 角色可继承 `default` 链）/ `[]`（显式不回退）/ 自定义列表。链条目可为 `provider/id[:level]` 或 `@role` 别名（如 `@tiny`、`@default`）。
- **切换顺序**：`cycleOrder` 是会话内切换模型时轮换的对话角色顺序。
- **/model 保存位置**：`modelRoleStorage` 只决定终端 `/model` 把角色存到全局还是项目。`omp config set` 无论该取值如何都**一律写全局** `config.yml`，所以本页的回退链与切换只编辑全局。底部「高级」卡片名为「命令行 /model 保存位置」。
- **清除语义**：`omp config reset` 把 schema 默认值**写回**而不是删键，UI 不用它做清除。

## 5. 维护指南

omp 升级后按序执行：

1. 重新跑 `omp config list --json`，对比键集合变化（新增 / 改名 / 删除）。
2. 按 `ompConfigMeta.ts` 头部注释重新生成元数据：从已安装 omp 二进制中重新提取内嵌 settings schema 的条目（`strings ~/.local/bin/omp`，条目形如 `"key.path": { type, default, ui: { tab, group, label, description, options, warning, condition } }`），生成 `ompConfigMeta.ts`（含 `tab` / `warning` / `condition`，分别用于 TUI 位置提示、⚠ 警告与条件可见）；同一来源的 `default` 重新生成到 `ompConfigDefaults.ts`（`omp config list --json` 不含默认值，「已修改」判定与条件求值依赖此表；缺失的键不显示标记）。
3. 新键在 `src/features/settings/ompPlacement.ts` 里二选一：放进某个小节的 `exact` / `prefixes`（§3），或是仅终端生效的键则补进 `HIDDEN_PREFIXES` / `HIDDEN_KEYS`（§2，需先核对 omp 源码里该键的读取路径在 RPC 下是否生效）。新增 `ui.condition` 时在 `CONDITIONS` 补一条（含中文提示），纯终端 / 平台条件加入 `ALWAYS_MET`。
4. 新键的中文标题与描述分别补到 `ompConfigZh.ts`、`ompConfigDescZh.ts`。
5. 运行 `pnpm vitest run src/features/settings/ompPlacement.test.ts`：桌面相关的键若落入兜底小节 `advanced.other`（「其他」）会使测试失败，按第 3 步补放置规则。
6. 小节增删、改名或调整匹配规则时，同步更新本文 §3 的表与 §2 的隐藏清单。

## 6. 变更记录

- 2026-09-28：初始拆分（分支 `omp/desktop-settings`）——omp 配置键按桌面相关性重排为 8 个类目，TUI 专用键隐藏，`modelRoles` / `retry.fallbackChains` 抽出为独立编辑器。
- 2026-10-02：设置页整体改版——`SettingsPage` 拆为 `sections/*` + 共享原语（`ui.tsx`）；模型角色支持「当前项目」作用范围；OMP 配置行内直接编辑（数组/记录用结构化编辑器，保留「编辑 JSON」兜底）、「默认 / 已修改」徽标与「本项目已覆盖」提示；新增「规则文件 AGENTS.md」编辑页；「通用」页收拢 omp 程序位置、新会话默认模型/思考深度/审批模式与快捷键。
- 2026-10-11：模型角色改为代理与角色模型分配面板（`omp-roles`），经 `omp_model_roles_read/set` 保格式写入 `modelRoles` 与 `task.agentModelOverrides`，支持全局/项目作用范围、代理实际模型与生效层、点名表；回退链、`cycleOrder`、`modelRoleStorage` 迁入独立页「回退链与切换」（`model-fallback`）；「通用」页的全局默认模型改为只读并跳转本页，消除第二个 `modelRoles` 编辑入口；移除旧编辑器 `ModelRolesSection.tsx` 与前端 YAML 项目改写（`applyProjectRole`）。
- 2026-10-11（体验纠正）：经逐题需求访谈，改为默认全局的全局/项目 Tab、项目自由选择、角色名加用途的简洁单范围列表、图形化模型选择与即时保存；代理解析依据和高级点名默认折叠。修正选择器的项目别名来源、保存中禁用、失败后菜单状态，以及大量引用挤掉模型列表的问题；既有 IPC、安全写入与固定优先级不变。
- 2026-10-11（单表角色分配）：模型角色页合并为一张「角色分配」表：角色与子智能体同表，每行展开为「专属模型 / 复用角色模型」两种方式，可切换任意 `@角色`；ⓘ 面板列出读写字段、配置路径与 4 层优先级。移除「配置解析结果」卡片、「高级：点名表」与新增条目表单；IPC 与后端不变。
- 2026-10-11（单表细节纠正）：①「项目」Tab 默认选中当前会话项目，不再要求先手动选；②去掉两种方式前的 1/2 序号，改为底色 + 「正在使用」标记，用途小字展开后才显示；③未设置的行两种方式都不标「正在使用」。
- 2026-10-11（单表细节纠正 2）：「专属模型」旁的「不使用」按钮改名「清除」，避免与「正在使用」并排矛盾；「复用角色模型」下拉里的「（正在使用专属模型）」与「不复用（未设置）」合并为一项「无」（项目范围的角色行为「无（继承全局）」）；去掉展开区左侧粗线，收起行里思考等级紧跟模型名。
- 2026-10-19（设置页按用户意图重组）：导航改为 6 组（常规 / 模型 / 会话 / Agent 能力 / 连接 / 高级），每页带一句引导语；omp 配置键不再按 8 个类目堆成扁平列表，而由 `ompPlacement.ts` 一处定义「键 → 页面 / 小节」，在对应桌面页面内按小节展示（`OmpSections` / `OmpSettingsPage`，`sections/OmpPages.tsx`）。新增页面：思考与采样、辅助模型、工具、文件读写、命令行、子代理、记忆、技能与命令、联网搜索；「回退链与切换」改名「备用模型与重试」并吸收重试 / 超时 / 防死循环小节。移除 `OmpConfigSection.tsx`、`ompDesktopCategories.ts`、`ompCategoryOf` / `ompSectionId`，以及原 `omp-model` / `omp-thinking` / `omp-retry` / `omp-context` / `omp-tools` / `omp-tasks` / `omp-providers` / `omp-advanced` 类目页。对齐 TUI：只标记已修改的行（圆点 + tooltip 里的默认值 + 重置）、TUI 警告显示 ⚠、TUI 条件可见（不满足时隐藏并给出提示）、导航显示各页已修改数量、小节标题附 TUI 分组名；搜索同时匹配中文、英文 TUI 标签与配置键。可见性重新核对（桌面以 `omp --mode rpc` 运行、`hasUI=false`）：新增隐藏 `loop.` `gc.` `stream.` `collab.` `recap.` `commit.` 与一批仅 TUI 生效的键，放出 `readLineNumbers`、`shellMinimizer.*`、`ttsr.*`，`tools.approvalMode` 因被 `--approval-mode` 覆盖而隐藏。
