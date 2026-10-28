//! [C] Worktree ↔ local base branch (main/master) operations: diff since fork,
//! rebase, two-way local sync, discard all changes. Purely local, never touches
//! remotes (docs/ARCHITECTURE.md §7).

use std::path::Path;

use super::cmd::git_ok;
use super::{history, status, worktree};
use crate::contracts::BaseSyncResult;

const NO_BASE: &str = "找不到基础分支（本地 main / master）";
const DETACHED: &str = "当前处于游离 HEAD，无法与基础分支同步";
const DIRTY: &str = "工作区有未提交的改动，请先提交或丢弃";

fn local_base(dir: &Path) -> Result<String, String> {
    history::local_base(dir).ok_or_else(|| NO_BASE.to_string())
}

fn head_branch(dir: &Path) -> Option<String> {
    git_ok(dir, &["symbolic-ref", "-q", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn operation_exists(dir: &Path, name: &str) -> Result<bool, String> {
    let path = git_ok(dir, &["rev-parse", "--git-path", name])?;
    Ok(dir.join(path.trim()).exists())
}

fn ensure_no_operation(dir: &Path) -> Result<(), String> {
    for name in [
        "rebase-merge",
        "rebase-apply",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "sequencer",
        "BISECT_LOG",
    ] {
        if operation_exists(dir, name)? {
            return Err(format!("已有 Git 操作正在进行（{name}），请先完成或中止"));
        }
    }
    Ok(())
}

fn ensure_clean(dir: &Path) -> Result<(), String> {
    // Unlike dirty_count, a failed status must not be mistaken for a clean tree.
    if !git_ok(
        dir,
        &["status", "--porcelain", "-z", "--untracked-files=all"],
    )?
    .is_empty()
    {
        return Err(DIRTY.to_string());
    }
    Ok(())
}

fn revision(dir: &Path, name: &str) -> Result<String, String> {
    git_ok(dir, &["rev-parse", "--verify", name]).map(|s| s.trim().to_string())
}

/// Preconditions shared by rebase/sync: clean, on a branch, not the base itself.
/// Returns `(base, branch)`.
fn guard(dir: &Path) -> Result<(String, String), String> {
    ensure_no_operation(dir)?;
    let base = local_base(dir)?;
    let branch = head_branch(dir).ok_or(DETACHED)?;
    if branch == base {
        return Err(format!("当前就是基础分支 {base}，无需同步"));
    }
    ensure_clean(dir)?;
    Ok((base, branch))
}

fn count(dir: &Path, range: &str) -> u32 {
    git_ok(dir, &["rev-list", "--count", range])
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

fn conflict_files(dir: &Path) -> Vec<String> {
    git_ok(dir, &["diff", "--name-only", "--diff-filter=U"])
        .map(|s| s.lines().map(str::to_string).collect())
        .unwrap_or_default()
}

/// `CONFLICT:` + newline-separated paths when conflicts exist, else the raw error.
fn conflict_error(files: Vec<String>, raw: String) -> String {
    if files.is_empty() {
        raw
    } else {
        format!("CONFLICT:\n{}", files.join("\n"))
    }
}

/// Patch of commits on HEAD since its merge-base with the base (`base...HEAD`).
pub fn diff_base(dir: &Path) -> Result<String, String> {
    let base = local_base(dir)?;
    let range = format!("{base}...HEAD");
    git_ok(dir, &["diff", "--no-color", &range]).map(history::cap)
}

/// Rebase the current branch onto the base; aborts on conflict.
pub fn rebase_onto_base(dir: &Path) -> Result<String, String> {
    let (base, _) = guard(dir)?;
    match git_ok(dir, &["rebase", &base]) {
        Ok(out) => Ok(out),
        Err(e) => {
            let files = conflict_files(dir);
            let error = conflict_error(files, e);
            // guard rejected pre-existing operations; abort only a rebase that
            // this invocation actually left in progress (not a rejected hook).
            if operation_exists(dir, "rebase-merge")? || operation_exists(dir, "rebase-apply")? {
                if let Err(abort) = git_ok(dir, &["rebase", "--abort"]) {
                    return Err(format!("{error}\n无法中止本次变基：{abort}"));
                }
            }
            Err(error)
        }
    }
}

/// Reset tracked files to HEAD and remove untracked, non-ignored files.
pub fn discard_all(dir: &Path) -> Result<(), String> {
    if status::has_head(dir) {
        git_ok(dir, &["reset", "--hard", "-q", "HEAD"])?;
    } else {
        // Unborn branch: nothing to reset to; just empty the index.
        let _ = git_ok(
            dir,
            &["rm", "-r", "-q", "--cached", "--ignore-unmatch", "."],
        );
    }
    // No `-x`: ignored files (node_modules, .env, …) survive.
    git_ok(dir, &["clean", "-f", "-d", "-q"])?;
    Ok(())
}

/// Restore only our own completed merge. Ref CAS protects newer commits; the
/// two-tree checkout refuses to overwrite edits instead of using reset --hard.
fn rollback_sync(dir: &Path, branch: &str, original: &str, merged: &str) -> Result<(), String> {
    if original == merged {
        return Ok(());
    }
    ensure_no_operation(dir)?;
    ensure_clean(dir)?;
    if head_branch(dir).as_deref() != Some(branch) || revision(dir, "HEAD")? != merged {
        return Err("当前分支已被其他操作修改，保留现有历史".to_string());
    }
    let full = format!("refs/heads/{branch}");
    git_ok(
        dir,
        &[
            "update-ref",
            "--no-deref",
            "-m",
            "base sync rollback",
            &full,
            original,
            merged,
        ],
    )?;
    if head_branch(dir).as_deref() != Some(branch) || revision(dir, "HEAD")? != original {
        return Err("分支引用已恢复，但工作区随后切换或历史发生变化；未改动索引/文件".to_string());
    }
    ensure_no_operation(dir)?;
    // Do not move HEAD again: a concurrent ref update after CAS must survive.
    // If checkout fails, retain every file/index change and report the recovery
    // boundary explicitly; the original branch tip has already been restored.
    git_ok(dir, &["read-tree", "-m", "-u", merged, original])
        .map_err(|e| format!("分支已恢复，但索引/工作区未能恢复（未强制覆盖）：{e}"))?;
    Ok(())
}

/// Merge base into the branch in `dir`, then fast-forward the local base to it.
pub fn sync_with_base(dir: &Path) -> Result<BaseSyncResult, String> {
    let (base, branch) = guard(dir)?;
    let original = revision(dir, "HEAD")?;
    let base_ref = format!("refs/heads/{base}");
    let base_head = revision(dir, &base_ref)?;
    let base_checkout = worktree::list_entries(dir)?
        .into_iter()
        .find(|e| !e.bare && e.branch.as_deref() == Some(base.as_str()));
    let needs_fast_forward = count(dir, &format!("{base_head}..{original}")) > 0;
    if needs_fast_forward {
        if let Some(e) = &base_checkout {
            let path = Path::new(&e.path);
            ensure_no_operation(path)
                .and_then(|_| ensure_clean(path))
                .map_err(|err| format!("无法快进 {base}：{err}"))?;
        }
    }
    let merged_from_base = count(dir, &format!("{original}..{base_head}"));
    if merged_from_base > 0 {
        if let Err(e) = git_ok(dir, &["merge", "--no-edit", &base_head]) {
            let error = conflict_error(conflict_files(dir), e);
            if operation_exists(dir, "MERGE_HEAD")? {
                if let Err(abort) = git_ok(dir, &["merge", "--abort"]) {
                    return Err(format!("{error}\n无法中止本次合并：{abort}"));
                }
            }
            return Err(error);
        }
    }
    let merged = revision(dir, "HEAD")?;
    let fast_forwarded = count(dir, &format!("{base_head}..{merged}"));
    let forward = (|| -> Result<(), String> {
        if fast_forwarded == 0 {
            return Ok(());
        }
        if revision(dir, &base_ref)? != base_head {
            return Err(format!("基础分支 {base} 已被其他操作修改"));
        }
        match &base_checkout {
            Some(e) => {
                let path = Path::new(&e.path);
                ensure_no_operation(path)?;
                ensure_clean(path)?;
                if head_branch(path).as_deref() != Some(base.as_str()) {
                    return Err(format!("基础工作区已切换分支：{}", e.path));
                }
                git_ok(path, &["merge", "--ff-only", &merged])?;
            }
            None => {
                git_ok(
                    dir,
                    &["update-ref", "--no-deref", &base_ref, &merged, &base_head],
                )?;
            }
        }
        Ok(())
    })();
    if let Err(error) = forward {
        let error = format!("无法快进 {base}：{error}");
        return match rollback_sync(dir, &branch, &original, &merged) {
            Ok(()) => Err(error),
            Err(rollback) => Err(format!(
                "{error}\n未能安全回滚本次同步：{rollback}\n同步前：{original}\n合并后：{merged}"
            )),
        };
    }
    Ok(BaseSyncResult {
        merged_from_base,
        fast_forwarded,
    })
}

#[cfg(test)]
mod atomic_tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Repo {
        root: PathBuf,
        base: PathBuf,
        feature: PathBuf,
    }

    impl Repo {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "omp-base-sync-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed),
            ));
            std::fs::create_dir(&root).unwrap();
            let base = root.join("base");
            let feature = root.join("feature");
            std::fs::create_dir(&base).unwrap();
            git_ok(
                &base,
                &["-c", "init.templateDir=", "init", "-q", "-b", "main"],
            )
            .unwrap();
            let hooks = root.join("hooks");
            std::fs::create_dir(&hooks).unwrap();
            for (key, value) in [
                ("user.name", "Base Sync Test"),
                ("user.email", "base-sync@example.invalid"),
                ("commit.gpgsign", "false"),
                ("merge.gpgsign", "false"),
                ("merge.autostash", "false"),
                ("rebase.autostash", "false"),
                ("core.hooksPath", hooks.to_str().unwrap()),
            ] {
                git_ok(&base, &["config", key, value]).unwrap();
            }
            commit(&base, "common.txt", "original\n");
            git_ok(
                &base,
                &[
                    "worktree",
                    "add",
                    "-q",
                    "-b",
                    "feature",
                    feature.to_str().unwrap(),
                ],
            )
            .unwrap();
            commit(&feature, "feature.txt", "feature\n");
            commit(&base, "base.txt", "base\n");
            Self {
                root,
                base,
                feature,
            }
        }

        fn conflict(&self) {
            commit(&self.base, "common.txt", "base edit\n");
            commit(&self.feature, "common.txt", "feature edit\n");
        }

        #[cfg(unix)]
        fn reject_base_update(&self, before_reject: &str) {
            use std::os::unix::fs::PermissionsExt;
            let hook = self.root.join("hooks/reference-transaction");
            std::fs::write(&hook, format!(
                "#!/bin/sh\n[ \"$1\" = prepared ] || exit 0\nwhile read old new ref; do\n  if [ \"$ref\" = refs/heads/main ]; then\n    {before_reject}\n    exit 1\n  fi\ndone\nexit 0\n"
            )).unwrap();
            std::fs::set_permissions(hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    impl Drop for Repo {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn commit(dir: &Path, file: &str, content: &str) {
        std::fs::write(dir.join(file), content).unwrap();
        git_ok(dir, &["add", "--", file]).unwrap();
        git_ok(dir, &["commit", "-q", "-m", file]).unwrap();
    }

    fn head(dir: &Path) -> String {
        revision(dir, "HEAD").unwrap()
    }

    fn index(dir: &Path) -> Vec<u8> {
        let path = git_ok(dir, &["rev-parse", "--git-path", "index"]).unwrap();
        std::fs::read(dir.join(path.trim())).unwrap()
    }

    fn assert_restored(repo: &Repo, original: &str, base: &str) {
        assert_eq!(head(&repo.feature), original);
        assert_eq!(revision(&repo.base, "refs/heads/main").unwrap(), base);
        ensure_clean(&repo.feature).unwrap();
        ensure_no_operation(&repo.feature).unwrap();
        assert!(!repo.feature.join("base.txt").exists());
        assert_eq!(
            std::fs::read_to_string(repo.feature.join("feature.txt")).unwrap(),
            "feature\n"
        );
    }

    #[test]
    fn dirty_base_checkout_is_rejected_before_feature_merge() {
        for dirty in ["tracked", "staged", "untracked"] {
            let repo = Repo::new();
            let original = head(&repo.feature);
            let base = head(&repo.base);
            let path = if dirty == "untracked" {
                "feature.txt"
            } else {
                "base.txt"
            };
            std::fs::write(repo.base.join(path), "user changes\n").unwrap();
            if dirty == "staged" {
                git_ok(&repo.base, &["add", "base.txt"]).unwrap();
            }
            let before_index = index(&repo.base);
            let before_status = git_ok(&repo.base, &["status", "--porcelain", "-z"]).unwrap();
            let error = sync_with_base(&repo.feature).expect_err("dirty base must fail");
            assert!(error.contains(DIRTY), "{error}");
            assert_restored(&repo, &original, &base);
            assert_eq!(index(&repo.base), before_index);
            assert_eq!(
                git_ok(&repo.base, &["status", "--porcelain", "-z"]).unwrap(),
                before_status
            );
            assert_eq!(
                std::fs::read_to_string(repo.base.join(path)).unwrap(),
                "user changes\n"
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn second_phase_ref_rejection_rolls_back_feature_merge() {
        let repo = Repo::new();
        let original = head(&repo.feature);
        let base = head(&repo.base);
        git_ok(&repo.base, &["switch", "-q", "-c", "parking"]).unwrap();
        repo.reject_base_update(":");
        let error = sync_with_base(&repo.feature).expect_err("reference hook must fail");
        assert!(error.contains("无法快进 main"), "{error}");
        assert!(!error.contains("未能安全回滚"), "{error}");
        assert_restored(&repo, &original, &base);
    }

    #[test]
    #[cfg(unix)]
    fn second_phase_checked_out_ref_rejection_rolls_back_feature_merge() {
        let repo = Repo::new();
        let original = head(&repo.feature);
        let base = head(&repo.base);
        repo.reject_base_update(":");
        let error = sync_with_base(&repo.feature).expect_err("reference hook must fail");
        assert!(error.contains("无法快进 main"), "{error}");
        assert!(!error.contains("未能安全回滚"), "{error}");
        assert_restored(&repo, &original, &base);
    }

    #[test]
    #[cfg(unix)]
    fn rollback_preserves_a_newer_user_commit() {
        let repo = Repo::new();
        let original = head(&repo.feature);
        git_ok(&repo.base, &["switch", "-q", "-c", "parking"]).unwrap();
        repo.reject_base_update("unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX; git -C \"$(dirname \"$0\")/../feature\" commit -q --allow-empty -m user-commit || exit 2");
        let error = sync_with_base(&repo.feature).expect_err("reference hook must fail");
        assert!(error.contains("未能安全回滚"), "{error}");
        assert_ne!(head(&repo.feature), original);
        assert_eq!(
            git_ok(&repo.feature, &["log", "-1", "--format=%s"])
                .unwrap()
                .trim(),
            "user-commit"
        );
        ensure_clean(&repo.feature).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn rollback_preserves_user_worktree_edits() {
        let repo = Repo::new();
        git_ok(&repo.base, &["switch", "-q", "-c", "parking"]).unwrap();
        repo.reject_base_update(
            "printf 'user changes\\n' > \"$(dirname \"$0\")/../feature/feature.txt\"",
        );
        let error = sync_with_base(&repo.feature).expect_err("reference hook must fail");
        assert!(error.contains("未能安全回滚"), "{error}");
        assert_eq!(
            std::fs::read_to_string(repo.feature.join("feature.txt")).unwrap(),
            "user changes\n"
        );
        assert!(repo.feature.join("base.txt").exists());
    }

    #[test]
    fn sync_conflict_aborts_only_its_own_merge() {
        let repo = Repo::new();
        repo.conflict();
        let original = head(&repo.feature);
        let error = sync_with_base(&repo.feature).expect_err("merge conflict must fail");
        assert!(error.starts_with("CONFLICT:\n"), "{error}");
        assert!(error.lines().any(|line| line == "common.txt"), "{error}");
        assert_eq!(head(&repo.feature), original);
        ensure_clean(&repo.feature).unwrap();
        ensure_no_operation(&repo.feature).unwrap();
    }

    #[test]
    fn rebase_conflict_aborts_only_its_own_rebase() {
        let repo = Repo::new();
        repo.conflict();
        let original = head(&repo.feature);
        let error = rebase_onto_base(&repo.feature).unwrap_err();
        assert!(error.starts_with("CONFLICT:\n"), "{error}");
        assert_eq!(head(&repo.feature), original);
        ensure_clean(&repo.feature).unwrap();
        ensure_no_operation(&repo.feature).unwrap();
    }

    #[test]
    fn pre_existing_clean_rebase_is_not_aborted() {
        let repo = Repo::new();
        repo.conflict();
        assert!(git_ok(&repo.feature, &["rebase", "main"]).is_err());
        git_ok(&repo.feature, &["checkout", "--ours", "--", "common.txt"]).unwrap();
        git_ok(&repo.feature, &["add", "common.txt"]).unwrap();
        ensure_clean(&repo.feature).unwrap();
        let original = head(&repo.feature);
        let before_index = index(&repo.feature);
        for error in [
            rebase_onto_base(&repo.feature).unwrap_err(),
            sync_with_base(&repo.feature).expect_err("existing rebase must fail"),
        ] {
            assert!(error.contains("已有 Git 操作"), "{error}");
        }
        assert_eq!(head(&repo.feature), original);
        assert_eq!(index(&repo.feature), before_index);
        assert!(
            operation_exists(&repo.feature, "rebase-merge").unwrap()
                || operation_exists(&repo.feature, "rebase-apply").unwrap()
        );
    }

    #[test]
    fn pre_existing_clean_merge_is_not_aborted() {
        let repo = Repo::new();
        git_ok(
            &repo.feature,
            &["merge", "--no-commit", "--no-ff", "-s", "ours", "main"],
        )
        .unwrap();
        ensure_clean(&repo.feature).unwrap();
        let original = head(&repo.feature);
        let merge_head = revision(&repo.feature, "MERGE_HEAD").unwrap();
        let before_index = index(&repo.feature);
        assert!(rebase_onto_base(&repo.feature)
            .unwrap_err()
            .contains("已有 Git 操作"));
        assert!(sync_with_base(&repo.feature)
            .err()
            .unwrap()
            .contains("已有 Git 操作"));
        assert_eq!(head(&repo.feature), original);
        assert_eq!(revision(&repo.feature, "MERGE_HEAD").unwrap(), merge_head);
        assert_eq!(index(&repo.feature), before_index);
    }

    #[test]
    fn successful_sync_preserves_public_result_counts() {
        for checked_out in [true, false] {
            let repo = Repo::new();
            if !checked_out {
                git_ok(&repo.base, &["switch", "-q", "-c", "parking"]).unwrap();
            }
            let result = sync_with_base(&repo.feature).unwrap();
            assert_eq!(result.merged_from_base, 1);
            assert_eq!(result.fast_forwarded, 2);
            assert_eq!(
                revision(&repo.base, "refs/heads/main").unwrap(),
                head(&repo.feature)
            );
            ensure_clean(&repo.feature).unwrap();
            if checked_out {
                ensure_clean(&repo.base).unwrap();
            }
        }
    }

    #[test]
    #[cfg(unix)]
    fn refused_rollback_ref_update_does_not_touch_index_or_files() {
        use std::os::unix::fs::PermissionsExt;
        let repo = Repo::new();
        let original = head(&repo.feature);
        git_ok(&repo.feature, &["merge", "--no-edit", "main"]).unwrap();
        let merged = head(&repo.feature);
        let before_index = index(&repo.feature);
        let hook = repo.root.join("hooks/reference-transaction");
        std::fs::write(&hook, "#!/bin/sh\n[ \"$1\" = prepared ] || exit 0\nwhile read old new ref; do\n  [ \"$ref\" != refs/heads/feature ] || exit 1\ndone\n").unwrap();
        std::fs::set_permissions(hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(rollback_sync(&repo.feature, "feature", &original, &merged).is_err());
        assert_eq!(head(&repo.feature), merged);
        assert_eq!(index(&repo.feature), before_index);
        assert_eq!(
            std::fs::read_to_string(repo.feature.join("base.txt")).unwrap(),
            "base\n"
        );
        ensure_clean(&repo.feature).unwrap();
    }
}
