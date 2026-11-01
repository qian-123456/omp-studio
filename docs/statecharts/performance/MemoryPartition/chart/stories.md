## 1. 分布已出，总和超过整机

Rule broken: Displayed known memory segments must add up to total physical memory. Writes: src-tauri/src/services/perf.rs:501-504,561-568; display: PerfPopover.tsx:106-117.
Why: 较晚的进程采样超过较早的整机已用，负差额被截为零.
In the model, one step leads into this bug: "其余内存不足时按零计算".

0. Start: 等待整机内存采样
1. 先读取整机已用内存. Now: 整机已采样，等待进程
2. 随后读取各进程内存. Now: 后采进程，占用已增长
3. 其余内存不足时按零计算. Now: 分布已出，总和超过整机
