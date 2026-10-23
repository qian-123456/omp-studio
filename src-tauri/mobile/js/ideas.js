"use strict";
/* 想法 (backlog) page: left:ideas. Mirrors desktop IdeasCapsule/QuickCapture/DispatchDialog. */
(function () {
	const { relTime, sessionName, sessionById } = M.util;
	const KINDS = [
		["idea", "想法"],
		["bug", "Bug"],
	];
	const KIND_LABEL = Object.fromEntries(KINDS);
	const STATUS_LABEL = { inbox: "待处理", dispatched: "已派发", done: "已完成", closed: "已关闭" };
	const base = (p) => (p ? p.replace(/\/+$/, "").split("/").pop() || p : "全局");
	const isActive = (it) => it.status === "inbox" || it.status === "dispatched";
	const curDir = () => (M.state.currentSession && M.state.currentSession.cwd) || null;

	let root = null;
	let items = [];
	let tab = "active";
	let selecting = false;
	const picked = new Set();
	let loading = false;

	const h = M.el;

	function closeSheet(sheet) {
		if (sheet._cleanup) sheet._cleanup();
		sheet.remove();
	}
	/** Bottom sheet; returns {sheet, body}. */
	function openSheet(title, body, footer) {
		const sheet = h(
			"div",
			{ class: "ideas-mask", onclick: (e) => e.target === sheet && closeSheet(sheet) },
			h(
				"div",
				{ class: "ideas-sheet" },
				h("div", { class: "ideas-sh-title" }, title, h("button", { class: "iconbtn", onclick: () => closeSheet(sheet), "aria-label": "关闭" }, "✕")),
				h("div", { class: "ideas-sh-body" }, body),
				footer ? h("div", { class: "actions ideas-sh-foot" }, footer) : null,
			),
		);
		document.body.appendChild(sheet);
		return sheet;
	}
	function kindSeg(value, onchange) {
		const seg = h("div", { class: "seg ideas-seg" });
		const draw = () => {
			seg.textContent = "";
			for (const [k, l] of KINDS)
				seg.appendChild(
					h(
						"button",
						{
							type: "button",
							class: k === value ? "active" : "",
							onclick: () => {
								value = k;
								onchange(k);
								draw();
							},
						},
						l,
					),
				);
		};
		draw();
		return seg;
	}

	async function load() {
		if (loading) return;
		loading = true;
		try {
			items = await M.api("GET", "/ideas");
			if (!M.state.sessions.length) await M.refreshSessions().catch(() => {});
		} catch (e) {
			M.toast("加载失败：" + e.message);
		}
		loading = false;
		render();
	}

	function sessionRefs(it) {
		return (it.refs || []).filter((r) => r.kind === "session" && r.sessionId);
	}
	function imageCount(it) {
		return (it.refs || []).filter((r) => r.kind === "image").length;
	}

	function render() {
		if (!root) return;
		root.textContent = "";
		const list = items.filter((it) => (tab === "active" ? isActive(it) : !isActive(it)));
		for (const id of [...picked]) if (!list.some((it) => it.id === id)) picked.delete(id);
		const nActive = items.filter(isActive).length;

		root.appendChild(
			h(
				"div",
				{ class: "ideas-bar" },
				h(
					"div",
					{ class: "seg" },
					h("button", { class: tab === "active" ? "active" : "", onclick: () => ((tab = "active"), render()) }, `进行中 ${nActive}`),
					h("button", { class: tab === "done" ? "active" : "", onclick: () => ((tab = "done"), render()) }, `已完成 ${items.length - nActive}`),
				),
				h("button", { class: "btn primary", onclick: openAdd }, "＋ 添加"),
				tab === "active" && list.length
					? h(
							"button",
							{
								class: "btn",
								onclick: () => {
									selecting = !selecting;
									picked.clear();
									render();
								},
							},
							selecting ? "取消多选" : "多选",
						)
					: null,
			),
		);

		if (!list.length) {
			root.appendChild(h("div", { class: "empty" }, tab === "active" ? "还没有想法，点右上「添加」记一条" : "暂无已完成的条目"));
			return;
		}

		// group by project; current project first, global last
		const groups = new Map();
		for (const it of list) {
			const k = it.projectDir || "";
			if (!groups.has(k)) groups.set(k, []);
			groups.get(k).push(it);
		}
		const cur = curDir() || "";
		const keys = [...groups.keys()].sort((a, b) => {
			const rank = (k) => (k === cur && k ? 0 : k === "" ? 2 : 1);
			return rank(a) - rank(b) || base(a).localeCompare(base(b));
		});
		for (const k of keys) {
			root.appendChild(
				h(
					"div",
					{ class: "ideas-group" },
					h("span", {}, k ? base(k) : "全局"),
					k === cur && k ? h("span", { class: "badge" }, "当前") : null,
					h("span", { class: "ideas-cnt" }, String(groups.get(k).length)),
				),
			);
			for (const it of groups.get(k)) root.appendChild(card(it));
		}
		if (selecting) {
			root.appendChild(
				h(
					"div",
					{ class: "ideas-multibar" },
					h("span", {}, `已选 ${picked.size}`),
					h("button", { class: "btn primary", disabled: picked.size === 0, onclick: () => openDispatch([...picked]) }, "派发所选"),
				),
			);
		}
	}

	function card(it) {
		const sess = sessionRefs(it);
		const imgs = imageCount(it);
		const tgt = it.targetSessionId ? sessionById(it.targetSessionId) : null;
		return h(
			"div",
			{
				class: "card ideas-card" + (picked.has(it.id) ? " picked" : ""),
				onclick: () => {
					if (selecting) {
						picked.has(it.id) ? picked.delete(it.id) : picked.add(it.id);
						render();
					} else openEdit(it);
				},
			},
			h(
				"div",
				{ class: "top" },
				selecting ? h("span", { class: "ideas-check" }, picked.has(it.id) ? "☑" : "☐") : null,
				h("span", { class: "kind ideas-k-" + it.kind }, KIND_LABEL[it.kind] || it.kind),
				h("span", { class: "badge" }, STATUS_LABEL[it.status] || it.status),
				h("span", { class: "meta", style: { marginLeft: "auto" } }, relTime(it.createdAt)),
			),
			h("div", { class: "title ideas-text" }, it.text),
			sess.length || imgs || tgt
				? h(
						"div",
						{ class: "meta ideas-refs" },
						imgs ? `🖼 ${imgs} 张图片` : null,
						sess.map((r) => h("span", {}, "💬 " + (sessionName(sessionById(r.sessionId)) || r.sessionId.slice(0, 8)))),
						tgt ? h("span", {}, "→ " + sessionName(tgt)) : null,
					)
				: null,
		);
	}

	// ---------- add ----------
	function openAdd() {
		const st = { kind: "idea", files: [], link: !!(M.state.currentSession && M.state.currentSession.id), dir: curDir() || "" };
		const ta = h("textarea", { class: "ideas-ta", rows: 4, placeholder: "记下想法或 Bug…" });
		const thumbs = h("div", { class: "ideas-thumbs" });
		const drawThumbs = () => {
			thumbs.textContent = "";
			st.files.forEach((f, i) =>
				thumbs.appendChild(
					h(
						"div",
						{ class: "ideas-thumb" },
						h("img", { src: f.url }),
						h("button", { onclick: () => ((st.files.splice(i, 1), URL.revokeObjectURL(f.url)), drawThumbs()) }, "✕"),
					),
				),
			);
		};
		const pick = (capture) => {
			const inp = h("input", { type: "file", accept: "image/*", multiple: !capture, style: { display: "none" } });
			if (capture) inp.setAttribute("capture", "environment");
			inp.onchange = () => {
				for (const f of inp.files) st.files.push({ blob: f, url: URL.createObjectURL(f) });
				drawThumbs();
				inp.remove();
			};
			document.body.appendChild(inp);
			inp.click();
		};
		const dirs = [...new Set([curDir(), ...items.map((i) => i.projectDir), ...M.state.sessions.map((s) => s.cwd)].filter(Boolean))];
		const dirSel = h(
			"select",
			{ class: "ideas-sel", onchange: () => (st.dir = dirSel.value) },
			h("option", { value: "" }, "全局（不属于项目）"),
			dirs.map((d) => h("option", { value: d, selected: d === st.dir }, base(d) + "  " + d)),
		);
		const cs = M.state.currentSession;
		const linkRow =
			cs && cs.id
				? h(
						"label",
						{ class: "ideas-link" },
						h("input", { type: "checkbox", checked: true, onchange: (e) => (st.link = e.target.checked) }),
						" 关联当前会话：" + (sessionName(sessionById(cs.id)) || cs.id.slice(0, 8)),
					)
				: null;
		const okBtn = h("button", { class: "btn primary" }, "保存");
		const sheet = openSheet(
			"添加想法",
			[
				ta,
				kindSeg(st.kind, (k) => (st.kind = k)),
				h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => pick(false) }, "🖼 相册"), h("button", { class: "btn", onclick: () => pick(true) }, "📷 拍照")),
				thumbs,
				h("div", { class: "meta" }, "所属项目"),
				dirSel,
				linkRow,
			],
			[
				h("button", { class: "btn", onclick: () => closeSheet(sheet) }, "取消"),
				okBtn,
			],
		);
		// Any close path (cancel, mask tap, save) releases the preview object URLs.
		sheet._cleanup = () => st.files.forEach((f) => URL.revokeObjectURL(f.url));
		okBtn.onclick = async () => {
			const text = ta.value.trim();
			if (!text && !st.files.length) return M.toast("请输入内容或添加图片");
			okBtn.disabled = true;
			try {
				const imagePaths = [];
				for (const f of st.files) imagePaths.push((await M.upload("/ideas/images", f.blob)).path);
				const body = { text, kind: st.kind, imagePaths };
				if (st.dir) body.projectDir = st.dir;
				if (st.link && cs && cs.id) body.sessionIds = [cs.id];
				const it = await M.api("POST", "/ideas", body);
				items.unshift(it);
				// object URLs are revoked by closeSheet's cleanup
				closeSheet(sheet);
				tab = "active";
				render();
				M.toast("已添加");
			} catch (e) {
				M.toast("添加失败：" + e.message);
				okBtn.disabled = false;
			}
		};
		ta.focus();
	}

	// ---------- edit ----------
	async function patch(it, p, msg) {
		try {
			const n = await M.api("PATCH", "/ideas/" + encodeURIComponent(it.id), p);
			const i = items.findIndex((x) => x.id === it.id);
			if (i >= 0) items[i] = n;
			render();
			if (msg) M.toast(msg);
			return n;
		} catch (e) {
			M.toast("操作失败：" + e.message);
			return null;
		}
	}
	function openEdit(it) {
		const st = { kind: it.kind };
		const ta = h("textarea", { class: "ideas-ta", rows: 5 });
		ta.value = it.text;
		const sess = sessionRefs(it);
		const imgs = imageCount(it);
		const saveBtn = h("button", { class: "btn primary" }, "保存");
		const stBtns = isActive(it)
			? [
					h("button", { class: "btn", onclick: async () => (closeSheet(sheet), patch(it, { status: "done" }, "已完成")) }, "✓ 完成"),
					h("button", { class: "btn", onclick: async () => (closeSheet(sheet), patch(it, { status: "closed" }, "已关闭")) }, "关闭"),
				]
			: [h("button", { class: "btn", onclick: async () => (closeSheet(sheet), patch(it, { status: "inbox" }, "已重新打开")) }, "重新打开")];
		const sheet = openSheet(
			"编辑 · " + (STATUS_LABEL[it.status] || it.status),
			[
				ta,
				kindSeg(st.kind, (k) => (st.kind = k)),
				h(
					"div",
					{ class: "meta ideas-refs" },
					h("span", {}, "项目：" + (it.projectDir ? base(it.projectDir) : "全局")),
					imgs ? h("span", {}, `🖼 ${imgs} 张图片`) : null,
					sess.map((r) => h("span", {}, "💬 " + (sessionName(sessionById(r.sessionId)) || r.sessionId.slice(0, 8)))),
				),
				h("div", { class: "actions" }, stBtns, h("button", { class: "btn", onclick: () => (closeSheet(sheet), openDispatch([it.id])) }, "派发"), h("button", { class: "btn danger", onclick: del }, "删除")),
			],
			[h("button", { class: "btn", onclick: () => closeSheet(sheet) }, "取消"), saveBtn],
		);
		async function del() {
			if (!(await M.confirm("确定删除这条想法？"))) return;
			try {
				await M.api("DELETE", "/ideas/" + encodeURIComponent(it.id));
				items = items.filter((x) => x.id !== it.id);
				closeSheet(sheet);
				render();
				M.toast("已删除");
			} catch (e) {
				M.toast("删除失败：" + e.message);
			}
		}
		saveBtn.onclick = async () => {
			const text = ta.value.trim();
			if (!text) return M.toast("内容不能为空");
			const p = {};
			if (text !== it.text) p.text = text;
			if (st.kind !== it.kind) p.kind = st.kind;
			if (!Object.keys(p).length) return closeSheet(sheet);
			if (await patch(it, p, "已保存")) closeSheet(sheet);
		};
	}

	// ---------- dispatch ----------
	function openDispatch(ids) {
		const sel = { sessionId: "" }; // "" = new session
		const cands = M.state.sessions.filter((s) => !s.archived && s.parentId == null);
		const list = h("div", { class: "list ideas-targets" });
		const draw = () => {
			list.textContent = "";
			const row = (id, name, sub) =>
				h(
					"div",
					{
						class: "row" + (sel.sessionId === id ? " ideas-sel-row" : ""),
						onclick: () => ((sel.sessionId = id), draw()),
					},
					h("span", { class: "ideas-radio" }, sel.sessionId === id ? "◉" : "○"),
					h("div", { class: "main" }, h("div", { class: "name" }, name), sub ? h("div", { class: "sub" }, sub) : null),
				);
			list.appendChild(row("", "＋ 新会话", "在条目所属项目中新建会话"));
			for (const s of cands) list.appendChild(row(s.id, sessionName(s), base(s.cwd) + " · " + (M.util.STATUS_LABEL[s.status] || s.status)));
		};
		draw();
		const go = h("button", { class: "btn primary" }, ids.length > 1 ? `派发 ${ids.length} 项` : "派发");
		const sheet = openSheet(
			"派发到会话",
			[h("div", { class: "meta" }, ids.length > 1 ? `将 ${ids.length} 项合并为一条提示发送` : "选择目标会话"), list],
			[h("button", { class: "btn", onclick: () => closeSheet(sheet) }, "取消"), go],
		);
		go.onclick = async () => {
			go.disabled = true;
			try {
				const body = sel.sessionId ? { sessionId: sel.sessionId } : {};
				if (!sel.sessionId && curDir()) body.cwd = curDir();
				const r =
					ids.length > 1
						? await M.api("POST", "/ideas/dispatch", { ids, ...body })
						: await M.api("POST", "/ideas/" + encodeURIComponent(ids[0]) + "/dispatch", body);
				for (const n of r.items || []) {
					const i = items.findIndex((x) => x.id === n.id);
					if (i >= 0) items[i] = n;
				}
				closeSheet(sheet);
				selecting = false;
				picked.clear();
				render();
				M.toast("已派发");
				M.refreshSessions().then(render).catch(() => {});
			} catch (e) {
				M.toast("派发失败：" + e.message);
				go.disabled = false;
			}
		};
	}

	M.registerPage("left:ideas", {
		title: "想法",
		mount(el) {
			root = el;
			el.classList.add("ideas-page");
			selecting = false;
			picked.clear();
			render();
			load();
		},
		unmount() {
			root = null;
		},
	});
})();
