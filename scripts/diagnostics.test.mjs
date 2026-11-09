import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { queryDiagnostics } from './diagnostics.mjs';

const CLI = fileURLToPath(new URL('./diagnostics.mjs', import.meta.url));
const NOW = Date.now();
const time = (offset = 0) => new Date(NOW + offset).toISOString();
const id = (n) => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const RUN = id(1), SESSION = id(2), OPERATION = id(3);
const SECRET = 'DIAGNOSTIC_CREDENTIAL_PROMPT_MESSAGE_SENTINEL';
let sequence = 100;
function event(name = 'rpc.command_finished', fields = {}, options = {}) {
  const { operation = OPERATION, timestamp = time(-1000), level = 'ERROR', ...extra } = options;
  return { timestamp, level, target: 'ompws.diagnostics', fields: { schemaVersion: 1, eventId: id(sequence++), appRunId: RUN, appPid: 456, event: name, origin: name.startsWith('frontend.') ? 'frontend' : 'backend', sessionId: SESSION, childPid: 789, requestId: 'req_1', command: 'prompt', outcome: 'error', code: 'command_timeout', ...fields }, ...(operation ? { span: { name: 'diagnostic_operation', operationId: operation } } : {}), ...extra };
}
const jsonl = (events) => events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omp-diagnostics-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const checkoutRoot = path.join(root, 'checkout');
  const dataDir = path.join(root, 'main-data');
  await fs.mkdir(path.join(checkoutRoot, '.cache', 'dev-worktree'), { recursive: true });
  await fs.mkdir(path.join(dataDir, 'diagnostics'), { recursive: true });
  const current = path.join(dataDir, 'diagnostics', 'events.jsonl');
  const previous = path.join(dataDir, 'diagnostics', 'events.previous.jsonl');
  const write = (records) => fs.writeFile(current, jsonl(records));
  const manifest = async (slug, data, cwd = checkoutRoot, extras = {}) => fs.writeFile(path.join(checkoutRoot, '.cache', 'dev-worktree', `${slug}.json`), JSON.stringify({ path: cwd, dataDir: data, pid: 333, ...extras }));
  const query = (options = {}) => queryDiagnostics({ checkoutRoot, cwd: checkoutRoot, clock: () => NOW, dataDir, ...options });
  return { root, checkoutRoot, dataDir, current, previous, write, manifest, query };
}
function bounded(result, bytes = 8192) {
  assert.ok(Buffer.byteLength(`${JSON.stringify(result)}\n`) <= bytes);
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'selection', 'coverage', 'health', 'issues', 'events', 'truncated', 'omitted', 'nextQueries', 'exitCode']);
  assert.equal(JSON.stringify(result).includes(SECRET), false);
}
function cli(args, options = {}) {
  const child = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 10000, ...options });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, '');
  const result = JSON.parse(child.stdout);
  assert.equal(child.status, result.exitCode);
  assert.equal(child.stdout.endsWith('\n'), true);
  return { ...child, result };
}

test('manifests isolate two instances and label only launcherPid; selection uses checkout cache, not cwd cache', async (t) => {
  const f = await fixture(t);
  const second = path.join(f.root, 'second-data');
  const otherCwd = path.join(f.root, 'other-checkout');
  await fs.mkdir(path.join(second, 'diagnostics'), { recursive: true });
  await fs.mkdir(path.join(otherCwd, '.cache', 'dev-worktree'), { recursive: true });
  await f.write([event()]);
  await fs.writeFile(path.join(second, 'diagnostics', 'events.jsonl'), jsonl([event('app.panic', { command: undefined, code: 'unexpected_error' })]));
  await f.manifest('main', f.dataDir, f.checkoutRoot, { token: SECRET, payload: SECRET, log: SECRET });
  await f.manifest('second', second, otherCwd);
  await fs.writeFile(path.join(otherCwd, '.cache', 'dev-worktree', 'main.json'), JSON.stringify({ path: otherCwd, dataDir: '/nonexistent-decoy' }));
  const one = await f.query({ dataDir: undefined, instance: 'main', cwd: otherCwd });
  const two = await f.query({ dataDir: undefined, instance: 'second' });
  assert.equal(one.selection.dataDir, f.dataDir);
  assert.equal(one.selection.launcherPid, 333);
  assert.equal('appPid' in one.selection, false);
  assert.equal(one.issues[0].evidence.appPid, 456);
  assert.equal(two.issues[0].evidence.event, 'app.panic');
  assert.equal((await f.query({ dataDir: undefined, cwd: otherCwd })).selection.instance, 'second');
  const instances = await f.query({ command: 'instances', dataDir: undefined });
  assert.equal(instances.exitCode, 0);
  assert.deepEqual(instances.selection.candidates.filter((c) => c.instance !== 'installed').map((c) => c.instance), ['main', 'second']);
  bounded(instances);
  await f.manifest('duplicate', f.dataDir, f.checkoutRoot);
  const ambiguous = await f.query({ dataDir: undefined });
  assert.equal(ambiguous.exitCode, 2);
  assert.equal(ambiguous.selection.status, 'selection_required');
  assert.equal((await f.query({ dataDir: undefined, cwd: f.root })).exitCode, 2);
  bounded(one); bounded(two);
});

