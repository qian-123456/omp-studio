## 1. 正在生成提示词，用户的修改已被覆盖

Rule broken: 会话列表的后台刷新不应覆盖用户已改过的提示词或已选的诊断会话。
Why: 打开对话框时的初始化动作依赖会话列表，列表每次刷新都会重新生成提示词并重置选择.
In the model, one step leads into this bug: "后台会话列表刷新了一次". The steps below are the shortest path that TLC found.

0. Start: 正在生成提示词
1. 提示词生成完毕. Now: 提示词已就绪
2. 用户修改提示词. Now: 提示词已就绪，用户改过提示词
3. 后台会话列表刷新了一次. Now: 正在生成提示词，用户的修改已被覆盖

## 2. 提示词已就绪，按钮显示发送中，已发多次

Rule broken: 同一次诊断不应被重复发送。
Why: 列表刷新把发送中状态清零，按钮重新可点，而上一次请求仍在进行.
In the model, one step leads into this bug: "点击开始诊断". The steps below are the shortest path that TLC found.

0. Start: 正在生成提示词
1. 提示词生成完毕. Now: 提示词已就绪
2. 点击开始诊断. Now: 提示词已就绪，按钮显示发送中
3. 后台会话列表刷新了一次. Now: 正在生成提示词，请求仍在发送但按钮已恢复可点
4. 提示词生成完毕. Now: 提示词已就绪，请求仍在发送但按钮已恢复可点
5. 点击开始诊断. Now: 提示词已就绪，按钮显示发送中，已发多次
