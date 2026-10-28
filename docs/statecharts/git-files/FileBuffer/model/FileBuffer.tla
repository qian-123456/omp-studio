---- MODULE FileBuffer ----
\* 右侧面板文本文件缓冲区：标签页、草稿、保存、窗口聚焦刷新、外部改动。
\* 源码：src/features/editor/useFileBuffer.ts、src/features/files/FilePreviewPanel.tsx、
\*       src/stores/filePreview.ts、src-tauri/src/services/commands.rs、src-tauri/src/services/files.rs
EXTENDS Naturals

\* 模型内容只取三个抽象版本："orig" 磁盘原文，"mine" 用户草稿，"theirs" 代理或其他程序写入的新版本。
VARIABLES
  tabOpen,      \* filePreview.ts tabs 是否含该文件；FileTab
  shown,        \* filePreview.ts activePath 是否指向该文件
  mounted,      \* FilePreviewPanel.tsx 的 TextBody 是否挂载（useFileBuffer 状态存活）
  disk,         \* 磁盘上的文件内容（write_text_file / read_text_file 的对象）
  saved,        \* useFileBuffer.ts saved；"none" 即 null（尚未读到）
  draft,        \* useFileBuffer.ts draft
  external,     \* useFileBuffer.ts external（磁盘已变横幅）
  saving,       \* useFileBuffer.ts saving
  writeVal,     \* 正在写盘的内容（writeTextFile 的第二个参数）；"none" 表示无请求在途
  focusRead,    \* 窗口聚焦刷新是否在途：onFocus 的 await readTextFile
  focusSawDirty,\* onFocus 闭包捕获的 dirty
  focusText,    \* onFocus 已读到的磁盘内容
  lostSwitch, lostClose, lostReload, lostRefresh, clobber  \* 模型观测旗标，只由动作写入

vars == <<tabOpen, shown, mounted, disk, saved, draft, external, saving, writeVal,
          focusRead, focusSawDirty, focusText,
          lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

Contents == {"orig", "mine", "theirs"}

\* useFileBuffer.ts:33 dirty = saved !== null && draft !== saved
Dirty == saved # "none" /\ draft # saved

Init ==
  /\ tabOpen = FALSE
  /\ shown = FALSE
  /\ mounted = FALSE
  /\ disk = "orig"
  /\ saved = "none"
  /\ draft = "orig"
  /\ external = FALSE
  /\ saving = FALSE
  /\ writeVal = "none"
  /\ focusRead = FALSE
  /\ focusSawDirty = FALSE
  /\ focusText = "orig"
  /\ lostSwitch = FALSE
  /\ lostClose = FALSE
  /\ lostReload = FALSE
  /\ lostRefresh = FALSE
  /\ clobber = FALSE

\* 用户点击路径打开文件标签（并让该标签成为当前标签）。
OpenTab ==
  /\ ~tabOpen                                  \* filePreview.ts:56 existing 为空才新增标签
  /\ tabOpen' = TRUE                           \* filePreview.ts:54 tabs 追加新标签
  /\ shown' = TRUE                             \* filePreview.ts:56 activePath = path
  /\ mounted' = TRUE                           \* FilePreviewPanel.tsx:214 key=active.path 挂载 TextBody
  /\ saved' = "none"                           \* useFileBuffer.ts:49 挂载时 setSaved(null)
  /\ draft' = "orig"                           \* useFileBuffer.ts:50 setDraft("")
  /\ external' = FALSE                         \* useFileBuffer.ts:51 setExternal(false)
  /\ UNCHANGED <<disk, saving, writeVal, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 读文件完成，缓冲区拿到磁盘内容。
LoadDone ==
  /\ mounted                                   \* useFileBuffer.ts:37 load 属于已挂载的 hook
  /\ saved = "none"                            \* useFileBuffer.ts:44 读成功前 saved 仍为 null
  /\ saved' = disk                             \* useFileBuffer.ts:38 setSaved(text)
  /\ draft' = disk                             \* useFileBuffer.ts:39 setDraft(text)
  /\ external' = FALSE                         \* useFileBuffer.ts:41 setExternal(false)
  /\ UNCHANGED <<tabOpen, shown, mounted, disk, saving, writeVal, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 用户在编辑器里改文字（setDraft）。
UserEdit ==
  /\ mounted                                   \* FilePreviewPanel.tsx:177 编辑器在已挂载的 TextBody 内
  /\ saved # "none"                            \* FilePreviewPanel.tsx:172 saved===null 时显示加载中而非编辑器
  /\ draft # "mine"                            \* 抽象：草稿从非 mine 变为 mine
  /\ draft' = "mine"                           \* useFileBuffer.ts:28 setDraft
  /\ UNCHANGED <<tabOpen, shown, mounted, disk, saved, external, saving, writeVal, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 用户把草稿改回已保存内容。
UserRevert ==
  /\ mounted                                   \* FilePreviewPanel.tsx:177 编辑器在已挂载的 TextBody 内
  /\ Dirty                                     \* useFileBuffer.ts:33 只有脏时才存在可撤销的改动
  /\ draft' = saved                            \* useFileBuffer.ts:28 setDraft
  /\ UNCHANGED <<tabOpen, shown, mounted, disk, saved, external, saving, writeVal, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 点击保存或按 Cmd+S：发出写盘请求。
