import { useEffect, useState } from "react";
import type { Options } from "react-markdown";

type PluggableList = NonNullable<Options["rehypePlugins"]>;

const NO_PLUGINS: PluggableList = [];

let loaded: PluggableList | null = null;
let loading: Promise<PluggableList> | null = null;

/** Loads rehype-highlight and a small set of highlight.js languages into a separate chunk, once. */
function load(): Promise<PluggableList> {
	loading ??= (async () => {
		const [
			{ default: rehypeHighlight },
			{ default: bash },
			{ default: css },
			{ default: diff },
			{ default: go },
			{ default: ini },
			{ default: javascript },
			{ default: json },
			{ default: markdown },
			{ default: python },
			{ default: rust },
			{ default: shell },
			{ default: sql },
			{ default: typescript },
			{ default: xml },
			{ default: yaml },
			{ default: plaintext },
		] = await Promise.all([
			import("rehype-highlight"),
			import("highlight.js/lib/languages/bash"),
			import("highlight.js/lib/languages/css"),
			import("highlight.js/lib/languages/diff"),
			import("highlight.js/lib/languages/go"),
			import("highlight.js/lib/languages/ini"),
			import("highlight.js/lib/languages/javascript"),
			import("highlight.js/lib/languages/json"),
			import("highlight.js/lib/languages/markdown"),
			import("highlight.js/lib/languages/python"),
			import("highlight.js/lib/languages/rust"),
			import("highlight.js/lib/languages/shell"),
			import("highlight.js/lib/languages/sql"),
			import("highlight.js/lib/languages/typescript"),
			import("highlight.js/lib/languages/xml"),
			import("highlight.js/lib/languages/yaml"),
			import("highlight.js/lib/languages/plaintext"),
		]);
		const plugins: PluggableList = [
			[
				rehypeHighlight,
				{
					detect: false,
					ignoreMissing: true,
					languages: {
						bash,
						css,
						diff,
						go,
						ini,
						javascript,
						json,
						markdown,
						python,
						rust,
						shell,
						sql,
						typescript,
						xml,
						yaml,
						plaintext,
					},
				},
			],
		];
		loaded = plugins;
		return plugins;
	})();
	return loading;
}

/**
 * Returns a stable rehype plugin list: empty until highlighting is enabled and loaded,
 * then the module-level highlight plugin list (same identity for every caller).
 */
export function useHighlightPlugins(enabled: boolean): PluggableList {
	const [plugins, setPlugins] = useState<PluggableList>(loaded ?? NO_PLUGINS);
	useEffect(() => {
		if (!enabled || loaded) return;
		let alive = true;
		void load().then((p) => {
			if (alive) setPlugins(p);
		});
		return () => {
			alive = false;
		};
	}, [enabled]);
	return enabled ? (loaded ?? plugins) : NO_PLUGINS;
}
