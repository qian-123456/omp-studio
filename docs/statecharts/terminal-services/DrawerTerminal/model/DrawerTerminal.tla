---------------------------- MODULE DrawerTerminal ----------------------------
\* 抽屉终端：单个标签页的 标签状态 / xterm 注册表条目 / 后端 PTY / 退出事件 生命周期。
\* 模型描述现有代码（from-spec）。每个变量/动作对应源码名称，每个守卫尾部给出 文件:行号。
\* 代码根目录: omp-workspace/.worktrees/bug-fix (HEAD 7f85613)。
\* 范围: 单个标签页；同一时刻至多一代挂起的 termOpen；多标签/搜索/复制粘贴/主题为只读排除项。
EXTENDS Naturals

VARIABLES
  tab,          \* drawerStore.ts DrawerTab.status 加 "none"(已移除)
  detached,     \* drawerStore.ts DrawerTab.detached
  panelMounted, \* CommandTerminalPanel 是否挂载（右侧面板选中“终端”）
  effectDue,    \* CommandTerminalPanel.tsx:275 effect 的依赖是否发生了变化、尚未执行
  entry,        \* drawerRegistry.ts DrawerTerminalEntry.phase，"none"=没有条目
  knownGen,     \* entry.termId 对应的 PTY 代号（0=termId 仍为 null）
  ptyGen,       \* 后端最近一次启动的 PTY 代号（对应一个 termId）
  spawn,        \* termOpen 是否仍在等待 (CommandTerminalPanel.tsx:248)
  pty,          \* pty.rs registry 中进程状态: none/alive/dead
  exitGen,      \* 已发出尚未被 drawerRegistry 桥处理的 terminal:exit 属于哪个 PTY 代号（0=没有）
  printed,      \* shell 是否已经输出过第一段数据
  outputLost    \* 第一段输出是否在条目认识 termId 之前被桥丢弃

vars == <<tab, detached, panelMounted, effectDue, entry, knownGen, ptyGen, spawn, pty, exitGen, printed, outputLost>>

Tabs == {"none", "opening", "ready", "exited", "error"}
Ptys == {"none", "alive", "dead"}

TypeOK ==
  /\ tab \in Tabs
  /\ detached \in BOOLEAN
  /\ panelMounted \in BOOLEAN
  /\ effectDue \in BOOLEAN
  /\ entry \in Tabs
  /\ knownGen \in 0..3
  /\ ptyGen \in 0..3
  /\ spawn \in {"none", "pending"}
  /\ pty \in Ptys
  /\ exitGen \in 0..3
  /\ printed \in BOOLEAN
  /\ outputLost \in BOOLEAN

Init ==
  /\ tab = "none"
  /\ detached = FALSE
  /\ panelMounted = FALSE
  /\ effectDue = FALSE
  /\ entry = "none"
  /\ knownGen = 0
  /\ ptyGen = 0
  /\ spawn = "none"
  /\ pty = "none"
  /\ exitGen = 0
  /\ printed = FALSE
  /\ outputLost = FALSE

\* ---------------- 读者动作（用户或外部世界） ----------------

\* 打开右侧终端面板: 面板挂载并在没有可见标签时补建一个标签。
OpenPanel ==
  /\ ~panelMounted                         \* CommandTerminalPanel.tsx:117 面板在未挂载时才会挂载
  /\ (tab = "none" => spawn = "none")      \* CommandTerminalPanel.tsx:248 MODEL BOUND: 单次启动抽象，非源码守卫
  /\ panelMounted' = TRUE                  \* CommandTerminalPanel.tsx:117 挂载 effect 执行
  /\ effectDue' = TRUE                     \* CommandTerminalPanel.tsx:305 挂载等同依赖变化
  /\ tab' = IF tab = "none" THEN "opening" ELSE tab  \* CommandTerminalPanel.tsx:119 无可见标签则 addTerminalTab (drawerStore.ts:113)
  /\ UNCHANGED <<detached, entry, knownGen, ptyGen, spawn, pty, exitGen, printed, outputLost>>

\* 关闭面板（右侧换到别的页签）: xterm/PTY 留在注册表里继续运行。
ClosePanel ==
  /\ panelMounted                          \* CommandTerminalPanel.tsx:1-9 面板卸载只发生在已挂载时
  /\ panelMounted' = FALSE                 \* drawerRegistry.ts:1-9 卸载不销毁终端
  /\ effectDue' = FALSE                    \* 卸载后 effect 不再运行
  /\ UNCHANGED <<tab, detached, entry, knownGen, ptyGen, spawn, pty, exitGen, printed, outputLost>>