test('event dedup precedes operation dedup and cross-layer issue grouping; unknown fields cannot escape', async (t) => {
  const f = await fixture(t);
  const front = event('frontend.ipc_finished', { command: 'rpc_send', code: 'unexpected_error', source: 'ipc', message: SECRET, args: { token: SECRET }, payload: SECRET });
  const back = event('rpc.command_finished', { code: 'command_timeout', message: SECRET }, { timestamp: time(-900), token: SECRET });
  back.span.password = SECRET;
  const another = event('rpc.command_finished', {}, { operation: id(4), timestamp: time(-800) });
  const differentRun = event('rpc.command_finished', { appRunId: id(5) }, { operation: OPERATION, timestamp: time(-700) });
  await fs.writeFile(f.previous, jsonl([front, back]));
  await f.write([front, back, another, differentRun]);
  const result = await f.query();
  assert.equal(result.coverage.counts.duplicates, 2);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].operationCount, 3);
  assert.equal(result.issues[0].evidence.origin, 'backend');
  assert.equal(result.issues[0].evidence.code, 'command_timeout');
  assert.equal(result.issues[0].firstObservedAt, front.timestamp);
  assert.equal(result.nextQueries[0].operation, OPERATION);
  assert.equal(result.nextQueries[0].run, RUN);
  assert.equal(result.health.status, 'unknown');
  bounded(result);
});

test('trace uses exact run/session/PID context, never req_N proximity, and marks missing completion explicitly', async (t) => {
  const f = await fixture(t);
  const start = event('rpc.command_started', { outcome: undefined, code: undefined }, { level: 'INFO', timestamp: time(-2000) });
  const lifecycle = (fields, offset) => event('rpc.lifecycle', { code: undefined, outcome: 'observed', source: 'process_exit', ...fields }, { operation: null, level: 'INFO', timestamp: time(offset) });
  const before = Array.from({ length: 12 }, (_, i) => lifecycle({}, -5000 + i * 100));
  const after = Array.from({ length: 12 }, (_, i) => lifecycle({}, -1000 + i * 10));
  const unrelated = [lifecycle({ appRunId: id(11) }, -1900), lifecycle({ childPid: 790 }, -1800), lifecycle({ sessionId: id(12) }, -1700), lifecycle({ childPid: undefined }, -1600)];
  const otherOperation = event('rpc.command_finished', {}, { operation: id(13) });
  await f.write([...before, start, ...unrelated, otherOperation, ...after]);
  const result = await f.query({ command: 'trace', operation: OPERATION, maxBytes: 65536 });
  assert.equal(result.coverage.completion, 'not_observed');
  const context = result.events.filter((e) => e.contextOnly);
  assert.equal(context.length, 20);
  assert.ok(context.every((e) => e.appRunId === RUN && e.sessionId === SESSION && e.childPid === 789));
  assert.equal(result.events.filter((e) => !e.contextOnly).length, 1);
  assert.ok(!result.events.some((e) => e.eventId === otherOperation.fields.eventId));
  assert.equal(JSON.stringify(result).includes('crash'), false);
  await f.write([event('frontend.ipc_started', { childPid: undefined, code: undefined, outcome: undefined }, { level: 'INFO' }), lifecycle({}, -2000)]);
  const noIdentity = await f.query({ command: 'trace', operation: OPERATION });
  assert.equal(noIdentity.events.length, 1);
  assert.equal(noIdentity.coverage.completion, 'not_observed');
  bounded(result, 65536); bounded(noIdentity);
});

