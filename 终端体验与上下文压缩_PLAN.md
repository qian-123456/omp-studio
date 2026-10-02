# 统一模型上下文管理、自动压缩阈值设置与侧栏终端体验修复

## Context
用户指出侧栏命令终端存在体验与交互缺陷（顶部出现两排重复标签栏、顶栏终端图标带有不需要的绿色“1”数字角标、标签名需由“命令终端”统一改为“终端”、点击“+”无法正常创建/激活第二个终端窗口）。同时，用户需要在系统设置中增加自动压缩上下文阈值配置（支持绝对 Token 值与模型窗口百分比），并在此基础上实现跨 Provider 模型的上下文上限统筹功能：利用内置正则规则对不同中转站写法各异的同一模型进行提取与归一化，提供确认列表供用户核对搜索并统一设置上下文窗口，同时支持跨品牌/同 Tier 的模糊正则匹配规则。

## Approach

### 1. 终端顶栏去重与交互修复 (Terminal UI Consolidation & Bug Fixes)
- **移除顶栏终端图标的绿色角标** (`src/components/CenterHeader.tsx`):
  - 移除按钮内的 `runningTerminals > 0 && <span ...>{runningTerminals}</span>` 徽标 DOM 与样式。
  - 保留纯图标按钮形态与快捷键提示，不展示数字小圆标。
- **全局文案统一** (`CenterHeader.tsx`, `RightPanelHeader.tsx`, `RightPanelEmptyState.tsx`, `useTabBadges.ts`, `CommandTerminalPanel.tsx`):
  - 将所有“命令终端”文案统一改为“终端”（包括标签名、空状态卡片、Tooltip 和 Aria-label）。
- **消除两排重复标签栏** (`src/components/RightPanelHeader.tsx`, `src/features/terminal/CommandTerminalPanel.tsx`):
  - 当右侧面板当前标签为 `activeTab === "terminal"` 时，将终端标签列表（`visibleTabs.map`）、新建标签按钮（`+`）与状态指示器（`已连接`/`正在连接…`）直接内联集成在 `RightPanelHeader` 中，作为单行顶栏。
  - 移除 `CommandTerminalPanel` 自身顶部的二次 header 容器（`border-b bg-[var(--bg-active-fill)]`），使终端内容区直接贴合右侧顶栏，消除双排叠加。
- **修复无法新建第二个终端窗口的缺陷** (`src/features/terminal/CommandTerminalPanel.tsx`, `src/features/terminal/drawerStore.ts`):
  - 简化 `handleNewTab`，新建标签时同步分配 ID、确定标题（如已有同名目录则自增后缀如 `name (2)`），立即写入 `drawerStore`，避免异步等待 `resolveCwd` 阻塞用户感知。
  - 保证在标签增加导致 `activeTabId` 切换时，对应宿主容器（`hostRefs.current.get(newTab.id)`）就绪后必定触发 `createTerminal`，并在 `drawerRegistry` 中正确初始化与聚焦。

### 2. 系统设置：自动压缩上下文阈值配置 (Auto Compaction Threshold Settings)
- **配置卡片组件** (`src/features/settings/AutoCompactionCard.tsx`):
  - 置于系统设置「上下文与记忆」(`omp-context`) 顶部的“上下文压缩”分组首位。
  - **总开关**：绑定 `compaction.enabled`（布尔开关）。
  - **模式切换**（分段控制器 / Radio）：
    - **按绝对 Token 数量**：输入框允许输入整数（支持带 `k`/`万` 单位解析，如 `250k` -> `250000`）；提供快捷预设胶囊（`100K`, `150K`, `200K`, `250K`, `300K`, `500K`）。点击保存时写入 `compaction.thresholdTokens` 并将 `compaction.thresholdPercent` 设为 `-1`。
    - **按窗口容量百分比**：滑块与百分比输入（如 `75%`, `80%`）；提供快捷预设胶囊（`70%`, `75%`, `80%`, `85%`, `90%`）。点击保存时写入 `compaction.thresholdPercent` 并将 `compaction.thresholdTokens` 设为 `-1`。
  - **当前生效策略说明**：展示动态计算的文字（如：“当前策略：当会话达到 250,000 Token 时自动在后台生成摘要并压缩”）。
  - 通过现有 `ompConfigSet(key, value)` IPC 保存，实时同步到 `~/.omp/agent/config.yml`。

