//! System-wide memory breakdown for the bottom-bar performance popover.
//!
//! Buckets: this app's process tree (same footprint semantics as
//! `app_memory_usage`), `omp` agent processes split into spawned-by-us vs
//! external, other processes/system, and free. Plus running omp-workspace
//! instances labelled by worktree/branch. Collection shells out to
//! `ps`/`lsof`/`git`, runs via `spawn_blocking`, and is cached ~3 s so the
//! popover can poll cheaply. No process arguments are ever captured — `ps comm`
//! yields only the executable name.

use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::contracts::{AppInstance, PerfBreakdown, PerfBucket};

const COLLECT_TIMEOUT: Duration = Duration::from_secs(5);
const CACHE_TTL: Duration = Duration::from_secs(3);

// ---------------------------------------------------------------------------
// ps parsing (pure)

/// One row of `ps -axo pid=,ppid=,rss=,comm=`.
/// `rss_kb` is None when the kernel hides it; `comm` is the executable name
/// (macOS may print a path or a bare name), never argv.
#[derive(Debug, Clone, PartialEq)]
pub struct PsRow {
    pub pid: u32,
    pub ppid: u32,
    pub rss_kb: Option<u64>,
    pub comm: String,
}

/// Pids owned by this instance. `current` = everything it owns (including
/// `omp` agents); `app` = `current` minus `omp` agents.
#[derive(Debug)]
struct InstanceTrees {
    app: HashSet<u32>,
    current: HashSet<u32>,
}

/// Every pid reachable downward from `seeds` through `children`, never
/// entering `blocked` pids.
fn expand_down(
    seeds: impl IntoIterator<Item = u32>,
    children: &HashMap<u32, Vec<u32>>,
    blocked: &HashSet<u32>,
) -> HashSet<u32> {
    let mut seen: HashSet<u32> = HashSet::new();
    let mut stack: Vec<u32> = seeds.into_iter().collect();
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        if let Some(kids) = children.get(&pid) {
            stack.extend(kids.iter().copied().filter(|k| !blocked.contains(k)));
        }
    }
    seen
}

/// Isolate this instance from every other omp-workspace instance.
///
/// Ownership = self + its ppid descendants, never crossing another instance's
/// root (same executable, different pid) — so a dev instance launched from the
/// formal app is excluded from the formal app, and vice versa. macOS
/// responsibility only adds reparented helpers (WebKit processes have ppid 1):
/// candidates are processes charged to `self_pid`, minus any other instance's
/// tree. Responsibility is inherited across launch chains, so it is used only
/// when this process is its own responsible pid and no other instance is
/// charged to it; otherwise the reparented helpers are ambiguous and left out
/// (an honest undercount beats charging another instance's memory to us).
fn prune_instance_trees(
    rows: &[PsRow],
    responsible: &HashMap<u32, u32>,
    self_pid: u32,
    own_exe: &str,
    omp_exe: &str,
) -> InstanceTrees {
    let other_roots: HashSet<u32> = rows
        .iter()
        .filter(|row| row.pid != self_pid && exe_base(&row.comm) == own_exe)
        .map(|row| row.pid)
        .collect();
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for row in rows {
        if row.pid != row.ppid {
            children.entry(row.ppid).or_default().push(row.pid);
        }
    }
    let foreign = expand_down(
        other_roots.iter().copied(),
        &children,
        &HashSet::from([self_pid]),
    );

    let self_is_responsible = responsible.get(&self_pid).map_or(true, |r| *r == self_pid);
    let shares_responsibility = other_roots
        .iter()
        .any(|pid| responsible.get(pid) == Some(&self_pid));
    let mut seeds = vec![self_pid];
    if self_is_responsible && !shares_responsibility {
        seeds.extend(
            rows.iter()
                .filter(|row| {
                    row.pid != self_pid
                        && responsible.get(&row.pid) == Some(&self_pid)
                        && !foreign.contains(&row.pid)
                })
                .map(|row| row.pid),
        );
    }
    let current = expand_down(seeds, &children, &other_roots);
    let by_pid: HashMap<u32, &PsRow> = rows.iter().map(|r| (r.pid, r)).collect();
    let mut app = current.clone();
    app.retain(|pid| {
        by_pid
            .get(pid)
            .map_or(true, |row| exe_base(&row.comm) != omp_exe)
    });
    InstanceTrees { app, current }
}