test('filters, default one-hour window, trace retention, slow events and limits are deterministic', async (t) => {
  const f = await fixture(t);
  const old = event('rpc.command_finished', {}, { timestamp: time(-7200000), operation: id(20) });
  const observedFirst = event('frontend.error', { source: 'window_error', occurredAt: time(-300), code: 'js_error', sourceFile: 'src/main.tsx', sourceLine: 50, sourceColumn: 1, frames: 'src/main.tsx:50:1' }, { timestamp: time(-500) });
  const slow = event('rpc.command_finished', { outcome: 'ok', code: undefined, durationMs: 2500 }, { level: 'WARN', operation: id(21) });
  const success = event('rpc.command_finished', { outcome: 'ok', code: undefined }, { level: 'INFO', operation: id(22) });
  const secondSession = event('app.panic', { sessionId: id(23), code: 'unexpected_error' }, { operation: null });
  await f.write([old, observedFirst, slow, success, secondSession]);
  const summary = await f.query();
  assert.equal(summary.issues.length, 2);
  assert.equal(summary.events.length, 1);
  assert.equal(summary.events[0].eventId, slow.fields.eventId);
  assert.equal(summary.coverage.window.since, time(-3600000));
  const trace = await f.query({ command: 'trace', operation: id(20) });
  assert.equal(trace.events.length, 1);
  assert.equal(trace.coverage.window.since, null);
  assert.equal(trace.coverage.completion, 'observed');
  const session = await f.query({ session: SESSION, run: RUN, since: time(-400) });
  assert.equal(session.issues.length, 1);
  assert.equal(session.issues[0].evidence.eventId, observedFirst.fields.eventId);
  const none = await f.query({ run: id(999) });
  assert.equal(none.coverage.status, 'no_matches'); assert.equal(none.exitCode, 0);
  const missingOperation = await f.query({ command: 'trace', operation: id(999) });
  assert.equal(missingOperation.coverage.status, 'no_matches');
  assert.equal(missingOperation.coverage.completion, 'not_observed');
  const limited = await f.query({ limit: 1 });
  assert.equal(limited.issues.length, 1); assert.equal(limited.omitted.issues, 1); assert.equal(limited.truncated, true);
  bounded(summary); bounded(session); bounded(limited);
});

test('validates all argument ranges, identifiers and UTC dates with structured exit 2', async (t) => {
  const f = await fixture(t);
  const invalid = [
    { command: 'unknown' }, { instance: '../main', dataDir: undefined }, { instance: 'main' },
    { limit: 0 }, { limit: 201 }, { limit: 1.5 }, { limit: '50' }, { maxBytes: 2047 }, { maxBytes: 65537 },
    { run: SECRET }, { session: SECRET }, { command: 'trace' }, { command: 'trace', operation: SECRET },
    { operation: OPERATION }, { since: '2026-02-30T00:00:00Z' }, { since: '2026-01-01T00:00:00+00:00' },
    { command: 'instances' }, { clock: () => NaN }, { dataDir: '' },
  ];
  for (const options of invalid) {
    const result = await f.query(options);
    assert.equal(result.exitCode, 2, JSON.stringify(options));
    assert.equal(result.selection.status, 'invalid_arguments'); bounded(result);
  }
  await f.write([event()]);
  for (const limit of [1, 200]) for (const maxBytes of [2048, 65536]) {
    const valid = await f.query({ limit, maxBytes }); assert.equal(valid.exitCode, 0); bounded(valid, maxBytes);
  }
});

