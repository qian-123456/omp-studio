# OMP 设置（桌面端）维护文档

本文面向维护者，说明设置页「OMP 配置」区域的分类规则、模型角色与回退链编辑器的行为，以及 omp 升级后的同步步骤。实现代码集中在 `src/features/settings/`。

## 1. 背景与目标

桌面端以 `omp --mode rpc` 运行 omp（见 `docs/ARCHITECTURE.md` §7 的 `rpc_*` 命令族），全程无终端 UI。设置页此前直接镜像 omp TUI `/settings` 面板的官方标签页（`ompConfigTabs.ts` 里的 appearance / interaction / shell 等），导致大量只影响终端渲染与交互的键（主题、状态栏、输入框、键位、启动画面……）出现在列表中成为噪音。

现在把 omp 的配置键按三类处理：

- **桌面相关**：影响 agent 核心 / RPC 行为的键，按 8 个桌面原生类目展示（§3）。
- **TUI 专用**：只影响终端界面的键，整组隐藏（§2）。
- **模型角色与回退链**：`modelRoles`、`task.agentModelOverrides` 与 `retry.fallbackChains` 从扁平列表中抽出，分别由「模型角色」「回退链与切换」两个专用页维护（§4）。

## 2. 分类原则

判定规则：**影响 agent 核心或 RPC 行为的键展示；只影响终端 UI 渲染/交互的键隐藏**。隐藏 ≠ 删除——这些键的值原样保留在 `~/.omp/agent/config.yml`，TUI 里照常生效，只是不占用桌面端界面。

分类实现见 `src/features/settings/ompDesktopCategories.ts`：

- `isDesktopRelevant(key)` — 命中隐藏规则返回 `false`；
- `ompDesktopCategoryFor(key)` — 返回所属类目，先命中先归类，未命中兜底 `advanced`，永不为空；
- `groupByDesktopCategory(entries)` — 丢弃隐藏键，按固定类目顺序返回（空类目省略），类目内按键名排序。

隐藏规则：

- 前缀：`theme.` `statusLine.` `composer.` `tui.` `display.` `terminal.` `startup.` `keybindings.` `paste.` `shellMinimizer.` `speech.` `stt.` `live.` `ttsr.` `spelling.`
- 精确键：`symbolPreset` `colorBlindMode` `showHardwareCursor` `autocompleteMaxVisible` `emojiAutocomplete` `treeFilterMode` `autoResume` `doubleEscapeAction` `completion.notify` `error.notify` `readLineNumbers` `read.toolResultPreview` `setupVersion` `modelRoles` `task.agentModelOverrides` `retry.fallbackChains` `cycleOrder` `modelRoleStorage` `extendedContext`

专属隐藏键不进入扁平列表：`modelRoles`、`task.agentModelOverrides` 由「模型角色」页维护；`retry.fallbackChains`、`cycleOrder`、`modelRoleStorage` 由「回退链与切换」页维护；`extendedContext` 由「上下文窗口」页维护。`task.*` 类目中的其他键照常显示。

## 3. 类目表

| id | 中文名 | 覆盖的键（前缀 / 精确，先命中先归类） |
|---|---|---|
| `model` | 模型与目录 | `modelProviderOrder` `enabledModels` `enabledProviders` `disabledProviders` `modelTags` `includeModelInPrompt` `model.loopGuard.*` `model.toolCallLoopGuard.*` `features.*` `codexResets.*` |
| `thinking` | 思考与采样 | `defaultThinkingLevel` `hideThinkingBlock` `proseOnlyThinking` `omitThinking` `externalThinking` `thinkingBudgets.*` `providers.autoThinkingMaxEffort` `temperature` `topP` `topK` `minP` `presencePenalty` `repetitionPenalty` `textVerbosity` `tier.*` `personality` |
| `retry` | 重试与回退 | `retry.*` `providers.anthropic.serverSideFallback` `provider.appendOnlyContext` `providers.streamFirstEventTimeoutSeconds` `providers.streamIdleTimeoutSeconds` `providers.maxInFlightRequests` `providers.cacheRetention` |
| `context` | 记忆与对话 | `includeWorkspaceTree` `workspace.*` `skillful` `title.*` `recap.*` `memory.*` `hindsight.*` `mnemopi.*` `memories.*` `autolearn.*` `steeringMode` `followUpMode` `interruptMode` `goal.*` |
| `tools` | 工具与审批 | `tools.*` `bash.*` `eval.*` `python.*` `lsp.*` `edit.*` `read.*` `glob.*` `grep.*` `astGrep.*` `astEdit.*` `find.*` `debug.*` `launch.*` `fetch.*` `vault.*` `github.*` `web_search.*` `security.*` `ask.*` `browser.*` `computer.*` `images.*` `checkpoint.*` `speechgen.*` `generate_image.*` `mcp.*` `async.*` `irc.*` `plan.*` `skills.*` `commands.*` `secrets.*` `tts.*` `todo.*` |
| `tasks` | 任务与子代理 | `task.*`（`task.agentModelOverrides` 除外，见 §2）`tasks.*` `isolation.*` `worktree.*` `prewalk.*` |
| `providers` | 网络与扩展 | 其余 `providers.*` `searxng.*` `exa.*` `auth.*` `extensions` `disabledExtensions` `extensionHandlers.*` `dev.*` `gc.*` `commit.*` `git.*` |
| `advanced` | 其他 OMP 配置 | 兜底桶：其他桌面相关但未命中以上规则的可见键（如 `shellPath`、`power.*`） |

