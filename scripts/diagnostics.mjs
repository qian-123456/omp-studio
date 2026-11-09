#!/usr/bin/env node
// Offline, read-only evidence queries. Never import the launcher or session readers.
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOCK = 64 * 1024;
const LINE = 8 * 1024;
const READ_LIMIT = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const COMMAND = /^[a-z][a-z0-9_]{0,63}$/;
const EVENTS = new Set(`app.started app.exit app.startup_failed app.panic diagnostics.health rpc.lifecycle rpc.command_started rpc.command_finished rpc.invoke_started rpc.invoke_finished rpc.spawn_started rpc.spawn_ready rpc.spawn_failed rpc.io_failed rpc.protocol_invalid rpc.stdout_closed rpc.resume_started rpc.resume_finished frontend.ipc_started frontend.ipc_finished frontend.error frontend.state_reconciled frontend.process_observed frontend.reconnect_started frontend.reconnect_finished`.split(' '));
const CODES = new Set(`invalid_command not_live process_not_running stdin_closed command_timeout response_channel_closed upstream_rejected spawn_failed startup_timeout protocol_invalid io_permission_denied io_not_found io_other cwd_missing session_held unexpected_error js_error promise_rejection resource_load_error`.split(' '));
const SOURCES = new Set(`bootstrap root_boundary app_boundary aside_boundary window_error unhandled_rejection resource_error ipc state_reconcile process_observed reconnect startup rpc stdin stdout explicit_stop app_shutdown startup_missing_session_id registration_replacement external_writer_conflict explicit_restart privacy_refresh idle_suspension unused_draft_release spawn_aborted process_exit`.split(' '));
const RPC_COMMANDS = new Set(`prompt steer follow_up abort abort_and_prompt abort_and_restore_queue compact handoff get_state get_subagents negotiate new_session other`.split(' '));
const ENUMS = {
  phase: new Set('validate dispatch response spawn ready negotiate get_state subscription new_session ensure_dirs database global_workspace tauri_setup tauri_build read write eof'.split(' ')),
  outcome: new Set('ok error reused resumed observed'.split(' ')),
  code: CODES,
  upstreamCode: new Set(['session_busy', 'other']),
  source: SOURCES,
  exitIntent: new Set(['stop', 'restart', 'other']),
};
const BOOLEANS = ['alive', 'streaming', 'settled', 'asyncWork', 'shutdownRequested', 'debugBuild'];
const NUMBERS = ['durationMs', 'subagents', 'pendingUi', 'pendingCommands', 'removedRows', 'droppedEvents', 'writeFailures', 'rejectedEvents'];
const UINTS = ['childPid', 'sourceLine', 'sourceColumn'];
const CONTEXT = new Set(['rpc.lifecycle', 'rpc.stdout_closed', 'frontend.state_reconciled', 'frontend.process_observed', 'frontend.reconnect_started', 'frontend.reconnect_finished']);
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const uint = (x) => Number.isSafeInteger(x) && x >= 0 && x <= 0xffffffff;
const iso = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(s)) return false;
  const n = Date.parse(s);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 19) === s.slice(0, 19);
};
function sourcePath(s) {
  return typeof s === 'string' && Buffer.byteLength(s) <= 512 && /^(?:src\/|src-tauri\/|assets\/)[A-Za-z0-9_./@-]+$/.test(s)
    && !s.split('/').some((p) => p === '..' || p === '.' || p === '');
}
function frames(s) {
  if (typeof s !== 'string' || Buffer.byteLength(s) > 2048) return false;
  const rows = s.split('\n');
  return rows.length <= 8 && rows.every((row) => {
    const m = /^(.*):([1-9]\d{0,8}):([1-9]\d{0,8})$/.exec(row);
    return m && sourcePath(m[1]);
  });
}