SaveStart ==
  /\ mounted                                   \* FilePreviewPanel.tsx:97 快捷键由已挂载面板注册
  /\ saved # "none"                            \* useFileBuffer.ts:78 saved === null 直接返回
  /\ Dirty                                     \* useFileBuffer.ts:78 !dirty 直接返回
  /\ ~saving                                   \* useFileBuffer.ts:78 saving 为真直接返回
  /\ saving' = TRUE                            \* useFileBuffer.ts:79 setSaving(true)
  /\ writeVal' = draft                         \* useFileBuffer.ts:81 writeTextFile(path, draft)
  /\ UNCHANGED <<tabOpen, shown, mounted, disk, saved, draft, external, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 写盘完成。后端不核对磁盘是否已被别人改过，直接 temp+rename 覆盖。
SaveFinish ==
  /\ writeVal # "none"                         \* services/commands.rs:42 write_text_file 已收到请求
  /\ disk' = writeVal                          \* services/files.rs:90 rename 覆盖目标文件，无磁盘版本比对
  /\ clobber' = (clobber \/ (mounted /\ saved # "none" /\ ~external /\ disk # saved))  \* services/commands.rs:44 resolve+protected 之后直接写，无 stamp 参数；横幅未显示即用户不知情
  /\ saving' = FALSE                           \* useFileBuffer.ts:90 finally setSaving(false)
  /\ writeVal' = "none"                        \* useFileBuffer.ts:81 请求结束
  /\ saved' = IF mounted THEN writeVal ELSE saved   \* useFileBuffer.ts:82 setSaved(draft)，已卸载则无效
  /\ external' = IF mounted THEN FALSE ELSE external \* useFileBuffer.ts:83 setExternal(false)
  /\ UNCHANGED <<tabOpen, shown, mounted, draft, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh>>

\* 代理或其他程序改写磁盘文件；窗口在前台时不会触发 focus 事件。
ExternalWrite ==
  /\ disk # "theirs"                           \* 抽象：只有内容不同才算一次改动
  /\ disk' = "theirs"                          \* 外部写入，不经过 useFileBuffer
  /\ UNCHANGED <<tabOpen, shown, mounted, saved, draft, external, saving, writeVal, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 窗口取回焦点，开始后台重读磁盘；此刻捕获 dirty。
FocusReadStart ==
  /\ mounted                                   \* useFileBuffer.ts:73 focus 监听属于已挂载 hook
  /\ saved # "none"                            \* useFileBuffer.ts:59 saved === null 直接返回
  /\ ~focusRead                                \* 抽象：每次聚焦一个在途读
  /\ focusRead' = TRUE                         \* useFileBuffer.ts:61 await readTextFile(path)
  /\ focusSawDirty' = Dirty                    \* useFileBuffer.ts:63 闭包里的 dirty 来自注册监听时的渲染
  /\ focusText' = disk                         \* useFileBuffer.ts:61 读到的文本
  /\ UNCHANGED <<tabOpen, shown, mounted, disk, saved, draft, external, saving, writeVal,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 后台重读返回。
FocusReadFinish ==
  /\ focusRead                                 \* useFileBuffer.ts:61 await 返回
  /\ focusRead' = FALSE                        \* useFileBuffer.ts:71 处理结束
  /\ IF ~mounted \/ focusText = saved          \* useFileBuffer.ts:62 text === saved 直接返回；已卸载则无效
       THEN UNCHANGED <<saved, draft, external, lostRefresh>>
       ELSE IF focusSawDirty                   \* useFileBuffer.ts:63 if (dirty)
              THEN /\ external' = TRUE         \* useFileBuffer.ts:64 setExternal(true)
                   /\ UNCHANGED <<saved, draft, lostRefresh>>
              ELSE /\ saved' = focusText       \* useFileBuffer.ts:66 setSaved(text)
                   /\ draft' = focusText       \* useFileBuffer.ts:67 setDraft(text) 覆盖读取期间的新输入
                   /\ lostRefresh' = (lostRefresh \/ Dirty)  \* useFileBuffer.ts:67 当前草稿已脏却被覆盖
                   /\ UNCHANGED external
  /\ UNCHANGED <<tabOpen, shown, mounted, disk, saving, writeVal, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, clobber>>

\* 点击「保留我的修改」。
DismissExternal ==
  /\ mounted                                   \* FilePreviewPanel.tsx:162 横幅在已挂载 TextBody 内
  /\ external                                  \* FilePreviewPanel.tsx:160 external 为真才显示横幅
  /\ external' = FALSE                         \* useFileBuffer.ts:105 dismissExternal
  /\ UNCHANGED <<tabOpen, shown, mounted, disk, saved, draft, saving, writeVal, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 点击「重新载入」或横幅上的重新载入：右侧面板不先确认。
