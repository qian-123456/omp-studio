import { defineConfig, mergeConfig } from "vite";
import base from "<repo>/vite.config.ts";
const b = typeof base === "function" ? base({ mode: "test", command: "serve" }) : base;
const { test, ...rest } = await b;
export default defineConfig({
	...rest,
	root: "<repo>",
	server: { fs: { strict: false } },
	test: { include: ["<scratch>/settings-skills/replay/*.replay.test.{ts,tsx}"], setupFiles: ["<repo>/src/test/setupLocale.ts"], dir: "<scratch>/settings-skills/replay" },
});