test('separates missing, uninitialized (including legacy-only), empty, unreadable and partial data', async (t) => {
  const f = await fixture(t);
  const absent = await f.query({ dataDir: path.join(f.root, 'absent') });
  assert.equal(absent.coverage.status, 'missing'); assert.equal(absent.exitCode, 3);
  await fs.rmdir(path.join(f.dataDir, 'diagnostics'));
  await fs.writeFile(path.join(f.dataDir, 'rpc-lifecycle.jsonl'), jsonl([event('app.panic', { payload: SECRET })]));
  const legacy = await f.query();
  assert.equal(legacy.coverage.status, 'not_initialized'); assert.equal(legacy.exitCode, 3);
  await fs.mkdir(path.join(f.dataDir, 'diagnostics'));
  await f.write([]);
  const empty = await f.query();
  assert.equal(empty.coverage.status, 'not_initialized'); assert.equal(empty.health.status, 'unknown');
  const emptyCli = cli(['summary', '--data-dir', f.dataDir]);
  assert.equal(emptyCli.status, 3); assert.equal(emptyCli.result.coverage.status, 'not_initialized');
  await fs.writeFile(f.current, 'not json\n');
  const unreadable = await f.query();
  assert.equal(unreadable.coverage.status, 'read_error'); assert.equal(unreadable.exitCode, 3);
  const corruptCli = cli(['summary', '--data-dir', f.dataDir]);
  assert.equal(corruptCli.status, 3); assert.equal(corruptCli.result.coverage.status, 'read_error');
  await fs.writeFile(f.previous, jsonl([event()]));
  const partial = await f.query();
  assert.equal(partial.exitCode, 0); assert.equal(partial.coverage.partial, true); assert.equal(partial.coverage.counts.invalidJson, 1);
  for (const result of [absent, legacy, empty, unreadable, partial]) bounded(result);
});

test('rejects corrupted/unknown schemas and malicious known fields; bounded scanning recovers after oversized lines', async (t) => {
  const f = await fixture(t);
  const invalid = [
    event('rpc.command_finished', { schemaVersion: 2, token: SECRET }),
    event(SECRET), event('rpc.command_finished', { code: SECRET }), event('rpc.command_finished', { command: SECRET.toLowerCase() }),
    event('frontend.error', { sourceFile: 'src/../secrets', payload: SECRET }),
    event('frontend.error', { frames: `src/main.tsx:1:1\nhttps://x/?token=${SECRET}` }),
    event('rpc.command_finished', { sessionId: SECRET }), event('rpc.command_finished', { requestId: SECRET }),
    event('rpc.command_finished', { durationMs: -1 }), event('rpc.command_finished', { childPid: SECRET }),
    event('rpc.command_finished', { source: SECRET }), event('rpc.command_finished', { phase: SECRET }),
    event('rpc.command_finished', {}, { span: { operationId: SECRET } }),
    event('rpc.command_finished', {}, { timestamp: SECRET }), event('rpc.command_finished', {}, { target: SECRET }),
  ];
  const safe = event('frontend.error', { source: 'window_error', code: 'js_error', message: SECRET, error: { token: SECRET }, credential: SECRET });
  await fs.writeFile(f.current, `${jsonl(invalid)}{bad json}\n${'x'.repeat(20000)}\n${jsonl([safe])}{"partial":"${SECRET}"`);
  const result = await f.query();
  assert.equal(result.exitCode, 0); assert.equal(result.coverage.partial, true);
  assert.equal(result.coverage.counts.unknownSchemas, 1);
  assert.equal(result.coverage.counts.invalidRecords, invalid.length - 1);
  assert.equal(result.coverage.counts.invalidJson, 1);
  assert.equal(result.coverage.counts.oversizedLines, 1);
  assert.equal(result.coverage.counts.incompleteLines, 1);
  assert.equal(result.issues.length, 1); bounded(result);
});

test('line boundary and combined read budget are byte-bounded, not character-bounded', async (t) => {
  const f = await fixture(t);
  const record = event('rpc.command_finished', { message: '' });
  const prefix = JSON.stringify(record);
  record.fields.message = 'x'.repeat(8191 - Buffer.byteLength(prefix));
  assert.equal(Buffer.byteLength(jsonl([record])), 8192);
  await fs.writeFile(f.previous, jsonl([record]));
  await fs.writeFile(f.current, `${'x'.repeat(8192)}\n${jsonl([event()])}`);
  const boundary = await f.query();
  assert.equal(boundary.coverage.counts.records, 2);
  assert.equal(boundary.coverage.counts.oversizedLines, 1);
  await fs.writeFile(f.previous, 'x'.repeat(3 * 1024 * 1024));
  await fs.writeFile(f.current, 'y'.repeat(3 * 1024 * 1024));
  const boundedRead = await f.query();
  assert.equal(boundedRead.coverage.counts.bytesRead, 4 * 1024 * 1024);
  assert.ok(boundedRead.coverage.warnings.includes('read_budget_exhausted'));
  assert.equal(boundedRead.coverage.partial, true); bounded(boundedRead);
});

