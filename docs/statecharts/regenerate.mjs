#!/usr/bin/env node
// Regenerates every statechart in this directory from the published TLA+ models, into an
// EXTERNAL scratch directory, and compares the result with the published charts.
// Standalone: Node >= 18, no dependencies, no absolute paths baked in.
//
//   node regenerate.mjs --skill DIR --out SCRATCH [--only slice/model[,..]] [--tla2tools JAR] [--java BIN] [--theme NAME]
//   node regenerate.mjs verify          # offline integrity check: hashes, .mmd/.png pairs, forbidden paths
//
// Env fallbacks: STATECHART_SKILL, TLA2TOOLS, JAVA. DIR is the statechart skill directory
// (it contains scripts/statechart.mjs). SCRATCH must be outside this tree and empty or absent.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "manifest.json"), "utf8"));
const argv = process.argv.slice(2);
const verifyOnly = argv[0] === "verify";
const flags = {};
for (let i = verifyOnly ? 1 : 0; i < argv.length; i++) {
  if (!argv[i].startsWith("--")) { console.error(`unexpected argument ${argv[i]}`); process.exit(2); }
  flags[argv[i].slice(2)] = argv[++i];
}
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const walk = (d, rel = "") => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), rel ? `${rel}/${e.name}` : e.name) : [rel ? `${rel}/${e.name}` : e.name]));
const FORBIDDEN = [/\/Users\//, /(?<![A-Za-z0-9_.\/-])\/home\/[a-z]/i, /\/var\/folders\//, /\/tmp\/omp-statechart/];

// ---- offline verification (always part of the run too) ----
function verifyTree() {
  const bad = [];
  const have = new Set(walk(HERE).filter((f) => f !== "manifest.json"));
  for (const [rel, h] of Object.entries(manifest.files)) {
    const p = path.join(HERE, rel);
    if (!fs.existsSync(p)) bad.push(`missing ${rel}`);
    else if (sha(fs.readFileSync(p)) !== h) bad.push(`hash mismatch ${rel}`);
    have.delete(rel);
  }
  for (const f of have) bad.push(`unlisted file ${f}`);
  for (const rel of Object.keys(manifest.files)) {
    if (rel.endsWith(".mmd") && !rel.includes("/tlc/") && !manifest.files[rel.replace(/\.mmd$/, ".png")]) bad.push(`${rel} has no .png`);
    if (/\.(tla|cfg|mjs|json|md|mmd|out)$/.test(rel) && rel !== "regenerate.mjs") {
      const t = fs.readFileSync(path.join(HERE, rel), "utf8");
      for (const re of FORBIDDEN) if (re.test(t)) bad.push(`${rel} contains forbidden path ${re}`);
    }
  }
  for (const m of manifest.models) for (const k of ["spec", "config", "map"]) if (!manifest.files[`${m.modelDir}/${m[k]}`]) bad.push(`${m.slice}/${m.name}: ${k} ${m[k]} not in manifest`);
  return bad;
}
const bad = verifyTree();
for (const b of bad) console.log(`FAIL verify: ${b}`);
console.log(`verify: ${bad.length ? bad.length + " problem(s)" : `ok (${Object.keys(manifest.files).length} files)`}`);
if (bad.length) process.exit(1);
if (verifyOnly) process.exit(0);

// ---- regeneration ----
const skill = flags.skill ?? process.env.STATECHART_SKILL;
const outRoot = flags.out;
if (!skill || !outRoot) { console.error("need --skill DIR (or STATECHART_SKILL) and --out SCRATCH"); process.exit(2); }
const cli = path.join(path.resolve(skill), "scripts", "statechart.mjs");
if (!fs.existsSync(cli)) { console.error(`${cli} not found`); process.exit(2); }
const out = path.resolve(outRoot);
const here = fs.realpathSync(HERE);
const outReal = fs.existsSync(out) ? fs.realpathSync(out) : out;
if (outReal === here || outReal.startsWith(here + path.sep) || here.startsWith(outReal + path.sep)) { console.error("--out must be outside the published tree"); process.exit(2); }
// When this tree sits in a Git worktree, --out must be outside the whole worktree (skipped outside Git).
const top = spawnSync("git", ["-C", here, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
if (top.status === 0) {
  const wt = fs.realpathSync(top.stdout.trim());
  if (outReal === wt || outReal.startsWith(wt + path.sep)) { console.error(`--out must be outside the Git worktree ${wt}`); process.exit(2); }
}
if (fs.existsSync(out) && fs.readdirSync(out).length) { console.error(`--out ${out} is not empty`); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const env = { ...process.env };
if (flags.tla2tools) env.TLA2TOOLS = path.resolve(flags.tla2tools);
if (flags.java) env.JAVA = path.resolve(flags.java);
const only = flags.only ? new Set(flags.only.split(",")) : null;
const selected = manifest.models.filter((m) => !only || only.has(`${m.slice}/${m.name}`));
if (only && selected.length !== only.size) { console.error(`--only matched ${selected.length} of ${only.size} names`); process.exit(2); }

const keyBase = (t) => t.replace(/"(?:[^"\\]*[\/])([^"\/]+\.tla)":/g, '"$1":');
const norm = (t, o) => keyBase(t).split(o).join("<scratch>/out").split(fs.realpathSync(path.dirname(o)) + path.sep + path.basename(o)).join("<scratch>/out");
let failures = 0;
for (const m of selected) {
  const id = `${m.slice}/${m.name}`;
  // TLC reads a copy of the model inputs in scratch, never the published source.
  const src = path.join(out, "_inputs", m.slice, m.name);
  fs.cpSync(path.join(HERE, m.modelDir), src, { recursive: true });
  const dest = path.join(out, m.slice, m.name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const args = [cli, "from-spec", path.join(src, m.spec), "--config", path.join(src, m.config), "--map", path.join(src, m.map)];
  if (m.fixed) args.push("--fixed", path.join(src, m.fixed));
  if (m.fixedConfig) args.push("--fixed-config", path.join(src, m.fixedConfig));
  if (m.against) args.push("--against", path.join(src, m.against));
  if (m.againstConfig) args.push("--against-config", path.join(src, m.againstConfig));
  if (m.label) args.push("--label", m.label);
  if (m.title) args.push("--title", m.title);
  for (const r of m.expectBroken ?? []) args.push("--expect-broken", r);
  if (m.cover) args.push("--cover");
  args.push("--png", "--theme", flags.theme ?? m.theme ?? "light", "--out", dest);
  console.log(`\n== ${id}`);
  const r = spawnSync(process.execPath, args, { env, cwd: out, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  fs.writeFileSync(path.join(out, m.slice, `${m.name}.log`), (r.stdout ?? "") + (r.stderr ?? ""));
  const problems = [];
  if (r.status !== 0) problems.push(`exit ${r.status}, expected 0 with exact known --expect-broken rules${r.error ? " (" + r.error.message + ")" : ""}`);
  // compare with published charts
  const pub = path.join(HERE, m.chartDir);
  if (fs.existsSync(dest)) {
    for (const f of walk(pub).filter((f) => (f.endsWith(".mmd") || f.endsWith(".png")) && !f.startsWith("tlc/"))) {
      const g = path.join(dest, f);
      if (!fs.existsSync(g)) { problems.push(`not regenerated: ${f}`); continue; }
      if (f.endsWith(".mmd") && norm(fs.readFileSync(g, "utf8"), dest) !== fs.readFileSync(path.join(pub, f), "utf8")) problems.push(`differs: ${f}`);
    }
    for (const f of walk(dest).filter((f) => f.endsWith(".mmd") && !f.startsWith("tlc/"))) if (!fs.existsSync(path.join(pub, f))) problems.push(`extra chart not published: ${f}`);
    try {
      const a = JSON.parse(norm(fs.readFileSync(path.join(dest, "summary.json"), "utf8"), dest));
      const b = JSON.parse(keyBase(fs.readFileSync(path.join(pub, "summary.json"), "utf8")));
      if (JSON.stringify(a) !== JSON.stringify(b)) problems.push("differs: summary.json");
    } catch (e) { problems.push(`summary.json unreadable: ${e.message}`); }
  } else problems.push("no output directory produced");
  if (problems.length) { failures++; console.log(`FAIL ${id}: ${problems.join("; ")} (log: ${path.join(m.slice, m.name + ".log")} in scratch)`); } else console.log(`ok   ${id}`);
}
console.log(`\n${selected.length - failures}/${selected.length} model(s) regenerated identically; scratch: ${out}`);
process.exit(failures ? 1 : 0);
