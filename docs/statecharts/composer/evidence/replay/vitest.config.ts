import { defineConfig } from "vitest/config";
// Scratch replay config: the repository is imported read-only, nothing is written into it.
export default defineConfig({
	root: "<scratch>/composer/replay",
	server: { fs: { strict: false } },
	test: {
		include: ["*.test.ts"],
		setupFiles: ["<repo>/src/test/setupLocale.ts"],
		environment: "node",
	},
});