// Reconstruct every output field. Parsed objects (including formatter extras) never escape.
function project(raw) {
  if (!object(raw) || !object(raw.fields)) return { error: 'invalidRecords' };
  const f = raw.fields;
  if (f.schemaVersion !== 1) return { error: 'unknownSchemas' };
  if (!iso(raw.timestamp) || !['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].includes(raw.level)
    || raw.target !== 'ompws.diagnostics' || typeof f.eventId !== 'string' || !UUID.test(f.eventId) || typeof f.appRunId !== 'string' || !UUID.test(f.appRunId)
    || !uint(f.appPid) || !EVENTS.has(f.event) || !['backend', 'frontend'].includes(f.origin)
    || (f.event.startsWith('frontend.') !== (f.origin === 'frontend'))) return { error: 'invalidRecords' };
  const e = { timestamp: raw.timestamp, level: raw.level, eventId: f.eventId.toLowerCase(), appRunId: f.appRunId.toLowerCase(), appPid: f.appPid, event: f.event, origin: f.origin };
  const set = (name, valid) => {
    if (f[name] === undefined) return true;
    if (!valid(f[name])) return false;
    e[name] = f[name];
    return true;
  };
  if (!set('occurredAt', iso) || !set('sessionId', (v) => typeof v === 'string' && UUID.test(v))
    || !set('requestId', (v) => typeof v === 'string' && /^req_\d{1,20}$/.test(v))
    || !set('sourceFile', sourcePath) || !set('frames', frames)
    || !set('command', (v) => typeof v === 'string' && (f.event === 'rpc.command_started' || f.event === 'rpc.command_finished' ? RPC_COMMANDS.has(v) : COMMAND.test(v)))) return { error: 'invalidRecords' };
  for (const [key, values] of Object.entries(ENUMS)) if (!set(key, (v) => values.has(v))) return { error: 'invalidRecords' };
  for (const key of BOOLEANS) if (!set(key, (v) => typeof v === 'boolean')) return { error: 'invalidRecords' };
  for (const key of NUMBERS) if (!set(key, (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER && (key === 'durationMs' || Number.isInteger(v)))) return { error: 'invalidRecords' };
  for (const key of UINTS) if (!set(key, uint)) return { error: 'invalidRecords' };
  for (const key of ['exitCode', 'exitSignal']) if (!set(key, (v) => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647)) return { error: 'invalidRecords' };
  if (raw.span !== undefined) {
    if (!object(raw.span) || (raw.span.operationId !== undefined && (typeof raw.span.operationId !== 'string' || !UUID.test(raw.span.operationId)))) return { error: 'invalidRecords' };
    if (raw.span.operationId !== undefined) e.operationId = raw.span.operationId.toLowerCase();
  }
  if (e.sessionId) e.sessionId = e.sessionId.toLowerCase();
  if (f.event === 'app.started') {
    if (!set('appVersion', (v) => typeof v === 'string' && /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[A-Za-z0-9.-]{1,40})?$/.test(v))
      || !set('executableModifiedAt', (v) => iso(v) || (Number.isSafeInteger(v) && v >= 0))) return { error: 'invalidRecords' };
  }
  return { event: e };
}

function base() {
  return { schemaVersion: 1, selection: { status: 'selection_required', candidates: [] }, coverage: { status: 'missing', partial: false, window: { since: null, run: null, session: null }, observed: { first: null, last: null }, files: { readable: 0, missing: 0 }, counts: { bytesRead: 0, records: 0, duplicates: 0, invalidJson: 0, incompleteLines: 0, oversizedLines: 0, unknownSchemas: 0, invalidRecords: 0, readFailures: 0, races: 0 }, warnings: [] }, health: { status: 'unknown', observedAt: null }, issues: [], events: [], truncated: false, omitted: { issues: 0, events: 0, candidates: 0, nextQueries: 0, metadata: 0 }, nextQueries: [], exitCode: 3 };
}
function warn(result, code) {
  if (!result.coverage.warnings.includes(code)) result.coverage.warnings.push(code);
}
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
async function directory(p) {
  const s = await fs.lstat(p);
  if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('unsafe');
  return s;
}
async function openSafe(file) {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('unsafe');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !sameFile(before, stat)) throw new Error('race');
    return { handle, stat };
  } catch (error) { await handle.close(); throw error; }
}
function safeAbsolute(s) { return typeof s === 'string' && path.isAbsolute(s) && !/[\x00-\x1f\x7f]/.test(s); }
async function manifests(root, result) {
  const dir = path.join(root, '.cache', 'dev-worktree');
  try {
    await directory(root);
    await directory(path.join(root, '.cache'));
    const parent = await directory(dir);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const found = [];
    // Bound the manifest inventory as well as each individual read.
    const names = entries.filter((e) => e.isFile() && e.name.endsWith('.json') && SLUG.test(e.name.slice(0, -5))).map((e) => e.name).sort();
    if (names.length > 200) warn(result, 'manifest_inventory_limited');
    for (const name of names.slice(0, 200)) {
      let handle;
      try {
        const opened = await openSafe(path.join(dir, name));
        handle = opened.handle;
        if (opened.stat.size > BLOCK) throw new Error('oversized');
        const buf = Buffer.alloc(opened.stat.size);
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        const value = JSON.parse(buf.subarray(0, bytesRead).toString('utf8'));
        if (!object(value) || !safeAbsolute(value.path) || !safeAbsolute(value.dataDir)) throw new Error('invalid');
        const candidate = { instance: name.slice(0, -5), path: path.resolve(value.path), dataDir: path.resolve(value.dataDir) };
        if (uint(value.pid) && value.pid > 0) candidate.launcherPid = value.pid;
        found.push(candidate);
      } catch { warn(result, 'manifest_unreadable'); }
      finally { if (handle) await handle.close(); }
    }
    if (!sameFile(parent, await directory(dir))) { warn(result, 'manifest_race'); return []; }
    return found;
  } catch (error) {
    if (error.code !== 'ENOENT') warn(result, 'manifest_unreadable');
    return [];
  }
}
function normalize(options) {
  const command = options.command ?? 'summary';
  const limit = options.limit ?? 50;
  const maxBytes = options.maxBytes ?? 8192;
  if (!['summary', 'trace', 'instances'].includes(command) || (options.instance !== undefined && (!SLUG.test(options.instance) || typeof options.instance !== 'string'))
    || (options.dataDir !== undefined && (typeof options.dataDir !== 'string' || !options.dataDir || /[\x00-\x1f\x7f]/.test(options.dataDir)))
    || (options.instance !== undefined && options.dataDir !== undefined) || !Number.isInteger(limit) || limit < 1 || limit > 200
    || !Number.isInteger(maxBytes) || maxBytes < 2048 || maxBytes > 65536
    || ['run', 'session', 'operation'].some((key) => options[key] !== undefined && (typeof options[key] !== 'string' || !UUID.test(options[key])))
    || (options.since !== undefined && !iso(options.since)) || (command === 'trace' && options.operation === undefined)
    || (command !== 'trace' && options.operation !== undefined)
    || (command === 'instances' && ['instance', 'dataDir', 'session', 'run', 'since'].some((key) => options[key] !== undefined))) throw new Error('invalid_arguments');
  const clock = options.clock ?? Date.now;
  const now = Number(typeof clock === 'function' ? clock() : clock);
  if (!Number.isFinite(now)) throw new Error('invalid_arguments');
  return { ...options, command, limit, maxBytes, now, checkoutRoot: path.resolve(options.checkoutRoot ?? CHECKOUT), cwd: path.resolve(options.cwd ?? process.cwd()), since: options.since ?? (command === 'summary' ? new Date(now - 3600000).toISOString() : null), run: options.run?.toLowerCase(), session: options.session?.toLowerCase(), operation: options.operation?.toLowerCase() };
}

