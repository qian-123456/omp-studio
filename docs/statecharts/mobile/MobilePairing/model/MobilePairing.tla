---------------------------- MODULE MobilePairing ----------------------------
\* 手机配对、撤销、事件流与网页推送：auth.rs, server.rs, push.rs, api/push.rs。
EXTENDS Naturals

VARIABLES
    code,           \* 配对码状态 pairing_codes: none/fresh/used/expired (auth.rs:29-41, :45-80)
    redeems,        \* 当前配对码被兑换的次数 (auth.rs:70 UPDATE ... used = 0)
    tokenOwner,     \* 持有设备令牌的一方：none/phone/preview (auth.rs:73-76 mobile_devices)
    stream,         \* /api/events 流：none/live (server.rs:605 SseGuard::new)
    subscribed,     \* 手机有网页推送订阅 push_subscriptions (api/push.rs:63-72)
    phoneViewing,   \* 手机正在前台查看该会话（用户事实，不是代码变量）
    recent,         \* 同一会话同种通知 30 秒内已推送 (push.rs:635 recent)
    pushed,         \* 已发出的推送次数 (push.rs:529 notify)
    pushedWhileViewing, \* 手机正前台查看时仍收到推送（历史标记）
    droppedApproval     \* 订阅设备的审批通知被 30 秒去重丢弃（历史标记）

vars == <<code, redeems, tokenOwner, stream, subscribed, phoneViewing, recent, pushed, pushedWhileViewing, droppedApproval>>

TypeOK ==
    /\ code \in {"none", "fresh", "used", "expired"}
    /\ redeems \in 0..2
    /\ tokenOwner \in {"none", "phone", "preview"}
    /\ stream \in {"none", "live"}
    /\ subscribed \in BOOLEAN
    /\ phoneViewing \in BOOLEAN
    /\ recent \in BOOLEAN
    /\ pushed \in 0..2
    /\ pushedWhileViewing \in BOOLEAN
    /\ droppedApproval \in BOOLEAN

Init ==
    /\ code = "none"
    /\ redeems = 0
    /\ tokenOwner = "none"
    /\ stream = "none"
    /\ subscribed = FALSE
    /\ phoneViewing = FALSE
    /\ recent = FALSE
    /\ pushed = 0
    /\ pushedWhileViewing = FALSE
    /\ droppedApproval = FALSE

\* 电脑端生成配对码（二维码）
CreatePairing ==
    /\ code \in {"none", "used", "expired"}     \* mod.rs:271 每次生成新码；旧的 fresh 码仍有效，这里只建模一个
    /\ code' = "fresh"                          \* auth.rs:38-40 INSERT used = 0
    /\ redeems' = 0
    /\ UNCHANGED <<tokenOwner, stream, subscribed, phoneViewing, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 五分钟过期
ExpireCode ==
    /\ code = "fresh"                           \* auth.rs:9 PAIRING_TTL_MINUTES
    /\ code' = "expired"                        \* auth.rs:62-65 expired 判断
    /\ UNCHANGED <<redeems, tokenOwner, stream, subscribed, phoneViewing, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 任何一方用 GET /pair?code= 访问：手机浏览器或聊天软件的链接预览
VisitPair ==
    \E who \in {"phone", "preview"} :
        /\ code = "fresh"                       \* auth.rs:62-66 未使用且未过期
        /\ tokenOwner = "none"                  \* 模型只跟踪一个令牌
        /\ code' = "used"                       \* auth.rs:67-71 条件更新 used = 1
        /\ redeems' = redeems + 1
        /\ tokenOwner' = who                    \* server.rs:264-276 GET 请求直接兑换并 Set-Cookie，不检查来源或请求头
        /\ UNCHANGED <<stream, subscribed, phoneViewing, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 电脑端撤销全部配对
RevokeAll ==
    /\ tokenOwner /= "none" \/ code /= "none"    \* commands.rs:43 总是可以点；无状态变化时无意义
    /\ tokenOwner' = "none"                     \* auth.rs:113 DELETE FROM mobile_devices
    /\ code' = "none"                           \* auth.rs:113 DELETE FROM pairing_codes
    /\ subscribed' = FALSE                      \* auth.rs:113 DELETE FROM push_subscriptions
    /\ redeems' = 0
    /\ UNCHANGED <<stream, phoneViewing, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 手机打开事件流
