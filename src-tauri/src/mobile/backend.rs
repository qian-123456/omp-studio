//! What the mobile HTTP server needs from the rest of the app. Abstracted so
//! the router can be tested without a Tauri runtime.

use std::future::Future;

use tokio::sync::broadcast;

use crate::contracts::{PendingUiRequest, SessionMeta, Todo};
use crate::state::{AppEvent, AppState};

pub trait Backend: Send + Sync + 'static {
    fn sessions(&self) -> impl Future<Output = Vec<SessionMeta>> + Send;
    fn session(&self, id: &str) -> impl Future<Output = Option<SessionMeta>> + Send;
    fn todos(&self) -> impl Future<Output = Vec<Todo>> + Send;
    fn todo_act(&self, id: &str, action: &str) -> impl Future<Output = Result<(), String>> + Send;
    fn pending_ui(&self, id: &str) -> impl Future<Output = Vec<PendingUiRequest>> + Send;
    fn ui_respond(
        &self,
        id: &str,
        response: serde_json::Value,
    ) -> impl Future<Output = Result<(), String>> + Send;
    fn send_prompt(&self, id: &str, text: &str) -> impl Future<Output = Result<(), String>> + Send;
    fn resume(&self, id: &str) -> impl Future<Output = Result<serde_json::Value, String>> + Send;
    fn subscribe(&self) -> broadcast::Receiver<AppEvent>;
}

/// Production backend: delegates to the §9 cross-module APIs.
pub struct AppBackend(pub AppState);

impl Backend for AppBackend {
    async fn sessions(&self) -> Vec<SessionMeta> {
        crate::catalog::list(&self.0).await
    }
    async fn session(&self, id: &str) -> Option<SessionMeta> {
        crate::catalog::get(&self.0, id).await
    }
    async fn todos(&self) -> Vec<Todo> {
        crate::todos::list(&self.0, false).await
    }
    async fn todo_act(&self, id: &str, action: &str) -> Result<(), String> {
        crate::todos::act(&self.0, id, action).await
    }
    async fn pending_ui(&self, id: &str) -> Vec<PendingUiRequest> {
        crate::rpc::pending_ui(&self.0, id).await
    }
    async fn ui_respond(&self, id: &str, response: serde_json::Value) -> Result<(), String> {
        crate::rpc::ui_respond(&self.0, id, response).await
    }
    async fn send_prompt(&self, id: &str, text: &str) -> Result<(), String> {
        crate::rpc::send_prompt(&self.0, id, text).await
    }
    async fn resume(&self, id: &str) -> Result<serde_json::Value, String> {
        let info = crate::rpc::ensure_live(&self.0, id, None).await?;
        serde_json::to_value(info).map_err(|e| e.to_string())
    }
    fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.0.bus.subscribe()
    }
}
