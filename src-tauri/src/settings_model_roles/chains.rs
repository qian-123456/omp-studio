//! Lossless writer for the global `retry.fallbackChains` record.
//!
//! omp's own `config set` rewrites the whole config file and drops every comment, so chain
//! edits go through the same byte-splice machinery as the model tables: the lossless syntax
//! tree locates each scalar, only those byte ranges change, and a result is accepted only when
//! it re-parses to exactly the planned record, leaves every other value alone and keeps the
//! comment sequence. Anything not unambiguously spliceable (anchors, aliases, tags, merge keys,
//! multi-line flow sequences, odd layouts) is refused and nothing is written.

use super::*;

const RETRY_KEY: &str = "retry";
const CHAINS_KEY: &str = "fallbackChains";
const FORMAT_ERROR: &str = "回退链记录格式无法识别";

pub(crate) type Record = BTreeMap<String, Vec<String>>;

/// One key's before/after state; `None` = key absent / deleted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChainStep {
    pub key: String,
    pub before: Option<Vec<String>>,
    pub after: Option<Vec<String>>,
}

// ---------- reading ----------

/// Every `retry.fallbackChains` entry as parsed. Absent or empty → empty map.
fn raw_chains(root: &Value) -> Result<BTreeMap<String, Value>, String> {
    let Value::Mapping(map) = root else {
        return if root.is_null() {
            Ok(BTreeMap::new())
        } else {
            Err(FORMAT_ERROR.to_string())
        };
    };
    let chains = match map.get(RETRY_KEY) {
        None | Some(Value::Null) => return Ok(BTreeMap::new()),
        Some(Value::Mapping(retry)) => match retry.get(CHAINS_KEY) {
            None | Some(Value::Null) => return Ok(BTreeMap::new()),
            Some(Value::Mapping(chains)) => chains,
            Some(_) => return Err(FORMAT_ERROR.to_string()),
        },
        Some(_) => return Err(FORMAT_ERROR.to_string()),
    };
    Ok(chains
        .iter()
        .map(|(key, value)| {
            let key = match key {
                Value::String(text) => text.clone(),
                other => format!("{other:?}"),
            };
            (key, value.clone())
        })
        .collect())
}

/// The chain record: entries that are not sequences of strings are ignored.
fn chains_record(root: &Value) -> Result<Record, String> {
    let mut record = Record::new();
    for (key, value) in raw_chains(root)? {
        let Value::Sequence(items) = value else {
            continue;
        };
        let items: Option<Vec<String>> = items
            .into_iter()
            .map(|item| match item {
                Value::String(text) => Some(text),
                _ => None,
            })
            .collect();
        if let Some(items) = items {
            record.insert(key, items);
        }
    }
    Ok(record)
}

/// Current global `retry.fallbackChains`, read straight from the config file.
pub(crate) fn read_chains() -> Result<Record, String> {
    let ctx = Ctx::resolve(None)?;
    let file = read_config(&global_config_path(&ctx), GLOBAL_LABEL)?;
    chains_record(&parse_yaml(&file.text, GLOBAL_LABEL)?)
}

// ---------- guarded write ----------

/// One guarded read-modify-write of the global chain record. Under [`WRITE_LOCK`] the file is
/// read fresh, `decide` sees the current record and returns the accepted edits (each a group of
/// steps; a group that is exactly a key rename is spliced in place), and the planned result is
/// written once atomically. Any planning or verification failure leaves the file untouched.
pub(crate) fn edit_chains(
    decide: impl FnOnce(&Record) -> Vec<Vec<ChainStep>>,
) -> Result<(), String> {
    let ctx = Ctx::resolve(None)?;
    let _guard = WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = global_config_path(&ctx);
    let current = read_config(&path, GLOBAL_LABEL)?;
    if !current.exists && is_file(&ctx.agent_dir.join(LEGACY_SETTINGS_NAME)) {
        return Err(
            "检测到旧版 settings.json；请先让 omp 迁移为 config.yml 后再修改回退链，文件未修改"
                .to_string(),
        );
    }
    let record = chains_record(&parse_yaml(&current.text, GLOBAL_LABEL)?)?;
    let edits = decide(&record);
    if edits.is_empty() {
        return Ok(());
    }
    let Some(next) = plan_chain_edits(&current.text, &edits, GLOBAL_LABEL)? else {
        return Ok(());
    };
    write_guarded(
        &path,
        current.exists.then_some(current.bytes.as_slice()),
        &next,
    )
}

// ---------- planning ----------

enum Op {
    Rename {
        from: String,
        to: String,
    },
    Items {
        key: String,
        before: Vec<String>,
        after: Vec<String>,
    },
    Create {
        key: String,
        after: Vec<String>,
    },
    Delete {
        key: String,
    },
}

