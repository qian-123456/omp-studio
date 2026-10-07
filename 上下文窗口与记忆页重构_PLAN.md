# 设置页重构：「上下文窗口」新页 + 「记忆与对话」页

> 本文是与用户多轮 grill-me 访谈后的定稿方案，供全新上下文的执行模型直接实施。
> 所有决策均已由用户拍板；执行中如发现与事实冲突，停下来报告，不要自行改决策。

## 1. 背景（为什么要改）

现状：设置 ▸ Agent ▸「上下文与记忆」（nav id `omp-context`）一页塞了三类东西，用户评价「乱成一锅粥」：

1. 顶部巨大的「统一模型上下文」块（`src/features/settings/sections/ModelContextSection.tsx`，~1200 行）：关键词规则（有先后顺序）+ 手动分组 + 单模型独立覆盖 + 排除来源 + 供应商侧栏，四层概念叠加，有独立的「全部保存并生效」按钮，写 `providers.json`。
2. 分组胶囊 + 筛选框。
3. OMP 配置项列表：`AutoCompactionCard` + 原始 `compaction.*` 行（阈值重复出现）、记忆系统、自主学习、一个装杂项的「其他」组。

用户的具体痛点：
- 输入关键词后只显示「命中 N 个，点击加入待选集」+ 最多 6 个名字，**看不到到底命中了哪些模型，也就没法挑选**。
- 一进页面先看到「新建规则」，不知道干什么用、关键词怎么用。
- 模型列表几百行，一屏放不下，没有像样的分类。
- 窗口设置和压缩/记忆混在同一页。

另外访谈中发现两个真实缺陷：
- **32K 默认值**：`src-tauri/src/providers/extension.ts` 把工作台供应商注册给 OMP 时，模型窗口按「模型自身值 → 供应商 `defaultContextWindow` → 写死 32768」取值。未填窗口的大模型（如 Opus）因此被当成 32K，过早压缩，百分比阈值也按 32K 算。
- **订阅模型并非「写不了」**：OMP 文档（`omp://models.md`）说明 `~/.omp/agent/models.yml` 的 `providers.<providerId>.modelOverrides.<modelId>.contextWindow` 可覆盖任何内置/订阅模型的窗口。工作台目前只是对 models.yml 只读（`src-tauri/src/providers/omp_config.rs` 是只读扫描器）。

## 2. 决策记录（用户已确认）

| # | 问题 | 决策 |
|---|------|------|
| D1 | 是否拆页 | 拆。新增「上下文窗口」页，**窗口与自动压缩必须放在同一页** |
| D2 | 压缩项放哪 | 全部 `compaction.*` 搬到新页；开关+阈值做成顶部卡片，其余细节项折叠在页底「更多压缩选项」；原始 `thresholdTokens`/`thresholdPercent` 行不再重复显示。`extendedContext`、`contextPromotion.*` 也归新页 |
| D3 | 核心交互 | **筛选 + 勾选 + 批量设值为主**；「记住为规则」是可选附加项 |
| D4 | 表格一行 | 一行 = 某个供应商里的一个模型（平铺，展示原始模型 ID） |
| D5 | 几百行怎么分类 | 左侧「家族栏」（Claude / GPT / Gemini / DeepSeek / Qwen / 其他，带计数）+ 表内按「型号」分段（可折叠，段头勾选框选中整段，段头显示来源数与「N 种窗口⚠」）+ 顶部搜索 + 供应商筛选 + 状态筛选（未设置 / 不一致 / 已设置） |
| D6 | 生效方式 | 点「应用」立即写入，toast 提示且可「撤销」；单元格可直接编辑单行；与其他设置页一致，无全局保存按钮 |
| D7 | 规则定义 | 规则 = 当前搜索关键词 + 窗口值。写入后就是普通值，不追踪「来源」，表格不设「来源」列 |
| D8 | 规则何时生效 | (a) 新建/修改规则时：对当前所有匹配模型生效；(b) 在「API 供应商」保存供应商时：只对**本次新增**的模型生效（老模型不重复处理）；(c) 用户勾选后点「应用」与规则无关 |
| D9 | 覆盖策略 | 规则**默认覆盖**已有值，但覆盖不同的已有值前必须弹确认清单（「模型 X：128K → 1M」，[全部覆盖] [保留原值]）。用户亲手勾选的「应用」不弹窗，靠撤销兜底 |
| D10 | 调大警告 | 任何入口（批量应用、单格编辑、规则覆盖确认窗）只要新值 > 原值，显示黄色警告：超过模型真实上限会导致自动压缩来不及触发、请求报错（如 `prompt is too long` / `context_length_exceeded` / `maximum context length`），若出现此类错误回到本页调小。只提醒不拦截 |
| D11 | 报错跳转 | 对话中出现上述上下文超长类报错时，错误下方附「可能是该模型的上下文窗口设得过大 → 去调整」，点击跳到新页并定位到该模型行 |
| D12 | 规则冲突 | 无手动排序。多条规则命中同一模型时：关键词更多（更具体）者胜；关键词数相同则后创建者胜。创建/修改规则时如发生接管，确认窗里明确提示「以下模型同时命中 A 和 B，将按更具体的 B = 200K」；规则列表标注「有 N 个模型被更具体的规则接管」 |
| D13 | 旧数据 | 旧 localStorage 配置（关键词规则、手动分组、单模型覆盖）**全部丢弃**；`providers.json` 已有的窗口值不动 |
| D14 | 订阅/OMP 托管模型 | 在表中与中转站模型同等可勾选、可应用、可被规则覆盖。写入路径：新增后端能力，**定点**写 `~/.omp/agent/models.yml` 的 `modelOverrides.<model>.contextWindow`，写前备份、写后重新解析校验、失败自动还原；密钥与注释字节原样保留，任何密钥值不得进入前端/日志 |
| D15 | 未填窗口的取值 | 保存供应商时，对未填窗口的模型按顺序取值并**明确写入** `providers.json`：用户规则 → OMP 模型目录中同型号的窗口 → 供应商 `defaultContextWindow` → 仍无则表格标红「未知窗口」提醒填写。扩展里的最终兜底由 32768 改为 **250000** |
| D16 | 原页去向 | 「上下文与记忆」改名「记忆与对话」，分 4 段：记忆系统（`memory.*` `memories.*` `mnemopi.*` `hindsight.*`）/ 自主学习（`autolearn.*`）/ 对话行为（`steeringMode` `followUpMode` `interruptMode` `title.*` `recap.*` `goal.*`）/ 提示词内容（`includeWorkspaceTree` `skillful` `workspace.*`）。不再有「其他」组 |
| D17 | 页面位置与命名 | 新页名「上下文窗口」，放在导航「模型」组，紧跟「API 供应商」之后 |

