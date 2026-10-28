## 1. 编辑弹窗已打开却看不见

Rule broken: 规则：编辑弹窗处于打开状态时，用户一定能在屏幕上看到它。
In the model, one step leads into this bug: "服务器被外部删除后列表重读".

0. Start: 没有弹窗
1. 点编辑. Now: 编辑弹窗可见
2. 服务器被外部删除后列表重读. Now: 编辑弹窗已打开却看不见