/// `omp` agents split into (spawned by this instance, external). Both are
/// physical-footprint buckets over PIDs disjoint from the app bucket.
fn aggregate_omp(
    rows: &[PsRow],
    self_pid: u32,
    current: &HashSet<u32>,
    footprints: &HashMap<u32, Option<u64>>,
    own_exe: &str,
    omp_exe: &str,
) -> (PerfBucket, PerfBucket) {
    let by_pid: HashMap<u32, &PsRow> = rows.iter().map(|r| (r.pid, r)).collect();
    let mut spawned: Vec<u32> = Vec::new();
    let mut external: Vec<u32> = Vec::new();
    for row in rows {
        match classify(row, self_pid, current, own_exe, omp_exe, &by_pid) {
            PerfClass::OmpSpawned => spawned.push(row.pid),
            PerfClass::OmpExternal => external.push(row.pid),
            _ => {}
        }
    }
    (
        aggregate_bucket(spawned, footprints),
        aggregate_bucket(external, footprints),
    )
}

/// Sum physical footprints. Members whose probe failed (typically exited
/// between the `ps` scan and the probe) are skipped and not counted; a
/// non-empty set with no readable member is unknown (`None`), never zero.
fn aggregate_bucket(
    pids: impl IntoIterator<Item = u32>,
    footprints: &HashMap<u32, Option<u64>>,
) -> PerfBucket {
    let (mut total, mut known, mut any) = (0u64, 0u32, false);
    for pid in pids {
        any = true;
        if let Some(bytes) = footprints.get(&pid).copied().flatten() {
            total = total.saturating_add(bytes);
            known += 1;
        }
    }
    PerfBucket {
        bytes: if any && known == 0 { None } else { Some(total) },
        processes: known,
    }
}

/// Parse `ps -axo pid=,ppid=,rss=,comm=` output. `comm` may contain spaces
/// (macOS prints the full path, e.g. `.../Google Chrome Helper (Renderer)`), so
/// an empty `rss` column folds into `comm` and a non-numeric third token is
/// re-attached to `comm`.
pub fn parse_ps_rows(text: &str) -> Vec<PsRow> {
    text.lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let pid: u32 = it.next()?.parse().ok()?;
            let ppid: u32 = it.next()?.parse().ok()?;
            let third = it.next()?;
            let (rss_kb, comm) = match third.parse::<u64>() {
                Ok(kb) => (Some(kb), it.collect::<Vec<_>>().join(" ")),
                // rss column empty (or "-"): `third` is already part of comm.
                Err(_) => (
                    None,
                    std::iter::once(third)
                        .chain(it)
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
            };
            Some(PsRow {
                pid,
                ppid,
                rss_kb,
                comm,
            })
        })
        .collect()
}

/// Executable basename for classification: `/a/b/omp` → `omp`, `omp` → `omp`.
/// Windows-style `X.exe` suffixes are tolerated.
pub fn exe_base(comm: &str) -> &str {
    let base = comm.rsplit(['/', '\\']).next().unwrap_or(comm).trim();
    base.strip_suffix(".exe").unwrap_or(base)
}

// ---------------------------------------------------------------------------
// classification (pure)

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PerfClass {
    /// Self + WebView/helper processes attributed to this app instance.
    AppTree,
    /// `omp` agent whose parent chain bottoms out inside this app's tree.
    OmpSpawned,
    /// `omp` running outside this app (terminals, other instances' children).
    OmpExternal,
    /// Another omp-workspace main process (same executable, different pid).
    AppInstance,
    Other,
}

