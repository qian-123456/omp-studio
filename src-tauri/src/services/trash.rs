//! Move a path to the OS Trash without going through Finder.
//!
//! `trash::delete` on macOS defaults to `DeleteMethod::Finder`, which drives
//! Finder via Apple Events: Finder shows its own Touch ID / password prompt
//! (behind our window, never focused) and fails outright on items it may not
//! read. `NSFileManager trashItemAtURL` runs in-process: no prompt, and the
//! item stays restorable from the Trash.

use std::path::Path;

pub fn move_to_trash(path: &Path) -> Result<(), trash::Error> {
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::default();
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete(path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(path)
    }
}