async function readLogs(root, result) {
  const events = [];
  const counts = result.coverage.counts;
  let parent;
  try { await directory(root); }
  catch (error) {
    result.coverage.status = error.code === 'ENOENT' ? 'missing' : 'read_error';
    if (error.code !== 'ENOENT') { counts.readFailures++; warn(result, 'unsafe_or_unreadable_directory'); }
    return events;
  }
  try { parent = await directory(path.join(root, 'diagnostics')); }
  catch (error) {
    result.coverage.status = error.code === 'ENOENT' ? 'not_initialized' : 'read_error';
    if (error.code !== 'ENOENT') { counts.readFailures++; warn(result, 'unsafe_or_unreadable_directory'); }
    return events;
  }
  const files = ['events.previous.jsonl', 'events.jsonl'].map((name) => path.join(root, 'diagnostics', name));
  const raced = new Set();
  const race = (file) => {
    if (!raced.has(file)) { raced.add(file); counts.races++; warn(result, 'file_changed_during_read'); }
  };
  const snapshot = async (file) => {
    try { return await fs.lstat(file); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      counts.readFailures++; warn(result, 'unsafe_or_unreadable_file');
      return undefined;
    }
  };
  // Snapshot both paths before either read. Per-file checks alone miss a rotation
  // after previous was consumed (or found absent) but before current is opened.
  const before = [];
  for (const file of files) before.push(await snapshot(file));
  // Previous first gives a deterministic policy if hostile files exceed the total budget.
  for (const file of files) {
    let handle;
    try {
      const opened = await openSafe(file);
      handle = opened.handle;
      result.coverage.files.readable++;
      const size = Math.min(opened.stat.size, READ_LIMIT - counts.bytesRead);
      if (size < opened.stat.size) { warn(result, 'read_budget_exhausted'); result.coverage.partial = true; }
      const block = Buffer.alloc(BLOCK);
      let offset = 0;
      let line = Buffer.alloc(LINE);
      let length = 0;
      let oversized = false;
      const parseLine = () => {
        if (oversized) { counts.oversizedLines++; return; }
        if (length === 0) return;
        let raw;
        try { raw = JSON.parse(line.subarray(0, length).toString('utf8')); } catch { counts.invalidJson++; return; }
        const value = project(raw);
        if (value.error) counts[value.error]++;
        else { counts.records++; events.push(value.event); }
      };
      while (offset < size) {
        const { bytesRead } = await handle.read(block, 0, Math.min(BLOCK, size - offset), offset);
        if (!bytesRead) { race(file); break; }
        offset += bytesRead;
        counts.bytesRead += bytesRead;
        for (let i = 0; i < bytesRead; i++) {
          if (block[i] === 10) { parseLine(); length = 0; oversized = false; }
          else if (!oversized) {
            if (length === LINE - 1) oversized = true;
            else line[length++] = block[i];
          }
        }
      }
      if (length || oversized) counts.incompleteLines++;
      const after = await handle.stat();
      if (after.size !== opened.stat.size || !sameFile(parent, await directory(path.join(root, 'diagnostics')))
        || !sameFile(opened.stat, await fs.lstat(file))) race(file);
    } catch (error) {
      if (error.code === 'ENOENT' && !handle) result.coverage.files.missing++;
      else { counts.readFailures++; warn(result, 'unsafe_or_unreadable_file'); }
    } finally { if (handle) await handle.close(); }
  }
  // Recheck both only after both reads; include absence -> presence on the first
  // rotation. Metadata checks do not follow symlinks or consume the read budget.
  for (const [index, file] of files.entries()) {
    const after = await snapshot(file);
    const initial = before[index];
    if (initial !== undefined && after !== undefined
      && (initial === null ? after !== null : after === null || !sameFile(initial, after))) race(file);
  }
  const damaged = counts.invalidJson + counts.incompleteLines + counts.oversizedLines + counts.unknownSchemas + counts.invalidRecords + counts.readFailures + counts.races;
  result.coverage.partial ||= damaged > 0;
  if (damaged) warn(result, 'incomplete_coverage');
  result.coverage.status = events.length ? 'readable' : damaged ? 'read_error' : 'not_initialized';
  const seen = new Set();
  const unique = events.filter((e) => {
    if (seen.has(e.eventId)) { counts.duplicates++; return false; }
    seen.add(e.eventId); return true;
  });
  unique.sort(compare);
  return unique;
}
const eventTime = (e) => e.occurredAt ?? e.timestamp;
function compare(a, b) { return Date.parse(eventTime(a)) - Date.parse(eventTime(b)) || a.appRunId.localeCompare(b.appRunId) || a.eventId.localeCompare(b.eventId); }
const failure = (e) => e.level === 'ERROR' || e.outcome === 'error' || !!e.code;
const severity = (e) => e.level === 'ERROR' ? 0 : e.level === 'WARN' ? 1 : 2;
function primary(a, b) { return severity(a) - severity(b) || Number(a.code === 'unexpected_error') - Number(b.code === 'unexpected_error') || Number(a.origin !== 'backend') - Number(b.origin !== 'backend') || Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.eventId.localeCompare(b.eventId); }
function summarize(events) {
  const operations = new Map();
  for (const e of events.filter(failure)) {
    const key = e.operationId ? `${e.appRunId}:${e.operationId}` : e.eventId;
    const group = operations.get(key) ?? [];
    group.push(e); operations.set(key, group);
  }
  const issues = new Map();
  for (const group of operations.values()) {
    const evidence = [...group].sort(primary)[0];
    const key = JSON.stringify([evidence.event, evidence.code, evidence.command, evidence.sourceFile, evidence.sourceLine, evidence.sourceColumn]);
    let issue = issues.get(key);
    const times = group.map((e) => e.timestamp).sort((a, b) => Date.parse(a) - Date.parse(b));
    if (!issue) {
      issue = { category: 'error', evidence, firstObservedAt: times[0], lastObservedAt: times.at(-1), operationCount: 0, operationIds: [] };
      issues.set(key, issue);
    }
    issue.operationCount++;
    if (Date.parse(times[0]) < Date.parse(issue.firstObservedAt)) issue.firstObservedAt = times[0];
    if (Date.parse(times.at(-1)) > Date.parse(issue.lastObservedAt)) issue.lastObservedAt = times.at(-1);
    if (evidence.operationId && issue.operationIds.length < 3 && !issue.operationIds.includes(evidence.operationId)) issue.operationIds.push(evidence.operationId);
    if (primary(evidence, issue.evidence) < 0) issue.evidence = evidence;
  }
  return [...issues.values()].sort((a, b) => severity(a.evidence) - severity(b.evidence) || Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt) || a.evidence.eventId.localeCompare(b.evidence.eventId));
}
function trace(events, options, result) {
  const direct = events.filter((e) => e.operationId === options.operation);
  result.coverage.completion = direct.some((e) => ['frontend.ipc_finished', 'rpc.invoke_finished', 'rpc.command_finished', 'rpc.spawn_ready', 'rpc.spawn_failed', 'rpc.resume_finished'].includes(e.event)) ? 'observed' : 'not_observed';
  // Context is only admissible with all three exact identity fields. Time is not a join key.
  const contexts = new Map();
  const identities = new Map();
  for (const e of direct) if (e.sessionId !== undefined && e.childPid !== undefined) {
    const key = `${e.appRunId}:${e.sessionId}:${e.childPid}`;
    const range = identities.get(key) ?? { first: Infinity, last: -Infinity };
    range.first = Math.min(range.first, Date.parse(e.timestamp)); range.last = Math.max(range.last, Date.parse(e.timestamp));
    identities.set(key, range);
  }
  for (const [key, range] of identities) {
    const eligible = events.filter((e) => e.operationId !== options.operation && CONTEXT.has(e.event) && e.sessionId !== undefined && e.childPid !== undefined && `${e.appRunId}:${e.sessionId}:${e.childPid}` === key);
    const beforeAll = eligible.filter((e) => Date.parse(e.timestamp) < range.first);
    const afterAll = eligible.filter((e) => Date.parse(e.timestamp) > range.last);
    const before = beforeAll.slice(-10);
    const within = eligible.filter((e) => Date.parse(e.timestamp) >= range.first && Date.parse(e.timestamp) <= range.last);
    const after = afterAll.slice(0, 10);
    result.omitted.events += Math.max(0, beforeAll.length - 10) + Math.max(0, afterAll.length - 10);
    for (const e of [...before, ...within, ...after]) contexts.set(e.eventId, { ...e, contextOnly: true });
  }
  direct.sort((a, b) => severity(a) - severity(b) || compare(b, a));
  return [...direct, ...[...contexts.values()].sort((a, b) => compare(b, a))];
}
function applyLimit(result, key, items, limit) {
  result[key] = items.slice(0, limit);
  result.omitted[key] += Math.max(0, items.length - limit);
}