/// Walk `row`'s ancestor chain via `ppid`; true when any ancestor (bounded
/// walk) sits inside `app_pids`. The walk stops at another instance's root
/// (same executable, not in `app_pids`) so its subtree is never ours.
fn descendant_of(
    row: &PsRow,
    rows: &HashMap<u32, &PsRow>,
    app_pids: &HashSet<u32>,
    own_exe: &str,
) -> bool {
    let mut ppid = row.ppid;
    for _ in 0..64 {
        if ppid <= 1 {
            return false;
        }
        if app_pids.contains(&ppid) {
            return true;
        }
        match rows.get(&ppid) {
            Some(parent) if exe_base(&parent.comm) == own_exe => return false,
            Some(parent) if parent.ppid != ppid => ppid = parent.ppid,
            _ => return false,
        }
    }
    false
}

/// Classify one parsed row. `app_pids` = pids this app's footprint covers
/// (macOS responsibility set, else just self); `own_exe`/`omp_exe` are the
/// executable basenames. An `omp` inside the app tree counts as `OmpSpawned`
/// (never AppTree), so the buckets are disjoint.
pub fn classify(
    row: &PsRow,
    self_pid: u32,
    app_pids: &HashSet<u32>,
    own_exe: &str,
    omp_exe: &str,
    rows: &HashMap<u32, &PsRow>,
) -> PerfClass {
    if row.pid == self_pid {
        return PerfClass::AppTree;
    }
    let exe = exe_base(&row.comm);
    if exe == own_exe {
        return PerfClass::AppInstance;
    }
    if exe == omp_exe {
        let inside = app_pids.contains(&row.pid) || descendant_of(row, rows, app_pids, own_exe);
        return if inside {
            PerfClass::OmpSpawned
        } else {
            PerfClass::OmpExternal
        };
    }
    if app_pids.contains(&row.pid) || descendant_of(row, rows, app_pids, own_exe) {
        return PerfClass::AppTree;
    }
    PerfClass::Other
}

// ---------------------------------------------------------------------------
// collectors (platform)

/// `ps` rows for the whole system; None when `ps` is missing/failed.
fn collect_ps_rows() -> Option<Vec<PsRow>> {
    let mut cmd = Command::new("/bin/ps");
    cmd.args(["-axo", "pid=,ppid=,rss=,comm="]);
    let out = crate::git::cmd::run(cmd, COLLECT_TIMEOUT).ok()?;
    let rows = parse_ps_rows(&out.text());
    (!rows.is_empty()).then_some(rows)
}

/// pid → cwd via `lsof -d cwd` for the given pids (batched; silent failures
/// just leave cwd unknown).
fn collect_cwds(pids: &[u32]) -> HashMap<u32, String> {
    if pids.is_empty() {
        return HashMap::new();
    }
    let list = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let mut cmd = Command::new(crate::services::scan::lsof_bin());
    cmd.args(["-a", "-p", &list, "-d", "cwd", "-F", "n"]);
    crate::git::cmd::run(cmd, COLLECT_TIMEOUT)
        .map(|o| crate::services::scan::parse_lsof_cwd(&o.text()))
        .unwrap_or_default()
}

/// "<worktree> (<branch>)" for a git cwd, else the directory basename,
/// else "pid N". Never errors out the caller; never returns argv.
fn instance_label(cwd: &str, pid: u32) -> String {
    let dir = std::path::Path::new(cwd);
    if let Ok(branch) = crate::git::cmd::git_ok(dir, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        let branch = branch.trim();
        if !branch.is_empty() {
            if let Ok(top) = crate::git::cmd::git_ok(dir, &["rev-parse", "--show-toplevel"]) {
                if let Some(name) = std::path::Path::new(top.trim())
                    .file_name()
                    .and_then(|s| s.to_str())
                {
                    if branch == "HEAD" || name == branch {
                        return name.to_string();
                    }
                    return format!("{name} ({branch})");
                }
            }
            if branch != "HEAD" {
                return branch.to_string();
            }
        }
    }
    dir.file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("pid {pid}"))
}

/// How long a computed instance label is reused. The label spawns two `git`
/// processes; the branch rarely changes, so re-resolve at most once a minute.
const LABEL_TTL: Duration = Duration::from_secs(60);

