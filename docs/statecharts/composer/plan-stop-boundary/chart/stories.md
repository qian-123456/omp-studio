## 1. 正在响应隐藏提醒：还没有计划文件，已点停止1次

Rule broken: 用户点击停止后，系统不会悄悄再发一轮“写计划”的提醒。
In the model, one step leads into this bug: "点击停止". The steps below are the shortest path that TLC found.

0. Start: 空闲：还没有计划文件，已点停止0次
1. 发送一条消息. Now: 正在回答你的消息：还没有计划文件，已点停止0次
2. 点击停止. Now: 正在响应隐藏提醒：还没有计划文件，已点停止1次

## 2. 正在响应隐藏提醒：还没有计划文件，已点停止2次

Rule broken: 用户点击停止后，系统不会悄悄再发一轮“写计划”的提醒。
In the model, one step leads into this bug: "点击停止". The steps below are the shortest path that TLC found.

0. Start: 空闲：还没有计划文件，已点停止0次
1. 发送一条消息. Now: 正在回答你的消息：还没有计划文件，已点停止0次
2. 这一轮自然结束. Now: 正在响应隐藏提醒：还没有计划文件，已点停止0次
3. 点击停止. Now: 空闲：还没有计划文件，已点停止1次
4. 发送一条消息. Now: 正在回答你的消息：还没有计划文件，已点停止1次
5. 点击停止. Now: 正在响应隐藏提醒：还没有计划文件，已点停止2次

## 3. 正在响应隐藏提醒：还没有计划文件，已点停止3次

Rule broken: 用户点击停止后，系统不会悄悄再发一轮“写计划”的提醒。
In the model, one step leads into this bug: "点击停止". The steps below are the shortest path that TLC found.

0. Start: 空闲：还没有计划文件，已点停止0次
1. 发送一条消息. Now: 正在回答你的消息：还没有计划文件，已点停止0次
2. 这一轮自然结束. Now: 正在响应隐藏提醒：还没有计划文件，已点停止0次
3. 点击停止. Now: 空闲：还没有计划文件，已点停止1次
4. 发送一条消息. Now: 正在回答你的消息：还没有计划文件，已点停止1次
5. 这一轮自然结束. Now: 正在响应隐藏提醒：还没有计划文件，已点停止1次
6. 点击停止. Now: 空闲：还没有计划文件，已点停止2次
7. 发送一条消息. Now: 正在回答你的消息：还没有计划文件，已点停止2次
8. 点击停止. Now: 正在响应隐藏提醒：还没有计划文件，已点停止3次
