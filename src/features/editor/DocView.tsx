/** [C] Center "文档" view: md preview/annotate/edit (docs/ARCHITECTURE.md §11 C). */

import { markdown } from "@codemirror/lang-markdown";
import CodeMirror from "@uiw/react-codemirror";
import clsx from "clsx";
import { FileText, MessageSquarePlus, RefreshCw, Save, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { readTextFile, writeTextFile } from "../../lib/ipc";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { basename } from "../git/helpers";
import { confirmDialog, errMsg, useShortPath } from "../git/ui";

type Tab = "preview" | "edit";

/** Tailwind styling for rendered markdown (no typography plugin). */
const MD: Components = {
	h1: ({ node: _n, ...p }) => <h1 className="mt-5 mb-3 text-xl font-semibold text-neutral-100" {...p} />,
	h2: ({ node: _n, ...p }) => <h2 className="mt-5 mb-2 text-lg font-semibold text-neutral-100" {...p} />,
	h3: ({ node: _n, ...p }) => <h3 className="mt-4 mb-2 text-base font-semibold text-neutral-200" {...p} />,
	h4: ({ node: _n, ...p }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold text-neutral-200" {...p} />,
	p: ({ node: _n, ...p }) => <p className="my-2 leading-6 text-neutral-300" {...p} />,
	a: ({ node: _n, ...p }) => <a className="text-sky-400 hover:underline" target="_blank" rel="noreferrer" {...p} />,
	ul: ({ node: _n, ...p }) => <ul className="my-2 list-disc space-y-0.5 pl-5 text-neutral-300" {...p} />,
	ol: ({ node: _n, ...p }) => <ol className="my-2 list-decimal space-y-0.5 pl-5 text-neutral-300" {...p} />,
	li: ({ node: _n, ...p }) => <li className="leading-6" {...p} />,
	blockquote: ({ node: _n, ...p }) => (
		<blockquote className="my-2 border-l-2 border-neutral-600 pl-3 text-neutral-400" {...p} />
	),
	code: ({ node: _n, className, ...p }) => (
		<code
			className={clsx(
				"rounded bg-neutral-800 px-1 py-0.5 font-mono text-[0.85em] text-amber-200",
				className,
			)}
			{...p}
		/>
	),
	pre: ({ node: _n, ...p }) => (
		<pre
			className="my-3 overflow-x-auto rounded border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-neutral-200"
			{...p}
		/>
	),
	table: ({ node: _n, ...p }) => <table className="my-3 border-collapse text-xs" {...p} />,
	th: ({ node: _n, ...p }) => (
		<th className="border border-neutral-700 bg-neutral-800/60 px-2 py-1 text-left text-neutral-200" {...p} />
	),
	td: ({ node: _n, ...p }) => <td className="border border-neutral-800 px-2 py-1 text-neutral-300" {...p} />,
	hr: ({ node: _n, ...p }) => <hr className="my-4 border-neutral-800" {...p} />,
	img: ({ node: _n, ...p }) => <img className="my-2 max-w-full rounded" {...p} />,
};

interface Selection {
	text: string;
}

export function DocView({ path }: { path: string }) {
	const [saved, setSaved] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	const [tab, setTab] = useState<Tab>("preview");
	const [error, setError] = useState<string | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [external, setExternal] = useState(false);
	const [sel, setSel] = useState<Selection | null>(null);
	const [comment, setComment] = useState("");
	const [pickSession, setPickSession] = useState("");
	const [saving, setSaving] = useState(false);
	const previewRef = useRef<HTMLDivElement>(null);

	const sessions = useSessions((s) => s.sessions);
	const sessionId = useUi((s) => s.selectedSessionId);
	const setCenter = useUi((s) => s.setCenter);
	const addAnnotation = useComposer((s) => s.addAnnotation);
	const short = useShortPath();

	const dirty = saved !== null && draft !== saved;

	const load = useCallback(async () => {
		try {
			const text = await readTextFile(path);
			setSaved(text);
			setDraft(text);
			setError(null);
			setExternal(false);
		} catch (e) {
			setError(errMsg(e));
			setSaved(null);
		}
	}, [path]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload on path change
	useEffect(() => {
		setSel(null);
		setNote(null);
		load();
	}, [path]);

	// Reload-on-change: re-read on window focus. Clean buffers update silently;
	// dirty buffers get a banner instead of losing edits.
	useEffect(() => {
		const onFocus = async () => {
			if (saved === null) return;
			try {
				const text = await readTextFile(path);
				if (text === saved) return;
				if (dirty) {
					setExternal(true);
				} else {
					setSaved(text);
					setDraft(text);
				}
			} catch {
				// File may be gone; leave the buffer alone.
			}
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [path, saved, dirty]);

	const save = useCallback(async () => {
		if (saved === null || !dirty || saving) return;
		setSaving(true);
		try {
			await writeTextFile(path, draft);
			setSaved(draft);
			setExternal(false);
			setNote("已保存");
			setTimeout(() => setNote((n) => (n === "已保存" ? null : n)), 1500);
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setSaving(false);
		}
	}, [path, draft, saved, dirty, saving]);

	// Cmd+S / Ctrl+S saves while editing.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [save]);

	const reload = async () => {
		if (dirty && !(await confirmDialog("放弃未保存的修改并重新加载？", { danger: true }))) return;
		await load();
	};

	const captureSelection = () => {
		const s = window.getSelection();
		if (!s || s.isCollapsed || !previewRef.current?.contains(s.anchorNode)) {
			setSel(null);
			return;
		}
		const text = s.toString().trim();
		setSel(text ? { text } : null);
	};

	const annotate = () => {
		const target = sessionId ?? (pickSession || null);
		if (!sel || !target) return;
		addAnnotation(target, {
			source: "doc",
			file: path,
			text: sel.text,
			comment: comment.trim() || undefined,
		});
		setNote(`已添加批注到会话 ${sessions[target]?.label || target.slice(0, 6)}`);
		setSel(null);
		setComment("");
		window.getSelection()?.removeAllRanges();
	};

	const sessionList = Object.values(sessions).filter((s) => !s.archived);
	const annTarget = sessionId ?? (pickSession || null);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
				<FileText size={14} className="shrink-0 text-neutral-500" />
				<span className="truncate text-xs text-neutral-200" title={path}>
					{basename(path)}
					<span className="ml-1.5 text-[10px] text-neutral-500">{short(path)}</span>
				</span>
				{dirty && <span className="shrink-0 text-[10px] text-amber-400">● 未保存</span>}
				{note && <span className="shrink-0 text-[10px] text-emerald-400">{note}</span>}
				<span className="flex-1" />
				<div className="flex rounded border border-neutral-700 text-[11px]">
					{(["preview", "edit"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => setTab(t)}
							className={clsx(
								"px-2.5 py-0.5",
								tab === t ? "bg-neutral-800 text-neutral-100" : "text-neutral-400 hover:text-neutral-200",
							)}
						>
							{t === "preview" ? "预览" : "编辑"}
						</button>
					))}
				</div>
				<button
					type="button"
					title="保存 (⌘S)"
					disabled={!dirty || saving}
					onClick={save}
					className="rounded p-1 text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
				>
					<Save size={13} />
				</button>
				<button
					type="button"
					title="重新加载"
					onClick={reload}
					className="rounded p-1 text-neutral-400 hover:bg-neutral-800"
				>
					<RefreshCw size={13} />
				</button>
				<button
					type="button"
					title="关闭"
					onClick={() => setCenter(sessionId ? "session" : "home")}
					className="rounded p-1 text-neutral-400 hover:bg-neutral-800"
				>
					<X size={13} />
				</button>
			</div>

			{error && <div className="shrink-0 border-b border-neutral-800 px-3 py-1.5 text-xs text-rose-400">{error}</div>}
			{external && (
				<div className="flex shrink-0 items-center gap-2 border-b border-amber-800/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
					<span className="flex-1">文件已在磁盘上被修改</span>
					<button type="button" onClick={reload} className="rounded bg-amber-800/60 px-2 py-0.5 hover:bg-amber-700/60">
						重新加载
					</button>
					<button type="button" onClick={() => setExternal(false)} className="px-1.5 text-amber-300/80">
						保留我的修改
					</button>
				</div>
			)}

			{tab === "preview" ? (
				<div
					ref={previewRef}
					onMouseUp={captureSelection}
					className="min-h-0 flex-1 overflow-y-auto px-5 py-3 text-sm"
				>
					{saved === null && !error && <div className="py-6 text-center text-xs text-neutral-500">加载中…</div>}
					{saved !== null && (
						<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={MD}>
							{draft}
						</ReactMarkdown>
					)}
				</div>
			) : (
				<div className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-editor]:bg-neutral-950 [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs">
					<CodeMirror
						value={draft}
						onChange={setDraft}
						extensions={[markdown()]}
						theme="dark"
						height="100%"
						style={{ height: "100%" }}
						basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
					/>
				</div>
			)}

			{sel && tab === "preview" && (
				<div className="flex shrink-0 items-end gap-2 border-t border-neutral-800 p-2">
					<div className="min-w-0 flex-1">
						<div className="mb-1 truncate text-[10px] text-neutral-500" title={sel.text}>
							「{sel.text.length > 80 ? `${sel.text.slice(0, 80)}…` : sel.text}」
						</div>
						<textarea
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder="批注内容（附加到会话输入框）"
							rows={2}
							className="w-full resize-none rounded border border-neutral-700 bg-neutral-950 p-2 text-xs text-neutral-200 outline-none focus:border-indigo-500"
						/>
					</div>
					{!sessionId && (
						<select
							value={pickSession}
							onChange={(e) => setPickSession(e.target.value)}
							className="max-w-32 rounded border border-neutral-700 bg-neutral-950 px-1 py-1 text-xs text-neutral-300"
						>
							<option value="">选择会话…</option>
							{sessionList.map((s) => (
								<option key={s.id} value={s.id}>
									{s.label} {s.title}
								</option>
							))}
						</select>
					)}
					<button
						type="button"
						disabled={!annTarget}
						onClick={annotate}
						title={annTarget ? "添加批注" : "先选择一个会话"}
						className="flex items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-40"
					>
						<MessageSquarePlus size={14} /> 批注
					</button>
					<button
						type="button"
						onClick={() => {
							setSel(null);
							window.getSelection()?.removeAllRanges();
						}}
						className="px-2 py-1.5 text-xs text-neutral-400"
					>
						取消
					</button>
				</div>
			)}
		</div>
	);
}
