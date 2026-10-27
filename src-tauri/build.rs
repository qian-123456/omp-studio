use std::path::Path;

fn main() {
    // The mobile web bundle is embedded from `mobile-dist`; the folder must
    // exist for cargo check/clippy/test before the frontend has been built.
    let dist = Path::new(env!("CARGO_MANIFEST_DIR")).join("mobile-dist");
    std::fs::create_dir_all(&dist).expect("create mobile-dist");
    println!("cargo:rerun-if-changed=mobile-dist");
    tauri_build::build()
}
