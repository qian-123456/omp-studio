// 直接编入被审计的真实源文件 (只读), 不复制实现。
#[path = "<repo>/src-tauri/src/contracts.rs"]
pub mod contracts;
pub mod catalog {
    #[path = "<repo>/src-tauri/src/catalog/parse.rs"]
    pub mod parse;
    #[path = "<repo>/src-tauri/src/catalog/status.rs"]
    pub mod status;
    #[path = "<repo>/src-tauri/src/catalog/external.rs"]
    pub mod external;
}
