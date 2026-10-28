# 模型设置状态审计

基线：`7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`。本目录只包含审计产物；产品源码、用户配置、数据库与供应商服务均未改动。

## 结论

**确认 1 项消费者可见行为缺陷：`MutationSurvives`。** 已保存的新模板列表可以被保存前开始、保存后返回的列表读取覆盖。不是推测供应商状态，不代表后端保存失败，也不是已修复问题。

### 编号路径与真实代码回放

1. 开始读取模板列表（真实 `load(true)`，IPC 暂缓返回）。
2. 保存完成后的完整新快照通过真实 `setSnapshot` 发布，订阅者看到新模板名称。
3. 先前读取返回旧快照；订阅者看到名称从 `saved-template` 回退到 `before-save`。

代码依据：`src/features/settings/modelTemplates/store.ts:46-59` 的读取只比较读取代次；`store.ts:87` 的保存结果发布不递增该代次。实际调用点是 `TemplateEditor.tsx:145-155` 和 `RulesCard.tsx:440-442`。

回放只导入并驱动真实公开 store 入口；仅 IPC 和桌面事件 I/O 使用隔离 mock。没有复制实现、源码字符串断言、真实配置写入或供应商请求。`replay.test.ts` 对消费者状态与订阅消息断言；另一个控制序列证明较新的强制读取确实能够压过更早读取。它不是桌面点击验收，也没有声称实际后端保存已执行。

`replay.log`：1 个聚焦回放通过，4 个可观察断言通过。证据：`replay-result.json`、`snapshot-out/bug-1.png`、`snapshot-out/bug-1.mmd`、`snapshot-out/stories.md`、保留的 `snapshot-out/tlc/TemplateSnapshot-MutationSurvives.out`。未制作修复模型、未修复产品。

## 有界模型与图表

下表计数均读取对应 `summary.json`，不是源码行数或估算。所有最终 PNG 均已通过图片读取打开检查；唯一缺陷编号路径按 1→2→3 顺序可读。大图保留全分辨率，`--cover` 的隐藏项逐项保留在 JSON 中。

| 模型 | 模型状态 / 转换 | 图状态 / 转换 | 隐藏状态 / 转换 | 结果 |
|---|---:|---:|---:|---|
| `TemplateSnapshot` | 10 / 12 | 6 / 9 | 0 / 0 | MutationSurvives 按预期失败 |
| `ReplaceLifecycle` | 8 / 7 | 8 / 7 | 0 / 0 | 配置的有界不变量通过 |
| `ReplaceOwnership` | 10 / 10 | 9 / 8 | 1 / 2 | 配置的有界不变量通过 |
| `TemplateSwitch` | 52 / 54 | 38 / 36 | 0 / 4 | 配置的有界不变量通过 |
| `RoleScope` | 30 / 59 | 16 / 14 | 0 / 14 | 配置的有界不变量通过 |
| `ModelCapability` | 7 / 14 | 7 / 6 | 0 / 8 | 配置的有界不变量通过 |

`ownership-out` 隐藏的唯一状态是“已返回总览；没有进行中的写入；等候重扫；显示写入错误”；失败后的重新扫描路径仍由完整图与 TLC 检查覆盖。其余省略边逐项见各自 `summary.json.cover.leftOutTransitions`。

### 模型边界（不是全程序证明）

#### TemplateSnapshot

One snapshot read, one successful save publication; reply value captured at read start; errors terminate the read. Forced-read supersession is exercised by the consumer replay, not expanded in this model.

源模型：`TemplateSnapshot.tla`；配置：`TemplateSnapshot.cfg`；中文映射：`TemplateSnapshot.map.mjs`；图表/故事/计数：`snapshot-out/`。

#### ReplaceLifecycle

One scanned stored reference with three concrete values, one apply and at most one undo. A failed compare preserves the manual value. Batch partial results, retry accumulation, history pruning and later scans are source-read-only. undoValue captures the observable value at undo return, not a promise that future external writes cannot change it.

源模型：`ReplaceLifecycle.tla`；配置：`ReplaceLifecycle.cfg`；中文映射：`ReplaceLifecycle.map.mjs`；图表/故事/计数：`replace-out/`。

#### ReplaceOwnership

