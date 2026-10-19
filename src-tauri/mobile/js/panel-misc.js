"use strict";
/* Right-panel pages: sidechat, todos, plan, heatmap, services, terminal.
   Each page registers via reg(); mount returns a cleanup that runs on unmount. */
(function () {
	const { esc, relTime, sessionById, sessionName, STATUS_LABEL } = M.util;
	const h = M.el;

	// ---------- page registration (per-mount cleanup, LIFO per page id) ----------

	function reg(id, title, mount) {
		const cleanups = [];
		M.registerPage(id, {
			title,
			mount(el, params) {
				cleanups.push(mount(el, params || {}) || (() => {}));
			},
			unmount() {
				const fn = cleanups.pop();
				if (fn) fn();
			},
		});
	}

	/** Subscribe to bus events; returns an unsubscribe fn. */
	function sub(map) {
		for (const [k, fn] of Object.entries(map)) M.on(k, fn);
		return () => {
			for (const [k, fn] of Object.entries(map)) M.off(k, fn);
		};
	}

	function debounce(fn, ms) {
		let t = 0;
		const d = (...a) => {
			clearTimeout(t);
			t = setTimeout(() => fn(...a), ms);
		};
		d.cancel = () => clearTimeout(t);
		return d;
	}

	// ---------- tiny markdown (escape-first) ----------

	function inline(src) {
		const codes = [];
		let t = String(src).replace(/`([^`\n]+)`/g, (_, c) => {
			codes.push(c);
			return "\u0000" + (codes.length - 1) + "\u0000";
		});
		t = esc(t)
			.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
			.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
		return t.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + esc(codes[+i]) + "</code>");
	}

	function md(src) {
		const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
		const out = [];
		const item = /^\s*([-*+]|\d+[.)])\s+/;
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			let m;
			if ((m = line.match(/^\s*(```+|~~~+)/))) {
				const buf = [];
				i++;
				while (i < lines.length && !lines[i].trim().startsWith(m[1])) buf.push(lines[i++]);
				i++;
				out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
			} else if (/^\s*$/.test(line)) {
				i++;
			} else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
				const n = Math.min(m[1].length, 4);
				out.push("<h" + n + ">" + inline(m[2]) + "</h" + n + ">");
				i++;
			} else if (item.test(line)) {
				const ordered = /^\s*\d+[.)]/.test(line);
				const buf = [];
				while (i < lines.length && item.test(lines[i])) buf.push(lines[i++].replace(item, ""));
				const tag = ordered ? "ol" : "ul";
				out.push("<" + tag + ">" + buf.map((b) => "<li>" + inline(b) + "</li>").join("") + "</" + tag + ">");
			} else {
				const buf = [];
				while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^\s*(```|~~~|#{1,6}\s)/.test(lines[i]) && !item.test(lines[i]))
					buf.push(lines[i++]);
				out.push("<p>" + buf.map(inline).join("<br>") + "</p>");
			}
		}
		return out.join("");
	}

	const mdBox = (text) => h("div", { class: "md", html: md(text) });
	const empty = (t) => h("div", { class: "empty" }, t);

	function argSummary(args) {
		if (args == null) return "";
		if (typeof args === "string") return args.replace(/\s+/g, " ").slice(0, 100);
		for (const k of ["command", "path", "file_path", "pattern", "query", "url", "intent", "description"])
			if (typeof args[k] === "string") return args[k].replace(/\s+/g, " ").slice(0, 100);
		return "";
	}

	/** Lite transcript item -> DOM nodes (user / assistant text + tool call lines). */
	function renderItem(it) {
		if (it.hidden) return [];
		if (it.kind === "user" && it.text) return [h("div", { class: "msg-user" }, it.text)];
		if (it.kind === "assistant") {
			const out = [];
			if (it.text && it.text.trim()) out.push(h("div", { class: "msg-asst" }, mdBox(it.text)));
			for (const c of it.toolCalls || [])
				out.push(h("div", { class: "mc-tool" }, "🔧 " + c.name + (argSummary(c.args) ? " · " + argSummary(c.args) : "")));
			return out;
		}
		return [];
	}

	function nearBottom(el) {
		return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
	}

	// =====================================================================
	// 待办
	// =====================================================================

	const KIND_LABEL = { approval: "审批", question: "提问", review: "验收", error: "错误", interrupted: "中断" };

	reg("right:todos", "待办", (el) => {
		let todos = [];
		let tab = "open";
		let alive = true;
		const seg = h("div", { class: "seg" });
		const list = h("div", { class: "list" });
		el.append(seg, list);

		function renderSeg() {
			seg.innerHTML = "";
			for (const [k, label] of [["open", "待处理"], ["closed", "已处理"]])
				seg.appendChild(h("button", { class: tab === k ? "active" : "", onclick: () => { tab = k; renderSeg(); render(); } }, label));
		}

		async function act(t, action, btn) {
			btn.disabled = true;
			try {
				await M.api("POST", "/todos/" + encodeURIComponent(t.id) + "/act", { action });
				await load();
			} catch (e) {
				M.toast("操作失败：" + e.message);
				btn.disabled = false;
			}
		}

		function render() {
			list.innerHTML = "";
			const rows = todos.filter((t) => (tab === "open" ? t.status === "open" : t.status !== "open"));
			if (!rows.length) return list.appendChild(empty(tab === "open" ? "没有待办事项" : "没有已处理的待办"));
			for (const t of rows) {
				const s = t.sessionId ? sessionById(t.sessionId) : null;
				const card = h(
					"div",
					{ class: "card" },
					h("div", { class: "top" }, h("span", { class: "kind " + t.kind }, KIND_LABEL[t.kind] || t.kind), s ? h("span", { class: "meta" }, sessionName(s)) : null),
					h("div", { class: "title" }, t.title),
					t.detail ? h("div", { class: "detail" }, t.detail) : null,
				);
				if (t.status === "open") {
					const actions = h("div", { class: "actions" });
					const uiReq = t.payload && t.payload.uiRequest;
					if (t.sessionId && uiReq && uiReq.id && M.chat && M.chat.respond) {
						for (const [id, label, primary] of [["Approve", "批准", true], ["Deny", "拒绝", false]]) {
							const b = h("button", { class: "btn" + (primary ? " primary" : "") }, label);
							b.onclick = async () => {
								b.disabled = true;
								try {
									await M.chat.respond(t.sessionId, { id: uiReq.id, type: "extension_ui_response", value: id }, b);
									await load();
								} catch (e) {
									M.toast("操作失败：" + e.message);
									b.disabled = false;
								}
							};
							actions.appendChild(b);
						}
					} else {
						const done = h("button", { class: "btn primary" }, "完成");
						done.onclick = () => act(t, "done", done);
						actions.appendChild(done);
					}
					if (t.sessionId) actions.appendChild(h("button", { class: "btn", onclick: () => M.nav.open("chat", { id: t.sessionId }) }, "打开会话"));
					const ign = h("button", { class: "btn danger" }, "忽略");
					ign.onclick = () => act(t, "ignore", ign);
					actions.appendChild(ign);
					card.appendChild(actions);
				} else {
					card.appendChild(h("div", { class: "meta", style: { marginTop: "6px" } }, "状态：" + t.status));
				}
				list.appendChild(card);
			}
		}

		async function load() {
			try {
				todos = await M.api("GET", "/todos/all");
				if (alive) render();
			} catch (e) {
				if (alive) {
					list.innerHTML = "";
					list.appendChild(empty("加载失败：" + e.message));
				}
			}
		}
		renderSeg();
		load();
		const off = sub({ "sse:todos": load, "sse:resync": load, visible: load });
		return () => {
			alive = false;
			off();
		};
	});

	// =====================================================================
	// 计划
	// =====================================================================

	reg("right:plan", "计划", (el, { sessionId }) => {
		const body = h("div", { class: "mc-pad" });
		const refreshBtn = h("button", { class: "btn" }, "刷新");
		el.append(h("div", { class: "mc-bar" }, h("span", { class: "meta", id: "plan-hint" }, "最新一条助手回复"), refreshBtn), body);
		const hint = el.querySelector("#plan-hint");
		let alive = true;
		async function load() {
			try {
				const r = await M.api("GET", "/sessions/" + encodeURIComponent(sessionId) + "/plan");
				if (!alive) return;
				hint.textContent = r.streaming ? "生成中…" : "最新一条助手回复";
				body.innerHTML = "";
				body.appendChild(r.text ? mdBox(r.text) : empty("暂无计划内容"));
			} catch (e) {
				if (alive) {
					body.innerHTML = "";
					body.appendChild(empty("加载失败：" + e.message));
				}
			}
		}
		const reload = debounce(load, 800);
		refreshBtn.onclick = load;
		load();
		const off = sub({
			"sse:rpc": (d) => d && d.sessionId === sessionId && reload(),
			visible: load,
		});
		return () => {
			alive = false;
			reload.cancel();
			off();
		};
	});

	// =====================================================================
	// 旁聊
	// =====================================================================

	reg("right:sidechat", "旁聊", (el, { sessionId }) => {
		let alive = true;
		let child = null; // open thread session id
		let items = [];
		let offset = 0;
		let optimistic = [];
		let fetching = false;
		let again = false;

		const wrap = h("div", { class: "mc-wrap" });
		el.appendChild(wrap);

		// ----- list view -----
		async function showList() {
			child = null;
			wrap.innerHTML = "";
			const ta = h("textarea", { class: "mc-ta", placeholder: "向这个会话发起一个旁聊问题…", rows: 2 });
			const go = h("button", { class: "btn primary" }, "发起旁聊");
			go.onclick = async () => {
				const q = ta.value.trim();
				if (!q) return M.toast("请输入问题");
				go.disabled = true;
				try {
					const info = await M.api("POST", "/sessions/" + encodeURIComponent(sessionId) + "/sidechats", { question: q });
					M.refreshSessions().catch(() => {});
					openThread(info.sessionId, q);
				} catch (e) {
					M.toast("发起失败：" + e.message);
					go.disabled = false;
				}
			};
			const list = h("div", { class: "list" });
			wrap.append(h("div", { class: "mc-new" }, ta, h("div", { class: "actions" }, go)), list);
			try {
				const rows = await M.api("GET", "/sessions/" + encodeURIComponent(sessionId) + "/sidechats");
				if (!alive || child) return;
				rows.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
				if (!rows.length) list.appendChild(empty("还没有旁聊"));
				for (const s of rows)
					list.appendChild(
						h(
							"div",
							{ class: "row", onclick: () => openThread(s.id) },
							h("span", { class: "sdot s-" + s.status }),
							h("div", { class: "main" }, h("div", { class: "t" }, h("span", { class: "name" }, sessionName(s)), h("span", { class: "time" }, relTime(s.updatedAt))), h("div", { class: "sub" }, STATUS_LABEL[s.status] || s.status)),
						),
					);
			} catch (e) {
				if (alive) list.appendChild(empty("加载失败：" + e.message));
			}
		}

		// ----- thread view -----
		function working() {
			const s = sessionById(child);
			return !!((M.state.live[child] && M.state.live[child].working) || (s && s.status === "working"));
		}

		function renderThread() {
			const msgs = wrap.querySelector(".mc-msgs");
			if (!msgs) return;
			const stick = nearBottom(msgs);
			const keep = msgs.scrollTop;
			msgs.innerHTML = "";
			for (const it of items.slice(-80)) for (const n of renderItem(it)) msgs.appendChild(n);
			for (const o of optimistic) msgs.appendChild(h("div", { class: "msg-user pending" }, o));
			if (working()) msgs.appendChild(h("div", { class: "typing" }, h("i"), h("i"), h("i")));
			msgs.scrollTop = stick ? msgs.scrollHeight : keep;
		}

		async function fetchThread() {
			if (!child) return;
			if (fetching) {
				again = true;
				return;
			}
			fetching = true;
			const id = child;
			try {
				const page = await M.api("GET", "/sessions/" + encodeURIComponent(id) + "/transcript?from=" + offset);
				if (id !== child || !alive) return;
				if (page.reset) items = [];
				items = items.concat(page.items || []);
				offset = page.nextOffset || offset;
				const users = (page.items || []).filter((x) => x.kind === "user" && x.text).map((x) => x.text.trim());
				optimistic = optimistic.filter((o) => !users.includes(o.trim()));
				renderThread();
			} catch (e) {
				/* transient; next event retries */
			} finally {
				fetching = false;
				if (again) {
					again = false;
					fetchThread();
				}
			}
		}
		const fetchSoon = debounce(fetchThread, 400);

		function openThread(id, firstQuestion) {
			child = id;
			items = [];
			offset = 0;
			optimistic = firstQuestion ? [firstQuestion] : [];
			wrap.innerHTML = "";
			const s = sessionById(id);
			const ta = h("textarea", { class: "mc-ta", placeholder: "继续追问…", rows: 1 });
			const send = h("button", { class: "btn primary" }, "发送");
			send.onclick = async () => {
				const text = ta.value.trim();
				if (!text) return;
				send.disabled = true;
				try {
					await M.api("POST", "/sessions/" + encodeURIComponent(id) + "/prompt", { text });
					ta.value = "";
					optimistic.push(text);
					renderThread();
					fetchSoon();
				} catch (e) {
					M.toast("发送失败：" + e.message);
				}
				send.disabled = false;
			};
			wrap.append(
				h("div", { class: "mc-bar" }, h("button", { class: "btn", onclick: showList }, "‹ 列表"), h("span", { class: "meta mc-grow" }, s ? sessionName(s) : "旁聊"), h("button", { class: "btn", onclick: () => M.nav.open("chat", { id }) }, "完整会话")),
				h("div", { class: "mc-msgs" }),
				h("div", { class: "mc-compose" }, ta, send),
			);
			renderThread();
			fetchThread();
		}

		showList();
		const off = sub({
			"sse:rpc": (d) => {
				if (d && child && d.sessionId === child) {
					const t = d.frame && d.frame.type;
					if (t === "agent_end" || t === "agent_start" || t === "turn_start") renderThread();
					fetchSoon();
				}
			},
			sessions: () => child && renderThread(),
			visible: () => child && fetchThread(),
		});
		return () => {
			alive = false;
			fetchSoon.cancel();
			off();
		};
	});

	// =====================================================================
	// 热力图（子代理）
	// =====================================================================

	const SA_STATUS = { pending: "等待", running: "运行中", completed: "完成", failed: "失败", aborted: "已中止" };
	const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n || 0));

	reg("right:heatmap", "热力图", (el, { sessionId }) => {
		let alive = true;
		let agents = [];
		let detailId = null;
		let detailTimer = 0;
		const wrap = h("div", { class: "mc-wrap" });
		el.appendChild(wrap);
		const sid = encodeURIComponent(sessionId);

		function stopDetail() {
			clearInterval(detailTimer);
			detailTimer = 0;
		}

		async function loadList() {
			try {
				agents = await M.api("GET", "/sessions/" + sid + "/subagents");
				if (alive && !detailId) renderList();
			} catch (e) {
				if (alive && !detailId) {
					wrap.innerHTML = "";
					wrap.appendChild(empty("加载失败：" + e.message));
				}
			}
		}

		function buildDiagnosePrompt() {
			const rows = agents.map((a, i) => `${i + 1}. [${a.status}] model=${a.model || "?"} requests=${a.requestCount} tools=${a.toolCallCount} tokens=${a.tokens} cost=$${(a.cost || 0).toFixed(3)} 任务: ${a.prompt || ""}`);
			return "你是会话体检助手。下面是一个会话中各子代理的运行统计，请用简体中文指出效率问题（高 token/成本、失败、重复工具调用等）并给出改进建议，控制在 300 字以内。\n\n" + rows.join("\n");
		}

		function renderList() {
			stopDetail();
			wrap.innerHTML = "";
			const out = h("div", { class: "mc-pad hidden" });
			const diag = h("button", { class: "btn primary" }, "会话体检");
			diag.onclick = async () => {
				if (!agents.length) return M.toast("没有子代理可体检");
				diag.disabled = true;
				diag.textContent = "体检中…";
				out.classList.remove("hidden");
				out.innerHTML = '<div class="meta">正在体检，最多约 2 分钟…</div>';
				try {
					const r = await M.api("POST", "/heatmap/diagnose", { prompt: buildDiagnosePrompt() });
					out.innerHTML = "";
					out.appendChild(mdBox(r.text || "（无输出）"));
				} catch (e) {
					out.innerHTML = "";
					out.appendChild(empty("体检失败：" + e.message));
				}
				diag.disabled = false;
				diag.textContent = "会话体检";
			};
			const total = agents.reduce((s, a) => s + (a.tokens || 0), 0);
			const cost = agents.reduce((s, a) => s + (a.cost || 0), 0);
			wrap.append(
				h("div", { class: "mc-bar" }, h("span", { class: "meta mc-grow" }, `${agents.length} 个子代理 · ${fmtTok(total)} tokens · $${cost.toFixed(2)}`), h("button", { class: "btn", onclick: loadList }, "刷新"), diag),
				out,
			);
			const list = h("div", { class: "list" });
			if (!agents.length) list.appendChild(empty("这个会话还没有子代理"));
			const max = Math.max(1, ...agents.map((a) => a.tokens || 0));
			for (const a of agents)
				list.appendChild(
					h(
						"div",
						{ class: "card mc-click", onclick: () => openDetail(a.id) },
						h("div", { class: "top" }, h("span", { class: "kind mc-st-" + a.status }, SA_STATUS[a.status] || a.status), h("span", { class: "meta" }, a.id), h("span", { class: "meta mc-grow", style: { textAlign: "right" } }, relTime(a.endedAt || a.startedAt))),
						h("div", { class: "title" }, a.prompt || "（无任务描述）"),
						h("div", { class: "meta" }, `${a.model || "?"} · ${a.requestCount} 请求 · ${a.toolCallCount} 工具 · ${fmtTok(a.tokens)} tok · $${(a.cost || 0).toFixed(3)}`),
						h("div", { class: "mc-heat" }, h("i", { style: { width: Math.max(2, ((a.tokens || 0) / max) * 100) + "%" } })),
					),
				);
			wrap.appendChild(list);
		}

		function openDetail(id) {
			detailId = id;
			let nextByte = 0;
			let items = [];
			let info = null;
			let fetching = false;
			wrap.innerHTML = "";
			const msgs = h("div", { class: "mc-msgs" });
			const head = h("div", { class: "mc-bar" });
			wrap.append(head, msgs);
			const back = () => {
				stopDetail();
				detailId = null;
				renderList();
				loadList();
			};
			function draw() {
				const stick = nearBottom(msgs);
				const keep = msgs.scrollTop;
				const s = info.summary;
				head.innerHTML = "";
				head.append(h("button", { class: "btn", onclick: back }, "‹ 列表"), h("span", { class: "meta mc-grow" }, `${id} · ${SA_STATUS[s.status] || s.status} · ${fmtTok(s.tokens)} tok`));
				msgs.innerHTML = "";
				if (info.prompt) msgs.appendChild(h("div", { class: "msg-user" }, info.prompt));
				for (const it of items) for (const n of renderItem(it)) msgs.appendChild(n);
				if (s.status !== "running" && info.output) msgs.appendChild(h("div", { class: "mc-out" }, h("div", { class: "meta" }, "输出"), mdBox(info.output)));
				msgs.scrollTop = stick ? msgs.scrollHeight : keep;
			}
			async function pull() {
				if (fetching || detailId !== id) return;
				fetching = true;
				try {
					const t = await M.api("GET", "/sessions/" + sid + "/subagents/" + encodeURIComponent(id) + "?fromByte=" + nextByte);
					if (!alive || detailId !== id) return;
					if (t.reset) items = [];
					items = items.concat(t.items || []);
					nextByte = t.nextByte || nextByte;
					info = t;
					draw();
					if (t.summary.status !== "running" && t.summary.status !== "pending") stopDetail();
				} catch (e) {
					if (!info) msgs.appendChild(empty("加载失败：" + e.message));
				} finally {
					fetching = false;
				}
			}
			pull();
			detailTimer = setInterval(pull, 3000);
		}

		const reload = debounce(loadList, 1500);
		loadList();
		const off = sub({ "sse:rpc": (d) => d && d.sessionId === sessionId && !detailId && reload(), visible: loadList });
		return () => {
			alive = false;
			stopDetail();
			reload.cancel();
			off();
		};
	});

	// =====================================================================
	// 服务
	// =====================================================================

	reg("right:services", "服务", (el) => {
		let alive = true;
		let all = false;
		const list = h("div", { class: "list" });
		const toggle = h("button", { class: "btn" }, "仅开发服务");
		const refresh = h("button", { class: "btn" }, "刷新");
		el.append(h("div", { class: "mc-bar" }, h("span", { class: "meta mc-grow" }, "监听中的本地服务"), toggle, refresh), list);

		async function load() {
			try {
				const rows = await M.api("GET", "/services?all=" + all);
				if (!alive) return;
				list.innerHTML = "";
				if (!rows.length) return list.appendChild(empty("没有监听中的服务"));
				for (const s of rows) {
					const stop = h("button", { class: "btn danger" }, "停止");
					stop.onclick = async () => {
						if (!(await M.confirm(`停止 ${s.name} (PID ${s.pid}, 端口 ${s.port})？`))) return;
						stop.disabled = true;
						try {
							await M.api("POST", "/services/" + s.pid + "/stop");
							M.toast("已停止");
						} catch (e) {
							M.toast("停止失败：" + e.message);
						}
						load();
					};
					const sess = s.sessionId ? sessionById(s.sessionId) : null;
					list.appendChild(
						h(
							"div",
							{ class: "card" },
							h("div", { class: "top" }, h("span", { class: "kind" }, ":" + s.port), h("span", { class: "title mc-grow", style: { margin: 0 } }, s.name), s.startedByApp ? h("span", { class: "meta" }, "应用启动") : null),
							h("div", { class: "detail" }, s.command),
							h("div", { class: "meta" }, `PID ${s.pid}` + (s.memoryKb ? " · " + (s.memoryKb / 1024).toFixed(0) + " MB" : "") + (sess ? " · " + sessionName(sess) : "") + (s.cwd ? " · " + s.cwd : "")),
							h("div", { class: "actions" }, stop),
						),
					);
				}
			} catch (e) {
				if (alive) {
					list.innerHTML = "";
					list.appendChild(empty("加载失败：" + e.message));
				}
			}
		}
		toggle.onclick = () => {
			all = !all;
			toggle.textContent = all ? "全部端口" : "仅开发服务";
			load();
		};
		refresh.onclick = load;
		load();
		const off = sub({ visible: load });
		return () => {
			alive = false;
			off();
		};
	});

	// =====================================================================
	// 终端
	// =====================================================================

	const ANSI16 = ["#1e1e1e", "#e5534b", "#57ab5a", "#c69026", "#539bf5", "#b083f0", "#39c5cf", "#cdd9e5", "#636e7b", "#ff7b72", "#6bc46d", "#daaa3f", "#6cb6ff", "#dcbdfb", "#56d4dd", "#ffffff"];
	function color256(n) {
		if (n < 16) return ANSI16[n];
		if (n >= 232) {
			const v = 8 + (n - 232) * 10;
			return `rgb(${v},${v},${v})`;
		}
		n -= 16;
		const c = (x) => (x ? 55 + x * 40 : 0);
		return `rgb(${c(Math.floor(n / 36))},${c(Math.floor(n / 6) % 6)},${c(n % 6)})`;
	}

	/** Minimal terminal screen model: line buffer + cursor + SGR + a few CSI motions. */
	class Screen {
		constructor(onDirty) {
			this.onDirty = onDirty;
			this.cols = 80;
			this.max = 3000;
			this.reset();
		}
		reset() {
			this.lines = [[]];
			this.row = 0;
			this.col = 0;
			this.style = {};
			this.state = "text";
			this.csi = "";
			this.dec = new TextDecoder("utf-8");
			this.trimmed = 0;
			this.dirty = new Set([-1]); // -1 = full redraw
		}
		mark(r) {
			this.dirty.add(r);
		}
		line(r) {
			while (this.lines.length <= r) this.lines.push([]);
			return this.lines[r];
		}
		put(ch) {
			if (this.col >= this.cols) this.newline(true);
			const ln = this.line(this.row);
			while (ln.length < this.col) ln.push({ c: " ", s: {} });
			ln[this.col] = { c: ch, s: this.style };
			this.col++;
			this.mark(this.row);
		}
		newline(wrap) {
			this.row++;
			this.col = 0;
			this.line(this.row);
			if (this.lines.length > this.max) {
				const drop = this.lines.length - this.max;
				this.lines.splice(0, drop);
				this.row -= drop;
				this.dirty.add(-1);
			}
			this.mark(this.row);
		}
		write(bytes) {
			const text = this.dec.decode(bytes, { stream: true });
			for (const ch of text) this.feed(ch);
			this.onDirty();
		}
		feed(ch) {
			if (this.state === "text") {
				const code = ch.charCodeAt(0);
				if (ch === "\x1b") this.state = "esc";
				else if (ch === "\n") this.newline(false);
				else if (ch === "\r") this.col = 0;
				else if (ch === "\b") this.col = Math.max(0, this.col - 1);
				else if (ch === "\t") {
					const n = 8 - (this.col % 8);
					for (let i = 0; i < n; i++) this.put(" ");
				} else if (code >= 32 && code !== 127) this.put(ch);
			} else if (this.state === "esc") {
				if (ch === "[") {
					this.state = "csi";
					this.csi = "";
				} else if (ch === "]") this.state = "osc";
				else this.state = "text";
			} else if (this.state === "csi") {
				if (ch >= "@" && ch <= "~") {
					this.state = "text";
					this.doCsi(ch, this.csi);
				} else this.csi += ch;
			} else if (this.state === "osc") {
				if (ch === "\x07") this.state = "text";
				else if (ch === "\x1b") this.state = "esc"; // ST begins with ESC \
			}
		}
		doCsi(f, p) {
			const priv = /^[?>=]/.test(p);
			const nums = p.replace(/^[?>=]/, "").split(";").map((x) => parseInt(x, 10));
			const n1 = Number.isFinite(nums[0]) ? nums[0] : 0;
			if (priv) return;
			if (f === "m") return this.sgr(nums.length ? nums.map((x) => (Number.isFinite(x) ? x : 0)) : [0]);
			if (f === "K") {
				const ln = this.line(this.row);
				if (n1 === 0) ln.length = Math.min(ln.length, this.col);
				else if (n1 === 2) ln.length = 0;
				else for (let i = 0; i <= this.col && i < ln.length; i++) ln[i] = { c: " ", s: {} };
				this.mark(this.row);
			} else if (f === "J") {
				if (n1 === 2 || n1 === 3) {
					this.lines = [[]];
					this.row = 0;
					this.col = 0;
					this.dirty.add(-1);
				} else if (n1 === 0) {
					this.line(this.row).length = Math.min(this.line(this.row).length, this.col);
					this.lines.length = this.row + 1;
					this.dirty.add(-1);
				}
			} else if (f === "A") this.row = Math.max(0, this.row - (n1 || 1));
			else if (f === "B") {
				this.row += n1 || 1;
				this.line(this.row);
			} else if (f === "C") this.col = Math.min(this.cols - 1, this.col + (n1 || 1));
			else if (f === "D") this.col = Math.max(0, this.col - (n1 || 1));
			else if (f === "G") this.col = Math.max(0, (n1 || 1) - 1);
			else if (f === "H" || f === "f") {
				// Absolute row is relative to the visible screen, which this model lacks;
				// approximate by moving the column only (home -> column).
				this.col = Math.max(0, (nums[1] || 1) - 1);
			} else if (f === "P") {
				const ln = this.line(this.row);
				ln.splice(this.col, n1 || 1);
				this.mark(this.row);
			}
		}
		sgr(ps) {
			let s = { ...this.style };
			for (let i = 0; i < ps.length; i++) {
				const p = ps[i];
				if (p === 0) s = {};
				else if (p === 1) s.b = true;
				else if (p === 2) s.d = true;
				else if (p === 3) s.i = true;
				else if (p === 4) s.u = true;
				else if (p === 7) s.r = true;
				else if (p === 22) delete s.b, delete s.d;
				else if (p === 23) delete s.i;
				else if (p === 24) delete s.u;
				else if (p === 27) delete s.r;
				else if (p >= 30 && p <= 37) s.fg = ANSI16[p - 30];
				else if (p >= 90 && p <= 97) s.fg = ANSI16[p - 90 + 8];
				else if (p >= 40 && p <= 47) s.bg = ANSI16[p - 40];
				else if (p >= 100 && p <= 107) s.bg = ANSI16[p - 100 + 8];
				else if (p === 39) delete s.fg;
				else if (p === 49) delete s.bg;
				else if (p === 38 || p === 48) {
					const key = p === 38 ? "fg" : "bg";
					if (ps[i + 1] === 5) {
						s[key] = color256(ps[i + 2] || 0);
						i += 2;
					} else if (ps[i + 1] === 2) {
						s[key] = `rgb(${ps[i + 2] || 0},${ps[i + 3] || 0},${ps[i + 4] || 0})`;
						i += 4;
					}
				}
			}
			this.style = s;
		}
		lineHtml(r) {
			const ln = this.lines[r] || [];
			let out = "";
			let i = 0;
			while (i < ln.length) {
				const s = ln[i].s;
				let txt = "";
				while (i < ln.length && ln[i].s === s) txt += ln[i++].c;
				const css = [];
				const fg = s.r ? s.bg || "#0f0f10" : s.fg;
				const bg = s.r ? s.fg || "#ececec" : s.bg;
				if (fg) css.push("color:" + fg);
				if (bg) css.push("background:" + bg);
				if (s.b) css.push("font-weight:700");
				if (s.d) css.push("opacity:.6");
				if (s.i) css.push("font-style:italic");
				if (s.u) css.push("text-decoration:underline");
				out += css.length ? `<span style="${css.join(";")}">${esc(txt)}</span>` : esc(txt);
			}
			return out || "\u200b";
		}
	}

	const KEYS = [
		["Esc", "\x1b"],
		["Tab", "\t"],
		["Ctrl-C", "\x03"],
		["Ctrl-D", "\x04"],
		["↑", "\x1b[A"],
		["↓", "\x1b[B"],
		["←", "\x1b[D"],
		["→", "\x1b[C"],
	];

	reg("right:terminal", "终端", (el, { sessionId }) => {
		let alive = true;
		let termId = null;
		let es = null;
		let exited = false;
		let retries = 0;
		let retryTimer = 0;
		let sendChain = Promise.resolve();
		let lastSize = "";

		const log = h("div", { class: "mc-term" });
		const status = h("span", { class: "meta mc-grow" }, "连接中…");
		const reBtn = h("button", { class: "btn" }, "重连");
		const newBtn = h("button", { class: "btn" }, "新终端");
		const input = h("input", { class: "mc-tin", type: "text", placeholder: "输入命令，回车发送", autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: false, enterkeyhint: "send" });
		const keybar = h("div", { class: "mc-keys" });
		const probe = h("span", { class: "mc-probe" }, "MMMMMMMMMM");
		const wrap = h("div", { class: "mc-wrap" }, h("div", { class: "mc-bar" }, status, reBtn, newBtn), log, keybar, h("div", { class: "mc-compose" }, input), probe);
		el.appendChild(wrap);

		// Pinned-to-bottom flag tracked from scroll events: a keyboard/viewport resize shrinks
		// the log before any nearBottom() check could run, which would otherwise unpin it.
		let stuck = true;
		log.addEventListener("scroll", () => (stuck = nearBottom(log)));
		let raf = 0;
		const rows = []; // dom per line
		const screen = new Screen(() => {
			if (!raf)
				raf = requestAnimationFrame(() => {
					raf = 0;
					paint();
				});
		});

		function paint() {
			const stick = stuck;
			const d = screen.dirty;
			screen.dirty = new Set();
			if (d.has(-1)) {
				log.innerHTML = "";
				rows.length = 0;
				d.clear();
				for (let r = 0; r < screen.lines.length; r++) d.add(r);
			}
			for (const r of d) {
				if (r >= screen.lines.length) continue;
				while (rows.length <= r) {
					const div = h("div", { class: "mc-tl" });
					rows.push(div);
					log.appendChild(div);
				}
				rows[r].innerHTML = screen.lineHtml(r);
			}
			while (rows.length > screen.lines.length) rows.pop().remove();
			if (stick) log.scrollTop = log.scrollHeight;
		}

		function size() {
			const cw = probe.getBoundingClientRect().width / 10 || 7;
			const lh = parseFloat(getComputedStyle(log).lineHeight) || 16;
			const cols = Math.max(20, Math.floor((log.clientWidth - 16) / cw));
			const rowsN = Math.max(5, Math.floor(log.clientHeight / lh));
			return { cols, rows: rowsN };
		}

		function setStatus(t, bad) {
			status.textContent = t;
			status.style.color = bad ? "var(--err)" : "";
		}

		function send(data) {
			if (!termId || exited) return M.toast("终端未连接");
			const id = termId;
			sendChain = sendChain
				.then(() => M.api("POST", "/terminal/" + id + "/input", { data }))
				.catch((e) => M.toast("发送失败：" + e.message));
		}

		const doResize = debounce(() => {
			if (!termId || !alive) return;
			const { cols, rows: r } = size();
			screen.cols = cols;
			const key = cols + "x" + r;
			if (key === lastSize) return;
			lastSize = key;
			M.api("POST", "/terminal/" + termId + "/resize", { cols, rows: r }).catch(() => {});
		}, 250);

		function attach() {
			if (!termId || !alive) return;
			if (es) es.close();
			const e = (es = new EventSource("/api/terminal/" + termId + "/stream"));
			e.onopen = () => {
				retries = 0;
				// Server replays the backlog on every (re)attach: start from a clean screen.
				screen.reset();
				screen.cols = size().cols;
				paint();
				setStatus("已连接 · " + (sessionById(sessionId) ? sessionName(sessionById(sessionId)) : ""));
			};
			e.addEventListener("data", (ev) => {
				try {
					const bin = atob(ev.data);
					const bytes = new Uint8Array(bin.length);
					for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
					screen.write(bytes);
				} catch (err) {
					console.error("terminal data", err);
				}
			});
			e.addEventListener("exit", (ev) => {
				exited = true;
				let code = null;
				try {
					code = JSON.parse(ev.data).code;
				} catch {}
				e.close();
				setStatus("进程已退出" + (code != null ? "（退出码 " + code + "）" : ""), true);
			});
			e.onerror = () => {
				if (exited || !alive) return;
				e.close();
				if (es === e) es = null;
				if (retries >= 5) return setStatus("连接断开，点击“重连”重试", true);
				retries++;
				setStatus("连接中断，重连中（" + retries + "）…", true);
				clearTimeout(retryTimer);
				retryTimer = setTimeout(attach, 1500 * retries);
			};
		}

		async function open() {
			exited = false;
			retries = 0;
			setStatus("连接中…");
			const { cols, rows: r } = size();
			screen.cols = cols;
			try {
				const res = await M.api("POST", "/terminal", { sessionId, cols, rows: r });
				if (!alive) {
					M.api("DELETE", "/terminal/" + res.termId).catch(() => {});
					return;
				}
				termId = res.termId;
				lastSize = cols + "x" + r;
				attach();
			} catch (err) {
				if (!alive) return;
				const full = /最多同时/.test(err.message);
				setStatus(full ? "终端数量已达上限（最多 4 个），请先在电脑上关闭多余终端后点“新终端”" : "打开失败：" + err.message, true);
			}
		}

		async function closeTerm() {
			clearTimeout(retryTimer);
			if (es) es.close();
			es = null;
			const id = termId;
			termId = null;
			if (id) await M.api("DELETE", "/terminal/" + id).catch(() => {});
		}

		reBtn.onclick = async () => {
			if (!termId || exited) return open_new();
			// The server reaps a detached PTY after 60 s (e.g. iOS suspended the tab):
			// re-attaching would 404 forever, so probe it and start a fresh terminal instead.
			const { cols, rows: r } = size();
			try {
				await M.api("POST", "/terminal/" + termId + "/resize", { cols, rows: r });
			} catch (e) {
				if (/不存在|已关闭/.test(e.message)) return open_new();
			}
			retries = 0;
			attach();
		};
		async function open_new() {
			await closeTerm();
			screen.reset();
			paint();
			open();
		}
		newBtn.onclick = open_new;

		for (const [label, seq] of KEYS) {
			const b = h("button", { class: "btn mc-key" }, label);
			// Keep the soft keyboard up: don't steal focus from the input.
			b.addEventListener("pointerdown", (ev) => ev.preventDefault());
			b.onclick = () => send(seq);
			keybar.appendChild(b);
		}
		input.addEventListener("keydown", (ev) => {
			if (ev.key !== "Enter") return;
			ev.preventDefault();
			send(input.value + "\r");
			input.value = "";
		});
		log.addEventListener("click", () => input.focus());

		const onResize = () => {
			if (stuck) log.scrollTop = log.scrollHeight;
			doResize();
		};
		window.addEventListener("resize", onResize);
		const off = sub({ viewport: onResize });
		// The page may be hidden (another page stacked on top) then shown again: re-attach if dropped.
		const offVis = sub({
			visible: () => {
				if (termId && !exited && !es) {
					retries = 0;
					attach();
				}
			},
		});
		requestAnimationFrame(open);
		return () => {
			alive = false;
			window.removeEventListener("resize", onResize);
			off();
			offVis();
			doResize.cancel();
			if (raf) cancelAnimationFrame(raf);
			closeTerm();
		};
	});
})();