// Include the LF written by the CLI in the actual byte budget, also for API callers.
function fit(result, maxBytes) {
  const size = () => Buffer.byteLength(JSON.stringify(result)) + 1;
  while (size() > maxBytes) {
    result.truncated = true;
    const oversizedField = ['dataDir', 'path'].find((key) => typeof result.selection[key] === 'string' && Buffer.byteLength(result.selection[key]) > maxBytes / 4);
    if (oversizedField) { delete result.selection[oversizedField]; result.omitted.metadata++; }
    else if (result.nextQueries.length > 1 || (result.nextQueries.length && Buffer.byteLength(JSON.stringify(result.nextQueries[0])) > maxBytes / 4)) { result.nextQueries.pop(); result.omitted.nextQueries++; }
    else if (result.events.length) { result.events.pop(); result.omitted.events++; }
    else if (result.issues.length) { result.issues.pop(); result.omitted.issues++; }
    else if (result.nextQueries.length) { result.nextQueries.pop(); result.omitted.nextQueries++; }
    else if (result.selection.candidates?.length) { result.selection.candidates.pop(); result.omitted.candidates++; }
    else {
      const field = ['dataDir', 'path'].find((key) => result.selection[key] !== undefined);
      if (field) { delete result.selection[field]; result.omitted.metadata++; }
      else break; // The fixed envelope is smaller than the minimum supported budget.
    }
  }
  result.truncated ||= Object.values(result.omitted).some((n) => n > 0);
  return result;
}