One nonempty apply, one start-over navigation and one deferred rescan. Success/failure of IPC is opaque. Navigation invalidates presentation ownership but does not cancel a started backend write. Rescan failure, overlapping multiple writes, unmount and restart are read-only/out-of-model.

源模型：`ReplaceOwnership.tla`；配置：`ReplaceOwnership.cfg`；中文映射：`ReplaceOwnership.map.mjs`；图表/故事/计数：`ownership-out/`。

#### TemplateSwitch

One valid scope and one first-hit rule; quota verdict is an opaque finite input. Force is either explicit confirmation or same-scope bottom line. One atomic write with success/failure and aggregate session outcomes; current enabled auto-revert with window due is fixed eligible, then drift prevents restoration. No concurrent native writes, DB failures after file commit, scheduler time progression, multi-rule ordering or live provider probes are explored.

源模型：`TemplateSwitch.tla`；配置：`TemplateSwitch.cfg`；中文映射：`TemplateSwitch.map.mjs`；图表/故事/计数：`switch-out/`。

#### RoleScope

One global key, one existing project key, role vs named-override tables, global deletion and scope navigation. Project starts configured and is not deleted in this bound. Alias recursion, agent discovery and full override > declaration > task > session precedence are source-read-only, not fully verified by this per-layer model.

源模型：`RoleScope.tla`；配置：`RoleScope.cfg`；中文映射：`RoleScope.map.mjs`；图表/故事/计数：`scope-out/`。

#### ModelCapability

Two chat targets with disjoint supported thinking levels, one search target and one row override. Model-default is a separate no-suffix value. Other model kinds, arbitrary catalogs, capability discovery, generic role suffix syntax and provider API compatibility are source-read-only/opaque.

源模型：`ModelCapability.tla`；配置：`ModelCapability.cfg`；中文映射：`ModelCapability.map.mjs`；图表/故事/计数：`capability-out/`。

## 输入输出契约与实现观察

- 文件扫描对不存在/不可读项目逐项报告，其他扫描输入继续；扫描不等于后台配置版本锁。`model_replace.rs:318-372`。
- 批量替换逐项成功/失败；保存历史只含成功编辑；撤销调换前后值，遇后续修改跳过。链编辑集中读取/写入，失败不伪报成功。`model_replace.rs:620-725,982-1022,1114-1133`。
- 返回总览只放弃本轮 UI 结果，不取消正在进行的配置写入。成功后仍作失效刷新；写入中的重扫被延后；异常仍保留用户可见错误。`ModelReplaceDialog.tsx:114-138,207-244,290-310`。
- 应用模板会重新读取模板并重新预检，不直接执行 GUI 中旧预览；显式 force 可以越过额度拒绝。`model_templates/apply.rs:300-360`。
- 自动规则按 scope 分组、同范围首条阈值命中，切换失败不阻止其他 scope；同范围保底可强制；回落恢复还要求当前记录、启用、自动恢复、窗口满足、无漂移。模型固定这些前置资格，仅检查进入资格后的漂移门。`rules.rs:487-597,687-732`。
- 活跃会话执行属于 runtime 边界：死亡/范围外略过，生成中跳过，别名只影响新会话，按旧具体模型匹配后发送模型/思考设置，失败逐会话记录。没有执行会话 RPC。`apply.rs:491-600`。
- 模型角色按项目 key 优先；点名覆盖反而全局 key 优先。完整来源顺序为点名覆盖→代理声明→任务角色→会话；未知引用与循环不会悄悄落到后续来源。`settings_model_roles.rs:375-395,455-507,540-618`。
- 通用角色值校验允许后缀语法，不构成供应商能力认证；替换目标思考选项则来自目标目录，换类型/目标会清除不支持等级，单行覆盖重新校验。`agentModelAssignments.ts:197-234`；`ModelReplaceDialog.tsx:163-171,199-204`；`logic.ts:59-84`。
- YAML/链编辑锁、原子替换、语义/字节保护均为源码边界观察，没有真实 config 文件操作。供应商身份映射、额度报告、RPC 的下游语义没有从已安装二进制推断。

## 完整切片覆盖表

“modeled” 仍只表示该行中明确列出的有界生命周期；同一模块的未展开分支在原因中列出。read-only 和 out-of-model 不计作形式证明。

