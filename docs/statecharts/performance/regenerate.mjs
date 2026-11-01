import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (key) => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const skill = option('--skill') ?? process.env.STATECHART_SKILL;
const destination = option('--out');
if (!skill || !destination) throw new Error('Usage: node regenerate.mjs --skill /path/to/statechart --out /outside/repo');
const out = resolve(destination);
const rel = relative(here, out);
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Output must be outside this checked-in audit directory.');
mkdirSync(out, { recursive: true });
const cases = [
 { name: 'PartialFailure', title: '性能刷新：独立采样失败', rules: 'MemorySurvivesServiceFailure,DistributionSurvivesServiceFailure', fixed: true, cover: true },
 { name: 'RefreshOverlap', title: '性能刷新：打开面板时的并发扫描', rules: 'NoOverlappingMemoryScans', fixed: true, cover: true },
 { name: 'SnapshotAgreement', title: '性能刷新：同屏内存一致性', rules: 'SameAppMemorySample', fixed: true },
 { name: 'MemoryPartition', title: '内存算法：不同时点采样的边界', rules: 'SegmentsAddToTotal' },
];
for (const c of cases) {
 const model = resolve(here, c.name, 'model', c.name + '.tla');
 const command = [resolve(skill, 'scripts/statechart.mjs'), 'from-spec', model, '--expect-broken', c.rules, '--title', c.title, '--out', resolve(out, c.name), '--png'];
 if (c.fixed) command.push('--fixed', resolve(here, c.name, 'model', c.name + 'Fixed.tla'), '--label', '建议模型（产品未改）');
 if (c.cover) command.push('--cover');
 console.log(JSON.stringify([process.execPath, ...command]));
 const result = spawnSync(process.execPath, command, { stdio: 'inherit', env: process.env });
 if (result.error) throw result.error;
 if (result.status !== 0) process.exit(result.status ?? 1);
}
