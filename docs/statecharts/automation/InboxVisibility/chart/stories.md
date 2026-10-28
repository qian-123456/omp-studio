## 1. 仅重要时提醒；会话条目

Rule broken: 通知策略选“仅在失败或需要审批时提醒”时，顺利完成且没停下来过的运行不应出现在收件箱里。
Why: 通知策略只控制结果待办，运行用的会话依旧凭自己的关注度进入收件箱.
In the model, one step leads into this bug: "运行在会话中顺利结束".

0. Start: 仅重要时提醒；没有条目
1. 运行在会话中顺利结束. Now: 仅重要时提醒；会话条目

## 2. 不放入收件箱；会话条目

Rule broken: 通知策略选“不放入收件箱”时，这次运行不应在收件箱里出现任何条目。
Why: 通知策略只控制结果待办，运行用的会话依旧凭自己的关注度进入收件箱.
In the model, 2 different steps lead into this bug: "运行在会话中失败或超时" and "运行在会话中顺利结束". The steps below are the shortest path that TLC found.

0. Start: 不放入收件箱；没有条目
1. 运行在会话中顺利结束. Now: 不放入收件箱；会话条目

## 3. 每次都提醒；会话条目＋结果待办

Rule broken: 同一次运行的结果不应同时以两个条目出现在收件箱。
Why: 运行用的会话自己进入收件箱，同时通知策略又生成了一条结果待办.
In the model, 2 different steps lead into this bug: "运行在会话中失败或超时" and "运行在会话中顺利结束". The steps below are the shortest path that TLC found.

0. Start: 每次都提醒；没有条目
1. 运行在会话中顺利结束. Now: 每次都提醒；会话条目＋结果待办
