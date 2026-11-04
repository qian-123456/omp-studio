#!/usr/bin/env node
/**
 * Open the dev instance (Tauri dev window) of one worktree of this repo.
 *
 *   node scripts/open-worktree.mjs main
 *   node scripts/open-worktree.mjs omp/bugfixs-1104-0055
 *   node scripts/open-worktree.mjs s-1104-0055
 *   node scripts/open-worktree.mjs /abs/path/to/worktree
 *
 * Flags: --dry-run (resolve only), --close (stop the recorded instance),
 *        --timeout <seconds> (default 600).
 *
 * One instance per worktree. Port and data dir are persisted in
 * `.cache/dev-worktree/<slug>.json` so a second call reports the running
 * window instead of spawning a duplicate; the data dir is always isolated
 * from the release app (~/.omp-workspace).
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.join(REPO, ".cache", "dev-worktree");
const PORT_BASE = 1425;
const PORT_RANGE = 75;

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const timeoutArg = argv.indexOf("--timeout");
const timeoutSec =
	timeoutArg >= 0 ? Number(argv[timeoutArg + 1]) || 600 : 600;
const positional = argv.filter(
	(a, i) => !a.startsWith("--") && argv[i - 1] !== "--timeout",
);
const selector = positional[0];

function die(msg) {
	console.error(`error: ${msg}`);
	process.exit(1);
}

if (!selector) {
	die(
		"usage: node scripts/open-worktree.mjs <main|branch|dir-name|path> [--dry-run] [--close]",
	);
}

function sh(cmd, args, opts = {}) {
	return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

/** Parsed `git worktree list --porcelain`, main checkout first. */
function listWorktrees() {
	const out = sh("git", ["worktree", "list", "--porcelain"], { cwd: REPO });
	if (out.status !== 0) die(`git worktree list failed: ${out.stderr.trim()}`);
	const entries = [];
	let cur = null;
	for (const line of out.stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (cur) entries.push(cur);
			cur = { path: line.slice(9).trim(), branch: null, head: null };
		} else if (line.startsWith("branch ") && cur) {
			cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
		} else if (line.startsWith("HEAD ") && cur) {
			cur.head = line.slice(5).trim();
		}
	}
	if (cur) entries.push(cur);
	return entries;
}

function resolveWorktree(worktrees, sel) {
	const wanted = sel.trim().replace(/\/+$/, "");
	const abs = path.resolve(REPO, wanted);
	const bare = (b) => (b ?? "").replace(/^omp\//, "");
	const matches = worktrees.filter(
		(w) =>
			w.path === abs ||
			path.basename(w.path) === wanted ||
			w.branch === wanted ||
			bare(w.branch) === bare(wanted),
	);
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) {
		die(
			`ambiguous selector "${sel}":\n${matches.map((m) => `  ${m.path} (${m.branch ?? "detached"})`).join("\n")}`,
		);
	}
	const known = worktrees
		.map((w) => `  ${path.basename(w.path)}  ${w.branch ?? "detached"}`)
		.join("\n");
	die(`no worktree matches "${sel}". Known worktrees:\n${known}`);
}

