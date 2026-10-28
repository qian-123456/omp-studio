import { defineConfig } from "vitest/config";
export default defineConfig({
	root: "<repo>",
	test: { include: ["<scratch>/automation/replay-ts/*.test.ts"], setupFiles: ["<repo>/src/test/setupLocale.ts"], environment: "jsdom", server: { deps: { inline: [/.*/] } } },
	server: { fs: { strict: false } },
});