| 路径 | 功能 | 状态 | 说明 |
|---|---|---|---|
| `src-tauri/src/model_replace.rs` | Scan / guarded apply / successful-edit history / inverted undo | modeled | ReplaceLifecycle models one guarded reference and undo result; scan projects/missing/errors, schedule/app-setting backends, partial batch, chain grouping, retry append and pruning read in source but not exhaustively modeled. |
| `src-tauri/src/model_replace.rs` | Catalog and real model probes | out-of-model | Catalog is an opaque capability input. Probe runners may spend provider quota; no real probe or CLI was executed. |
| `src-tauri/src/model_templates/mod.rs` | Scope validation and command contracts | modeled | TemplateSwitch uses global/project scope and command apply/undo boundaries; capture/snapshot/CRUD remain source-read-only. |
| `src-tauri/src/model_templates/apply.rs` | Fresh preview / quota preflight / write / session results / undo | modeled | TemplateSwitch models finite preflight/write/aggregate sessions; native session switching and manual template undo are source-read-only. Apply recomputes preview (306-307); GUI preview itself is not a CAS promise. |
| `src-tauri/src/model_templates/rules.rs` | Quota rule first hit / bottom line / auto revert / poller | modeled | TemplateSwitch bounds one eligible rule per valid scope and drift gating. Ordering, notification dedupe, missing projects, polling backoff and auto-revert eligibility predicates read in source, not separately explored. |
| `src-tauri/src/model_templates/store.rs` | Template/rule/history SQLite transactions | read-only | Read schema commands/upsert semantics: scope retained on template updates, bottom-line uniqueness per scope, dependent rule deletion, ordered rules. No config or DB writes were performed. |
| `src-tauri/src/model_templates/usage.rs` | Cached quota aggregation | read-only | fetch_usage uses cached report; window percentage and exhausted-account aggregation read. The model consumes verdicts instead of running provider/CLI reports. |
| `src-tauri/src/model_templates/provider_map.rs` | Usage-slug provider mapping | read-only | Exact mapping and verbatim fallback traced only; provider identity remains an I/O boundary. |
| `src-tauri/src/settings_model_roles.rs` | Scoped role resolution and guarded YAML edits | modeled | RoleScope models project-over-global roles and global-over-project named pins. Alias cycles/unset fallback, validation, byte preservation, atomic guarded writes, legacy refusal and batching read in source only. |
| `src-tauri/src/settings_model_roles/chains.rs` | Global fallback chain splice / rename / guarded write | read-only | Fresh locked read, grouped planning, verification and atomic write inspected. No source-level assertion replay or live config write. |
| `src-tauri/src/settings_model_roles/discovery.rs` | Agent catalog precedence / discovery | read-only | Project/user/extensions/plugins/builtin discovery and first-name-wins precedence inspected; no external catalog or arbitrary directory traversal model. |
| `src/features/settings/modelReplace/ModelReplaceDialog.tsx` | Scope / scan / preview / apply / retry / undo / late navigation | modeled | ReplaceOwnership models apply success/failure and start-over ownership; ReplaceLifecycle models stale stored value and undo; ModelCapability models target/level changes. Multiwrite, history read ordering and undo navigation are not fully explored. |
| `src/features/settings/modelReplace/logic.ts` | Plan building / matching / per-row thinking sanitization | modeled | ModelCapability uses supported levels and row override sanitization; aliases/globs/provider-sensitive matching, chain dedup/conflict and full buildPlan are source-read-only. |
| `src/features/settings/modelReplace/kinds.ts` | Model-kind grouping / catalog load | read-only | Catalog kind groups, probe-kind mapping, thinking eligibility and single-flight catalog load inspected. Catalog I/O not executed. |
| `src/features/settings/modelReplace/parts.tsx` | Target group and supported thinking picker | modeled | ModelCapability covers supported options and search target conversion; popover/search/rendering is source-read-only. |
| `src/features/settings/modelReplace/ModelReplacePlanPreview.tsx` | Checkbox and row override edit | modeled | ModelCapability abstracts one same-kind override with unsupported level removal. Rendering and every row permutation remain read-only. |
| `src/features/settings/modelReplace/ModelReplaceResults.tsx` | Result / retry-failed / selected live-session switch | read-only | Failed item retry and live RPC model/thinking/get_state contracts traced; Runtime owns downstream execution state. No actual session RPCs issued. |
| `src/features/settings/modelReplace/ModelReplaceHistory.tsx` | Expanded history / skipped undo outcomes | read-only | Stored edits, restored-value presentation and per-item errors inspected; UI expansion itself is not modeled. |
| `src/features/settings/modelReplace/ModelReplaceOverview.tsx` | Usage table / probe outcome UI | read-only | Usage selection/probe pending/success/error rendering inspected. Probe invocation is out of runtime audit to avoid API cost. |
| `src/features/settings/modelReplace/store.ts` | Cross-panel invalidation revision | read-only | Invalidate role/config/settings/schedule consumers traced. Consumer stores outside this slice retain their owners. |
| `src/features/settings/modelTemplates/store.ts` | Snapshot generation / mutation publication / status reads | modeled | TemplateSnapshot exposes late pre-save read overwriting a published successful mutation; confirmed through actual public store actions. Status reads/forced supersession are source-read-only, with forced-read control replayed. |
| `src/features/settings/modelTemplates/index.tsx` | Mount refresh / subscription ownership / capture / duplicate | read-only | Subscription cancellation cleanup and editor/apply modal ownership inspected; capture/navigation interleavings not separately verified. |
| `src/features/settings/modelTemplates/TemplateEditor.tsx` | Captured/duplicate draft / save / absent vs null roles | read-only | Save publishes full backend response via setSnapshot at 153. Pending busy/escape and null/absent editor values inspected, not independently modeled. |
| `src/features/settings/modelTemplates/TemplatesCard.tsx` | Scoped listing / confirmed deletion / restore | read-only | Scope filtering, dependent-rule warning and snapshot publication inspected. Confirm dialog and backend mutation I/O are not driven. |
| `src/features/settings/modelTemplates/RulesCard.tsx` | Rule save/toggle/order / full snapshot publication | read-only | Actual save caller of publication at 440-442 traced; the model begins at its returned snapshot, not a simulated UI click. Rule validation/CRUD not replayed. |
| `src/features/settings/modelTemplates/ApplyPreview.tsx` | Preview / refused force / applying result | modeled | TemplateSwitch models quota refusal and explicit force. Preview loading and modal rendering remain source-read-only; backend recomputes preview on apply. |
| `src/features/settings/modelTemplates/SwitchLogCard.tsx` | Scoped history / confirmed manual undo | read-only | Manual undo confirmation, IPC and refresh traced. Native undo not invoked. |
| `src/features/settings/modelTemplates/logic.ts` | Scope filters / quota provider labels / rule defaults | read-only | Scope helpers and quota presentation inspected; mapping remains an opaque provider identity boundary. |
| `src/features/settings/AgentModelAssignmentsPanel.tsx` | Queued scoped reads/writes and cached snapshots | modeled | RoleScope models scoped results; source ownership checks skip old-project read publication and queue writes. Full cache warming and cross-revision races remain read-only. |
| `src/features/settings/ModelRoleTables.tsx` | Role/agent editor status and selection | read-only | useSave mount ownership, pending/saved/error states, role choices and alias presentation inspected; not rendered or formally expanded. |
| `src/features/settings/AddRoleForm.tsx` | New model-role validation / save / cancel | read-only | Name uniqueness, value requirement, pending lock, scoped write and error preservation inspected; no role definition creation is implied. |
| `src/features/settings/modelRoleScope.tsx` | Global default / session project choice / navigation | modeled | RoleScope models explicit global/project selection; source no-project disabled state and project picker fallback are read-only. |
| `src/features/settings/agentModelAssignments.ts` | Role precedence / aliases / validation / fallback helper | read-only | Frontend mirrors resolver: unknown/cycle errors do not silently fall through; alias and syntactic capability handling inspected. Full agent-resolution chain not checked by RoleScope. |
| `src/features/settings/modelRoles.ts` | Builtin roles / suffixes / fallback chain types | read-only | Explicit absent/empty/list fallback meanings and known suffix splitting inspected; role values accept suffix syntax without a catalog capability guarantee. |
| `src/features/settings/FallbackChainEditor.tsx` | Draft reorder / apply / unset / disabled chain | read-only | Committed draft resync, valid cleaned rows, mode actions and record write inspected; whole-record RPC remains I/O. |
| `src/features/settings/modelNormalization.ts` | Model selector normalization/matching helpers | read-only | Pure display/match helpers inspected; no independently changing lifecycle to statechart. |
| `src/features/settings/modelReplace/logic.test.ts` | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| `src/features/settings/modelReplace/ModelReplaceDialog.test.tsx` | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| `src/features/settings/modelTemplates/logic.test.ts` | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| `src/features/settings/AgentModelAssignmentsPanel.test.tsx` | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| `src/features/settings/AddRoleForm.test.tsx` | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| `src/features/settings/agentModelAssignments.test.ts` | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| `src/features/settings/modelRoles.test.ts` | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| `src/features/settings/FallbackChainEditor.test.tsx` | Existing regression test suite | out-of-model | Existing suites were not rerun; this audit uses one focused isolated consumer replay. Parent reports existing TS7053 in AgentModelAssignmentsPanel.test.tsx as a verification limitation, not a model finding. |
| `src/features/settings/FallbackChainsSection.tsx` | Global chain listing / cycle order / config reload | read-only | Read-only global fallback UI: role grouping, unset/empty/list inheritance hints, reload on save and shared cycle editor traced. Upstream runtime fallback algorithm stays opaque. |
| `src/features/settings/ModelRulesSection.tsx` | Model/provider fallback rule drafts / delete | read-only | Draft add validation, duplicate keys, confirmed deletion and full retry.fallbackChains write traced; not exhaustively modeled. |
| `src/features/settings/FallbackSwitchesCard.tsx` | Fallback switches / quota reserve policy | read-only | Pending lock, save/reload, master-disabled controls, usage-aware policy and percentage commit traced; runtime cooldown/fallback execution remains external. |
| `src/features/settings/fallbackSwitches.ts` | Fallback enum defaults / reserve validation | read-only | Pure enum narrowing and finite numeric 0..100 validation read; no independent runtime lifecycle. |
| `src/components/ModelSelect.tsx` | Role-backed selection boundary | read-only | Role override/global store loading and selected-role display path inspected. Generic picker, catalog refresh and live model application belong to their separate owners, not reimplemented here. |

