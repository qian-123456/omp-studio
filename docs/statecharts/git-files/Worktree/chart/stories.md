## 1. 会话目录不存在，旧提交目录已删，运行中的旧提交被删了目录

Rule broken: 正在运行的时光机不会被「回收孤儿」删掉目录。
Why: 孤儿列表没有旧提交运行的占用信息.
In the model, one step leads into this bug: "点回收旧提交工作树". The steps below are the shortest path that TLC found.

0. Start: 会话目录不存在
1. 运行旧提交. Now: 会话目录不存在，旧提交正在运行
2. 扫描孤儿工作树. Now: 会话目录不存在，旧提交正在运行，孤儿列表有项
3. 点回收旧提交工作树. Now: 会话目录不存在，旧提交目录已删，运行中的旧提交被删了目录

## 2. 会话目录不存在，在用的工作树被删

Rule broken: 有会话在用的工作树不会被「回收孤儿」删掉。
Why: 扫描后会话占用发生变化.
In the model, one step leads into this bug: "点回收会话工作树". The steps below are the shortest path that TLC found.

0. Start: 会话目录不存在
1. 新建工作树. Now: 会话目录无会话干净
2. 扫描孤儿工作树. Now: 会话目录无会话干净，孤儿列表有项
3. 会话开始使用该目录. Now: 会话目录有会话干净，孤儿列表有项
4. 点回收会话工作树. Now: 会话目录不存在，在用的工作树被删

## 3. 会话目录不存在，孤儿列表有项，列表仍显示已删除的目录

Rule broken: 清理失败后，界面不会再显示一个磁盘上已经不存在的工作树。
Why: 目录删除成功但分支删除报错.
In the model, one step leads into this bug: "点回收会话工作树". The steps below are the shortest path that TLC found.

0. Start: 会话目录不存在
1. 新建工作树. Now: 会话目录无会话干净
2. 在工作树里提交. Now: 会话目录无会话干净分支未合并
3. 扫描孤儿工作树. Now: 会话目录无会话干净分支未合并，孤儿列表有项
4. 点回收会话工作树. Now: 会话目录不存在，孤儿列表有项，列表仍显示已删除的目录
