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
fn history_fork_point() {
    let repo = temp_repo("fork");
    let init = commit(&repo, "a.txt", "a\n", "init");
    // Base worktree (main itself): no fork line.
    let h = history::history(&repo, 10);
    assert_eq!(h.commits.len(), 1);
    assert_eq!(h.base, None);
    assert_eq!(h.fork_point, None);

    // A branch off `init` forks there; commits after it are its own.
    git_ok(&repo, &["checkout", "-q", "-b", "feat"]).unwrap();
    let own = commit(&repo, "a.txt", "b\n", "own");
    let h = history::history(&repo, 10);
    assert_eq!(h.base.as_deref(), Some("main"));
    assert_eq!(h.fork_point.as_deref(), Some(init.as_str()));
    assert_eq!(h.commits[0].sha, own);
    assert_eq!(h.commits[1].sha, init);

    // Detached HEAD still resolves a fork point.
    git_ok(&repo, &["checkout", "-q", "--detach"]).unwrap();
    let h = history::history(&repo, 10);
    assert_eq!(h.fork_point.as_deref(), Some(init.as_str()));

    // Fork point is not in the loaded page.
    for i in 0..3 {
        commit(&repo, "a.txt", &format!("{i}\n"), &format!("own{i}"));
    }
    let h = history::history(&repo, 2);
    assert_eq!(h.commits.len(), 2);
    assert_eq!(h.fork_point.as_deref(), Some(init.as_str()));
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn worktree_lifecycle_and_orphans() {
    let repo = temp_repo("wt");
    assert!(
        worktree::create(&repo, "x", None, None).is_err(),
        "no commits yet"
    );
    commit(&repo, "a.txt", "a\n", "init");

    let wt = worktree::create(&repo, "Feature One", None, None).unwrap();
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
    let wt2 = worktree::create(&wt_path, "two", None, None).unwrap();
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

    // Dirty worktree reports its change count and refuses removal without force.
    std::fs::write(wt_path.join("dirty.txt"), "x").unwrap();
    std::fs::write(wt_path.join("a.txt"), "changed\n").unwrap();
    assert_eq!(
        worktree::list(&repo, &[])
            .unwrap()
            .iter()
            .find(|w| w.path == wt.path)
            .unwrap()
            .dirty,
        2
    );
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
    let again = worktree::create(&repo, "two", None, None).unwrap();
    assert_eq!(again.branch.as_deref(), Some("omp/two"));
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn worktree_create_honors_branch_and_base() {
    let repo = temp_repo("wt-branch");
    let first = commit(&repo, "a.txt", "a\n", "init");
    git_ok(&repo, &["branch", "release-2"]).unwrap();
    commit(&repo, "b.txt", "b\n", "second");

    // An existing idle branch is checked out as-is (not forked from HEAD).
    let rel = worktree::create(&repo, "rel", Some("release-2"), None).unwrap();
    assert_eq!(rel.branch.as_deref(), Some("release-2"));
    assert_eq!(rel.head, first);
    assert!(!Path::new(&rel.path).join("b.txt").exists());

    // A new branch keeps its slash and forks from the chosen base.
    let feat = worktree::create(&repo, "feat", Some("feature/auth"), Some("release-2")).unwrap();
    assert_eq!(feat.branch.as_deref(), Some("feature/auth"));
    assert!(feat.path.ends_with(".worktrees/feat"));
    assert_eq!(feat.head, first);

    // Branches already checked out elsewhere (incl. the main checkout) are refused.
    assert!(worktree::create(&repo, "dup", Some("release-2"), None).is_err());
    assert!(worktree::create(&repo, "main-again", Some("main"), None).is_err());
    // Unknown base and invalid branch names are refused.
    assert!(worktree::create(&repo, "nobase", Some("x/y"), Some("no-such-ref")).is_err());
    assert!(worktree::create(&repo, "bad", Some("bad..name"), None).is_err());
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

#[test]
fn pending_diff_covers_everything_a_commit_would_record() {
    // Unborn repo: new files still show up with their content.
    let fresh = temp_repo("pending-unborn");
    std::fs::write(fresh.join("first.txt"), "hello\n").unwrap();
    let d = commands::pending_diff(&fresh).unwrap();
    assert!(d.contains("first.txt") && d.contains("+hello"), "{d}");
    std::fs::remove_dir_all(&fresh).unwrap();

    let repo = temp_repo("pending");
    commit(&repo, "a.txt", "a\n", "init");
    std::fs::write(repo.join("a.txt"), "a2\n").unwrap();
    git_ok(&repo, &["add", "a.txt"]).unwrap();
    std::fs::write(repo.join("new.txt"), "brand new\n").unwrap();

    let d = commands::pending_diff(&repo).unwrap();
    assert!(d.contains("+a2"), "staged edit missing: {d}");
    assert!(d.contains("+brand new"), "untracked content missing: {d}");
    // The real staging area is untouched: new.txt is still untracked.
    let st = git_ok(&repo, &["status", "--porcelain"]).unwrap();
    assert!(st.contains("?? new.txt"), "{st}");

    // Nothing pending → empty.
    git_ok(&repo, &["add", "-A"]).unwrap();
    git_ok(&repo, &["commit", "-q", "-m", "save"]).unwrap();
    assert!(commands::pending_diff(&repo).unwrap().trim().is_empty());
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn detailed_branch_listing_and_merge_preview() {
    let repo = temp_repo("branch-detailed");
    commit(
        &repo,
        "main.txt",
        "main content\n",
        "feat: initial commit on main",
    );

    // Create branch feat-1 and commit
    git_ok(&repo, &["checkout", "-b", "feat-1"]).unwrap();
    commit(&repo, "feat1.txt", "feat1\n", "feat: add feature 1");

    // Create branch feat-conflict and commit conflicting change
    git_ok(&repo, &["checkout", "main"]).unwrap();
    git_ok(&repo, &["checkout", "-b", "feat-conflict"]).unwrap();
    commit(
        &repo,
        "feat1.txt",
        "conflicting feat1\n",
        "feat: conflicting change",
    );

    git_ok(&repo, &["checkout", "main"]).unwrap();

    // 1. Test list_branches_detailed
    let branches = commands::list_branches_detailed(&repo).unwrap();
    assert!(branches.len() >= 3);
    let main_branch = branches.iter().find(|b| b.name == "main").unwrap();
    assert_eq!(main_branch.display_name, "main");
    assert!(!main_branch.is_remote);
    assert!(main_branch.is_current_worktree);
    assert_eq!(
        main_branch.last_commit_message.as_deref(),
        Some("feat: initial commit on main")
    );

    let feat1 = branches.iter().find(|b| b.name == "feat-1").unwrap();
    assert!(!feat1.is_remote);
    assert_eq!(
        feat1.last_commit_message.as_deref(),
        Some("feat: add feature 1")
    );

    // 2. Test merge_preview: feat-1 into main (should be clean)
    let preview_clean = commands::merge_preview(&repo, "main", "feat-1").unwrap();
    assert!(preview_clean.can_merge);
    assert!(!preview_clean.has_conflicts);
    assert_eq!(preview_clean.commits_ahead, 1);

    // 3. Test merge_preview: feat-conflict into feat-1 (should conflict on feat1.txt)
    let preview_conflict = commands::merge_preview(&repo, "feat-1", "feat-conflict").unwrap();
    assert!(!preview_conflict.can_merge);
    assert!(preview_conflict.has_conflicts);

    // 4. Test delete_branch
    git_ok(&repo, &["checkout", "-b", "temp-delete"]).unwrap();
    git_ok(&repo, &["checkout", "main"]).unwrap();
    assert!(commands::delete_branch(&repo, "temp-delete", false, true).is_ok());
    let after_delete = commands::list_branches_detailed(&repo).unwrap();
    assert!(!after_delete.iter().any(|b| b.name == "temp-delete"));

    // 5. Test get_pr_url fallback (no remote yet)
    let pr_info = commands::get_pr_url(&repo, "feat-1", Some("main")).unwrap();
    assert!(!pr_info.is_github);
    std::fs::remove_dir_all(&repo).unwrap();
}

/// Main repo on `main` with `a.txt`, plus a linked worktree on `omp/<name>`.
fn repo_with_worktree(tag: &str) -> (PathBuf, PathBuf) {
    let repo = temp_repo(tag);
    commit(&repo, "a.txt", "a\n", "init");
    let wt = worktree::create(&repo, tag, None, None).unwrap();
    (repo, PathBuf::from(wt.path))
}

fn head(dir: &Path) -> String {
    git_ok(dir, &["rev-parse", "HEAD"])
        .unwrap()
        .trim()
        .to_string()
}

#[test]
fn sync_with_base_merges_and_fast_forwards_checked_out_base() {
    let (repo, wt) = repo_with_worktree("sync");
    commit(&repo, "b.txt", "b\n", "main work");
    commit(&wt, "c.txt", "c\n", "wt work");

    let listed = worktree::list(&repo, &[]).unwrap();
    let info = listed.iter().find(|w| Path::new(&w.path) == wt).unwrap();
    assert_eq!((info.ahead, info.behind), (1, 1));
    let main_info = listed
        .iter()
        .find(|w| w.branch.as_deref() == Some("main"))
        .unwrap();
    assert_eq!((main_info.ahead, main_info.behind), (0, 0));

    let diff = base_sync::diff_base(&wt).unwrap();
    assert!(diff.contains("c.txt") && !diff.contains("b.txt"));

    let res = base_sync::sync_with_base(&wt).unwrap();
    assert_eq!(res.merged_from_base, 1);
    // The wt commit plus the merge commit.
    assert_eq!(res.fast_forwarded, 2);
    assert_eq!(head(&repo), head(&wt));
    assert!(repo.join("c.txt").exists() && wt.join("b.txt").exists());
    let info = worktree::list(&repo, &[])
        .unwrap()
        .into_iter()
        .find(|w| Path::new(&w.path) == wt)
        .unwrap();
    assert_eq!((info.ahead, info.behind), (0, 0));

    // Base itself and dirty worktrees are refused.
    assert!(base_sync::sync_with_base(&repo).is_err());
    std::fs::write(wt.join("dirty.txt"), "x").unwrap();
    assert!(base_sync::sync_with_base(&wt).is_err());
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn sync_with_base_updates_ref_when_base_not_checked_out() {
    let (repo, wt) = repo_with_worktree("syncref");
    git_ok(&repo, &["checkout", "-q", "-b", "parking"]).unwrap();
    commit(&wt, "c.txt", "c\n", "wt work");
    let res = base_sync::sync_with_base(&wt).unwrap();
    assert_eq!((res.merged_from_base, res.fast_forwarded), (0, 1));
    let main = git_ok(&repo, &["rev-parse", "refs/heads/main"]).unwrap();
    assert_eq!(main.trim(), head(&wt));
    std::fs::remove_dir_all(&repo).unwrap();
}

fn conflicting(tag: &str) -> (PathBuf, PathBuf) {
    let (repo, wt) = repo_with_worktree(tag);
    commit(&repo, "a.txt", "main\n", "main edit");
    commit(&wt, "a.txt", "wt\n", "wt edit");
    (repo, wt)
}

#[test]
fn sync_with_base_conflict_aborts_merge() {
    let (repo, wt) = conflicting("syncconf");
    let before = head(&wt);
    let err = base_sync::sync_with_base(&wt).unwrap_err();
    assert!(err.starts_with("CONFLICT:"), "{err}");
    assert!(err.lines().any(|l| l == "a.txt"), "{err}");
    assert!(status::summary(&wt).files.is_empty());
    assert!(git_ok(&wt, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_err());
    assert_eq!(head(&wt), before);
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn rebase_conflict_leaves_no_rebase_in_progress() {
    let (repo, wt) = conflicting("rebconf");
    let before = head(&wt);
    let err = base_sync::rebase_onto_base(&wt).unwrap_err();
    assert!(err.starts_with("CONFLICT:"), "{err}");
    for dir in ["rebase-merge", "rebase-apply"] {
        let p = git_ok(
            &wt,
            &["rev-parse", "--path-format=absolute", "--git-path", dir],
        )
        .unwrap();
        assert!(!Path::new(p.trim()).exists(), "{dir} left behind");
    }
    assert_eq!(head(&wt), before);
    assert!(status::summary(&wt).files.is_empty());
    std::fs::remove_dir_all(&repo).unwrap();
}

#[test]
fn discard_all_keeps_ignored_files() {
    let repo = temp_repo("discard");
    commit(
        &repo,
        ".gitignore",
        "ignored.txt\nnode_modules/\n",
        "ignore",
    );
    commit(&repo, "a.txt", "a\n", "init");
    std::fs::write(repo.join("a.txt"), "changed\n").unwrap();
    std::fs::write(repo.join("new.txt"), "new\n").unwrap();
    std::fs::create_dir_all(repo.join("sub")).unwrap();
    std::fs::write(repo.join("sub/x.txt"), "x\n").unwrap();
    std::fs::write(repo.join("ignored.txt"), "keep\n").unwrap();
    std::fs::create_dir_all(repo.join("node_modules")).unwrap();
    std::fs::write(repo.join("node_modules/m.js"), "m\n").unwrap();

    base_sync::discard_all(&repo).unwrap();
    assert_eq!(std::fs::read_to_string(repo.join("a.txt")).unwrap(), "a\n");
    assert!(!repo.join("new.txt").exists() && !repo.join("sub").exists());
    assert!(repo.join("ignored.txt").exists() && repo.join("node_modules/m.js").exists());
    assert!(status::summary(&repo).files.is_empty());
    std::fs::remove_dir_all(&repo).unwrap();
}