function slugOf(wt, index) {
	const name = path.basename(wt.path) || "main";
	return index === 0 ? "main" : name.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function statePath(slug) {
	return path.join(STATE_DIR, `${slug}.json`);
}

function readState(slug) {
	try {
		return JSON.parse(fs.readFileSync(statePath(slug), "utf8"));
	} catch {
		return null;
	}
}

function portListening(port) {
	const out = sh("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
	return out.status === 0 && out.stdout.trim() !== "";
}

function pidAlive(pid) {
	if (!pid) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** Stable port per worktree: main keeps 1425, others hash into the range. */
function allocatePort(slug, recorded) {
	if (recorded) return recorded;
	if (slug === "main") return PORT_BASE;
	let h = 0;
	for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	for (let i = 0; i < PORT_RANGE; i++) {
		const port = PORT_BASE + 1 + ((h + i) % (PORT_RANGE - 1));
		if (!portListening(port)) return port;
	}
	die(`no free port in ${PORT_BASE}..${PORT_BASE + PORT_RANGE - 1}`);
}

function listenerPid(port) {
	const out = sh("lsof", ["-a", "-ti", `-iTCP:${port}`, "-sTCP:LISTEN"]);
	if (out.status !== 0) return null;
	const pid = Number(out.stdout.trim().split("\n")[0]);
	return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function cwdOf(pid) {
	const out = sh("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
	if (out.status !== 0) return null;
	const line = out.stdout.split("\n").find((l) => l.startsWith("n"));
	return line ? line.slice(1) : null;
}

/** Dev binary (`target/debug/omp-workspace`) belonging to `wtPath`. */
function devPidFor(wtPath) {
	const roots = [wtPath, path.join(wtPath, "src-tauri")];
	const out = sh("ps", ["-axo", "pid=,command="]);
	if (out.status !== 0) return null;
	for (const line of out.stdout.split("\n")) {
		const m = line.trim().match(/^(\d+)\s+(.*)$/);
		if (!m || !m[2].includes("target/debug/omp-workspace")) continue;
		const pid = Number(m[1]);
		if (roots.includes(cwdOf(pid))) return pid;
	}
	return null;
}

function dataDirFor(slug) {
	// Main keeps the historical dev data dir; worktrees get their own.
	return slug === "main"
		? path.join(os.homedir(), ".omp-workspace-dev")
		: path.join(os.homedir(), `.omp-workspace-dev-${slug}`);
}

/** Best-effort title of the process's main window (proves a window exists). */
function windowTitle(pid) {
	const swift = `
import CoreGraphics
import Foundation
let pid = Int(ProcessInfo.processInfo.environment["PROBE_PID"] ?? "0") ?? 0
let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
var best = ""
var bestH = 0.0
for w in list {
  if (w[kCGWindowOwnerPID as String] as? Int) == pid {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let h = (b["Height"] as? NSNumber)?.doubleValue ?? 0
    let name = (w[kCGWindowName as String] as? String) ?? ""
    if h > 100 && (!name.isEmpty || best.isEmpty) && h >= bestH {
      best = name.isEmpty ? best : name
      bestH = max(bestH, h)
    }
  }
}
print(best)
`;
	const probe = sh("swift", ["-e", swift], { env: { ...process.env, PROBE_PID: String(pid) } });
	if (probe.status === 0 && probe.stdout.trim()) return probe.stdout.trim();
	const fallback = sh("agent-desktop", ["list-windows", "--app", "omp-workspace"]);
	if (fallback.status !== 0) return null;
	try {
		const parsed = JSON.parse(fallback.stdout);
		const win = (parsed.data ?? []).find((w) => w.pid === pid);
		return win?.title || null;
	} catch {
		return null;
	}
}

function report({ wt, port, dataDir, pid, log, title, note }) {
	const lines = [
		`worktree: ${wt.path}`,
		`branch:   ${wt.branch ?? "detached"}`,
		`port:     ${port}  (http://localhost:${port})`,
		`data:     ${dataDir}`,
		`pid:      ${pid ?? "-"}`,
		`log:      ${log}`,
		`window:   ${title ?? "not detected"}`,
	];
	if (note) lines.push(`note:     ${note}`);
	console.log(lines.join("\n"));
}

const worktrees = listWorktrees();
const idx = worktrees.findIndex((w) => w.path === REPO);
const wt = resolveWorktree(worktrees, selector);
const wtIndex = worktrees.indexOf(wt);
const slug = slugOf(wt, wtIndex);
const state = readState(slug);
const port = allocatePort(slug, state?.port);
const dataDir = dataDirFor(slug);
const log = path.join(STATE_DIR, `${slug}.log`);

if (flags.has("--close")) {
	// Prefer the recorded launcher (kills the whole pnpm→tauri→cargo tree);
	// fall back to the dev binary found for this worktree (hand-started runs).
	const recorded = state?.pid && pidAlive(state.pid) ? state.pid : null;
	const target = recorded ?? devPidFor(wt.path);
	if (!target) {
		console.log(`no running instance for ${slug}`);
		fs.rmSync(statePath(slug), { force: true });
		process.exit(0);
	}
	for (const sig of ["SIGTERM"]) {
		try {
			process.kill(-target, sig);
		} catch {
			try {
				process.kill(target, sig);
			} catch {
				/* already gone */
			}
		}
	}
	fs.rmSync(statePath(slug), { force: true });
	console.log(`stopped ${slug} (pid ${target}, port ${state?.port ?? port})`);
	process.exit(0);
}

if (flags.has("--dry-run")) {
	const running = devPidFor(wt.path);
	report({
		wt,
		port,
		dataDir,
		pid: running ?? null,
		log,
		title: running ? windowTitle(running) : null,
		note: running
			? "already running — a real call would report it and exit"
			: portListening(port)
				? `port ${port} held by pid ${listenerPid(port)} — a real call would refuse`
				: "dry run: nothing started",
	});
	process.exit(0);
}

// Already running for this worktree → report it, never spawn a duplicate.
const runningPid = devPidFor(wt.path);
if (runningPid) {
	const recorded = state?.port ?? port;
	report({
		wt,
		port: portListening(recorded) ? recorded : port,
		dataDir: state?.dataDir ?? dataDir,
		pid: runningPid,
		log,
		title: windowTitle(runningPid),
		note: "already running",
	});
	process.exit(0);
}

const holder = portListening(port) ? listenerPid(port) : null;
if (holder) {
	die(
		`port ${port} is held by pid ${holder} (cwd ${cwdOf(holder) ?? "?"}), not a dev instance of ${wt.path}; pick another worktree or free the port`,
	);
}

if (!fs.existsSync(path.join(wt.path, "node_modules"))) {
	console.log(`installing frontend deps in ${wt.path} …`);
	const install = sh("pnpm", ["install"], { cwd: wt.path, stdio: "inherit" });
	if (install.status !== 0) die("pnpm install failed");
}

fs.mkdirSync(STATE_DIR, { recursive: true });
const logFd = fs.openSync(log, "w");
const env = {
	...process.env,
	VITE_PORT: String(port),
	OMPWS_DATA_DIR: dataDir,
	...(sh("sh", ["-c", "command -v sccache"]).status === 0
		? { RUSTC_WRAPPER: "sccache" }
		: {}),
};
const devUrl = JSON.stringify({ build: { devUrl: `http://localhost:${port}` } });
const child = spawn("pnpm", ["tauri", "dev", "-c", devUrl], {
	cwd: wt.path,
	env,
	detached: true,
	stdio: ["ignore", logFd, logFd],
});
child.unref();
fs.writeFileSync(
	statePath(slug),
	JSON.stringify(
		{
			path: wt.path,
			branch: wt.branch,
			port,
			dataDir,
			pid: child.pid,
			log,
			startedAt: new Date().toISOString(),
		},
		null,
		2,
	),
);

console.log(`starting dev instance for ${path.basename(wt.path)} on port ${port} …`);
const deadline = Date.now() + timeoutSec * 1000;
while (Date.now() < deadline) {
	const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
	const failed = /error\[E\d+\]|error: could not compile/.test(text);
	if (failed) {
		console.error(`build failed — see ${log}`);
		process.exit(1);
	}
	const binPid = devPidFor(wt.path);
	if (binPid && portListening(port)) {
		// The webview window trails the process by a moment; wait for it so the
		// report proves a window exists instead of "not detected".
		let title = null;
		for (let i = 0; i < 20 && !title; i++) {
			await new Promise((r) => setTimeout(r, 500));
			title = windowTitle(binPid);
		}
		report({
			wt,
			port,
			dataDir,
			pid: binPid,
			log,
			title,
			note: `launcher pid ${child.pid}; first build can take minutes, later runs are seconds`,
		});
		process.exit(0);
	}
	if (!pidAlive(child.pid)) {
		console.error(`dev process exited early — see ${log}`);
		process.exit(1);
	}
	await new Promise((r) => setTimeout(r, 1000));
}
die(`timed out after ${timeoutSec}s waiting for the window — see ${log}`);
