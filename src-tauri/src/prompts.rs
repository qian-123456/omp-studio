//! LLM prompt templates (src-tauri/prompts/*.md) and a tiny renderer. [LEAD]
//! Syntax: `{{name}}` substitution and non-nested `{{#if name}}...{{/if}}` blocks
//! (kept when the variable is present and non-empty).
#![allow(dead_code)]

use std::collections::HashMap;

pub const SIDE_CHAT: &str = include_str!("../prompts/side_chat.md");
pub const CONTEXT_ROUTE: &str = include_str!("../prompts/context_route.md");
pub const SUMMARY: &str = include_str!("../prompts/summary.md");
pub const SUPERVISOR: &str = include_str!("../prompts/supervisor.md");
pub const DIAGNOSE: &str = include_str!("../prompts/diagnose.md");
pub const BACKLOG_DISPATCH: &str = include_str!("../prompts/backlog_dispatch.md");

pub fn render(template: &str, vars: &HashMap<&str, String>) -> String {
    let non_empty = |k: &str| vars.get(k).is_some_and(|v| !v.trim().is_empty());
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{#if ") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 6..];
        let Some(name_end) = after.find("}}") else {
            rest = &rest[start..];
            break;
        };
        let name = after[..name_end].trim();
        let body_start = &after[name_end + 2..];
        let Some(end) = body_start.find("{{/if}}") else {
            rest = &rest[start..];
            break;
        };
        if non_empty(name) {
            out.push_str(&body_start[..end]);
        }
        rest = &body_start[end + 7..];
    }
    out.push_str(rest);
    let mut text = out;
    for (k, v) in vars {
        text = text.replace(&format!("{{{{{k}}}}}"), v);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_vars_and_conditionals() {
        let t = "A {{x}}{{#if y}} Y={{y}}{{/if}}{{#if z}} Z{{/if}} end";
        let mut v = HashMap::new();
        v.insert("x", "1".to_string());
        v.insert("y", "2".to_string());
        v.insert("z", "  ".to_string());
        assert_eq!(render(t, &v), "A 1 Y=2 end");
    }

    #[test]
    fn all_templates_load() {
        for t in [
            SIDE_CHAT,
            CONTEXT_ROUTE,
            SUMMARY,
            SUPERVISOR,
            DIAGNOSE,
            BACKLOG_DISPATCH,
        ] {
            assert!(t.len() > 50);
        }
    }
}
