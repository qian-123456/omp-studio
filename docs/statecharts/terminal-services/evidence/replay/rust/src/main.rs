#![allow(dead_code)]
mod paths { pub fn data_dir() -> std::path::PathBuf { std::env::temp_dir().join("ts-replay-data") } }
mod crate_shim {}
#[path = "<repo>/src-tauri/src/services/files.rs"] mod files;
#[path = "<repo>/src-tauri/src/services/clipboard.rs"] mod clipboard;

fn main() {
    use std::sync::{Arc, Barrier};
    let dir = std::env::temp_dir().join(format!("ts-replay-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();

    // --- 文本文件并发保存 (files::write_text, 与 write_text_file 命令同一函数) ---
    let target = dir.join("doc.md");
    files::write_text(&target, "old").unwrap();
    let (mut both_ok, mut one_err, mut mismatch, mut failed_content_landed) = (0, 0, 0, 0);
    let rounds = 300;
    for _ in 0..rounds {
        let a = "A".repeat(3 << 20);
        let b = "B".repeat(3 << 20);
        let bar = Arc::new(Barrier::new(2));
        let (t1, t2) = (target.clone(), target.clone());
        let (b1, b2) = (bar.clone(), bar.clone());
        let (a2, b_2) = (a.clone(), b.clone());
        let h1 = std::thread::spawn(move || { b1.wait(); files::write_text(&t1, &a2) });
        let h2 = std::thread::spawn(move || { b2.wait(); files::write_text(&t2, &b_2) });
        let (r1, r2) = (h1.join().unwrap(), h2.join().unwrap());
        let now = std::fs::read_to_string(&target).unwrap();
        match (&r1, &r2) {
            (Ok(_), Ok(_)) => both_ok += 1,
            _ => {
                one_err += 1;
                if r1.is_ok() && r2.is_err() && now != a { mismatch += 1; }
                if r2.is_ok() && r1.is_err() && now != b { mismatch += 1; }
                if (r1.is_err() && now == a) || (r2.is_err() && now == b) { failed_content_landed += 1; }
            }
        }
    }
    println!("write_text rounds={rounds} both_ok={both_ok} one_failed={one_err} ok_but_other_content_in_file={mismatch} failed_call_content_in_file={failed_content_landed}");

    // --- 剪贴板文件缓存重名 (clipboard::save_clipboard_file_internal) ---
    use base64::Engine as _;
    let enc = |s: &[u8]| base64::engine::general_purpose::STANDARD.encode(s);
    let (mut same_path, mut lost_first) = (0, 0);
    let n = 2000;
    for _ in 0..n {
        let p1 = clipboard::save_clipboard_file_internal(&dir, &enc(b"first"), Some("image.png")).unwrap();
        let p2 = clipboard::save_clipboard_file_internal(&dir, &enc(b"second"), Some("image.png")).unwrap();
        if p1 == p2 {
            same_path += 1;
            if std::fs::read(&p1).unwrap() != b"first" { lost_first += 1; }
        }
    }
    println!("clipboard back-to-back pairs={n} same_path={same_path} first_attachment_bytes_replaced={lost_first}");
    let _ = std::fs::remove_dir_all(&dir);
}
