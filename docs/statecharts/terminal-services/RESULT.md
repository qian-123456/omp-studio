# 终端、后台服务与文件缓存状态审计

基线：`7f85613a5ce16cae7ed5e0e3d24b51ecb4454658`。本切片只写外部审计目录，未修改产品代码。

## 交付与边界

五个独立有限模型：抽屉终端、会话终端登记、服务列表请求、同路径文本保存、剪贴板附件命名。运行命令为 `./regenerate.sh`；需要共享 Java/TLC 环境。每个输出目录保留 `chart.mmd`、`chart.png`、`stories.md`、`summary.json`、编号缺陷路径图及 TLC 证据。未建修复模型，所有问题均未产品修复。

所有异步一致性规则均以 `Settled == ~ENABLED System` 判断，不把在途退出通知造成的正常短暂延迟算作缺陷。文件模型则在两次调用均返回后判断。模型中的次数上限是显式有限抽象，不是声称源码存在的防护。所有动作守卫引用检查结果见 `logs/uncited.log`：五个模型均为空。规则各个合取分支也补充对应源码行。

## 模型规模

| 模型 | 具体状态/转换 | 图状态/转换 | 限制 |
|---|---:|---:|---|
| DrawerTerminal | 1058/5828 | 67/66 | 单标签、至多一代在途启动、至多三代进程；事件交错通过 I/O 替身重放，未证明原生事件传输实际排序。 |
| SessionTerminal | 12/22 | 12/22 | 单会话与单个开启操作；原生会话删除/开启竞态未实际重放。 |
| ServicesPanelPoll | 23/35 | 14/29 | 至多两次切换、三个在途请求和一次变更事件；未实际组件重放。 |
| FileWriteRace | 19/18 | 16/18 | 两次同路径写入；字节写入原子化，真实写入可能有更多交错；仅重放真实文件函数而非完整 IPC。 |
| ClipboardNameCollision | 9/8 | 9/8 | 两个同名文件；毫秒碰撞作为外部输入；真实函数重放而非剪贴板 GUI。 |

数字直接取自各输出 `summary.json`。抽屉图使用 `--cover`，总览省略991个具体状态；不是完整状态图。状态投影可能包含 mixed 分类，详见对应 summary。全部生成图已目视检查。

## 发现与编号路径

TLC 所有预计不成立的不变量都通过 `--expect-broken` 明确登记。类型检查不是预计失败。下列步骤为读者摘要，逐步编号以对应 `out/*/stories.md` 和 `bug-*.png` 为准。

### 1. 启动响应前退出事件被消费，响应后标签持续显示运行中 — `ReadyMeansAlive`

分类：**reproduced consumer behavior**；模型 `DrawerTerminal`。

路径：打开终端 → 进程退出通知先到达 → 启动请求才返回 → 所有通知处理完毕，标签仍运行中。

真实组件重放通过；只证明给定事件顺序下的消费者行为，不证明原生传输必然发生该顺序。

证据：`replay/drawer-terminal.replay.test.tsx:126-143`、`logs/replay-js.log`、`src/features/terminal/drawerRegistry.ts:58-63`、`src/features/terminal/CommandTerminalPanel.tsx:248-259`。

修复状态：未建修复模型；产品未修改。

### 2. 启动失败后重试不触发新启动 — `OpeningMakesProgress`

分类：**reproduced consumer behavior**；模型 `DrawerTerminal`。

路径：打开终端失败 → 点击重试 → 显示连接中但没有新启动请求。

真实组件重放通过；观察窗口300毫秒，依赖未变化由源码补充证明。

证据：`replay/drawer-terminal.replay.test.tsx:162-178`、`logs/replay-js.log`、`src/features/terminal/CommandTerminalPanel.tsx:275-316`。

修复状态：未建修复模型；产品未修改。

### 3. 启动响应前的数据被桥丢弃 — `OutputNotLost`

分类：**reproduced consumer behavior**；模型 `DrawerTerminal`。

路径：打开终端 → 响应前第一段数据到达 → 响应返回 → 后续数据可写入但第一段未出现。

真实组件和注册表重放通过；画布 write 为输出边界替身，原生事件顺序未验证。

