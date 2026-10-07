# OMP 设置（桌面端）维护文档

本文面向维护者，说明设置页「OMP 配置」区域的分类规则、模型角色与回退链编辑器的行为，以及 omp 升级后的同步步骤。实现代码集中在 `src/features/settings/`。

## 1. 背景与目标

桌面端以 `omp --mode rpc` 运行 omp（见 `docs/ARCHITECTURE.md` §7 的 `rpc_*` 命令族），全程无终端 UI。设置页此前直接镜像 omp TUI `/settings` 面板的官方标签页（`ompConfigTabs.ts` 里的 appearance / interaction / shell 等），导致大量只影响终端渲染与交互的键（主题、状态栏、输入框、键位、启动画面……）出现在列表中成为噪音。

现在把 omp 的配置键按三类处理：

- **桌面相关**：影响 agent 核心 / RPC 行为的键，按 8 个桌面原生类目展示（§3）。
- **TUI 专用**：只影响终端界面的键，整组隐藏（§2）。
- **模型角色与回退链**：`modelRoles` / `retry.fallbackChains` 从扁平列表中抽出，由专用编辑器维护（§4），对应 omp `/model` 的 Roles 视图。

## 2. 分类原则

判定规则：**影响 agent 核心或 RPC 行为的键展示；只影响终端 UI 渲染/交互的键隐藏**。隐藏 ≠ 删除——这些键的值原样保留在 `~/.omp/agent/config.yml`，TUI 里照常生效，只是不占用桌面端界面。

分类实现见 `src/features/settings/ompDesktopCategories.ts`：

- `isDesktopRelevant(key)` — 命中隐藏规则返回 `false`；
- `ompDesktopCategoryFor(key)` — 返回所属类目，先命中先归类，未命中兜底 `advanced`，永不为空；
- `groupByDesktopCategory(entries)` — 丢弃隐藏键，按固定类目顺序返回（空类目省略），类目内按键名排序。

隐藏规则：

- 前缀：`theme.` `statusLine.` `composer.` `tui.` `display.` `terminal.` `startup.` `keybindings.` `paste.` `shellMinimizer.` `speech.` `stt.` `live.` `ttsr.` `spelling.`
- 精确键：`symbolPreset` `colorBlindMode` `showHardwareCursor` `autocompleteMaxVisible` `emojiAutocomplete` `treeFilterMode` `autoResume` `doubleEscapeAction` `completion.notify` `error.notify` `readLineNumbers` `read.toolResultPreview` `setupVersion` `modelRoles` `retry.fallbackChains` `cycleOrder` `modelRoleStorage`

最后四个（`modelRoles`、`retry.fallbackChains`、`cycleOrder`、`modelRoleStorage`）由「模型角色」专用编辑器接管，不进入扁平列表。

## 3. 类目表

| id | 中文名 | 覆盖的键（前缀 / 精确，先命中先归类） |
|---|---|---|
| `model` | 模型与目录 | `modelProviderOrder` `enabledModels` `enabledProviders` `disabledProviders` `modelTags` `includeModelInPrompt` `model.loopGuard.*` `model.toolCallLoopGuard.*` `features.*` `codexResets.*` |
| `thinking` | 思考与采样 | `defaultThinkingLevel` `hideThinkingBlock` `proseOnlyThinking` `omitThinking` `externalThinking` `thinkingBudgets.*` `providers.autoThinkingMaxEffort` `temperature` `topP` `topK` `minP` `presencePenalty` `repetitionPenalty` `textVerbosity` `tier.*` `personality` |
| `retry` | 重试与回退 | `retry.*` `providers.anthropic.serverSideFallback` `provider.appendOnlyContext` `providers.streamFirstEventTimeoutSeconds` `providers.streamIdleTimeoutSeconds` `providers.maxInFlightRequests` `providers.cacheRetention` |
| `context` | 记忆与对话 | `includeWorkspaceTree` `workspace.*` `skillful` `title.*` `recap.*` `memory.*` `hindsight.*` `mnemopi.*` `memories.*` `autolearn.*` `steeringMode` `followUpMode` `interruptMode` `goal.*` |
| `tools` | 工具与审批 | `tools.*` `bash.*` `eval.*` `python.*` `lsp.*` `edit.*` `read.*` `glob.*` `grep.*` `astGrep.*` `astEdit.*` `find.*` `debug.*` `launch.*` `fetch.*` `vault.*` `github.*` `web_search.*` `security.*` `ask.*` `browser.*` `computer.*` `images.*` `checkpoint.*` `speechgen.*` `generate_image.*` `mcp.*` `async.*` `irc.*` `plan.*` `skills.*` `commands.*` `secrets.*` `tts.*` `todo.*` |
| `tasks` | 任务与子代理 | `task.*` `tasks.*` `isolation.*` `worktree.*` `prewalk.*` |
| `providers` | 网络与扩展 | 其余 `providers.*` `searxng.*` `exa.*` `auth.*` `extensions` `disabledExtensions` `extensionHandlers.*` `dev.*` `gc.*` `commit.*` `git.*` |
| `advanced` | 其他 OMP 配置 | 兜底桶：其他桌面相关但未命中以上规则的可见键（如 `shellPath`、`power.*`） |

