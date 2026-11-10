#!/usr/bin/env node
import cli from "@tauri-apps/cli";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// User Cargo configuration selects Kache; inherited wrappers must not override it.
const cargoBin = join(process.env.CARGO_HOME || join(homedir(), ".cargo"), "bin");
process.env.PATH = `${cargoBin}${delimiter}${process.env.PATH ?? ""}`;
process.env.CARGO = join(cargoBin, process.platform === "win32" ? "cargo.exe" : "cargo");
for (const key of [
	"RUSTC_WRAPPER",
	"RUSTC_WORKSPACE_WRAPPER",
	"CARGO_BUILD_RUSTC_WRAPPER",
	"CARGO_BUILD_RUSTC_WORKSPACE_WRAPPER",
]) {
	delete process.env[key];
}

const args = process.argv.slice(2);
const command = args.findIndex((arg) => !arg.startsWith("-"));
if (args[command] === "dev") {
	args.splice(command + 1, 0, "--config", fileURLToPath(new URL("../src-tauri/tauri.dev.conf.json", import.meta.url)));
}

try {
	await cli.run(args, "pnpm tauri");
} catch (error) {
	cli.logError(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