test('the final CLI envelope fits exactly 8192 bytes including LF, without truncating an evidence item', async (t) => {
  const f = await fixture(t);
  const records = Array.from({ length: 8 }, () => event('rpc.command_finished', { frames: 'src/a:1:1' }));
  const pads = records.map(() => 0);
  let measured;
  for (let attempt = 0; attempt < 30; attempt++) {
    await f.write(records);
    measured = await f.query({ command: 'trace', operation: OPERATION, maxBytes: 65536 });
    const difference = 8192 - Buffer.byteLength(`${JSON.stringify(measured)}\n`);
    if (difference === 0) break;
    const index = pads.findIndex((n) => difference > 0 ? n < 500 : n > 0);
    assert.ok(index >= 0, 'fixture has enough safe frame capacity to reach the byte boundary');
    pads[index] += difference > 0 ? Math.min(difference, 500 - pads[index]) : Math.max(difference, -pads[index]);
    records[index].fields.frames = `src/a${'a'.repeat(pads[index])}:1:1`;
  }
  assert.equal(Buffer.byteLength(`${JSON.stringify(measured)}\n`), 8192);
  const exact = cli(['trace', '--data-dir', f.dataDir, '--operation', OPERATION]);
  assert.equal(Buffer.byteLength(exact.stdout), 8192);
  assert.equal(exact.status, 0); assert.equal(exact.result.truncated, false);
  assert.equal(exact.result.events.length, 8);
  const reduced = cli(['trace', '--data-dir', f.dataDir, '--operation', OPERATION, '--max-bytes', '8191']);
  assert.ok(Buffer.byteLength(reduced.stdout) <= 8191);
  assert.equal(reduced.result.events.length, 7);
  assert.equal(reduced.result.omitted.events, 1);
  assert.equal(reduced.result.truncated, true);
});

test('symlinks in selected root, diagnostic directory, log files and manifests are never followed', async (t) => {
  const f = await fixture(t);
  await f.write([event()]);
  const alias = path.join(f.root, 'alias');
  await fs.symlink(f.dataDir, alias);
  const rootLink = await f.query({ dataDir: alias });
  assert.equal(rootLink.coverage.status, 'read_error');
  await fs.rename(path.join(f.dataDir, 'diagnostics'), path.join(f.root, 'stored'));
  await fs.symlink(path.join(f.root, 'stored'), path.join(f.dataDir, 'diagnostics'));
  const dirLink = await f.query();
  assert.equal(dirLink.coverage.status, 'read_error');
  await fs.unlink(path.join(f.dataDir, 'diagnostics'));
  await fs.rename(path.join(f.root, 'stored'), path.join(f.dataDir, 'diagnostics'));
  await fs.rename(f.current, path.join(f.root, 'secret-log'));
  await fs.symlink(path.join(f.root, 'secret-log'), f.current);
  const logLink = await f.query();
  assert.equal(logLink.exitCode, 3); assert.equal(logLink.coverage.counts.records, 0);
  const manifestPath = path.join(f.checkoutRoot, '.cache', 'dev-worktree', 'main.json');
  await fs.writeFile(path.join(f.root, 'external.json'), JSON.stringify({ path: f.checkoutRoot, dataDir: f.dataDir, token: SECRET }));
  await fs.symlink(path.join(f.root, 'external.json'), manifestPath);
  const manifestLink = await f.query({ dataDir: undefined, instance: 'main' });
  assert.equal(manifestLink.exitCode, 2); assert.equal(manifestLink.selection.candidates.some((c) => c.instance === 'main'), false);
  for (const r of [rootLink, dirLink, logLink, manifestLink]) bounded(r);
});

