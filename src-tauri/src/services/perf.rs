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
/// walk) sits inside `app_pids` (which already contains `self_pid`).
fn descendant_of(row: &PsRow, rows: &HashMap<u32, &PsRow>, app_pids: &HashSet<u32>) -> bool {
    let mut ppid = row.ppid;
    for _ in 0..64 {
        if ppid <= 1 {
            return false;
        }
        if app_pids.contains(&ppid) {
            return true;
        }
        match rows.get(&ppid) {
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
        let inside = app_pids.contains(&row.pid) || descendant_of(row, rows, app_pids);
        return if inside {
            PerfClass::OmpSpawned
        } else {
            PerfClass::OmpExternal
        };
    }
    if app_pids.contains(&row.pid) || descendant_of(row, rows, app_pids) {
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

fn collect() -> PerfBreakdown {
    let self_pid = std::process::id();
    let snap = super::commands::app_memory_snapshot();
    let (total_bytes, used_bytes) = super::commands::system_memory();

    let mut bd = PerfBreakdown {
        app: PerfBucket {
            bytes: (snap.bytes > 0).then_some(snap.bytes),
            processes: snap.processes,
        },
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
        // ps failed: still surface this window as the only known instance.
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

    // Seed app tree with the responsibility set (macOS) or self, then grow it
    // over ppid ancestry so Linux descendants and dev-mode children count too.
    let by_pid: HashMap<u32, &PsRow> = rows.iter().map(|r| (r.pid, r)).collect();
    let mut app_pids: HashSet<u32> = super::commands::app_tree_pids().into_iter().collect();
    app_pids.insert(self_pid);
    // Fixed-point growth: children of known tree pids join the tree.
    loop {
        let mut added = 0usize;
        for row in &rows {
            if app_pids.contains(&row.pid) {
                continue;
            }
            if descendant_of(row, &by_pid, &app_pids) {
                app_pids.insert(row.pid);
                added += 1;
            }
        }
        if added == 0 {
            break;
        }
    }

    let own_exe = std::env::current_exe()
        .ok()
        .and_then(|p| {
            p.file_name()
                .map(|s| exe_base(&s.to_string_lossy()).to_string())
        })
        .unwrap_or_else(|| "omp-workspace".to_string());
    let omp_exe = "omp";

    let mut spawned_kb = 0u64;
    let mut spawned_n = 0u32;
    let mut external_kb = 0u64;
    let mut external_n = 0u32;
    let mut spawned_pids: Vec<u32> = Vec::new();
    let mut instance_pids: Vec<u32> = Vec::new();

    for row in &rows {
        let kb = row.rss_kb.unwrap_or(0);
        match classify(row, self_pid, &app_pids, &own_exe, omp_exe, &by_pid) {
            PerfClass::OmpSpawned => {
                spawned_kb += kb;
                spawned_n += 1;
                spawned_pids.push(row.pid);
            }
            PerfClass::OmpExternal => {
                external_kb += kb;
                external_n += 1;
            }
            PerfClass::AppInstance => instance_pids.push(row.pid),
            _ => {}
        }
    }

    bd.omp_spawned = PerfBucket {
        bytes: Some(spawned_kb * 1024),
        processes: spawned_n,
    };
    bd.omp_external = PerfBucket {
        bytes: Some(external_kb * 1024),
        processes: external_n,
    };

    // Overlap: spawned omp pids whose footprint the macOS responsibility
    // attribution already folded into `app.bytes` must not double-count in the
    // stacked bar. `snap.members` is empty off macOS (ppid walk is complete).
    let member_bytes: HashMap<u32, u64> = snap
        .members
        .iter()
        .map(|m| (m.pid, m.footprint_bytes))
        .collect();
    let overlap: u64 = spawned_pids
        .iter()
        .filter_map(|p| member_bytes.get(p).copied())
        .sum();
    bd.bar_omp_bytes = Some(
        spawned_kb
            .saturating_mul(1024)
            .saturating_add(external_kb.saturating_mul(1024))
            .saturating_sub(overlap),
    );
    bd.other_bytes = used_bytes.map(|u| {
        u.saturating_sub(snap.bytes)
            .saturating_sub(bd.bar_omp_bytes.unwrap_or(0))
    });

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