证据：`replay/drawer-terminal.replay.test.tsx:145-160`、`logs/replay-js.log`、`src/features/terminal/drawerRegistry.ts:47-54`。

修复状态：未建修复模型；产品未修改。

### 4. 退出发生在会话登记之前可留下已死终端登记 — `RecordMeansAlive`

分类：**trace-and-source-only hypothesis**；模型 `SessionTerminal`。

路径：打开会话终端 → 进程退出，移除尚不存在的登记 → 开启操作随后写入登记。

未原生重放；需要可控 PTY 与会话命令调度，不算确认缺陷。

证据：`out/session-terminal/stories.md`、`src-tauri/src/terminal/commands.rs:56-57`、`src-tauri/src/terminal/commands.rs:216-218`。

修复状态：未建修复模型；产品未修改。

### 5. 会话删除与终端登记交错可遗留进程 — `DeletedSessionHasNoTerminal`

分类：**trace-and-source-only hypothesis**；模型 `SessionTerminal`。

路径：开始打开会话终端 → 登记前删除会话 → 开启操作继续写入登记。

未原生重放；不算确认缺陷。

证据：`out/session-terminal/stories.md`、`src-tauri/src/catalog/mod.rs:635-672`、`src-tauri/src/terminal/commands.rs:29-32`、`src-tauri/src/terminal/commands.rs:216-218`。

修复状态：未建修复模型；产品未修改。

### 6. 较早请求晚返回覆盖当前开关列表 — `RowsMatchToggle`

分类：**trace-and-source-only hypothesis**；模型 `ServicesPanelPoll`。

路径：切换到全部 → 切回仅开发服务 → 新请求先完成 → 旧请求最后完成。

模型和源码证据；未真实组件重放，不算确认缺陷。

证据：`out/services-poll/stories.md`、`src/features/services/ServicesPanel.tsx:48-67`。

修复状态：未建修复模型；产品未修改。

### 7. 成功保存的内容可能不是最后落盘内容，即使另一次保存报错 — `SuccessIsWhatLanded`

分类：**reproduced consumer behavior**；模型 `FileWriteRace`。

路径：两个写入共用进程号临时文件 → 后一次写入覆盖临时内容 → 第一次替换成功 → 第二次替换报错但其内容已落盘。

真实 files::write_text 并发重放300轮：297轮有失败，292轮成功调用与落盘内容不一致且失败调用内容落盘；完整 IPC/UI 未重放。

证据：`replay/rust/src/main.rs`、`logs/replay-rust.log`、`src-tauri/src/services/files.rs:85-93`。

修复状态：未建修复模型；产品未修改。

### 8. 报错的保存仍可能覆盖文件 — `FailedSaveDidNotLand`

分类：**reproduced consumer behavior**；模型 `FileWriteRace`。

路径：两个写入共用进程号临时文件 → 后一次写入覆盖临时内容 → 第一次替换成功 → 第二次替换报错但其内容已落盘。

真实 files::write_text 并发重放300轮：297轮有失败，292轮成功调用与落盘内容不一致且失败调用内容落盘；完整 IPC/UI 未重放。

证据：`replay/rust/src/main.rs`、`logs/replay-rust.log`、`src-tauri/src/services/files.rs:85-93`。

修复状态：未建修复模型；产品未修改。

### 9. 同毫秒同名缓存文件覆盖早先附件字节 — `EachAttachmentKeepsItsBytes`

分类：**reproduced consumer behavior**；模型 `ClipboardNameCollision`。

路径：保存第一个同名附件 → 同毫秒保存第二个附件 → 两次返回同路径，第一份字节被替换。

真实 save_clipboard_file_internal 连续2000对保存：1834对同路径且首份字节被替换；Tauri宏/未触及缓存路径解析是边界替身，GUI未重放。

证据：`replay/rust/src/main.rs`、`logs/replay-rust.log`、`src-tauri/src/services/clipboard.rs:228-231`。

修复状态：未建修复模型；产品未修改。

## 重放解释

