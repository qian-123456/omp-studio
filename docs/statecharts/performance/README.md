# Performance memory statechart audit

Source baseline: `f6de72f625d1936a4109739cbadcf6b1cba9c804`. Source fingerprints: [source-baseline.json](source-baseline.json).

This is a **read-only product audit**, not a repair. Only this audit directory is published. Existing shared-worktree changes, application behavior, IPC contracts, and architecture documents are untouched. Models and replays run in an external scratch directory before publication.

## Findings and evidence levels

- **Overlapping refreshes:** reproduced through the real bottom-bar component. Open the panel while its closed-mode memory request remains pending: another memory request starts before the first completes.
- **Two app-memory readings in one screen:** reproduced with distinguishable responses at the real IPC boundary. The real bottom bar displays `101 MB` while the real popover displays `222 MB` in the same refresh. Backend source confirms independent collection paths; this is not a live OS stress measurement.
- **Loss of successful results after a sibling IPC rejection:** reproduced by transport-boundary fault injection. Both fresh displays disappear; the bar retains `101 MB`, and the distribution remains in its initial collecting state. Normal backend service-scan failures are **not** the trigger: `services_list` returns `Ok` and ordinary collector failures degrade to unknown data. Do not describe this as an observed OS service-scan error.
- **Partition arithmetic boundary:** TLC finds a counterexample, and the real renderer accepts the corresponding crafted partition with declared widths totaling `112.5%`. A real OS execution producing that inconsistent partition has **not** been reproduced. This remains a collector timing/accounting hypothesis, not a confirmed kernel or native-layout bug. The real collector smoke snapshot has an exactly matching segment sum.

The supplied screenshot alone does not establish double-counting or an incorrect total.

### Numbered paths and proposed changes

Each row names the invariant and the exact numbered path in its chart. The two partial-failure rows share one root cause; they are not two independent implementation defects. There are no inverted reachability-goal rules.

| Finding | Rule | Chart steps | Replayed against real product imports? | Proposed change status |
|---|---|---|---|---|
| Refresh overlap | `NoOverlappingMemoryScans` | 1 start bottom-bar sampling → 2 open panel → 3 replace refresh lifecycle while the old request continues → 4 start another sample | Yes, delayed IPC response; observed two pending memory requests | Shared pending-request ownership blocks step 4 in the **model only**. Completion/rescheduling, visibility, and unmount behavior still need implementation and regression verification before shipping. |
| Same-screen disagreement | `SameAppMemorySample` | 1 bottom-bar sample returns → 2 panel sample returns with a different value → 3 render both | Yes, real components; controlled responses | A shared displayed sample removes the counterexample in the **model only**. No product code changed. |
| Successful distribution discarded | `DistributionSurvivesServiceFailure` | 1 memory succeeds → 2 distribution succeeds → 3 service-query IPC rejects → 4 refresh finishes without publishing either success | Yes, **IPC rejection injection**; collecting placeholder persists | Independent publication of successful results satisfies the rule in the **model only**. No live fix exercised. |
| Successful bottom-bar result discarded | `MemorySurvivesServiceFailure` | Same numbered path, 1–4 | Yes, **IPC rejection injection**; fresh `202 MB` absent, old `101 MB` remains | Same proposed model-only change as the preceding row. |
| Partition candidate | `SegmentsAddToTotal` | 1 read global memory → 2 read later process footprints → 3 floor the negative residual to zero | Arithmetic trace and crafted-response renderer acceptance only; **OS occurrence unverified** | No fixed model or shipped fix claimed. First capture a real inconsistent collector snapshot before choosing a correction. |

Green states and “建议有效，产品未改” mean that a **hypothetical model** removes a bounded counterexample. They do not mean the application has been repaired. Red in the partition chart marks a model violation, not a confirmed native incident.

## Charts, Mermaid sources, and stories

