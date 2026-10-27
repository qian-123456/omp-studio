/**
 * In-iframe bridge source script for mobile visualize.
 * Injected into the sandboxed iframe before the model fragment runs so
 * `window.openai` exists immediately.
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
	const active = () => {
		if (typeof navigator === "undefined" || !navigator.userActivation) return true;
		return navigator.userActivation.isActive !== false;
	};

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
						let resolvePromise, rejectPromise;
						const promise = new Promise((res, rej) => {
							resolvePromise = res;
							rejectPromise = rej;
						});
						pendingWrites.set(id, { resolve: resolvePromise, reject: rejectPromise });
						setTimeout(() => {
							if (pendingWrites.delete(id)) {
								rejectPromise(new Error("The host could not persist the widget state update"));
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

	if (typeof ResizeObserver !== "undefined" && document.body) {
		new ResizeObserver(sendHeight).observe(document.body);
	}
	const motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
	const syncMotion = () => { if (motion) root.dataset.reducedMotion = motion.matches ? "true" : "false"; };
	motion?.addEventListener("change", syncMotion);
	syncMotion();
	setGlobals({});
})();`;

export function vizBridgeSource(maxStateBytes: number): string {
	return VIZ_BRIDGE_SOURCE.replace(
		"__OMP_VIZ_MAX_STATE_BYTES__",
		String(Math.max(0, Math.floor(maxStateBytes))),
	);
}