### 3. 跨 Provider 模型归一化与统一上下文配置 (Cross-Provider Model Context Normalization)
- **数据结构与契约定义** (`src/features/settings/modelContextTypes.ts`):
  - `CanonicalModelGroup`:
    - `canonicalId`: 统一标准型号标识（如 `claude-opus-5.5`）
    - `displayName`: 友好展示名称（如 `Claude Opus 5.5`）
    - `family`: 所属家族（`claude` | `gpt` | `gemini` | `deepseek` | `qwen` | `other`）
    - `sources`: `{ providerId: string; providerName: string; rawModelId: string; currentContextWindow: number | null }[]`
    - `unifiedContextWindow`: number | null（用户配置的统一上下文大小）
  - `ModelPatternRule`:
    - `id`: string
    - `name`: string（如“Claude Opus 系列 (30万)”，“GPT 全系 (272K)”）
    - `pattern`: string（正则表达式，如 `/claude.*opus/i`）
    - `targetContextWindow`: number（如 `300000`, `272000`）
    - `enabled`: boolean
- **内置归一化规则与匹配引擎** (`src/features/settings/modelNormalization.ts`):
  - 编写前缀清洗逻辑：剥离中转站厂商前缀（`anthropic/`, `openai/`, `google/`, `azure/`, `openrouter/`, `deepseek/` 等）。
  - 编写内置规则字典，精确覆盖常见同款模型异名：
    - Claude Opus 5.5：`/(?:claude[-_]?)?opus[-_]?5[.\-_]?5/i` -> `Claude Opus 5.5`
    - Claude 3.5 Sonnet：`/(?:claude[-_]?)?(?:3[.\-_]?5[-_]?)?sonnet(?:[-_]?2024\d{4})?/i` -> `Claude 3.5 Sonnet`
    - Claude 3.7 Sonnet：`/(?:claude[-_]?)?(?:3[.\-_]?7[-_]?)?sonnet/i` -> `Claude 3.7 Sonnet`
    - Claude 3.5 Haiku：`/(?:claude[-_]?)?(?:3[.\-_]?5[-_]?)?haiku/i` -> `Claude 3.5 Haiku`
    - GPT-6 Astra：`/gpt[-_]?6[-_]?astra/i` -> `GPT-6 Astra`
    - GPT-5 系列：`/gpt[-_]?5(?:[.\-_]\d+)?/i` -> `GPT-5`
    - GPT-4o / mini：`/gpt[-_]?4o(?:[-_]?mini)?/i` -> `GPT-4o` / `GPT-4o mini`
    - OpenAI o3 / o1：`/\bo[134](?:[-_]mini|[-_]preview)?\b/i` -> `OpenAI o3 / o1`
    - Gemini 3.8 Flash：`/gemini[-_]?3[.\-_]?8[-_]?flash/i` -> `Gemini 3.8 Flash`
    - Gemini 2.5 / 1.5 系列：`/gemini[-_]?(?:2\.5|1\.5)[-_]?(?:pro|flash)/i`
    - DeepSeek V3 / R1：`/deepseek[-_]?(?:v3|chat|r1)/i`
  - Fallback 归一化：若未命中内置名单，通过转换为小写、剥离日期与特殊字符聚合相同型号。
  - 扫描全量 Provider：从 `useProviders.getState().providers` 提取所有模型，归类为 `CanonicalModelGroup[]`。
- **内置与自定义模糊正则规则库** (`src/features/settings/modelNormalization.ts`):
  - 内置开箱即用规则（跨品牌与同 Tier）：
    - `Claude Opus 系列` -> 正则 `/claude.*opus/i`，推荐 300,000 (300K)
    - `Claude Sonnet 系列` -> 正则 `/claude.*sonnet/i`，推荐 250,000 (250K)
    - `GPT 系列` -> 正则 `/(?:^|\b)(?:gpt|o[1-9])/i`，推荐 272,000 (272K)
    - `Gemini Flash 系列` -> 正则 `/gemini.*flash/i`，推荐 500,000 (500K)
  - 规则执行引擎：接收正则规则，筛选匹配的所有中转站模型，批量填充其目标上下文。
- **系统设置界面呈现** (`src/features/settings/sections/ModelContextSection.tsx`):
  - 在 `src/features/settings/navigation.ts` 的「模型」分组下添加导航项：
    `{ id: "model-context", label: "统一模型上下文", icon: SlidersHorizontal }`。
  - 界面分为两大部分：
    1. **正则批量匹配规则栏**：展示当前激活的正则规则列表，支持新增自定义规则（名称、正则表达式、目标上下文）、开关和删除；提供「执行规则预填」按钮，点击后一键匹配所有模型并预览匹配结果。
    2. **归一化模型确认与配置列表**：
       - 搜索栏：快速过滤模型名、中转站名称、原始 ID。
       - 分组卡片列表：展示标准模型名、匹配到的中转站数量、各中转站原始型号展开明细。
       - 统一上下文输入框：支持直接输入 `300k`, `30万`, `272k`, `500k`, `250000` 等常用格式，失焦自动转换。
       - 状态指示：若所有中转站配置一致显示绿标，若存在差异显示黄标。
       - 快捷操作：支持单独为该模型点击“应用到全部来源”，或顶部点击“全部保存并生效”。
