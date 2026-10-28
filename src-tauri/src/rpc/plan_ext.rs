//! Plan-mode extension: bundled source + install-at-startup.
//!
//! OMP's own `/plan` lives in the interactive TUI only, so app RPC sessions load
//! this extension (`omp -e <path>`) to get a read-only planning phase, a plan file
//! under `local://`, and approval actions the review panel drives via `/plan-action`.

/// Bundled extension source (repo `extension/omp-workspace-plan.ts`).
pub const EXT_SOURCE: &str = include_str!("../../../extension/omp-workspace-plan.ts");

/// Install the bundled extension into `~/.omp-workspace/extension/` (startup).
pub fn install() {
    if let Err(e) =
        super::privacy_ext::write_if_changed(&crate::paths::plan_extension_path(), EXT_SOURCE)
    {
        tracing::warn!("install plan-mode extension: {e}");
    }
}
