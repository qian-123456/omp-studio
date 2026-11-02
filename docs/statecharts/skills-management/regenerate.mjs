import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const skill = process.env.STATECHART || path.join(homedir(), '.agents/skills/statechart/scripts/statechart.mjs');
const vitest = path.join(repo, 'node_modules/vitest/vitest.mjs');
for (const file of [skill, vitest]) {
  if (!existsSync(file)) throw new Error(`Required installed tool not found: ${file}`);
}
const scratch = mkdtempSync(path.join(tmpdir(), 'omp-skills-audit-'));
const published = path.join(here, 'out');
mkdirSync(published, { recursive: true });
cpSync(path.join(here, 'models'), scratch, { recursive: true });
console.log(`All model checking and replay execute outside the repository: ${scratch}`);

const runs = [
  { name: 'current', args: ['SkillsCurrent.tla', '--expect-broken', 'NoSettledStaleRow', '--title', '当前技能移除流程'] },
  { name: 'comparison', args: ['SkillsCurrent.tla', '--fixed', 'SkillsProposed.tla', '--label', '建议方案尚未实现', '--expect-broken', 'NoSettledStaleRow', '--cover', '--title', '技能移除与列表刷新'] },
  { name: 'proposal', args: ['ProposedDesign.tla', '--title', '技能移除建议方案（未实现）'] },
];
const summaries = {};
for (const run of runs) {
  const log = execFileSync(process.execPath, [skill, 'from-spec', ...run.args, '--png', '--out', run.name], { cwd: scratch, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const output = path.join(scratch, run.name);
  writeFileSync(path.join(output, 'command.log'), log);
  const summary = JSON.parse(readFileSync(path.join(output, 'summary.json'), 'utf8'));
  const broken = summary.classes.map((entry) => entry.invariant);
  if (run.name === 'proposal' ? broken.length !== 0 : broken.length !== 1 || broken[0] !== 'NoSettledStaleRow') {
    throw new Error(`Unexpected broken rules in ${run.name}: ${JSON.stringify(broken)}`);
  }
  if (Object.values(summary.uncited || {}).some((conditions) => conditions.length)) {
    throw new Error(`Uncited code-model conditions in ${run.name}`);
  }
  if ((summary.brokenProperties || []).length) throw new Error(`Unexpected broken property in ${run.name}`);
  cpSync(output, path.join(published, run.name), { recursive: true });
  summaries[run.name] = { modelStates: summary.modelStates, modelTransitions: summary.modelTransitions, chartStates: summary.chartStates, chartTransitions: summary.chartTransitions, rulesBroken: broken };
  console.log(log);
}

const replay = path.join(scratch, 'replay');
mkdirSync(replay);
symlinkSync(path.join(repo, 'node_modules'), path.join(replay, 'node_modules'), 'dir');
const observations = path.join(replay, 'observations.json');
const template = readFileSync(path.join(here, 'replay.case.ts.txt'), 'utf8');
writeFileSync(path.join(replay, 'deletion.replay.test.ts'), template.replaceAll('__REPO_ROOT__', repo).replaceAll('__OBSERVATIONS__', observations));
const config = { root: replay, cacheDir: path.join(replay, '.vite'), server: { fs: { allow: [replay, repo] } }, test: { include: ['deletion.replay.test.ts'], setupFiles: [path.join(repo, 'src/test/setupLocale.ts')], environment: 'node', pool: 'forks', maxWorkers: 1, minWorkers: 1, fileParallelism: false } };
writeFileSync(path.join(replay, 'vitest.config.mjs'), `export default ${JSON.stringify(config, null, 2)};`);
const resultFile = path.join(replay, 'vitest-results.json');
const replayArgs = [vitest, 'run', '--config', path.join(replay, 'vitest.config.mjs'), '--reporter=verbose', '--reporter=json', `--outputFile.json=${resultFile}`];
const replayLog = execFileSync(process.execPath, replayArgs, { cwd: replay, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const results = JSON.parse(readFileSync(resultFile, 'utf8'));
if (!results.success || results.numPassedTests !== 3 || results.numFailedTests !== 0) throw new Error('Unexpected replay result');
const replayOutput = path.join(published, 'replay');
mkdirSync(replayOutput, { recursive: true });
for (const file of ['observations.json', 'vitest-results.json']) cpSync(path.join(replay, file), path.join(replayOutput, file));
writeFileSync(path.join(replayOutput, 'execution.json'), JSON.stringify({ command: [process.execPath, ...replayArgs], cwd: replay, exitCode: 0, boundary: 'Actual frontend store, mocked IPC/config/toast; no real file deletion or native UI replay' }, null, 2));
writeFileSync(path.join(replayOutput, 'run.log'), replayLog);
writeFileSync(path.join(published, 'verification.json'), JSON.stringify({ summaries, replay: { passed: results.numPassedTests, failed: results.numFailedTests }, scratch }, null, 2));
console.log(replayLog);
console.log(`Published verified artifacts to ${published}`);
