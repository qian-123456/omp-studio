// Scratch replay config for the BottomBar performance poller statechart audit.
// Lives outside the repo, so it deliberately has NO bare-specifier imports
// (vitest resolves those relative to the config file). Everything repo-specific
// is referenced by absolute path and vitest runs with the repo as root:
//   cd <REPO> && pnpm vitest run --config <SUITE>/vitest.run.config.mts
const REPO = process.cwd(); // run from the repo root
const SUITE = new URL(".", import.meta.url).pathname;

export default {
	root: REPO,
	// The test file lives outside root, so bare specifiers authored there
	// cannot walk up to the repo's node_modules. Alias exactly those.
	resolve: {
		alias: [
			{ find: /^app-src\//, replacement: `${REPO}/src/` },
			// vi.mock specifiers in the outside-root test file must resolve to the
			// SAME module ids the repo code imports, or mocks silently miss.
			{ find: /^@tauri-apps\/api\/(.+)$/, replacement: `${REPO}/node_modules/@tauri-apps/api/$1` },
			{ find: "react/jsx-dev-runtime", replacement: `${REPO}/node_modules/react/jsx-dev-runtime.js` },
			{ find: "react/jsx-runtime", replacement: `${REPO}/node_modules/react/jsx-runtime.js` },
			{ find: /^react$/, replacement: `${REPO}/node_modules/react/index.js` },
			{ find: "@testing-library/react", replacement: `${REPO}/node_modules/@testing-library/react` },
		],
	},
	// Repo tsconfig already targets the automatic JSX runtime; pin it so the
	// scratch suite never needs the react plugin (which would need bare imports).
	esbuild: { jsx: "automatic" },
	server: { fs: { strict: false } },
	test: {
		include: [`${SUITE}/*.test.{ts,tsx}`],
		setupFiles: [`${REPO}/src/test/setupLocale.ts`],
		environment: "jsdom",
	},
};