导航「模型」组中，`模型角色`（`omp-roles`）与 `回退链与切换`（`model-fallback`）是两个专用页（§4）；其余类目各对应一个扁平键列表。`modelRoles`、`task.agentModelOverrides`、`retry.fallbackChains`、`cycleOrder`、`modelRoleStorage` 不再重复出现在扁平列表中。

## 4. 模型角色与回退链

导航「模型」组里有两个独立页面，各自只写一类键：

- **模型角色**（`omp-roles`）：`AgentModelAssignmentsPanel.tsx` 渲染，只读写 `modelRoles.*` 与 `task.agentModelOverrides.*`。
- **回退链与切换**（`model-fallback`）：`FallbackChainsSection.tsx` 渲染，读写 `retry.fallbackChains.*`、`cycleOrder`、`modelRoleStorage`。

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

### 4.2 回退链与切换

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
2. 新键默认落入 `advanced`（高级）兜底桶：在 `src/features/settings/ompDesktopCategories.ts` 的归属规则里手动归类；若是新的 TUI 专用键，补进隐藏前缀或精确键列表。
3. 按 `ompConfigMeta.ts` 头部注释重新生成元数据：从已安装 omp 二进制中重新提取内嵌 settings schema 的 `label:` 条目（`strings ~/.local/bin/omp`，条目形如 `"key.path": { type, default, ui: { tab, group, label, description, options } }`）；新键的中文标题与描述分别在 `ompConfigZh.ts`、`ompConfigDescZh.ts` 中补充。同一来源的 `default` 值重新生成到 `ompConfigDefaults.ts`（`omp config list --json` 不含默认值，「默认 / 已修改」徽标依赖此表；缺失的键不显示徽标）。
4. 类目增删、改名或调整覆盖范围时，同步更新本文 §3 的表与 §2 的隐藏清单。

## 6. 变更记录

- 2026-09-28：初始拆分（分支 `omp/desktop-settings`）——omp 配置键按桌面相关性重排为 8 个类目，TUI 专用键隐藏，`modelRoles` / `retry.fallbackChains` 抽出为独立编辑器。
- 2026-10-02：设置页整体改版——`SettingsPage` 拆为 `sections/*` + 共享原语（`ui.tsx`）；模型角色支持「当前项目」作用范围；OMP 配置行内直接编辑（数组/记录用结构化编辑器，保留「编辑 JSON」兜底）、「默认 / 已修改」徽标与「本项目已覆盖」提示；新增「规则文件 AGENTS.md」编辑页；「通用」页收拢 omp 程序位置、新会话默认模型/思考深度/审批模式与快捷键。
- 2026-10-11：模型角色改为代理与角色模型分配面板（`omp-roles`），经 `omp_model_roles_read/set` 保格式写入 `modelRoles` 与 `task.agentModelOverrides`，支持全局/项目作用范围、代理实际模型与生效层、点名表；回退链、`cycleOrder`、`modelRoleStorage` 迁入独立页「回退链与切换」（`model-fallback`）；「通用」页的全局默认模型改为只读并跳转本页，消除第二个 `modelRoles` 编辑入口；移除旧编辑器 `ModelRolesSection.tsx` 与前端 YAML 项目改写（`applyProjectRole`）。
- 2026-10-11（体验纠正）：经逐题需求访谈，改为默认全局的全局/项目 Tab、项目自由选择、角色名加用途的简洁单范围列表、图形化模型选择与即时保存；代理解析依据和高级点名默认折叠。修正选择器的项目别名来源、保存中禁用、失败后菜单状态，以及大量引用挤掉模型列表的问题；既有 IPC、安全写入与固定优先级不变。
- 2026-10-11（单表角色分配）：模型角色页合并为一张「角色分配」表：角色与子智能体同表，每行展开为「专属模型 / 复用角色模型」两种方式，可切换任意 `@角色`；ⓘ 面板列出读写字段、配置路径与 4 层优先级。移除「配置解析结果」卡片、「高级：点名表」与新增条目表单；IPC 与后端不变。
- 2026-10-11（单表细节纠正）：①「项目」Tab 默认选中当前会话项目，不再要求先手动选；②去掉两种方式前的 1/2 序号，改为底色 + 「正在使用」标记，用途小字展开后才显示；③未设置的行两种方式都不标「正在使用」。
- 2026-10-11（单表细节纠正 2）：「专属模型」旁的「不使用」按钮改名「清除」，避免与「正在使用」并排矛盾；「复用角色模型」下拉里的「（正在使用专属模型）」与「不复用（未设置）」合并为一项「无」（项目范围的角色行为「无（继承全局）」）；去掉展开区左侧粗线，收起行里思考等级紧跟模型名。