/// (pid, cwd) → (computed at, label).
type LabelCache = HashMap<(u32, String), (Instant, String)>;

static LABELS: OnceLock<Mutex<LabelCache>> = OnceLock::new();

/// Build the instance list; `git` labels are cached per (pid, cwd) so the
/// 4 s popover poll does not respawn `git` ×2 per instance every tick.
fn instance_labels(
    instance_pids: &[u32],
    cwds: &HashMap<u32, String>,
    self_pid: u32,
) -> Vec<AppInstance> {
    let mut cache = LABELS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    // Drop entries for instances that are gone (or whose cwd changed).
    cache.retain(|(pid, cwd), (at, _)| {
        now.duration_since(*at) < LABEL_TTL && cwds.get(pid).is_some_and(|c| c == cwd)
    });
    instance_pids
        .iter()
        .map(|&pid| {
            let cwd = cwds.get(&pid).cloned();
            let label = match &cwd {
                Some(c) => {
                    let key = (pid, c.clone());
                    match cache.get(&key) {
                        Some((_, label)) => label.clone(),
                        None => {
                            let label = instance_label(c, pid);
                            cache.insert(key, (now, label.clone()));
                            label
                        }
                    }
                }
                None if pid == self_pid => "本窗口".to_string(),
                None => format!("pid {pid}"),
            };
            AppInstance {
                pid,
                label,
                cwd,
                is_this: pid == self_pid,
            }
        })
        .collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn own_exe_name() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|p| {
            p.file_name()
                .map(|s| exe_base(&s.to_string_lossy()).to_string())
        })
        .unwrap_or_else(|| "omp-workspace".to_string())
}

/// Physical footprint per pid. This process uses the primary snapshot (the
/// only source on platforms without a per-pid probe); others use
/// `process_footprint`, which is None where no footprint API exists. RSS is
/// never substituted.
fn footprints_for(
    pids: impl IntoIterator<Item = u32>,
    self_pid: u32,
    self_footprint: Option<u64>,
) -> HashMap<u32, Option<u64>> {
    pids.into_iter()
        .map(|pid| {
            let bytes = if pid == self_pid {
                self_footprint
            } else {
                super::commands::process_footprint(pid)
            };
            (pid, bytes)
        })
        .collect()
}

/// App bucket over this instance's own pids. Unknown when this process's own
/// footprint cannot be read, since the total would silently omit the main
/// process.
fn app_bucket_from(
    app: &HashSet<u32>,
    self_pid: u32,
    footprints: &HashMap<u32, Option<u64>>,
) -> PerfBucket {
    let mut bucket = aggregate_bucket(app.iter().copied(), footprints);
    if footprints.get(&self_pid).copied().flatten().is_none() {
        bucket.bytes = None;
    }
    bucket
}

fn compute_app_bucket() -> PerfBucket {
    let self_pid = std::process::id();
    let snap = super::commands::app_memory_snapshot();
    let self_footprint = snap
        .members
        .iter()
        .find(|m| m.pid == self_pid)
        .map(|m| m.footprint_bytes);
    let Some(rows) = collect_ps_rows() else {
        return PerfBucket {
            bytes: self_footprint,
            processes: u32::from(self_footprint.is_some()),
        };
    };
    let trees = prune_instance_trees(
        &rows,
        &super::commands::responsible_map(),
        self_pid,
        &own_exe_name(),
        "omp",
    );
    let footprints = footprints_for(trees.app.iter().copied(), self_pid, self_footprint);
    app_bucket_from(&trees.app, self_pid, &footprints)
}

/// This instance's app bucket (physical footprint, other instances excluded).
/// Backs the bottom-bar number so it always matches `perf_breakdown().app`.
pub async fn app_bucket() -> PerfBucket {
    tokio::task::spawn_blocking(compute_app_bucket)
        .await
        .unwrap_or_default()
}

