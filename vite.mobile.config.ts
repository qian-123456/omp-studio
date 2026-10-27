/**
 * Build config of the phone web app (src-mobile/ → src-tauri/mobile-dist/).
 *
 * BASE PATH: "/static/". The Rust server (src-tauri/src/mobile/server.rs) serves the
 * built index.html at "/" and every file of the dist folder under "/static/{path}"
 * (e.g. dist/assets/index-abc.js → /static/assets/index-abc.js). Files emitted at the
 * dist root that need root scope (a future sw.js) are additionally served at "/<name>".
 * Routing is hash based, so no SPA fallback is needed.
 */
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL("./src-mobile", import.meta.url));

export default defineConfig({
	root,
	base: "/static/",
	plugins: [react(), tailwindcss()],
	clearScreen: false,
	build: {
		outDir: fileURLToPath(new URL("./src-tauri/mobile-dist", import.meta.url)),
		emptyOutDir: true,
		// iOS 15+/Android Chrome 100+ browsers.
		target: "es2021",
		cssCodeSplit: true,
		chunkSizeWarningLimit: 600,
		rollupOptions: {
			input: {
				index: fileURLToPath(new URL("./src-mobile/index.html", import.meta.url)),
				// Service worker: unhashed dist/sw.js, served at "/sw.js" (scope "/").
				sw: fileURLToPath(new URL("./src-mobile/sw.ts", import.meta.url)),
			},
			output: {
				entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js"),
				chunkFileNames: "assets/[name]-[hash].js",
				manualChunks(id) {
					if (id.includes("node_modules/mermaid")) {
						return "mermaid";
					}
				},
			},
		},
	},
});