## 3. Target（改动边界）

### 范围内
- 新页「上下文窗口」：自动压缩卡片（含扩展上下文、自动提升上下文）+ 模型大表 + 规则列表（页面靠下的小列表，可编辑/删除）+ 折叠的「更多压缩选项」。
- 「压缩触发点」列：按全局阈值与该行有效窗口计算（百分比模式 = 窗口 × 百分比；Token 模式 = 阈值，若阈值 ≥ 窗口则标红「永远触发不到」）。
- 替换 `ModelContextSection.tsx` 的旧实现及其只为旧设计服务的逻辑/类型/测试（`modelNormalization.ts` 中的 ThreeTier 配置、手动分组、排除来源等）。可复用的纯函数（型号归一化、`parseContextInput`、`formatTokens` 等）保留复用，不另立第二套。
- 「记忆与对话」页按 D16 重组；`OmpConfigSection` 中 context 分类的分组逻辑与死分支（`context.`/`prompt.`/`input.` 前缀的「上下文控制」）随之清理。
- 供应商保存流程接入 D8(b)/D9/D15（只处理本次新增或未填窗口的模型）。
- 桥接扩展兜底 32768 → 250000（`maxTokens` 兜底不在范围内）。
- 后端新增 models.yml `modelOverrides.contextWindow` 定点写入命令（含备份/校验/还原），及其前端 ipc 封装。
- 若 OMP 目录数据当前不含窗口信息（`src/lib/contracts.ts` 的 `Model` 只有 provider/id/name），扩展数据来源使目录模型带上 `contextWindow`，供 D14 显示订阅模型现值、供 D15 推断。
- 对话报错跳转（D11）。
- 所有入口迁移：`settingsTargets.ts`（`modelContext` / `compaction` / `extendedContext` 指向新页，`memory` 留在「记忆与对话」）、`ProviderPanel.tsx` 中「前往」上下文的提示文案与跳转、`SessionsSection.tsx`「配置压缩阈值」按钮、`navigation.ts` 导航项与搜索词、`ompDesktopCategories.ts` 的分类标签与键归属及其测试。

### 非目标
- 不改 `maxTokens` 逻辑；不做按模型的压缩阈值（OMP 阈值是全局的）。
- 不迁移旧规则数据（D13）。
- 规则存储继续用前端 localStorage（新 key，删除旧 key 的读写代码），不改 Rust `Settings` 契约。
- 不改动其他设置页的布局。

## 4. Contract（模块间契约）

