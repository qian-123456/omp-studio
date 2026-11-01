## 1. 面板已开，双轮内存扫描

Rule broken: Opening the panel must not start a second memory scan before the first finishes. Starts: src/components/BottomBar.tsx:84,92-96,139,146.
Why: 旧请求未完成，面板切换重置了防重入状态.
In the model, one step leads into this bug: "面板启动新一轮采样".

0. Start: 面板已关，没有采样在途
1. 底栏启动内存采样. Now: 面板已关，一轮采样中
2. 点击性能打开面板. Now: 面板已开，一轮采样中
3. 切换刷新周期，旧请求继续. Now: 面板已开，旧扫描未完成
4. 面板启动新一轮采样. Now: 面板已开，双轮内存扫描

With 建议模型（产品未改）, step 4 (面板启动新一轮采样) cannot happen, so you stay at: 面板已开，旧扫描未完成.