test('accepts producer-shaped stdin, stdout and fatal startup phases without echoing unknown fields', async (t) => {
  const f = await fixture(t);
  const processFields = { sessionId: SESSION, childPid: 789 };
  const cases = [
    ['rpc.io_failed', { ...processFields, source: 'stdin', phase: 'write', outcome: 'error', code: 'io_other' }],
    ['rpc.io_failed', { ...processFields, source: 'stdout', phase: 'read', outcome: 'error', code: 'io_permission_denied' }],
    ['rpc.stdout_closed', { ...processFields, source: 'stdout', phase: 'read', outcome: 'error', code: 'io_permission_denied' }],
    ['rpc.stdout_closed', { ...processFields, source: 'stdout', phase: 'eof', outcome: 'observed' }],
    ...['ensure_dirs', 'database', 'global_workspace', 'tauri_setup', 'tauri_build'].map((phase) => ['app.startup_failed', { source: 'startup', phase, outcome: 'error' }]),
  ];
  for (const [name, fields] of cases) {
    const record = event(name, {
      sessionId: undefined, childPid: undefined, requestId: undefined, command: undefined,
      code: undefined, ...fields, message: SECRET,
    }, { operation: null, level: fields.outcome === 'error' ? 'ERROR' : 'INFO' });
    await f.write([record]);
    const result = await f.query();
    assert.equal(result.exitCode, 0, fields.phase);
    assert.equal(result.coverage.counts.records, 1, fields.phase);
    assert.equal(result.coverage.counts.invalidRecords, 0, fields.phase);
    const evidence = [...result.events, ...result.issues.map((issue) => issue.evidence)];
    assert.equal(evidence.length, 1, fields.phase);
    assert.equal(evidence[0].event, name);
    assert.equal(evidence[0].phase, fields.phase);
    assert.equal(evidence[0].source, fields.source);
    assert.equal(evidence[0].requestId, undefined);
    assert.equal(evidence[0].command, undefined);
    bounded(result);
  }
});

test('health is observed only for fresh counters from the latest run, never inferred from missing errors', async (t) => {
  const f = await fixture(t);
  const health = event('diagnostics.health', { code: undefined, outcome: undefined, droppedEvents: 2, writeFailures: 1, rejectedEvents: 3 }, { operation: null, level: 'INFO', timestamp: time(-10000) });
  await f.write([health]);
  const observed = await f.query();
  assert.deepEqual(observed.health, { status: 'observed', observedAt: health.timestamp, appRunId: RUN, droppedEvents: 2, writeFailures: 1, rejectedEvents: 3 });
  const stale = await f.query({ clock: () => NOW + 120000 }); assert.equal(stale.health.status, 'unknown');
  await f.write([health, event('app.exit', { code: undefined, outcome: 'ok' }, { level: 'INFO', operation: null })]);
  assert.equal((await f.query()).health.status, 'unknown');
  const exit = event('app.exit', { code: undefined, outcome: 'ok' }, { level: 'INFO', operation: null, timestamp: time(-5000) });
  const finalHealth = { ...health, timestamp: time(-4990) };
  await f.write([exit, finalHealth]);
  const afterExit = await f.query();
  assert.equal(afterExit.coverage.counts.records, 2);
  assert.equal(afterExit.coverage.observed.last, finalHealth.timestamp);
  assert.deepEqual(afterExit.health, { status: 'unknown', observedAt: null });
  bounded(afterExit);
  await f.write([health, event('app.started', { appRunId: id(88), code: undefined, outcome: undefined, appVersion: '1.2.3', debugBuild: true }, { level: 'INFO', operation: null })]);
  assert.equal((await f.query()).health.status, 'unknown');
  await f.write([event('rpc.command_finished', { outcome: 'ok', code: undefined }, { level: 'INFO' })]);
  assert.equal((await f.query()).health.status, 'unknown'); bounded(observed);
});

test('long manifest paths, candidates and nextQueries cannot exceed final UTF-8 budget', async (t) => {
  const f = await fixture(t);
  const long = '/待'.repeat(3000);
  for (let i = 0; i < 30; i++) await f.manifest(`candidate-${i}`, long, long, { secret: SECRET });
  const one = await f.query({ dataDir: undefined, cwd: f.root, maxBytes: 2048 });
  const two = await f.query({ dataDir: undefined, cwd: f.root, maxBytes: 2048 });
  bounded(one, 2048); assert.deepEqual(one, two); assert.ok(one.omitted.candidates > 0);
  const selected = await f.query({ dataDir: long, maxBytes: 2048 });
  bounded(selected, 2048); assert.ok(selected.omitted.metadata > 0);
  const records = Array.from({ length: 40 }, (_, i) => event('frontend.error', { code: 'js_error', sourceFile: `src/file-${i}.tsx`, frames: `src/${'file'.repeat(100)}.tsx:1:1` }, { operation: id(2000 + i) }));
  await f.write(records);
  const compact = await f.query({ maxBytes: 2048, limit: 200 });
  bounded(compact, 2048); assert.equal(compact.truncated, true);
  assert.ok(compact.omitted.issues > 0); assert.ok(compact.omitted.nextQueries > 0);
});

async function mtimes(root) {
  const output = {};
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      const stat = await fs.lstat(p);
      output[p] = [stat.mtimeMs, stat.size, stat.mode];
      if (entry.isDirectory()) await visit(p);
    }
  }
  await visit(root);
  return output;
}

