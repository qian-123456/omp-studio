## 1. 空闲，其他条目被清空

Rule broken: 规则：只切换一个条目时，列表里别的条目不会被清掉。
In the model, one step leads into this bug: "把新列表写回配置". The steps below are the shortest path that TLC found.

0. Start: 空闲，其他条目保留
1. 点开关，读取配置列表. Now: 读配置列表失败，当成空列表，其他条目保留
2. 把新列表写回配置. Now: 空闲，其他条目被清空
