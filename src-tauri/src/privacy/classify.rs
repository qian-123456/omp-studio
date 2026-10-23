//! Value classification, label sanitizing and whole-word matching (§4 [P]).

// OnceLock (not LazyLock): crate MSRV is 1.77.
use std::sync::OnceLock;

use regex::Regex;

use crate::contracts::SecretRisk;

pub const MAX_VALUE_CHARS: usize = 4096;
pub const MAX_LABEL_CHARS: usize = 24;

/// Built-in common words: values matching these (case-insensitive) are `risky`.
const COMMON_WORDS: &[&str] = &[
    // usernames / roles
    "root",
    "admin",
    "administrator",
    "user",
    "users",
    "ubuntu",
    "test",
    "tester",
    "guest",
    "default",
    "demo",
    "dev",
    "developer",
    "debian",
    "centos",
    "ec2-user",
    "postgres",
    "mysql",
    "oracle",
    "www-data",
    "nobody",
    "operator",
    "support",
    "service",
    "system",
    "master",
    "main",
    "public",
    "private",
    "password",
    "passwd",
    "secret",
    "token",
    "login",
    "username",
    // hosts / addresses
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "255.255.255.255",
    "192.168.0.1",
    "192.168.1.1",
    "10.0.0.1",
    "example.com",
    "example.org",
    "localdomain",
    "host",
    "server",
    "database",
    "local",
    "remote",
    "origin",
    "staging",
    "production",
    "prod",
    // common English words
    "the",
    "and",
    "that",
    "have",
    "for",
    "not",
    "with",
    "you",
    "this",
    "but",
    "his",
    "from",
    "they",
    "say",
    "her",
    "she",
    "will",
    "one",
    "all",
    "would",
    "there",
    "their",
    "what",
    "out",
    "about",
    "who",
    "get",
    "which",
    "when",
    "make",
    "can",
    "like",
    "time",
    "just",
    "him",
    "know",
    "take",
    "people",
    "into",
    "year",
    "your",
    "good",
    "some",
    "could",
    "them",
    "see",
    "other",
    "than",
    "then",
    "now",
    "look",
    "only",
    "come",
    "its",
    "over",
    "think",
    "also",
    "back",
    "after",
    "use",
    "two",
    "how",
    "our",
    "work",
    "first",
    "well",
    "way",
    "even",
    "new",
    "want",
    "because",
    "any",
    "these",
    "give",
    "day",
    "most",
    "data",
    "file",
    "files",
    "name",
    "value",
    "values",
    "true",
    "false",
    "null",
    "none",
    "undefined",
    "error",
    "string",
    "number",
    "object",
    "array",
    "list",
    "item",
    "items",
    "index",
    "key",
    "keys",
    "config",
    "settings",
    "option",
    "options",
    "app",
    "application",
    "code",
    "build",
    "run",
    "start",
    "stop",
    "open",
    "close",
    "read",
    "write",
    "update",
    "delete",
    "create",
    "remove",
    "add",
    "set",
    "check",
    "find",
    "search",
    "show",
    "hide",
    "send",
    "save",
    "load",
    "copy",
    "move",
    "edit",
    "view",
    "page",
    "home",
    "help",
    "info",
    "message",
    "text",
    "line",
    "path",
    "port",
    "http",
    "https",
    "url",
    "link",
    "email",
    "mail",
    "phone",
    "address",
    "account",
    "project",
    "workspace",
    "session",
    "client",
    "agent",
    "model",
    "task",
    "tasks",
    "note",
    "notes",
    "branch",
    "commit",
    "merge",
    "release",
    "version",
    "hello",
    "world",
    "foo",
    "bar",
    "baz",
    "qux",
    "abc",
    "xyz",
    "123",
    "1234",
    "12345",
    "123456",
    "qwerty",
    "letmein",
    "changeme",
    "welcome",
    "monkey",
    "dragon",
    "football",
    "iloveyou",
    "sunshine",
    "shadow",
];

/// Classification failure / note codes surfaced to the frontend.
pub const TOO_SHORT: &str = "TOO_SHORT";
pub const INVALID_VALUE: &str = "INVALID_VALUE";
pub const SHORT: &str = "SHORT";
pub const COMMON: &str = "COMMON";
pub const LABEL_CONTAINS_VALUE: &str = "LABEL_CONTAINS_VALUE";

/// Classify `value`: `Err(code)` for rejected values, else risk + optional reason.
pub fn classify(value: &str) -> Result<(SecretRisk, Option<&'static str>), &'static str> {
    let chars = value.chars().count();
    if value.contains('\n')
        || value.contains('\r')
        || chars > MAX_VALUE_CHARS
        || value.trim().is_empty()
    {
        return Err(INVALID_VALUE);
    }
    if chars <= 2 {
        return Err(TOO_SHORT);
    }
    let lower = value.to_lowercase();
    if COMMON_WORDS.iter().any(|w| *w == lower) {
        return Ok((SecretRisk::Risky, Some(COMMON)));
    }
    if chars <= 7 {
        return Ok((SecretRisk::Risky, Some(SHORT)));
    }
    Ok((SecretRisk::Safe, None))
}

fn ws_run() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\s+").expect("ws regex"))
}

