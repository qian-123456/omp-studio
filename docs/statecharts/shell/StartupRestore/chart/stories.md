## 1. 停在首页: 会话列表已加载，恢复已处理，用户打开的页面被抢走

Rule broken: 用户在启动加载期间自己打开的页面，启动恢复不能把它抢走。
Why: 启动恢复只看会话是否加载完，不看用户已经去了别的页面.
In the model, one step leads into this bug: "启动恢复上次的会话". The steps below are the shortest path that TLC found.

0. Start: 停在首页: 会话列表加载中
1. 加载没完成时自己打开设置或收件箱. Now: 停在收件箱: 会话列表加载中
2. 会话列表第一次加载成功. Now: 停在收件箱: 会话列表已加载
3. 启动恢复上次的会话. Now: 停在首页: 会话列表已加载，恢复已处理，用户打开的页面被抢走

With the fix, step 3 (启动恢复上次的会话) takes you to: 停在收件箱: 会话列表已加载，恢复已处理.