`logs/replay-js.log`：真实 CommandTerminalPanel、注册表、标签 store 与关闭入口，共4个通过的测试。Tauri invoke/listen、xterm画布为外部I/O替身。既复现三个问题，也验证启动在途关闭后返回的终端会被关闭。事件先于响应的排序是注入条件，原生运行时是否出现该排序尚未重放；消费者丢弃通知/输出则已重放，不能混为全原生复现。

`logs/replay-rust.log`：通过 Rust `#[path]` 导入真实源文件，未复制实现。Tauri命令宏和未触及的缓存目录接口为最小边界替身。文本写入调用实际 `files::write_text`；附件缓存调用实际 `save_clipboard_file_internal`。临时数据只在系统临时目录创建并清理。统计是该次观察，不是发生概率估计。完整 IPC、GUI和操作系统剪贴板未重放。

这些测试断言已有缺陷表现，均是**复现证据**，不是通过了产品期望行为的验收。会话竞态和服务列表乱序未重放，明确保持源码与模型假设。没有源码文本断言测试。

## 验证命令

- `./regenerate.sh (TLA2TOOLS/JAVA 环境已指定)`：退出 `0`。五个模型各自退出0；预期破坏规则单独登记，TypeOK未作为预期失败。
- `node logs/uncited.mjs`：退出 `0`。五个模型未引用条件均为空；最后仅补充源码注释，未改变模型语义。
- `./node_modules/.bin/vitest run --config <scratch>/terminal-services/replay/vitest.config.mts --root .`：退出 `0`。1文件4测试通过；复现证据而非产品验收。
- `cargo run --offline --release (replay/rust)`：退出 `0`。真实文件函数与剪贴板保存函数复现，详见 logs/replay-rust.log。

图形生成日志见 `logs/*terminal.log`、`logs/services-poll.log`、`logs/file-write-race.log`、`logs/clipboard-name.log` 与 `logs/regenerate.log`。最后修改仅为模型源码注释，无语义变化。

## 全部拥有文件与边界覆盖

覆盖状态为 modeled（部分操作建模）、read-only（只读审阅边界）或 out-of-model（明确不宣称覆盖）。不把读过文件等同于验证文件所有行为。

| 文件 | 状态 | 原因 |
|---|---|---|
| `src-tauri/src/terminal/commands.rs` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src-tauri/src/terminal/pty.rs` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src-tauri/src/terminal/shell_init.rs` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src-tauri/src/terminal/mod.rs` | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| `src-tauri/src/terminal/extension.rs` | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| `src-tauri/src/terminal/env.rs` | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| `src-tauri/src/services/commands.rs` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src-tauri/src/services/perf.rs` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src-tauri/src/services/clipboard.rs` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src-tauri/src/services/files.rs` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src-tauri/src/services/trash.rs` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src-tauri/src/services/mod.rs` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src-tauri/src/services/scan.rs` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src/features/terminal/CommandTerminalPanel.tsx` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src/features/terminal/drawerRegistry.ts` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src/features/terminal/drawerStore.ts` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src/features/terminal/terminalTabs.ts` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src/features/terminal/terminalTheme.ts` | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| `src/features/terminal/terminalTheme.test.ts` | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| `src/features/terminal/drawerStore.test.ts` | out-of-model | 不纳入有限状态模型，未做独立行为验证 |
| `src/features/services/ServicesPanel.tsx` | modeled | 仅对应模型所列操作，不包括该文件全部行为 |
| `src/components/BottomBar.tsx` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src/features/chat/Composer.tsx` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src-tauri/src/catalog/mod.rs` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src-tauri/src/lib.rs` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |
| `src/lib/ipc.ts` | read-only | 只读审阅，不宣称状态不变量覆盖；扫描、停止进程、性能采样、回收站和 shell 初始化未建模 |

## 本次未完成/不宣称

没有产品修复，没有原生 PTY/GUI重放，没有完整项目测试；服务停止/孤儿清理、进程树扫描、性能轮询、系统回收站、终端环境/扩展注入、主题、搜索与剪贴板交互等未做独立状态验证。已提供全部模型/图/证据，没有缺失生成物阻塞。有限模型内未破坏的 `NoLeakAfterClose` 和 `ExitedMeansNotAlive` 不是全产品证明。跨切片会话删除仅作为输入契约，未替运行时切片证明其内部状态。
