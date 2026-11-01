## 1. 刷新完成，两处内存不一致

Rule broken: The bottom bar and open panel must show the same app-memory sample after a refresh. Writes: src/components/BottomBar.tsx:101-109,147,232-240; reads: PerfPopover.tsx:219.
Why: 底栏和面板使用不同时间的独立采样.
In the model, one step leads into this bug: "刷新底栏与面板". The steps below are the shortest path that TLC found.

0. Start: 底栏和面板等待独立采样
1. 底栏独立采样返回. Now: 底栏采样已返回，等待面板
2. 面板独立采样返回. Now: 两份采样返回，数值不同
3. 刷新底栏与面板. Now: 刷新完成，两处内存不一致

With 建议模型（产品未改）, step 3 (刷新底栏与面板) takes you to: 刷新完成，两处内存一致.