以上入口与「模型角色」编辑器均按新版分组导航进行分类展示：`模型角色` 对应 omp `/model` 的 Roles 视图，管理 `modelRoles.*`、`retry.fallbackChains.*`、`cycleOrder`、`modelRoleStorage`；其余 8 项各对应一个类目的扁平键列表。`cycleOrder`、`modelRoleStorage` 不再重复出现在 `model` 类目的扁平列表中。

## 4. 模型角色与回退链

写入路径：UI 调 `omp_config_set` IPC（`src/lib/ipc.ts` → Rust → `omp config set <key> <value>`）。注意 `omp config set` 只接受**顶层 schema 键**——`modelRoles.default` 这类子键不是 schema 路径，会报 Unknown setting。因此每次修改都是「读取整份 record → 合并该角色的变更 → 整体重写」：

```bash
omp config set modelRoles '{"default":"anthropic/claude-sonnet-4-5","smol":"@default"}'   # 整份 record 重写
omp config set retry.fallbackChains '{"web":["web/parallel","web/exa"]}'                  # 同理
```

移除某个角色/链条目 = 从 record 中删掉该键后整体写回（`withRoleAssignment` / `withChain` 传 `null`）。

- **思考后缀**：chat 类选择器可带 `:minimal|:low|:medium|:high|:xhigh|:max` 后缀（如 `anthropic/claude-opus-4-5:high`）；model-kind 角色（image / web / speech / dictation / judge）不使用。链条目还支持 `@role` 别名（如 `@tiny`、`@default`）。
- **回退链三态**：未设置（model-kind 角色走内置优先级表，chat 角色可继承 `default` 链）/ `[]`（显式不回退）/ 自定义列表。
- **作用范围：全局 / 当前项目**：`omp config set` 无论 `modelRoleStorage` 取值，**一律写全局** `config.yml`；`modelRoleStorage` 只决定 TUI 内 `/model` 选择器把角色存到哪。会话读的是「项目 → 全局」合并后的有效值，项目 `<cwd>/.omp/config.yml` 里的 `modelRoles` 逐角色压过全局（未覆盖的角色继承全局）。因此 UI 顶部提供「作用范围」切换：全局走 `omp config set`；当前项目（= 当前选中会话的 cwd，与 MCP/插件页同规则）通过 `omp_project_config_read/write` 直接编辑该文件的 `modelRoles`（前端用 `yaml` Document API，保留注释与其他键；`modelRoles` 清空后删除该键；YAML 无效时拒绝写入）。全局视图下若当前项目有覆盖，顶部提示并在对应行标「项目已覆盖」。`omp_config_*` 在不含 `.omp/` 的中性目录下执行，所以页面读到的就是纯全局值，整记录重写不会把项目覆盖固化进全局。`modelRoleStorage` 开关降级到底部「高级」卡片，名为「命令行 /model 保存位置」。
- **清除语义**：`omp config reset` 是把 schema 默认值**写回**而不是删键，UI 不用它做清除；单角色/单链的移除走上面的 record 整体重写。`cycleOrder` 为普通数组键，直接 `omp config set cycleOrder '<json>'`。

## 5. 维护指南

omp 升级后按序执行：

1. 重新跑 `omp config list --json`，对比键集合变化（新增 / 改名 / 删除）。
2. 新键默认落入 `advanced`（高级）兜底桶：在 `src/features/settings/ompDesktopCategories.ts` 的归属规则里手动归类；若是新的 TUI 专用键，补进隐藏前缀或精确键列表。
3. 按 `ompConfigMeta.ts` 头部注释重新生成元数据：从已安装 omp 二进制中重新提取内嵌 settings schema 的 `label:` 条目（`strings ~/.local/bin/omp`，条目形如 `"key.path": { type, default, ui: { tab, group, label, description, options } }`）；新键的中文标题与描述分别在 `ompConfigZh.ts`、`ompConfigDescZh.ts` 中补充。同一来源的 `default` 值重新生成到 `ompConfigDefaults.ts`（`omp config list --json` 不含默认值，「默认 / 已修改」徽标依赖此表；缺失的键不显示徽标）。
4. 类目增删、改名或调整覆盖范围时，同步更新本文 §3 的表与 §2 的隐藏清单。

## 6. 变更记录

- 2026-09-28：初始拆分（分支 `omp/desktop-settings`）——omp 配置键按桌面相关性重排为 8 个类目，TUI 专用键隐藏，`modelRoles` / `retry.fallbackChains` 抽出为独立编辑器。
- 2026-10-02：设置页整体改版——`SettingsPage` 拆为 `sections/*` + 共享原语（`ui.tsx`）；模型角色支持「当前项目」作用范围；OMP 配置行内直接编辑（数组/记录用结构化编辑器，保留「编辑 JSON」兜底）、「默认 / 已修改」徽标与「本项目已覆盖」提示；新增「规则文件 AGENTS.md」编辑页；「通用」页收拢 omp 程序位置、新会话默认模型/思考深度/审批模式与快捷键。
