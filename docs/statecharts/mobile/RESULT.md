# 手机端状态图审计

本片只做审计，不修改产品。基线：`7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`。这是五个有限抽象，不是整个手机客户端的形式化证明。覆盖表对所有分配目录都作登记；登记不等于其每个交互都已经建模。

## 结果与边界

- 连接、发送所有权、审批快照、配对推送、服务/隧道/域名分别建模，避免把互相独立的生命周期乘成一个大状态空间。
- 所有类型规则保持；12 条期望规则在现有行为模型中出现反例。没有修复产品，也没有修复后模型。
- 实际导入 `startEvents`、`useConnection`、`ChatController`、`pairWithCode` 的隔离回放：3 个文件、6 个测试通过。测试断言的是问题行为，**不是期望合同验收通过**。浏览器事件与 HTTP 是外部输入替身，未启动真实服务。
- 两个连接反例、超时恢复与重复请求、无编号批量请求、较旧审批快照复活有客户端复现。服务器真正执行两次任务、真正回答未见审批，以及链接预览、推送、隧道与证书问题没有原生端到端复现。
- `NoPushWhileViewing` 的环境假设是客户端没有上报前台会话：`src-mobile` 查找 presence 没有命中；这不是实际推送投递证据。

## 模型与图

|模型|模型状态/转换|显示状态/转换|省略的投影状态/转换|
|---|---:|---:|---:|
|[MobileConn](MobileConn/chart/chart.png)|79/257|27/27|34/169|
|[MobilePrompt](MobilePrompt/chart/chart.png)|18/28|17/27|无裁剪|
|[MobilePending](MobilePending/chart/chart.png)|3934/12088|13/12|473/2933|
|[MobilePairing](MobilePairing/chart/chart.png)|960/4244|171/320|无裁剪|
|[MobileInfra](MobileInfra/chart/chart.png)|192/1022|65/65|103/864|

计数直接来自对应 `summary.json`。模型状态与面向读者投影状态不是同一数量。配对图存在并行区域，工具未能应用 cover；总览很宽，优先顺序阅读其三张 `bug-N.png` 和 `stories.md`。五张总览及十二张反例 PNG 均已打开检查。

## 规则与复现

### BannerMatchesStream：网络恢复后横幅仍显示断开

- 证据分类：reproduced consumer behavior。
- 路径：启动 → 问候 → 离线 → 在线。
- 源码：src-mobile/core/sse.ts:101-109,190-191。
- 回放：replay/conn.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。
- 反例：[故事](MobileConn/chart/stories.md)。

### UnauthorizedSticky：离线事件覆盖未授权状态

- 证据分类：reproduced consumer behavior。
- 路径：标记未授权 → 离线。
- 源码：src-mobile/core/sse.ts:190-191; src-mobile/core/api.ts:39。
- 回放：replay/conn.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。
- 反例：[故事](MobileConn/chart/stories.md)。

### RestoredMeansNotSent：超时恢复输入不代表服务器未接收

- 证据分类：reproduced consumer behavior。
- 路径：发送 → 服务器接收 → 响应超时 → 恢复原文。
- 源码：src-mobile/features/chat/chatStore.ts:579-610; src-tauri/src/mobile/api/chat.rs:465-488。
- 回放：replay/chat.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。
- 反例：[故事](MobilePrompt/chart/stories.md)。

### NoDuplicatePrompt：超时后再次发送同一原文形成两个请求

- 证据分类：reproduced consumer behavior。
- 路径：前一路径 → 再次发送。
- 源码：src-mobile/features/chat/chatStore.ts:601-607。
- 回放：replay/chat.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。
- 反例：[故事](MobilePrompt/chart/stories.md)。

### BatchOnlyAnswersSeen：全部允许请求不携带屏幕上的审批编号

- 证据分类：reproduced consumer behavior。
- 路径：显示请求一 → 服务器新增请求二 → 全部允许。
- 源码：src-mobile/features/chat/chatStore.ts:522; src-tauri/src/mobile/api/chat.rs:577-607。
- 回放：replay/chat.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。
- 反例：[故事](MobilePending/chart/stories.md)。

### NoAnsweredCardShown：较旧快照晚到使已回答卡片复活

- 证据分类：reproduced consumer behavior。
- 路径：发出列表请求 → 回答卡片 → 较旧响应返回。
- 源码：src-mobile/features/chat/chatStore.ts:378-393。
- 回放：replay/chat.replay.test.ts；六个通过用例是缺陷复现证据，不是期望合同已满足。仅验证客户端行为；服务器执行、完整批量审批和真实浏览器状态未执行。
- 反例：[故事](MobilePending/chart/stories.md)。

### OnlyPhonePairs：配对 GET 可被非手机访问消耗

