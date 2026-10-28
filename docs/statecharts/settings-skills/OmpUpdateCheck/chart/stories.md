## 1. 已升级到新版本，显示有可用更新

Rule broken: 规则：更新成功、所有检查都结束后，界面不再显示"有可用更新"。
In the model, one step leads into this bug: "检查结果返回". The steps below are the shortest path that TLC found.

0. Start: 还是旧版本，不显示可用更新
1. 开始检查更新. Now: 还是旧版本，正在检查更新，不显示可用更新
2. 点更新. Now: 还是旧版本，正在更新，不显示可用更新
3. 更新完成. Now: 已升级到新版本，正在检查更新，不显示可用更新
4. 检查结果返回. Now: 已升级到新版本，显示有可用更新
