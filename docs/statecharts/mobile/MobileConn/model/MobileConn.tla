---------------------------- MODULE MobileConn ----------------------------
\* 手机端事件流连接：SseClient + useConnection 横幅状态（src-mobile/core/sse.ts, stores/connection.ts, api.ts, pair.ts）。
\* 模型描述现有代码，不加任何额外保护条件。
EXTENDS Naturals

VARIABLES
    phase,        \* useConnection.phase (connection.ts:7)
    es,           \* SseClient.es 的 readyState: none/live/dead (sse.ts:80, :103)
    helloPending, \* connect() 之后 hello 事件尚未送达 (sse.ts:159)
    timer,        \* SseClient.timer 是否已排队 (sse.ts:82, :123)
    probing,      \* probeAndConnect 中 deps.probe 在途 (sse.ts:131)
    started,      \* SseClient.started (sse.ts:83)
    netUp,        \* 浏览器 navigator.onLine (sse.ts:190-191)
    tokenOk,      \* 服务器侧设备令牌仍有效 (auth.rs:97 is_valid)
    unauthSeen    \* 历史变量：曾被标记为未授权且尚未重新配对 (api.ts:39-41)

vars == <<phase, es, helloPending, timer, probing, started, netUp, tokenOk, unauthSeen>>

TypeOK ==
    /\ phase \in {"idle", "connecting", "open", "closed", "unauthorized"}
    /\ es \in {"none", "live", "dead"}
    /\ helloPending \in BOOLEAN
    /\ timer \in BOOLEAN
    /\ probing \in BOOLEAN
    /\ started \in BOOLEAN
    /\ netUp \in BOOLEAN
    /\ tokenOk \in BOOLEAN
    /\ unauthSeen \in BOOLEAN

Init ==
    /\ phase = "idle"       \* connection.ts:17
    /\ es = "none"          \* sse.ts:80
    /\ helloPending = FALSE
    /\ timer = FALSE        \* sse.ts:82
    /\ probing = FALSE
    /\ started = FALSE      \* sse.ts:83
    /\ netUp = TRUE
    /\ tokenOk = TRUE
    /\ unauthSeen = FALSE

\* 启动事件流：startEvents() -> client.start() -> probeAndConnect()
StartStream ==
    /\ ~started                                  \* sse.ts:88 已启动则直接返回
    /\ phase /= "unauthorized"                   \* sse.ts:127 未授权时 probeAndConnect 直接返回
    /\ started' = TRUE                           \* sse.ts:89
    /\ phase' = IF phase /= "open" THEN "connecting" ELSE phase   \* sse.ts:129
    /\ probing' = TRUE                           \* sse.ts:131
    /\ UNCHANGED <<es, helloPending, timer, netUp, tokenOk, unauthSeen>>

\* 探测请求成功：连接事件流
ProbeOk ==
    /\ probing                                   \* sse.ts:131 探测在途
    /\ netUp                                     \* 探测需要网络，网络断开时 fetch 抛 NETWORK_ERROR (api.ts:60)
    /\ tokenOk                                   \* api.ts:79 只有 401 才视为未授权
    /\ probing' = FALSE
    /\ IF started /\ es = "none"                 \* sse.ts:138 仅在已启动且没有事件流时连接
          THEN es' = "live" /\ helloPending' = TRUE   \* sse.ts:150 保存新的事件流，等待 hello
          ELSE es' = es /\ helloPending' = helloPending
    /\ UNCHANGED <<phase, timer, started, netUp, tokenOk, unauthSeen>>

\* 探测请求因网络失败：横幅变为已断开并排队重连
ProbeFailNet ==
    /\ probing                                   \* sse.ts:131
    /\ ~netUp                                    \* api.ts:60 fetch 失败
    /\ probing' = FALSE
    /\ phase' = IF phase = "unauthorized" THEN phase ELSE "closed"  \* sse.ts:133-134
    /\ timer' = IF phase = "unauthorized" THEN timer ELSE TRUE      \* sse.ts:135 scheduleReconnect
    /\ UNCHANGED <<es, helloPending, started, netUp, tokenOk, unauthSeen>>

\* 探测请求遇到 401
Probe401 ==
    /\ probing                                   \* sse.ts:131
    /\ netUp                                     \* api.ts:56-60 请求没有到达服务器时只会得到网络错误，不会得到 401 (api.ts:79)
    /\ ~tokenOk                                  \* api.ts:79 401 即未授权
    /\ probing' = FALSE
    /\ phase' = "unauthorized"                   \* api.ts:40
    /\ unauthSeen' = TRUE
    /\ UNCHANGED <<es, helloPending, timer, started, netUp, tokenOk>>

\* 任意其他接口请求遇到 401（例如发送消息）
ApiUnauthorized ==
    /\ ~tokenOk                                  \* api.ts:79
    /\ phase /= "unauthorized"
    /\ phase' = "unauthorized"                   \* api.ts:40
    /\ unauthSeen' = TRUE
    /\ UNCHANGED <<es, helloPending, timer, probing, started, netUp, tokenOk>>

\* hello 事件送达：横幅变为已连接
HelloArrives ==
    /\ es = "live"                               \* sse.ts:150
    /\ helloPending                              \* sse.ts:159
    /\ netUp                                     \* sse.ts:166-172 断网时事件流触发 onerror 而不是 hello
    /\ tokenOk                                   \* server.rs:605 events 路由经过 require_auth (server.rs:219)
    /\ helloPending' = FALSE
    /\ phase' = "open"                           \* sse.ts:161
    /\ UNCHANGED <<es, timer, probing, started, netUp, tokenOk, unauthSeen>>