- **窗口写入目标**：工作台供应商模型 → `providers.json` 中对应 `ModelSpec.contextWindow`（经现有 `useProviders.save`，不得触碰密钥与其他字段，**不得修改** `defaultContextWindow`）；OMP 托管/订阅模型 → models.yml `providers.<id>.modelOverrides.<modelId>.contextWindow`（新命令）。表格对两类行的「应用/撤销/规则覆盖」行为必须一致。
- **models.yml 写入命令**（新 Tauri 命令，名称由执行者按 `docs/ARCHITECTURE.md` §7 命名习惯确定）：
  - 输入：一批 `{ providerId, modelId, contextWindow: number | null }`（`null` = 删除该覆盖，用于撤销到「原本没有覆盖」的状态）。
  - 行为：仅增改/删除目标 `contextWindow` 行（必要时创建 `modelOverrides` 与模型键），文件其余字节不变；写前备份到同目录带时间戳的备份文件；写后重新解析，解析失败或目标值不符则从备份还原并返回错误。
  - 输出：成功/失败及错误信息；绝不回传文件内容或任何密钥。
  - 必须作为契约变更写入最终报告「Contract changes」，并同步 `docs/ARCHITECTURE.md`。
- **撤销**：记录本次应用前每行的原值（含「原本无值」），撤销即按原值逐行写回两个目标。
- **规则（localStorage）**：`{ id, keywords: string[], contextWindow: number, createdAt }`。匹配 = 原始模型 ID 同时包含全部关键词（可沿用现有的容错匹配）。优先级见 D12。
- **供应商保存钩子**：输入 = 保存前后的供应商配置；只对新增模型及未填窗口模型按 D15 顺序取值；与已有不同值冲突时按 D9 弹确认；结束后 toast「按规则/目录为 N 个模型设置了窗口」。
- **超长报错识别**：大小写不敏感匹配 `prompt is too long`、`context_length_exceeded`、`maximum context length`（可补充同类常见措辞）；能识别出当前会话模型时深链定位该行，否则只打开新页。
- **深链**：新页需支持 focusKey 定位（自动压缩卡片、指定模型行）。

## 5. Acceptance（验收）

1. `pnpm tsc --noEmit`、`pnpm vitest run` 全绿；`src-tauri` 下 `cargo clippy` 无警告、`cargo fmt --check` 干净。
2. 单元测试只覆盖有真实风险的行为：规则优先级（更具体胜、同数后建胜）、压缩触发点计算与「永远触发不到」判定、D15 取值顺序、models.yml 定点写入（保留密钥行/注释字节、创建缺失的 `modelOverrides`、删除覆盖、解析失败自动还原）。删除只服务于旧设计的测试，不重新固定旧行为。
3. `pnpm tauri dev` 实机走查（Tauri 桌面窗口，可用 computer-use 类技能截图；**禁止** Playwright/启动浏览器）：
   - 导航「模型」组出现「上下文窗口」，位于「API 供应商」之后；Agent 组原页显示为「记忆与对话」，只有 4 段、无「其他」、无任何 compaction 项。
   - 新页顶部是自动压缩卡片；搜索 `opus` → 表格只剩匹配行、按型号分段、可见原始模型 ID；勾选段头 → 底栏出现「已选 N 个」；填 `1m` 应用 → 表格即时更新、toast 可撤销；撤销后恢复原值。
   - 调大时出现黄色警告；勾选「记住为规则」后规则出现在页面下方列表；新建与已有值冲突的规则时出现覆盖确认清单与接管提示。
   - 用一份**脱敏副本**（`.cache/<任务slug>/` 下，绝不读取或打印真实 models.yml 中的密钥）验证订阅模型写入、备份与还原；不得在用户真实 `~/.omp/agent/models.yml` 上做破坏性试验。
   - 从「API 供应商」页、会话页、斜杠命令深链能正确跳到新页对应位置。
4. 收尾：按仓库 AGENTS.md 的 AOCI 规则在最终稳定状态调用一次 `aoci_maintain`；最终报告逐项列出实现/测试/构建/Git/Contract changes 状态，以及「本次完成了 / 本次未完成」。不得 `git push`。

## 6. 已知 Unknown（执行者先用低成本探针消除）

- OMP 目录（`omp --list-models` 或 `omp models`）输出是否带上下文窗口？若带，扩展 `Model` 契约；若不带，寻找其他只读来源，仍无则 D15 跳过「目录」这一步并在报告中说明。
- 对话报错在前端的渲染位置（`src/features/chat/` 下，`MessageList.tsx` / `SessionView.tsx` 附近）。
- OMP 对 models.yml 的修改是否需要重启会话才生效；按实际情况在 UI 文案中说明「新开会话生效」或等价提示。

## 7. 风险

- models.yml 写坏会导致 OMP 跳过整个文件、所有自定义供应商失效 → 备份 + 写后校验 + 自动还原是硬要求。
- 兜底 250K 对小窗口模型偏大，可能触发超长报错 → 由 D10 警告、D11 跳转、D15 推断与「未知窗口」标红共同缓解（用户已知悉并选择 250K）。
- 规则存在 localStorage，换机/重装会丢（用户已接受）。
