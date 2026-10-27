// `pnpm dev`: one finished mobile build (the Rust server embeds it), then the mobile
// watcher next to the desktop Vite server. Both children die with this process.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bin = (name) => fileURLToPath(new URL(`../node_modules/.bin/${name}`, import.meta.url));
const mobileArgs = ["build", "--config", "vite.mobile.config.ts"];

const first = spawnSync(bin("vite"), mobileArgs, { stdio: "inherit" });
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
	spawn(bin("vite"), [...mobileArgs, "--watch"], { stdio: "inherit" }),
	spawn(bin("vite"), process.argv.slice(2), { stdio: "inherit" }),
];
const stop = (code) => {
	for (const c of children) c.kill();
	process.exit(code ?? 0);
};
children[1].on("exit", stop);
children[0].on("exit", (code) => code && stop(code));
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stop(0));