fn classify(edit: &[ChainStep]) -> Vec<Op> {
    if let [first, second] = edit {
        let pair = [(first, second), (second, first)]
            .into_iter()
            .find(|(new, old)| {
                new.before.is_none()
                    && new.after.is_some()
                    && old.before.is_some()
                    && old.after.is_none()
            });
        if let Some((new, old)) = pair {
            return vec![
                Op::Rename {
                    from: old.key.clone(),
                    to: new.key.clone(),
                },
                Op::Items {
                    key: new.key.clone(),
                    before: old.before.clone().unwrap_or_default(),
                    after: new.after.clone().unwrap_or_default(),
                },
            ];
        }
    }
    let mut ops = Vec::new();
    for step in edit {
        match (&step.before, &step.after) {
            (None, Some(after)) => ops.push(Op::Create {
                key: step.key.clone(),
                after: after.clone(),
            }),
            (Some(_), None) => ops.push(Op::Delete {
                key: step.key.clone(),
            }),
            (Some(before), Some(after)) if before != after => ops.push(Op::Items {
                key: step.key.clone(),
                before: before.clone(),
                after: after.clone(),
            }),
            _ => {}
        }
    }
    ops
}

/// Plans every edit as a sequence of splices over the evolving text and verifies the final
/// result. `Ok(None)` means the file would not change.
fn plan_chain_edits(
    original: &str,
    edits: &[Vec<ChainStep>],
    label: &str,
) -> Result<Option<String>, String> {
    let mut text = original.to_string();
    for edit in edits {
        for op in classify(edit) {
            text = apply_op(&text, &op, label)?;
        }
    }
    if text == original {
        return Ok(None);
    }
    verify_chains(original, &text, edits, label)?;
    Ok(Some(text))
}

fn apply_op(text: &str, op: &Op, label: &str) -> Result<String, String> {
    if text.starts_with('\u{feff}') {
        return Err(format!("{label}带有 BOM，拒绝写入"));
    }
    if !matches!(parse_yaml(text, label)?, Value::Mapping(_) | Value::Null) {
        return Err(format!("{label}根节点不是映射，拒绝写入"));
    }
    let file = YamlFile::from_str(text).map_err(|_| format!("{label}无法解析，拒绝写入"))?;
    if file.documents().count() > 1 {
        return Err(format!("{label}包含多个文档，拒绝写入"));
    }
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let root = file.document().and_then(|document| document.as_mapping());
    match &root {
        Some(root) if root.is_flow_style() => {
            return Err(format!("{label}根映射为 flow 样式，拒绝写入"));
        }
        None if !is_comment_only(text) => {
            return Err(format!("{label}根节点不是映射，拒绝写入"));
        }
        _ => {}
    }
    let place = locate(text, root.as_ref(), label)?;
    let splices = match op {
        Op::Create { key, after } => plan_create(text, &place, key, after, eol, label)?,
        Op::Delete { key } => plan_delete(text, &place, key, label)?,
        Op::Rename { from, to } => plan_rename(text, &place, from, to, label)?,
        Op::Items { key, before, after } => {
            plan_items(text, &place, key, before, after, eol, label)?
        }
    };
    apply_splices(text, splices, label)
}

// ---------- locating ----------

/// Where `retry.fallbackChains` sits in the document.
enum Place {
    Chains {
        map: Mapping,
        key_start: usize,
        retry: Mapping,
        retry_start: usize,
    },
    /// `fallbackChains:` exists with an empty value.
    ChainsNull {
        key_start: usize,
    },
    RetryWithoutChains {
        retry: Mapping,
    },
    /// `retry:` exists with an empty value.
    RetryNull {
        key_start: usize,
    },
    NoRetry,
}

struct RawEntry {
    key_start: usize,
    key_end: usize,
    colon_end: usize,
    value: Option<YamlNode>,
    value_span: Option<(usize, usize)>,
}

fn raw_entry(
    text: &str,
    map: &Mapping,
    key: &str,
    label: &str,
) -> Result<Option<RawEntry>, String> {
    let Some(entry) = map.find_entry_by_key(key) else {
        return Ok(None);
    };
    let key_node = entry
        .key_node()
        .ok_or_else(|| format!("{label}存在无法定位的键，拒绝写入"))?;
    let (key_start, key_end) = scalar_span(text, &key_node, label)?;
    let rest = &text[key_end..];
    let colon = rest
        .find(':')
        .ok_or_else(|| format!("{label}条目缺少冒号，拒绝写入"))?;
    if rest[..colon].chars().any(|c| !is_inline_space(c)) {
        return Err(format!("{label}键与冒号之间含有未知内容，拒绝写入"));
    }
    let colon_end = key_end + colon + 1;
    let value = match entry.value_node() {
        None => None,
        Some(YamlNode::Scalar(scalar)) if scalar.value().trim().is_empty() => None,
        Some(node) => Some(node),
    };
    let value_span = match &value {
        Some(node) => {
            let (start, end) = node_span(text, node, label)?;
            // Anchors, tags and other properties live between the colon and the value.
            let clean = text
                .get(colon_end..start)
                .is_some_and(|gap| gap.lines().all(|line| line_code(line).is_empty()));
            if !clean {
                return Err(format!("{label}含有锚点、标签或未知内容，拒绝写入"));
            }
            Some((start, end))
        }
        None => None,
    };
    Ok(Some(RawEntry {
        key_start,
        key_end,
        colon_end,
        value,
        value_span,
    }))
}

