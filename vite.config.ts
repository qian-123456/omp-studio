import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	test: {
		include: ["src/**/*.test.{ts,tsx}"],
	},
	// Tauri expects a fixed dev port and fails if it is taken.
	clearScreen: false,
	server: {
		port: 1421,
		strictPort: true,
		watch: {
			// NOTE: do not ignore "**/.worktrees/**" here — when the dev server runs
			// from a worktree under the main repo's .worktrees/, that pattern would
			// exclude this whole project and silently disable HMR.
			ignored: ["**/src-tauri/**"],
		},
	},
	build: {
		// Tauri uses a custom protocol in production.
		target: "es2021",
	},
});