fn label_drop() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[^\p{Han}A-Za-z0-9_]").expect("label regex"))
}

/// Sanitize a user label. `Ok(None)` = no label; `Err(LABEL_CONTAINS_VALUE)` when
/// the raw or sanitized label contains the value (case-insensitive).
pub fn sanitize_label(raw: &str, value: &str) -> Result<Option<String>, &'static str> {
    let underscored = ws_run().replace_all(raw.trim(), "_");
    let kept = label_drop().replace_all(&underscored, "");
    let trimmed: String = kept
        .trim_matches('_')
        .chars()
        .take(MAX_LABEL_CHARS)
        .collect();
    let trimmed = trimmed.trim_end_matches('_').to_string();
    let needle = value.to_lowercase();
    if !needle.is_empty()
        && (raw.to_lowercase().contains(&needle) || trimmed.to_lowercase().contains(&needle))
    {
        return Err(LABEL_CONTAINS_VALUE);
    }
    Ok((!trimmed.is_empty()).then_some(trimmed))
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Count non-overlapping occurrences of `value` in `text` that are not
/// preceded/followed by `[A-Za-z0-9_]`.
pub fn count_whole_word(text: &str, value: &str) -> u32 {
    if value.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut from = 0;
    while let Some(pos) = text[from..].find(value) {
        let start = from + pos;
        let end = start + value.len();
        let before_ok = text[..start]
            .chars()
            .next_back()
            .map_or(true, |c| !is_word_char(c));
        let after_ok = text[end..]
            .chars()
            .next()
            .map_or(true, |c| !is_word_char(c));
        if before_ok && after_ok {
            count += 1;
            from = end;
        } else {
            from = start + text[start..].chars().next().map_or(1, char::len_utf8);
        }
    }
    count
}

/// Escape a literal for a JS (`u`-flag safe) / Rust regex: only syntax chars and `/`.
pub fn escape_regex(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for c in value.chars() {
        if matches!(
            c,
            '\\' | '^'
                | '$'
                | '.'
                | '|'
                | '?'
                | '*'
                | '+'
                | '('
                | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | '/'
        ) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Whole-word regex used for `risky` entries in OMP's native secrets.yml.
pub fn whole_word_regex(value: &str) -> String {
    format!("(?<![A-Za-z0-9_]){}(?![A-Za-z0-9_])", escape_regex(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_label_rules() {
        assert_eq!(
            sanitize_label("  prod  db-pass! ", "x").unwrap(),
            Some("prod_dbpass".into())
        );
        assert_eq!(
            sanitize_label("服务器 密码", "x").unwrap(),
            Some("服务器_密码".into())
        );
        assert_eq!(sanitize_label("__!!__", "x").unwrap(), None);
        assert_eq!(sanitize_label("", "x").unwrap(), None);
        let long = "a".repeat(40);
        assert_eq!(
            sanitize_label(&long, "zzz")
                .unwrap()
                .unwrap()
                .chars()
                .count(),
            24
        );
        assert_eq!(
            sanitize_label("my Hunter2 pw", "hunter2"),
            Err(LABEL_CONTAINS_VALUE)
        );
        // Sanitized form contains the value even though raw does not.
        assert_eq!(sanitize_label("ab-cd", "abcd"), Err(LABEL_CONTAINS_VALUE));
    }

    #[test]
    fn risk_tiers_and_boundaries() {
        assert_eq!(classify("ab"), Err(TOO_SHORT));
        assert_eq!(classify("qzx"), Ok((SecretRisk::Risky, Some(SHORT))));
        assert_eq!(classify("abcdefg"), Ok((SecretRisk::Risky, Some(SHORT))));
        assert_eq!(classify("abcdefgh"), Ok((SecretRisk::Safe, None)));
        assert_eq!(classify("LocalHost"), Ok((SecretRisk::Risky, Some(COMMON))));
        assert_eq!(
            classify("administrator"),
            Ok((SecretRisk::Risky, Some(COMMON)))
        );
        assert_eq!(classify("a\nbcdefgh"), Err(INVALID_VALUE));
        assert_eq!(classify("   "), Err(INVALID_VALUE));
        assert_eq!(classify(&"x".repeat(4097)), Err(INVALID_VALUE));
        assert_eq!(classify("密码密码"), Ok((SecretRisk::Risky, Some(SHORT))));
    }

    #[test]
    fn whole_word_counting() {
        assert_eq!(count_whole_word("root rooted root_x (root)", "root"), 2);
        assert_eq!(count_whole_word("a.b.c.d", "b"), 1);
        assert_eq!(count_whole_word("密码root密码", "root"), 1);
    }

    #[test]
    fn regex_escaping() {
        let v = r"a.b*c+(d)[e]{f}|g?^$\h/i";
        let escaped = escape_regex(v);
        assert_eq!(escaped, r"a\.b\*c\+\(d\)\[e\]\{f\}\|g\?\^\$\\h\/i");
        let re = regex::Regex::new(&format!("^{}$", escaped.replace("\\/", "/"))).unwrap();
        assert!(re.is_match(v));
        assert_eq!(
            whole_word_regex("p@ss.1"),
            r"(?<![A-Za-z0-9_])p@ss\.1(?![A-Za-z0-9_])"
        );
    }
}
