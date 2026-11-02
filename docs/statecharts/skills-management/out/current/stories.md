## 1. 列表显示 1 个来源，已移走的目录仍在，操作已结束

Rule broken: 删除操作结束后，列表不能继续把已移走的目录当成当前安装位置。 Mutators: src/features/skills/store.ts:317-348,566-584.
Why: 副本移走后扫描失败，旧目录未从列表失效.
In the model, one step leads into this bug: "结束操作并解除忙碌状态". The steps below are the shortest path that TLC found.

0. Start: 列表显示 1 个来源，尚未移除
1. 点击移除. Now: 列表显示 1 个来源，等待确认移除
2. 确认仅移除当前副本. Now: 列表显示 1 个来源，正在移除当前副本
3. 系统移走当前副本并提示成功. Now: 列表显示 1 个来源，副本已移走，已提示成功
4. 开始刷新列表. Now: 列表显示 1 个来源，正在重新扫描
5. 扫描失败. Now: 列表显示 1 个来源，刷新失败，正在结束操作
6. 结束操作并解除忙碌状态. Now: 列表显示 1 个来源，已移走的目录仍在，操作已结束
