//! Integration tests against throwaway repos under /tmp/ompws-test-c.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::cmd::git_ok;
use super::*;

fn temp_repo(tag: &str) -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = PathBuf::from(format!(
        "/tmp/ompws-test-c/repo-{tag}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    git_ok(&dir, &["init", "-q", "-b", "main"]).unwrap();
    git_ok(&dir, &["config", "user.name", "Test"]).unwrap();
    git_ok(&dir, &["config", "user.email", "t@example.com"]).unwrap();
    git_ok(&dir, &["config", "commit.gpgsign", "false"]).unwrap();
    dir
}

fn commit(dir: &Path, file: &str, content: &str, msg: &str) -> String {
    std::fs::write(dir.join(file), content).unwrap();
    git_ok(dir, &["add", "-A"]).unwrap();
    git_ok(dir, &["commit", "-q", "-m", msg]).unwrap();
    git_ok(dir, &["rev-parse", "HEAD"])
        .unwrap()
        .trim()
        .to_string()
}

#[test]
fn summary_log_diff_reset() {
    let repo = temp_repo("summary");
    // Unborn branch: summary works, log empty.
    std::fs::write(repo.join("a.txt"), "1\n2\n").unwrap();
    let s = status::summary(&repo);
    assert!(s.is_repo);
    assert_eq!(s.branch.as_deref(), Some("main"));
    assert_eq!(s.files[0].status, "??");
    assert_eq!(s.files[0].added, 2);
    assert!(history::log(&repo, 10).is_empty());
    assert!(history::diff(&repo, None, None).unwrap().contains("+2"));

    let first = commit(&repo, "a.txt", "1\n2\n", "first");
    let second = commit(&repo, "a.txt", "1\n2\n3\n", "second");
    std::fs::write(repo.join("a.txt"), "1\nX\n3\n").unwrap();
    std::fs::create_dir_all(repo.join("sub/dir")).unwrap();
    std::fs::write(repo.join("sub/dir/n.md"), "# hi\n").unwrap();

    let s = status::summary(&repo);
    assert!(s.has_uncommitted);
    let a = s.files.iter().find(|f| f.path == "a.txt").unwrap();
    assert_eq!((a.status.as_str(), a.added, a.deleted), ("M", 1, 1));
    assert!(s
        .files
        .iter()
        .any(|f| f.path == "sub/dir/n.md" && f.status == "??"));

    // Diff from a subdirectory still resolves root-relative paths.
    let d = history::diff(&repo.join("sub"), Some("a.txt"), None).unwrap();
    assert!(d.contains("-2") && d.contains("+X"));
    let d = history::diff(&repo, Some("sub/dir/n.md"), None).unwrap();
    assert!(d.contains("+# hi"));
    let d = history::diff(&repo, None, Some(&second[..8])).unwrap();
    assert!(d.contains("second") && d.contains("+3"));

    let log = history::log(&repo, 10);
    assert_eq!(log.len(), 2);
    assert_eq!(log[0].subject, "second");
    assert_eq!(log[1].sha, first);

    let b = badge(&repo).unwrap();
    assert_eq!(b.branch.as_deref(), Some("main"));
    assert_eq!(b.dirty, 2);
    assert_eq!(b.worktree, None);

    history::reset_to(&repo, &first, "soft").unwrap();
    assert_eq!(history::log(&repo, 10).len(), 1);
    history::reset_to(&repo, &first, "hard").unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.join("a.txt")).unwrap(),
        "1\n2\n"
    );
    assert!(history::reset_to(&repo, "--hard", "hard").is_err());
    assert!(history::reset_to(&repo, &first, "mixed").is_err());

    assert!(!status::summary(Path::new("/tmp/ompws-test-c/does-not-exist")).is_repo);
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn worktree_lifecycle_and_orphans() {
    let repo = temp_repo("wt");
    assert!(worktree::create(&repo, "x").is_err(), "no commits yet");
    commit(&repo, "a.txt", "a\n", "init");

    let wt = worktree::create(&repo, "Feature One").unwrap();
    assert!(wt.path.ends_with(".worktrees/feature-one"));
    assert_eq!(wt.branch.as_deref(), Some("omp/feature-one"));
    let exclude = std::fs::read_to_string(repo.join(".git/info/exclude")).unwrap();
    assert!(exclude.contains("/.worktrees/"));
    // Main repo stays clean (worktrees dir is excluded).
    assert!(status::summary(&repo).files.is_empty());

    // repo_root and badge resolve through the linked worktree.
    let wt_path = PathBuf::from(&wt.path);
    let root = worktree::canon(&repo).to_string_lossy().into_owned();
    assert_eq!(repo_root(&wt_path).as_deref(), Some(root.as_str()));
    assert_eq!(
        badge(&wt_path).unwrap().worktree.as_deref(),
        Some("feature-one")
    );

    // Creating from inside the worktree targets the main repo's .worktrees.
    let wt2 = worktree::create(&wt_path, "two").unwrap();
    assert!(wt2.path.starts_with(&root));

    let sessions = vec![("s1".to_string(), format!("{}/sub", wt2.path))];
    let list = worktree::list(&repo, &sessions).unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(
        list.iter()
            .find(|w| w.path == wt2.path)
            .unwrap()
            .session_ids,
        vec!["s1"]
    );
    let orphans = worktree::orphans(&[repo.to_string_lossy().into_owned()], &sessions);
    assert_eq!(orphans.len(), 1);
    assert_eq!(orphans[0].path, wt.path);

    // Dirty worktree refuses removal without force.
    std::fs::write(wt_path.join("dirty.txt"), "x").unwrap();
    assert!(worktree::list(&repo, &[])
        .unwrap()
        .iter()
        .any(|w| w.path == wt.path && w.dirty));
    assert!(worktree::remove(&repo, &wt_path, true, false).is_err());
    assert!(
        worktree::remove(&repo, &repo, false, true).is_err(),
        "main worktree"
    );
    worktree::remove(&repo, &wt_path, true, true).unwrap();
    assert!(!wt_path.exists());
    assert!(git_ok(
        &repo,
        &["rev-parse", "--verify", "-q", "refs/heads/omp/feature-one"]
    )
    .is_err());

    // Clean removal keeps the branch unless asked.
    worktree::remove(&repo, Path::new(&wt2.path), false, false).unwrap();
    assert!(git_ok(
        &repo,
        &["rev-parse", "--verify", "-q", "refs/heads/omp/two"]
    )
    .is_ok());
    // Re-creating reuses the existing branch.
    let again = worktree::create(&repo, "two").unwrap();
    assert_eq!(again.branch.as_deref(), Some("omp/two"));
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn time_machine_runs_and_stops() {
    let repo = temp_repo("tm");
    let first = commit(&repo, "a.txt", "old\n", "old");
    commit(&repo, "a.txt", "new\n", "new");

    let lines = Arc::new(parking_lot::Mutex::new(Vec::<String>::new()));
    let sink_lines = lines.clone();
    let sink: tm::LogSink = Arc::new(move |_id: &str, line: &str| {
        sink_lines.lock().push(line.to_string());
    });
    let cmd = "cat a.txt; echo 'Local: http://localhost:4321/'; sleep 30";
    let run = tm::run(&repo, &first[..10], Some(cmd), sink.clone()).unwrap();
    assert!(run.worktree.contains(".worktrees/tm-"));
    assert!(run.pid.is_some());
    // Same commit while running returns the same run.
    assert_eq!(
        tm::run(&repo, &first, Some(cmd), sink.clone()).unwrap().id,
        run.id
    );

    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if tm::list().iter().any(|r| r.id == run.id && r.url.is_some()) {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let listed = tm::list().into_iter().find(|r| r.id == run.id).unwrap();
    assert_eq!(listed.url.as_deref(), Some("http://localhost:4321/"));
    assert!(
        listed.log_tail.contains("old"),
        "runs the old commit: {}",
        listed.log_tail
    );
    assert!(lines.lock().iter().any(|l| l == "old"));
    let pgid = listed.pid.unwrap() as i32;
    assert!(tm::app_pgids().contains(&pgid));

    tm::stop(&run.id, false).unwrap();
    // SAFETY: existence probe only.
    assert!(unsafe { libc::kill(-pgid, 0) } != 0, "process group gone");
    assert!(Path::new(&run.worktree).exists());
    tm::stop(&run.id, true).unwrap();
    assert!(!Path::new(&run.worktree).exists());
    assert!(!tm::list().iter().any(|r| r.id == run.id));

    // Nothing runnable → worktree only, no process.
    let idle = tm::run(&repo, &first, None, sink).unwrap();
    assert!(idle.pid.is_none());
    assert!(idle.log_tail.contains("未检测到"));
    tm::stop(&idle.id, true).unwrap();
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn restore_file_tracked_and_untracked() {
    let repo = temp_repo("restore-test");
    commit(&repo, "tracked.txt", "initial", "init");

    // Modify tracked file
    std::fs::write(repo.join("tracked.txt"), "modified").unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.join("tracked.txt")).unwrap(),
        "modified"
    );
    commands::restore_file(&repo, "tracked.txt").unwrap();
    assert_eq!(
        std::fs::read_to_string(repo.join("tracked.txt")).unwrap(),
        "initial"
    );

    // Create untracked file
    let untracked = repo.join("untracked.txt");
    std::fs::write(&untracked, "new").unwrap();
    assert!(untracked.exists());
    commands::restore_file(&repo, "untracked.txt").unwrap();
    assert!(!untracked.exists());

    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn list_branches_current_first_and_dedup() {
    let repo = temp_repo("branches-test");
    commit(&repo, "a.txt", "1", "init");

    git_ok(&repo, &["branch", "feature-a"]).unwrap();
    git_ok(&repo, &["branch", "feature-b"]).unwrap();
    git_ok(&repo, &["checkout", "feature-a"]).unwrap();

    let branches = commands::list_branches(&repo).unwrap();
    assert_eq!(branches[0], "feature-a");
    assert!(branches.contains(&"main".to_string()));
    assert!(branches.contains(&"feature-b".to_string()));

    std::fs::remove_dir_all(&repo).unwrap();
}
