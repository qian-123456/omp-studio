---------------------------- MODULE MobilePrompt ----------------------------
\* 手机端发送消息的请求归属：ChatController.sendPrompt 与服务器 prompt_ex（chatStore.ts, api.ts, api/chat.rs）。
EXTENDS Naturals

VARIABLES
    composer,      \* 输入框内容：draft / empty / restored (chatStore.ts:585 清空, :606-607 恢复)
    optimistic,    \* 乐观气泡 (chatStore.ts:589, :603)
    req,           \* 请求状态：none / inflight / failed / done (chatStore.ts:591-613)
    serverSeen,    \* 当前请求已到达服务器 (api/chat.rs:465 prompt_ex)
    serverPrompts  \* 服务器累计收到的提示数 (api/chat.rs:488 send_prompt_ex，没有幂等键)

vars == <<composer, optimistic, req, serverSeen, serverPrompts>>

TypeOK ==
    /\ composer \in {"draft", "empty", "restored"}
    /\ optimistic \in BOOLEAN
    /\ req \in {"none", "inflight", "failed", "done"}
    /\ serverSeen \in BOOLEAN
    /\ serverPrompts \in 0..2

Init ==
    /\ composer = "empty"
    /\ optimistic = FALSE
    /\ req = "none"
    /\ serverSeen = FALSE
    /\ serverPrompts = 0

\* 用户在输入框里输入内容
Type ==
    /\ composer = "empty"                      \* 输入框为空时才开始新输入
    /\ composer' = "draft"
    /\ UNCHANGED <<optimistic, req, serverSeen, serverPrompts>>

\* 点发送：sendPrompt
TapSend ==
    /\ composer \in {"draft", "restored"}      \* chatStore.ts:549 sendIntent 对非空文本得到 prompt
    /\ req /= "inflight"                       \* 模型简化：同一时刻只跟踪一个在途请求（见 limits）
    /\ serverPrompts < 2                       \* chatStore.ts:591 模型边界：只统计到两条
    /\ composer' = "empty"                     \* chatStore.ts:585 composer.set("")
    /\ optimistic' = TRUE                      \* chatStore.ts:589
    /\ req' = "inflight"                       \* chatStore.ts:591 POST prompt-ex
    /\ serverSeen' = FALSE
    /\ UNCHANGED serverPrompts

\* 服务器收到并处理该请求
ServerReceives ==
    /\ req = "inflight"                        \* chatStore.ts:591 请求在途
    /\ ~serverSeen                             \* 每个请求只处理一次
    /\ serverSeen' = TRUE
    /\ serverPrompts' = serverPrompts + 1      \* api/chat.rs:488 直接发给 omp，无去重
    /\ UNCHANGED <<composer, optimistic, req>>

\* 服务器的成功响应送达手机
ResponseOk ==
    /\ req = "inflight"                        \* chatStore.ts:591
    /\ serverSeen                              \* api/chat.rs:497-505 成功响应
    /\ req' = "done"                           \* chatStore.ts:599 scheduleFetch
    /\ UNCHANGED <<composer, optimistic, serverSeen, serverPrompts>>

\* 请求失败：30 秒超时或网络中断，手机无法知道服务器是否已处理
ClientFailure ==
    /\ req = "inflight"                        \* api.ts:46-47 超时 / api.ts:60 网络错误
    /\ req' = "failed"                         \* chatStore.ts:601 进入 catch
    /\ optimistic' = FALSE                     \* chatStore.ts:603 移除乐观气泡
    /\ composer' = "restored"                  \* chatStore.ts:606-607 把原文放回输入框
    /\ UNCHANGED <<serverSeen, serverPrompts>>

Next == Type \/ TapSend \/ ServerReceives \/ ResponseOk \/ ClientFailure

Spec == Init /\ [][Next]_vars

\* 规则：输入框里恢复出未发送的文字时，服务器不应已经收到过这条消息。
RestoredMeansNotSent == composer = "restored" => ~serverSeen

\* 规则：同一条消息经一次点击发送，服务器最多收到一次。
NoDuplicatePrompt == serverPrompts <= 1
=============================================================================
