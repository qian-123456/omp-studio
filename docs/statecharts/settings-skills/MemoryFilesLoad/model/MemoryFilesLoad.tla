---------------------- MODULE MemoryFilesLoad ----------------------
\* 记忆页：按所选项目读取记忆文件列表。
EXTENDS Naturals, FiniteSets

VARIABLES
  mSlug,     \* 所选项目：MemoryFilesPanel.tsx:182 slug
  mInflight,    \* 已发出、尚未返回的读取请求所属项目：MemoryFilesPanel.tsx:212-224 refreshFiles()
  mShown    \* 界面实际显示的数据属于哪个项目（0=还没读到）：MemoryFilesPanel.tsx:183 files

vars == <<mSlug, mInflight, mShown>>
Projects == {1, 2}

Init == /\ mSlug = 1 /\ mInflight = {1} /\ mShown = 0     \* MemoryFilesPanel.tsx:226-230 挂载即读取

\* 切换项目，触发新的读取 (MemoryFilesPanel.tsx:224,226-230 refreshFiles 依赖 slug)
MemorySwitchProject ==
  /\ \E c \in Projects : c # mSlug /\ mSlug' = c /\ mInflight' = mInflight \cup {c}
  /\ UNCHANGED <<mShown>>

\* 某个读取请求返回 (MemoryFilesPanel.tsx:218 setFiles)
MemoryReadReturns ==
  /\ \E c \in mInflight : mShown' = c /\ mInflight' = mInflight \ {c}  \* MemoryFilesPanel.tsx:218 setFiles 没有过期判断
  /\ UNCHANGED <<mSlug>>

Next == MemorySwitchProject \/ MemoryReadReturns
Spec == Init /\ [][Next]_vars

\* 规则：请求全部返回后，记忆文件列表属于当前所选项目。
MemoryListMatchesProject == (mInflight = {}) => mShown = mSlug
=====================================================================
