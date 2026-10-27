//! What the mobile HTTP server needs from the rest of the app. Abstracted so
//! the router can be tested without a Tauri runtime.

use std::future::Future;

use tokio::sync::broadcast;

use crate::contracts::{LiveSessionInfo, PendingUiRequest, SessionMeta, StartOpts, Todo};
use crate::state::{AppEvent, AppState};

/// One user prompt to deliver to a live omp process. `selection` is the model
/// / thinking choice a draft collected before its process existed.
pub struct PromptDelivery {
    pub message: String,
    pub images: Vec<serde_json::Value>,
    pub behavior: Option<String>,
    pub selection: super::api::draft::Selection,
}

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
    /// Start a fresh omp process (first prompt / prewarm of a draft).
    fn start_process(
        &self,
        opts: &StartOpts,
    ) -> impl Future<Output = Result<LiveSessionInfo, String>> + Send;
    /// Apply the draft selection, then send the prompt to the live session.
    /// Resolves to whether the session was already streaming.
    fn deliver_prompt(
        &self,
        id: &str,
        delivery: PromptDelivery,
    ) -> impl Future<Output = Result<bool, String>> + Send;
    /// POST one encrypted message to a push service; resolves to its HTTP status.
    fn push_http(
        &self,
        req: super::push::PushHttp,
    ) -> impl Future<Output = Result<u16, String>> + Send;
    fn subscribe(&self) -> broadcast::Receiver<AppEvent>;
    /// Full app state for feature slices under `api/`. `None` in test mocks.
    fn app_state(&self) -> Option<&AppState> {
        None
    }
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
    async fn start_process(&self, opts: &StartOpts) -> Result<LiveSessionInfo, String> {
        crate::rpc::start(&self.0, opts).await
    }
    async fn deliver_prompt(&self, id: &str, delivery: PromptDelivery) -> Result<bool, String> {
        super::api::chat::deliver_prompt(&self.0, id, delivery)
            .await
            .map_err(|e| e.1)
    }
    async fn push_http(&self, req: super::push::PushHttp) -> Result<u16, String> {
        super::push::http_post(req).await
    }
    fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.0.bus.subscribe()
    }
    fn app_state(&self) -> Option<&AppState> {
        Some(&self.0)
    }
}