ReloadPanel ==
  /\ mounted                                   \* FilePreviewPanel.tsx:145 按钮在已挂载 TextBody 内
  /\ saved # "none"                            \* FilePreviewPanel.tsx:174 加载完成后才显示编辑区
  /\ saved' = disk                             \* useFileBuffer.ts:38 setSaved(text)
  /\ draft' = disk                             \* useFileBuffer.ts:39 setDraft(text)
  /\ external' = FALSE                         \* useFileBuffer.ts:41 setExternal(false)
  /\ lostReload' = (lostReload \/ Dirty)       \* FilePreviewPanel.tsx:145 对比 DocView.tsx:91 有脏时才确认
  /\ UNCHANGED <<tabOpen, shown, mounted, disk, saving, writeVal, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostRefresh, clobber>>

\* 点击另一个标签：TextBody 被 key 换掉，缓冲区状态随之销毁。
SwitchAway ==
  /\ tabOpen /\ shown /\ mounted               \* filePreview.ts:78 setActive 作用于当前标签
  /\ shown' = FALSE                            \* filePreview.ts:78 activePath 指向别的文件
  /\ mounted' = FALSE                          \* FilePreviewPanel.tsx:214 key 变化卸载 TextBody
  /\ lostSwitch' = (lostSwitch \/ Dirty)       \* FilePreviewPanel.tsx:214 卸载前未保存草稿无处保存
  /\ saved' = "none"                           \* useFileBuffer.ts:27 新挂载时状态从头来
  /\ draft' = "orig"                           \* useFileBuffer.ts:28 新挂载时 draft 为空
  /\ external' = FALSE                         \* useFileBuffer.ts:30 新挂载时 external 为假
  /\ focusRead' = FALSE                        \* useFileBuffer.ts:74 卸载时监听被移除
  /\ UNCHANGED <<tabOpen, disk, saving, writeVal, focusSawDirty, focusText,
                 lostClose, lostReload, lostRefresh, clobber>>

\* 回到该标签：重新挂载并重新读盘。
SwitchBack ==
  /\ tabOpen /\ ~shown                         \* filePreview.ts:78 切回已打开的标签
  /\ shown' = TRUE                             \* filePreview.ts:78 activePath = path
  /\ mounted' = TRUE                           \* FilePreviewPanel.tsx:214 key 变化挂载 TextBody
  /\ saved' = "none"                           \* useFileBuffer.ts:49 setSaved(null)
  /\ draft' = "orig"                           \* useFileBuffer.ts:50 setDraft("")
  /\ external' = FALSE                         \* useFileBuffer.ts:51 setExternal(false)
  /\ UNCHANGED <<tabOpen, disk, saving, writeVal, focusRead, focusSawDirty, focusText,
                 lostSwitch, lostClose, lostReload, lostRefresh, clobber>>

\* 点标签上的关闭、或 Cmd+W：关闭标签不检查未保存草稿。
CloseTab ==
  /\ tabOpen                                   \* filePreview.ts:70 idx < 0 直接返回
  /\ tabOpen' = FALSE                          \* filePreview.ts:75 tabs 去掉该标签
  /\ shown' = FALSE                            \* filePreview.ts:74 activePath 换成别的标签
  /\ mounted' = FALSE                          \* FilePreviewPanel.tsx:214 key 变化卸载 TextBody
  /\ lostClose' = (lostClose \/ (mounted /\ Dirty))  \* RightPanelHeader.tsx:178 与 nativeShortcuts.ts:76 都直接 closeFile
  /\ saved' = "none"                           \* useFileBuffer.ts:27 卸载后状态销毁
  /\ draft' = "orig"                           \* useFileBuffer.ts:28 卸载后状态销毁
  /\ external' = FALSE                         \* useFileBuffer.ts:30 卸载后状态销毁
  /\ focusRead' = FALSE                        \* useFileBuffer.ts:74 卸载时监听被移除
  /\ UNCHANGED <<disk, saving, writeVal, focusSawDirty, focusText,
                 lostSwitch, lostReload, lostRefresh, clobber>>

Next ==
  \/ OpenTab \/ LoadDone \/ UserEdit \/ UserRevert \/ SaveStart \/ SaveFinish
  \/ ExternalWrite \/ FocusReadStart \/ FocusReadFinish \/ DismissExternal
  \/ ReloadPanel \/ SwitchAway \/ SwitchBack \/ CloseTab

Spec == Init /\ [][Next]_vars

System == SaveFinish \/ LoadDone \/ FocusReadFinish \/ ExternalWrite
Settled == ~ENABLED System

\* 未保存的修改在切换标签时不会丢失。
NoLossOnSwitch == ~lostSwitch
\* 未保存的修改在关闭标签时不会丢失。
NoLossOnClose == ~lostClose
\* 未保存的修改在点重新载入时不会在没确认的情况下丢失。
NoLossOnReload == ~lostReload
\* 窗口聚焦后的后台刷新不会冲掉用户刚输入的文字。
NoLossOnRefresh == ~lostRefresh
\* 保存不会悄悄覆盖用户从没看到过的磁盘改动。
NoClobber == ~clobber
====