/// A line without its comment, trimmed.
fn line_code(line: &str) -> &str {
    line.split('#').next().unwrap_or("").trim()
}

fn locate(text: &str, root: Option<&Mapping>, label: &str) -> Result<Place, String> {
    let Some(root) = root else {
        return Ok(Place::NoRetry);
    };
    let Some(retry_entry) = raw_entry(text, root, RETRY_KEY, label)? else {
        return Ok(Place::NoRetry);
    };
    let retry = match retry_entry.value {
        None => {
            return Ok(Place::RetryNull {
                key_start: retry_entry.key_start,
            })
        }
        Some(YamlNode::Mapping(map)) if !map.is_flow_style() => map,
        Some(_) => return Err(format!("{label}中的 retry 不是块状映射，拒绝写入")),
    };
    let Some(chains_entry) = raw_entry(text, &retry, CHAINS_KEY, label)? else {
        return Ok(Place::RetryWithoutChains { retry });
    };
    match chains_entry.value {
        None => Ok(Place::ChainsNull {
            key_start: chains_entry.key_start,
        }),
        Some(YamlNode::Mapping(map)) if !map.is_flow_style() => {
            let merges = map.iter().any(|(key, _)| match key {
                YamlNode::Scalar(scalar) => scalar.value().trim() == "<<",
                _ => false,
            });
            if merges {
                return Err(format!("{label}的回退链含有合并键，拒绝写入"));
            }
            Ok(Place::Chains {
                map,
                key_start: chains_entry.key_start,
                retry,
                retry_start: retry_entry.key_start,
            })
        }
        Some(_) => Err(format!(
            "{label}中的 retry.fallbackChains 不是块状映射，拒绝写入"
        )),
    }
}

// ---------- text helpers ----------

/// Rejects text that could not be written as a plain double-quoted scalar.
fn check_text(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value
            .chars()
            .any(|c| c == '"' || c == '\\' || c.is_control())
    {
        return Err(format!(
            "{label}：回退链名称含有无法安全写入的字符，拒绝写入"
        ));
    }
    Ok(())
}

fn quoted(value: &str) -> String {
    format!("\"{value}\"")
}

fn flow_list(items: &[String], label: &str) -> Result<String, String> {
    for item in items {
        check_text(item, label)?;
    }
    let body: Vec<String> = items.iter().map(|item| quoted(item)).collect();
    Ok(format!("[{}]", body.join(", ")))
}

/// Value of a one-line scalar token: plain, or quoted without escapes.
fn scalar_text(raw: &str) -> Option<String> {
    let quote = raw.chars().next().filter(|c| matches!(c, '"' | '\''))?;
    let inner = raw.strip_prefix(quote)?.strip_suffix(quote)?;
    if inner.contains(quote) || inner.contains('\\') {
        return None;
    }
    Some(inner.to_string())
}

// ---------- create / rename ----------

fn plan_create(
    text: &str,
    place: &Place,
    key: &str,
    after: &[String],
    eol: &str,
    label: &str,
) -> Result<Vec<Splice>, String> {
    check_text(key, label)?;
    let entry = format!("{}: {}", key_text(key), flow_list(after, label)?);
    let fresh = |chains_indent: usize| -> String {
        [
            row(eol, chains_indent, &format!("{CHAINS_KEY}:")),
            row(eol, chains_indent + 2, &entry),
        ]
        .concat()
    };
    match place {
        Place::Chains { map, .. } => {
            if raw_entry(text, map, key, label)?.is_some() {
                return Err(format!("{label}中已存在回退链 {key}，拒绝写入"));
            }
            let indent = first_key_column(text, map, label)?;
            Ok(vec![insert_after_last(
                text,
                map,
                eol,
                &row(eol, indent, &entry),
                label,
            )?])
        }
        Place::ChainsNull { key_start } => {
            let indent = column(text, *key_start) + 2;
            Ok(vec![insert_after_line(
                text,
                *key_start,
                eol,
                &row(eol, indent, &entry),
            )])
        }
        Place::RetryWithoutChains { retry } => {
            let indent = first_key_column(text, retry, label)?;
            Ok(vec![insert_after_last(
                text,
                retry,
                eol,
                &fresh(indent),
                label,
            )?])
        }
        Place::RetryNull { key_start } => {
            let indent = column(text, *key_start) + 2;
            Ok(vec![insert_after_line(
                text,
                *key_start,
                eol,
                &fresh(indent),
            )])
        }
        Place::NoRetry => {
            let block = [row(eol, 0, &format!("{RETRY_KEY}:")), fresh(2)].concat();
            Ok(vec![insertion(text, text.len(), eol, &block)])
        }
    }
}

fn chains_map<'a>(place: &'a Place, key: &str, label: &str) -> Result<&'a Mapping, String> {
    match place {
        Place::Chains { map, .. } => Ok(map),
        _ => Err(format!("{label}中不存在回退链 {key}，拒绝写入")),
    }
}

fn existing(text: &str, place: &Place, key: &str, label: &str) -> Result<RawEntry, String> {
    raw_entry(text, chains_map(place, key, label)?, key, label)?
        .ok_or_else(|| format!("{label}中不存在回退链 {key}，拒绝写入"))
}