## 复生成与回放

使用已存在的本地 Java/TLC/renderer，不安装依赖。复生成脚本会把输出默认放到新的系统临时目录；不要把 TLC 工作目录写入产品仓库。脚本和模型使用相对切片依赖，可整体搬迁。所有已知失败规则都显式传入 `--expect-broken MutationSurvives`；其余模型不接受任何失败。

```sh
STATECHART_SCRIPT="$HOME/.agents/skills/statechart/scripts/statechart.mjs" \
TLA2TOOLS="$HOME/.cache/statechart/tla2tools.jar" \
JAVA="<JAVA>" \
node regenerate.mjs /tmp/omp-model-settings-output

OMP_REPO=/absolute/path/to/read-only/checkout node replay.mjs
```

`regenerate.mjs` 是英文说明的复生成入口；每个精确命令另见 `result.json.models[].regenerate`。`replay.mjs` 临时创建切片内 node_modules 链接以复用现有依赖，结束会移除；不复制或安装依赖。回放只运行自己的隔离测试。

## 检查、限制和未完成项

- `citation-check.json`：六个输入模型的 source guard 检查均无未引用条件。注释指向原始文件/行，并解释抽象/有界输入。
- 首轮建模中发现并纠正了模型自身的字符串编码、返回值观察点与类型域错误；它们不列为产品发现，也未加入 expect-broken。值撤销模型限定一次扫描/应用，避免把后续重扫误当仍持有原始扫描值。
- 聚焦回放的准备过程遇到独立 bundler 不支持 Vite glob、临时路径规范化和重复订阅通知等测试工具问题；最终改用仓库已有 Vitest/Vite，成功日志为 `replay.log`。这些不是产品问题。
- 未运行完整测试、构建、lint、formatter、真实供应商探测或本地配置/数据库写入。
- 主代理报告既有 `AgentModelAssignmentsPanel.test.tsx` TS7053，属于基线验证限制；没有再次确认、修复或完整 typecheck。
- 原生 Tauri、真实会话 RPC、真实文件系统竞争、进程重启、quota poller 时间推进、任意规模目录/链/模板集合没有动态验收；完整范围和每个模型的限制已明确列出。
- 本次未完成：产品修复与修复模型（任务仅授权审计）；未把代码阅读覆盖夸称全程序验证。
- 产物阻塞：无。主代理负责最终整合、搬迁后统一再生成和发布。