OpenStream ==
    /\ tokenOwner = "phone"                     \* server.rs:219 require_auth 校验令牌
    /\ stream = "none"
    /\ stream' = "live"                         \* server.rs:605 SseGuard::new
    /\ UNCHANGED <<code, redeems, tokenOwner, subscribed, phoneViewing, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 服务器发现令牌失效而结束事件流（每 10 秒或有事件时检查）
EndStreamRevoked ==
    /\ stream = "live"
    /\ tokenOwner /= "phone"                    \* server.rs:625-626 is_valid 为假即结束
    /\ stream' = "none"
    /\ UNCHANGED <<code, redeems, tokenOwner, subscribed, phoneViewing, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 手机离开前台或关闭事件流
PhoneClosesStream ==
    /\ stream = "live"
    /\ stream' = "none"                         \* server.rs:605 SseGuard 释放
    /\ phoneViewing' = FALSE
    /\ UNCHANGED <<code, redeems, tokenOwner, subscribed, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 手机开启通知
Subscribe ==
    /\ tokenOwner = "phone"                     \* server.rs:219 + api/push.rs:63 订阅需要有效令牌
    /\ subscribed' = TRUE                       \* push.rs:318 save_subscription
    /\ UNCHANGED <<code, redeems, tokenOwner, stream, phoneViewing, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 用户切到前台查看该会话
PhoneViews ==
    /\ stream = "live"                          \* sse.ts:150 用户事实：事件流在线时手机才可能在前台查看
    /\ ~phoneViewing
    /\ phoneViewing' = TRUE                     \* 手机端没有任何代码把这一事实告诉服务器（src-mobile 无 /presence 调用）
    /\ UNCHANGED <<code, redeems, tokenOwner, stream, subscribed, recent, pushed, pushedWhileViewing, droppedApproval>>

\* 运行端的会话进入等待审批
ApprovalRaised ==
    /\ pushed < 2                               \* 模型边界
    /\ IF recent                                \* push.rs:648 30 秒内同会话同种通知直接 continue
          THEN /\ droppedApproval' = (droppedApproval \/ subscribed)
               /\ UNCHANGED <<recent, pushed, pushedWhileViewing>>
          ELSE /\ recent' = TRUE                \* push.rs:648 记录时间
               /\ IF subscribed                 \* push.rs:349 只有仍有订阅的设备会被通知
                     THEN /\ pushed' = pushed + 1
                          \* push.rs:431-439 没有收到在线状态上报时 is_viewing_session 恒为假，不会跳过
                          /\ pushedWhileViewing' = (pushedWhileViewing \/ (stream = "live" /\ phoneViewing))
                     ELSE UNCHANGED <<pushed, pushedWhileViewing>>
               /\ UNCHANGED droppedApproval
    /\ UNCHANGED <<code, redeems, tokenOwner, stream, subscribed, phoneViewing>>

\* 30 秒过去
ThirtySeconds ==
    /\ recent                                   \* push.rs:647 retain 30 秒
    /\ recent' = FALSE
    /\ UNCHANGED <<code, redeems, tokenOwner, stream, subscribed, phoneViewing, pushed, pushedWhileViewing, droppedApproval>>

Next ==
    \/ CreatePairing \/ ExpireCode \/ VisitPair \/ RevokeAll \/ OpenStream
    \/ EndStreamRevoked \/ PhoneClosesStream \/ Subscribe \/ PhoneViews
    \/ ApprovalRaised \/ ThirtySeconds

Spec == Init /\ [][Next]_vars

\* 规则：配对码只能被手机兑换，链接预览之类的访问不应拿到设备令牌。
OnlyPhonePairs == tokenOwner \in {"none", "phone"}

\* 规则：一个配对码最多只能兑换一次。
CodeSingleUse == redeems <= 1

\* 规则：撤销配对后，手机不应再保留推送订阅。
RevokedHasNoSubscription == (tokenOwner = "none") => ~subscribed

\* 规则：手机正在前台查看会话且事件流在线时，不应再对它推送通知。
NoPushWhileViewing == ~pushedWhileViewing

\* 规则：订阅了通知的手机，每次审批请求都应收到通知，不应被去重悄悄吞掉。
NoApprovalDropped == ~droppedApproval
=============================================================================