fn collect() -> PerfBreakdown {
    let self_pid = std::process::id();
    let snap = super::commands::app_memory_snapshot();
    let self_footprint = snap
        .members
        .iter()
        .find(|m| m.pid == self_pid)
        .map(|m| m.footprint_bytes);
    let (total_bytes, used_bytes) = super::commands::system_memory();

    let mut bd = PerfBreakdown {
        generated_at: now_ms(),
        ..PerfBreakdown::default()
    };
    bd.total_bytes = total_bytes;
    bd.used_bytes = used_bytes;
    bd.free_bytes = match (total_bytes, used_bytes) {
        (Some(t), Some(u)) => Some(t.saturating_sub(u)),
        _ => None,
    };

    let Some(rows) = collect_ps_rows() else {
        // ps failed: only this process is known; omp buckets stay unknown.
        bd.app = PerfBucket {
            bytes: self_footprint,
            processes: u32::from(self_footprint.is_some()),
        };
        bd.instances = vec![AppInstance {
            pid: self_pid,
            label: "本窗口".to_string(),
            cwd: std::env::current_dir()
                .ok()
                .map(|p| p.to_string_lossy().into_owned()),
            is_this: true,
        }];
        return bd;
    };

    let own_exe = own_exe_name();
    let omp_exe = "omp";
    let trees = prune_instance_trees(
        &rows,
        &super::commands::responsible_map(),
        self_pid,
        &own_exe,
        omp_exe,
    );
    let mut instance_pids: Vec<u32> = rows
        .iter()
        .filter(|row| row.pid != self_pid && exe_base(&row.comm) == own_exe)
        .map(|row| row.pid)
        .collect();

    let footprints = footprints_for(
        trees.app.iter().copied().chain(
            rows.iter()
                .filter(|r| exe_base(&r.comm) == omp_exe)
                .map(|r| r.pid),
        ),
        self_pid,
        self_footprint,
    );
    bd.app = app_bucket_from(&trees.app, self_pid, &footprints);
    let (spawned, external) = aggregate_omp(
        &rows,
        self_pid,
        &trees.current,
        &footprints,
        &own_exe,
        omp_exe,
    );
    bd.omp_spawned = spawned;
    bd.omp_external = external;

    // The OMP legend segment is exactly spawned + external (disjoint PIDs,
    // same footprint metric); either unknown makes it unknown.
    bd.bar_omp_bytes = match (bd.omp_spawned.bytes, bd.omp_external.bytes) {
        (Some(spawned), Some(external)) => Some(spawned.saturating_add(external)),
        _ => None,
    };
    bd.other_bytes = match (used_bytes, bd.app.bytes, bd.bar_omp_bytes) {
        (Some(used), Some(app), Some(omp)) => Some(used.saturating_sub(app).saturating_sub(omp)),
        _ => None,
    };

    // Running app instances (self + others), labelled by worktree/branch.
    instance_pids.push(self_pid);
    instance_pids.sort_unstable();
    instance_pids.dedup();
    let cwds = collect_cwds(&instance_pids);
    bd.instances = instance_labels(&instance_pids, &cwds, self_pid);

    bd
}

// OnceLock (not LazyLock): crate MSRV is 1.77.
static CACHE: OnceLock<Mutex<Option<(Instant, PerfBreakdown)>>> = OnceLock::new();

fn cache() -> &'static Mutex<Option<(Instant, PerfBreakdown)>> {
    CACHE.get_or_init(Default::default)
}

