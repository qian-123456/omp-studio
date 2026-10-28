---------------------------- MODULE MobilePending ----------------------------
\* 手机端待处理审批：ChatController.loadPendings / approveAll 与服务器 ui_respond_all（chatStore.ts, approvals.ts, api/chat.rs）。
EXTENDS Naturals, FiniteSets

CONSTANT Reqs   \* 可能出现的审批请求编号集合

VARIABLES
    serverPending,  \* 服务器当前待处理 UI 请求 (server.rs:359 pending_ui)
    answered,       \* 已被回答的请求 (server.rs:376 ui_respond / api/chat.rs:577 ui_respond_all)
    shown,          \* 手机上正在显示的卡片 ChatState.pendings (chatStore.ts:390)
    everShown,      \* 用户曾经看到过的请求（历史变量，不在代码里）
    snaps           \* 在途的 GET pending-ui 响应快照 (chatStore.ts:386)

vars == <<serverPending, answered, shown, everShown, snaps>>

TypeOK ==
    /\ serverPending \subseteq Reqs
    /\ answered \subseteq Reqs
    /\ shown \subseteq Reqs
    /\ everShown \subseteq Reqs
    /\ snaps \subseteq SUBSET Reqs

Init ==
    /\ serverPending = {}
    /\ answered = {}
    /\ shown = {}
    /\ everShown = {}
    /\ snaps = {}

\* 运行端发出新的审批请求（外部契约：runtime 的 extension_ui_request）
ServerAsks ==
    \E r \in Reqs :
        /\ r \notin serverPending \cup answered   \* server.rs:404-413 请求编号唯一（外部契约：runtime 不重复发出同一编号）
        /\ serverPending' = serverPending \cup {r}
        /\ UNCHANGED <<answered, shown, everShown, snaps>>

\* 手机发起 GET pending-ui（SSE 事件或回答之后触发）
StartLoad ==
    /\ Cardinality(snaps) < 3                     \* 模型边界：最多三个在途响应
    /\ serverPending \notin snaps                 \* chatStore.ts:386 模型边界：相同快照合并（集合语义）
    /\ snaps' = snaps \cup {serverPending}        \* chatStore.ts:386 响应内容取自服务器此刻的待处理集合
    /\ UNCHANGED <<serverPending, answered, shown, everShown>>

\* 某个响应送达，直接替换显示的卡片，没有序号或时间戳比较
DeliverLoad ==
    \E s \in snaps :
        /\ shown' = s                             \* chatStore.ts:390 this.set({ pendings: arr })
        /\ everShown' = everShown \cup s
        /\ snaps' = snaps \ {s}
        /\ UNCHANGED <<serverPending, answered>>

\* 用户在一张卡片上单独回答
RespondOne ==
    \E r \in shown :
        /\ r \in serverPending                    \* server.rs:404-413 只回答仍存在的请求
        /\ Cardinality(snaps) < 3                \* 模型边界：最多三个在途响应
        /\ serverPending' = serverPending \ {r}   \* server.rs:419 转发给 omp
        /\ answered' = answered \cup {r}
        /\ snaps' = snaps \cup {serverPending \ {r}}   \* chatStore.ts:405-407 回答成功后立刻再次读取待处理列表
        /\ UNCHANGED <<shown, everShown>>

\* 用户点「全部允许」：只发送动作，不带请求编号
ApproveAll ==
    /\ Cardinality(shown) >= 2                    \* chatStore.ts:523 / approvals.ts:27 至少两个可批量请求
    /\ Cardinality(snaps) < 3                    \* 模型边界：最多三个在途响应
    /\ serverPending' = {}                        \* api/chat.rs:593-607 遍历服务器此刻全部待处理请求
    /\ answered' = answered \cup serverPending
    /\ snaps' = snaps \cup {{}}                   \* chatStore.ts:528-531 批量回答后再次读取待处理列表
    /\ UNCHANGED <<shown, everShown>>

Next == ServerAsks \/ StartLoad \/ DeliverLoad \/ RespondOne \/ ApproveAll

Spec == Init /\ [][Next]_vars

\* 规则：「全部允许」只能回答用户已经在屏幕上看到过的请求。
BatchOnlyAnswersSeen == answered \subseteq everShown

\* 规则：所有列表响应都已送达后，已经被回答的请求不应还作为待处理卡片留在屏幕上。
NoAnsweredCardShown == (snaps = {}) => (shown \cap answered = {})
=============================================================================