- 证据分类：trace-and-source-only hypothesis。
- 路径：生成配对码 → 链接预览访问 GET。
- 源码：src-tauri/src/mobile/server.rs:250-276; src-tauri/src/mobile/auth.rs:45。
- 回放：未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。
- 反例：[故事](MobilePairing/chart/stories.md)。

### NoPushWhileViewing：前台查看状态未上报时仍可能推送

- 证据分类：trace-and-source-only hypothesis。
- 路径：配对 → 订阅 → 查看会话 → 产生审批。
- 源码：src-tauri/src/mobile/push.rs:431-439; src-tauri/src/mobile/api/push.rs。
- 回放：未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。
- 反例：[故事](MobilePairing/chart/stories.md)。

### NoApprovalDropped：同一会话短时间的后续审批可能被去重

- 证据分类：trace-and-source-only hypothesis。
- 路径：订阅 → 审批一 → 30 秒内审批二。
- 源码：src-tauri/src/mobile/push.rs:635-648。
- 回放：未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。
- 反例：[故事](MobilePairing/chart/stories.md)。

### TunnelNeedsServer：停止服务后在途隧道仍能上线

- 证据分类：trace-and-source-only hypothesis。
- 路径：启动服务 → 开始隧道 → 停止服务 → 隧道就绪。
- 源码：src-tauri/src/mobile/tunnel.rs:151-271; src-tauri/src/mobile/mod.rs:144-186。
- 回放：未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。
- 反例：[故事](MobileInfra/chart/stories.md)。

### NoOrphanTunnel：并发启动可能遗留未登记隧道进程

- 证据分类：trace-and-source-only hypothesis。
- 路径：两次启动 → 各自就绪 → 停止已登记隧道。
- 源码：src-tauri/src/mobile/tunnel.rs:151-271。
- 回放：未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。
- 反例：[故事](MobileInfra/chart/stories.md)。

### LinkCoveredByCert：运行时修改 DDNS 域名后证书可能不匹配

- 证据分类：trace-and-source-only hypothesis。
- 路径：IPv6 启动 → 修改域名 → 后台同步。
- 源码：src-tauri/src/mobile/mod.rs:188-249; src-tauri/src/mobile/tls.rs。
- 回放：未运行原生/网络入口；只有 TLC 路径和源码，未确认真实运行缺陷。
- 反例：[故事](MobileInfra/chart/stories.md)。

## 模型之外的实现观察

真实 `pairWithCode` 在已有可访问 sessions 的情况下，只根据 iframe load 后的 sessions 成功返回 true。回放向 iframe 注入 load，并使用 2xx sessions 输入，因此确认的是**客户端无法区分当前配对成功与旧 cookie 已有效**，不是服务器接受了无效配对码；见 `replay/pair.replay.test.ts`。

## 全分配面覆盖登记

