---------------------------- MODULE SessionTerminal ----------------------------
\* 后端“会话终端登记表” session_terms 与 PTY 退出/关闭/删除会话的竞态（只模拟 omp 终端）。
\* 模型描述现有代码（from-spec）；代码根目录 omp-workspace/.worktrees/bug-fix (HEAD 7f85613)。
\* 范围: 单个会话；claude/codex 终端同样写入 session_terms，但 omp_terminal_open 对它们为 false，只读排除。
EXTENDS Naturals

VARIABLES
  pty,           \* pty.rs registry 中该会话终端进程: none/alive/dead
  opened,        \* pty::open 已返回、session_terms 尚未写入（commands.rs:216-219 之间）
  rec,           \* session_terms 中是否登记了该会话的 (termId, true)
  sessionExists  \* catalog 中该会话是否还存在（未被 delete_with 删除）

vars == <<pty, opened, rec, sessionExists>>

TypeOK ==
  /\ pty \in {"none", "alive", "dead"}
  /\ opened \in BOOLEAN
  /\ rec \in BOOLEAN
  /\ sessionExists \in BOOLEAN

Init ==
  /\ pty = "none"
  /\ opened = FALSE
  /\ rec = FALSE
  /\ sessionExists = TRUE

\* ---------------- 读者动作 ----------------

\* 用户在会话上打开“omp 终端”（term_open_session）: 持有 resume 锁，先停 RPC，替换旧终端，再 pty::open。
OpenSessionTerm ==
  /\ sessionExists                         \* commands.rs:156 catalog::get 找不到会话则返回错误
  /\ ~opened                               \* commands.rs:154-155 resume 锁保证同一会话的开启串行
  /\ pty' = "alive"                        \* commands.rs:216 pty::open 成功后进程已在登记表 (pty.rs:149)
  /\ opened' = TRUE                        \* commands.rs:216 与 217 之间 session_terms 尚未写入
  /\ rec' = FALSE                          \* commands.rs:177-181 先关闭并忘记旧终端
  /\ UNCHANGED <<sessionExists>>

\* 终端里的 omp 进程自行退出（用户输入 exit、崩溃、参数错误）。
PtyExit ==
  /\ pty = "alive"                         \* pty.rs:165-169 读线程读到 EOF
  /\ pty' = "dead"                         \* pty.rs:171 registry 移除
  /\ rec' = FALSE                          \* commands.rs:56-57 退出事件先 forget_term，仅按 termId 移除已登记项
  /\ UNCHANGED <<opened, sessionExists>>

\* 用户关闭该终端（term_close）。前端只有拿到 termId（即登记完成）后才能关闭。
CloseTerm ==
  /\ rec                                   \* ipc.ts:855 termId 只有在 term_open_session 返回后才存在
  /\ ~opened                               \* commands.rs:218 登记之后才返回 termId
  /\ pty' = "none"                         \* commands.rs:99 pty::close
  /\ rec' = FALSE                          \* commands.rs:100 forget_term
  /\ UNCHANGED <<opened, sessionExists>>

\* 用户删除该会话（catalog::delete_with）: 不取 resume 锁，直接 close_session_term。
DeleteSession ==
  /\ sessionExists                         \* catalog/mod.rs:635 删除一个存在的会话
  /\ sessionExists' = FALSE                \* catalog/mod.rs:672 之后会话文件被移除
  /\ pty' = IF rec THEN "none" ELSE pty    \* commands.rs:29-32 只有登记项存在才 pty::close
  /\ rec' = FALSE                          \* commands.rs:29 session_terms().remove
  /\ UNCHANGED <<opened>>

\* ---------------- 系统动作 ----------------

\* term_open_session 在 pty::open 之后把终端写入 session_terms。
RecordSessionTerm ==
  /\ opened                                \* commands.rs:217 insert 紧随 pty::open
  /\ opened' = FALSE                       \* commands.rs:218 insert 完成并返回 termId
  /\ rec' = TRUE                           \* commands.rs:217-218 session_terms.insert(session_id, (term_id, is_omp))
  /\ UNCHANGED <<pty, sessionExists>>

Reader == OpenSessionTerm \/ PtyExit \/ CloseTerm \/ DeleteSession
System == RecordSessionTerm
Next == Reader \/ System
Spec == Init /\ [][Next]_vars

Settled == ~ENABLED System

\* ---------------- 规则 ----------------

\* 登记表里记着该会话的终端时，终端进程必须还活着（否则会无故阻止该会话的结构化通道重新启动）。
RecordMeansAlive == Settled => (rec => pty = "alive") \* terminal/commands.rs:56-57,216-218; terminal/pty.rs:171

\* 会话被删除后，不应还留着在运行的终端。
DeletedSessionHasNoTerminal == Settled => (~sessionExists => pty # "alive") \* catalog/mod.rs:635-672; terminal/commands.rs:29-32,216-218

=============================================================================
