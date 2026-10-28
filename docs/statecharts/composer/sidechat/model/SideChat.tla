---- MODULE SideChat ----
\* Side chat first message: blank tab, fork creation, first ask, handback to the parent.
EXTENDS Naturals
VARIABLES tab, questionDraft, annotationsStaged, pendingBubble, forkSession, echoBubble,
          askState, cutCopyFailed, forkPlanOn, handback, sideStreaming, handbackSentWhileBusy

vars == <<tab, questionDraft, annotationsStaged, pendingBubble, forkSession, echoBubble,
          askState, cutCopyFailed, forkPlanOn, handback, sideStreaming, handbackSentWhileBusy>>

TypeOK ==
  /\ tab \in {"blank", "creating", "bound"}
  /\ questionDraft \in {"typed", "empty"}
  /\ annotationsStaged \in BOOLEAN
  /\ pendingBubble \in BOOLEAN
  /\ forkSession \in BOOLEAN
  /\ echoBubble \in BOOLEAN
  /\ askState \in {"none", "inflight", "sent", "failed"}
  /\ cutCopyFailed \in BOOLEAN
  /\ forkPlanOn \in BOOLEAN
  /\ handback \in {"idle", "running", "ready", "error"}
  /\ sideStreaming \in BOOLEAN
  /\ handbackSentWhileBusy \in BOOLEAN

\* SideChatPanel.tsx:445-458: send empties the input at once and keeps the bubble pending.
ClickSend ==
  /\ tab = "blank"  \* SideChatPanel.tsx:89 blank tab owns the composer
  /\ questionDraft = "typed"  \* SideChatPanel.tsx:447 needs text, quotes or images
  /\ questionDraft' = "empty"  \* SideChatPanel.tsx:457
  /\ pendingBubble' = TRUE  \* sideChatActions.ts:81
  /\ tab' = "creating"
  /\ UNCHANGED <<annotationsStaged, forkSession, echoBubble, askState, cutCopyFailed, forkPlanOn, handback, sideStreaming, handbackSentWhileBusy>>

\* createSideChat fails; the draft returns (sideChatActions.ts:92-95, SideChatPanel.tsx:468-472).
CreateFails ==
  /\ tab = "creating"
  /\ ~forkSession  \* sideChatActions.ts:83-95 creation has not returned a child.
  /\ tab' = "blank"
  /\ pendingBubble' = FALSE
  /\ questionDraft' = "typed"
  /\ UNCHANGED <<annotationsStaged, forkSession, echoBubble, askState, cutCopyFailed, forkPlanOn, handback, sideStreaming, handbackSentWhileBusy>>

\* The fork is created from the cut copy; with plan mode switched off (sidechat.rs:48-58, forkcut.rs:35-41).
CreateOk ==
  /\ tab = "creating"
  /\ forkSession' = TRUE
  /\ forkPlanOn' = cutCopyFailed  \* sidechat.rs:55-58 falls back to the uncut parent file when the cut copy fails
  /\ echoBubble' = TRUE  \* sideChatActions.ts:87 echo before ask
  /\ tab' = "bound"  \* sideChatActions.ts:89
  /\ annotationsStaged' = FALSE  \* sideChatActions.ts:91
  /\ pendingBubble' = FALSE  \* sideChatActions.ts:96
  /\ askState' = "inflight"  \* sideChatActions.ts:98
  /\ UNCHANGED <<questionDraft, cutCopyFailed, handback, sideStreaming, handbackSentWhileBusy>>

\* The cut copy could not be written (forkcut.rs:92-95 error is swallowed by sidechat.rs:52-53).
CutCopyWriteFails ==
  /\ tab = "creating"  \* sidechat.rs:48-58
  /\ ~forkSession  \* sidechat.rs:48-58 cut precedes child creation.
  /\ ~cutCopyFailed
  /\ cutCopyFailed' = TRUE
  /\ UNCHANGED <<tab, questionDraft, annotationsStaged, pendingBubble, forkSession, echoBubble, askState, forkPlanOn, handback, sideStreaming, handbackSentWhileBusy>>

