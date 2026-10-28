//! Replay harness: imports the REAL repository modules by path (no copies).
#![allow(dead_code, unused_imports)]
#[path = "<repo>/src-tauri/src/contracts.rs"]
pub mod contracts;
pub mod todos {
    #[path = "<repo>/src-tauri/src/todos/store.rs"]
    pub mod store;
}
pub mod schedules {
    #[path = "<repo>/src-tauri/src/schedules/store.rs"]
    pub mod store;
}
pub mod backlog {
    #[path = "<repo>/src-tauri/src/backlog/store.rs"]
    pub mod store;
}
#[path = "<repo>/src-tauri/src/prompts.rs"]
pub mod prompts;
