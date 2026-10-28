import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const repo = process.env.OMP_AUDIT_REPO || process.cwd();
export default defineConfig({
	plugins: [react()],
	root: repo,
	server: { fs: { strict: false } },
	resolve: { alias: { "<repo>": repo } },
	test: {
		include: [fileURLToPath(new URL("./*.replay.test.tsx", import.meta.url))],
		setupFiles: [`${repo}/src/test/setupLocale.ts`],
	},
});
