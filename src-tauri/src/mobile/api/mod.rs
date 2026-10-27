//! Mobile JSON API split by feature slice. Each slice exposes `routes()`
//! returning routes relative to `/api` (auth middleware is applied by the
//! parent router). Slices reach app state via `Backend::app_state()`.

use std::sync::Arc;

use axum::Router;

use super::backend::Backend;
use super::server::Ctx;

pub mod chat;
pub mod draft;
pub mod files;
pub mod ideas;
pub mod left;
pub mod media;
pub mod misc;
pub mod push;

pub fn routes<B: Backend>() -> Router<Arc<Ctx<B>>> {
    Router::new()
        .merge(chat::routes::<B>())
        .merge(left::routes::<B>())
        .merge(files::routes::<B>())
        .merge(misc::routes::<B>())
        .merge(ideas::routes::<B>())
        .merge(push::routes::<B>())
        .merge(media::routes::<B>())
}