fn plan_rename(
    text: &str,
    place: &Place,
    from: &str,
    to: &str,
    label: &str,
) -> Result<Vec<Splice>, String> {
    check_text(to, label)?;
    let map = chains_map(place, from, label)?;
    if raw_entry(text, map, to, label)?.is_some() {
        return Err(format!("{label}中已存在回退链 {to}，拒绝写入"));
    }
    let entry = existing(text, place, from, label)?;
    Ok(vec![Splice {
        start: entry.key_start,
        end: entry.key_end,
        text: key_text(to),
    }])
}

// ---------- sequences ----------

struct Item {
    start: usize,
    end: usize,
}

struct Seq {
    items: Vec<Item>,
    values: Vec<String>,
    flow: bool,
    span: (usize, usize),
}

fn read_seq(text: &str, entry: &RawEntry, key: &str, label: &str) -> Result<Seq, String> {
    let (Some(YamlNode::Sequence(seq)), Some(span)) = (&entry.value, entry.value_span) else {
        return Err(format!("{label}中的回退链 {key} 不是序列，拒绝写入"));
    };
    let flow = seq.is_flow_style();
    if flow {
        let raw = &text[span.0..span.1];
        if raw.contains('\n') || !raw.starts_with('[') || !raw.ends_with(']') {
            return Err(format!(
                "{label}中的回退链 {key} 为多行 flow 序列，拒绝写入"
            ));
        }
    }
    let mut items = Vec::new();
    let mut values = Vec::new();
    for node in seq.values() {
        let YamlNode::Scalar(_) = &node else {
            return Err(format!("{label}中的回退链 {key} 含有非标量条目，拒绝写入"));
        };
        let (start, end) = node_span(text, &node, label)?;
        let raw = &text[start..end];
        if raw.contains('\n') || raw.contains('\r') || raw.contains('#') {
            return Err(format!("{label}无法安全定位回退链条目，拒绝写入"));
        }
        values.push(scalar_text(raw).unwrap_or_else(|| raw.to_string()));
        items.push(Item { start, end });
    }
    Ok(Seq {
        items,
        values,
        flow,
        span,
    })
}

enum ItemOp {
    Replace(usize, String),
    Delete(usize),
}

/// Walks `before` against `after`: equal items stay, a mismatch is a replacement (or, when the
/// next `before` item already equals `after`, a removal), surplus `before` items are removed and
/// leftover `after` items are appended.
fn diff_items(before: &[String], after: &[String]) -> (Vec<ItemOp>, Vec<String>) {
    let mut ops = Vec::new();
    let mut j = 0usize;
    for (i, item) in before.iter().enumerate() {
        match after.get(j) {
            None => ops.push(ItemOp::Delete(i)),
            Some(target) if target == item => j += 1,
            Some(target) => {
                if before.get(i + 1) == Some(target) {
                    ops.push(ItemOp::Delete(i));
                } else {
                    ops.push(ItemOp::Replace(i, target.clone()));
                    j += 1;
                }
            }
        }
    }
    (ops, after[j.min(after.len())..].to_vec())
}

fn plan_items(
    text: &str,
    place: &Place,
    key: &str,
    before: &[String],
    after: &[String],
    eol: &str,
    label: &str,
) -> Result<Vec<Splice>, String> {
    let entry = existing(text, place, key, label)?;
    let seq = read_seq(text, &entry, key, label)?;
    if seq.values != before {
        return Err(format!("{label}中的回退链 {key} 与预期不符，拒绝写入"));
    }
    for item in after {
        check_text(item, label)?;
    }
    let (ops, appended) = diff_items(before, after);
    if seq.flow {
        plan_flow_items(text, &seq, &ops, &appended, label)
    } else {
        plan_block_items(text, &entry, &seq, &ops, &appended, eol, label)
    }
}

/// Position of the `-` marker of a block sequence item that starts at `item_start`.
fn dash_position(text: &str, item_start: usize, label: &str) -> Result<usize, String> {
    let line = line_start(text, item_start);
    let prefix = text[line..item_start].trim_end_matches(' ');
    match prefix.strip_suffix('-') {
        Some(lead) if lead.bytes().all(|byte| byte == b' ') => Ok(line + lead.len()),
        _ => Err(format!("{label}回退链条目布局无法识别，拒绝写入")),
    }
}