\* 在标签之间切换后回到本标签: 依赖 activeTabId 变化，effect 再次运行。
SwitchTab ==
  /\ panelMounted                          \* CommandTerminalPanel.tsx:275 effect 只在面板挂载时运行
  /\ tab # "none"                          \* CommandTerminalPanel.tsx:279 找不到标签则 return
  /\ ~detached                             \* CommandTerminalPanel.tsx:276 activeTabVisible 才继续
  /\ effectDue' = TRUE                     \* CommandTerminalPanel.tsx:305 依赖 activeTabId 变化 (drawerStore.ts:130 setActive)
  /\ UNCHANGED <<tab, detached, panelMounted, entry, knownGen, ptyGen, spawn, pty, exitGen, printed, outputLost>>

\* 用户在 shell 里输入 exit，或进程崩溃: 读线程读到 EOF，登记表移除，发出退出事件。
PtyExit ==
  /\ pty = "alive"                         \* pty.rs:165-169 读线程在子进程结束后得到 EOF
  /\ pty' = "dead"                         \* pty.rs:171 registry().lock().remove(&tid)
  /\ exitGen' = ptyGen                     \* pty.rs:172 sink(&tid, TermEvent::Exit(code)) 然后 commands.rs:60 emit terminal:exit
  /\ UNCHANGED <<tab, detached, panelMounted, effectDue, entry, knownGen, ptyGen, spawn, printed, outputLost>>

\* 用户点击标签上的关闭按钮（忽略确认对话框，已确认）。
CloseTab ==
  /\ tab # "none"                          \* terminalTabs.ts:83 entry 可为空，标签必须存在才能被点击关闭
  /\ tab' = "none"                         \* terminalTabs.ts:96 removeTab (drawerStore.ts:119-128)
  /\ entry' = "none"                       \* drawerRegistry.ts:83 drawerRegistry.delete
  /\ knownGen' = 0                    \* drawerRegistry.ts:83 条目被销毁
  /\ pty' = IF knownGen # 0 THEN "none" ELSE pty   \* drawerRegistry.ts:81 仅当 termId 已知才 termClose
  /\ detached' = FALSE                     \* drawerStore.ts:122 标签被删除
  /\ effectDue' = FALSE                    \* 标签不存在，effect 无事可做
  /\ panelMounted' = FALSE                 \* terminalTabs.ts:97 这是最后一个标签时关闭终端页签
  /\ UNCHANGED <<ptyGen, spawn, exitGen, printed, outputLost>>

\* 把标签折叠成后台服务（detach）。
DetachTab ==
  /\ tab # "none"                          \* terminalTabs.ts:72 对存在的标签操作
  /\ ~detached                             \* drawerStore.ts:139 已折叠的不再出现在面板里
  /\ detached' = TRUE                      \* drawerStore.ts:141 tabs.map detached:true
  /\ panelMounted' = FALSE                 \* terminalTabs.ts:75-76 没有可见标签则关闭面板（单标签模型）
  /\ effectDue' = FALSE                    \* 面板卸载
  /\ UNCHANGED <<tab, entry, knownGen, ptyGen, spawn, pty, exitGen, printed, outputLost>>

\* 在服务面板里重新接回折叠的终端并打开终端页签。
ReattachTab ==
  /\ tab # "none"                          \* ServicesPanel.tsx:171 对存在的标签操作
  /\ detached                              \* ServicesPanel.tsx:165-170 只显示 detached 的标签
  /\ detached' = FALSE                     \* drawerStore.ts:146-150 reattachTab
  /\ panelMounted' = TRUE                  \* ServicesPanel.tsx:174 setRightTab("terminal")
  /\ effectDue' = TRUE                     \* CommandTerminalPanel.tsx:305 activeTabVisible 变为 true
  /\ UNCHANGED <<tab, entry, knownGen, ptyGen, spawn, pty, exitGen, printed, outputLost>>

\* 在“进程已退出/启动失败”横幅上点击重新连接。
Reconnect ==
  /\ panelMounted                          \* CommandTerminalPanel.tsx:459 横幅只在面板里显示
  /\ ~detached                             \* CommandTerminalPanel.tsx:90-91 activeTab 只从可见标签里找
  /\ tab \in {"exited", "error"}           \* CommandTerminalPanel.tsx:459,477 横幅按 status 显示
  /\ entry # "none"                        \* CommandTerminalPanel.tsx:477 error 横幅要求 activeEntry.error；销毁需要条目 (drawerRegistry.ts:77)
  /\ entry' = "none"                       \* drawerRegistry.ts:83 destroyDrawerTerminal 删除条目
  /\ knownGen' = 0                    \* drawerRegistry.ts:83
  /\ pty' = IF knownGen # 0 THEN "none" ELSE pty   \* drawerRegistry.ts:81 termClose
  /\ tab' = "opening"                      \* CommandTerminalPanel.tsx:316 updateTab status:"opening"
  /\ UNCHANGED <<detached, panelMounted, effectDue, ptyGen, spawn, exitGen, printed, outputLost>>  \* effectDue 不变: 316 行不改变 effect 依赖

