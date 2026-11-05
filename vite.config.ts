import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), tailwindcss()],
	test: {
		include: ["src/**/*.test.{ts,tsx}", "src-mobile/**/*.test.{ts,tsx}", "src-tauri/src/mobile/camera-web/*.test.js"],
		setupFiles: ["src/test/setupLocale.ts"],
	},
	// Tauri expects a fixed dev port and fails if it is taken.
	clearScreen: false,
	server: {
		port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 1421,
		strictPort: true,
		watch: {
			// Ignore backend, cache, docs, test files, and other worktree build outputs from triggering dev reload.
			ignored: [
				"**/src-tauri/**",
				"**/.cache/**",
				"**/docs/**",
				"**/*.test.{ts,tsx,js,jsx}",
				"**/.worktrees/*/dist/**",
				"**/.worktrees/*/mobile-dist/**",
				"**/.worktrees/*/target/**",
			],
		},
	},
	build: {
		// Tauri uses a custom protocol in production.
		target: "es2021",
	},
});
