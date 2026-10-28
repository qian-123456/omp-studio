## 1. 中间显示分支草稿: 用户刚点了新建会话，新会话草稿被盖住

Rule broken: 用户刚点了新建会话，中间区域就必须显示新的空白会话，而不是别的草稿。
Why: 分支草稿一直开着，新建会话草稿虽然建好了却被它盖住.
In the model, one step leads into this bug: "按 Cmd+N 或点新建会话". The steps below are the shortest path that TLC found.

0. Start: 中间显示起始页: 刚打开
1. 在运行中的会话上点分支. Now: 中间显示分支草稿: 用户刚点了分支
2. 按 Cmd+N 或点新建会话. Now: 中间显示分支草稿: 用户刚点了新建会话，新会话草稿被盖住

With the fix, step 2 (按 Cmd+N 或点新建会话) takes you to: 中间显示新会话草稿: 用户刚点了新建会话.
