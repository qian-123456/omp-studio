//! Static assets of the mobile web app, embedded at compile time and served
//! under `/static/{path}`. Add a row here when adding a file.

pub const ASSETS: &[(&str, &str, &str)] = &[
    (
        "css/app.css",
        "text/css; charset=utf-8",
        include_str!("../../mobile/css/app.css"),
    ),
    (
        "js/core.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/core.js"),
    ),
    (
        "js/settings-local.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/settings-local.js"),
    ),
    (
        "js/chat.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/chat.js"),
    ),
    (
        "js/request-stats.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/request-stats.js"),
    ),
    (
        "js/sketch.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/sketch.js"),
    ),
    (
        "js/nav-left.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/nav-left.js"),
    ),
    (
        "js/panel-files.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/panel-files.js"),
    ),
    (
        "js/panel-misc.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/panel-misc.js"),
    ),
    (
        "js/ideas.js",
        "text/javascript; charset=utf-8",
        include_str!("../../mobile/js/ideas.js"),
    ),
];

pub fn find(path: &str) -> Option<(&'static str, &'static str)> {
    ASSETS
        .iter()
        .find(|(p, _, _)| *p == path)
        .map(|(_, ct, body)| (*ct, *body))
}