| Model | Overview | Numbered bug paths | Stories and counts |
|---|---|---|---|
| Refresh lifecycle | [PNG](RefreshOverlap/chart/chart.png) · [Mermaid](RefreshOverlap/chart/chart.mmd) | [Bug 1 PNG](RefreshOverlap/chart/bug-1.png) · [source](RefreshOverlap/chart/bug-1.mmd) | [stories.md](RefreshOverlap/chart/stories.md) · [summary.json](RefreshOverlap/chart/summary.json) |
| Same-screen sample | [PNG](SnapshotAgreement/chart/chart.png) · [Mermaid](SnapshotAgreement/chart/chart.mmd) | [Bug 1 PNG](SnapshotAgreement/chart/bug-1.png) · [source](SnapshotAgreement/chart/bug-1.mmd) | [stories.md](SnapshotAgreement/chart/stories.md) · [summary.json](SnapshotAgreement/chart/summary.json) |
| Rejected sibling IPC | [PNG](PartialFailure/chart/chart.png) · [Mermaid](PartialFailure/chart/chart.mmd) | [Distribution PNG](PartialFailure/chart/bug-1.png) · [source](PartialFailure/chart/bug-1.mmd); [bottom-bar PNG](PartialFailure/chart/bug-2.png) · [source](PartialFailure/chart/bug-2.mmd) | [stories.md](PartialFailure/chart/stories.md) · [summary.json](PartialFailure/chart/summary.json) |
| Partition boundary candidate | [PNG](MemoryPartition/chart/chart.png) · [Mermaid](MemoryPartition/chart/chart.mmd) | [Bug 1 PNG](MemoryPartition/chart/bug-1.png) · [source](MemoryPartition/chart/bug-1.mmd) | [stories.md](MemoryPartition/chart/stories.md) · [summary.json](MemoryPartition/chart/summary.json) |

All model/chart counts below come directly from the linked `summary.json` files. State spaces are independent; do not interpret their sum as one exhaustive application model.

| Model | Current model states | Current model transitions | Drawn states | Drawn transitions |
|---|---:|---:|---:|---:|
| RefreshOverlap | 8 | 13 | 5 | 5 |
| SnapshotAgreement | 13 | 16 | 7 | 9 |
| PartialFailure | 12 | 20 | 10 | 18 |
| MemoryPartition | 6 | 5 | 6 | 5 |

`--cover` omits some non-bug refresh transitions; [RefreshOverlap summary](RefreshOverlap/chart/summary.json) lists them. It does not remove the counterexample. All current/fixed comparison summaries report no uncited action conditions. This is source traceability, **not** evidence that the hypothetical fixed code already exists. There are no broken temporal `PROPERTY` rules in these runs.

## Source correspondence

- `src/components/BottomBar.tsx:81–146`: effect-local pending-request guard, panel-dependent restart, parallel probes, all-or-nothing response handling, visibility and timer cleanup. Reproduction entry points are mount, the performance button, and IPC completions/rejection.
- `src/components/BottomBar.tsx:147,217–244`: memory label and actual popover inputs.
- `src/features/chat/PerfPopover.tsx:104–117,168–195,218–250`: displayed distribution percentages, legends, app and OMP details. No copied rendering implementation is used by the replay.
- `src-tauri/src/services/perf.rs:74–170,257–284`: ownership pruning, disjoint PID classification, readable-member aggregation.
- `src-tauri/src/services/perf.rs:452–483,485–568,588–603`: separate app/breakdown collectors, process sampling, residual arithmetic, and cache lifetime.
- `src-tauri/src/services/commands.rs:389–446`: process footprint and global memory inputs, sampled separately.
- `src-tauri/src/services/commands.rs:11–15,557–588`: normal command return behavior. `src/lib/ipc.ts:434–435` is the injected service-query rejection boundary.

Variables/actions and conditions are annotated with source locations in each `model/*.tla`. The refresh model abstracts closure generations as indices; the sample model abstracts two distinguishable formatted memory quantities. The partition model uses small abstract units (`16`, `8`, `2`), **not observed machine byte measurements**. Its derivation is `app=2`, `OMP=8`, older `used=8`, `free=8`, floored `other=0`, so displayed quantities total `18` against `16`.

### Mechanisms not misreported as bugs

- PID membership is separated between app, app-launched OMP, and external OMP. The existing backend tests exercise nested instances and readable/unreadable membership. No duplicate-PID summation defect was demonstrated in those cases.
- Tool processes spawned underneath OMP remain in the app tree by existing design; OMP executables themselves have their own buckets.
- An empty bucket is known zero; a nonempty bucket with no readable member is unknown. Partial probe failures skip unreadable members. This audit does not replace unknown values with zero.
- The proposed byte/count bug in `proc_listallpids` was **rejected**. The official wrapper returns an element count, and an independent installed-library probe matched that count. Evidence: [official function excerpt](evidence/backend/libproc-listallpids.official.txt) and [probe](evidence/backend/libproc-count-probe.json).

### Additional source-only performance observations

The open-panel frontend requests both app-only and complete breakdown data. The backend app-only path does not share the complete breakdown collection. Both paths traverse process information. A sole 4-second UI poller ordinarily reaches a 3-second breakdown cache after its TTL, but other callers could refresh it in between. No scan-cost benchmark or cache-hit measurement was taken.

The breakdown cache releases its lock before collection and writes the result after completion. Concurrent misses and out-of-order cache replacement remain **source-only concurrency hypotheses**; there is no backend-global stress reproduction here. Do not count them as additional confirmed bugs. See [classification](evidence/backend/source-candidate-classification.txt).