test('real CLI summary and trace enforce stdout bytes/exits and perform no network, application start or writes', async (t) => {
  const f = await fixture(t);
  const records = Array.from({ length: 70 }, (_, i) => event('rpc.command_finished', { sourceFile: `src-tauri/src/file-${i}.rs`, sourceLine: i + 1 }, { operation: id(3000 + i) }));
  records.push(event('frontend.ipc_finished', { command: 'rpc_send', message: SECRET }));
  await f.write(records);
  await fs.writeFile(path.join(f.dataDir, 'agent.db'), SECRET);
  await fs.writeFile(path.join(f.dataDir, 'session.jsonl'), SECRET);
  const guard = path.join(f.root, 'readonly-guard.cjs');
  await fs.writeFile(guard, `
const fail = () => { throw new Error('forbidden side effect'); };
// Load dependent builtins before installing guards; never replace constructors
// whose prototypes Node uses while initializing HTTP/TLS internals.
const modules = Object.fromEntries([
  'node:net', 'node:tls', 'node:dgram', 'node:http', 'node:https',
  'node:http2', 'node:dns', 'node:child_process',
].map((name) => [name, require(name)]));
const actions = {
  'node:net': ['connect', 'createConnection', 'createServer'],
  'node:tls': ['connect', 'createServer'],
  'node:dgram': ['createSocket'],
  'node:http': ['request', 'get', 'createServer'],
  'node:https': ['request', 'get', 'createServer'],
  'node:http2': ['connect', 'createServer', 'createSecureServer'],
  'node:child_process': ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
};
for (const [name, methods] of Object.entries(actions)) {
  for (const method of methods) modules[name][method] = fail;
}
for (const [prototype, methods] of [
  [modules['node:net'].Socket.prototype, ['connect']],
  [modules['node:net'].Server.prototype, ['listen']],
  [modules['node:dgram'].Socket.prototype, ['bind', 'connect', 'send']],
  [modules['node:child_process'].ChildProcess.prototype, ['spawn']],
]) for (const method of methods) prototype[method] = fail;
const dns = modules['node:dns'];
for (const api of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const key of Object.getOwnPropertyNames(api)) {
    if (/^(lookup|resolve|reverse)/.test(key) && typeof api[key] === 'function') api[key] = fail;
  }
}
global.fetch = fail;
global.WebSocket = fail;
const fs = require('node:fs/promises');
for (const name of ['readFile','writeFile','appendFile','mkdir','rename','unlink','rm','rmdir','chmod','truncate']) fs[name] = fail;
const open = fs.open;
fs.open = async (file, flags, ...args) => {
  if (!/\\/(?:events|events\\.previous)\\.jsonl$/.test(String(file)) || (flags & 3) !== 0) fail();
  return open(file, flags, ...args);
};
require('node:module').syncBuiltinESMExports();
`);
  const before = await mtimes(f.root);
  const opts = { cwd: f.root, env: { ...process.env, NODE_OPTIONS: `--require=${guard}` } };
  const summary = cli(['summary', '--data-dir', f.dataDir, '--since', '2020-01-01T00:00:00Z'], opts);
  assert.equal(summary.status, 0); assert.ok(Buffer.byteLength(summary.stdout) <= 8192);
  assert.equal(summary.result.truncated, true); assert.ok(summary.result.issues.length > 0);
  const trace = cli(['trace', '--data-dir', f.dataDir, '--operation', OPERATION], opts);
  assert.equal(trace.status, 0); assert.ok(Buffer.byteLength(trace.stdout) <= 8192);
  assert.equal(trace.result.events[0].event, 'frontend.ipc_finished');
  assert.equal(trace.result.coverage.completion, 'observed');
  const small = cli(['summary', '--data-dir', f.dataDir, '--max-bytes', '2048'], opts);
  assert.ok(Buffer.byteLength(small.stdout) <= 2048); assert.equal(small.status, 0);
  const none = cli(['summary', '--data-dir', f.dataDir, '--run', id(999)], opts);
  assert.equal(none.status, 0); assert.equal(none.result.coverage.status, 'no_matches');
  const missing = cli(['summary', '--data-dir', path.join(f.root, 'absent')], opts);
  assert.equal(missing.status, 3);
  for (const args of [['trace', '--data-dir', f.dataDir], ['summary', '--bogus', SECRET], ['summary', '--limit', '2', '--limit', '3'], ['summary', '--max-bytes', '1'], ['summary', '--since']]) {
    assert.equal(cli(args, opts).status, 2);
  }
  for (const output of [summary, trace, small, none, missing]) assert.equal(output.stdout.includes(SECRET), false);
  assert.deepEqual(await mtimes(f.root), before);
});