\* 应用重启: 后端 PTY 全部被杀，内存注册表清空，标签元数据从 localStorage 恢复。
AppRestart ==
  /\ (tab # "none" \/ pty # "none" \/ entry # "none" \/ panelMounted)  \* lib.rs:517 退出时 close_all；仅在有状态可清除时才有意义
  /\ tab' = IF tab = "none" THEN "none" ELSE "opening"   \* drawerStore.ts:70 loadTabs 状态恢复为 opening
  /\ entry' = "none"                       \* drawerRegistry.ts:34 模块级 Map 随页面重载清空
  /\ knownGen' = 0                    \* 条目消失
  /\ spawn' = "none"                       \* 页面重载后没有挂起的 termOpen
  /\ pty' = "none"                         \* lib.rs:517 pty::close_all
  /\ exitGen' = 0                         \* 事件随页面丢失
  /\ ptyGen' = 0                          \* 新进程从零开始编号（旧进程已被杀）
  /\ printed' = FALSE
  /\ outputLost' = FALSE
  /\ panelMounted' = FALSE                 \* 页面重载后面板重新由用户打开
  /\ effectDue' = FALSE
  /\ UNCHANGED <<detached>>                \* drawerStore.ts:60-72 detached 被持久化

\* ---------------- 无需读者介入的系统动作 ----------------

\* effect 运行，条目不存在: 创建 xterm 与注册表条目，并开始 termOpen。
CreateTerminal ==
  /\ effectDue                             \* CommandTerminalPanel.tsx:305 依赖变化才运行
  /\ panelMounted                          \* CommandTerminalPanel.tsx:275 只在挂载的面板里运行
  /\ tab # "none"                          \* CommandTerminalPanel.tsx:279 tab 找不到则 return
  /\ ~detached                             \* CommandTerminalPanel.tsx:276 必须是可见标签
  /\ entry = "none"                        \* CommandTerminalPanel.tsx:141 drawerRegistry.has(tab.id) 为假才创建
  /\ spawn = "none"                        \* MODEL BOUND: 至多一代挂起启动，非源码守卫
  /\ entry' = "opening"                    \* CommandTerminalPanel.tsx:234 drawerRegistry.set (phase: "opening")
  /\ spawn' = "pending"                    \* CommandTerminalPanel.tsx:248 await termOpen
  /\ effectDue' = FALSE                    \* effect 已消费
  /\ UNCHANGED <<tab, detached, panelMounted, knownGen, ptyGen, pty, exitGen, printed, outputLost>>

\* effect 运行，条目已存在: 只重新挂载并重新适配大小，不创建新终端。
ReattachTerminal ==
  /\ effectDue                             \* CommandTerminalPanel.tsx:305
  /\ panelMounted                          \* CommandTerminalPanel.tsx:275
  /\ tab # "none"                          \* CommandTerminalPanel.tsx:279
  /\ ~detached                             \* CommandTerminalPanel.tsx:276
  /\ entry # "none"                        \* CommandTerminalPanel.tsx:281 existing 分支
  /\ effectDue' = FALSE                    \* effect 已消费，终端状态不变
  /\ UNCHANGED <<tab, detached, panelMounted, entry, knownGen, ptyGen, spawn, pty, exitGen, printed, outputLost>>

\* 后端 term_open 成功: PTY 进入登记表，读线程开始。
BackendSpawnOk ==
  /\ spawn = "pending"                     \* commands.rs:75 term_open 调用 pty::open
  /\ pty = "none"                          \* pty.rs:149 新 uuid 的登记；旧进程已清除
  /\ pty' = "alive"                        \* pty.rs:149-157 registry().lock().insert
  /\ ptyGen' = ptyGen + 1                 \* pty.rs:148 新 uuid 即新的 termId
  /\ ptyGen < 3                           \* MODEL BOUND: 至多三代进程，非源码守卫
  /\ printed' = FALSE                      \* pty.rs:165 新读线程尚未输出
  /\ UNCHANGED <<tab, detached, panelMounted, effectDue, entry, knownGen, spawn, exitGen, outputLost>>

\* 后端 term_open 失败（目录不存在等）: 前端把条目与标签置为 error。
BackendSpawnFail ==
  /\ spawn = "pending"                     \* CommandTerminalPanel.tsx:261 catch 分支
  /\ pty = "none"                          \* pty.rs:71,79,125 失败发生在登记之前（registry insert 在 pty.rs:149）
  /\ spawn' = "none"                       \* CommandTerminalPanel.tsx:261 await 抛出后结束
  /\ entry' = IF entry # "none" THEN "error" ELSE entry   \* CommandTerminalPanel.tsx:262-264 条目被替换则 return，否则 phase=error
  /\ tab' = IF entry # "none" THEN "error" ELSE tab       \* CommandTerminalPanel.tsx:266 updateTab status:"error"
  /\ UNCHANGED <<detached, panelMounted, effectDue, knownGen, ptyGen, pty, exitGen, printed, outputLost>>

\* termOpen 返回: 条目仍在则记录 termId 并置 ready，否则（标签已关闭/重连）把刚创建的进程关掉。
SpawnResolve ==
  /\ spawn = "pending"                     \* CommandTerminalPanel.tsx:248 await 返回
  /\ pty \in {"alive", "dead"}             \* commands.rs:75 term_open 只在 pty::open 成功后返回
  /\ spawn' = "none"                       \* CommandTerminalPanel.tsx:248 await 返回后结束
  /\ entry' = IF entry # "none" THEN "ready" ELSE entry   \* CommandTerminalPanel.tsx:250-255 条目一致则 phase="ready"
  /\ knownGen' = IF entry # "none" THEN ptyGen ELSE knownGen  \* CommandTerminalPanel.tsx:254 entry.termId = id
  /\ tab' = IF entry # "none" THEN "ready" ELSE tab       \* CommandTerminalPanel.tsx:259 updateTab status:"ready"
  /\ pty' = IF entry = "none" THEN "none" ELSE pty        \* CommandTerminalPanel.tsx:251 条目已被替换 → termClose(id)
  /\ UNCHANGED <<detached, panelMounted, effectDue, ptyGen, exitGen, printed, outputLost>>

\* shell 的第一段输出（提示符）被读线程推送。
PtyOutput ==
  /\ pty = "alive"                         \* pty.rs:167 reader.read 返回 Ok(n)
  /\ ~printed                              \* 模型只考察第一段输出
  /\ printed' = TRUE                       \* pty.rs:167 sink(Data)
  /\ outputLost' = (outputLost \/ ~(entry # "none" /\ knownGen = ptyGen))  \* drawerRegistry.ts:51 只有 entry.termId === p.termId 才写入 xterm
  /\ UNCHANGED <<tab, detached, panelMounted, effectDue, entry, knownGen, ptyGen, spawn, pty, exitGen>>

\* 桥处理 terminal:exit: 条目知道 termId 才会置 exited。
DeliverExit ==
  /\ exitGen # 0                           \* drawerRegistry.ts:58 onTerminalExit 回调
  /\ exitGen' = 0                   \* drawerRegistry.ts:58 事件被消费
  /\ entry' = IF entry # "none" /\ knownGen = exitGen THEN "exited" ELSE entry   \* drawerRegistry.ts:60 entry.termId !== p.termId 则 continue；61-62 置 exited
  /\ tab' = IF entry # "none" /\ knownGen = exitGen THEN "exited" ELSE tab       \* drawerRegistry.ts:63 updateTab status:"exited"
  /\ UNCHANGED <<detached, panelMounted, effectDue, knownGen, ptyGen, spawn, pty, printed, outputLost>>

\* ---------------- 下一状态关系 ----------------

Reader ==
  \/ OpenPanel
  \/ ClosePanel
  \/ SwitchTab
  \/ PtyExit
  \/ CloseTab
  \/ DetachTab
  \/ ReattachTab
  \/ Reconnect
  \/ AppRestart

System ==
  \/ CreateTerminal
  \/ ReattachTerminal
  \/ BackendSpawnOk
  \/ BackendSpawnFail
  \/ SpawnResolve
  \/ PtyOutput
  \/ DeliverExit

Next == Reader \/ System

Spec == Init /\ [][Next]_vars

\* 所有系统动作都已完成，只剩用户可以做的事。
Settled == ~ENABLED System

\* ---------------- 规则 ----------------

\* 标签显示“运行中”时，后端终端进程确实还活着。
ReadyMeansAlive == Settled => (tab = "ready" => pty = "alive") \* CommandTerminalPanel.tsx:254-259; drawerRegistry.ts:58-63; pty.rs:171

\* 标签被关闭后，不应留下仍在运行的终端进程。
NoLeakAfterClose == Settled => (tab = "none" => pty # "alive") \* terminalTabs.ts:83-96; CommandTerminalPanel.tsx:250-251

\* 面板打开、标签可见并显示“连接中”时，必须真的有一次终端启动在进行或已完成。
OpeningMakesProgress ==
  Settled => ((panelMounted /\ ~detached /\ tab = "opening") => entry # "none") \* CommandTerminalPanel.tsx:275-305,310-316

\* 标签显示“已退出”时，后端进程不应还活着。
ExitedMeansNotAlive == tab = "exited" => pty # "alive" \* drawerRegistry.ts:58-63; pty.rs:171-172

\* shell 打印的第一段输出不应在到达界面前被丢弃。
OutputNotLost == Settled => ~outputLost \* drawerRegistry.ts:47-54; pty.rs:167

=============================================================================