- **持久化与生效流程** (`src/features/settings/modelContextLogic.ts`):
  - 用户确认应用后，引擎遍历受影响的 `ProviderConfig`，更新其 `models` 列表中匹配项的 `ModelSpec.contextWindow` 字段（保持其他字段和密钥不发生变动）。
  - 调用 `useProviders.getState().save(updatedProvider)` 写入 `~/.omp-workspace/providers.json`。
  - OMP 扩展在子进程启动时会从 `providers.json` 读取该 `contextWindow` 并向 OMP 注册，使对应模型无论从中转站 A 还是中转站 B 调用，均采用统一的上下文上限。
  - 正则规则列表与用户偏好持久化保存在 localStorage (`ompws:model-context-rules`)。

## Critical files & anchors
- `src/components/CenterHeader.tsx`: line 500-525，移除终端按钮绿色“1”徽标，统一提示文案。
- `src/components/RightPanelHeader.tsx`: line 75-140，将“命令终端”改为“终端”，并在终端标签激活时整合终端标签栏。
- `src/features/terminal/CommandTerminalPanel.tsx`: line 490-575，移除内部多余 header，修复新建终端窗口时可能出现的竞争与失焦问题。
- `src/features/settings/navigation.ts`: line 50-65，在「模型」分组注册 `model-context` 导航项；在「Agent」保留 `omp-context`。
- `src/features/settings/OmpConfigSection.tsx`: line 125-150，在上下文压缩区域挂载 `AutoCompactionCard`。
- `src/features/settings/sections/ModelContextSection.tsx` (新建): 跨 Provider 模型归一化列表、正则匹配规则库及统一上下文配置主视图。
- `src/features/settings/modelNormalization.ts` (新建): 智能模型去重聚类算法、正则规则预设库与批量应用逻辑。

## Verification
- **终端 UI 与多标签验证**:
  - 启动应用观察顶栏终端图标：确认绿色“1”徽标已彻底移除。
  - 打开右侧终端：确认右侧面板顶部仅有一排标签栏，显示“终端”及子标签（无两排重复 UI）。
  - 点击新建终端按钮（`+`）：确认能顺畅新建出第二个终端标签，并能在不同标签间切换与输入。
- **自动压缩阈值设置验证**:
  - 打开系统设置 ->「上下文与记忆」：确认顶部出现清晰的“自动压缩阈值”卡片。
  - 切换为“绝对值模式”输入 `200K` 并保存，检查 `~/.omp/agent/config.yml` 中的 `compaction.thresholdTokens` 变为 200000，`thresholdPercent` 变为 -1。
  - 切换为“百分比模式”选择 `80%` 并保存，检查配置中 `compaction.thresholdPercent` 变为 80，`thresholdTokens` 变为 -1。
- **跨 Provider 模型归一化与统一上下文验证**:
  - 打开系统设置 ->「统一模型上下文」：确认展示所有已配置中转站中提取出的归一化模型（如 `Claude Opus 5.5`、`GPT-6 Astra`）。
  - 展开卡片确认列出了所有中转站的不同原始写法。
  - 为 `Claude Opus 5.5` 输入 `300k`，点击应用，检查对应各中转站配置均写入 `contextWindow: 300000`。
  - 启用并执行正则规则（如 Claude Opus -> 30万，GPT 全系 -> 272K），检查匹配模型列表被批量赋予目标上下文。
- **静态与单元检查**:
  - 运行 `pnpm tsc --noEmit`，确保无新增类型错误。
  - 运行 `pnpm vitest run`，确保现有测试套件全绿，并为新建的模型归一化解析函数补充单元测试。

## Assumptions & contingencies
- 归一化提取的数据源优先来自于当前工作台已配置的所有 API 供应商（`providers.json`）。如果用户尚未配置任何中转站，列表展示空状态并提供指引按钮跳转至“API 供应商”进行添加。
- 模糊正则规则默认仅影响跨中转站的匹配模型 `contextWindow`，严格不影响 Provider 下其他未匹配模型，不提供按 Provider 全局覆盖的功能，符合用户要求。
