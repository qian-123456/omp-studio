------------------------------ MODULE DiagnoseDialog ------------------------------
\* 诊断对话框：加载提示词、用户编辑/选择、发送，以及会话列表刷新对对话框的影响。
\* 来源：src/features/diagnose/DiagnoseDialog.tsx。
EXTENDS Naturals

VARIABLES
  open,        \* 对话框是否打开（DiagnoseDialog.tsx:38 isVisible）
  loading,     \* 正在重新生成提示词（DiagnoseDialog.tsx:50 loadingPrompt）
  edited,      \* 用户是否改过提示词文本（textarea value={prompt}，DiagnoseDialog.tsx:259）
  chosen,      \* 用户是否手动选了诊断会话（DiagnoseDialog.tsx:186 selectedExistingId）
  btnBusy,     \* 界面认为正在发送（dispatching，DiagnoseDialog.tsx:48）
  inFlight,    \* 发送请求实际仍在进行（handleExecuteDiagnose，DiagnoseDialog.tsx:86-118）
  sent,        \* 已经发出的诊断提示数量，3 表示多次（dispatchPrompt，DiagnoseDialog.tsx:105）
  erased       \* 是否发生过用户的编辑或选择被无声覆盖

vars == <<open, loading, edited, chosen, btnBusy, inFlight, sent, erased>>

Init == /\ open = TRUE /\ loading = TRUE /\ edited = FALSE /\ chosen = FALSE /\ btnBusy = FALSE
        /\ inFlight = FALSE /\ sent = 0 /\ erased = FALSE

PromptLoaded ==
  /\ open /\ loading                        \* DiagnoseDialog.tsx:54-61 fetchPrompt 返回
  /\ loading' = FALSE
  /\ UNCHANGED <<open, edited, chosen, btnBusy, inFlight, sent, erased>>

UserEditsPrompt ==
  /\ open /\ ~loading /\ ~edited            \* DiagnoseDialog.tsx:259 文本框可编辑
  /\ edited' = TRUE
  /\ UNCHANGED <<open, loading, chosen, btnBusy, inFlight, sent, erased>>

UserChoosesSession ==
  /\ open /\ ~loading /\ ~chosen            \* DiagnoseDialog.tsx:186 下拉选择
  /\ chosen' = TRUE
  /\ UNCHANGED <<open, loading, edited, btnBusy, inFlight, sent, erased>>

UserExecute ==
  /\ open /\ ~loading                       \* DiagnoseDialog.tsx:384-388 按钮禁用条件含 loadingPrompt
  /\ ~btnBusy                               \* DiagnoseDialog.tsx:386 dispatching 时禁用
  /\ btnBusy' = TRUE                        \* DiagnoseDialog.tsx:89
  /\ inFlight' = TRUE
  /\ sent' = IF sent >= 3 THEN 3 ELSE sent + 1   \* DiagnoseDialog.tsx:105（次数饱和，只是模型上界）
  /\ UNCHANGED <<open, loading, edited, chosen, erased>>

DispatchDone ==
  /\ inFlight                               \* DiagnoseDialog.tsx:105-109 dispatchPrompt 返回后关闭
  /\ inFlight' = FALSE
  /\ open' = FALSE                          \* DiagnoseDialog.tsx:108 closeModal
  /\ UNCHANGED <<loading, edited, chosen, btnBusy, sent, erased>>

\* 会话列表任何一次刷新（状态变化、标题更新等）都会重新执行打开时的副作用
SessionsUpdated ==
  /\ open                                   \* DiagnoseDialog.tsx:68-82 副作用在打开时执行，依赖含 sessions（:83）
  /\ btnBusy' = FALSE                       \* DiagnoseDialog.tsx:73 setDispatching(false)
  /\ chosen' = FALSE                        \* DiagnoseDialog.tsx:79 重置为第一个候选
  /\ loading' = TRUE                        \* DiagnoseDialog.tsx:81 fetchPrompt 重新生成
  /\ edited' = FALSE                        \* DiagnoseDialog.tsx:59 setPrompt 覆盖文本
  /\ erased' = (erased \/ edited \/ chosen)
  /\ UNCHANGED <<open, inFlight, sent>>

Next == PromptLoaded \/ UserEditsPrompt \/ UserChoosesSession \/ UserExecute \/ DispatchDone \/ SessionsUpdated

Spec == Init /\ [][Next]_vars

TypeOK == sent \in 0..3

\* 会话列表的后台刷新不应覆盖用户已改过的提示词或已选的诊断会话。
UserWorkPreserved == ~erased

\* 同一次诊断不应被重复发送。
SentAtMostOnce == sent <= 1

=============================================================================
