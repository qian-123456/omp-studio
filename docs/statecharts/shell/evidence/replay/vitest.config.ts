import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";
const REPO = "<repo>";
export default defineConfig({
	root: REPO,
	plugins: [react(), tailwindcss()],
	server: { fs: { strict: false } },
	test: {
		include: ["<scratch>/shell/replay/*.test.{ts,tsx}"],
		setupFiles: [REPO + "/src/test/setupLocale.ts"],
		environment: "jsdom",
	},
});
