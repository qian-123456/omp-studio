------------------------ MODULE McpEditorDialog ------------------------
\* 仅建模父组件编辑弹窗归属与目录重读；不建模任何写入或编辑器内部提交/关闭控件。
EXTENDS Naturals
VARIABLES
  dialog,  \* McpSection.tsx:78 dialog：none / edit
  present  \* McpSection.tsx:211 allServers 中是否仍存在被编辑服务器
vars == <<dialog, present>>
Init == dialog = "none" /\ present = TRUE
OpenEditor ==
  /\ dialog = "none" /\ present \* McpSection.tsx:298-343 存在服务器行上的编辑入口
  /\ dialog' = "edit"
  /\ UNCHANGED present
ExternalRemoveThenReload ==
  /\ present \* McpSection.tsx:85-102 重新读取的目录可以不再包含原服务器
  /\ present' = FALSE
  /\ UNCHANGED dialog
ExternalAddBack ==
  /\ ~present \* McpSection.tsx:85-102 重读可以再次包含该服务器
  /\ present' = TRUE
  /\ UNCHANGED dialog
\* 输入契约：可见编辑器触发父组件 onClose 回调；不声称任意用户操作可触发它。
CloseEditor ==
  /\ dialog = "edit" \* McpSection.tsx:211 编辑态确定 editing 对象
  /\ present \* McpSection.tsx:400-407 仅存在 editing 时挂载带 onClose 的编辑器
  /\ dialog' = "none" \* McpSection.tsx:407 onClose 无条件 setDialog(null)
  /\ UNCHANGED present
Next == OpenEditor \/ ExternalRemoveThenReload \/ ExternalAddBack \/ CloseEditor
Spec == Init /\ [][Next]_vars
\* 规则：编辑弹窗处于打开状态时，用户一定能在屏幕上看到它。
EditorVisibleWhenOpen == (dialog = "edit") => present
=====================================================================