fn plan_block_items(
    text: &str,
    entry: &RawEntry,
    seq: &Seq,
    ops: &[ItemOp],
    appended: &[String],
    eol: &str,
    label: &str,
) -> Result<Vec<Splice>, String> {
    let Some(last) = seq.items.last() else {
        return Err(format!("{label}回退链序列为空，拒绝写入"));
    };
    let dashes = seq
        .items
        .iter()
        .map(|item| dash_position(text, item.start, label))
        .collect::<Result<Vec<_>, _>>()?;
    let removes_all = ops.len() == seq.items.len()
        && ops.iter().all(|op| matches!(op, ItemOp::Delete(_)))
        && appended.is_empty();
    if removes_all {
        // An emptied block sequence becomes `key: []`; comments inside it cannot move.
        if text[entry.colon_end..last.end].contains('#') {
            return Err(format!("{label}清空含注释的回退链会丢失注释，拒绝写入"));
        }
        return Ok(vec![Splice {
            start: entry.colon_end,
            end: last.end,
            text: " []".to_string(),
        }]);
    }
    let mut splices = Vec::new();
    for op in ops {
        match op {
            ItemOp::Replace(index, value) => splices.push(Splice {
                start: seq.items[*index].start,
                end: seq.items[*index].end,
                text: quoted(value),
            }),
            ItemOp::Delete(index) => {
                splices
                    .push(item_extent(text, dashes[*index], seq.items[*index].end, label)?.splice);
            }
        }
    }
    if !appended.is_empty() {
        let indent = column(text, dashes[0]);
        let block: String = appended
            .iter()
            .map(|item| row(eol, indent, &format!("- {}", quoted(item))))
            .collect();
        splices.push(insertion(text, line_end_incl(text, last.end), eol, &block));
    }
    Ok(splices)
}

fn plan_flow_items(
    text: &str,
    seq: &Seq,
    ops: &[ItemOp],
    appended: &[String],
    label: &str,
) -> Result<Vec<Splice>, String> {
    let items = &seq.items;
    let Some(last) = items.last() else {
        // `[]`: the appended items become the whole content.
        let interior = (seq.span.0 + 1, seq.span.1 - 1);
        if text[interior.0..interior.1].trim().is_empty() && !appended.is_empty() {
            let body: Vec<String> = appended.iter().map(|item| quoted(item)).collect();
            return Ok(vec![Splice {
                start: interior.0,
                end: interior.1,
                text: body.join(", "),
            }]);
        }
        return if appended.is_empty() {
            Ok(Vec::new())
        } else {
            Err(format!("{label}回退链序列无法安全定位，拒绝写入"))
        };
    };
    let mut deleted = vec![false; items.len()];
    for op in ops {
        if let ItemOp::Delete(index) = op {
            deleted[*index] = true;
        }
    }
    let mut splices = Vec::new();
    for op in ops {
        if let ItemOp::Replace(index, value) = op {
            splices.push(Splice {
                start: items[*index].start,
                end: items[*index].end,
                text: quoted(value),
            });
        }
    }
    match deleted.iter().rposition(|gone| !gone) {
        None if deleted.iter().any(|gone| *gone) => splices.push(Splice {
            start: items[0].start,
            end: last.end,
            text: String::new(),
        }),
        None => {}
        Some(last_kept) => {
            for index in 0..last_kept {
                if deleted[index] {
                    splices.push(Splice {
                        start: items[index].start,
                        end: items[index + 1].start,
                        text: String::new(),
                    });
                }
            }
            if last_kept + 1 < items.len() {
                splices.push(Splice {
                    start: items[last_kept].end,
                    end: last.end,
                    text: String::new(),
                });
            }
        }
    }
    if !appended.is_empty() {
        let tail: String = appended
            .iter()
            .map(|item| format!(", {}", quoted(item)))
            .collect();
        splices.push(Splice {
            start: last.end,
            end: last.end,
            text: tail,
        });
    }
    Ok(splices)
}

// ---------- delete ----------

fn plan_delete(text: &str, place: &Place, key: &str, label: &str) -> Result<Vec<Splice>, String> {
    let Place::Chains {
        map,
        key_start: chains_start,
        retry,
        retry_start,
    } = place
    else {
        return Err(format!("{label}中不存在回退链 {key}，拒绝写入"));
    };
    let entry = existing(text, place, key, label)?;
    let seq = read_seq(text, &entry, key, label)?;
    let mut splices = Vec::new();
    let last_line_end;
    if seq.flow {
        let extent = item_extent(text, entry.key_start, seq.span.1, label)?;
        last_line_end = extent.line_end;
        splices.push(extent.splice);
    } else {
        let head = item_extent(text, entry.key_start, entry.colon_end, label)?;
        splices.push(head.splice);
        let mut end = head.line_end;
        for item in &seq.items {
            let dash = dash_position(text, item.start, label)?;
            let extent = item_extent(text, dash, item.end, label)?;
            end = extent.line_end;
            splices.push(extent.splice);
        }
        last_line_end = end;
    }
    // Containers this removal empties lose their header line, unless a comment sits in the
    // span: comments are never deleted. Innermost first.
    for (header_start, count) in [(*chains_start, map.len()), (*retry_start, retry.len())] {
        if count != 1 {
            break;
        }
        let header_line = line_start(text, header_start);
        check_indent(text, header_line, header_start, label)?;
        if text[header_line..last_line_end].contains('#') {
            break;
        }
        splices.push(delete_line(text, header_line, header_start));
    }
    Ok(splices)
}

// ---------- verification ----------

