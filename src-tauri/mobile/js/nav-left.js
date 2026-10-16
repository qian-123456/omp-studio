"use strict";
/* Left-drawer slice: home (grouped sessions + todos), and left:sessions / inbox / search /
   schedules / skills / settings pages. */
(function () {
	const { esc, relTime, sessionById, sessionName, STATUS_LABEL } = M.util;
	const h = M.el;
	const KIND_LABEL = {
		approval: "批准",
		question: "问题",
		error: "错误",
		interrupted: "中断",
		review: "验收",
		suggestion: "建议",
		service_left: "服务",
	};
	const reqOptions = (req) => {
		const raw = req.options || req.choices;
		if (!Array.isArray(raw) || raw.length === 0) return null;
		return raw.map((o) =>
			typeof o === "string"
				? { id: o, label: o }
				: { id: o.id ?? o.value ?? o.label, label: o.label ?? o.id ?? o.value },
		);
	};

	/* ---------------------------------------------------------------- shared bits */

	const MODES = [
		["code", "代码"],
		["work", "工作"],
		["study", "学习"],
		["research", "研究"],
		["chat", "聊天"],
	];
	const BUSY = new Set(["working", "awaiting_approval", "awaiting_answer"]);
	const sessionRow = (s, onMore, extra) => {
		const st = s.status || "idle";
		const warn = st === "awaiting_approval" || st === "awaiting_answer";
		return h(
			"div",
			{ class: "row lf-row", onclick: () => M.nav.open("chat", { id: s.id }) },
			h("span", { class: "sdot s-" + st }),
			h(
				"div",
				{ class: "main" },
				h(
					"div",
					{ class: "t" },
					s.pinned ? h("span", { class: "lf-pin" }, "📌") : null,
					h("span", { class: "name" }, sessionName(s)),
					h("span", { class: "time" }, relTime(s.updatedAt)),
				),
				st !== "idle" || s.unread || s.live || extra
					? h(
							"div",
							{ class: "st", style: { color: warn ? "var(--warn)" : "var(--muted)" } },
							[st !== "idle" ? STATUS_LABEL[st] || st : null, s.live ? "在线" : null, s.unread ? "未读" : null, extra || null].filter(Boolean).join(" · "),
						)
					: null,
			),
			onMore
				? h(
						"button",
						{
							class: "iconbtn lf-more",
							"aria-label": "更多操作",
							onclick: (e) => {
								e.stopPropagation();
								onMore(s);
							},
						},
						"⋯",
					)
				: null,
		);
	};

	/** Bottom action sheet. items: [{label, danger?, run}] */
	function sheet(title, items) {
		const close = () => back.remove();
		const back = h(
			"div",
			{ class: "lf-sheet-back", onclick: (e) => e.target === back && close() },
			h(
				"div",
				{ class: "lf-sheet" },
				title ? h("div", { class: "lf-sheet-title" }, title) : null,
				items.map((it) =>
					h(
						"button",
						{
							class: "lf-sheet-item" + (it.danger ? " danger" : ""),
							onclick: () => {
								close();
								it.run();
							},
						},
						it.label,
					),
				),
				h("button", { class: "lf-sheet-item cancel", onclick: close }, "取消"),
			),
		);
		document.body.appendChild(back);
		return close;
	}

	function promptSheet(title, initial) {
		return new Promise((resolve) => {
			const input = h("input", { class: "lf-input", value: initial || "", placeholder: "留空则恢复默认名称" });
			const done = (v) => {
				back.remove();
				resolve(v);
			};
			const back = h(
				"div",
				{ class: "lf-sheet-back", onclick: (e) => e.target === back && done(null) },
				h(
					"div",
					{ class: "lf-sheet" },
					h("div", { class: "lf-sheet-title" }, title),
					h("div", { style: { padding: "0 16px 12px" } }, input),
					h(
						"div",
						{ class: "lf-sheet-btns" },
						h("button", { class: "btn", onclick: () => done(null) }, "取消"),
						h("button", { class: "btn primary", onclick: () => done(input.value.trim()) }, "确定"),
					),
				),
			);
			document.body.appendChild(back);
			input.focus();
		});
	}

	async function newSessionIn(cwd) {
		try {
			const r = await M.api("POST", "/left/sessions", { cwd });
			await M.refreshSessions().catch(() => {});
			M.nav.open("chat", { id: r.sessionId });
		} catch (e) {
			M.toast("新建失败：" + e.message);
		}
	}

	async function pickDirAndCreate() {
		try {
			const { dirs } = await M.api("GET", "/left/dirs");
			if (!dirs.length) return M.toast("没有可用目录");
			sheet(
				"在哪个目录新建会话",
				dirs.map((d) => ({ label: (d.label || d.path) + (d.kind === "worktree" ? " (工作树)" : ""), run: () => newSessionIn(d.path) })),
			);
		} catch (e) {
			M.toast("加载目录失败：" + e.message);
		}
	}

	async function patchSession(s, patch, okText) {
		try {
			await M.api("PATCH", "/left/sessions/" + encodeURIComponent(s.id), patch);
			if (okText) M.toast(okText);
			await M.refreshSessions().catch(() => {});
			M.emit("lf:sessions-dirty", null);
		} catch (e) {
			M.toast("操作失败：" + e.message);
		}
	}

	function sessionActions(s) {
		const busy = BUSY.has(s.status) || s.live === true && s.status === "working";
		sheet(sessionName(s), [
			{ label: "打开", run: () => M.nav.open("chat", { id: s.id }) },
			{
				label: "重命名",
				run: async () => {
					const v = await promptSheet("重命名会话", s.title === s.label ? "" : s.title);
					if (v !== null) patchSession(s, { customName: v }, "已重命名");
				},
			},
			{ label: s.pinned ? "取消置顶" : "置顶", run: () => patchSession(s, { pinned: !s.pinned }) },
			s.archived
				? { label: "取消归档", run: () => patchSession(s, { archived: false }, "已取消归档") }
				: {
						label: "归档",
						danger: true,
						run: async () => {
							if (busy && !(await M.confirm("该会话正在运行或等待回复，确定要归档吗？"))) return;
							patchSession(s, { archived: true }, "已归档");
						},
					},
		]);
	}

	/* ---------------------------------------------------------------- grouped tree */

	let treeMode = "code";
	/* Group open/closed overrides keyed like desktop (`groupOpen`): key -> bool. Absent = the per-group default
	   (desktop `isGroupOpen(key, defaultOpen)`). Module-level so it survives SSE reloads and re-mounts. */
	const groupOpen = new Map();
	const DELETED_WT_LIMIT = 5;
	const DELETED_WT_STEP = 5;
	const UNASSIGNED_DIR_LIMIT = 10;
	const UNASSIGNED_DIR_STEP = 10;
	/** Desktop `getGroupStatusCounts`. */
	function statusCounts(sessions) {
		const c = { working: 0, awaiting: 0, error: 0, unread: 0 };
		for (const s of sessions) {
			if (s.status === "working") c.working++;
			else if (s.status === "awaiting_approval" || s.status === "awaiting_answer") c.awaiting++;
			else if (s.status === "error" || s.status === "interrupted") c.error++;
			if (s.unread || s.status === "review" || s.pending === "review") c.unread++;
		}
		return c;
	}
	/** Status bubbles shown on COLLAPSED headers only (desktop `StatusBubbles`). */
	function bubbles(sessions) {
		const c = statusCounts(sessions);
		if (!(c.working || c.awaiting || c.error || c.unread)) return null;
		return h(
			"span",
			{ class: "lf-bubs" },
			c.working ? h("span", { class: "lf-bub work", title: c.working + " 个运行中会话" }, h("span", { class: "sdot s-working" }), String(c.working)) : null,
			c.awaiting ? h("span", { class: "lf-bub await", title: c.awaiting + " 个待回复会话" }, c.awaiting + " 待回复") : null,
			c.unread ? h("span", { class: "lf-bub unread", title: c.unread + " 个未读会话" }, h("i", {}), String(c.unread)) : null,
			c.error ? h("span", { class: "lf-bub err", title: c.error + " 个异常或中断会话" }, h("i", {}), String(c.error)) : null,
		);
	}
	/* Progressive-disclosure state, shared by every tree instance so it survives re-render / SSE refresh. */
	const expandedCounts = new Map();
	const RECENT_LIMIT = 3;
	const RECENT_STEP = 5;
	const NO_WT_LIMIT = 5;
	const SEARCH_LIMIT = 8;
	const SEARCH_STEP = 10;
	const needsAttn = (s) => s.status === "working" || s.status === "awaiting_approval" || s.status === "awaiting_answer";
	const MODE_ICON = { code: "</>", work: "💼", study: "📖", research: "🔬", chat: "💬" };
	const baseName = (p) => String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p || "";
	const otherModeBusy = (mode) =>
		M.state.sessions.some((s) => (s.mode || "code") !== mode && !s.archived && needsAttn(s));
	const modeBusy = (mode) => M.state.sessions.some((s) => (s.mode || "code") === mode && !s.archived && needsAttn(s));

	function openModeMenu(onPick) {
		const close = sheet(
			"切换模式",
			MODES.map(([id, label]) => ({
				label: h(
					"span",
					{ class: "lf-mode-item" + (id === treeMode ? " cur" : "") },
					h("span", { class: "lf-mode-ic" }, MODE_ICON[id]),
					h("span", { class: "lf-mode-nm" }, label),
					modeBusy(id) && id !== treeMode ? h("span", { class: "lf-act-dot" }) : null,
					id === treeMode ? h("span", { class: "lf-mode-ck" }, "✓") : null,
				),
				run: () => onPick(id),
			})),
		);
		return close;
	}

	/** Keep only sessions whose id is in `ids`; drop emptied subgroups/groups (search view of the tree). */
	function filterTree(d, ids) {
		const f = (l) => l.filter((s) => ids.has(s.id));
		const fsub = (sb) => ({ ...sb, sessions: f(sb.sessions), totalCount: f(sb.sessions).length });
		const fgroup = (g) => {
			const subgroups = g.subgroups.map(fsub).filter((sb) => sb.sessions.length);
			const deletedSubgroups = g.deletedSubgroups.map(fsub).filter((sb) => sb.sessions.length);
			if (!subgroups.length && !deletedSubgroups.length) return null;
			return { ...g, subgroups, deletedSubgroups, pinnedCount: 0, totalCount: subgroups.reduce((n, sb) => n + sb.sessions.length, 0) };
		};
		return {
			pinned: f(d.pinned),
			globalGroup: d.globalGroup ? fgroup(d.globalGroup) : null,
			workspaceGroups: d.workspaceGroups.map(fgroup).filter(Boolean),
			unassignedGroups: d.unassignedGroups.map((u) => ({ ...u, sessions: f(u.sessions) })).filter((u) => u.sessions.length),
			deletedSessions: f(d.deletedSessions),
			archived: f(d.archived),
		};
	}

	function createTree(host, opts) {
		const searching = !!(opts && opts.searching);
		let alive = true;
		let timer = 0;
		let data = null;
		let err = null;
		let filterIds = null; /* searching mode: Set of matching session ids (null = no query yet) */
		const modeBtn = h("button", { class: "lf-modebtn", "aria-haspopup": "menu", onclick: () => openModeMenu((id) => ((treeMode = id), load(), opts && opts.onModeChange && opts.onModeChange())) });
		const modeBar = h("div", { class: "lf-modes" }, modeBtn);
		const body = h("div", { class: "lf-tree" });
		host.append(modeBar, body);
		const renderModeBtn = () => {
			const label = (MODES.find((m) => m[0] === treeMode) || MODES[0])[1];
			modeBtn.textContent = "";
			modeBtn.append(
				h("span", { class: "lf-mode-ic" }, MODE_ICON[treeMode]),
				h("span", { class: "lf-mode-cur" }, label),
				h("span", { class: "lf-chev" }, "▾"),
				...(otherModeBusy(treeMode) ? [h("span", { class: "lf-act-dot abs" })] : []),
			);
			modeBtn.title = label + " 模式（点击切换）";
		};

		/** Desktop `isGroupOpen`: forced open while searching, else user override, else default. */
		const isOpen = (key, def) => searching || (groupOpen.has(key) ? groupOpen.get(key) : def);
		const toggleOpen = (key, def) => {
			if (searching) return;
			groupOpen.set(key, !isOpen(key, def));
			render();
		};
		const projTitle = (name, hint) =>
			h(
				"span",
				{ class: "lf-proj" },
				h("span", { class: "lf-proj-ic" }, "📁"),
				h("span", { class: "lf-proj-tx" }, h("span", { class: "lf-proj-nm" }, name), hint ? h("span", { class: "lf-proj-path" }, hint) : null),
			);
		const plusBtn = (cwd, label) =>
			h(
				"button",
				{
					class: "iconbtn lf-plus",
					"aria-label": "在 " + label + " 新建会话",
					onclick: (e) => {
						e.stopPropagation();
						newSessionIn(cwd);
					},
				},
				"＋",
			);
		const rerender = () => render();
		/** Capped list with 展开 N 条 / 收起 and hairline gaps (desktop SessionList). */
		function cappedList(scopeKey, sessions, baseLimit) {
			const limit = searching ? SEARCH_LIMIT : baseLimit;
			const step = searching ? SEARCH_STEP : RECENT_STEP;
			const moreKey = scopeKey + "|more";
			const curId = M.state.currentSession && M.state.currentSession.id;
			const visible = Math.min(Math.max(expandedCounts.get(moreKey) ?? limit, limit), sessions.length);
			const keep = (s, i) => i < visible || needsAttn(s) || s.id === curId;
			const shown = sessions.filter(keep);
			const hidden = sessions.length - shown.length;
			const next = Math.min(visible + step, sessions.length);
			const fresh = sessions.slice(visible, next).filter((s) => !needsAttn(s) && s.id !== curId).length;
			const expandable = fresh > 0 ? fresh : Math.min(step, hidden);
			const out = [];
			let skipped = 0;
			sessions.forEach((s, i) => {
				if (!keep(s, i)) return void skipped++;
				if (skipped > 0) {
					out.push(h("div", { class: "lf-gap", "aria-hidden": "true" }, h("span", {}), h("em", {}, skipped + " 条未显示"), h("span", {})));
					skipped = 0;
				}
				out.push(sessionRow(s, sessionActions));
			});
			const showExpand = hidden > 0;
			const showCollapse = visible > limit;
			if (showExpand || showCollapse)
				out.push(
					h(
						"div",
						{ class: "lf-more-bar" },
						h("span", { class: "ln" }),
						showExpand
							? h("button", { class: "lf-more-btn", onclick: () => (expandedCounts.set(moreKey, visible + step), rerender()) }, "＋ 展开 " + expandable + " 条")
							: null,
						showExpand && showCollapse ? h("span", { class: "sep" }, "｜") : null,
						showCollapse
							? h("button", { class: "lf-more-btn dim", onclick: () => (expandedCounts.delete(moreKey), rerender()) }, "▴ 收起")
							: null,
						h("span", { class: "ln" }),
					),
				);
			return out;
		}
		const flatList = (sessions) => sessions.map((s) => sessionRow(s, sessionActions));
		/** `展开 N <unit>` / `收起` bar for capped lists of subgroups (dirs / deleted worktrees). */
		function capBar(moreKey, total, limit, step, unit, exemptWhenSearching) {
			const visible = Math.min(Math.max(expandedCounts.get(moreKey) ?? limit, limit), total);
			const hidden = total - visible;
			if (total <= limit) return { visible, bar: null };
			if (searching && exemptWhenSearching) return { visible: total, bar: null };
			const bar = h(
				"div",
				{ class: "lf-more-bar" },
				h("span", { class: "ln" }),
				hidden > 0 ? h("button", { class: "lf-more-btn", onclick: () => (expandedCounts.set(moreKey, visible + step), rerender()) }, "＋ 展开 " + Math.min(step, hidden) + " 个" + unit) : null,
				hidden > 0 && visible > limit ? h("span", { class: "sep" }, "｜") : null,
				visible > limit ? h("button", { class: "lf-more-btn dim", onclick: () => (expandedCounts.delete(moreKey), rerender()) }, "▴ 收起") : null,
				h("span", { class: "ln" }),
			);
			return { visible, bar };
		}
		async function batchArchive(title, sessions) {
			const list = sessions.filter((s) => !s.archived);
			if (!list.length) return M.toast("该分组下无需要归档的会话");
			if (!(await M.confirm("确定批量归档「" + title + "」下的 " + list.length + " 个会话？"))) return;
			const rs = await Promise.allSettled(list.map((s) => M.api("PATCH", "/left/sessions/" + encodeURIComponent(s.id), { archived: true })));
			const fail = rs.filter((r) => r.status === "rejected").length;
			M.toast(fail ? "已归档 " + (list.length - fail) + " 个，" + fail + " 个失败" : "已归档 " + list.length + " 个会话");
			await M.refreshSessions().catch(() => {});
			M.emit("lf:sessions-dirty", null);
		}
		const actBtn = (label, text, fn, cls) =>
			h(
				"button",
				{
					class: "iconbtn lf-act" + (cls ? " " + cls : ""),
					"aria-label": label,
					onclick: (e) => {
						e.stopPropagation();
						fn();
					},
				},
				text,
			);
		/** Generic collapsible header + body. `def` = desktop default-open rule; bubbles only while collapsed. */
		function group(key, def, { cls, level, title, count, actions, status, body: bodyFn }) {
			const open = isOpen(key, def);
			return h(
				"div",
				{ class: cls || "" },
				h(
					"div",
					{ class: level === "sub" ? "lf-sub-h" : "lf-sec-h", onclick: () => toggleOpen(key, def) },
					h("span", { class: "lf-caret" }, open ? "▾" : "▸"),
					title,
					count != null ? h("span", { class: "lf-cnt" }, String(count)) : null,
					open || !status ? null : bubbles(status),
					actions || null,
				),
				open ? bodyFn() : null,
			);
		}
		/** Desktop CollapsibleSubgroup: live non-empty open, empty/deleted collapsed. */
		function subgroupEl(sub, scopeKey, onArchive) {
			const empty = sub.sessions.length === 0;
			return group(scopeKey + "|sub", !(sub.deleted || empty), {
				cls: "lf-sub" + (empty && !sub.deleted ? " lf-dimwrap" : ""),
				level: "sub",
				title: [
					h("span", { class: "lf-br-ic" }, sub.kind === "worktree" ? "⑂" : "⎇"),
					h("span", { class: "lf-sec-t" }, sub.label),
					sub.isMain ? h("span", { class: "lf-tag" }, "主目录") : null,
					sub.deleted ? h("span", { class: "lf-tag" }, "已清理") : null,
					!sub.deleted && empty ? h("span", { class: "lf-tag it" }, "暂无会话") : null,
				],
				count: empty ? null : sub.sessions.length,
				status: sub.sessions,
				actions: [
					!sub.deleted && sub.createCwd ? plusBtn(sub.createCwd, sub.label) : null,
					sub.deleted && onArchive ? actBtn("归档该分支全部会话", "🗄", onArchive) : null,
				],
				body: () => h("div", { class: "lf-nest" }, cappedList(scopeKey, sub.sessions, RECENT_LIMIT)),
			});
		}
		function emptyFolder(gkey, subs) {
			if (!subs.length) return null;
			const fk = gkey + "|__empty";
			return group(fk, false, {
				cls: "lf-sub lf-dimwrap",
				level: "sub",
				title: [h("span", { class: "lf-br-ic" }, "⎇"), h("span", { class: "lf-sec-t" }, "空闲工作树 (" + subs.length + ")")],
				body: () => h("div", { class: "lf-nest" }, subs.map((sb) => subgroupEl(sb, fk + "|" + sb.key))),
			});
		}
		function deletedFolder(gkey, subs) {
			if (!subs.length) return null;
			const fk = gkey + "|__deleted";
			const all = subs.flatMap((sb) => sb.sessions);
			return group(fk, false, {
				cls: "lf-sub lf-dimwrap",
				level: "sub",
				title: [h("span", { class: "lf-br-ic" }, "⑂"), h("span", { class: "lf-sec-t" }, "已清理工作树 (" + subs.length + ")")],
				status: subs.flatMap((sb) => sb.sessions),
				actions: actBtn("一键归档全部已清理工作树的会话", "🗄", () => batchArchive("已清理工作树", all)),
				body: () => {
					const { visible, bar } = capBar(fk + "|wt_more", subs.length, DELETED_WT_LIMIT, DELETED_WT_STEP, "工作树");
					return h("div", { class: "lf-nest" }, subs.slice(0, visible).map((sb) => subgroupEl(sb, fk + "|" + sb.key, () => batchArchive(sb.label, sb.sessions))), bar);
				},
			});
		}
		function groupEls(g, prefix) {
			const ws = g.workspace;
			const title = g.isGlobal ? "无项目" : ws.name || baseName(ws.path);
			const gkey = prefix + ":" + ws.id;
			const live = g.subgroups.filter((x) => !x.deleted && x.sessions.length > 0);
			const empty = g.subgroups.filter((x) => !x.deleted && x.sessions.length === 0);
			return [
				group(gkey, true, {
					cls: "lf-sec lf-project",
					title: projTitle(title, g.isGlobal ? "" : ws.path),
					count: g.totalCount,
					status: g.subgroups.filter((x) => !x.deleted),
					actions: ws.path ? plusBtn(ws.path, title) : null,
					body: () => {
						const trulyEmpty = g.totalCount === 0 && (g.pinnedCount ?? 0) === 0 && !live.length && !empty.length && !g.deletedSubgroups.length;
						if (trulyEmpty) return h("div", { class: "lf-none" }, "暂无会话");
						const multi = live.length > 1 || (live[0] && live[0].kind !== "default" && !live[0].isMain);
						return h(
							"div",
							{},
							multi ? live.map((sb) => subgroupEl(sb, gkey + "|" + sb.key, null)) : cappedList(gkey + "|default", live[0] ? live[0].sessions : [], NO_WT_LIMIT),
							emptyFolder(gkey, empty),
							deletedFolder(gkey, g.deletedSubgroups),
						);
					},
				}),
			];
		}
		/** One directory under 未归入工作区 (desktop UnassignedDirSubgroup). */
		function unassignedDir(u) {
			const key = "__unassigned|" + u.key;
			return group(key, false, {
				cls: "lf-sub",
				level: "sub",
				title: [h("span", { class: "lf-br-ic" }, "📁"), h("span", { class: "lf-sec-t", title: u.cwd }, u.label || baseName(u.cwd))],
				count: u.sessions.length,
				status: u.sessions,
				actions: [
					actBtn("归档该目录下全部会话", "🗄", () => batchArchive(u.label, u.sessions)),
					actBtn("将 " + u.cwd + " 添加为工作区", "＋📁", async () => {
						try {
							await M.api("POST", "/left/workspaces", { path: u.cwd });
							M.toast("已添加工作区「" + u.label + "」");
							await load();
						} catch (e) {
							M.toast("添加工作区失败：" + e.message);
						}
					}, "lf-addws"),
				],
				body: () => h("div", { class: "lf-nest" }, cappedList(key, u.sessions, RECENT_LIMIT)),
			});
		}
		async function assignAll(sessions) {
			let dirs;
			try {
				dirs = (await M.api("GET", "/left/dirs")).dirs.filter((x) => x.kind === "workspace" && x.mode === treeMode);
			} catch (e) {
				return M.toast("加载工作区失败：" + e.message);
			}
			if (!dirs.length) return M.toast("当前空间还没有工作区");
			sheet(
				"归入工作区（" + sessions.length + " 个会话）",
				dirs.map((x) => ({
					label: x.label || x.path,
					run: async () => {
						const rs = await Promise.allSettled(sessions.map((s) => M.api("PATCH", "/left/sessions/" + encodeURIComponent(s.id), { workspaceId: x.workspaceId })));
						const fail = rs.filter((r) => r.status === "rejected").length;
						M.toast(fail === sessions.length ? "更新工作区归属失败" : fail ? "已更新 " + (sessions.length - fail) + " 个，" + fail + " 个失败" : "已更新工作区归属");
						await M.refreshSessions().catch(() => {});
						M.emit("lf:sessions-dirty", null);
					},
				})),
			);
		}
		function unassignedBucket(d) {
			const dirs = d.unassignedGroups;
			const all = dirs.flatMap((u) => u.sessions);
			return group("__unassigned", false, {
				cls: "lf-sec lf-project",
				title: [h("span", { class: "lf-proj-ic" }, "🔍"), h("span", { class: "lf-sec-t" }, "未归入工作区")],
				count: all.length,
				status: all,
				body: () => {
					const { visible, bar } = capBar("__unassigned|dir_more", dirs.length, UNASSIGNED_DIR_LIMIT, UNASSIGNED_DIR_STEP, "目录", true);
					return h(
						"div",
						{},
						dirs.slice(0, visible).map(unassignedDir),
						bar,
						h(
							"div",
							{ class: "lf-more-bar" },
							h("span", { class: "ln" }),
							h("button", { class: "lf-more-btn", onclick: () => batchArchive("未归入工作区", all) }, "🗄 全部归档 (" + all.length + ")"),
							h("span", { class: "sep" }, "｜"),
							h("button", { class: "lf-more-btn", onclick: () => assignAll(all) }, "归入工作区…"),
							h("span", { class: "ln" }),
						),
					);
				},
			});
		}
		function render() {
			if (!alive) return;
			renderModeBtn();
			body.textContent = "";
			if (err) return void body.appendChild(h("div", { class: "empty" }, "加载失败：" + err));
			if (!data) return void body.appendChild(h("div", { class: "empty" }, "加载中…"));
			if (searching && !filterIds) return;
			const d = searching ? filterTree(data, filterIds) : data;
			const parts = [];
			if (d.pinned.length) parts.push(group("__pinned", true, { cls: "lf-sec", title: h("span", { class: "lf-sec-t" }, "📌 置顶"), count: d.pinned.length, status: d.pinned, body: () => h("div", {}, flatList(d.pinned)) }));
			if (d.globalGroup) parts.push(...groupEls(d.globalGroup, "g"));
			for (const g of d.workspaceGroups) parts.push(...groupEls(g, "w"));
			if (d.unassignedGroups.length) parts.push(unassignedBucket(d));
			if (d.deletedSessions.length)
				parts.push(
					group("__deleted", false, {
						cls: "lf-sec lf-dimwrap",
						title: [h("span", { class: "lf-proj-ic" }, "⑂"), h("span", { class: "lf-sec-t" }, "已清理工作树")],
						count: d.deletedSessions.length,
						status: d.deletedSessions,
						actions: actBtn("一键归档全部已清理工作树的会话", "🗄", () => batchArchive("已清理工作树", d.deletedSessions)),
						body: () => h("div", {}, cappedList("__deleted", d.deletedSessions, RECENT_LIMIT)),
					}),
				);
			if (d.archived.length) parts.push(group("archived", false, { cls: "lf-sec", title: h("span", { class: "lf-sec-t" }, "🗄 已归档"), count: d.archived.length, body: () => h("div", {}, cappedList("archived", d.archived, NO_WT_LIMIT)) }));
			if (!parts.length) parts.push(h("div", { class: "empty" }, searching ? "没有匹配的会话" : "没有会话"));
			body.append(...parts);
		}
		async function load() {
			render();
			try {
				const mine = treeMode;
				const r = await M.api("GET", "/left/sessions?mode=" + mine);
				if (mine !== treeMode) return;
				data = r;
				err = null;
			} catch (e) {
				err = e.message;
			}
			render();
		}
		const soon = () => {
			clearTimeout(timer);
			timer = setTimeout(load, 400);
		};
		const evts = ["sessions", "lf:sessions-dirty"];
		evts.forEach((e) => M.on(e, soon));
		load();
		return {
			reload: load,
			setFilter(ids) {
				filterIds = ids;
				render();
			},
			destroy() {
				alive = false;
				clearTimeout(timer);
				evts.forEach((e) => M.off(e, soon));
			},
		};
	}

	/* ---------------------------------------------------------------- left:sessions page */

	M.registerPage("left:sessions", {
		title: "会话",
		mount(el) {
			el.classList.add("lf-page");
			const bar = h("div", { class: "lf-bar" }, h("button", { class: "btn primary", onclick: pickDirAndCreate }, "＋ 新建会话"));
			const host = h("div", {});
			el.append(bar, host);
			this.tree = createTree(host);
		},
		unmount() {
			this.tree && this.tree.destroy();
		},
	});

	/* ---------------------------------------------------------------- inbox */

	const INBOX_TITLES = { awaiting: "待回复", error: "中断 / 错误", unread: "未读", running: "运行中" };
	M.registerPage("left:inbox", {
		title: "收件箱",
		mount(el) {
			el.classList.add("lf-page");
			let alive = true;
			const host = h("div", {});
			const readAll = h("button", { class: "btn", onclick: doReadAll }, "全部已读");
			el.append(h("div", { class: "lf-bar" }, readAll), host);
			async function doReadAll() {
				try {
					const r = await M.api("POST", "/left/inbox/read-all");
					M.toast("已标记 " + (r.count ?? 0) + " 个会话");
					load();
				} catch (e) {
					M.toast("操作失败：" + e.message);
				}
			}
			async function seen(s) {
				try {
					await M.api("POST", "/left/inbox/" + encodeURIComponent(s.id) + "/seen");
					load();
				} catch (e) {
					M.toast("操作失败：" + e.message);
				}
			}
			async function load() {
				try {
					const d = await M.api("GET", "/left/inbox");
					if (!alive) return;
					host.textContent = "";
					let n = 0;
					for (const k of d.order || ["awaiting", "error", "unread", "running"]) {
						const items = d[k] || [];
						if (!items.length) continue;
						n += items.length;
						host.appendChild(h("div", { class: "lf-sec-h static", dataset: { sec: k } }, h("span", { class: "lf-sec-t" }, INBOX_TITLES[k] || k), h("span", { class: "lf-cnt" }, String(items.length))));
						for (const s of items) {
							const row = sessionRow(s, null);
							row.onclick = () => {
								if (k === "unread" || k === "error") seen(s).catch(() => {});
								M.nav.open("chat", { id: s.id });
							};
							if (k === "unread" || k === "error")
								row.appendChild(
									h("button", { class: "btn lf-seen", onclick: (e) => (e.stopPropagation(), seen(s)) }, "已读"),
								);
							host.appendChild(row);
						}
					}
					readAll.disabled = !((d.unread || []).length || (d.error || []).length);
					if (!n) host.appendChild(h("div", { class: "empty" }, "收件箱是空的"));
				} catch (e) {
					host.textContent = "";
					host.appendChild(h("div", { class: "empty" }, "加载失败：" + e.message));
				}
			}
			const soon = () => load();
			M.on("sessions", soon);
			this.cleanup = () => {
				alive = false;
				M.off("sessions", soon);
			};
			load();
		},
		unmount() {
			this.cleanup && this.cleanup();
		},
	});

	/* ---------------------------------------------------------------- search */

	M.registerPage("left:search", {
		title: "搜索",
		mount(el) {
			el.classList.add("lf-page");
			let timer = 0;
			let seq = 0;
			const input = h("input", { class: "lf-input", type: "search", placeholder: "搜索会话、分支…", autocomplete: "off" });
			const arch = h("input", { type: "checkbox" });
			const out = h("div", {});
			const treeHost = h("div", {});
			const tree = createTree(treeHost, { searching: true, onModeChange: () => run() });
			el.append(
				h("div", { class: "lf-bar col" }, input, h("label", { class: "lf-check" }, arch, " 包含已归档")),
				out,
				treeHost,
			);
			async function run() {
				const q = input.value.trim();
				const my = ++seq;
				if (!q) return void ((out.textContent = ""), tree.setFilter(null));
				try {
					const r = await M.api("GET", "/left/search?q=" + encodeURIComponent(q) + "&mode=" + treeMode + "&archived=" + (arch.checked ? 1 : 0));
					if (my !== seq) return;
					out.textContent = "";
					if (r.branches && r.branches.length) {
						out.appendChild(h("div", { class: "lf-sec-h static" }, h("span", { class: "lf-sec-t" }, "分支"), h("span", { class: "lf-cnt" }, String(r.branches.length))));
						for (const b of r.branches)
							out.appendChild(
								h(
									"div",
									{
										class: "row lf-branch",
										onclick: () => {
											const ids = b.sessionIds || [];
											if (ids.length === 1) return M.nav.open("chat", { id: ids[0] });
											sheet(
												"⎇ " + b.branch,
												ids.map((id) => ({ label: sessionName(sessionById(id)) || id, run: () => M.nav.open("chat", { id }) })),
											);
										},
									},
									h("span", {}, "⎇"),
									h("div", { class: "main" }, h("div", { class: "name" }, b.branch), h("div", { class: "st" }, b.count + " 个会话")),
								),
							);
					}
					tree.setFilter(new Set((r.sessions || []).map((s) => s.id)));
				} catch (e) {
					if (my === seq) out.replaceChildren(h("div", { class: "empty" }, "搜索失败：" + e.message));
				}
			}
			const soon = () => {
				clearTimeout(timer);
				timer = setTimeout(run, 300);
			};
			input.addEventListener("input", soon);
			arch.addEventListener("change", run);
			this.cleanup = () => {
				clearTimeout(timer);
				tree.destroy();
			};
			input.focus();
		},
		unmount() {
			this.cleanup && this.cleanup();
		},
	});

	/* ---------------------------------------------------------------- schedules */

	const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
	const RUN_STATUS = { running: "运行中", ok: "成功", error: "失败", skipped: "跳过" };
	const LIFECYCLE = { active: "进行中", paused: "已暂停", completed: "已完成" };
	const pad = (n) => String(n).padStart(2, "0");
	const fmtTime = (iso) => {
		const d = new Date(iso);
		return isNaN(d) ? "" : `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	};
	const toLocalInput = (iso) => {
		const d = new Date(iso);
		return isNaN(d) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
	};
	function cadenceText(c) {
		if (!c) return "";
		switch (c.kind) {
			case "interval":
				return c.minutes % 60 === 0 ? `每 ${c.minutes / 60} 小时` : `每 ${c.minutes} 分钟`;
			case "daily": {
				const wd = c.weekdays || [];
				const ev = c.every || 1;
				if (wd.length) return `每${ev > 1 ? " " + ev + " " : ""}周 ${wd.map((d) => "周" + WEEK[d % 7]).join("、")} ${c.time}`;
				return (ev > 1 ? `每 ${ev} 天` : "每天") + " " + c.time;
			}
			case "once":
				return "一次 · " + fmtTime(c.at);
			case "monthly":
				return `每${c.every > 1 ? " " + c.every + " " : ""}月 ${c.day} 日 ${c.time}`;
		}
		return c.kind;
	}
	const schedDirty = () => M.emit("lf:schedules-dirty", null);

	M.registerPage("left:schedules", {
		title: "定时任务",
		mount(el) {
			el.classList.add("lf-page");
			let alive = true;
			const host = h("div", {});
			el.append(h("div", { class: "lf-bar" }, h("button", { class: "btn primary", onclick: () => M.nav.open("left:schedule-edit", {}) }, "＋ 新建定时任务")), host);
			async function toggle(s, sw) {
				sw.disabled = true;
				try {
					await M.api("POST", "/left/schedules/" + encodeURIComponent(s.id) + "/enabled", { enabled: !s.enabled });
				} catch (e) {
					M.toast("操作失败：" + e.message);
				}
				load();
			}
			async function runNow(s) {
				if (!(await M.confirm(`立即运行「${s.name}」一次？将创建新的会话执行该任务。`))) return;
				try {
					await M.api("POST", "/left/schedules/" + encodeURIComponent(s.id) + "/run");
					M.toast("已触发运行");
					load();
				} catch (e) {
					M.toast("运行失败：" + e.message);
				}
			}
			async function del(s) {
				if (!(await M.confirm(`删除定时任务「${s.name}」？此操作不可撤销。`))) return;
				try {
					await M.api("DELETE", "/left/schedules/" + encodeURIComponent(s.id));
					M.toast("已删除");
					load();
				} catch (e) {
					M.toast("删除失败：" + e.message);
				}
			}
			async function load() {
				try {
					const list = await M.api("GET", "/left/schedules");
					if (!alive) return;
					host.textContent = "";
					if (!list.length) return void host.appendChild(h("div", { class: "empty" }, "还没有定时任务"));
					for (const s of list) {
						const sw = h("button", {
							class: "lf-switch" + (s.enabled ? " on" : ""),
							role: "switch",
							"aria-checked": String(!!s.enabled),
							"aria-label": "启用 " + s.name,
							onclick: () => toggle(s, sw),
						});
						host.appendChild(
							h(
								"div",
								{ class: "card lf-sched", dataset: { id: s.id } },
								h("div", { class: "lf-sched-top" }, h("div", { class: "lf-sched-name" }, s.name), sw),
								h("div", { class: "detail" }, cadenceText(s.cadence)),
								h(
									"div",
									{ class: "lf-meta" },
									LIFECYCLE[s.lifecycle] || s.lifecycle,
									s.nextRunAt && s.enabled ? " · 下次 " + fmtTime(s.nextRunAt) : "",
									s.lastRunStatus ? " · 上次" + (RUN_STATUS[s.lastRunStatus] || s.lastRunStatus) : "",
									s.maxRuns ? ` · ${s.runsDone}/${s.maxRuns} 次` : "",
								),
								h("div", { class: "lf-meta" }, s.cwd),
								h(
									"div",
									{ class: "actions" },
									h("button", { class: "btn", onclick: () => M.nav.open("left:schedule-edit", { id: s.id }) }, "编辑"),
									h("button", { class: "btn", onclick: () => runNow(s) }, "立即运行"),
									h("button", { class: "btn", onclick: () => M.nav.open("left:schedule-runs", { id: s.id, name: s.name }) }, "历史"),
									h("button", { class: "btn danger", onclick: () => del(s) }, "删除"),
								),
							),
						);
					}
				} catch (e) {
					host.replaceChildren(h("div", { class: "empty" }, "加载失败：" + e.message));
				}
			}
			const soon = () => load();
			M.on("lf:schedules-dirty", soon);
			this.cleanup = () => {
				alive = false;
				M.off("lf:schedules-dirty", soon);
			};
			load();
		},
		unmount() {
			this.cleanup && this.cleanup();
		},
	});

	M.registerPage("left:schedule-runs", {
		title: (p) => (p && p.name ? p.name + " · 历史" : "运行历史"),
		async mount(el, p) {
			el.classList.add("lf-page");
			try {
				const runs = await M.api("GET", "/left/schedules/" + encodeURIComponent(p.id) + "/runs?limit=20");
				if (!runs.length) return void el.appendChild(h("div", { class: "empty" }, "暂无运行记录"));
				for (const r of runs)
					el.appendChild(
						h(
							"div",
							{ class: "row lf-run", onclick: r.sessionId ? () => M.nav.open("chat", { id: r.sessionId }) : null },
							h("span", { class: "lf-run-st " + r.status }, RUN_STATUS[r.status] || r.status),
							h(
								"div",
								{ class: "main" },
								h("div", { class: "t" }, h("span", { class: "name" }, fmtTime(r.startedAt)), h("span", { class: "time" }, r.finishedAt ? "耗时 " + Math.max(0, Math.round((Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000)) + "s" : "")),
								r.summary ? h("div", { class: "sub" }, r.summary) : null,
								r.sessionId ? h("div", { class: "st" }, "点击打开会话") : null,
							),
						),
					);
			} catch (e) {
				el.appendChild(h("div", { class: "empty" }, "加载失败：" + e.message));
			}
		},
	});

	M.registerPage("left:schedule-edit", {
		title: (p) => (p && p.id ? "编辑定时任务" : "新建定时任务"),
		async mount(el, p) {
			el.classList.add("lf-page");
			let dirs, existing = null;
			try {
				dirs = (await M.api("GET", "/left/dirs")).dirs;
				if (p.id) existing = (await M.api("GET", "/left/schedules")).find((s) => s.id === p.id);
				if (p.id && !existing) throw new Error("任务不存在");
			} catch (e) {
				return void el.appendChild(h("div", { class: "empty" }, "加载失败：" + e.message));
			}
			const s = existing;
			const c = (s && s.cadence) || { kind: "daily", time: "09:00" };
			const field = (label, ctl) => h("label", { class: "lf-field" }, h("span", { class: "lf-label" }, label), ctl);
			const select = (opts, val) => {
				const e = h("select", { class: "lf-input" }, opts.map(([v, l]) => h("option", { value: v }, l)));
				e.value = val;
				return e;
			};
			const name = h("input", { class: "lf-input", name: "name", value: s ? s.name : "", placeholder: "例如：每日晨报" });
			const prompt = h("textarea", { class: "lf-input", name: "prompt", rows: 4, placeholder: "定时发送给 agent 的提示词" });
			prompt.value = s ? s.prompt : "";
			const cwd = select(dirs.map((d) => [d.path, d.label || d.path]), (s && s.cwd) || (dirs[0] && dirs[0].path) || "");
			const runMode = select([["local", "在目录中直接运行"], ["worktree", "每次新建工作树"]], (s && s.runMode) || "local");
			const kind = select([["interval", "间隔"], ["daily", "每天 / 每周"], ["once", "仅一次"], ["monthly", "每月"]], c.kind);
			// cadence sub-fields
			const iv = c.kind === "interval" ? c.minutes : 60;
			const ivUnitHour = iv % 60 === 0;
			const ivNum = h("input", { class: "lf-input", name: "ivnum", type: "number", min: 1, value: ivUnitHour ? iv / 60 : iv });
			const ivUnit = select([["min", "分钟"], ["hour", "小时"]], ivUnitHour ? "hour" : "min");
			const time = h("input", { class: "lf-input", name: "time", type: "time", value: (c.time || "09:00") });
			const every = h("input", { class: "lf-input", name: "every", type: "number", min: 1, value: c.every || 1 });
			const days = new Set(c.kind === "daily" ? c.weekdays || [] : []);
			const chips = h("div", { class: "lf-chips" }, WEEK.map((w, i) => {
				const b = h("button", { type: "button", class: "lf-chip" + (days.has(i) ? " on" : ""), dataset: { d: i }, onclick: () => { days.has(i) ? days.delete(i) : days.add(i); b.classList.toggle("on"); } }, "周" + w);
				return b;
			}));
			const at = h("input", { class: "lf-input", name: "at", type: "datetime-local", value: c.kind === "once" ? toLocalInput(c.at) : "" });
			const mday = h("input", { class: "lf-input", name: "mday", type: "number", min: 1, max: 31, value: c.kind === "monthly" ? c.day : 1 });
			const endAt = h("input", { class: "lf-input", name: "endAt", type: "datetime-local", value: s && s.endAt ? toLocalInput(s.endAt) : "" });
			const maxRuns = h("input", { class: "lf-input", name: "maxRuns", type: "number", min: 1, value: s && s.maxRuns ? s.maxRuns : "", placeholder: "不限" });
			const notify = select([["all", "每次运行都通知"], ["important", "仅失败/需要回复"], ["none", "不通知"]], (s && s.notify) || "all");
			const fresh = h("input", { type: "checkbox", name: "fresh" });
			fresh.checked = s ? s.newChatEachRun !== false : true;
			const enabled = h("input", { type: "checkbox", name: "enabled" });
			enabled.checked = s ? !!s.enabled : true;
			const groups = {
				interval: [field("间隔", h("div", { class: "lf-inline" }, ivNum, ivUnit))],
				daily: [field("时间", time), field("每隔 N 天/周", every), field("星期（不选 = 按天）", chips)],
				once: [field("运行时间", at)],
				monthly: [field("每月几号", mday), field("时间", time.cloneNode(true)), field("每隔 N 月", every.cloneNode(true))],
			};
			// monthly clones need their own handles
			const mTime = groups.monthly[1].querySelector("input");
			const mEvery = groups.monthly[2].querySelector("input");
			const cadBox = h("div", {});
			const showKind = () => cadBox.replaceChildren(...groups[kind.value]);
			kind.addEventListener("change", showKind);
			showKind();
			const err = h("div", { class: "lf-err" });
			function build() {
				if (!name.value.trim()) throw new Error("请填写名称");
				if (!prompt.value.trim()) throw new Error("请填写提示词");
				if (!cwd.value) throw new Error("请选择工作目录");
				let cadence;
				const k = kind.value;
				if (k === "interval") {
					const n = Math.round(Number(ivNum.value));
					if (!(n >= 1)) throw new Error("间隔至少为 1");
					cadence = { kind: k, minutes: ivUnit.value === "hour" ? n * 60 : n };
				} else if (k === "daily") {
					if (!time.value) throw new Error("请选择时间");
					cadence = { kind: k, time: time.value, every: Math.max(1, Math.round(Number(every.value) || 1)) };
					if (days.size) cadence.weekdays = [...days].sort((a, b) => a - b);
					if (c.kind === "daily" && c.anchor) cadence.anchor = c.anchor;
				} else if (k === "once") {
					if (!at.value) throw new Error("请选择运行时间");
					cadence = { kind: k, at: new Date(at.value).toISOString() };
				} else {
					const d = Math.round(Number(mday.value));
					if (!(d >= 1 && d <= 31)) throw new Error("日期需在 1-31 之间");
					if (!mTime.value) throw new Error("请选择时间");
					cadence = { kind: k, day: d, time: mTime.value, every: Math.max(1, Math.round(Number(mEvery.value) || 1)) };
					if (c.kind === "monthly" && c.anchor) cadence.anchor = c.anchor;
				}
				const draft = {
					name: name.value.trim(),
					prompt: prompt.value.trim(),
					cwd: cwd.value,
					runMode: runMode.value,
					cadence,
					model: s ? s.model : null,
					thinking: s ? s.thinking : null,
					approvalMode: s ? s.approvalMode : null,
					enabled: enabled.checked,
					notify: notify.value,
					newChatEachRun: fresh.checked,
					endAt: k !== "once" && endAt.value ? new Date(endAt.value).toISOString() : null,
					maxRuns: k !== "once" && maxRuns.value ? Math.max(1, Math.round(Number(maxRuns.value))) : null,
				};
				if (s) draft.id = s.id;
				return draft;
			}
			const save = h("button", { class: "btn primary", id: "sched-save" }, "保存");
			save.onclick = async () => {
				err.textContent = "";
				let draft;
				try {
					draft = build();
				} catch (e) {
					err.textContent = e.message;
					return;
				}
				save.disabled = true;
				try {
					if (s) await M.api("PUT", "/left/schedules/" + encodeURIComponent(s.id), draft);
					else await M.api("POST", "/left/schedules", draft);
					M.toast("已保存");
					schedDirty();
					M.nav.back();
				} catch (e) {
					err.textContent = "保存失败：" + e.message;
					save.disabled = false;
				}
			};
			el.append(
				h(
					"div",
					{ class: "lf-form" },
					field("名称", name),
					field("提示词", prompt),
					field("工作目录", cwd),
					field("运行方式", runMode),
					field("重复", kind),
					cadBox,
					field("结束时间（可选，仅重复任务）", endAt),
					field("最多运行次数（可选）", maxRuns),
					field("通知", notify),
					h("label", { class: "lf-check" }, fresh, " 每次运行新建会话"),
					h("label", { class: "lf-check" }, enabled, " 启用"),
					err,
					h("div", { class: "lf-bar" }, save),
				),
			);
		},
	});

	/* ---------------------------------------------------------------- skills */

	function reasonText(r) {
		if (!r) return "";
		switch (r.kind) {
			case "all_off":
				return "Skills 总开关已关闭";
			case "disabled":
				return "已手动禁用";
			case "source":
				return "来源已关闭" + (r.key ? "（" + r.key + "）" : "");
			case "ignored":
				return "被忽略规则匹配" + (r.pattern ? "（" + r.pattern + "）" : "");
			case "not_included":
				return "不在包含列表中";
		}
		return r.kind;
	}
	M.registerPage("left:skills", {
		title: "Skills",
		mount(el) {
			el.classList.add("lf-page");
			let alive = true;
			const host = h("div", {});
			el.appendChild(host);
			async function toggle(url, body, sw) {
				sw.disabled = true;
				try {
					await M.api("POST", url, body);
					M.toast("已更新（对新会话生效）");
				} catch (e) {
					M.toast("操作失败：" + e.message);
				}
				load();
			}
			async function load() {
				try {
					const d = await M.api("GET", "/left/skills");
					if (!alive) return;
					host.textContent = "";
					if (d.configError) host.appendChild(h("div", { class: "lf-err" }, "配置读取异常：" + d.configError));
					if (d.skillsEnabled === false) host.appendChild(h("div", { class: "lf-meta pad" }, "Skills 总开关已关闭"));
					host.appendChild(h("div", { class: "lf-sec-h static" }, h("span", { class: "lf-sec-t" }, "Skills"), h("span", { class: "lf-cnt" }, String(d.skills.length))));
					if (!d.skills.length) host.appendChild(h("div", { class: "empty" }, "没有 Skill"));
					for (const k of d.skills) {
						const sw = h("button", {
							class: "lf-switch" + (k.enabled ? " on" : ""),
							role: "switch",
							"aria-checked": String(!!k.enabled),
							"aria-label": "启用 " + k.name,
							onclick: () => toggle("/left/skills/toggle", { name: k.name, enabled: !k.enabled }, sw),
						});
						host.appendChild(
							h(
								"div",
								{ class: "row lf-skill", dataset: { name: k.name } },
								h(
									"div",
									{ class: "main" },
									h("div", { class: "t" }, h("span", { class: "name" }, k.name), h("span", { class: "time" }, k.provider || "")),
									k.description ? h("div", { class: "sub" }, k.description) : null,
									!k.enabled && k.disabledReason ? h("div", { class: "st", style: { color: "var(--warn)" } }, "已停用：" + reasonText(k.disabledReason)) : null,
									k.issues && k.issues.length ? h("div", { class: "st", style: { color: "var(--err)" } }, "问题：" + k.issues.join("、")) : null,
								),
								sw,
							),
						);
					}
					host.appendChild(h("div", { class: "lf-sec-h static" }, h("span", { class: "lf-sec-t" }, "扩展"), h("span", { class: "lf-cnt" }, String(d.extensions.length))));
					if (!d.extensions.length) host.appendChild(h("div", { class: "empty" }, "没有扩展"));
					for (const x of d.extensions) {
						const sw = h("button", {
							class: "lf-switch" + (x.enabled ? " on" : ""),
							role: "switch",
							"aria-checked": String(!!x.enabled),
							"aria-label": "启用 " + x.name,
							onclick: () => toggle("/left/extensions/toggle", { path: x.path, enabled: !x.enabled }, sw),
						});
						host.appendChild(
							h("div", { class: "row lf-ext", dataset: { name: x.name } }, h("div", { class: "main" }, h("div", { class: "name" }, x.name), h("div", { class: "st" }, x.source)), sw),
						);
					}
				} catch (e) {
					host.replaceChildren(h("div", { class: "empty" }, "加载失败：" + e.message));
				}
			}
			this.cleanup = () => (alive = false);
			load();
		},
		unmount() {
			this.cleanup && this.cleanup();
		},
	});

	/* ---------------------------------------------------------------- settings (read-only) */

	M.registerPage("left:settings", {
		title: "设置",
		async mount(el) {
			el.classList.add("lf-page");
			try {
				const d = await M.api("GET", "/left/settings");
				const m = d.mobile || {};
				const kv = (k, v) => h("div", { class: "row lf-kv" }, h("span", { class: "lf-k" }, k), h("span", { class: "lf-v" }, v == null || v === "" ? "—" : String(v)));
				el.append(...[
					kv("应用版本", d.appVersion),
					kv("默认模型", d.defaultModel),
					d.defaultModelSource ? kv("模型来源", d.defaultModelSource) : null,
					h("div", { class: "lf-sec-h static" }, h("span", { class: "lf-sec-t" }, "手机远程服务")),
					kv("状态", m.running ? "运行中" : "未运行"),
					kv("端口", m.port),
					kv("局域网地址", m.lanUrl),
					m.tunnelUrl ? kv("隧道地址", m.tunnelUrl) : null,
					m.ipv6Running ? kv("IPv6 地址", m.ipv6Url) : null,
					h("div", { class: "lf-meta pad" }, "移动端设置为只读，请在电脑上修改。"),
				].filter(Boolean));
			} catch (e) {
				el.appendChild(h("div", { class: "empty" }, "加载失败：" + e.message));
			}
		},
	});

	/* ---------------------------------------------------------------- home */
	let root = null;
	const $ = (id) => root.querySelector("#" + id);
	let todos = [];
	let lastOpenCount = -1;

	let tree = null;
	function renderTodos() {
		const pane = $("pane-todos");
		pane.innerHTML = "";
		const open = todos.filter((t) => t.status === "open");
		$("todo-badge").textContent = open.length;
		$("todo-badge").classList.toggle("hidden", open.length === 0);
		if (open.length === 0) {
			pane.innerHTML = '<div class="empty">没有待办事项</div>';
			return;
		}
		for (const t of open) {
			const card = document.createElement("div");
			card.className = "card";
			const s = t.sessionId ? sessionById(t.sessionId) : null;
			card.innerHTML =
				'<div class="top"><span class="kind ' + esc(t.kind) + '">' + esc(KIND_LABEL[t.kind] || t.kind) + "</span>" +
				(s ? '<span class="meta">' + esc(sessionName(s)) + "</span>" : "") +
				'</div><div class="title">' + esc(t.title) + "</div>" +
				(t.detail ? '<div class="detail">' + esc(t.detail) + "</div>" : "");
			const actions = document.createElement("div");
			actions.className = "actions";
			const uiReq = t.payload && t.payload.uiRequest;
			if (t.sessionId && uiReq && uiReq.id) {
				const opts = reqOptions(uiReq) || [
					{ id: "Approve", label: "批准" },
					{ id: "Deny", label: "拒绝" },
				];
				for (const o of opts) {
					const b = document.createElement("button");
					b.className = "btn" + (/approve|批准|允许/i.test(o.id + o.label) ? " primary" : "");
					b.textContent = o.label;
					b.onclick = () => M.chat.respond(t.sessionId, { id: uiReq.id, type: "extension_ui_response", value: o.id }, b);
					actions.appendChild(b);
				}
			} else {
				const done = document.createElement("button");
				done.className = "btn primary";
				done.textContent = "完成";
				done.onclick = () => act(t.id, "done", done);
				actions.appendChild(done);
			}
			if (t.sessionId) {
				const go = document.createElement("button");
				go.className = "btn";
				go.textContent = "打开会话";
				go.onclick = () => M.nav.open("chat", { id: t.sessionId });
				actions.appendChild(go);
			}
			const ign = document.createElement("button");
			ign.className = "btn danger";
			ign.textContent = "忽略";
			ign.onclick = () => act(t.id, "ignore", ign);
			actions.appendChild(ign);
			card.appendChild(actions);
			pane.appendChild(card);
		}
	}

	async function act(id, action, btn) {
		if (btn) btn.disabled = true;
		try {
			await M.api("POST", "/todos/" + encodeURIComponent(id) + "/act", { action });
			await loadTodos();
		} catch (e) {
			M.toast("操作失败：" + e.message);
			if (btn) btn.disabled = false;
		}
	}

	async function loadTodos() {
		todos = await M.api("GET", "/todos");
		if (root) renderTodos();
		notifyNewTodos();
	}

	function notifyNewTodos() {
		const open = todos.filter((t) => t.status === "open").length;
		if (lastOpenCount >= 0 && open > lastOpenCount) {
			if (navigator.vibrate) navigator.vibrate(200);
			if (window.Notification && Notification.permission === "granted") {
				const newest = todos.find((t) => t.status === "open");
				new Notification("新的待办", { body: newest ? newest.title : "" });
			}
		}
		lastOpenCount = open;
	}

	function showTab(name) {
		$("tab-sessions").classList.toggle("active", name === "sessions");
		$("tab-todos").classList.toggle("active", name === "todos");
		$("pane-sessions").classList.toggle("hidden", name !== "sessions");
		$("pane-todos").classList.toggle("hidden", name !== "todos");
	}

	const TEMPLATE = `
		<div class="topbar">
			<button id="menu" class="iconbtn" aria-label="菜单">☰</button>
			<span id="dot" class="dot"></span>
			<h1>omp-workspace</h1>
			<span id="conn"></span>
			<button id="notify-btn" class="iconbtn hidden" aria-label="开启通知" style="font-size: 18px">🔔</button>
		</div>
		<div class="seg">
			<button id="tab-sessions" class="active">会话</button>
			<button id="tab-todos">待办<span id="todo-badge" class="badge hidden"></span></button>
		</div>
		<div class="scroll" id="home-scroll">
			<div id="pane-sessions" class="list"></div>
			<div id="pane-todos" class="list hidden"></div>
		</div>`;

	const setConn = (on) => {
		if (!root) return;
		$("dot").className = "dot " + (on ? "on" : "off");
		$("conn").textContent = on ? "已连接" : "重连中…";
	};
	const bus = {
		conn: setConn,
		"sse:todos": () => loadTodos().catch(() => {}),
		"sse:resync": () => loadTodos().catch(() => {}),
		visible: () => loadTodos().catch(() => {}),
		poll: () => loadTodos().catch(() => {}),
	};

	function mount(el) {
		root = el;
		el.innerHTML = TEMPLATE;
		$("menu").onclick = () => M.drawer.open("left");
		$("tab-sessions").onclick = () => showTab("sessions");
		$("tab-todos").onclick = () => showTab("todos");
		if (window.Notification && Notification.permission === "default") {
			$("notify-btn").classList.remove("hidden");
			$("notify-btn").onclick = () =>
				Notification.requestPermission().then(() => $("notify-btn").classList.add("hidden"));
		}
		for (const [evt, fn] of Object.entries(bus)) M.on(evt, fn);
		if (M.state.connected !== undefined) setConn(M.state.connected);
		const pane = $("pane-sessions");
		pane.appendChild(h("div", { class: "lf-bar" }, h("button", { class: "btn primary", onclick: pickDirAndCreate }, "＋ 新建会话")));
		const host = h("div", {});
		pane.appendChild(host);
		tree = createTree(host);
		renderTodos();
		loadTodos().catch(() => {});
	}

	function unmount() {
		for (const [evt, fn] of Object.entries(bus)) M.off(evt, fn);
		if (tree) tree.destroy();
		tree = null;
		root = null;
	}

	M.registerPage("home", { title: "omp-workspace", bare: true, mount, unmount });
})();