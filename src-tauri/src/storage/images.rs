//! Image garbage collection for the two app image dirs (the durable
//! `~/.omp-workspace/images/` and the legacy clip cache `ompws-clip`).
//!
//! An image is deletable only when it is older than [`MIN_AGE`] AND its file
//! name appears nowhere in: backlog/idea rows, scheduled tasks, unsent
//! drafts (supplied by the frontend), or any omp session transcript.

use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use regex::bytes::RegexBuilder;
use serde::Serialize;

use super::fsutil;

/// Images younger than this are never collected.
pub const MIN_AGE: Duration = Duration::from_secs(30 * 24 * 3600);

#[derive(Debug, Clone)]
pub struct Candidate {
    pub path: PathBuf,
    pub name: String,
    pub bytes: u64,
    pub modified: SystemTime,
}

#[derive(Debug, Default, Clone)]
pub struct GcPlan {
    /// Old and unreferenced: safe to delete.
    pub unreferenced: Vec<Candidate>,
    /// Old but still referenced somewhere: kept.
    pub referenced: usize,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GcSummary {
    pub count: usize,
    pub bytes: u64,
}

impl GcPlan {
    pub fn summary(&self) -> GcSummary {
        GcSummary {
            count: self.unreferenced.len(),
            bytes: self.unreferenced.iter().map(|c| c.bytes).sum(),
        }
    }
}

/// Usage of the image dirs (all files, regardless of age).
pub fn usage(roots: &[PathBuf]) -> GcSummary {
    let mut out = GcSummary::default();
    for root in roots {
        for f in list_files(root) {
            out.count += 1;
            out.bytes += f.bytes;
        }
    }
    out
}

fn list_files(root: &Path) -> Vec<Candidate> {
    let mut out = Vec::new();
    walk(root, &mut |path, md| {
        if md.is_file() {
            out.push(Candidate {
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                path: path.to_path_buf(),
                bytes: md.len(),
                modified: md.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            });
        }
    });
    out
}

/// Depth-first walk that never follows symlinks.
fn walk(dir: &Path, visit: &mut dyn FnMut(&Path, &fs::Metadata)) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        let Ok(md) = fs::symlink_metadata(&p) else {
            continue;
        };
        if md.is_dir() {
            walk(&p, visit);
        } else {
            visit(&p, &md);
        }
    }
}

/// Every `*.jsonl` under `dir` (session transcripts, including subagent logs).
pub fn transcript_files(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    let mut out = Vec::new();
    walk(dir, &mut |path, md| {
        if md.is_file() && path.extension().and_then(|x| x.to_str()) == Some("jsonl") {
            out.push((
                path.to_path_buf(),
                md.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            ));
        }
    });
    out
}

