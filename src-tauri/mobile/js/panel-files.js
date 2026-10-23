"use strict";
/* Files slice: right:explorer (read-only browser) and right:git (status/stage/commit/branches/log). */
(function () {
	const M = window.M;
	const el = M.el;
	const q = encodeURIComponent;

	function sid(params) {
		return (params && params.sessionId) || (M.state.currentSession && M.state.currentSession.id);
	}

	function fmtSize(n) {
		if (n < 1024) return n + " B";
		if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
		return (n / 1048576).toFixed(1) + " MB";
	}

	function errBox(msg) {
		return el("div", { class: "pf-err" }, msg);
	}

	/** Sub-view header with a back button, used for in-page file/diff views. */
	function subHeader(title, onBack, ...extra) {
		return el(
			"div",
			{ class: "pf-sub" },
			el("button", { class: "pf-back", onclick: onBack }, "‹ 返回"),
			el("div", { class: "pf-subtitle" }, title),
			...extra,
		);
	}

	// ---------- lite diff renderer ----------
	function renderDiff(text) {
		const box = el("div", { class: "pf-diff" });
		if (!text || !text.trim()) {
			box.appendChild(el("div", { class: "empty" }, "没有差异"));
			return box;
		}
		for (const line of text.split("\n")) {
			let cls = "";
			if (line.startsWith("@@")) cls = "hunk";
			else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line)) cls = "meta";
			else if (line.startsWith("+")) cls = "add";
			else if (line.startsWith("-")) cls = "del";
			box.appendChild(el("div", { class: "pf-dl " + cls }, line || " "));
		}
		return box;
	}

	// ====================== Explorer ======================
	M.registerPage("right:explorer", {
		title: "文件",
		mount(root, params) {
			const id = sid(params);
			let wrap = true;
			let curDir = null;
			let seq = 0; // drops responses of superseded browse/openFile requests

			async function browse(path) {
				const mine = ++seq;
				root.replaceChildren(el("div", { class: "empty" }, "加载中…"));
				let data;
				try {
					data = await M.api("GET", `/sessions/${q(id)}/files` + (path ? `?path=${q(path)}` : ""));
				} catch (e) {
					if (mine !== seq) return;
					root.replaceChildren(errBox(e.message), el("div", { class: "pf-pad" }, el("button", { class: "pf-btn", onclick: () => browse(curDir) }, "重试")));
					return;
				}
				if (mine !== seq) return;
				curDir = data.path;
				root.replaceChildren(crumbs(data), list(data));
			}

			function crumbs(data) {
				const bar = el("div", { class: "pf-crumbs" });
				const parts = data.path.split("/").filter(Boolean);
				// Only show segments that are still inside a root (or the root itself).
				const roots = data.roots || [];
				const root0 = roots.filter((r) => data.path === r || data.path.startsWith(r + "/")).sort((a, b) => b.length - a.length)[0];
				let acc = "";
				const segs = [];
				for (const p of parts) {
					acc += "/" + p;
					segs.push({ name: p, path: acc });
				}
				const visible = root0 ? segs.filter((s) => s.path.length >= root0.length) : segs;
				visible.forEach((s, i) => {
					if (i) bar.appendChild(el("span", { class: "pf-sep" }, "›"));
					bar.appendChild(el("button", { class: "pf-crumb" + (i === visible.length - 1 ? " cur" : ""), onclick: () => browse(s.path) }, s.name));
				});
				if (data.parent)
					bar.prepend(el("button", { class: "pf-crumb up", "aria-label": "上一级", onclick: () => browse(data.parent) }, "↑"));
				requestAnimationFrame(() => (bar.scrollLeft = bar.scrollWidth));
				return bar;
			}

			function list(data) {
				const l = el("div", { class: "list" });
				if (!data.entries.length) l.appendChild(el("div", { class: "empty" }, "空目录"));
				for (const e of data.entries) {
					const isDir = e.kind === "dir";
					l.appendChild(
						el(
							"div",
							{ class: "row pf-row", onclick: () => (isDir ? browse(e.path) : openFile(e)) },
							el("span", { class: "pf-ico" }, isDir ? "📁" : "📄"),
							el("div", { class: "main" }, el("div", { class: "t" }, el("div", { class: "name" }, e.name), isDir ? null : el("div", { class: "time" }, fmtSize(e.size)))),
						),
					);
				}
				return l;
			}

			async function openFile(e) {
				const mine = ++seq;
				const body = el("div", { class: "pf-fbody" }, el("div", { class: "empty" }, "加载中…"));
				const wrapBtn = el("button", { class: "pf-btn sm", onclick: () => { wrap = !wrap; paint(); } }, "");
				let file = null;
				const view = el("div", { class: "pf-view" }, subHeader(e.name, () => browse(curDir), wrapBtn), body);
				root.replaceChildren(view);
				function paint() {
					wrapBtn.textContent = wrap ? "换行：开" : "换行：关";
					if (!file) return;
					body.replaceChildren();
					if (file.binary) {
						body.appendChild(el("div", { class: "empty" }, `二进制文件（${fmtSize(file.size)}），无法预览`));
						return;
					}
					if (file.truncated) body.appendChild(el("div", { class: "pf-note" }, `文件较大（${fmtSize(file.size)}），仅显示前 512 KB`));
					if (!file.text) body.appendChild(el("div", { class: "empty" }, "空文件"));
					else body.appendChild(el("pre", { class: "pf-code" + (wrap ? " wrap" : "") }, file.text));
				}
				paint();
				try {
					const f = await M.api("GET", `/sessions/${q(id)}/file?path=${q(e.path)}`);
					if (mine !== seq) return;
					file = f;
					paint();
				} catch (err) {
					if (mine !== seq) return;
					body.replaceChildren(errBox(err.message));
				}
			}

			if (!id) {
				root.appendChild(el("div", { class: "empty" }, "请先打开一个会话"));
				return;
			}
			browse(null);
		},
	});

	// ====================== Git ======================
	M.registerPage("right:git", {
		title: "Git",
		mount(root, params) {
			const id = sid(params);
			if (!id) {
				root.appendChild(el("div", { class: "empty" }, "请先打开一个会话"));
				return;
			}
			const base = `/sessions/${q(id)}/git`;
			let tab = "status";
			let busy = false;
			const content = el("div", { class: "pf-gcontent" });
			const tabs = el("div", { class: "seg" });
			const msgBox = el("textarea", { class: "pf-msg", rows: 3, placeholder: "提交信息" });

			function setTab(t) {
				tab = t;
				for (const b of tabs.children) b.classList.toggle("active", b.dataset.t === t);
				load();
			}
			for (const [t, label] of [["status", "变更"], ["branches", "分支"], ["log", "日志"]])
				tabs.appendChild(el("button", { dataset: { t }, class: t === tab ? "active" : "", onclick: () => setTab(t) }, label));

			root.append(tabs, content);

			function load() {
				if (tab === "status") return loadStatus();
				if (tab === "branches") return loadBranches();
				return loadLog();
			}

			async function act(fn) {
				if (busy) return;
				busy = true;
				try {
					await fn();
				} catch (e) {
					M.toast(e.message);
				} finally {
					busy = false;
				}
			}

			async function loadStatus(keepView) {
				const keep = content.scrollTop;
				if (keepView !== true) content.replaceChildren(el("div", { class: "empty" }, "加载中…"));
				let st;
				try {
					st = await M.api("GET", base + "/status");
				} catch (e) {
					content.replaceChildren(errBox(e.message));
					return;
				}
				if (tab !== "status") return;
				content.replaceChildren(statusView(st));
				if (keepView === true) content.scrollTop = keep;
			}

			function fileRow(f, staged) {
				const color = { M: "var(--warn)", A: "var(--ok)", D: "var(--err)", R: "var(--accent)", "??": "var(--muted)" }[f.status] || "var(--muted)";
				const slash = f.path.lastIndexOf("/");
				return el(
					"div",
					{ class: "row pf-row" },
					el("span", { class: "pf-st", style: { color } }, f.status),
					el(
						"div",
						{ class: "main", onclick: () => openDiff(f, staged) },
						el("div", { class: "name" }, slash >= 0 ? f.path.slice(slash + 1) : f.path),
						slash >= 0 ? el("div", { class: "sub", style: { WebkitLineClamp: 1 } }, f.path.slice(0, slash)) : null,
					),
					el(
						"button",
						{
							class: "pf-btn sm",
							onclick: (ev) => {
								ev.stopPropagation();
								stage(staged ? "unstage" : "stage", [f.path]);
							},
						},
						staged ? "取消暂存" : "暂存",
					),
				);
			}

			function section(title, files, staged) {
				if (!files.length) return null;
				return el(
					"div",
					{},
					el(
						"div",
						{ class: "pf-sec" },
						el("span", {}, `${title} (${files.length})`),
						el("button", { class: "pf-btn sm", onclick: () => stage(staged ? "unstage" : "stage", files.map((f) => f.path)) }, staged ? "全部取消暂存" : "全部暂存"),
					),
					files.map((f) => fileRow(f, staged)),
				);
			}

			function statusView(st) {
				if (!st.isRepo) return el("div", { class: "empty" }, "当前目录不是 Git 仓库");
				const staged = st.files.filter((f) => f.staged);
				const unstaged = st.files.filter((f) => f.unstaged);
				const commitBtn = el("button", { class: "pf-btn primary", onclick: () => commit(commitBtn) }, `提交 (${staged.length})`);
				return el(
					"div",
					{},
					el("div", { class: "pf-branch" }, "分支：", el("b", {}, st.branch || "(detached)")),
					el("div", { class: "pf-pad" }, msgBox, commitBtn),
					st.files.length ? null : el("div", { class: "empty", style: { padding: "30px 0" } }, "工作区干净"),
					section("已暂存", staged, true),
					section("未暂存", unstaged, false),
				);
			}

			function stage(kind, paths) {
				return act(async () => {
					await M.api("POST", `${base}/${kind}`, { paths });
					await loadStatus(true);
				});
			}

			function commit(btn) {
				return act(async () => {
					const message = msgBox.value;
					btn.disabled = true;
					try {
						await M.api("POST", base + "/commit", { message });
						msgBox.value = "";
						M.toast("已提交");
					} finally {
						btn.disabled = false;
					}
					await loadStatus(true);
				});
			}

			async function openDiff(f, staged) {
				const body = el("div", { class: "pf-fbody" }, el("div", { class: "empty" }, "加载中…"));
				content.replaceChildren(subHeader(f.path + (staged ? "（已暂存）" : ""), () => { tabs.style.display = ""; loadStatus(); }), body);
				tabs.style.display = "none";
				try {
					const r = await M.api("GET", `${base}/diff?path=${q(f.path)}&staged=${staged}`);
					body.replaceChildren(renderDiff(r.diff));
				} catch (e) {
					body.replaceChildren(errBox(e.message));
				}
			}

			async function loadBranches() {
				content.replaceChildren(el("div", { class: "empty" }, "加载中…"));
				try {
					const bs = await M.api("GET", base + "/branches");
					if (tab !== "branches") return;
					const l = el("div", { class: "list" });
					if (!bs.length) l.appendChild(el("div", { class: "empty" }, "没有分支"));
					for (const b of bs)
						l.appendChild(
							el(
								"div",
								{ class: "row" },
								el(
									"div",
									{ class: "main" },
									el("div", { class: "t" }, el("div", { class: "name" }, b.displayName || b.name), b.isCurrentWorktree ? el("span", { class: "pf-tag" }, "当前") : null, b.isRemote ? el("span", { class: "pf-tag dim" }, "远程") : null),
									b.upstream ? el("div", { class: "sub" }, "↳ " + b.upstream) : null,
								),
							),
						);
					content.replaceChildren(l);
				} catch (e) {
					content.replaceChildren(errBox(e.message));
				}
			}

			async function loadLog() {
				content.replaceChildren(el("div", { class: "empty" }, "加载中…"));
				try {
					const cs = await M.api("GET", base + "/log?limit=50");
					if (tab !== "log") return;
					const l = el("div", { class: "list" });
					if (!cs.length) l.appendChild(el("div", { class: "empty" }, "没有提交"));
					for (const c of cs)
						l.appendChild(
							el(
								"div",
								{ class: "row" },
								el(
									"div",
									{ class: "main" },
									el("div", { class: "t" }, el("div", { class: "name", style: { whiteSpace: "normal" } }, c.subject), el("div", { class: "time" }, M.util.relTime(c.ts))),
									el("div", { class: "sub" }, el("code", { class: "pf-sha" }, c.short), " · ", c.author),
								),
							),
						);
					content.replaceChildren(l);
				} catch (e) {
					content.replaceChildren(errBox(e.message));
				}
			}

			load();
		},
	});
})();
