## 1. 查询失败，仍显示旧内存

Rule broken: A rejected service-query IPC must not discard a completed distribution sample. Writes: src/components/BottomBar.tsx:99-114.
Why: 查询通信失败连带丢弃内存分布结果.
In the model, 3 different steps lead into this bug: "内存分布成功返回", "内存采样成功返回", and "本轮请求结束". The steps below are the shortest path that TLC found.

0. Start: 查询待返，内存待返，分布待返
1. 内存采样成功返回. Now: 查询待返，内存已返，分布待返
2. 内存分布成功返回. Now: 查询待返，内存已返，分布已返
3. 服务查询通信失败. Now: 查询失败，内存已返，分布已返
4. 本轮请求结束. Now: 查询失败，仍显示旧内存

With 建议模型（产品未改）, step 4 (本轮请求结束) takes you to: 查询失败，内存仍更新.

## 2. 查询失败，仍显示旧内存

Rule broken: A rejected service-query IPC must not discard a completed memory sample. Writes: src/components/BottomBar.tsx:99-114.
Why: 查询通信失败连带丢弃底栏内存结果.
In the model, 3 different steps lead into this bug: "内存分布成功返回", "内存采样成功返回", and "本轮请求结束". The steps below are the shortest path that TLC found.

0. Start: 查询待返，内存待返，分布待返
1. 内存采样成功返回. Now: 查询待返，内存已返，分布待返
2. 内存分布成功返回. Now: 查询待返，内存已返，分布已返
3. 服务查询通信失败. Now: 查询失败，内存已返，分布已返
4. 本轮请求结束. Now: 查询失败，仍显示旧内存

With 建议模型（产品未改）, step 4 (本轮请求结束) takes you to: 查询失败，内存仍更新.
