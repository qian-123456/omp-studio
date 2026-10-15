"use strict";
/* Mobile web app core: window.M (api, state, events, page stack, drawers, toast, confirm).
   Loaded first; every other js file only touches M. */
(function () {
	const M = (window.M = {});

	// ---------- tiny DOM helper ----------

	M.el = function (tag, attrs, ...children) {
		const e = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs || {})) {
			if (v == null || v === false) continue;
			if (k === "class") e.className = v;
			else if (k === "style" && typeof v === "object") Object.assign(e.style, v);
			else if (k === "dataset") Object.assign(e.dataset, v);
			else if (k === "html") e.innerHTML = v;
			else if (k === "text") e.textContent = v;
			else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
			else if (k in e && k !== "list" && k !== "type" && typeof v !== "string") e[k] = v;
			else e.setAttribute(k, v === true ? "" : v);
		}
		const add = (c) => {
			if (c == null || c === false) return;
			if (Array.isArray(c)) c.forEach(add);
			else e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
		};
		children.forEach(add);
		return e;
	};

	const $ = (id) => document.getElementById(id);

	// ---------- shared helpers ----------

	M.util = {
		$,
		esc: (s) =>
			String(s ?? "").replace(
				/[&<>"']/g,
				(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
			),
		relTime(iso) {
			const t = Date.parse(iso);
			if (!t) return "";
			const s = Math.max(0, (Date.now() - t) / 1000);
			if (s < 60) return "刚刚";
			if (s < 3600) return Math.floor(s / 60) + " 分钟前";
			if (s < 86400) return Math.floor(s / 3600) + " 小时前";
			return Math.floor(s / 86400) + " 天前";
		},
		sessionName: (s) => (s ? (s.title || s.label || "未命名").trim() : ""),
		sessionById: (id) => M.state.sessions.find((x) => x.id === id),
		STATUS_LABEL: {
			working: "运行中",
			awaiting_approval: "待批准",
			awaiting_answer: "待回复",
			review: "待验收",
			idle: "空闲",
			error: "错误",
			interrupted: "已中断",
			suspended: "已挂起",
			external: "外部进程",
		},
	};

	// ---------- state + event bus ----------

	M.state = { currentSession: null, sessions: [], live: {} };

	const handlers = {};
	M.on = (evt, fn) => {
		(handlers[evt] ||= new Set()).add(fn);
	};
	M.off = (evt, fn) => {
		handlers[evt]?.delete(fn);
	};
	M.emit = (evt, data) => {
		for (const fn of [...(handlers[evt] || [])]) {
			try {
				fn(data);
			} catch (e) {
				console.error("handler for", evt, e);
			}
		}
	};

	/** Set (or clear with null) the session the chat screen shows; emits 'session-changed'. */
	M.setCurrentSession = (id) => {
		const s = id ? M.util.sessionById(id) || { id } : null;
		const prev = M.state.currentSession;
		M.state.currentSession = s;
		if ((prev && prev.id) !== (s && s.id)) M.emit("session-changed", s);
	};

	M.refreshSessions = async () => {
		M.state.sessions = await M.api("GET", "/sessions");
		const cur = M.state.currentSession;
		if (cur) {
			const fresh = M.state.sessions.find((x) => x.id === cur.id);
			if (fresh) M.state.currentSession = fresh;
		}
		M.emit("sessions", M.state.sessions);
		return M.state.sessions;
	};

	// ---------- api ----------

	function fatal(msg) {
		const f = $("fatal");
		f.textContent = msg;
		f.style.display = "block";
		if (es) {
			es.close();
			es = null;
		}
	}
	M.fatal = fatal;

	async function request(method, path, init) {
		const res = await fetch("/api" + path, { method, credentials: "same-origin", ...init });
		if (res.status === 401) {
			fatal("配对已失效或被撤销，请在电脑上重新生成二维码配对。");
			throw new Error("unauthorized");
		}
		const body = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error((body && body.error) || res.statusText);
		return body;
	}

	M.api = (method, path, body) =>
		request(method, path, {
			headers: { "Content-Type": "application/json" },
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});

	M.upload = (path, blob, query) => {
		const qs = query ? "?" + new URLSearchParams(query).toString() : "";
		return request("POST", path + qs, {
			headers: { "Content-Type": (blob && blob.type) || "application/octet-stream" },
			body: blob,
		});
	};

	// ---------- single SSE connection, fanned out over the bus ----------

	let es = null;
	let pollTimer = null;
	const SSE_EVENTS = ["hello", "todos", "session", "touch", "rpc", "resync"];

	function setConn(on) {
		const dot = $("dot");
		if (dot) dot.className = "dot " + (on ? "on" : "off");
		M.state.connected = on;
		M.emit("conn", on);
	}

	function trackLive(d) {
		const f = d && d.frame;
		if (!f || !d.sessionId) return;
		if (f.type === "agent_start" || f.type === "turn_start") M.state.live[d.sessionId] = { working: true };
		else if (f.type === "agent_end" && f.isTerminal !== false) M.state.live[d.sessionId] = { working: false };
	}

	function connect() {
		if (es) es.close();
		es = new EventSource("/api/events");
		es.onopen = () => {
			setConn(true);
			M.emit("connected", null);
		};
		es.onerror = () => {
			setConn(false);
			startPolling();
		};
		for (const name of SSE_EVENTS) {
			es.addEventListener(name, (e) => {
				let data = null;
				try {
					data = JSON.parse(e.data);
				} catch {}
				if (name === "rpc") trackLive(data);
				if (name === "session") M.refreshSessions().catch(() => {});
				if (name === "resync") M.refreshSessions().catch(() => {});
				M.emit("sse", { type: name, data });
				M.emit("sse:" + name, data);
			});
		}
	}

	function startPolling() {
		if (pollTimer) return;
		pollTimer = setInterval(() => {
			M.refreshSessions().catch(() => {});
			M.emit("poll", null);
		}, 15000);
	}

	document.addEventListener("visibilitychange", () => {
		if (!document.hidden) {
			M.refreshSessions().catch(() => {});
			M.emit("visible", null);
		}
	});

	// ---------- toast / confirm ----------

	let toastTimer = 0;
	M.toast = (text) => {
		const t = $("toast");
		t.textContent = text;
		t.classList.add("show");
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
	};

	M.confirm = (text) =>
		new Promise((resolve) => {
			const box = $("confirm");
			$("confirm-text").textContent = text;
			const done = (v) => {
				box.classList.remove("show");
				$("confirm-ok").onclick = $("confirm-cancel").onclick = null;
				resolve(v);
			};
			$("confirm-ok").onclick = () => done(true);
			$("confirm-cancel").onclick = () => done(false);
			box.classList.add("show");
		});

	// ---------- page stack ----------

	const pages = {};
	/** def: { title, mount(el, params), unmount?(), bare? }. Non-bare pages get a standard
	    top bar (back + title); `el` is then the scrollable body below it. Bare pages
	    (home, chat) receive the full-screen element and draw their own top bar. */
	M.registerPage = (id, def) => {
		pages[id] = def;
	};

	const stack = []; // {id, params, def, root, el}
	const container = () => $("pages");

	function placeholderDef(id) {
		return {
			title: "开发中",
			mount(el) {
				el.appendChild(M.el("div", { class: "empty" }, "开发中", M.el("div", { style: { fontSize: "12px", marginTop: "8px" } }, id)));
			},
		};
	}

	function build(id, params) {
		const def = pages[id] || placeholderDef(id);
		const root = M.el("section", { class: "page", dataset: { page: id } });
		let el = root;
		if (!def.bare) {
			root.appendChild(
				M.el(
					"div",
					{ class: "topbar" },
					M.el("button", { class: "iconbtn", "aria-label": "返回", onclick: () => M.nav.back() }, "‹"),
					M.el("h1", {}, typeof def.title === "function" ? def.title(params) : def.title || id),
				),
			);
			el = M.el("div", { class: "pbody" });
			root.appendChild(el);
		}
		container().appendChild(root);
		const entry = { id, params, def, root, el };
		try {
			def.mount(el, params || {});
		} catch (e) {
			console.error("mount", id, e);
			el.appendChild(M.el("div", { class: "empty" }, "页面加载失败：" + e.message));
		}
		return entry;
	}

	function show(entry) {
		for (const s of stack) s.root.classList.toggle("hidden", s !== entry);
		M.emit("page", entry && { id: entry.id, params: entry.params });
	}

	function pop() {
		const top = stack.pop();
		try {
			top.def.unmount?.();
		} catch (e) {
			console.error("unmount", top.id, e);
		}
		top.root.remove();
		show(stack[stack.length - 1]);
	}

	function hashFor(id, params) {
		return id === "chat" && params && params.id ? "#/s/" + encodeURIComponent(params.id) : location.hash;
	}

	M.nav = {
		open(id, params) {
			closeDrawers();
			const entry = build(id, params);
			stack.push(entry);
			history.pushState({ d: stack.length - 1 }, "", hashFor(id, params) || location.pathname + location.search);
			show(entry);
		},
		back() {
			if (stack.length > 1) history.back();
		},
		/** Return to the root (home) page. */
		home() {
			closeDrawers();
			if (stack.length > 1) history.go(-(stack.length - 1));
		},
		top: () => stack[stack.length - 1] || null,
		depth: () => stack.length,
	};

	window.addEventListener("popstate", (e) => {
		closeDrawers();
		const d = e.state && typeof e.state.d === "number" ? e.state.d : 0;
		while (stack.length - 1 > d && stack.length > 1) pop();
	});

	// ---------- drawers ----------

	const LEFT = [
		["left:sessions", "会话", "💬"],
		["left:inbox", "收件箱", "📥"],
		["left:search", "搜索", "🔍"],
		["left:schedules", "定时任务", "⏰"],
		["left:skills", "Skills", "🧩"],
		["left:ideas", "想法", "💡"],
		["left:settings", "设置", "⚙️"],
	];
	const RIGHT = [
		["right:explorer", "文件", "📁"],
		["right:sidechat", "旁聊", "🗨️"],
		["right:heatmap", "热力图", "🔥"],
		["right:todos", "待办", "✅"],
		["right:git", "Git", "🌿"],
		["right:services", "服务", "🛠️"],
		["right:terminal", "终端", "⌨️"],
		["right:plan", "计划", "🗺️"],
	];

	function fillDrawer(side, title, entries) {
		const list = $("drawer-" + side + "-list");
		$("drawer-" + side + "-title").textContent = title;
		for (const [id, label, icon] of entries) {
			list.appendChild(
				M.el(
					"div",
					{ class: "ditem", dataset: { page: id }, onclick: () => onEntry(side, id) },
					M.el("span", {}, icon),
					M.el("span", {}, label),
					pages[id] ? null : M.el("span", { class: "ddev" }, "开发中"),
				),
			);
		}
	}

	function onEntry(side, id) {
		if (side === "right" && !M.state.currentSession) {
			closeDrawers();
			M.toast("请先打开一个会话");
			return;
		}
		const top = M.nav.top();
		if (id === "left:sessions") {
			M.nav.home();
			return;
		}
		if (top && top.id === id) {
			closeDrawers();
			return;
		}
		M.nav.open(id, side === "right" ? { sessionId: M.state.currentSession.id } : undefined);
	}

	function closeDrawers() {
		$("drawer-left").classList.remove("open");
		$("drawer-right").classList.remove("open");
		$("scrim").classList.remove("open");
	}

	M.drawer = {
		open(side) {
			closeDrawers();
			// Refresh "开发中" badges: pages may register after the shell was built.
			for (const it of $("drawer-" + side).querySelectorAll(".ditem")) {
				const ddev = it.querySelector(".ddev");
				if (pages[it.dataset.page] && ddev) ddev.remove();
			}
			$("drawer-" + side).classList.add("open");
			$("scrim").classList.add("open");
		},
		close: closeDrawers,
	};

	// ---------- viewport (iOS keyboard) ----------

	if (window.visualViewport) {
		const fit = () => {
			document.documentElement.style.setProperty("--vh", visualViewport.height + "px");
			window.scrollTo(0, 0);
			M.emit("viewport", null);
		};
		visualViewport.addEventListener("resize", fit);
		visualViewport.addEventListener("scroll", fit);
	}

	// ---------- boot ----------

	document.addEventListener("DOMContentLoaded", () => {
		$("scrim").onclick = closeDrawers;
		fillDrawer("left", "导航", LEFT);
		fillDrawer("right", "面板", RIGHT);
		const m = location.hash.match(/^#\/s\/(.+)$/);
		history.replaceState({ d: 0 }, "", location.pathname + location.search);
		M.refreshSessions()
			.then(() => {
				connect();
				const root = build("home");
				stack.push(root);
				show(root);
				if (m) M.nav.open("chat", { id: decodeURIComponent(m[1]) });
			})
			.catch((e) => {
				if (e.message !== "unauthorized") fatal("加载失败：" + e.message);
			});
	});
})();
