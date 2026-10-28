import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const REPO = "<repo>";
export default defineConfig({
	plugins: [react()],
	root: REPO,
	cacheDir: "<scratch>/terminal-services/replay/.vite-cache",
	server: { fs: { strict: false } },
	test: {
		include: ["<scratch>/terminal-services/replay/*.test.tsx"],
		setupFiles: [REPO + "/src/test/setupLocale.ts"],
		environment: "jsdom",
	},
});
