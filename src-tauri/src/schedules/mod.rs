//! Scheduled tasks module (Codex "Scheduled"-style automations).

pub mod commands;
pub mod runner;
pub mod scheduler;
pub mod store;
#[cfg(test)]
mod tests;

use crate::state::AppState;

pub fn init(state: AppState) {
    scheduler::start(state);
}
