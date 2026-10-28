---------------------- MODULE PluginsCatalogLoadFixed ----------------------
\* 插件页：按所选项目读取插件目录。
EXTENDS Naturals, FiniteSets

VARIABLES
  pCwd,     \* 所选项目：PluginsSection.tsx:77-83 cwd
  pInflight,    \* 已发出、尚未返回的读取请求所属项目：PluginsSection.tsx:91-106 reload()
  pShown    \* 界面实际显示的数据属于哪个项目（0=还没读到）：PluginsSection.tsx:85 catalog

vars == <<pCwd, pInflight, pShown>>
Projects == {1, 2}

Init == /\ pCwd = 1 /\ pInflight = {1} /\ pShown = 0     \* PluginsSection.tsx:108-110 挂载即读取

\* 切换项目，触发新的读取 (PluginsSection.tsx:106-110 reload 依赖 cwd)
PluginsSwitchProject ==
  /\ \E c \in Projects : c # pCwd /\ pCwd' = c /\ pInflight' = pInflight \cup {c}
  /\ UNCHANGED <<pShown>>

\* 某个读取请求返回 (PluginsSection.tsx:94-100 setCatalog(cat))
PluginsReadReturns ==
  /\ \E c \in pInflight : pShown' = (IF c = pCwd THEN c ELSE pShown) /\ pInflight' = pInflight \ {c}  \* 修复：只接受当前项目的返回，参考 McpSection.tsx:86-97 的序号判断
  /\ UNCHANGED <<pCwd>>

Next == PluginsSwitchProject \/ PluginsReadReturns
Spec == Init /\ [][Next]_vars

\* 规则：请求全部返回后，插件页显示的是当前所选项目的插件。
PluginsMatchProject == (pInflight = {}) => pShown = pCwd
=====================================================================
