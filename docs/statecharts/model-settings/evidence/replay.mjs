import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync, existsSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
const here = realpathSync(dirname(fileURLToPath(import.meta.url)));
const repo = process.env.OMP_REPO;
if (!repo) throw new Error('Set OMP_REPO to the read-only source checkout');
const link = resolve(here,'node_modules');
const created = !existsSync(link);
if (created) symlinkSync(resolve(repo,'node_modules'),link,'dir');
try {
 const result = spawnSync(process.execPath,[resolve(repo,'node_modules/vitest/vitest.mjs'),'run','--config',resolve(here,'vitest.config.mjs')],{cwd:repo,encoding:'utf8',env:{...process.env,OMP_REPO:repo,OMP_AUDIT_OUTPUT:resolve(here,'replay-result.json')}});
 writeFileSync(resolve(here,'replay.log'),(result.stdout??'')+(result.stderr??''));
 process.stdout.write(result.stdout??''); process.stderr.write(result.stderr??'');
 process.exitCode = result.status ?? 1;
} finally { if(created) unlinkSync(link); }
