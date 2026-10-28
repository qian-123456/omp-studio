// Boundary stub: only the symbols clipboard.rs names. Pure-fs functions under test never touch them.
pub use stub_macros::command;
pub struct AppHandle;
pub trait Manager { fn path(&self) -> P { P } }
impl Manager for AppHandle {}
pub struct P;
impl P { pub fn app_cache_dir(&self) -> Result<std::path::PathBuf, ()> { Err(()) } }