|路径|功能|状态|说明|
|---|---|---|---|
|src-mobile/core|连接、配对、API、会话列表|modeled|连接/请求/审批进入五个有界模型；规范化、偏好和普通导航不在模型内。|
|src-mobile/app|应用外壳、连接横幅、路由|read-only|连接横幅由真实 store 回放；路由、主题、视口与错误边界未建独立模型。|
|src-mobile/features/chat|发送、审批、历史与输入工具|modeled|发送所有权和审批快照有模型及真实 ChatController 回放；语音、附件、草图、模型选择和转录渲染未穷举。|
|src-mobile/features/sessions|列表、树、搜索、新建会话|out-of-model|会话列表作为连接恢复输入边界；独立导航、新建、删除和撤销未建模。|
|src-mobile/features/settings|模型设置、通知、配额、设置面板|out-of-model|推送订阅属于配对模型；其他设置应用/撤销由 model-settings/settings-skills/privacy-providers 边界承接，移动端面板自身竞态未建模。|
|src-mobile/features/panels|文件、git、终端、计划、侧聊、服务|out-of-model|请求结果为 git-files/runtime/terminal-services 外部契约；移动端轮询、切页、取消未穷举。|
|src-mobile/features/subagents|子代理轮询和展示|read-only|阅读 poller.ts；运行状态为 runtime 输入，未建立独立轮询模型。|
|src-mobile/features/more|想法、定时任务、技能、草图|out-of-model|automation/settings-skills 提供外部操作契约；移动端编辑与保存时序未建模。|
|src-mobile/ui|通用控件与渲染|out-of-model|不将样式或纯渲染当生命周期；对话框、底部面板、刷新和可视化桥未做独立状态证明。|
|src-mobile/styles|CSS|out-of-model|样式无独立执行生命周期。|
|src-mobile/sw.ts|通知点击和目标解析|read-only|阅读入口；未模拟浏览器 worker、缓存或真实通知点击。|
|src-mobile/main.tsx|应用启动|read-only|阅读启动和配对入口；没有浏览器端启动验收。|
|src-mobile/.cache|构建缓存|out-of-model|缓存产物不作为源代码证明。|
|src-tauri/src/mobile/auth.rs|单次配对和撤销|modeled|绑定配对模型；SQLite 和原生 HTTP 未执行。|
|src-tauri/src/mobile/server.rs|路由、认证、SSE|modeled|配对及 SSE 契约；原生网络未启动。|
|src-tauri/src/mobile/api/chat.rs|发送和审批 API|modeled|发送及批量审批模型；上游运行时视为边界，不推断其内部。|
|src-tauri/src/mobile/push.rs|订阅、在线标记、推送去重|modeled|配对推送模型；无实际推送投递。|
|src-tauri/src/mobile/api/push.rs|推送端点|modeled|订阅和前台状态接口进入配对模型；无 native replay。|
|src-tauri/src/mobile/mod.rs|服务运行/停止、IPv6|modeled|基础设施模型；未启停真实服务。|
|src-tauri/src/mobile/tunnel.rs|隧道进程生命周期|modeled|启动/停止抽象为异步动作；未创建隧道进程。|
|src-tauri/src/mobile/ddns.rs|DDNS 同步|modeled|基础设施模型中抽象域名同步成功；提供商 HTTP 不在模型内。|
|src-tauri/src/mobile/tls.rs|证书生成|read-only|域名证书关系进入基础设施模型；加密和真实证书未验证。|
|src-tauri/src/mobile/commands.rs|桌面命令适配|read-only|阅读命令到服务入口；设置 UI 自身未建模。|
|src-tauri/src/mobile/assets.rs|静态资源发布|read-only|实际读取 mobile-dist；不是 legacy mobile 目录。|
|src-tauri/src/mobile/ipv6.rs|地址发现|out-of-model|网络环境输入；未运行接口发现。|
|src-tauri/src/mobile/backend.rs|后端能力适配|out-of-model|属于 runtime 等外部契约。|
|src-tauri/src/mobile/last.rs|上次访问持久化|out-of-model|独立持久化覆盖与排序未建模。|
|src-tauri/src/mobile/tests.rs|原生已有测试|out-of-model|本次未执行 cargo 测试。|
|src-tauri/src/mobile/api|其他 API：draft/files/ideas/left/media/misc/quota/voice|out-of-model|聊天与推送除外；其他 API 作为外部业务边界，未覆盖原生副作用、语音和媒体。|
|src-tauri/mobile|旧版静态客户端|out-of-model|目录仍存在；assets.rs:15 与 vite.mobile.config.ts:23 指向 mobile-dist。旧版代码未建模。|
|src/features/mobile/MobilePanel.tsx|桌面手机连接设置|out-of-model|目录仍存在，935 行；原生命令属于本片，但面板表单状态/设置竞态未建模。|
|vite.mobile.config.ts|移动构建及 worker 入口|read-only|构建输出 mobile-dist 与 sw 独立入口；未做构建。|

外部运行时执行、git/文件编辑、终端进程、模型设置、隐私提供商与计划调度仅按各所属切片的输入/输出契约处理。本片未推断其内部成功或失败语义。旧 `src-tauri/mobile` 静态目录确实存在，但当前资源读取来自 `mobile-dist`；未假定旧目录仍被发布。

## 重生成与证据

```sh
export TLA2TOOLS=/path/to/tla2tools.jar
export JAVA=/path/to/java
./regen.sh
node check-citations.mjs conn/MobileConn.tla chat/MobilePrompt.tla chat/MobilePending.tla pairing/MobilePairing.tla infra/MobileInfra.tla
# From the repository root; install nothing into the audited repository.
OMP_REPO="$PWD" ./node_modules/.bin/vitest run --config /path/to/mobile/replay/vitest.config.ts
```

`regen.sh` 以当前脚本目录定位模型；`STATECHART` 可指定技能入口。引用检查器当前从用户技能目录导入 lib.mjs，迁移机器时须更新其导入路径。回放配置最终从 `OMP_REPO` 或 cwd 确定源码根目录，从自身目录确定测试位置。该最终配置已从仓库根目录以 `./node_modules/.bin/vitest run --config <scratch>/mobile/replay/vitest.config.ts` smoke：exit 0，3 files / 6 tests passed（23:03:34；2.35s）。`replay/replay.log` 保留原绝对路径配置的逐用例输出；最终配置输出见 `replay/portable-smoke.log`。这只验证真实客户端与 mock I/O 的事件顺序，不代表真实 HTTP、服务器执行或原生网络行为被验证。回放目录的 `node_modules` 是本地运行用链接，不应作为发布依赖。

TLC 五模型重生成 exit 0，连接 cover 单独重生成 exit 0。`regen.log`、`conn/regen.log`、各 out/tlc 保留真实日志；每个 `.tla` 的条件引用检查均返回 `[]`。语法引用通过不代表每个抽象和引用行都被独立证明。未运行全量测试、构建、格式化、真实浏览器、原生服务器、隧道、推送投递、DDNS 提供商或真实用户数据操作。
