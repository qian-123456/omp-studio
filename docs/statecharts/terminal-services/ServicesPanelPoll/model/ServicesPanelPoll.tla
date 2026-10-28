-------------------------- MODULE ServicesPanelPoll --------------------------
\* 服务面板: “显示全部监听端口”开关、列表请求的完成顺序与 services:changed 事件。
\* 模型描述现有代码（from-spec）；代码根目录 omp-workspace/.worktrees/bug-fix (HEAD 7f85613)。
\* 范围: 一个服务面板；请求数与切换/事件次数有上限；停止服务、孤儿清理、复制、打开浏览器为只读排除项。
EXTENDS Naturals, Sequences

VARIABLES
  all,       \* ServicesPanel.tsx:28 const [all, setAll] —— 面板上的“全部”开关
  pending,   \* 已发出尚未返回的 servicesList(all) 请求，每项是发出时的 all (ServicesPanel.tsx:48)
  rows,      \* ServicesPanel.tsx:29 const [rows, setRows] 当前显示的是哪种列表
  toggles,   \* 模型计数: 开关被点击的次数
  events     \* 模型计数: services:changed 事件到达的次数

vars == <<all, pending, rows, toggles, events>>

TypeOK ==
  /\ all \in BOOLEAN
  /\ pending \in Seq(BOOLEAN)
  /\ Len(pending) <= 3
  /\ rows \in {"none", "dev", "all"}
  /\ toggles \in 0..2
  /\ events \in 0..1

Init ==
  /\ all = FALSE
  /\ pending = <<>>
  /\ rows = "none"
  /\ toggles = 0
  /\ events = 0

\* 用户点击“显示全部”复选框: 开关翻转，effect 立刻按新的开关值发出新请求，旧请求不取消。
ToggleAll ==
  /\ toggles < 2                           \* MODEL BOUND: 至多切换两次，非源码守卫
  /\ Len(pending) < 3                      \* MODEL BOUND: 同时至多三个请求，非源码守卫
  /\ all' = ~all                           \* ServicesPanel.tsx:208-211 复选框 onChange 调用 setAll
  /\ pending' = Append(pending, ~all)      \* ServicesPanel.tsx:60-62 [all, refresh] effect 调用 refresh，ServicesPanel.tsx:48 读取 allRef.current
  /\ toggles' = toggles + 1                \* 模型计数
  /\ UNCHANGED <<rows, events>>

\* 后端广播 services:changed（载荷是默认的“仅开发服务”列表）。
ChangedEvent ==
  /\ events < 1                            \* MODEL BOUND: 至多一次事件，非源码守卫
  /\ (all => Len(pending) < 3)             \* ServicesPanel.tsx:67 MODEL BOUND: 事件触发请求的数量界限，非源码守卫
  /\ events' = events + 1                  \* 模型计数
  /\ pending' = IF all THEN Append(pending, TRUE) ELSE pending   \* ServicesPanel.tsx:67 allRef.current 为真时 refresh()
  /\ rows' = IF all THEN rows ELSE "dev"   \* ServicesPanel.tsx:67 allRef.current 为假时直接 setRows(list)
  /\ UNCHANGED <<all, toggles>>

\* 某个列表请求返回（可以按任意顺序）: 不核对发出时的开关，直接写入显示。
Respond(i) ==
  /\ i \in 1..Len(pending)                 \* ServicesPanel.tsx:48 await servicesList(...) 返回
  /\ rows' = IF pending[i] THEN "all" ELSE "dev"   \* ServicesPanel.tsx:48 setRows(结果)，没有请求序号或开关校验
  /\ pending' = SubSeq(pending, 1, i - 1) \o SubSeq(pending, i + 1, Len(pending))  \* ServicesPanel.tsx:54 请求结束
  /\ UNCHANGED <<all, toggles, events>>

Reader == ToggleAll \/ ChangedEvent
System == \E i \in 1..3 : Respond(i)
Next == Reader \/ System
Spec == Init /\ [][Next]_vars

Settled == ~ENABLED System

\* 所有请求都回来之后，列表的内容应当与开关当前的选择一致。
RowsMatchToggle == Settled => (rows # "none" => ((rows = "all") <=> all)) \* ServicesPanel.tsx:48,60-67,208-211

=============================================================================