\* 浏览器报告事件流出错（网络失败，或服务器因令牌被撤销而结束流）
EsError ==
    /\ es = "live"                               \* sse.ts:167 this.es === src
    /\ (~netUp \/ ~tokenOk)                      \* 网络断开 或 server.rs:625-626 令牌失效即结束流
    /\ es' = "none"                              \* sse.ts:168 close()
    /\ helloPending' = FALSE
    /\ phase' = IF phase = "unauthorized" THEN phase ELSE "closed"  \* sse.ts:169-170
    /\ timer' = IF phase = "unauthorized" THEN timer ELSE TRUE      \* sse.ts:171
    /\ UNCHANGED <<probing, started, netUp, tokenOk, unauthSeen>>

\* 系统在后台悄悄杀掉事件流且没有 onerror（iOS）
EsSilentDeath ==
    /\ es = "live"                               \* sse.ts:103 readyState 2
    /\ es' = "dead"
    /\ UNCHANGED <<phase, helloPending, timer, probing, started, netUp, tokenOk, unauthSeen>>

\* 重连定时器到期
TimerFires ==
    /\ timer                                     \* sse.ts:123
    /\ timer' = FALSE
    /\ IF started /\ phase /= "unauthorized" /\ es = "none"   \* sse.ts:127
          THEN /\ probing' = TRUE                             \* sse.ts:131
               /\ phase' = IF phase /= "open" THEN "connecting" ELSE phase  \* sse.ts:129
          ELSE /\ probing' = probing /\ phase' = phase
    /\ UNCHANGED <<es, helloPending, started, netUp, tokenOk, unauthSeen>>

\* 页面回到前台或网络恢复：resume()
Resume ==
    /\ started                                   \* sse.ts:102
    /\ phase /= "unauthorized"                   \* sse.ts:102 isUnauthorized()
    /\ IF es = "none" \/ es = "dead"             \* sse.ts:103
          THEN /\ es' = "none"                   \* sse.ts:104 close()
               /\ timer' = FALSE                 \* sse.ts:105 clearTimeout
               /\ helloPending' = FALSE
               /\ probing' = TRUE                \* sse.ts:106 -> sse.ts:131
               /\ phase' = IF phase /= "open" THEN "connecting" ELSE phase  \* sse.ts:129
          ELSE UNCHANGED <<es, timer, helloPending, probing, phase>>   \* 事件流仍然存活：只发 resync，不动横幅 (sse.ts:108)
    /\ UNCHANGED <<started, netUp, tokenOk, unauthSeen>>

\* 浏览器 offline 事件：无条件把横幅置为已断开
OfflineEvent ==
    /\ netUp                                     \* 浏览器网络由在线转离线
    /\ netUp' = FALSE
    /\ phase' = "closed"                         \* sse.ts:191 setPhase("closed") 没有检查未授权，也没有关闭事件流
    /\ UNCHANGED <<es, helloPending, timer, probing, started, tokenOk, unauthSeen>>

\* 浏览器 online 事件：resume("online")
OnlineEvent ==
    /\ ~netUp
    /\ netUp' = TRUE                             \* sse.ts:190
    /\ IF started /\ phase /= "unauthorized"     \* sse.ts:102
          THEN IF es = "none" \/ es = "dead"     \* sse.ts:103
                   THEN /\ es' = "none"          \* sse.ts:104
                        /\ timer' = FALSE        \* sse.ts:105
                        /\ helloPending' = FALSE
                        /\ probing' = TRUE       \* sse.ts:106
                        /\ phase' = IF phase /= "open" THEN "connecting" ELSE phase   \* sse.ts:129
                   ELSE UNCHANGED <<es, timer, helloPending, probing, phase>>
          ELSE UNCHANGED <<es, timer, helloPending, probing, phase>>
    /\ UNCHANGED <<started, tokenOk, unauthSeen>>

\* 电脑端撤销配对
ServerRevokes ==
    /\ tokenOk                                   \* auth.rs:111 revoke_all
    /\ tokenOk' = FALSE
    /\ UNCHANGED <<phase, es, helloPending, timer, probing, started, netUp, unauthSeen>>

\* 重新扫码配对成功：令牌恢复并重连
Repair ==
    /\ phase = "unauthorized"                    \* pair.ts:36 仅在配对成功后执行
    /\ ~tokenOk                                  \* auth.rs:45 兑换新配对码得到新令牌
    /\ tokenOk' = TRUE
    /\ phase' = "idle"                           \* pair.ts:36
    /\ unauthSeen' = FALSE
    /\ es' = "none"                              \* 页面重载后事件流重新创建
    /\ timer' = FALSE
    /\ probing' = FALSE
    /\ started' = FALSE
    /\ helloPending' = FALSE
    /\ UNCHANGED netUp

Next ==
    \/ StartStream \/ ProbeOk \/ ProbeFailNet \/ Probe401 \/ ApiUnauthorized
    \/ HelloArrives \/ EsError \/ EsSilentDeath \/ TimerFires \/ Resume
    \/ OfflineEvent \/ OnlineEvent \/ ServerRevokes \/ Repair

Spec == Init /\ [][Next]_vars

\* 规则：网络在线、令牌有效、事件流已收到问候并仍然存活时，横幅应显示已连接。
BannerMatchesStream ==
    (netUp /\ tokenOk /\ es = "live" /\ ~helloPending) => phase = "open"

\* 规则：被撤销的设备提示一旦出现，在重新配对前不能被"网络已断开"之类的提示覆盖。
UnauthorizedSticky == unauthSeen => phase = "unauthorized"

\* 规则：横幅显示已连接时，要么有事件流，要么正在探测或已排队重连，不能没有任何后续动作。
OpenMeansStream == phase = "open" => (es /= "none" \/ probing \/ timer)
=============================================================================