## Verification evidence

### Actual frontend imports

[Replay suite](evidence/replay/bottombar-poll.replay.test.tsx) imports real application source; it does not copy component/poller code. Only Tauri transport APIs and missing browser layout primitives are replaced. Real stores, `BottomBar`, `PerfPopover`, and `FloatingLayer` run in jsdom.

[Vitest JSON](evidence/replay/vitest-report.json) records **two expected regression failures and two passing witnesses**. [check-baseline.mjs](evidence/replay/check-baseline.mjs) accepts exactly the named failure signatures and witnesses. An exit-zero audit gate means **the existing defects were reproduced**, not that the desired-behavior tests pass or that a fix shipped. The partial-failure assertion combines both visible missing-success consequences.

The normal project test include patterns cover `src/` and `src-mobile/`; archived evidence under `docs/` is not added to the normal test suite. Run this archived replay explicitly.

### Real backend collector

[Backend summary](evidence/backend/cargo-perf-tests.summary.json) and [console log](evidence/backend/cargo-perf-tests.scrubbed.log) record **12 passed, 0 failed**, including the real `collect_real_snapshot` collector. Actual observed bytes:

| Segment | Observed bytes |
|---|---:|
| App | 3,588,672 |
| OMP launched by this test process | 0 |
| External OMP | 1,073,525,000 |
| Other | 10,318,613,688 |
| Free | 5,784,141,824 |
| Used | 11,395,727,360 |
| Total | 17,179,869,184 |

For **that snapshot**, `app + OMP + other = used`, and all segments sum exactly to total; the difference is zero. This is the test executable's snapshot, not a capture of the user's original application window. It does not prove partition conservation for all OS timings.

### Limits

No native-window/CSS acceptance, CPU profiling, memory-leak investigation, high-load allocation trace, or multi-window backend cache-race stress test was performed. Renderer acceptance of declared widths above 100% is not a claim of visible CSS overflow: flex shrinking and overflow clipping can conceal it.

The models cover bounded safety scenarios, not every timer interval, visibility/unmount interleaving, unsupported platform, OS compression/accounting detail, PID-reuse race, or scheduling/liveness property. The model-only pending-request guard is not a complete implemented rescheduling fix. No existing performance-specific agreed TLA+ spec was found in the audited statechart tree, so these runs do not use `--against`.

## Regenerate outside the repository

Use the statechart skill's installed runtime or explicit existing TLC/Java paths. The skill may install missing tooling if not supplied.

```sh
export STATECHART_SKILL=/path/to/statechart
export TLA2TOOLS=/path/to/tla2tools.jar
export JAVA=/path/to/java
node docs/statecharts/performance/regenerate.mjs \
  --skill "$STATECHART_SKILL" --out /tmp/omp-performance-regenerated
```

This invokes `from-spec`, `--png`, all expected-broken rules, and the model-only fixed variants. Each chart includes its Mermaid source, numbered paths, `stories.md`, `summary.json`, and TLC logs. Trace output paths, timestamps, and seeds can differ between runs. Run from outside the repository if editing models; publish only checked artifacts.

Reproduce component evidence from the project root, writing the fresh report outside the repository:

```sh
./node_modules/.bin/vitest run \
  --config docs/statecharts/performance/evidence/replay/vitest.run.config.mts \
  --reporter=default --reporter=json \
  --outputFile.json=/tmp/omp-performance-replay.json
# EXPECTED exit 1 on this baseline. Execute the next command separately.
node docs/statecharts/performance/evidence/replay/check-baseline.mjs \
  /tmp/omp-performance-replay.json
# EXPECTED exit 0: the two named existing defects reproduced.
```

Reproduce backend checks from the project root:

```sh
source ~/.cargo/env
CARGO_TARGET_DIR=/tmp/omp-performance-cargo-target RUSTC_WRAPPER=sccache \
  cargo test --manifest-path src-tauri/Cargo.toml services::perf::tests -- --nocapture
```

[manifest.json](manifest.json) fingerprints the published artifacts. Local absolute paths in saved logs are scrubbed; actual production source is referenced, not backed up or copied into this audit.

## Delivery status

- Product implementation and contract changes: none; this task checks behavior only.
- Models, PNG/Mermaid charts, numbered stories, replays, real collector evidence, and regeneration command: included.
- Frontend full build/native GUI: not run; no product/UI changes. Backend test build: exercised by the command above.
- Git staging/commit: the parent task stages only this audit directory after acceptance; the resulting commit is reported in the task hand-off. No push or PR is part of this task.
- Coding Wiki: not changed; this standalone repository audit does not change a shared standard.
