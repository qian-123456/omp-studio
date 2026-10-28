------------------------------ MODULE PrivacyNative ------------------------------
EXTENDS Integers
\* Model of: privacy::sync_files (mod.rs) -> secrets.yml managed block + secrets.json native hash,
\* OMP spawn env (spawn_env), restart check (needs_restart), extension session_before_compact.
\* Boundary: OMP loads secrets.yml only at process start (extension comment omp-workspace-privacy.ts:219-221).
\* Versions: ver = which tracked-entry set the hash describes (1 or 2). Hash of a failed write is "unprotected".
VARIABLES
  ver,        \* current tracked entry set version (files::native_hash_of)
  ymlBlock,   \* version of the managed block inside secrets.yml (0 = no block)
  conflict,   \* secrets.yml is not a YAML list (files::merge_block Conflict)
  status,     \* NATIVE.status: ok | conflict
  memHash,    \* NATIVE.hash version (what spawn_env hands to a new process)
  jsonProt,   \* secrets.json nativeHash is the plain hash (TRUE) or "unprotected:" prefixed (FALSE)
  jsonVer,    \* version inside secrets.json nativeHash
  procUp,     \* an OMP process is running (process.rs handle)
  drift,      \* secrets.yml was edited by hand since the last app sync (not visible to the app)
  procEnv,    \* OMPWS_PRIVACY_NATIVE_HASH of the running OMP process (process.rs:747-751)
  procLoaded, \* managed block version the running OMP loaded from secrets.yml at start
  streaming   \* a turn is in flight (handle.streaming)

vars == <<ver, ymlBlock, conflict, status, memHash, jsonProt, jsonVer, procUp, drift, procEnv, procLoaded, streaming>>

TypeOK ==
  /\ ver \in 1..2 /\ ymlBlock \in 0..2 /\ conflict \in BOOLEAN
  /\ status \in {"ok", "conflict"} /\ memHash \in 1..2 /\ jsonProt \in BOOLEAN /\ jsonVer \in 1..2
  /\ procUp \in BOOLEAN /\ drift \in BOOLEAN /\ procEnv \in 0..2 /\ procLoaded \in 0..2 /\ streaming \in BOOLEAN

Init ==
  /\ ver = 1 /\ ymlBlock = 1 /\ conflict = FALSE /\ status = "ok"   \* mod.rs:135-141 init writes files at startup
  /\ memHash = 1 /\ jsonProt = TRUE /\ jsonVer = 1
  /\ procUp = FALSE /\ drift = FALSE /\ procEnv = 0 /\ procLoaded = 0 /\ streaming = FALSE

\* sync_files body, shared by every privacy mutation (commands.rs:13-24 mutate)
SyncResult(newVer) ==
  LET writes == ~conflict    \* files.rs:175-186 merge_block returns Conflict only for a non-list file
  IN /\ ymlBlock' = IF writes THEN newVer ELSE ymlBlock
     /\ status' = IF writes THEN "ok" ELSE "conflict"              \* mod.rs:103-110
     /\ memHash' = newVer                                           \* mod.rs:120-125 hash stored whatever the status
     /\ jsonProt' = writes                                          \* mod.rs:114-118 unprotected prefix when not ok
     /\ jsonVer' = newVer                                           \* mod.rs:128-131
     /\ drift' = FALSE                                              \* the rewrite re-reads and repairs the file

\* Mark a new tracked value: the entry set (and so the hash) changes.
MarkNewEntry ==
  /\ ver = 1                                                        \* bounded: one change of the tracked set
  /\ ver' = 2
  /\ SyncResult(2)
  /\ UNCHANGED <<conflict, procUp, procEnv, procLoaded, streaming>>

\* Rename label / link to another session: files are rewritten, hash unchanged.
ResyncSame ==
  /\ SyncResult(ver)                                                \* store.rs:232-259 update -> mutate -> sync_files
  /\ UNCHANGED <<ver, conflict, procUp, procEnv, procLoaded, streaming>>

\* The user edits secrets.yml by hand (outside the app).
UserBreaksYml ==
  /\ ~conflict
  /\ conflict' = TRUE
  /\ ymlBlock' = 0                                                  \* the managed block is gone with the old content
  /\ drift' = TRUE
  /\ UNCHANGED <<ver, status, memHash, jsonProt, jsonVer, procUp, procEnv, procLoaded, streaming>>

UserFixesYml ==
  /\ conflict
  /\ conflict' = FALSE
  /\ UNCHANGED <<ver, ymlBlock, status, memHash, jsonProt, jsonVer, procUp, drift, procEnv, procLoaded, streaming>>

\* Spawn / restart an OMP process (process.rs:747-751, mod.rs:34-56)
SpawnOmp ==
  /\ ~procUp                                                        \* rpc/mod.rs:515-520 spawn only when no live handle
  /\ procUp' = TRUE
  /\ procEnv' = memHash                                             \* mod.rs:36-40 env hash is NATIVE.hash, status ignored
  /\ procLoaded' = ymlBlock                                         \* OMP loads whatever block secrets.yml holds now
  /\ UNCHANGED <<ver, ymlBlock, conflict, status, memHash, jsonProt, jsonVer, drift, streaming>>

BeginTurn ==
  /\ procUp                                                         \* rpc/mod.rs:520 turn runs on a live handle
  /\ ~streaming
  /\ procEnv = memHash                                              \* rpc/mod.rs:521-526 a stale process is restarted first
  /\ streaming' = TRUE
  /\ UNCHANGED <<ver, ymlBlock, conflict, status, memHash, jsonProt, jsonVer, procUp, drift, procEnv, procLoaded>>

EndTurn ==
  /\ streaming
  /\ streaming' = FALSE
  /\ UNCHANGED <<ver, ymlBlock, conflict, status, memHash, jsonProt, jsonVer, procUp, drift, procEnv, procLoaded>>

RestartStale ==
  /\ procUp                                                         \* rpc/mod.rs:520
  /\ ~streaming                                                     \* privacy_ext.rs:39-41 needs_restart
  /\ procEnv # memHash                                              \* privacy_ext.rs:40
  /\ procEnv' = memHash
  /\ procLoaded' = ymlBlock
  /\ UNCHANGED <<ver, ymlBlock, conflict, status, memHash, jsonProt, jsonVer, procUp, drift, streaming>>

\* Extension lets compaction run when the native hash in secrets.json equals the process env hash.
CompactionAllowed ==
  /\ procUp                                                         \* extension runs inside the live process
  /\ jsonProt                                                       \* mod.rs:117 plain hash, otherwise differs from every env value
  /\ jsonVer = procEnv                                              \* omp-workspace-privacy.ts:227

Next == MarkNewEntry \/ ResyncSame \/ UserBreaksYml \/ UserFixesYml \/ SpawnOmp \/ BeginTurn \/ EndTurn \/ RestartStale

Spec == Init /\ [][Next]_vars

\* Analysis constraint (not product behavior): drop states where a process was spawned while the file drifted unseen,
\* isolating the case where the APP itself knew the native write failed.
NoSpawnWhileDrift == ~(procUp /\ drift)

\* 只要压缩被放行，正在运行的 OMP 进程启动时读到的原生保护内容就必须是最新的。
CompactionHasNativeCoverage == (CompactionAllowed /\ ~drift) => procLoaded = ver
=================================================================================
