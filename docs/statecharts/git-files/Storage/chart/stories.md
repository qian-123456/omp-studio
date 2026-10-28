## 1. 会话已移入废纸篓，已置顶，检查后才置顶的会话被删

Rule broken: 清理不会删掉检查之后才被置顶的会话。
Why: 检查后置顶未再次核验.
In the model, one step leads into this bug: "真正移入废纸篓". The steps below are the shortest path that TLC found.

0. Start: 会话空闲
1. 点清理，检查通过. Now: 会话空闲，清理检查已通过
2. 置顶或取消置顶. Now: 会话空闲，已置顶，清理检查已通过
3. 真正移入废纸篓. Now: 会话已移入废纸篓，已置顶，检查后才置顶的会话被删

## 2. 会话已移入废纸篓，检查后才启动的会话被停掉并删除

Rule broken: 清理不会删掉检查之后才被启动的会话。
Why: 检查后启动未再次核验.
In the model, one step leads into this bug: "真正移入废纸篓". The steps below are the shortest path that TLC found.

0. Start: 会话空闲
1. 点清理，检查通过. Now: 会话空闲，清理检查已通过
2. 在应用里启动会话. Now: 会话已在应用里启动，当前空闲，清理检查已通过
3. 真正移入废纸篓. Now: 会话已移入废纸篓，检查后才启动的会话被停掉并删除

## 3. 会话已移入废纸篓，终端占用的会话被删

Rule broken: 清理不会删掉被终端里的 omp 占用的会话。
Why: 终端占用未再次核验.
In the model, one step leads into this bug: "真正移入废纸篓". The steps below are the shortest path that TLC found.

0. Start: 会话空闲
1. 点清理，检查通过. Now: 会话空闲，清理检查已通过
2. 终端里的 omp 开始占用. Now: 会话被终端里的 omp 占用，清理检查已通过
3. 真正移入废纸篓. Now: 会话已移入废纸篓，终端占用的会话被删