/// Build the deletion plan. `texts` are DB/draft strings to scan;
/// `transcripts` are session files to scan (skipped when older than every
/// candidate: such a transcript cannot mention an image that did not exist yet).
pub fn plan(
    roots: &[PathBuf],
    now: SystemTime,
    min_age: Duration,
    texts: &[String],
    transcripts: &[(PathBuf, SystemTime)],
) -> GcPlan {
    let mut old: Vec<Candidate> = roots
        .iter()
        .flat_map(|r| list_files(r))
        .filter(|c| {
            now.duration_since(c.modified)
                .map(|age| age >= min_age)
                .unwrap_or(false)
        })
        .collect();
    if old.is_empty() {
        return GcPlan::default();
    }
    // Dedupe by name for matching only; files keep their own entries.
    let names: Vec<String> = old
        .iter()
        .map(|c| c.name.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let pattern = names
        .iter()
        .map(|n| regex::escape(n))
        .collect::<Vec<_>>()
        .join("|");
    let Ok(re) = RegexBuilder::new(&pattern)
        .size_limit(256 * 1024 * 1024)
        .build()
    else {
        // Cannot prove anything is unreferenced: keep everything.
        return GcPlan {
            unreferenced: Vec::new(),
            referenced: old.len(),
        };
    };
    let mut hit: HashSet<String> = HashSet::new();
    for t in texts {
        for m in re.find_iter(t.as_bytes()) {
            hit.insert(String::from_utf8_lossy(m.as_bytes()).to_string());
        }
    }
    let oldest = old.iter().map(|c| c.modified).min();
    for (path, mtime) in transcripts {
        if hit.len() == names.len() {
            break;
        }
        if oldest.is_some_and(|o| *mtime < o) {
            continue;
        }
        scan_file(path, &re, &mut hit);
    }
    let before = old.len();
    old.retain(|c| !hit.contains(&c.name));
    GcPlan {
        referenced: before - old.len(),
        unreferenced: old,
    }
}

/// Chunked scan with overlap so a name straddling a chunk edge still matches.
fn scan_file(path: &Path, re: &regex::bytes::Regex, hit: &mut HashSet<String>) {
    const CHUNK: usize = 8 * 1024 * 1024;
    const OVERLAP: usize = 512;
    let Ok(mut f) = fs::File::open(path) else {
        return;
    };
    let mut buf: Vec<u8> = Vec::with_capacity(CHUNK + OVERLAP);
    loop {
        let keep = buf.len().min(OVERLAP);
        if keep > 0 {
            let start = buf.len() - keep;
            buf.copy_within(start.., 0);
        }
        buf.truncate(keep);
        let read = match (&mut f).take(CHUNK as u64).read_to_end(&mut buf) {
            Ok(n) => n,
            Err(_) => return,
        };
        for m in re.find_iter(&buf) {
            hit.insert(String::from_utf8_lossy(m.as_bytes()).to_string());
        }
        if read == 0 {
            return;
        }
    }
}

/// Delete the planned files; each path must still live under one of `roots`.
pub fn apply(plan: &GcPlan, roots: &[PathBuf]) -> GcSummary {
    let mut out = GcSummary::default();
    for c in &plan.unreferenced {
        if !roots.iter().any(|r| c.path.starts_with(r)) {
            continue;
        }
        if fsutil::remove_path(&c.path).is_ok() {
            out.count += 1;
            out.bytes += c.bytes;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::fsutil::scratch_dir;

    fn set_age(path: &Path, days: u64) {
        let t = SystemTime::now() - Duration::from_secs(days * 24 * 3600);
        let f = fs::File::options().write(true).open(path).unwrap();
        f.set_modified(t).unwrap();
    }

    fn write_img(dir: &Path, name: &str, days: u64) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, vec![0u8; 100]).unwrap();
        set_age(&p, days);
        p
    }

    #[test]
    fn collects_only_old_unreferenced() {
        let root = scratch_dir("gc-basic");
        write_img(&root, "old-free.png", 60);
        write_img(&root, "new-free.png", 5);
        write_img(&root, "old-text.png", 60);
        write_img(&root, "old-draft.png", 60);
        write_img(&root, "old-session.png", 60);
        let sess = scratch_dir("gc-basic-sessions");
        let jsonl = sess.join("a.jsonl");
        fs::write(
            &jsonl,
            format!("{{\"p\":\"{}/old-session.png\"}}", root.display()),
        )
        .unwrap();
        let texts = vec![
            "see old-text.png here".to_string(),
            "draft old-draft.png".to_string(),
        ];
        let transcripts = transcript_files(&sess);
        let plan = plan(
            std::slice::from_ref(&root),
            SystemTime::now(),
            MIN_AGE,
            &texts,
            &transcripts,
        );
        let names: Vec<_> = plan.unreferenced.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["old-free.png"]);
        assert_eq!(plan.referenced, 3);
        let done = apply(&plan, std::slice::from_ref(&root));
        assert_eq!(
            done,
            GcSummary {
                count: 1,
                bytes: 100
            }
        );
        assert!(!root.join("old-free.png").exists());
        assert!(root.join("new-free.png").exists());
        assert!(root.join("old-session.png").exists());
    }

    #[test]
    fn transcript_match_across_chunk_edge() {
        let root = scratch_dir("gc-edge");
        write_img(&root, "edge-image-name.png", 60);
        let sess = scratch_dir("gc-edge-sessions");
        let mut body = vec![b'x'; 8 * 1024 * 1024 - 5];
        body.extend_from_slice(b"edge-image-name.png");
        fs::write(sess.join("b.jsonl"), body).unwrap();
        let plan = plan(
            &[root],
            SystemTime::now(),
            MIN_AGE,
            &[],
            &transcript_files(&sess),
        );
        assert!(plan.unreferenced.is_empty());
        assert_eq!(plan.referenced, 1);
    }

    #[test]
    fn apply_refuses_paths_outside_roots() {
        let root = scratch_dir("gc-root");
        let other = scratch_dir("gc-other");
        let victim = write_img(&other, "victim.png", 60);
        let plan = GcPlan {
            unreferenced: vec![Candidate {
                path: victim.clone(),
                name: "victim.png".into(),
                bytes: 100,
                modified: SystemTime::UNIX_EPOCH,
            }],
            referenced: 0,
        };
        assert_eq!(apply(&plan, &[root]).count, 0);
        assert!(victim.exists());
    }
}
