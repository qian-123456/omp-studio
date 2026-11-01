---- MODULE MemoryPartition ----
EXTENDS Integers
VARIABLES total_bytes, used_bytes, app, bar_omp_bytes, other_bytes, free_bytes
vars == <<total_bytes, used_bytes, app, bar_omp_bytes, other_bytes, free_bytes>>
\* Finite abstract units, not production measurements. The global sample is
\* read before per-process footprints; later footprints may be larger.
\* Sources: commands.rs:389-396,403-446; perf.rs:493,538-568.
Init == /\ total_bytes = 16 /\ used_bytes = -1 /\ app = 2
        /\ bar_omp_bytes = -1 /\ other_bytes = -1 /\ free_bytes = -1
system_memory ==
    /\ used_bytes = -1 \* src-tauri/src/services/perf.rs:493
    /\ used_bytes' = 8
    /\ UNCHANGED <<total_bytes, app, bar_omp_bytes, other_bytes, free_bytes>>
footprints_for ==
    /\ used_bytes # -1 \* src-tauri/src/services/perf.rs:493,538
    /\ bar_omp_bytes = -1 \* src-tauri/src/services/perf.rs:538-564 (one collection)
    /\ bar_omp_bytes' \in {2, 8} \* src-tauri/src/services/commands.rs:389-396 (later OS sample)
    /\ UNCHANGED <<total_bytes, used_bytes, app, other_bytes, free_bytes>>
collect ==
    /\ bar_omp_bytes # -1 \* src-tauri/src/services/perf.rs:561-566
    /\ other_bytes = -1 \* src-tauri/src/services/perf.rs:495,565 (one collection)
    /\ other_bytes' = IF used_bytes >= app + bar_omp_bytes THEN used_bytes - app - bar_omp_bytes ELSE 0
    /\ free_bytes' = total_bytes - used_bytes
    /\ UNCHANGED <<total_bytes, used_bytes, app, bar_omp_bytes>>
System == system_memory \/ footprints_for \/ collect
Next == System
Spec == Init /\ [][Next]_vars
\* Displayed known memory segments must add up to total physical memory.
\* Writes: src-tauri/src/services/perf.rs:501-504,561-568; display: PerfPopover.tsx:106-117.
SegmentsAddToTotal == other_bytes # -1 => app + bar_omp_bytes + other_bytes + free_bytes = total_bytes
====
