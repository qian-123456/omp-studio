#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const version = "0.102.0-9";
const binDir = join(homedir(), ".local", "share", "omp-workspace", "cargo-fork", version, "bin");
const cargo = join(binDir, "cargo");
const [command, ...args] = process.argv.slice(2);

function fail(message, code = 1) {
	console.error(`error: ${message}`);
	process.exit(code);
}

if (!command) {
	fail("usage: node scripts/with-cargo-fork.mjs <command> [args...]");
}

try {
	accessSync(cargo, constants.X_OK);
} catch {
	fail(`Pinned cargo fork is missing or not executable: ${cargo}\nInstall huacnlee/cargo ${version} independently at that path and make it executable. See https://github.com/huacnlee/cargo/releases. This helper does not install or update tools.`);
}

const env = {
	...process.env,
	PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
	CARGO_FORK_AUTO_UPDATE: "0",
	CARGO_BUILD_GC_MAX_SIZE: "16 GiB",
	CARGO_BUILD_GC_SHARED_MAX_SIZE: "10 GiB",
	CARGO_BUILD_GC_FREQUENCY: "always",
	CARGO_BUILD_GC_ENABLED: "true",
};
env.RUSTC_WRAPPER = "";
env.RUSTC_WORKSPACE_WRAPPER = "";

try {
	const probe = spawnSync(cargo, ["-V"], { env, encoding: "utf8" });
	if (probe.error) {
		fail(`Cannot check pinned cargo fork at ${cargo}: ${probe.error.message}`);
	}
	if (probe.status !== 0) {
		fail(`Pinned cargo fork version check failed at ${cargo}: ${probe.stderr?.trim() || probe.signal || probe.status}`);
	}
	if (!/^cargo\s/.test(probe.stdout) || !/\bhuacnlee\/cargo\s*0\.102\.0-9(?=[\s,)])/u.test(probe.stdout)) {
		fail(`Expected huacnlee/cargo ${version} at ${cargo}, got: ${probe.stdout.trim()}\nReplace only this independent installation with the pinned fork; do not replace global Cargo.`);
	}

	const child = spawn(command, args, { env, stdio: "inherit" });
	const handlers = new Map();
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
		const handler = () => {
			if (child.pid && child.exitCode === null && child.signalCode === null) {
				child.kill(signal);
			}
		};
		handlers.set(signal, handler);
		process.on(signal, handler);
	}
	child.on("error", (error) => {
		console.error(`error: Cannot run ${command}: ${error.message}`);
		process.exitCode = error.code === "ENOENT" ? 127 : error.code === "EACCES" ? 126 : 1;
	});
	child.on("close", (code, signal) => {
		for (const [name, handler] of handlers) process.removeListener(name, handler);
		if (signal) {
			process.kill(process.pid, signal);
		} else {
			process.exitCode ??= code ?? 1;
		}
	});
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}
