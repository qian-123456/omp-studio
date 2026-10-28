---------------------- MODULE OmpUpdateCheck ----------------------
\* omp 内核检查更新与执行更新：检查请求可能在更新进行时一直在途。
EXTENDS Naturals

VARIABLES
  binary,      \* 磁盘上 omp 的版本：old / new（ompUpdateRun 成功后变 new，omp_update_run settings.rs:1553）
  checking,    \* ompUpdate.ts:20 checking
  checkSees,   \* 在途检查请求读到的版本（发出时磁盘上的版本）；none 表示没有在途检查
  updating,    \* ompUpdate.ts:21 updating
  shownAvail   \* ompUpdate.ts:19 status.updateAvailable：界面显示"有可用更新"

vars == <<binary, checking, checkSees, updating, shownAvail>>
Init == binary = "old" /\ checking = FALSE /\ checkSees = "none" /\ updating = FALSE /\ shownAvail = FALSE

\* 点检查或定时检查 (ompUpdate.ts:66-68)
CheckStarts ==
  /\ ~checking                          \* ompUpdate.ts:67 if (get().checking) return
  /\ checking' = TRUE /\ checkSees' = binary   \* ompUpdate.ts:68 set({checking:true})，请求读到当时的版本
  /\ UNCHANGED <<binary, updating, shownAvail>>
\* 检查返回：按请求发出时看到的版本写入状态，不看现在的版本 (ompUpdate.ts:70-71)
CheckReturns ==
  /\ checking
  /\ shownAvail' = (checkSees = "old")  \* ompUpdate.ts:71 set({ status }) 无过期判断
  /\ checking' = FALSE /\ checkSees' = "none"   \* ompUpdate.ts:83-86
  /\ UNCHANGED <<binary, updating>>
\* 点更新：安装新版本 (ompUpdate.ts:105-110)
UpdateStarts ==
  /\ ~updating                          \* ompUpdate.ts:106 if (get().updating) return
  /\ updating' = TRUE
  /\ UNCHANGED <<binary, checking, checkSees, shownAvail>>
\* 更新成功后再做一次检查；若已有检查在途则直接返回，什么也不更新 (ompUpdate.ts:119-120 → :67)
UpdateFinishes ==
  /\ updating
  /\ binary' = "new"
  /\ updating' = FALSE                  \* ompUpdate.ts:134
  /\ shownAvail' = IF checking THEN shownAvail ELSE FALSE   \* 无在途检查时 check(true) 会把状态刷新为最新；有在途时 check 直接 return
  /\ UNCHANGED <<checking, checkSees>>

Next == CheckStarts \/ CheckReturns \/ UpdateStarts \/ UpdateFinishes
Spec == Init /\ [][Next]_vars

\* 规则：更新成功、所有检查都结束后，界面不再显示"有可用更新"。
NoStaleUpdateBadge == (binary = "new" /\ ~checking /\ ~updating) => ~shownAvail
=====================================================================
