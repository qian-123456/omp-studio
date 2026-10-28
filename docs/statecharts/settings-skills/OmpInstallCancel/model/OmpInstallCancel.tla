------------------------ MODULE OmpInstallCancel ------------------------
\* 安装 omp 内核对话框：界面阶段、事件监听、后端单次安装槽与取消请求。
EXTENDS Naturals

VARIABLES
  phase,        \* stores/ompInstall.ts:8,66-69 idle/running/success/failed
  listening,    \* ompInstall.ts:84 await onOmpInstall 是否已完成（完成后才调 ompInstallRun，:96）
  backendSlot,  \* omp_install.rs:64 ACTIVE：后端是否已登记一次安装
  backendCancelled, \* omp_install.rs:366-370 Active.cancelled
  clickedCancel \* OmpInstallDialog.tsx:94-96 用户点过取消

vars == <<phase, listening, backendSlot, backendCancelled, clickedCancel>>

Init == phase = "idle" /\ listening = FALSE /\ backendSlot = FALSE /\ backendCancelled = FALSE /\ clickedCancel = FALSE

\* 点开始安装/重试 (ompInstall.ts:68-79)
Start ==
  /\ phase # "running"                           \* ompInstall.ts:69
  /\ phase' = "running" /\ listening' = FALSE /\ clickedCancel' = FALSE   \* ompInstall.ts:70-79
  /\ backendSlot' = FALSE /\ backendCancelled' = FALSE
\* 事件监听就绪，随后发出 ompInstallRun，后端登记安装 (ompInstall.ts:84-96；omp_install.rs:89-98)
ListenReady ==
  /\ phase = "running"               \* ompInstall.ts:70 start 已把阶段置为 running
  /\ ~listening /\ ~backendSlot      \* ompInstall.ts:84-96 监听尚未完成，ompInstallRun 尚未发出
  /\ listening' = TRUE /\ backendSlot' = TRUE
  /\ UNCHANGED <<phase, backendCancelled, clickedCancel>>
\* 点取消：只在界面阶段为 running 时发送 (ompInstall.ts:114-115)；后端空闲时取消是空操作 (omp_install.rs:366-374)
ClickCancel ==
  /\ phase = "running"               \* ompInstall.ts:114 cancel 仅在阶段为 running 时发送
  /\ ~clickedCancel                  \* OmpInstallDialog.tsx:93-96 点击后按钮进入 loading 态
  /\ clickedCancel' = TRUE
  /\ backendCancelled' = IF backendSlot THEN TRUE ELSE backendCancelled   \* omp_install.rs:368-369
  /\ UNCHANGED <<phase, listening, backendSlot>>
\* 安装结束：取消过则失败，否则成功 (omp_install.rs:319-328；ompInstall.ts:97-107)
InstallFinishes ==
  /\ phase = "running" /\ backendSlot
  /\ phase' = IF backendCancelled THEN "failed" ELSE "success"
  /\ backendSlot' = FALSE
  /\ UNCHANGED <<listening, backendCancelled, clickedCancel>>

Next == Start \/ ListenReady \/ ClickCancel \/ InstallFinishes
Spec == Init /\ [][Next]_vars

\* 规则：用户点过取消之后，这一次安装不会显示成功。
CancelHonored == ~(clickedCancel /\ phase = "success")
=====================================================================
