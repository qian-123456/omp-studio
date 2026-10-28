## 1. 待处理（已送达却仍显示待处理且无提示）

Rule broken: 已经送达智能体的想法，要么被标成已派发，要么界面仍保留可重试的错误提示，不能悄悄停在待处理。
Why: 已发送，但记录已派发的操作失败后没有留下任何重试或提示.
In the model, 3 different steps lead into this bug: "手动改变想法状态", "关闭派发对话框", and "放进输入框并发送，记录已派发失败". The steps below are the shortest path that TLC found.

0. Start: 待处理
1. 放进输入框并发送，记录已派发失败. Now: 待处理（已送达却仍显示待处理且无提示）

## 2. 在回收站（超过30天未变动，刚恢复）

Rule broken: 用户从回收站恢复的想法，在用户再次操作前，不会被应用启动时的清理又放回回收站。
Why: 恢复只清除删除时间，不刷新最后修改时间，下次启动又被当作超过30天的已结束想法放回回收站.
In the model, one step leads into this bug: "重新启动应用". The steps below are the shortest path that TLC found.

0. Start: 待处理
1. 手动改变想法状态. Now: 已完成
2. 删除到回收站. Now: 在回收站
3. 从回收站恢复. Now: 已完成（刚恢复）
4. 时间过去30天. Now: 已完成（超过30天未变动，刚恢复）
5. 重新启动应用. Now: 在回收站（超过30天未变动，刚恢复）
