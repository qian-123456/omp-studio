------------------------ MODULE OmpListReadModifyWrite ------------------------
\* 技能页/插件页对 omp 配置里字符串列表（disabledExtensions）的"读—改—写"。
EXTENDS Naturals

VARIABLES
  cfgHasA,   \* disabledExtensions 配置里原有的其他条目 A（skills/store.ts:128 entry.value）
  cfgHasB,   \* 列表里是否含本次切换的条目 B（skills/store.ts:135 ompConfigSet）
  step,      \* 读写阶段：idle / read
  readOk,    \* omp config list 是否成功：settings.rs:704-708 失败时 found=false 且 entries 为空
  current    \* skills/store.ts:129-132 current：从读取结果得到的现有列表是否含 A

vars == <<cfgHasA, cfgHasB, step, readOk, current>>
Init == cfgHasA = TRUE /\ cfgHasB = FALSE /\ step = "idle" /\ readOk = TRUE /\ current = TRUE

\* 用户切换 B：先读列表。读取可能失败，但代码不检查 found (skills/store.ts:127-132，PluginsSection.tsx:64-69)
ToggleRead ==
  /\ step = "idle"
  /\ \E ok \in BOOLEAN :
        /\ readOk' = ok
        /\ current' = IF ok THEN cfgHasA ELSE FALSE    \* settings.rs:704-708 失败时空列表；skills/store.ts:129-132
  /\ step' = "read"
  /\ UNCHANGED <<cfgHasA, cfgHasB>>

\* 把"读到的列表加上 B"整体写回 (skills/store.ts:133-135；settings.rs:714 omp_config_set 整体替换该键)
ToggleWrite ==
  /\ step = "read"
  /\ cfgHasA' = current /\ cfgHasB' = TRUE
  /\ step' = "idle"
  /\ UNCHANGED <<readOk, current>>

Next == ToggleRead \/ ToggleWrite
Spec == Init /\ [][Next]_vars

\* 规则：只切换一个条目时，列表里别的条目不会被清掉。
OtherEntriesKept == cfgHasA
=====================================================================
