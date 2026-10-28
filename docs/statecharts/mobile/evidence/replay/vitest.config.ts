import { defineConfig } from "vitest/config";
const repo = process.env.OMP_REPO ?? process.cwd();
const replay = new URL('.', import.meta.url).pathname;
export default defineConfig({
	root: repo,
	server: { fs: { strict: false } },
	test: {
		include: [`${replay}*.replay.test.{ts,tsx}`],
		dir: replay,
		setupFiles: [`${repo}/src/test/setupLocale.ts`],
		reporters: ["verbose"],
	},
});
