------------------------------ MODULE AiDoctor ------------------------------
\* 热力图 AI 医生“空闲时自动诊断”：每分钟挑最新、尚未诊断的会话诊断一次。
\* 来源：src/features/heatmap/doctorStore.ts（useDoctorAutoScheduler / pendingSessions / runDiagnosis）。
\* 两个待诊断会话：A 更新，B 较旧。
EXTENDS Naturals

VARIABLES
  stat,   \* 每个会话的诊断状态 idle / running / error（DoctorSessionState.status，doctorStore.ts:100-139）
  diag,   \* 每个会话是否已有诊断记录（lastDiagnosedAt，doctorStore.ts:179-185）
  tries   \* 每个会话已发起的诊断次数，3 表示多次（模型上界）

vars == <<stat, diag, tries>>
S == {"A", "B"}

Init == /\ stat = [s \in S |-> "idle"] /\ diag = [s \in S |-> FALSE] /\ tries = [s \in S |-> 0]

AnyRunning == \E s \in S : stat[s] = "running"   \* doctorStore.ts:198-199

Pending(s) == ~diag[s]                            \* doctorStore.ts:192 updated > lastDiagnosedAt

First == IF Pending("A") THEN "A" ELSE "B"       \* doctorStore.ts:218 按更新时间取第一个

Tick ==
  /\ ~AnyRunning                                  \* doctorStore.ts:213
  /\ Pending("A") \/ Pending("B")                 \* doctorStore.ts:218-219 有待诊断会话
  /\ stat' = [stat EXCEPT ![First] = "running"]   \* doctorStore.ts:101
  /\ tries' = [tries EXCEPT ![First] = IF @ >= 3 THEN 3 ELSE @ + 1]
  /\ UNCHANGED diag

DiagnoseOk ==
  /\ \E s \in S : stat[s] = "running" /\ stat' = [stat EXCEPT ![s] = "idle"] /\ diag' = [diag EXCEPT ![s] = TRUE]   \* doctorStore.ts:110-118 写入诊断时间与历史
  /\ UNCHANGED tries

DiagnoseFail ==
  /\ \E s \in S : stat[s] = "running" /\ stat' = [stat EXCEPT ![s] = "error"]   \* doctorStore.ts:139 失败只置 error，不写诊断时间
  /\ UNCHANGED <<diag, tries>>

Next == Tick \/ DiagnoseOk \/ DiagnoseFail

Spec == Init /\ [][Next]_vars

TypeOK == stat \in [S -> {"idle", "running", "error"}] /\ tries \in [S -> 0..3]

\* 自动诊断失败的会话，在没有新活动前，不应被每分钟反复重试。
FailedNotRetried == \A s \in S : tries[s] <= 1

\* 一个会话诊断失败后，其他待诊断的会话仍有机会被诊断，不会被它一直排在前面。
NoStarvation == ~(stat["A"] = "error" /\ tries["A"] >= 2 /\ ~diag["B"])

=============================================================================
