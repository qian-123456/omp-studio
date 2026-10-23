"use strict";
/* Phone-local display prefs (localStorage only, never sent to the desktop).
   M.prefs.get(key) / M.prefs.set(key, value). Loaded right after core.js. */
(function () {
	const KEY = "omp.mobile.prefs";
	const DEFAULTS = { foldOpen: false, msgSize: "m" };
	const SIZES = ["s", "m", "l", "xl"];

	let store = {};
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
		if (raw && typeof raw === "object") store = raw;
	} catch (_) {
		store = {};
	}

	function valid(key, v) {
		if (key === "foldOpen") return typeof v === "boolean";
		if (key === "msgSize") return SIZES.includes(v);
		return false;
	}

	function apply() {
		document.documentElement.dataset.msgSize = M.prefs.get("msgSize");
	}

	M.prefs = {
		get(key) {
			return valid(key, store[key]) ? store[key] : DEFAULTS[key];
		},
		set(key, v) {
			if (!valid(key, v)) return false;
			store[key] = v;
			try {
				localStorage.setItem(KEY, JSON.stringify(store));
			} catch (_) {
				/* private mode / quota: keep the in-memory value for this session */
			}
			apply();
			return true;
		},
	};
	apply();
})();