/// Cached memory breakdown; the expensive scan runs on a blocking thread.
pub async fn breakdown() -> PerfBreakdown {
    if let Ok(guard) = cache().lock() {
        if let Some((at, snap)) = guard.as_ref() {
            if at.elapsed() < CACHE_TTL {
                return snap.clone();
            }
        }
    }
    let snap = tokio::task::spawn_blocking(collect)
        .await
        .unwrap_or_default();
    if let Ok(mut guard) = cache().lock() {
        *guard = Some((Instant::now(), snap.clone()));
    }
    snap
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(pid: u32, ppid: u32, rss: &str, comm: &str) -> PsRow {
        PsRow {
            pid,
            ppid,
            rss_kb: rss.parse().ok(),
            comm: comm.to_string(),
        }
    }

    fn rown(pid: u32, ppid: u32, comm: &str) -> PsRow {
        PsRow {
            pid,
            ppid,
            rss_kb: None,
            comm: comm.to_string(),
        }
    }

    #[test]
    fn parse_ps_rows_basic() {
        let text = "    1     0   6272 /sbin/launchd\n  528 30631 169504 omp\n 30631 50991  92064 target/debug/omp-workspace\n";
        let rows = parse_ps_rows(text);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].pid, 1);
        assert_eq!(rows[0].ppid, 0);
        assert_eq!(rows[0].rss_kb, Some(6272));
        assert_eq!(rows[0].comm, "/sbin/launchd");
        assert_eq!(rows[1].comm, "omp");
        assert_eq!(rows[2].comm, "target/debug/omp-workspace");
    }

    #[test]
    fn parse_ps_rows_missing_rss_and_spaced_comm() {
        // rss column empty → comm absorbs the token; spaced path kept whole.
        let text = "  13757 49152  Google Chrome for Testing Helper (Renderer)\n  9   1   - Helper Agent (GPU)\n bad line\n";
        let rows = parse_ps_rows(text);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].rss_kb, None);
        assert_eq!(rows[0].comm, "Google Chrome for Testing Helper (Renderer)");
        assert_eq!(rows[1].rss_kb, None);
        assert_eq!(rows[1].comm, "- Helper Agent (GPU)");
    }

    #[test]
    fn exe_base_paths() {
        assert_eq!(exe_base("/Users/x/.local/bin/omp"), "omp");
        assert_eq!(exe_base("target/debug/omp-workspace"), "omp-workspace");
        assert_eq!(exe_base("omp"), "omp");
        assert_eq!(exe_base("C:\\bin\\omp.exe"), "omp");
        assert_eq!(
            exe_base("/a/b/Google Chrome Helper (Renderer)"),
            "Google Chrome Helper (Renderer)"
        );
    }

    #[test]
    fn classify_tree_attribution() {
        // self=100 (app); helper 101 responsible child (in app_pids);
        // helper 102 plain descendant; stray 201 other app.
        let rows = [
            row(100, 1, "90000", "target/debug/omp-workspace"),
            rown(101, 1, "com.apple.WebKit.WebContent"),
            rown(102, 100, "git"),
            row(201, 1, "5000", "zsh"),
        ];
        let by_pid: HashMap<u32, &PsRow> = rows.iter().map(|r| (r.pid, r)).collect();
        let app_pids: HashSet<u32> = [100u32, 101].into_iter().collect();
        assert_eq!(
            classify(&rows[0], 100, &app_pids, "omp-workspace", "omp", &by_pid),
            PerfClass::AppTree
        );
        assert_eq!(
            classify(&rows[1], 100, &app_pids, "omp-workspace", "omp", &by_pid),
            PerfClass::AppTree
        );
        assert_eq!(
            classify(&rows[2], 100, &app_pids, "omp-workspace", "omp", &by_pid),
            PerfClass::AppTree
        );
        assert_eq!(
            classify(&rows[3], 100, &app_pids, "omp-workspace", "omp", &by_pid),
            PerfClass::Other
        );
    }

    #[test]
    fn classify_omp_spawned_vs_external() {
        // 300: direct omp child of app; 301: omp grandchild via zsh;
        // 302: omp in a different app's tree (rooted at pid 900 not ours).
        let rows = [
            row(100, 1, "90000", "target/debug/omp-workspace"),
            row(300, 100, "20000", "/Users/x/.local/bin/omp"),
            row(301, 400, "30000", "omp"),
            rown(400, 100, "zsh"),
            row(302, 900, "40000", "omp"),
            rown(900, 1, "SomeOtherApp"),
        ];
        let by_pid: HashMap<u32, &PsRow> = rows.iter().map(|r| (r.pid, r)).collect();
        let app_pids: HashSet<u32> = [100u32].into_iter().collect();
        let c = |r: &PsRow| classify(r, 100, &app_pids, "omp-workspace", "omp", &by_pid);
        assert_eq!(c(&rows[1]), PerfClass::OmpSpawned);
        assert_eq!(c(&rows[2]), PerfClass::OmpSpawned);
        assert_eq!(c(&rows[4]), PerfClass::OmpExternal);
    }

    #[test]
    fn classify_omp_spawned_via_responsibility() {
        // Packaged build: responsibility() can attribute a spawned omp
        // directly (pid in app_pids) even though ppid chain shows it too.
        let rows = [
            row(100, 1, "90000", "omp-workspace"),
            row(300, 1, "20000", "omp"), // ppid=1 but responsible→us
        ];
        let by_pid: HashMap<u32, &PsRow> = rows.iter().map(|r| (r.pid, r)).collect();
        let app_pids: HashSet<u32> = [100u32, 300].into_iter().collect();
        assert_eq!(
            classify(&rows[1], 100, &app_pids, "omp-workspace", "omp", &by_pid),
            PerfClass::OmpSpawned
        );
    }

    #[test]
    fn classify_other_instances() {
        // Another worktree's app process (same exe basename, different pid).
        let rows = [
            row(100, 1, "90000", "target/debug/omp-workspace"),
            row(555, 1, "80000", "/opt/omp-workspace"),
            row(556, 1, "60000", "omp-workspace.exe"),
        ];
        let by_pid: HashMap<u32, &PsRow> = rows.iter().map(|r| (r.pid, r)).collect();
        let app_pids: HashSet<u32> = [100u32].into_iter().collect();
        let c = |r: &PsRow| classify(r, 100, &app_pids, "omp-workspace", "omp", &by_pid);
        assert_eq!(c(&rows[1]), PerfClass::AppInstance);
        // exe_base strips .exe only on windows paths; bare "omp-workspace.exe"
        // also strips the suffix → still an instance.
        assert_eq!(c(&rows[2]), PerfClass::AppInstance);
        // An omp child of another instance is external, not spawned by us.
        let extra = row(557, 555, "10000", "omp");
        let mut bp = by_pid.clone();
        bp.insert(557, &extra);
        assert_eq!(
            classify(&extra, 100, &app_pids, "omp-workspace", "omp", &bp),
            PerfClass::OmpExternal
        );
    }

    /// Formal app 100 with a dev instance 300 launched from it. Both inherit
    /// responsibility 100; WebContent helpers are reparented to launchd.
    fn nested_fixture() -> (Vec<PsRow>, HashMap<u32, u32>) {
        let rows = vec![
            row(100, 1, "1", "/Applications/omp-workspace"),
            rown(101, 1, "com.apple.WebKit.WebContent"),
            row(200, 100, "2", "omp"),
            rown(201, 200, "node"),
            row(300, 100, "3", "target/debug/omp-workspace"),
            rown(301, 1, "com.apple.WebKit.WebContent"),
            row(302, 300, "4", "omp"),
            rown(303, 302, "node"),
            rown(900, 1, "zsh"),
        ];
        let responsible = [
            (100, 100),
            (101, 100),
            (200, 100),
            (201, 100),
            (300, 100),
            (301, 100),
            (302, 100),
            (303, 100),
            (900, 900),
        ]
        .into_iter()
        .collect();
        (rows, responsible)
    }

    #[test]
    fn formal_instance_excludes_nested_dev_instance() {
        let (rows, responsible) = nested_fixture();
        let trees = prune_instance_trees(&rows, &responsible, 100, "omp-workspace", "omp");
        // Dev instance 300, its omp/node and its reparented helper 301 are not
        // ours. Our own reparented helper 101 is ambiguous (the dev instance
        // shares our responsibility) and stays out rather than risk 301.
        assert_eq!(trees.current, [100, 200, 201].into_iter().collect());
        // `omp` itself is its own bucket; its tool children stay in the app.
        assert_eq!(trees.app, [100, 201].into_iter().collect());
    }

    #[test]
    fn dev_instance_excludes_parent_and_uses_own_tree() {
        let (rows, responsible) = nested_fixture();
        let trees = prune_instance_trees(&rows, &responsible, 300, "omp-workspace", "omp");
        // Responsibility points at the formal app, so it is not evidence.
        assert_eq!(trees.current, [300, 302, 303].into_iter().collect());
        assert_eq!(trees.app, [300, 303].into_iter().collect());
    }

    #[test]
    fn own_helpers_included_when_responsibility_is_unshared() {
        let (rows, mut responsible) = nested_fixture();
        // Dev instance launched independently: it is its own responsible pid.
        for pid in [300, 301, 302] {
            responsible.insert(pid, 300);
        }
        // 303 stays charged to 100 but lives in the foreign tree.
        let trees = prune_instance_trees(&rows, &responsible, 100, "omp-workspace", "omp");
        assert_eq!(trees.current, [100, 101, 200, 201].into_iter().collect());
        assert_eq!(trees.app, [100, 101, 201].into_iter().collect());

        let footprints = trees
            .app
            .iter()
            .map(|&pid| (pid, Some(pid as u64 * 10)))
            .collect();
        let app = aggregate_bucket(trees.app.iter().copied(), &footprints);
        assert_eq!(app.bytes, Some(4020));
        assert_eq!(app.processes, 3);
    }

    #[test]
    fn aggregation_uses_footprints_and_skips_unreadable_members() {
        let rows = [
            row(100, 1, "999999", "omp-workspace"),
            row(200, 100, "999999", "omp"),
            row(300, 1, "999999", "omp"),
        ];
        let current: HashSet<u32> = [100, 200].into_iter().collect();
        let footprints = [(200, Some(20)), (300, Some(30))].into_iter().collect();
        let (spawned, external) =
            aggregate_omp(&rows, 100, &current, &footprints, "omp-workspace", "omp");
        assert_eq!(spawned.bytes, Some(20));
        assert_eq!(external.bytes, Some(30));
        assert_eq!((spawned.processes, external.processes), (1, 1));

        // Unreadable member: bucket with no readable member is unknown.
        let footprints = [(200, None), (300, Some(30))].into_iter().collect();
        let (spawned, external) =
            aggregate_omp(&rows, 100, &current, &footprints, "omp-workspace", "omp");
        assert_eq!(spawned.bytes, None);
        assert_eq!(spawned.processes, 0);
        assert_eq!(external.bytes, Some(30));

        // Partially readable: exited members are skipped, not counted as zero.
        let footprints = [(1, Some(5)), (2, None)].into_iter().collect();
        let bucket = aggregate_bucket([1, 2], &footprints);
        assert_eq!((bucket.bytes, bucket.processes), (Some(5), 1));
        let empty = aggregate_bucket(Vec::<u32>::new(), &footprints);
        assert_eq!((empty.bytes, empty.processes), (Some(0), 0));
    }

    #[test]
    fn collect_real_snapshot() {
        // Runs the real collectors on this machine (macOS): prints actual
        // numbers so a human can sanity-check the bar against Activity Monitor.
        let bd = collect();
        eprintln!("=== perf_breakdown live numbers ===");
        eprintln!("app: {:?} bytes, {} procs", bd.app.bytes, bd.app.processes);
        eprintln!(
            "omp spawned: {:?} bytes ({}), external: {:?} bytes ({})",
            bd.omp_spawned.bytes,
            bd.omp_spawned.processes,
            bd.omp_external.bytes,
            bd.omp_external.processes
        );
        eprintln!(
            "total {:?} used {:?} other {:?} free {:?} bar_omp {:?}",
            bd.total_bytes, bd.used_bytes, bd.other_bytes, bd.free_bytes, bd.bar_omp_bytes
        );
        for i in &bd.instances {
            eprintln!(
                "instance pid {} label {:?} cwd {:?} this={}",
                i.pid, i.label, i.cwd, i.is_this
            );
        }
        assert!(bd.app.bytes.is_some());
        #[cfg(target_os = "macos")]
        {
            assert!(bd.total_bytes.is_some());
            assert!(bd.used_bytes.is_some());
            assert!(!bd.instances.is_empty());
            assert!(bd.instances.iter().any(|i| i.is_this));
        }
    }
}
