------------------------------ MODULE PrivacyScopeFixed ------------------------------
\* Model of: one session, one secret value; the 标记为隐私 popover (MarkSecretPopover.tsx) ->
\* privacy_mark (commands.rs) -> store::mark/link_session (store.rs) -> extension "context" hook.
\* Single bounded value, no network, synthetic only.
VARIABLES
  history,   \* does the session transcript hold the real value (privacy_classify.sessionOccurrences > 0)
  entry,     \* secret_entries row exists (store.rs mark / delete)
  tracked,   \* SecretEntry.track
  link,      \* session_secrets row for (session, entry): none | all (since_ms NULL) | future (since_ms set)
  popover,   \* MarkSecretPopover: closed | open
  shownSent, \* popover `sent` snapshot (cls.sessionOccurrences > 0)
  wanted,    \* what the user last asked for: none | futureOnly | all
  popTrack   \* popover checkbox "不跟踪" unchecked => track=true (MarkSecretPopover.tsx:47,142)

vars == <<history, entry, tracked, link, popover, shownSent, wanted, popTrack>>

TypeOK ==
  /\ history \in {"clean", "realSent"}
  /\ entry \in BOOLEAN
  /\ tracked \in BOOLEAN
  /\ link \in {"none", "all", "future"}
  /\ popover \in {"closed", "open"}
  /\ shownSent \in BOOLEAN
  /\ wanted \in {"none", "futureOnly", "all"}
  /\ popTrack \in BOOLEAN

Init ==
  /\ history \in {"clean", "realSent"}
  /\ entry = FALSE
  /\ tracked = TRUE
  /\ link = "none"
  /\ popover = "closed"
  /\ shownSent = FALSE
  /\ wanted = "none"
  /\ popTrack = TRUE

\* Real value still readable by upstream in OLD messages (extension context hook, omp-workspace-privacy.ts:186-217)
OldVisible ==
  /\ history = "realSent"
  /\ ~(entry /\ tracked /\ link # "future")

\* User picks text, popover asks the backend to classify (MarkSecretPopover.tsx:52, commands.rs:60-87)
OpenPopover ==
  /\ popover = "closed"                                   \* ComposerSecretOverlay.tsx:261 only one popover at a time
  /\ popover' = "open"
  /\ shownSent' = (history = "realSent")                  \* MarkSecretPopover.tsx:84 sent = needsScopeChoice(occurrences)
  /\ popTrack' \in BOOLEAN                                 \* MarkSecretPopover.tsx:142 checkbox (shown for risky values; default tracked)
  /\ UNCHANGED <<history, entry, tracked, link, wanted>>

ClosePopover ==
  /\ popover = "open"                                     \* MarkSecretPopover.tsx:155 cancel / :94 dismiss
  /\ popover' = "closed"
  /\ UNCHANGED <<history, entry, tracked, link, shownSent, wanted, popTrack>>

\* "仅保护后续内容" / "标记" button or Enter (MarkSecretPopover.tsx:122,166)
ConfirmFuture ==
  /\ popover = "open"                                     \* MarkSecretPopover.tsx:69 confirm needs classification
  /\ popover' = "closed"
  /\ entry' = TRUE                                        \* store.rs:212-229 creates the entry when absent
  /\ tracked' = popTrack                                    \* PROPOSED: marking again applies the chosen tracking
  /\ link' = IF link = "none" THEN IF shownSent THEN "future" ELSE "all" ELSE link
        \* store.rs:170-173 INSERT OR IGNORE; MarkSecretPopover.tsx:166 scope is future only when sent, else all
  /\ wanted' = IF ~popTrack THEN "none" ELSE IF shownSent THEN "futureOnly" ELSE "all"   \* MarkSecretPopover.tsx:74 track sent with the request
  /\ UNCHANGED <<history, shownSent, popTrack>>

\* "同时替换旧历史" (MarkSecretPopover.tsx:158-162) -> scope All
ConfirmAll ==
  /\ popover = "open"                                     \* MarkSecretPopover.tsx:69
  /\ shownSent                                            \* MarkSecretPopover.tsx:158 button exists only when sent
  /\ popover' = "closed"
  /\ entry' = TRUE                                        \* store.rs:212-229
  /\ tracked' = popTrack                                    \* PROPOSED: marking again applies the chosen tracking
  /\ link' = "all"                                      \* PROPOSED: scope All upgrades a future link to whole-history
  /\ wanted' = IF popTrack THEN "all" ELSE "none"          \* MarkSecretPopover.tsx:74-75
  /\ UNCHANGED <<history, shownSent, popTrack>>

\* Settings / chip: stop tracking (store.rs:245-257 privacy_update track=false)
Untrack ==
  /\ entry                                                \* store.rs:237 update needs existing entry
  /\ tracked                                              \* store.rs:250 only a real change
  /\ tracked' = FALSE
  /\ wanted' = "none"
  /\ UNCHANGED <<history, entry, link, popover, shownSent, popTrack>>

\* Settings: delete entry (store.rs:261-268 also drops its session links)
DeleteEntry ==
  /\ entry                                                \* store.rs:261-266
  /\ entry' = FALSE
  /\ link' = "none"
  /\ tracked' = TRUE
  /\ wanted' = "none"
  /\ UNCHANGED <<history, popover, shownSent, popTrack>>

Next == OpenPopover \/ ClosePopover \/ ConfirmFuture \/ ConfirmAll \/ Untrack \/ DeleteEntry

Spec == Init /\ [][Next]_vars

\* 用户选择“同时替换旧历史”之后，旧消息里的真实值不应再发给上游。
HistoryReplacedWhenAsked == ~(wanted = "all" /\ OldVisible)
=================================================================================
