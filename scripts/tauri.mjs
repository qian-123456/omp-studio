#!/usr/bin/env node
import cli from "@tauri-apps/cli";
import { fileURLToPath } from "node:url";

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
