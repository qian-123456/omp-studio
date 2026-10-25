/**
 * In-iframe bridge source, injected before the model's fragment so
 * `window.openai` already exists when fragment scripts run. Kept as a plain
 * string (not a bundled import) because it must be inlined into srcdoc.
 *
 * Protocol with the host (omp side):
 *   host  → iframe window: {type:"omp-visualize-init", theme, vars} + port2
 *   host  → port:          {type:"theme", theme, vars} | {type:"measure"}
 *                        | {type:"widget-state-result", id, ok}
 *   iframe → port:         {type:"height", height}
 *                        | {type:"open-external", href}
 *                        | {type:"follow-up", prompt}
 *                        | {type:"widget-state-write", id, state}
 *                        | {type:"scroll-to", top}
 *
 * IMPORTANT: this string is inlined inside a <script> tag — it must never
 * contain the literal sequence "</scr" + "ipt>" or "<!--".
 */

export const VIZ_BRIDGE_SOURCE = `(() => {
	const root = document.documentElement;
	const stateEl = document.getElementById("omp-visualize-widget-state");
	let state = null;
	try { state = JSON.parse(stateEl && stateEl.textContent ? stateEl.textContent : "null"); }
	catch { state = null; }
	if (stateEl) stateEl.remove();
	const MAX_STATE_BYTES = __OMP_VIZ_MAX_STATE_BYTES__;
	const pendingWrites = new Map();
	let nextWriteId = 0;
	let hostPort = null;

	const post = (type, payload) => {
		if (hostPort) hostPort.postMessage(Object.assign({ type }, payload));
	};
	const active = () => navigator.userActivation && navigator.userActivation.isActive === true;

	const setGlobals = (patch) => {
		const next = Object.assign(
			{
				theme: root.dataset.theme === "light" ? "light" : "dark",
				widgetState: state,
				openExternal(input) {
					const href = typeof input === "string" ? input : input && input.href;
					if (typeof href === "string" && active()) post("open-external", { href });
				},
				sendFollowUpMessage(input) {
					if (active()) {
						const prompt = typeof input === "string"
							? input
							: input && typeof input.prompt === "string"
								? input.prompt
								: null;
						if (prompt) post("follow-up", { prompt });
					}
					return Promise.resolve();
				},
				setWidgetState(next) {
					return Promise.resolve().then(() => {
						const value = typeof next === "function" ? next(state) : next;
						if (value == null || typeof value !== "object" || Array.isArray(value)) {
							throw new TypeError("Widget state must be a JSON object");
						}
						const serialized = JSON.stringify(value, (_key, v) => {
							if (typeof v === "undefined" || typeof v === "function" || typeof v === "symbol") {
								throw new TypeError("Widget state must be a JSON object");
							}
							if (typeof v === "number" && !Number.isFinite(v)) {
								throw new TypeError("Widget state must be a JSON object");
							}
							return v;
						});
						if (new TextEncoder().encode(serialized).length > MAX_STATE_BYTES) {
							throw new TypeError("Widget state must be a JSON object of at most 16 KiB");
						}
						state = JSON.parse(serialized);
						setGlobals({ widgetState: state });
						if (!hostPort) return;
						const id = ++nextWriteId;
						const { promise, resolve, reject } = Promise.withResolvers();
						pendingWrites.set(id, { resolve, reject });
						setTimeout(() => {
							if (pendingWrites.delete(id)) {
								reject(new Error("The host could not persist the widget state update"));
							}
						}, 30000);
						post("widget-state-write", { id, state: serialized });
						return promise;
					});
				},
			},
			window.openai || {},
			patch || {},
		);
		window.openai = next;
		window.dispatchEvent(new CustomEvent("openai:set_globals", { detail: { globals: next } }));
	};

	const applyTheme = (theme, vars) => {
		if (theme === "light" || theme === "dark") {
			root.dataset.theme = theme;
			root.style.colorScheme = theme;
		}
		if (vars && typeof vars === "object") {
			for (const key of Object.keys(vars)) {
				if (key.slice(0, 2) === "--") root.style.setProperty(key, String(vars[key]));
			}
		}
		setGlobals({ theme: root.dataset.theme === "light" ? "light" : "dark" });
	};

	const sendHeight = () => {
		post("height", {
			height: Math.ceil(Math.max(
				document.body ? document.body.scrollHeight : 0,
				document.body ? document.body.getBoundingClientRect().height : 0,
			)),
		});
	};

	// Static export: serialize the rendered document (computed styles inlined,
	// canvases flattened) into an SVG foreignObject and rasterize it to a PNG,
	// so the host can embed the chart in a shared image without reading this
	// opaque-origin frame's DOM.
	const cssOf = (el) => {
		const cs = getComputedStyle(el);
		let css = "";
		for (let i = 0; i < cs.length; i++) css += cs[i] + ":" + cs.getPropertyValue(cs[i]) + ";";
		return css;
	};
	const inlineStyles = (src, dst) => {
		dst.setAttribute("style", cssOf(src));
		const sk = src.children;
		const dk = dst.children;
		for (let i = 0; i < sk.length; i++) {
			const s = sk[i];
			const d = dk[i];
			if (s instanceof HTMLCanvasElement) {
				try {
					const img = document.createElement("img");
					img.setAttribute("src", s.toDataURL("image/png"));
					img.setAttribute("style", cssOf(s));
					dst.replaceChild(img, d);
					continue;
				} catch { /* tainted canvas: fall through to a plain style copy */ }
			}
			inlineStyles(s, d);
		}
	};
	const snapshot = async (id) => {
		try {
			const width = Math.max(1, Math.ceil(root.clientWidth));
			const height = Math.max(1, Math.ceil(document.body.getBoundingClientRect().height));
			const clone = document.body.cloneNode(true);
			inlineStyles(document.body, clone);
			for (const el of Array.from(clone.querySelectorAll("script,style,link,noscript"))) el.remove();
			const holder = document.createElement("div");
			holder.setAttribute("style", "width:" + width + "px;height:" + height + "px;overflow:hidden;");
			while (clone.firstChild) holder.appendChild(clone.firstChild);
			const xml = new XMLSerializer().serializeToString(holder);
			const svg =
				'<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
				'<foreignObject x="0" y="0" width="100%" height="100%">' + xml + "</foreignObject></svg>";
			const image = new Image();
			const loaded = Promise.withResolvers();
			image.onload = loaded.resolve;
			image.onerror = () => loaded.reject(new Error("svg load failed"));
			image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
			await loaded.promise;
			const scale = 2;
			const canvas = document.createElement("canvas");
			canvas.width = width * scale;
			canvas.height = height * scale;
			const ctx = canvas.getContext("2d");
			// WebKit often paints a foreignObject image blank on the first draws;
			// redraw until some pixel is non-transparent.
			let painted = false;
			for (let attempt = 0; attempt < 5 && !painted; attempt++) {
				if (attempt > 0) await new Promise((r) => setTimeout(r, 200));
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				ctx.scale(scale, scale);
				ctx.drawImage(image, 0, 0, width, height);
				const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
				for (let i = 3; i < data.length; i += 4) {
					if (data[i] !== 0) { painted = true; break; }
				}
			}
			if (!painted) throw new Error("snapshot is blank");
			post("snapshot-result", { id, dataUrl: canvas.toDataURL("image/png"), width, height });
		} catch (err) {
			post("snapshot-result", { id, error: String(err && err.message ? err.message : err) });
		}
	};

	window.addEventListener("message", (event) => {
		const data = event.data;
		if (
			hostPort != null ||
			event.source !== window.parent ||
			!data || typeof data !== "object" ||
			(data.type !== "omp-visualize-init" && data.type !== "codex-visualization-initialize") ||
			!Array.isArray(event.ports) || event.ports.length !== 1
		) return;
		event.stopImmediatePropagation();
		hostPort = event.ports[0];
		applyTheme(data.theme, data.vars);
		hostPort.addEventListener("message", (e) => {
			const m = e.data;
			if (!m || typeof m !== "object") return;
			if (m.type === "measure") sendHeight();
			else if (m.type === "snapshot") void snapshot(m.id);
			else if (m.type === "theme") applyTheme(m.theme, m.vars);
			else if (m.type === "widget-state-result") {
				const pending = pendingWrites.get(m.id);
				if (!pending) return;
				pendingWrites.delete(m.id);
				if (m.ok === true) pending.resolve();
				else pending.reject(new Error("The host could not persist the widget state update"));
			}
		});
		hostPort.start();
		sendHeight();
	}, true);

	// In-fragment navigation is blocked by the sandbox; route link clicks to the
	// host, and keep "#anchor" jumps working via a scroll request.
	window.addEventListener("click", (event) => {
		if (event.defaultPrevented) return;
		let el = event.target instanceof Element ? event.target : event.target && event.target.parentElement;
		const link = el && el.closest ? el.closest("a[href]") : null;
		const href = link ? link.getAttribute("href") : null;
		if (href == null) return;
		if (href.charAt(0) === "#") {
			let target = null;
			try { target = document.getElementById(decodeURIComponent(href.slice(1))); }
			catch { return; }
			if (!target || !active()) return;
			event.preventDefault();
			post("scroll-to", { top: target.getBoundingClientRect().top + window.scrollY });
			return;
		}
		event.preventDefault();
		if (active()) post("open-external", { href });
	});

	new ResizeObserver(sendHeight).observe(document.body);
	const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const syncMotion = () => { root.dataset.reducedMotion = motion.matches ? "true" : "false"; };
	motion.addEventListener("change", syncMotion);
	syncMotion();
	setGlobals({});
})();`;

/** Build the bridge source with the byte budget baked in. */
export function vizBridgeSource(maxStateBytes: number): string {
	return VIZ_BRIDGE_SOURCE.replace(
		"__OMP_VIZ_MAX_STATE_BYTES__",
		String(Math.max(0, Math.floor(maxStateBytes))),
	);
}