/// Accepts a result only if it re-parses, keeps the exact comment sequence, holds exactly the
/// planned chain record and differs from the original nowhere else.
fn verify_chains(
    original: &str,
    next: &str,
    edits: &[Vec<ChainStep>],
    label: &str,
) -> Result<(), String> {
    let refused = || format!("保格式校验失败（{label}），已拒绝写入，文件未修改");
    let comments = |text: &str| -> Result<Vec<String>, String> {
        let file = YamlFile::from_str(text).map_err(|_| refused())?;
        Ok(file
            .comments()
            .map(|comment| comment.text().to_string())
            .collect())
    };
    if comments(original)? != comments(next)? {
        return Err(refused());
    }
    let before = parse_yaml(original, label)?;
    let after = parse_yaml(next, label).map_err(|_| refused())?;

    let mut expected = raw_chains(&before)?;
    for step in edits.iter().flatten() {
        match &step.after {
            Some(items) => {
                let sequence = items.iter().cloned().map(Value::String).collect();
                expected.insert(step.key.clone(), Value::Sequence(sequence));
            }
            None => {
                expected.remove(&step.key);
            }
        }
    }
    if raw_chains(&after).map_err(|_| refused())? != expected {
        return Err(refused());
    }

    let prefix = format!("{RETRY_KEY}{PATH_SEP}{CHAINS_KEY}");
    let rest = |value: &Value| {
        let mut out = BTreeMap::new();
        leaves(value, &mut Vec::new(), &mut out);
        out.retain(|key, _| key != &prefix && !key.starts_with(&format!("{prefix}{PATH_SEP}")));
        out
    };
    if rest(&before) == rest(&after) {
        Ok(())
    } else {
        Err(refused())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(lines: &[&str]) -> String {
        let mut text = lines.join("\n");
        text.push('\n');
        text
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    fn step(key: &str, before: Option<&[&str]>, after: Option<&[&str]>) -> ChainStep {
        ChainStep {
            key: key.to_string(),
            before: before.map(strings),
            after: after.map(strings),
        }
    }

    fn plan(original: &str, edits: &[Vec<ChainStep>]) -> Result<Option<String>, String> {
        plan_chain_edits(original, edits, "测试")
    }

    fn planned(original: &str, edits: &[Vec<ChainStep>]) -> String {
        plan(original, edits).unwrap().expect("file should change")
    }

    fn crlf(text: &str) -> String {
        text.replace('\n', "\r\n")
    }

    /// Inverse of an edit group, as undo applies it.
    fn inverse(edits: &[Vec<ChainStep>]) -> Vec<Vec<ChainStep>> {
        edits
            .iter()
            .map(|edit| {
                edit.iter()
                    .map(|change| ChainStep {
                        key: change.key.clone(),
                        before: change.after.clone(),
                        after: change.before.clone(),
                    })
                    .collect()
            })
            .collect()
    }

    /// Synthetic fixture: comments inline, standalone, around and inside the chain record.
    fn fixture() -> String {
        doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # keep theme",
            "retry:",
            "  # retry header",
            "  maxRetries: 3 # attempts",
            "  fallbackChains:",
            "    # primary chain",
            "    default: # key comment",
            "      - \"web/exa\" # first",
            "      # standalone inside",
            "      - openai/gpt-5 # second",
            "    smol: [\"a/b\", c/d] # flow tail",
            "  other: 1",
            "# trailing comment",
        ])
    }

    #[test]
    fn record_reads_tolerantly() {
        let root = parse_yaml(
            &doc(&[
                "retry:",
                "  fallbackChains:",
                "    default: [web/exa]",
                "    broken: 3",
                "    mixed: [a/b, 5]",
            ]),
            "测试",
        )
        .unwrap();
        let record = chains_record(&root).unwrap();
        assert_eq!(record.len(), 1);
        assert_eq!(record["default"], strings(&["web/exa"]));
        assert!(chains_record(&Value::Null).unwrap().is_empty());
        assert!(chains_record(&parse_yaml("retry: 3\n", "测试").unwrap()).is_err());
    }

    #[test]
    fn block_item_replace_changes_only_that_scalar() {
        let edit = vec![vec![step(
            "default",
            Some(&["web/exa", "openai/gpt-5"]),
            Some(&["web/new", "openai/gpt-5"]),
        )]];
        let expected = fixture().replace("- \"web/exa\" # first", "- \"web/new\" # first");
        assert_eq!(planned(&fixture(), &edit), expected);
    }

    #[test]
    fn flow_item_replace_changes_only_that_scalar() {
        let edit = vec![vec![step(
            "smol",
            Some(&["a/b", "c/d"]),
            Some(&["a/b", "c/e"]),
        )]];
        let expected = fixture().replace(
            "[\"a/b\", c/d] # flow tail",
            "[\"a/b\", \"c/e\"] # flow tail",
        );
        assert_eq!(planned(&fixture(), &edit), expected);
    }

    #[test]
    fn duplicate_removal_deletes_only_the_surplus_item() {
        let original = doc(&[
            "retry:",
            "  fallbackChains:",
            "    default:",
            "      - a/b # one",
            "      - c/d",
            "      # about the dup",
            "      - a/b # dup",
            "    smol: [a/b, c/d, a/b]",
            "    tiny: [a/b, a/b, c/d]",
        ]);
        let edit = vec![
            vec![step(
                "default",
                Some(&["a/b", "c/d", "a/b"]),
                Some(&["a/b", "c/d"]),
            )],
            vec![step(
                "smol",
                Some(&["a/b", "c/d", "a/b"]),
                Some(&["a/b", "c/d"]),
            )],
            vec![step(
                "tiny",
                Some(&["a/b", "a/b", "c/d"]),
                Some(&["a/b", "c/d"]),
            )],
        ];
        let expected = doc(&[
            "retry:",
            "  fallbackChains:",
            "    default:",
            "      - a/b # one",
            "      - c/d",
            "      # about the dup",
            "      # dup",
            "    smol: [a/b, c/d]",
            "    tiny: [a/b, c/d]",
        ]);
        assert_eq!(planned(&original, &edit), expected);
    }

    #[test]
    fn rename_keeps_key_line_comment_and_diffs_the_items() {
        let edit = vec![vec![
            step("anthropic/claude", None, Some(&["web/new", "openai/gpt-5"])),
            step("default", Some(&["web/exa", "openai/gpt-5"]), None),
        ]];
        let expected = fixture()
            .replace(
                "    default: # key comment",
                "    \"anthropic/claude\": # key comment",
            )
            .replace("- \"web/exa\" # first", "- \"web/new\" # first");
        assert_eq!(planned(&fixture(), &edit), expected);
    }

    #[test]
    fn conflict_merge_appends_to_the_existing_chain_and_removes_the_old_key() {
        let edit = vec![vec![
            step(
                "smol",
                Some(&["a/b", "c/d"]),
                Some(&["a/b", "c/d", "web/exa", "z/z"]),
            ),
            step("default", Some(&["web/exa", "openai/gpt-5"]), None),
        ]];
        let expected = doc(&[
            "# 合成夹具：不含真实凭证",
            "theme: dark # keep theme",
            "retry:",
            "  # retry header",
            "  maxRetries: 3 # attempts",
            "  fallbackChains:",
            "    # primary chain",
            "    # key comment",
            "      # first",
            "      # standalone inside",
            "      # second",
            "    smol: [\"a/b\", c/d, \"web/exa\", \"z/z\"] # flow tail",
            "  other: 1",
            "# trailing comment",
        ]);
        assert_eq!(planned(&fixture(), &edit), expected);
    }

    #[test]
    fn block_append_uses_the_item_indent_after_the_last_item() {
        let edit = vec![vec![step(
            "default",
            Some(&["web/exa", "openai/gpt-5"]),
            Some(&["web/exa", "openai/gpt-5", "x/y"]),
        )]];
        let expected = fixture().replace(
            "      - openai/gpt-5 # second\n",
            "      - openai/gpt-5 # second\n      - \"x/y\"\n",
        );
        assert_eq!(planned(&fixture(), &edit), expected);
    }

    #[test]
    fn new_key_goes_after_the_last_chain() {
        let edit = vec![vec![step("fresh", None, Some(&["p/q", "r/s"]))]];
        let expected = fixture().replace(
            "    smol: [\"a/b\", c/d] # flow tail\n",
            "    smol: [\"a/b\", c/d] # flow tail\n    fresh: [\"p/q\", \"r/s\"]\n",
        );
        assert_eq!(planned(&fixture(), &edit), expected);
    }

    #[test]
    fn missing_chains_are_created_under_retry_or_as_a_fresh_block() {
        let edit = vec![vec![step("a/b", None, Some(&["c/d"]))]];
        let with_retry = doc(&["retry:", "  maxRetries: 3 # attempts", "# end"]);
        assert_eq!(
            planned(&with_retry, &edit),
            doc(&[
                "retry:",
                "  maxRetries: 3 # attempts",
                "  fallbackChains:",
                "    \"a/b\": [\"c/d\"]",
                "# end",
            ])
        );
        let without = doc(&["theme: dark # t", "# end"]);
        assert_eq!(
            planned(&without, &edit),
            doc(&[
                "theme: dark # t",
                "# end",
                "retry:",
                "  fallbackChains:",
                "    \"a/b\": [\"c/d\"]",
            ])
        );
        let empty_header = doc(&["retry:", "  fallbackChains: # none yet", "other: 1"]);
        assert_eq!(
            planned(&empty_header, &edit),
            doc(&[
                "retry:",
                "  fallbackChains: # none yet",
                "    \"a/b\": [\"c/d\"]",
                "other: 1",
            ])
        );
        let comment_only = doc(&["# only a comment"]);
        assert_eq!(
            planned(&comment_only, &edit),
            doc(&[
                "# only a comment",
                "retry:",
                "  fallbackChains:",
                "    \"a/b\": [\"c/d\"]",
            ])
        );
    }

    #[test]
    fn deleting_the_last_chain_removes_empty_containers_but_never_comments() {
        let plain = doc(&[
            "theme: dark",
            "retry:",
            "  fallbackChains:",
            "    default: [a/b]",
            "other: 1",
        ]);
        let edit = vec![vec![step("default", Some(&["a/b"]), None)]];
        assert_eq!(planned(&plain, &edit), doc(&["theme: dark", "other: 1"]));
        let edit = vec![vec![step("smol", Some(&["a/b", "c/d"]), None)]];
        let expected = fixture().replace(
            "    smol: [\"a/b\", c/d] # flow tail\n",
            "    # flow tail\n",
        );
        assert_eq!(planned(&fixture(), &edit), expected);
    }

    #[test]
    fn emptying_a_chain_keeps_the_key_with_an_empty_list() {
        let original = doc(&[
            "retry:",
            "  fallbackChains:",
            "    a: [x]",
            "    b:",
            "      - y",
        ]);
        let edit = vec![vec![
            step("a", Some(&["x"]), Some(&[])),
            step("b", Some(&["y"]), Some(&[])),
        ]];
        assert_eq!(
            planned(&original, &edit),
            doc(&["retry:", "  fallbackChains:", "    a: []", "    b: []"])
        );
    }

    #[test]
    fn crlf_files_keep_crlf_everywhere() {
        let edit = vec![vec![
            step(
                "anthropic/claude",
                None,
                Some(&["web/new", "openai/gpt-5", "x/y"]),
            ),
            step("default", Some(&["web/exa", "openai/gpt-5"]), None),
        ]];
        let original = crlf(&fixture());
        let next = planned(&original, &edit);
        let expected = crlf(
            &fixture()
                .replace(
                    "    default: # key comment",
                    "    \"anthropic/claude\": # key comment",
                )
                .replace("- \"web/exa\" # first", "- \"web/new\" # first")
                .replace(
                    "      - openai/gpt-5 # second\n",
                    "      - openai/gpt-5 # second\n      - \"x/y\"\n",
                ),
        );
        assert_eq!(next, expected);
        assert_eq!(next.matches('\n').count(), next.matches("\r\n").count());
        let create = vec![vec![step("fresh", None, Some(&["p/q"]))]];
        let created = planned(&original, &create);
        assert_eq!(
            created.matches('\n').count(),
            created.matches("\r\n").count()
        );
    }

    #[test]
    fn unspliceable_layouts_are_refused_and_nothing_changes() {
        let edit = vec![vec![step("default", Some(&["a/b"]), Some(&["c/d"]))]];
        for lines in [
            vec!["retry:", "  fallbackChains:", "    default: &keep [a/b]"],
            vec!["retry:", "  fallbackChains:", "    default: !!seq [a/b]"],
            vec![
                "x: &base [a/b]",
                "retry:",
                "  fallbackChains:",
                "    default: *base",
            ],
            vec![
                "retry:",
                "  fallbackChains:",
                "    default: [a/b,",
                "      e/f]",
            ],
            vec!["retry:", "  fallbackChains: {default: [a/b]}"],
            vec![
                "retry:",
                "  fallbackChains:",
                "    <<: {z: [q]}",
                "    default: [a/b]",
            ],
        ] {
            let original = doc(&lines);
            assert!(plan(&original, &edit).is_err(), "{lines:?}");
        }
        // A stale `before` is refused too, as is creating an existing key.
        let stale = vec![vec![step("default", Some(&["zzz"]), Some(&["c/d"]))]];
        let original = doc(&["retry:", "  fallbackChains:", "    default: [a/b]"]);
        assert!(plan(&original, &stale).is_err());
        let duplicate = vec![vec![step("default", None, Some(&["c/d"]))]];
        assert!(plan(&original, &duplicate).is_err());
        let hostile = vec![vec![step("default", Some(&["a/b"]), Some(&["c\"d"]))]];
        assert!(plan(&original, &hostile).is_err());
    }

    #[test]
    fn apply_then_undo_restores_the_exact_bytes() {
        let original = doc(&[
            "# header",
            "retry:",
            "  fallbackChains:",
            "    default: # key comment",
            "      - \"web/exa\" # first",
            "      # standalone",
            "      - \"openai/gpt-5\"",
            "    smol: [\"web/exa\", \"c/d\"] # flow",
            "# end",
        ]);
        let edits = vec![
            vec![
                step("anthropic/claude", None, Some(&["web/new", "openai/gpt-5"])),
                step("default", Some(&["web/exa", "openai/gpt-5"]), None),
            ],
            vec![step(
                "smol",
                Some(&["web/exa", "c/d"]),
                Some(&["web/new", "c/d"]),
            )],
        ];
        let applied = planned(&original, &edits);
        assert_ne!(applied, original);
        assert!(applied.contains("# key comment") && applied.contains("# standalone"));
        let undone = planned(&applied, &inverse(&edits));
        assert_eq!(undone, original);
        let crlf_original = crlf(&original);
        let crlf_applied = planned(&crlf_original, &edits);
        assert_eq!(planned(&crlf_applied, &inverse(&edits)), crlf_original);
    }

    #[test]
    fn unchanged_edits_are_noops() {
        let edit = vec![vec![step("default", Some(&["a/b"]), Some(&["a/b"]))]];
        let original = doc(&["retry:", "  fallbackChains:", "    default: [a/b]"]);
        assert_eq!(plan(&original, &edit).unwrap(), None);
    }
}