test('real rotation race after open retains readable evidence and reports partial without retrying', async (t) => {
  const f = await fixture(t);
  await f.write([event()]);
  const hook = path.join(f.root, 'rotation-race.cjs');
  // Simulate an external writer renaming after the reader has obtained its FD.
  // The query still reads the real old inode; its path check must detect replacement.
  await fs.writeFile(hook, `
const fs = require('node:fs/promises');
const open = fs.open;
fs.open = async function(file, ...args) {
  const handle = await open(file, ...args);
  if (String(file).endsWith('/events.jsonl')) {
    await fs.rename(file, String(file) + '.rotated');
    await fs.writeFile(file, '');
  }
  return handle;
};
`);
  const race = cli(['summary', '--data-dir', f.dataDir, '--since', '2020-01-01T00:00:00Z'], { env: { ...process.env, NODE_OPTIONS: `--require=${hook}` } });
  assert.equal(race.status, 0);
  assert.equal(race.result.coverage.partial, true);
  assert.equal(race.result.coverage.counts.races, 1);
  assert.equal(race.result.issues.length, 1);
  bounded(race.result);
});

test('between-file rotation exposes missing coverage for first and subsequent rotations without rereading', async (t) => {
  for (const hasPrevious of [false, true]) await t.test(hasPrevious ? 'replaces already-read previous' : 'creates previously absent previous', async (t) => {
    const f = await fixture(t);
    const older = event('app.panic', { message: SECRET });
    const missed = event('rpc.command_finished', { message: SECRET });
    const replacement = event('app.startup_failed', { source: 'startup', phase: 'database', message: SECRET }, { operation: null });
    const previousBytes = hasPrevious ? jsonl([older]) : '';
    if (hasPrevious) await fs.writeFile(f.previous, previousBytes);
    await f.write([missed]);
    const hook = path.join(f.root, 'between-file-rotation.cjs');
    // Rotate before current's openSafe lstat, after previous's full read/check/close.
    // The first current lstat is the whole-query snapshot; neither FD check races.
    await fs.writeFile(hook, `
const fs = require('node:fs/promises');
const open = fs.open;
const lstat = fs.lstat;
let currentStats = 0;
fs.lstat = async function(file, ...args) {
  if (String(file).endsWith('/events.jsonl') && ++currentStats === 2) {
    await fs.rename(file, ${JSON.stringify(f.previous)});
    await fs.writeFile(file, ${JSON.stringify(jsonl([replacement]))});
  }
  return lstat(file, ...args);
};
const opens = new Map();
fs.open = async function(file, ...args) {
  const name = String(file);
  const count = (opens.get(name) || 0) + 1;
  opens.set(name, count);
  if (count > 1) throw new Error('unexpected reread');
  return open(file, ...args);
};
`);
    const race = cli(['summary', '--data-dir', f.dataDir, '--since', '2020-01-01T00:00:00Z'], { env: { ...process.env, NODE_OPTIONS: `--require=${hook}` } });
    assert.equal(race.status, 0);
    assert.equal(race.result.coverage.partial, true);
    assert.equal(race.result.coverage.counts.races, 2);
    assert.equal(race.result.coverage.counts.readFailures, 0);
    assert.equal(race.result.coverage.counts.records, hasPrevious ? 2 : 1);
    assert.equal(race.result.coverage.counts.bytesRead, Buffer.byteLength(previousBytes + jsonl([replacement])));
    assert.ok(race.result.coverage.warnings.includes('file_changed_during_read'));
    assert.ok(race.result.coverage.warnings.includes('incomplete_coverage'));
    const evidenceIds = race.result.issues.map((issue) => issue.evidence.eventId);
    assert.ok(evidenceIds.includes(replacement.fields.eventId));
    assert.equal(evidenceIds.includes(older.fields.eventId), hasPrevious);
    assert.equal(evidenceIds.includes(missed.fields.eventId), false);
    assert.equal(race.stdout.includes(SECRET), false);
    bounded(race.result);
  });
});