\* side_chat_ask sends the one first prompt (sidechat.rs:192).
AskSucceeds ==
  /\ askState = "inflight"
  /\ askState' = "sent"
  /\ sideStreaming' = TRUE
  /\ UNCHANGED <<tab, questionDraft, annotationsStaged, pendingBubble, forkSession, echoBubble, cutCopyFailed, forkPlanOn, handback, handbackSentWhileBusy>>

\* The ask fails: only a toast; the echo stays and nothing restores the text (sideChatActions.ts:99-100).
AskFails ==
  /\ askState = "inflight"
  /\ askState' = "failed"
  /\ UNCHANGED <<tab, questionDraft, annotationsStaged, pendingBubble, forkSession, echoBubble, cutCopyFailed, forkPlanOn, handback, sideStreaming, handbackSentWhileBusy>>

\* The side chat's turn ends.
SideTurnEnds ==
  /\ sideStreaming
  /\ sideStreaming' = FALSE
  /\ UNCHANGED <<tab, questionDraft, annotationsStaged, pendingBubble, forkSession, echoBubble, askState, cutCopyFailed, forkPlanOn, handback, handbackSentWhileBusy>>

\* Reader clicks hand back to parent (sideChatActions.ts:142-154, handbackRun.ts:104-131).
StartHandback ==
  /\ tab = "bound"  \* sideChatActions.ts:142-154 requires a bound side session.
  /\ askState = "sent"  \* handbackRun.ts:104-131 this bounded model starts handback after successful first ask.
  /\ handback # "running"  \* handbackRun.ts:106
  /\ ~sideStreaming  \* handbackRun.ts:107
  /\ handback' = "running"  \* handbackRun.ts:111
  /\ sideStreaming' = TRUE  \* handbackRun.ts:126 summary prompt starts a side turn
  /\ UNCHANGED <<tab, questionDraft, annotationsStaged, pendingBubble, forkSession, echoBubble, askState, cutCopyFailed, forkPlanOn, handbackSentWhileBusy>>

\* The summary turn produced a note (handbackRun.ts:134-143) or failed (handbackRun.ts:150-153).
HandbackFinishes ==
  /\ handback = "running"
  /\ ~sideStreaming  \* handbackRun.ts:134-143 waits for completion before extracting note.
  /\ handback' \in {"ready", "error"}
  /\ UNCHANGED <<tab, questionDraft, annotationsStaged, pendingBubble, forkSession, echoBubble, askState, cutCopyFailed, forkPlanOn, sideStreaming, handbackSentWhileBusy>>

Init ==
  /\ tab = "blank" /\ questionDraft = "typed" /\ annotationsStaged = TRUE /\ pendingBubble = FALSE
  /\ forkSession = FALSE /\ echoBubble = FALSE /\ askState = "none" /\ cutCopyFailed = FALSE
  /\ forkPlanOn = FALSE /\ handback = "idle" /\ sideStreaming = FALSE /\ handbackSentWhileBusy = FALSE

ReaderAct == ClickSend \/ StartHandback
System == CreateFails \/ CreateOk \/ CutCopyWriteFails \/ AskSucceeds \/ AskFails \/ SideTurnEnds \/ HandbackFinishes
Next == ReaderAct \/ System
Spec == Init /\ [][Next]_vars
Settled == ~ENABLED System

\* 辅助对话里出现的“我发的消息”，一定真的发给了模型。
EchoMeansMessageSent == echoBubble => askState \in {"inflight", "sent"}

\* 首条消息失败后，用户输入的文字不会凭空消失。
FailedFirstMessageKeepsText == (askState = "failed") => (questionDraft = "typed")

\* 辅助对话从不继承父会话的计划模式。
SideChatNeverInheritsPlanMode == forkSession => ~forkPlanOn
====
