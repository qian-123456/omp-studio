"use strict";
/* Chat screen: transcript render, live RPC stream, pending UI, composer, resume.
   Registers page 'chat' (params { id }). */
(function () {
	const { esc, sessionById, sessionName, STATUS_LABEL } = M.util;
	const DEAD = ["interrupted", "suspended", "error"];

	let root = null; // page element while mounted
	const $ = (id) => root.querySelector("#" + id);

	let cur = null; // session id
	let items = []; // normalized transcript items
	let offset = 0;
	let optimistic = []; // {text}
	let streamMsg = null; // in-flight assistant message snapshot
	let liveTools = {}; // toolCallId -> {name,args,done,isError}
	let working = false;
	let fetching = false;
	let fetchAgain = false;
	let fetchTimer = null;
	let nearBottom = true; // last known "following the tail" state, immune to keyboard resizes
	let lastCH = 0; // scroller clientHeight at the last scroll sample

	// ---------- markdown (small, escape-first) ----------

	function inline(src) {
		const codes = [];
		let t = src.replace(/`([^`\n]+)`/g, (_, c) => {
			codes.push(c);
			return "\u0000" + (codes.length - 1) + "\u0000";
		});
		t = esc(t);
		t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
		t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
		t = t.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
		t = t.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
		return t.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + esc(codes[+i]) + "</code>");
	}

	function md(src) {
		const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
		const out = [];
		let i = 0;
		const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || "");
		const cells = (l) =>
			l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
		while (i < lines.length) {
			const line = lines[i];
			let m;
			if ((m = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/))) {
				const fence = m[1];
				const buf = [];
				i++;
				while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
				i++;
				out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>");
			} else if (/^\s*$/.test(line)) {
				i++;
			} else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
				const n = Math.min(m[1].length, 4);
				out.push("<h" + n + ">" + inline(m[2]) + "</h" + n + ">");
				i++;
			} else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
				out.push("<hr>");
				i++;
			} else if (line.includes("|") && isTableSep(lines[i + 1])) {
				const head = cells(line);
				i += 2;
				const rows = [];
				while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i]))
					rows.push(cells(lines[i++]));
				out.push(
					"<table><thead><tr>" +
						head.map((c) => "<th>" + inline(c) + "</th>").join("") +
						"</tr></thead><tbody>" +
						rows
							.map((r) => "<tr>" + r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>")
							.join("") +
						"</tbody></table>",
				);
			} else if (/^\s*>/.test(line)) {
				const buf = [];
				while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
				out.push("<blockquote>" + md(buf.join("\n")) + "</blockquote>");
			} else if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
				const ordered = /^\s*\d+[.)]/.test(line);
				const buf = [];
				while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
					buf.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
				}
				const tag = ordered ? "ol" : "ul";
				out.push("<" + tag + ">" + buf.map((b) => "<li>" + inline(b) + "</li>").join("") + "</" + tag + ">");
			} else {
				// First line always consumed: an indented "  # x" matches the stop regex but no block
				// branch, which would otherwise loop forever and freeze the page.
				const buf = [lines[i++]];
				while (
					i < lines.length &&
					!/^\s*$/.test(lines[i]) &&
					!/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i])
				)
					buf.push(lines[i++]);
				out.push("<p>" + buf.map(inline).join("<br>") + "</p>");
			}
		}
		return out.join("");
	}

	// ---------- tool helpers ----------

	function argSummary(name, args) {
		if (args == null) return "";
		if (typeof args === "string") return args.replace(/\s+/g, " ").slice(0, 120);
		const k = ["command", "path", "file_path", "pattern", "query", "url", "intent", "description", "prompt"];
		for (const key of k) if (typeof args[key] === "string") return args[key].replace(/\s+/g, " ").slice(0, 120);
		try {
			return JSON.stringify(args).slice(0, 120);
		} catch {
			return "";
		}
	}

	function pretty(v) {
		if (typeof v === "string") return v;
		try {
			return JSON.stringify(v, null, 2);
		} catch {
			return String(v);
		}
	}

	function toolHtml(name, args, state, resultText, isErr, key, open) {
		const st =
			state === "run"
				? '<span class="tool-st run">运行中</span>'
				: state === "bad"
					? '<span class="tool-st bad">失败</span>'
					: state === "ok"
						? '<span class="tool-st ok">✓</span>'
						: "";
		const a = pretty(args);
		return (
			'<details class="fold"' + (key ? ' data-k="' + key + '"' : "") + (open ? " open" : "") + '><summary><span class="chev">▶</span><span class="nm">' +
			esc(name) +
			'</span><span class="arg">' +
			esc(argSummary(name, args)) +
			"</span>" +
			st +
			'</summary><div class="body"><div class="lbl">参数</div><pre class="raw">' +
			esc(a.length > 4000 ? a.slice(0, 4000) + "…" : a) +
			"</pre>" +
			(resultText != null
				? '<div class="lbl">结果</div><pre class="raw' + (isErr ? " err" : "") + '">' + esc(resultText || "(无输出)") + "</pre>"
				: "") +
			"</div></details>"
		);
	}

	// ---------- request stats (TUI-style line + tap card) ----------

	const R = M.requestStats; // vanilla port of src/features/chat/requestStats.ts
	const statByItem = new Map(); // assistant item id -> stat (rebuilt every render)
	let statCardId = null; // item id whose card is open

	function statLineHtml(id, stat) {
		statByItem.set(id, stat);
		const parts = R.formatRequestStat(stat)
			.map((p) => '<span class="stat-f' + (p.field === "time" ? " t" : "") + '"><i>' + esc(p.glyph) + "</i>" + esc(p.text) + "</span>")
			.join("");
		return (
			'<button class="stat' + (statCardId === id ? " on" : "") + '" data-stat="' + esc(id) + '" aria-label="请求详情">' +
			parts +
			"</button>"
		);
	}

	function statBarHtml(stat) {
		const dur = stat.durationMs;
		const ttft = stat.ttftMs;
		if (!(dur > 0) || ttft == null) return "";
		const w = Math.min(98, Math.max(2, (ttft / dur) * 100));
		return (
			'<div class="st-bar" aria-hidden="true"><i class="a" style="width:' + w.toFixed(1) + '%"></i><i class="b"></i></div>' +
			'<div class="st-leg"><span><i class="sw a"></i>等第一个字 ' + esc(R.formatStatSeconds(ttft)) + "</span><span><i class=\"sw b\"></i>生成 " +
			esc(R.formatStatSeconds(Math.max(0, dur - ttft))) +
			"</span></div>"
		);
	}

	function statCardHtml(stat) {
		// Same anchor as the desktop card: the request's start time.
		const at = stat.startedAt ?? stat.completedAt;
		const when =
			at == null ? "时间未知" : R.isToday(at) ? "今天 " + R.formatStatClock(at) : R.formatStatDateTime(at);
		const rows = R.FIELD_IDS.map((f) => {
			const m = R.FIELDS[f];
			return (
				'<div class="st-row"><span class="st-g">' + esc(m.glyph || "·") + '</span><div class="st-mid"><span class="st-n">' +
				esc(m.label) +
				'</span><span class="st-d">' +
				esc(m.description) +
				'</span></div><span class="st-v">' +
				esc(R.fieldText(stat, f) ?? R.MISSING) +
				"</span></div>"
			);
		}).join("");
		return (
			'<div class="st-scrim" data-stclose="1"></div><div class="st-card" role="dialog" aria-label="请求详情">' +
			'<div class="st-hd"><span class="st-t">这次请求</span><button class="st-x" data-stclose="1" aria-label="关闭">✕</button></div>' +
			'<div class="st-when">' +
			esc(when) +
			"</div>" +
			rows +
			statBarHtml(stat) +
			"</div>"
		);
	}

	function openStatCard(id) {
		const stat = statByItem.get(id);
		const ov = $("st-ov");
		if (!stat || !ov) return;
		statCardId = id;
		ov.innerHTML = statCardHtml(stat);
		ov.classList.remove("hidden");
		for (const b of ov.querySelectorAll(".st-x")) b.addEventListener("click", closeStatCard);
	}

	function closeStatCard() {
		statCardId = null;
		const ov = root && $("st-ov");
		if (ov) {
			ov.classList.add("hidden");
			ov.innerHTML = "";
		}
		if (root) for (const l of root.querySelectorAll(".stat.on")) l.classList.remove("on");
	}

	function toggleStatCard(id) {
		if (statCardId === id) closeStatCard();
		else openStatCard(id);
	}

	// ---------- thinking preview ----------

	const pvOpen = new Set(); // step keys whose preview is expanded
	const LIVE_TAIL_CHARS = 160;

	/** Collapsed preview while thinking still streams: the newest two lines. */
	function liveTail(text) {
		const lines = String(text || "")
			.replace(/\r\n?/g, "\n")
			.replace(/\s+$/, "")
			.split("\n")
			.filter((l) => l.trim() !== "");
		if (!lines.length) return "";
		const tail = lines.slice(-2).join("\n");
		if (tail.length <= LIVE_TAIL_CHARS) return tail;
		const last = lines[lines.length - 1];
		if (last.length <= LIVE_TAIL_CHARS) return last;
		return "…" + last.slice(last.length - LIVE_TAIL_CHARS);
	}

	function previewHtml(s) {
		const on = pvOpen.has(s.key);
		const text = s.live ? liveTail(s.text) : s.text;
		if (!text || !text.trim()) return "";
		return (
			'<div class="pv' +
			(on ? " on" : "") +
			(s.live ? " live" : "") +
			'" data-pv="' +
			esc(s.key) +
			'" role="button" tabindex="0" aria-expanded="' +
			(on ? "true" : "false") +
			'" aria-label="查看完整思考内容"><span class="pv-t">' +
			esc(text) +
			"</span></div>"
		);
	}

	function togglePreview(key, on) {
		if (on) pvOpen.add(key);
		else pvOpen.delete(key);
		for (const el of root.querySelectorAll('.pv[data-pv="' + CSS.escape(key) + '"]')) {
			el.classList.toggle("on", on);
			el.setAttribute("aria-expanded", on ? "true" : "false");
			// Follow the newest words while reasoning streams, like subtitles.
			if (el.classList.contains("live")) el.scrollTop = el.scrollHeight;
		}
	}

	// ---------- turn grouping (mirrors desktop turnGrouping.ts, lite) ----------

	const foldOverride = new Map(); // turn id -> user-chosen open state
	const toolOpen = new Set(); // data-k keys of open tool/thinking cards
	const turnStart = new Map(); // turn id -> first-seen ms (fallback when no ts)
	let localOut = []; // app-local slash outputs {text,name}
	let tickTimer = null;

	const PROTOCOL = ["compaction", "branch_summary", "model_change", "custom", "system", "thinking_level_change"];

	function fmtDur(ms) {
		if (!(ms > 0)) return "0秒";
		const s = Math.round(ms / 1000);
		if (s < 60) return Math.max(1, s) + "秒";
		const m = Math.floor(s / 60);
		if (m < 60) return s % 60 ? m + "分" + (s % 60) + "秒" : m + "分";
		const h = Math.floor(m / 60);
		return m % 60 ? h + "小时" + (m % 60) + "分" : h + "小时";
	}

	function noticeText(it) {
		switch (it.kind) {
			case "compaction":
				return "上下文已压缩";
			case "branch_summary":
				return "分支摘要";
			case "model_change":
				return "模型切换" + (it.model ? "：" + shortModel(it.model) : "");
			case "thinking_level_change":
				return "思考等级 → " + (it.text || "?");
			default:
				return (it.text || "").replace(/^<system-(?:notice|reminder)>|<\/system-(?:notice|reminder)>$/g, "").trim().slice(0, 200);
		}
	}

	function newTurn(user, ts, id) {
		return { type: "turn", id, user, asst: [], steps: [], answer: null, start: Date.parse(ts) || 0, end: Date.parse(ts) || 0, running: false };
	}

	function finalizeTurn(t, results) {
		const last = t.asst.length ? t.asst[t.asst.length - 1] : null;
		for (const it of t.asst) {
			const isAnswer = it === last && it.text && it.text.trim();
			if (isAnswer) t.answer = it;
			if (it.thinking) t.steps.push({ kind: "thinking", key: "th-" + it.id, text: it.thinking });
			if (it.text && it.text.trim() && !isAnswer) t.steps.push({ kind: "text", key: "tx-" + it.id, text: it.text });
			for (const c of it.toolCalls || []) {
				const r = results[c.id];
				const lt = liveTools[c.id];
				t.steps.push({
					kind: "tool",
					key: "tc-" + c.id,
					name: c.name,
					args: c.args,
					state: r ? (r.isError ? "bad" : "ok") : lt ? (lt.done ? (lt.isError ? "bad" : "ok") : "run") : "",
					text: r ? r.text : lt && lt.done ? lt.text || "" : null,
					err: r ? r.isError : lt && lt.isError,
				});
			}
			// One stats line per model request. The answer request keeps it out of the
			// fold: it renders between the answer text and the footer, always visible.
			const stat = R.requestStatFromItem(it);
			if (stat && isAnswer) t.answerStat = { itemId: it.id, stat };
			else if (stat) t.steps.push({ kind: "stat", key: "st-" + it.id, itemId: it.id, stat });
		}
		t.asst = [];
		return t;
	}

	function buildBlocks(results) {
		const blocks = [];
		let t = null;
		const fin = () => {
			if (t) blocks.push(finalizeTurn(t, results));
			t = null;
		};
		const activityAfter = (i) => {
			for (let j = i + 1; j < items.length; j++) {
				const n = items[j];
				if (n.hidden) continue;
				if (n.kind === "user") return false;
				if (n.kind === "assistant" || n.kind === "tool_result") return true;
			}
			return false;
		};
		for (let i = 0; i < items.length; i++) {
			const it = items[i];
			if (it.hidden) continue;
			const ts = Date.parse(it.ts) || 0;
			if (it.kind === "user") {
				fin();
				t = newTurn(it, it.ts, "turn-" + it.id);
			} else if (it.kind === "assistant") {
				if (!t) t = newTurn(null, it.ts, "turn-" + it.id);
				t.asst.push(it);
				if (ts) t.end = ts;
			} else if (it.kind === "bash") {
				if (!t) t = newTurn(null, it.ts, "turn-" + it.id);
				t.steps.push({ kind: "tool", key: "bash-" + it.id, name: "bash", args: it.text || "", state: "ok", text: null });
			} else if (it.kind === "tool_result") {
				if (t && ts) t.end = ts;
			} else if (PROTOCOL.includes(it.kind)) {
				const txt = noticeText(it);
				if (t && activityAfter(i)) t.steps.push({ kind: "notice", key: "nt-" + it.id, text: txt });
				else {
					fin();
					if (txt) blocks.push({ type: "notice", text: txt });
				}
			}
		}
		fin();
		return blocks;
	}

	function stepHtml(s) {
		const open = toolOpen.has(s.key);
		switch (s.kind) {
			case "thinking":
				// Always-visible label + 2-line preview (tap the preview to expand),
				// matching the desktop 「思考了 N 秒」 row; no collapsed fold to open first.
				return (
					'<div class="think-pv" data-k="' + s.key + '"><div class="nm">' + (s.live ? "思考中…" : "思考过程") +
					"</div>" +
					previewHtml(s) +
					"</div>"
				);
			case "text":
				return '<div class="md">' + md(s.text) + "</div>";
			case "stat":
				return statLineHtml(s.itemId, s.stat);
			case "notice":
				return '<div class="notice">' + esc(s.text) + "</div>";
			default:
				return toolHtml(s.name, s.args, s.state, s.text, s.err, s.key, open);
		}
	}

	function foldOpen(t) {
		return foldOverride.has(t.id) ? foldOverride.get(t.id) : t.running || M.prefs.get("foldOpen");
	}

	function foldLabel(t) {
		if (t.running) return "正在处理 " + fmtDur(Date.now() - (t.start || turnStart.get(t.id) || Date.now())) + "…";
		const d = t.end > t.start && t.start ? " · " + fmtDur(t.end - t.start) : "";
		return "已处理 " + t.steps.filter((s) => s.kind !== "stat").length + " 个步骤" + d;
	}

	function turnHtml(t) {
		let h = "";
		if (t.user) {
			const imgs = (t.user.images || []).length ? '<div class="imgs">[' + t.user.images.length + " 张图片]</div>" : "";
			if (t.user.text || imgs) h += '<div class="msg-user' + (t.user.pending ? " pending" : "") + '">' + esc(t.user.text || "") + imgs + "</div>";
		}
		let a = "";
		if (t.steps.length) {
			const open = foldOpen(t);
			a +=
				'<div class="tfold' + (open ? " open" : "") + (t.running ? " run" : "") + '" data-tf="' + t.id + '">' +
				'<button class="tfold-h" data-fold="' + t.id + '"' +
				(t.running ? ' data-start="' + (t.start || turnStart.get(t.id) || Date.now()) + '"' : "") +
				'><span class="chev">▶</span><span class="lbl">' + esc(foldLabel(t)) +
				'</span></button><div class="tfold-b">' + t.steps.map(stepHtml).join("") + "</div></div>";
		}
		if (t.answer && t.answer.text) a += '<div class="md">' + md(t.answer.text) + "</div>";
		else if (t.liveText) a += '<div class="md">' + md(t.liveText) + "</div>";
		// The answer request's stats line always shows, under the answer text.
		if (t.answerStat) a += statLineHtml(t.answerStat.itemId, t.answerStat.stat);
		if (t.running && !t.steps.length && !t.answer && !t.liveText) a += '<div class="typing"><i></i><i></i><i></i></div>';
		if (a) h += '<div class="msg-asst">' + a + "</div>";
		return h;
	}

	let lastHtml = "";

	function renderMessages() {
		const box = $("msgs");
		const results = {};
		statByItem.clear(); // rebuilt below; the open card reads it by item id
		for (const it of items) if (it.toolResult) results[it.toolResult.toolCallId] = it.toolResult;
		const blocks = buildBlocks(results);
		for (const o of optimistic) {
			const id = "turn-opt-" + o.text.length + "-" + optimistic.indexOf(o);
			blocks.push(newTurn({ text: o.text, pending: true }, "", id));
		}

		// Live tail merges into the last turn so one running turn = one fold.
		if (working || streamMsg || Object.keys(liveTools).length) {
			let t = blocks[blocks.length - 1];
			if (!t || t.type !== "turn") {
				t = newTurn(null, "", "turn-live");
				blocks.push(t);
			}
			const seen = new Set();
			for (const s of t.steps) if (s.kind === "tool") seen.add(s.key.slice(3));
			for (const id of Object.keys(liveTools)) {
				if (results[id] || seen.has(id)) continue;
				const lt = liveTools[id];
				t.steps.push({ kind: "tool", key: "tc-" + id, name: lt.name, args: lt.args, state: lt.done ? (lt.isError ? "bad" : "ok") : "run", text: lt.done ? lt.text || "" : null, err: lt.isError });
				seen.add(id);
			}
			if (streamMsg) {
				const content = Array.isArray(streamMsg.content) ? streamMsg.content : [];
				let think = "";
				let text = "";
				for (const p of content) {
					if (!p) continue;
					if (p.type === "text" && typeof p.text === "string") text += p.text;
					else if ((p.type === "thinking" || p.type === "thought") && typeof (p.thinking ?? p.text) === "string") think += p.thinking ?? p.text;
					else if (p.type === "toolCall" && p.id && !results[p.id] && !seen.has(p.id)) {
						t.steps.push({ kind: "tool", key: "tc-" + p.id, name: p.name, args: p.arguments, state: "run", text: null });
						seen.add(p.id);
					}
				}
				if (think) t.steps.push({ kind: "thinking", key: "th-live", text: think, live: !text });
				if (text) {
					if (t.answer) {
						t.steps.push({ kind: "text", key: "tx-" + t.answer.id, text: t.answer.text });
						t.answer = null;
					}
					t.liveText = text;
				}
			}
			t.running = true;
		}

		const parts = [];
		for (const b of blocks) {
			if (b.type === "notice") parts.push('<div class="notice">' + esc(b.text) + "</div>");
			else {
				if (b.running && !turnStart.has(b.id)) turnStart.set(b.id, Date.now());
				parts.push(turnHtml(b));
			}
		}
		for (const o of localOut)
			parts.push('<div class="msg-asst ch-local"><div class="ch-lbl">/' + esc(o.name) + ' · 仅本地显示</div><pre>' + esc(o.text) + "</pre></div>");
		if (parts.length === 0) parts.push('<div class="empty">还没有消息，发一条开始吧</div>');

		const sc = $("chat-scroll");
		const html = parts.join("");
		// Identical markup (SSE ticks, polls): leave the DOM alone so a finger/momentum
		// scroll is not interrupted by a pointless innerHTML swap.
		if (html === lastHtml) return;
		lastHtml = html;
		const stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
		const prevTop = sc.scrollTop;
		box.innerHTML = html;
		sc.scrollTop = stick ? sc.scrollHeight : prevTop;
		nearBottom = stick;
		$("jump").classList.toggle("hidden", stick);
		// Re-renders wipe the card; keep it open for the same request while its data survives.
		if (statCardId && statByItem.has(statCardId) && !$("st-ov").classList.contains("hidden")) openStatCard(statCardId);
	}

	function tick() {
		if (!root) return;
		root.querySelectorAll(".tfold.run .tfold-h").forEach((h) => {
			const s = +h.dataset.start;
			if (s) h.querySelector(".lbl").textContent = "正在处理 " + fmtDur(Date.now() - s) + "…";
		});
	}

	function renderChatHeader() {
		const s = sessionById(cur);
		const st = s ? s.status || "idle" : "idle";
		$("chat-title").textContent = sessionName(s) || "会话";
		$("chat-sdot").className = "sdot s-" + (working ? "working" : st);
		$("chat-st").textContent = working ? "回复中" : STATUS_LABEL[st] || st;
		const dead = DEAD.includes(st) && !working;
		$("resume-bar").classList.toggle("hidden", !dead);
		$("resume-txt").textContent = "会话" + (STATUS_LABEL[st] || "已停止") + "，发送消息或点击恢复";
		updateSendBtn();
	}

	async function loadPendings() {
		const s = sessionById(cur);
		const holder = $("pendings");
		if (!s || (s.pending !== "approval" && s.pending !== "question")) {
			holder.innerHTML = "";
			return;
		}
		const id = cur;
		try {
			const reqs = await M.api("GET", "/sessions/" + id + "/pending-ui");
			if (id !== cur) return;
			holder.innerHTML = "";
			renderPending(holder, id, reqs);
		} catch {}
	}

	// ---------- transcript sync ----------

	async function fetchTranscript() {
		if (!cur) return;
		if (fetching) {
			fetchAgain = true;
			return;
		}
		fetching = true;
		const id = cur;
		try {
			const page = await M.api("GET", "/sessions/" + id + "/transcript?from=" + offset);
			if (id !== cur) return;
			if (page.reset) items = [];
			const prevLen = items.length;
			items = items.concat(page.items || []);
			offset = page.nextOffset || offset;
			// Drop optimistic bubbles once the transcript shows the matching user message.
			const newUsers = (page.items || []).filter((x) => x.kind === "user" && x.text).map((x) => x.text.trim());
			if (newUsers.length)
				optimistic = optimistic.filter((o) => {
					// The server may prepend the plan-mode prefix, so match on the tail too.
					const want = o.text.trim();
					const k = newUsers.findIndex((u) => u === want || u.endsWith(want));
					if (k >= 0) {
						newUsers.splice(k, 1);
						return false;
					}
					return true;
				});
			// Tools that now have persisted results no longer need live entries.
			if (items.length !== prevLen) {
				const have = new Set();
				for (const it of items) if (it.toolResult) have.add(it.toolResult.toolCallId);
				for (const k of Object.keys(liveTools)) if (have.has(k)) delete liveTools[k];
			}
			renderMessages();
		} catch (e) {
			if (e.message !== "unauthorized") console.warn(e);
		} finally {
			fetching = false;
			if (fetchAgain) {
				fetchAgain = false;
				scheduleFetch(50);
			}
		}
	}

	function scheduleFetch(ms) {
		clearTimeout(fetchTimer);
		fetchTimer = setTimeout(fetchTranscript, ms);
	}

	function onRpc(d) {
		if (d.sessionId !== cur) return;
		const f = d.frame || {};
		switch (f.type) {
			case "agent_start":
			case "turn_start":
				working = true;
				if (f.type === "agent_start") setTimeout(loadState, 300);
				break;
			case "message_update": {
				const m = f.message;
				if (m && (!m.role || m.role === "assistant")) {
					streamMsg = m;
					working = true;
				}
				break;
			}
			case "message_end":
				streamMsg = null;
				scheduleFetch(250);
				break;
			case "tool_execution_start":
				if (f.toolCallId) liveTools[f.toolCallId] = { name: f.toolName || "tool", args: f.args, done: false };
				break;
			case "tool_execution_end": {
				const t = liveTools[f.toolCallId];
				if (t) {
					t.done = true;
					t.isError = f.isError === true;
					const r = f.result && Array.isArray(f.result.content) ? f.result.content : [];
					t.text = r
						.filter((p) => p && p.type === "text")
						.map((p) => p.text)
						.join("\n")
						.slice(0, 4000);
				}
				scheduleFetch(250);
				break;
			}
			case "turn_end":
				scheduleFetch(250);
				if (f.isTerminal === true) {
					working = false;
					streamMsg = null;
				}
				break;
			case "agent_end":
				if (f.isTerminal !== false) {
					working = false;
					streamMsg = null;
					liveTools = {};
				}
				scheduleFetch(250);
				setTimeout(loadState, 300);
				break;
		}
		renderChatHeader();
		updateSendBtn();
		renderMessages();
	}

	// ---------- pending UI ----------

	function reqTitle(req) {
		return req.title || req.message || req.prompt || req.description || req.method || "请求";
	}
	function reqOptions(req) {
		const raw = req.options || req.choices;
		if (!Array.isArray(raw) || raw.length === 0) return null;
		return raw.map((o) =>
			typeof o === "string"
				? { id: o, label: o }
				: { id: o.id ?? o.value ?? o.label, label: o.label ?? o.id ?? o.value },
		);
	}

	async function respond(sessionId, response, btn) {
		if (btn) btn.disabled = true;
		try {
			await M.api("POST", "/sessions/" + sessionId + "/ui-respond", { response });
			await M.refreshSessions();
			if (cur) loadPendings();
		} catch (e) {
			M.toast("操作失败：" + e.message);
			if (btn) btn.disabled = false;
		}
	}

	function renderPending(container, sessionId, requests) {
		for (const p of requests) {
			const req = p.request || {};
			const box = document.createElement("div");
			box.className = "card";
			const opts = reqOptions(req);
			let html = '<div class="top"><span class="kind question">待处理</span></div><div class="title">' + esc(reqTitle(req)) + "</div>";
			if (req.detail || req.body) html += '<div class="detail">' + esc(req.detail || req.body) + "</div>";
			box.innerHTML = html;
			const actions = document.createElement("div");
			actions.className = "actions";
			if (opts) {
				for (const o of opts) {
					const b = document.createElement("button");
					b.className = "btn" + (/approve|允许|批准|yes|ok/i.test(o.id + o.label) ? " primary" : "");
					b.textContent = o.label;
					b.onclick = () => respond(sessionId, { id: req.id, type: "extension_ui_response", value: o.id }, b);
					actions.appendChild(b);
				}
			} else {
				const ta = document.createElement("textarea");
				ta.placeholder = "输入回复…";
				const b = document.createElement("button");
				b.className = "btn primary";
				b.textContent = "提交";
				b.onclick = () => respond(sessionId, { id: req.id, type: "extension_ui_response", value: ta.value }, b);
				box.appendChild(ta);
				actions.appendChild(b);
			}
			box.appendChild(actions);
			container.appendChild(box);
		}
	}

	const TEMPLATE = `
		<div class="topbar">
			<button id="back" class="iconbtn" aria-label="返回">‹</button>
			<button id="menu" class="iconbtn" aria-label="菜单">☰</button>
			<h1 id="chat-title"></h1>
			<button id="chip" class="statuschip" aria-label="面板" style="background:none;border:none;padding:6px 4px"><span id="chat-sdot" class="sdot"></span><span id="chat-st"></span><span style="font-size:16px">▾</span></button>
		</div>
		<div class="chat-body">
			<div class="scroll" id="chat-scroll">
				<div id="msgs"></div>
			</div>
			<button id="jump" class="hidden" aria-label="到底部">↓</button>
		</div>
		<div id="pendings"></div>
		<div id="resume-bar" class="resume-bar hidden">
			<span id="resume-txt">会话已停止</span>
			<button id="resume-btn" class="btn primary">恢复</button>
		</div>
		<div class="composer">
			<div id="ch-chips" class="ch-chips hidden"></div>
			<div id="ch-atts" class="ch-atts hidden"></div>
			<div class="ch-wrap">
				<div id="ch-slash" class="ch-slash hidden"></div>
				<div class="box" id="ch-box">
					<button id="plus" class="ch-plus" aria-label="更多">+</button>
					<textarea id="input" rows="1" placeholder="发消息…" enterkeyhint="enter"></textarea>
					<button id="send" class="send" disabled aria-label="发送">↑</button>
				</div>
			</div>
		</div>
		<div id="ch-sheet" class="ch-sheet hidden">
			<div class="ch-scrim" id="ch-scrim"></div>
			<div class="ch-panel" id="ch-panel"></div>
		</div>
		<div id="st-ov" class="st-ov hidden"></div>
		<input id="f-any" type="file" multiple hidden>
		<input id="f-img" type="file" accept="image/*" multiple hidden>
		<input id="f-cam" type="file" accept="image/*" capture="environment" hidden>`;

	// ---------- composer: state chips ----------

	let cstate = null; // last composer-state
	let atts = []; // {id, name, isImage, url, status: up|ok|err, path, err}
	let attSeq = 0;
	let cmds = []; // slash commands
	let cmdsLoaded = false;
	let lastSend = 0;
	let stateTimer = null;

	function shortModel(m) {
		if (!m) return "";
		const s = typeof m === "string" ? m : m.id || m.name || m.model || "";
		return String(s).split("/").pop();
	}
	function goalLabel(g) {
		return { active: "进行中", paused: "已暂停", complete: "已完成", completed: "已完成" }[g.status] || g.status || "";
	}

	function renderChips() {
		const box = $("ch-chips");
		if (!cstate) {
			box.classList.add("hidden");
			return;
		}
		let h = "";
		const model = shortModel(cstate.model);
		if (model) h += '<button class="ch-chip pick" data-chip="model">' + esc(model) + " ▾</button>";
		if (model || cstate.thinkingLevel)
			h += '<button class="ch-chip pick" data-chip="think">思考 ' + esc(cstate.thinkingLevel || "auto") + " ▾</button>";
		if (cstate.planMode) h += '<button class="ch-chip plan" data-chip="plan">规划模式 ●</button>';
		if (cstate.goal && cstate.goal.objective)
			h +=
				'<button class="ch-chip goal" data-chip="goal">目标 · ' +
				esc(goalLabel(cstate.goal)) +
				"：" +
				esc(cstate.goal.objective.slice(0, 24)) +
				"</button>";
		box.innerHTML = h;
		box.classList.toggle("hidden", !h);
		$("ch-box").classList.toggle("plan", !!cstate.planMode);
		$("plus").classList.toggle("on", !!cstate.planMode || !!(cstate.goal && cstate.goal.objective));
	}

	async function loadState() {
		const id = cur;
		if (!id) return;
		try {
			const st = await M.api("GET", "/sessions/" + id + "/composer-state");
			if (id !== cur) return;
			if (st.thinkingLevel == null && cstate && cstate.thinkingLevel) st.thinkingLevel = cstate.thinkingLevel;
			cstate = st;
			if (st.streaming && !working) working = true;
			else if (!st.streaming && working && !streamMsg && Date.now() - lastSend > 4000) {
				const s = sessionById(cur);
				if (!s || s.status !== "working") working = false;
			}
			renderChips();
			renderChatHeader();
			updateSendBtn();
			renderMessages();
			if (!$("ch-sheet").classList.contains("hidden") && sheetView !== "model" && sheetView !== "think") renderSheet();
		} catch (e) {
			if (e.message !== "unauthorized") console.warn(e);
		}
	}

	// ---------- composer: send / stop ----------

	function readyAtts() {
		return atts.filter((a) => a.status === "ok");
	}

	function updateSendBtn() {
		const b = $("send");
		const hasContent = $("input").value.trim() !== "" || atts.length > 0;
		const stop = working && !hasContent;
		b.classList.toggle("stop", stop);
		b.textContent = stop ? "■" : "↑";
		b.setAttribute("aria-label", stop ? "停止" : "发送");
		b.disabled = !stop && !hasContent;
	}

	function autosize() {
		const ta = $("input");
		ta.style.height = "38px";
		ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
		updateSendBtn();
		updateSlash();
	}

	async function stop() {
		const b = $("send");
		b.disabled = true;
		try {
			await M.api("POST", "/sessions/" + cur + "/abort");
			M.toast("已发送停止请求");
		} catch (e) {
			M.toast("停止失败：" + e.message);
		}
		setTimeout(loadState, 600);
		if (root) updateSendBtn();
	}

	function buildPrompt(text) {
		let ni = 0;
		let nf = 0;
		const toks = readyAtts().map((a) => (a.isImage ? "[Image #" + ++ni + ": " + a.path + "]" : "[文件 #" + ++nf + ": " + a.path + "]"));
		return (toks.join(" ") + (toks.length && text ? " " : "") + text).trim();
	}

	function clearAtts() {
		for (const a of atts) if (a.url) URL.revokeObjectURL(a.url);
		atts = [];
		renderAtts();
	}

	async function runSlash(text) {
		const m = text.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
		if (!m) return false;
		const id = cur;
		const ta = $("input");
		ta.value = "";
		autosize();
		hideSlash();
		lastSend = Date.now();
		try {
			const r = await M.api("POST", "/sessions/" + id + "/slash", { name: m[1], args: (m[2] || "").trim() || undefined });
			if (r.output) {
				localOut.push({ text: r.output, name: m[1] });
				if (id === cur) renderMessages();
			}
			if (r.forwarded) {
				working = true;
				scheduleFetch(300);
			}
			if (r.sessionId && r.sessionId !== id) M.nav.open("chat", { id: r.sessionId });
			if (!r.output && !r.forwarded && !r.sessionId) M.toast("/" + m[1] + " 已执行");
			if (id === cur) {
				loadState();
				renderChatHeader();
			}
			M.refreshSessions();
		} catch (e) {
			if (id === cur) {
				ta.value = text;
				autosize();
			}
			M.toast("/" + m[1] + "：" + e.message);
		}
		return true;
	}

	async function send() {
		const ta = $("input");
		const text = ta.value.trim();
		if (!cur) return;
		if (working && !text && atts.length === 0) {
			// A double-tap on ↑ must not land on the ■ it just turned into.
			if (Date.now() - lastSend < 1200) return;
			return stop();
		}
		if (!text && atts.length === 0) return;
		if (atts.some((a) => a.status === "up")) return M.toast("附件上传中，请稍候");
		if (atts.some((a) => a.status === "err")) return M.toast("有附件上传失败，请移除后再发送");
		if (atts.length === 0 && text.startsWith("/")) {
			await runSlash(text);
			return;
		}
		const id = cur;
		const prompt = buildPrompt(text);
		const savedAtts = atts;
		atts = [];
		renderAtts();
		ta.value = "";
		autosize();
		hideSlash();
		optimistic.push({ text: prompt });
		working = true;
		lastSend = Date.now();
		renderChatHeader();
		renderMessages();
		updateSendBtn();
		$("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
		nearBottom = true;
		try {
			await M.api("POST", "/sessions/" + id + "/prompt-ex", { text: prompt, images: [] });
			for (const a of savedAtts) if (a.url) URL.revokeObjectURL(a.url);
			scheduleFetch(300);
		} catch (e) {
			const oi = optimistic.findIndex((o) => o.text === prompt);
			if (oi >= 0) optimistic.splice(oi, 1);
			working = false;
			if (id === cur) {
				ta.value = ta.value ? text + "\n" + ta.value : text;
				atts = savedAtts;
				renderAtts();
				autosize();
				renderChatHeader();
				renderMessages();
			} else {
				for (const a of savedAtts) if (a.url) URL.revokeObjectURL(a.url);
			}
			M.toast("发送失败：" + e.message);
		}
	}

	// ---------- composer: attachments ----------

	const MAX_BYTES = 20 * 1024 * 1024;

	function renderAtts() {
		const box = $("ch-atts");
		box.classList.toggle("hidden", atts.length === 0);
		box.innerHTML = atts
			.map(
				(a) =>
					'<div class="ch-att ' +
					a.status +
					'" data-id="' +
					a.id +
					'">' +
					(a.isImage && a.url ? '<img src="' + a.url + '" alt="">' : '<span class="ico">📎</span>') +
					'<span class="nm">' +
					esc(a.name) +
					'</span><span class="st">' +
					(a.status === "up" ? "上传中…" : a.status === "err" ? "失败" : "") +
					'</span><button class="x" data-rm="' +
					a.id +
					'" aria-label="移除">×</button></div>',
			)
			.join("");
		updateSendBtn();
	}

	async function addFiles(files, forceImage) {
		const id = cur;
		for (const f of files) {
			if (f.size > MAX_BYTES) {
				M.toast("「" + f.name + "」超过 20MB 上限，无法上传");
				continue;
			}
			const isImage = forceImage || /^image\//.test(f.type);
			const a = {
				id: ++attSeq,
				name: f.name || (isImage ? "image.jpg" : "file"),
				isImage,
				url: isImage ? URL.createObjectURL(f) : "",
				status: "up",
			};
			atts.push(a);
			renderAtts();
			M.upload("/sessions/" + id + "/upload", f, { name: a.name })
				.then((r) => {
					a.status = "ok";
					a.path = r.path;
				})
				.catch((e) => {
					a.status = "err";
					a.err = e.message;
					M.toast("上传失败：" + e.message);
				})
				.finally(() => {
					if (root) renderAtts();
				});
		}
	}

	// ---------- composer: slash popup ----------

	async function loadCmds() {
		try {
			cmds = await M.api("GET", "/sessions/" + cur + "/slash-commands");
			cmdsLoaded = true;
		} catch (e) {
			console.warn(e);
		}
		updateSlash();
	}

	function hideSlash() {
		$("ch-slash").classList.add("hidden");
	}

	function updateSlash() {
		const ta = $("input");
		const pop = $("ch-slash");
		const m = ta.value.match(/^\/([^\s]*)$/);
		if (!m) return hideSlash();
		if (!cmdsLoaded) {
			loadCmds();
			return;
		}
		const q = m[1].toLowerCase();
		const list = cmds.filter(
			(c) => !q || c.name.toLowerCase().includes(q) || (c.title || "").toLowerCase().includes(q) || (c.description || "").toLowerCase().includes(q),
		);
		if (list.length === 0) {
			pop.innerHTML = '<div class="ch-empty">无匹配命令</div>';
		} else {
			const groups = new Map();
			for (const c of list) {
				const g = c.group || "其他";
				if (!groups.has(g)) groups.set(g, []);
				groups.get(g).push(c);
			}
			let h = "";
			for (const [g, items] of groups) {
				h += '<div class="ch-gl">' + esc(g) + "</div>";
				for (const c of items)
					h +=
						'<button class="ch-row" data-cmd="' +
						esc(c.name) +
						'"><span class="n">/' +
						esc(c.name) +
						(c.argHint ? ' <i>' + esc(c.argHint) + "</i>" : "") +
						'</span><span class="d">' +
						esc(c.title || c.description || "") +
						"</span></button>";
			}
			pop.innerHTML = h;
		}
		pop.classList.remove("hidden");
	}

	// ---------- composer: "+" sheet ----------

	function openSheet(view) {
		sheetView = view || "menu";
		$("ch-sheet").classList.remove("hidden");
		renderSheet();
	}
	function closeSheet() {
		$("ch-sheet").classList.add("hidden");
	}
	let sheetView = "menu";

	// ---------- composer: model / thinking pickers ----------

	const THINK_DESC = {
		auto: "跟随模型的默认力度",
		off: "不启用深度推理思考",
		minimal: "轻度推理，适合简单问答",
		low: "较少推理步骤，响应较快",
		medium: "均衡推理与响应速度",
		high: "完整多步推理，适合复杂分析",
		xhigh: "高强度推理，适合复杂推演",
		max: "无限制深度推理，耗费最多预算",
	};
	let pk = null; // {id, models, current, thinkingLevel, liveThinking, loading, err, q}

	function currentModelOpt() {
		if (!pk || !pk.current) return null;
		const c = pk.current;
		return (
			pk.models.find((m) => m.id === c.id && (!c.provider || m.provider === c.provider)) ||
			pk.models.find((m) => m.id === c.id) ||
			null
		);
	}
	// Mirrors desktop resolveThinkingLevels: live levels, else catalog; auto first, off last.
	function thinkLevels() {
		const opt = currentModelOpt();
		const sup = pk.liveThinking && pk.liveThinking.length ? pk.liveThinking : (opt && opt.thinking) || [];
		const cur = pk.thinkingLevel || "";
		if (!sup.length) return cur ? [cur] : [];
		const lv = ["auto", ...sup.filter((l) => l !== "auto")];
		if (!lv.includes("off")) lv.push("off");
		if (cur && !lv.includes(cur)) lv.push(cur);
		return lv;
	}
	function applyFacts(r) {
		if (pk) {
			pk.current = r.current;
			pk.thinkingLevel = r.thinkingLevel;
			pk.liveThinking = r.liveThinking || [];
		}
		const m = r.current ? (r.current.provider ? r.current.provider + "/" : "") + r.current.id : cstate && cstate.model;
		cstate = Object.assign({}, cstate, { model: m, thinkingLevel: r.thinkingLevel });
		renderChips();
	}
	async function openPicker(view) {
		const id = cur;
		sheetView = view;
		pk = { id, models: [], current: null, thinkingLevel: cstate && cstate.thinkingLevel, liveThinking: [], loading: true, err: "", q: "" };
		$("ch-sheet").classList.remove("hidden");
		renderSheet();
		try {
			const r = await M.api("GET", "/sessions/" + id + "/models");
			if (!pk || pk.id !== id) return;
			pk.models = r.models || [];
			pk.loading = false;
			applyFacts(r);
		} catch (e) {
			if (!pk || pk.id !== id) return;
			pk.loading = false;
			pk.err = e.message;
		}
		if (sheetView === view && !$("ch-sheet").classList.contains("hidden")) renderSheet();
	}
	function modelListHtml() {
		const q = pk.q.trim().toLowerCase();
		const c = pk.current;
		const groups = new Map();
		for (const m of pk.models) {
			if (q && !(m.provider + "/" + m.id + " " + m.name).toLowerCase().includes(q)) continue;
			if (!groups.has(m.provider)) groups.set(m.provider, []);
			groups.get(m.provider).push(m);
		}
		if (!groups.size) return '<div class="ch-empty">' + (pk.models.length ? "没有匹配的模型" : "没有可用模型") + "</div>";
		let h = "";
		for (const [prov, list] of groups) {
			h += '<div class="ch-gl">' + esc(prov) + "</div>";
			for (const m of list) {
				const on = c && c.id === m.id && (!c.provider || c.provider === m.provider);
				h +=
					'<button class="ch-row ch-pk' + (on ? " on" : "") + '" data-pm="' + esc(m.provider + "/" + m.id) + '"><span class="n">' +
					esc(m.name && m.name !== m.provider + "/" + m.id ? m.name : m.id) + "</span>" +
					'<span class="d">' + esc(m.id) + "</span>" + (on ? '<span class="ck">✓</span>' : "") + "</button>";
			}
		}
		return h;
	}
	function renderPicker() {
		const p = $("ch-panel");
		if (pk.loading) {
			p.innerHTML = '<div class="ch-ptitle">' + (sheetView === "model" ? "选择模型" : "思考等级") + '</div><div class="ch-empty">加载中…</div>';
			return;
		}
		if (pk.err) {
			p.innerHTML = '<div class="ch-ptitle">加载失败</div><div class="ch-empty">' + esc(pk.err) + "</div>";
			return;
		}
		if (sheetView === "model") {
			p.innerHTML =
				'<div class="ch-ptitle">选择模型</div>' +
				(pk.models.length > 8 ? '<input id="pk-q" class="ch-gin" type="search" placeholder="搜索模型…" value="' + esc(pk.q) + '">' : "") +
				'<div id="pk-list" class="ch-pklist">' + modelListHtml() + "</div>";
			const qi = p.querySelector("#pk-q");
			if (qi)
				qi.oninput = () => {
					pk.q = qi.value;
					$("pk-list").innerHTML = modelListHtml();
				};
			return;
		}
		const lv = thinkLevels();
		const cur = pk.thinkingLevel || "auto";
		p.innerHTML =
			'<div class="ch-ptitle">思考等级</div><div class="ch-pklist">' +
			(lv.length
				? lv
						.map(
							(l) =>
								'<button class="ch-row ch-pk' + (l === cur ? " on" : "") + '" data-pt="' + esc(l) + '"><span class="n">' + esc(l) + "</span>" +
								'<span class="d">' + esc(THINK_DESC[l] || "") + "</span>" + (l === cur ? '<span class="ck">✓</span>' : "") + "</button>",
						)
						.join("")
				: '<div class="ch-empty">当前模型不支持调整思考等级</div>') +
			"</div>";
	}
	async function pickModel(key) {
		const i = key.indexOf("/");
		const provider = key.slice(0, i);
		const modelId = key.slice(i + 1);
		closeSheet();
		try {
			applyFacts(await M.api("POST", "/sessions/" + cur + "/model", { provider, modelId }));
			M.toast("已切换模型：" + modelId);
		} catch (e) {
			M.toast("切换失败：" + e.message);
		}
	}
	async function pickThinking(level) {
		closeSheet();
		try {
			applyFacts(await M.api("POST", "/sessions/" + cur + "/thinking", { level }));
			M.toast("思考等级：" + level);
		} catch (e) {
			M.toast("切换失败：" + e.message);
		}
	}

	function renderSheet() {
		const p = $("ch-panel");
		if (sheetView === "model" || sheetView === "think") return renderPicker();
		if (sheetView === "goal") {
			const g = cstate && cstate.goal && cstate.goal.objective ? cstate.goal : null;
			p.innerHTML =
				'<div class="ch-ptitle">目标</div>' +
				(g
					? '<div class="ch-goalcur"><b>' + esc(g.objective) + "</b><span>" + esc(goalLabel(g)) + "</span></div>"
					: '<div class="ch-hint">还没有目标。设定后 agent 会持续朝它推进。</div>') +
				'<textarea id="goal-in" class="ch-gin" rows="2" placeholder="' +
				(g ? "输入新目标（会替换当前目标）" : "输入目标…") +
				'"></textarea>' +
				'<div class="ch-btns"><button class="btn primary" data-goal="set">' +
				(g ? "替换目标" : "设定目标") +
				"</button>" +
				(g
					? '<button class="btn" data-goal="' +
						(g.status === "paused" ? "resume" : "pause") +
						'">' +
						(g.status === "paused" ? "恢复" : "暂停") +
						'</button><button class="btn danger" data-goal="drop">放弃</button>'
					: "") +
				'</div><button class="ch-back" data-sheet="menu">‹ 返回</button>';
			return;
		}
		const plan = !!(cstate && cstate.planMode);
		p.innerHTML =
			'<div class="ch-grid">' +
			'<button data-act="file"><span>📄</span>文件</button>' +
			'<button data-act="img"><span>🖼️</span>图片</button>' +
			'<button data-act="cam"><span>📷</span>拍照</button>' +
			'<button data-act="sketch"><span>✏️</span>草图</button>' +
			'<button data-act="goal"><span>🎯</span>目标' +
			(cstate && cstate.goal && cstate.goal.objective ? " ●" : "") +
			"</button>" +
			'<button data-act="plan" class="' +
			(plan ? "on" : "") +
			'"><span>🧭</span>规划模式' +
			(plan ? " 开" : "") +
			"</button></div>";
	}

	async function sheetClick(e) {
		const t = e.target.closest("button");
		if (!t) return;
		if (t.dataset.sheet) {
			sheetView = t.dataset.sheet;
			return renderSheet();
		}
		if (t.dataset.pm) return pickModel(t.dataset.pm);
		if (t.dataset.pt) return pickThinking(t.dataset.pt);
		if (t.dataset.goal) return goalAction(t.dataset.goal);
		switch (t.dataset.act) {
			case "file":
				closeSheet();
				return $("f-any").click();
			case "img":
				closeSheet();
				return $("f-img").click();
			case "cam":
				closeSheet();
				return $("f-cam").click();
			case "sketch":
				closeSheet();
				if (M.sketch)
					M.sketch.open((blob) => addFiles([new File([blob], "sketch-" + Date.now() + ".png", { type: "image/png" })], true));
				return;
			case "goal":
				sheetView = "goal";
				return renderSheet();
			case "plan":
				return togglePlan();
		}
	}

	async function togglePlan() {
		try {
			const r = await M.api("POST", "/sessions/" + cur + "/plan-mode", {});
			cstate = Object.assign({}, cstate, { planMode: r.on });
			renderChips();
			renderSheet();
			M.toast(r.on ? "规划模式已开启" : "规划模式已关闭");
		} catch (e) {
			M.toast("切换失败：" + e.message);
		}
	}

	async function goalAction(op) {
		const body =
			op === "set"
				? { objective: (root.querySelector("#goal-in").value || "").trim() }
				: { op };
		if (op === "set" && !body.objective) return M.toast("请先输入目标");
		if (op === "drop" && !(await M.confirm("放弃当前目标？"))) return;
		try {
			const r = await M.api("POST", "/sessions/" + cur + "/goal", body);
			cstate = Object.assign({}, cstate, { goal: r.goal || null });
			renderChips();
			renderSheet();
			M.toast({ set: "目标已设定", pause: "目标已暂停", resume: "目标已恢复", drop: "目标已放弃" }[op]);
		} catch (e) {
			M.toast("操作失败：" + e.message);
		}
	}

	async function resume() {
		const b = $("resume-btn");
		b.disabled = true;
		try {
			await M.api("POST", "/sessions/" + cur + "/resume");
			await M.refreshSessions();
		} catch (e) {
			M.toast("恢复失败：" + e.message);
		} finally {
			b.disabled = false;
		}
	}

	// ---------- lifecycle + bus wiring ----------

	/** SSE frames can be lost (iOS suspends the tab, server lag): a half-built stream message would
	    otherwise linger next to the persisted answer, so rebuild from the transcript + composer state. */
	function resyncLive() {
		if (!cur) return;
		streamMsg = null;
		scheduleFetch(0);
		loadState();
		renderMessages();
	}

	function onSessionsChanged() {
		if (!cur) return;
		const s = sessionById(cur);
		if (s && s.status !== "working" && !streamMsg && Date.now() - lastSend > 4000) working = false;
		else if (s && s.status === "working") working = true;
		renderChatHeader();
		loadPendings();
	}

	const bus = {
		sessions: onSessionsChanged,
		"sse:rpc": (d) => d && onRpc(d),
		"sse:touch": (d) => {
			if (d && d.sessionId === cur) {
				scheduleFetch(150);
				loadPendings();
			}
		},
		"sse:resync": () => resyncLive(),
		connected: () => resyncLive(),
		poll: () => cur && fetchTranscript(),
		visible: () => resyncLive(),
		viewport: () => {
			if (!cur) return;
			// The keyboard shrinks the scroller, so distance-to-bottom can no longer
			// tell whether the user was following the tail: use the last sample.
			const sc = $("chat-scroll");
			lastCH = sc.clientHeight;
			if (nearBottom) sc.scrollTop = sc.scrollHeight;
		},
	};

	function mount(el, params) {
		root = el;
		el.innerHTML = TEMPLATE;
		lastHtml = "";
		nearBottom = true;
		lastCH = 0;
		cur = params.id;
		items = [];
		offset = 0;
		optimistic = [];
		streamMsg = null;
		liveTools = {};
		localOut = [];
		cstate = null;
		atts = [];
		cmds = [];
		cmdsLoaded = false;
		foldOverride.clear();
		toolOpen.clear();
		turnStart.clear();
		statByItem.clear();
		pvOpen.clear();
		statCardId = null;
		fetching = false;
		fetchAgain = false;
		M.setCurrentSession(cur);
		const s = sessionById(cur);
		working = !!s && s.status === "working";

		$("back").onclick = () => M.nav.back();
		$("menu").onclick = () => M.drawer.open("left");
		$("chip").onclick = () => M.drawer.open("right");
		$("input").addEventListener("input", autosize);
		$("send").onclick = send;
		$("plus").onclick = () => openSheet("menu");
		$("ch-scrim").onclick = closeSheet;
		$("ch-panel").addEventListener("click", sheetClick);
		$("ch-chips").addEventListener("click", (e) => {
			const c = e.target.closest("[data-chip]");
			if (!c) return;
			if (c.dataset.chip === "plan") togglePlan();
			else if (c.dataset.chip === "model") openPicker("model");
			else if (c.dataset.chip === "think") openPicker("think");
			else openSheet("goal");
		});
		$("ch-atts").addEventListener("click", (e) => {
			const x = e.target.closest("[data-rm]");
			if (!x) return;
			const i = atts.findIndex((a) => a.id === +x.dataset.rm);
			if (i >= 0) {
				if (atts[i].url) URL.revokeObjectURL(atts[i].url);
				atts.splice(i, 1);
				renderAtts();
			}
		});
		for (const [id, img] of [["f-any", false], ["f-img", true], ["f-cam", true]])
			$(id).addEventListener("change", (e) => {
				addFiles(Array.from(e.target.files || []), img);
				e.target.value = "";
			});
		// Keep the keyboard up while tapping slash rows.
		$("ch-slash").addEventListener("pointerdown", (e) => e.preventDefault());
		$("ch-slash").addEventListener("click", (e) => {
			const r = e.target.closest("[data-cmd]");
			if (!r) return;
			const ta = $("input");
			ta.value = "/" + r.dataset.cmd + " ";
			hideSlash();
			autosize();
			ta.focus();
		});
		$("msgs").addEventListener("click", (e) => {
			const s = e.target.closest("[data-stat]");
			if (s) return toggleStatCard(s.dataset.stat);
			const p = e.target.closest("[data-pv]");
			if (p) return togglePreview(p.dataset.pv, !pvOpen.has(p.dataset.pv));
			const h = e.target.closest("[data-fold]");
			if (!h) return;
			const f = h.parentElement;
			const open = !f.classList.contains("open");
			foldOverride.set(h.dataset.fold, open);
			f.classList.toggle("open", open);
		});
		$("st-ov").addEventListener("click", (e) => {
			if (e.target.closest("[data-stclose]")) closeStatCard();
		});
		$("msgs").addEventListener(
			"toggle",
			(e) => {
				const d = e.target;
				if (!d.dataset || !d.dataset.k) return;
				if (d.open) toolOpen.add(d.dataset.k);
				else toolOpen.delete(d.dataset.k);
			},
			true,
		);
		$("input").addEventListener("keydown", (e) => {
			// Hardware keyboards: Enter sends, Shift+Enter newline. Soft keyboards keep newline behaviour.
			if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && matchMedia("(hover: hover)").matches) {
				e.preventDefault();
				send();
			}
		});
		$("resume-btn").onclick = resume;
		$("chat-scroll").addEventListener("scroll", () => {
			const sc = $("chat-scroll");
			const dist = sc.scrollHeight - sc.scrollTop - sc.clientHeight;
			// Ignore scrolls caused by a resize (keyboard): they are not user intent.
			if (sc.clientHeight === lastCH) nearBottom = dist < 120;
			lastCH = sc.clientHeight;
			$("jump").classList.toggle("hidden", dist < 120);
		});
		$("jump").onclick = () => {
			const sc = $("chat-scroll");
			sc.scrollTo({ top: sc.scrollHeight, behavior: "smooth" });
		};

		for (const [evt, fn] of Object.entries(bus)) M.on(evt, fn);
		autosize();
		renderChatHeader();
		renderMessages();
		fetchTranscript().then(() => {
			if (root === el) {
				$("chat-scroll").scrollTop = $("chat-scroll").scrollHeight;
				nearBottom = true;
			}
		});
		loadPendings();
		loadState();
		loadCmds();
		clearInterval(stateTimer);
		stateTimer = setInterval(loadState, 5000);
		clearInterval(tickTimer);
		tickTimer = setInterval(tick, 1000);
	}

	function unmount() {
		clearInterval(stateTimer);
		clearInterval(tickTimer);
		clearAtts();
		for (const [evt, fn] of Object.entries(bus)) M.off(evt, fn);
		clearTimeout(fetchTimer);
		cur = null;
		root = null;
		M.setCurrentSession(null);
	}

	M.chat = { respond };
	M.registerPage("chat", { title: "会话", bare: true, mount, unmount });
})();
