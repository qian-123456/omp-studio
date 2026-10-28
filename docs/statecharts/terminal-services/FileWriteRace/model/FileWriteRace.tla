----------------------------- MODULE FileWriteRace -----------------------------
\* 文本文件保存（write_text_file → files::write_text）: 同一进程内两次对同一文件的并发保存共用同一个临时文件名。
\* 模型描述现有代码（from-spec）；代码根目录 omp-workspace/.worktrees/bug-fix (HEAD 7f85613)。
\* 范围: 两次对同一路径的保存；单次保存的大小/目录/权限校验与原子替换在 files.rs 内按只读处理。
EXTENDS Naturals

VARIABLES
  w1,      \* 第一次保存调用的进度: idle/tmpWritten/ok/failed
  w2,      \* 第二次保存调用的进度
  tmp,     \* 共用临时文件 .<name>.ompws-<pid>.tmp 的内容: none/c1/c2
  file     \* 目标文件的内容: old/c1/c2

vars == <<w1, w2, tmp, file>>

TypeOK ==
  /\ w1 \in {"idle", "tmpWritten", "ok", "failed"}
  /\ w2 \in {"idle", "tmpWritten", "ok", "failed"}
  /\ tmp \in {"none", "c1", "c2"}
  /\ file \in {"old", "c1", "c2"}

Init == w1 = "idle" /\ w2 = "idle" /\ tmp = "none" /\ file = "old"

WriteTmp1 ==
  /\ w1 = "idle"                  \* services/commands.rs:30-35 每次调用都进入 spawn_blocking(write_text)
  /\ w1' = "tmpWritten"           \* files.rs:86 std::fs::write(&tmp, content)
  /\ tmp' = "c1"                  \* files.rs:85 临时名只含文件名与进程号，两次调用相同
  /\ UNCHANGED <<w2, file>>

WriteTmp2 ==
  /\ w2 = "idle"                  \* services/commands.rs:30-35
  /\ w2' = "tmpWritten"           \* files.rs:86
  /\ tmp' = "c2"                  \* files.rs:85
  /\ UNCHANGED <<w1, file>>

Rename1 ==
  /\ w1 = "tmpWritten"            \* files.rs:90 写完临时文件才重命名
  /\ file' = IF tmp # "none" THEN tmp ELSE file    \* files.rs:90 rename(&tmp, path) 搬走的是共用临时文件里当下的内容
  /\ w1' = IF tmp # "none" THEN "ok" ELSE "failed" \* files.rs:90-93 临时文件不存在时 rename 失败并返回“写入失败”
  /\ tmp' = "none"                \* files.rs:90-91 rename 之后或失败后 remove_file 都使共用临时文件消失
  /\ UNCHANGED <<w2>>

Rename2 ==
  /\ w2 = "tmpWritten"            \* files.rs:90
  /\ file' = IF tmp # "none" THEN tmp ELSE file    \* files.rs:90
  /\ w2' = IF tmp # "none" THEN "ok" ELSE "failed" \* files.rs:90-93
  /\ tmp' = "none"                \* files.rs:90-91
  /\ UNCHANGED <<w1>>

Next == WriteTmp1 \/ WriteTmp2 \/ Rename1 \/ Rename2
Spec == Init /\ [][Next]_vars

Done == w1 \in {"ok", "failed"} /\ w2 \in {"ok", "failed"}

\* 两次保存都结束后，报告成功的那次保存，其内容应当就是文件里的内容（若另一次失败）。
SuccessIsWhatLanded ==
  Done =>
    /\ (w1 = "ok" /\ w2 = "failed" => file = "c1") \* services/files.rs:85-93
    /\ (w2 = "ok" /\ w1 = "failed" => file = "c2") \* services/files.rs:85-93

\* 报告失败的保存，其内容不应出现在文件里。
FailedSaveDidNotLand ==
  Done =>
    /\ (w1 = "failed" => file # "c1") \* services/files.rs:85-93
    /\ (w2 = "failed" => file # "c2") \* services/files.rs:85-93
=============================================================================
