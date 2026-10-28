------------------------ MODULE McpWriteOwnership ------------------------
\* 两次写入尚未返回的有限前缀；不是完成/错误恢复模型。仅接收合法编辑草稿和合法非空导入。
EXTENDS Naturals
VARIABLES emptyCatalog, dialog, localBusy, busy, writes
\* emptyCatalog: McpSection.tsx:300-315；dialog:78；busy:77；writes 统计 write:105-108 的在途调用。
\* localBusy 是当前子组件 saving (McpServerEditor.tsx:156) 或 running (McpImportDialog.tsx:41)。
vars == <<emptyCatalog, dialog, localBusy, busy, writes>>
Init == /\ emptyCatalog \in BOOLEAN /\ dialog = "none" /\ localBusy = FALSE /\ busy = FALSE /\ writes = 0
OpenEditor ==
  /\ dialog = "none" \* McpSection.tsx:390-409 单一 dialog 决定挂载；只建模无弹窗时的用户入口
  /\ (~busy \/ emptyCatalog) \* McpSection.tsx:232-236 主按钮禁用 busy；308 空目录按钮不禁用 busy
  /\ dialog' = "editor" /\ localBusy' = FALSE \* McpServerEditor.tsx:156 新挂载组件 saving=false
  /\ UNCHANGED <<emptyCatalog, busy, writes>>
OpenImport ==
  /\ dialog = "none" \* McpSection.tsx:419-428 单一 dialog 导入组件
  /\ (~busy \/ emptyCatalog) \* McpSection.tsx:229 主按钮禁用 busy；311 空目录按钮不禁用 busy
  /\ dialog' = "import" /\ localBusy' = FALSE \* McpImportDialog.tsx:41 新挂载 running=false
  /\ UNCHANGED <<emptyCatalog, busy, writes>>
CloseChild ==
  /\ dialog # "none" \* McpServerEditor.tsx:410; McpImportDialog.tsx:177 关闭按钮没有禁用 saving/running
  /\ dialog' = "none" /\ localBusy' = FALSE \* McpSection.tsx:397,407,427 关闭卸载当前子组件
  /\ UNCHANGED <<emptyCatalog, busy, writes>>
EditorSubmit ==
  /\ dialog = "editor" \* McpSection.tsx:390-409 编辑器挂载
  /\ ~localBusy \* McpServerEditor.tsx:188 保存函数检查 saving；194-198 本模型只输入通过验证的草稿
  /\ writes < 2 \* McpSection.tsx:105-108 统计实际 write 调用，2 是探索上限而非产品守卫
  /\ localBusy' = TRUE /\ busy' = TRUE /\ writes' = writes + 1 \* McpServerEditor.tsx:199-205; McpSection.tsx:195,106 没有父 busy 守卫
  /\ UNCHANGED <<emptyCatalog, dialog>>
ImportSubmit ==
  /\ dialog = "import" \* McpSection.tsx:419-428 导入器挂载
  /\ ~localBusy \* McpImportDialog.tsx:180-184 loading=running 禁止重复按钮提交；本模型只输入合法非空 pending
  /\ writes < 2 \* McpSection.tsx:203-204 write 调用统计；2 是探索上限而非产品守卫
  /\ localBusy' = TRUE /\ busy' = TRUE /\ writes' = writes + 1 \* McpImportDialog.tsx:70-75 顺序 await 第一项；McpSection.tsx:204 无父 busy 守卫
  /\ UNCHANGED <<emptyCatalog, dialog>>
InlineAct ==
  /\ dialog = "none" \* McpSection.tsx:161-185 行内用户入口；本模型不允许穿过模态层点击行
  /\ ~emptyCatalog \* McpSection.tsx:329-341 只有存在服务器行才能操作
  /\ ~busy \* McpSection.tsx:119 act 守卫；McpServerRow.tsx:135-169 控件 disabled=busy
  /\ writes < 2 \* McpSection.tsx:105-108 统计实际 write 调用，2 是探索上限而非产品守卫
  /\ busy' = TRUE /\ writes' = writes + 1
  /\ UNCHANGED <<emptyCatalog, dialog, localBusy>>
\* 所有请求可暂不返回；这是实际异步调度的有限前缀，不声明任何最终完成性。
Next == OpenEditor \/ OpenImport \/ CloseChild \/ EditorSubmit \/ ImportSubmit \/ InlineAct
Spec == Init /\ [][Next]_vars
\* 规则：同一时间最多只有一次写入在进行。
SingleWriter == writes <= 1
=====================================================================
