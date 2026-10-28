## 1. 文件标签未打开，关闭标签时丢了草稿

Rule broken: 未保存的修改在关闭标签时不会丢失。
Why: 关闭时没有检查未保存内容.
In the model, one step leads into this bug: "关闭标签". The steps below are the shortest path that TLC found.

0. Start: 文件标签未打开
1. 点击路径打开文件. Now: 正在读取文件
2. 文件读取完成. Now: 无未保存改动
3. 输入文字. Now: 有未保存改动
4. 关闭标签. Now: 文件标签未打开，关闭标签时丢了草稿

## 2. 无未保存改动，点重新载入丢了草稿

Rule broken: 未保存的修改在点重新载入时不会在没确认的情况下丢失。
Why: 重新读取直接覆盖草稿.
In the model, one step leads into this bug: "点重新载入". The steps below are the shortest path that TLC found.

0. Start: 文件标签未打开
1. 点击路径打开文件. Now: 正在读取文件
2. 文件读取完成. Now: 无未保存改动
3. 输入文字. Now: 有未保存改动
4. 点重新载入. Now: 无未保存改动，点重新载入丢了草稿

## 3. 标签已打开但当前在看别的标签，切换标签时丢了草稿

Rule broken: 未保存的修改在切换标签时不会丢失。
Why: 切换标签后编辑缓冲区被重建.
In the model, one step leads into this bug: "切换到别的标签". The steps below are the shortest path that TLC found.

0. Start: 文件标签未打开
1. 点击路径打开文件. Now: 正在读取文件
2. 文件读取完成. Now: 无未保存改动
3. 输入文字. Now: 有未保存改动
4. 切换到别的标签. Now: 标签已打开但当前在看别的标签，切换标签时丢了草稿

## 4. 无未保存改动，覆盖了没见过的磁盘改动

Rule broken: 保存不会悄悄覆盖用户从没看到过的磁盘改动。
Why: 保存没有核验磁盘版本.
In the model, one step leads into this bug: "写盘完成". The steps below are the shortest path that TLC found.

0. Start: 文件标签未打开
1. 点击路径打开文件. Now: 正在读取文件
2. 文件读取完成. Now: 无未保存改动
3. 输入文字. Now: 有未保存改动
4. 点保存. Now: 正在保存
   (1 hidden step: 代理在后台改了磁盘文件)
5. 写盘完成. Now: 无未保存改动，覆盖了没见过的磁盘改动

## 5. 无未保存改动，聚焦刷新冲掉了输入

Rule broken: 窗口聚焦后的后台刷新不会冲掉用户刚输入的文字。
Why: 后台读取采用过期的未修改状态.
In the model, one step leads into this bug: "聚焦后台重读返回". The steps below are the shortest path that TLC found.

0. Start: 文件标签未打开
1. 点击路径打开文件. Now: 正在读取文件
2. 文件读取完成. Now: 无未保存改动
   (1 hidden step: 代理在后台改了磁盘文件)
3. 窗口重新获得焦点. Now: 无未保存改动
4. 输入文字. Now: 有未保存改动
5. 聚焦后台重读返回. Now: 无未保存改动，聚焦刷新冲掉了输入
