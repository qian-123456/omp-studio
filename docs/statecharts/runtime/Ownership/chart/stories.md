## 1. 显示被外部终端占用，状态文件的进程号已被无关程序占用

Rule broken: 规则1: 周期检查跟上之后，会话显示被外部占用时，占用者必须真是一个仍在运行的 omp 终端。
Why: 终端被强杀后状态文件没有改成已退出，进程号又被无关程序复用，只靠进程号存活就判为外部占用.
In the model, 4 different steps lead into this bug: "周期检查刷新显示", "系统把该进程号分给无关程序", "写入挂起标记", and "退出事件刷新显示". The steps below are the shortest path that TLC found.

0. Start: 显示空闲
1. 终端启动 omp. Now: 显示空闲，状态文件指向运行中的终端
2. 被记录的进程被强制关闭. Now: 显示空闲，状态文件指向已死进程
3. 系统把该进程号分给无关程序. Now: 显示空闲，状态文件的进程号已被无关程序占用
4. 周期检查刷新显示. Now: 显示被外部终端占用，状态文件的进程号已被无关程序占用

## 2. 显示空闲

Rule broken: 规则2: 空闲回收完成且显示刷新后，会话应显示已挂起。
Why: 挂起标记写入时不触发刷新，进程退出的刷新先发生，显示停在空闲.
In the model, 3 different steps lead into this bug: "写入挂起标记", "被记录的进程被强制关闭", and "终端 omp 正常退出". The steps below are the shortest path that TLC found.

0. Start: 显示空闲
1. 点击继续会话. Now: 由本应用运行
2. 空闲回收关闭进程. Now: 由本应用运行，挂起标记待写
3. 退出事件刷新显示. Now: 显示空闲，挂起标记待写
4. 写入挂起标记. Now: 显示空闲
