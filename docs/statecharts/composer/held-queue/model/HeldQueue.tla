---- MODULE HeldQueue ----
\* Held-queue lifecycle: typing while a turn streams, turn-end batch drain, per-item send, stop.
EXTENDS Naturals, FiniteSets
VARIABLES streaming, stopRequested, queues, queuedBusy, draining, batchItems, delivered,
          submitted, discarded, resentAfterStop

vars == <<streaming, stopRequested, queues, queuedBusy, draining, batchItems, delivered,
          submitted, discarded, resentAfterStop>>
Ids == {1, 2}

TypeOK ==
  /\ streaming \in BOOLEAN
  /\ stopRequested \in BOOLEAN
  /\ queues \subseteq Ids
  /\ queuedBusy \subseteq Ids
  /\ draining \in BOOLEAN
  /\ batchItems \subseteq Ids
  /\ delivered \in [Ids -> 0..2]
  /\ submitted \subseteq Ids
  /\ discarded \subseteq Ids
  /\ resentAfterStop \in BOOLEAN

\* Composer.tsx:1494-1503 a message typed while a turn streams is pushed to the held queue.
TypeWhileStreaming ==
  /\ streaming  \* Composer.tsx:1494-1503
  /\ \E i \in Ids \ submitted :
       /\ submitted' = submitted \cup {i}
       /\ queues' = queues \cup {i}
  /\ UNCHANGED <<streaming, stopRequested, queuedBusy, draining, batchItems, delivered, discarded, resentAfterStop>>

\* Composer.tsx:1625 stop button, send.ts:200-229 abort_and_restore_queue hands back only omp-side queued text.
UserStop ==
  /\ streaming  \* Composer.tsx:1625
  /\ ~stopRequested
  /\ stopRequested' = TRUE
  /\ UNCHANGED <<streaming, queues, queuedBusy, draining, batchItems, delivered, submitted, discarded, resentAfterStop>>

\* The turn ends and the module-level subscription drains (QueuedBar.tsx:73-87).
TurnEnds ==
  /\ streaming  \* QueuedBar.tsx:79 was streaming and now is not
  /\ streaming' = FALSE
  /\ stopRequested' = FALSE
  /\ IF ~draining  \* QueuedBar.tsx:27
        /\ (queues \ queuedBusy) # {}  \* QueuedBar.tsx:32-33 ready items only
       THEN /\ draining' = TRUE  \* QueuedBar.tsx:34
            /\ batchItems' = queues \ queuedBusy  \* QueuedBar.tsx:32,35-39
            /\ queues' = queues \ (queues \ queuedBusy)  \* QueuedBar.tsx:37-39
            /\ resentAfterStop' = (resentAfterStop \/ stopRequested)
       ELSE UNCHANGED <<draining, batchItems, queues, resentAfterStop>>
  /\ UNCHANGED <<queuedBusy, delivered, submitted, discarded>>

\* The merged prompt is accepted by omp (QueuedBar.tsx:58); the session starts a turn.
BatchSendSucceeds ==
  /\ draining
  /\ batchItems # {}
  /\ delivered' = [i \in Ids |-> IF i \in batchItems THEN delivered[i] + 1 ELSE delivered[i]]  \* QueuedBar.tsx:58
  /\ batchItems' = {}
  /\ draining' = FALSE  \* QueuedBar.tsx:65
  /\ streaming' = TRUE
  /\ UNCHANGED <<stopRequested, queues, queuedBusy, submitted, discarded, resentAfterStop>>

\* The merged prompt fails: the reserved items return to the queue (QueuedBar.tsx:61, heldQueue.ts:139-167).
BatchSendFails ==
  /\ draining
  /\ batchItems # {}
  /\ queues' = queues \cup batchItems
  /\ batchItems' = {}
  /\ draining' = FALSE
  /\ UNCHANGED <<streaming, stopRequested, queuedBusy, delivered, submitted, discarded, resentAfterStop>>

\* Reader sends one held item now (HeldQueueBar.tsx:40 idle only; QueuedBar.tsx:118-120 guards).
SendOneStarts ==
  /\ ~streaming  \* HeldQueueBar.tsx:40
  /\ \E i \in queues :
       /\ ~draining  \* QueuedBar.tsx:118
       /\ i \notin queuedBusy  \* QueuedBar.tsx:118
       /\ queuedBusy' = queuedBusy \cup {i}  \* QueuedBar.tsx:120
  /\ UNCHANGED <<streaming, stopRequested, queues, draining, batchItems, delivered, submitted, discarded, resentAfterStop>>

\* The single send is accepted; the item leaves the queue only now (QueuedBar.tsx:122-125).
SendOneSucceeds ==
  /\ \E i \in queuedBusy :
       /\ delivered' = [delivered EXCEPT ![i] = @ + 1]
       /\ queues' = queues \ {i}
       /\ queuedBusy' = queuedBusy \ {i}  \* QueuedBar.tsx:129
  /\ streaming' = TRUE
  /\ UNCHANGED <<stopRequested, draining, batchItems, submitted, discarded, resentAfterStop>>

\* The single send fails; the item stays queued (QueuedBar.tsx:126-129).
SendOneFails ==
  /\ \E i \in queuedBusy : queuedBusy' = queuedBusy \ {i}
  /\ UNCHANGED <<streaming, stopRequested, queues, draining, batchItems, delivered, submitted, discarded, resentAfterStop>>

\* Reader deletes a queued item after confirming (HeldQueueBar.tsx:65-79; no in-flight guard there).
DeleteQueued ==
  /\ \E i \in queues :
       /\ queues' = queues \ {i}
       /\ discarded' = discarded \cup {i}
  /\ UNCHANGED <<streaming, stopRequested, queuedBusy, draining, batchItems, delivered, submitted, resentAfterStop>>

\* Reader types a fresh message while idle and it starts a turn (send.ts:96-117).
FreshTurnStarts ==
  /\ ~streaming
  /\ ~draining  \* QueuedBar.tsx:18-39 serializes held draining; bounded independent fresh-turn abstraction.
  /\ streaming' = TRUE
  /\ UNCHANGED <<stopRequested, queues, queuedBusy, draining, batchItems, delivered, submitted, discarded, resentAfterStop>>

Init ==
  /\ streaming = TRUE /\ stopRequested = FALSE /\ queues = {} /\ queuedBusy = {}
  /\ draining = FALSE /\ batchItems = {} /\ delivered = [i \in Ids |-> 0]
  /\ submitted = {} /\ discarded = {} /\ resentAfterStop = FALSE

ReaderAct == TypeWhileStreaming \/ UserStop \/ SendOneStarts \/ DeleteQueued \/ FreshTurnStarts
System == TurnEnds \/ BatchSendSucceeds \/ BatchSendFails \/ SendOneSucceeds \/ SendOneFails
Next == ReaderAct \/ System
Spec == Init /\ [][Next]_vars
Settled == ~ENABLED System

\* 同一条暂存消息不会被发送两次。
NoDuplicateDelivery == \A i \in Ids : delivered[i] <= 1

\* 每条暂存消息要么还在队列里、要么在发送途中、要么已发出、要么被用户删除。
NoLostMessage ==
  \A i \in submitted : i \in queues \/ i \in batchItems \/ i \in queuedBusy \/ delivered[i] > 0 \/ i \in discarded

\* 用户点了停止之后，暂存消息不会自动发出而重新开始生成。
StopDoesNotResendHeld == ~resentAfterStop
====
