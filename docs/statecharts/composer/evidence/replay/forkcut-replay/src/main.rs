// Replay: parent transcript [plan on, answer, plan off] forked by the real forkcut::truncate (fork_session path).
#![allow(dead_code)]
#[path = "<repo>/src-tauri/src/rpc/forkcut.rs"]
mod forkcut;

fn main() {
    let dir = std::env::temp_dir().join(format!("forkcut-replay-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let src = dir.join("parent.jsonl");
    let lines = [
        r#"{"type":"session","id":"p"}"#,
        r#"{"type":"custom","id":"e1","customType":"ompws-plan-state","data":{"enabled":true,"version":0,"phase":"planning"}}"#,
        r#"{"type":"message","id":"u1","message":{"role":"user","content":"plan it"}}"#,
        r#"{"type":"message","id":"a1","message":{"role":"assistant","content":[{"type":"text","text":"plan ready"}],"stopReason":"stop"}}"#,
        r#"{"type":"custom","id":"e2","customType":"ompws-plan-state","data":{"enabled":false,"version":0,"phase":"planning"}}"#,
    ];
    std::fs::write(&src, format!("{}\n", lines.join("\n"))).unwrap();
    let out = forkcut::truncate(src.to_str().unwrap(), forkcut::Cut::LastCompleteTurn, "replay").unwrap();
    let path = out.expect("a trailing entry is cut, so a copy is written");
    print!("{}", std::fs::read_to_string(&path).unwrap());
}