/**
 * Query only manifests and the two retained diagnostic files, without mutation.
 * options: command, instance|dataDir, operation, session, run, since, limit,
 * maxBytes. checkoutRoot/cwd/clock are explicit deterministic test/embedding inputs.
 * Returns the fixed JSON envelope, including the CLI exitCode (0, 2 or 3).
 */
export async function queryDiagnostics(options = {}) {
  const result = base();
  let opts;
  try { opts = normalize(options); }
  catch { result.selection.status = 'invalid_arguments'; result.exitCode = 2; return fit(result, 8192); }
  result.coverage.window = { since: opts.since, run: opts.run ?? null, session: opts.session ?? null };
  const candidates = opts.dataDir === undefined && opts.instance !== 'installed' ? await manifests(opts.checkoutRoot, result) : [];
  const installed = { instance: 'installed', dataDir: path.join(os.homedir(), '.omp-workspace') };
  try { await directory(installed.dataDir); candidates.push(installed); } catch { /* Do not fabricate installed instances. */ }
  if (opts.command === 'instances') {
    result.selection = { status: 'instances', candidates };
    result.coverage.status = 'not_applicable'; result.exitCode = 0;
    return fit(result, opts.maxBytes);
  }
  let selected;
  if (opts.dataDir !== undefined) selected = { instance: null, dataDir: path.resolve(opts.cwd, opts.dataDir) };
  else if (opts.instance === 'installed') selected = installed;
  else if (opts.instance !== undefined) selected = candidates.find((c) => c.instance === opts.instance);
  else {
    const matches = candidates.filter((c) => c.path === opts.cwd);
    if (matches.length === 1) selected = matches[0];
  }
  if (!selected) {
    result.selection = { status: 'selection_required', candidates };
    result.exitCode = 2;
    return fit(result, opts.maxBytes);
  }
  result.selection = { status: 'selected', ...selected };
  const all = await readLogs(selected.dataDir, result);
  const scoped = all.filter((e) => (!opts.run || e.appRunId === opts.run) && (!opts.session || e.sessionId === opts.session) && (!opts.since || Date.parse(eventTime(e)) >= Date.parse(opts.since)));
  if (all.length) {
    const times = all.map((e) => e.timestamp).sort((a, b) => Date.parse(a) - Date.parse(b));
    result.coverage.observed = { first: times[0], last: times.at(-1) };
    result.coverage.status = scoped.length ? 'readable' : 'no_matches';
    result.exitCode = 0;
  }
  // Counters describe a backend run, not one session; do not imply a recent health
  // record describes another run or an app that has already exited.
  const recent = all.filter((e) => !opts.run || e.appRunId === opts.run).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const latest = recent.at(-1);
  const health = [...recent].reverse().find((e) => e.event === 'diagnostics.health' && e.appRunId === latest?.appRunId && opts.now - Date.parse(e.timestamp) <= 60000 && opts.now >= Date.parse(e.timestamp));
  const exited = latest && recent.some((e) => e.event === 'app.exit' && e.appRunId === latest.appRunId);
  if (health && !exited && ['droppedEvents', 'writeFailures', 'rejectedEvents'].every((key) => health[key] !== undefined)) result.health = { status: 'observed', observedAt: health.timestamp, appRunId: health.appRunId, droppedEvents: health.droppedEvents, writeFailures: health.writeFailures, rejectedEvents: health.rejectedEvents };
  if (opts.command === 'trace') {
    const evidence = trace(scoped, opts, result);
    if (all.length && !evidence.length) result.coverage.status = 'no_matches';
    applyLimit(result, 'events', evidence, opts.limit);
  } else {
    applyLimit(result, 'issues', summarize(scoped), opts.limit);
    const slow = scoped.filter((e) => !failure(e) && e.durationMs >= 2000).sort((a, b) => b.durationMs - a.durationMs || compare(b, a));
    const context = scoped.filter((e) => !failure(e) && CONTEXT.has(e.event) && !(e.durationMs >= 2000)).sort((a, b) => compare(b, a));
    result.omitted.events += Math.max(0, context.length - 10);
    applyLimit(result, 'events', [...slow, ...context.slice(0, 10)], Math.max(0, opts.limit - result.issues.length));
  }
  for (const issue of result.issues) if (issue.evidence.operationId) {
    const e = issue.evidence;
    if (!result.nextQueries.some((q) => q.operation === e.operationId && q.run === e.appRunId)) result.nextQueries.push({ command: 'trace', dataDir: selected.dataDir, operation: e.operationId, run: e.appRunId, ...(e.sessionId ? { session: e.sessionId } : {}) });
  }
  return fit(result, opts.maxBytes);
}

function argumentsFor(argv) {
  const options = { command: argv[0] ?? 'summary' };
  const keys = { '--instance': 'instance', '--data-dir': 'dataDir', '--operation': 'operation', '--session': 'session', '--run': 'run', '--since': 'since', '--limit': 'limit', '--max-bytes': 'maxBytes' };
  for (let i = 1; i < argv.length; i += 2) {
    const key = keys[argv[i]];
    const value = argv[i + 1];
    if (!key || value === undefined || value.startsWith('--') || options[key] !== undefined) return { command: 'invalid' };
    options[key] = ['limit', 'maxBytes'].includes(key) ? (/^\d+$/.test(value) ? Number(value) : NaN) : value;
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try { result = await queryDiagnostics(argumentsFor(process.argv.slice(2))); }
  catch { result = base(); result.coverage.status = 'read_error'; warn(result, 'query_failed'); }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}
