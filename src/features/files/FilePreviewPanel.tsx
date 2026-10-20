/**
 * Right-panel file preview: one tab per opened file (see `stores/filePreview`).
 * Text files open read-only in 预览 and can switch to 编辑 (CodeMirror, ⌘S);
 * images render inline. Markdown previews reuse the chat renderer, so paths
 * inside the document stay clickable.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileText, FolderOpen, RefreshCw, Save } from "lucide-react";
import React, { Suspense, useEffect, useRef } from "react";
import { errMsg } from "../../lib/dialogs";
import { basename, shortPath } from "../../lib/paths";
import { useHomeDir } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { previewKind } from "../../lib/fileLinks";
import { type FileTab, useFilePreview } from "../../stores/filePreview";
import { useUi } from "../../stores/ui";
import { SelectionToolbar } from "../chat/SelectionToolbar";
import { Segmented } from "../../components/Segmented";
import { Markdown } from "../chat/markdown";
import { useFileBuffer } from "../editor/useFileBuffer";

const FileEditor = React.lazy(() => import("./FileEditor"));

function ExternalActions({ path }: { path: string }) {
	const run = (fn: () => Promise<void>, what: string) => {
		void fn().catch((e: unknown) => toast.error(`${what}失败: ${errMsg(e)}`));
	};
	return (
		<>
			<button
				type="button"
				onClick={() => run(() => openPath(path), "打开")}
				title="用系统默认应用打开"
				className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
			>
				<ExternalLink size={13} />
				系统打开
			</button>
			<button
				type="button"
				onClick={() => run(() => revealItemInDir(path), "在访达中显示")}
				title="在访达中显示"
				className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
			>
				<FolderOpen size={13} />
				访达
			</button>
		</>
	);
}

function ImageBody({ path }: { path: string }) {
	const home = useHomeDir();
	const resolved = path.startsWith("~/") && home ? `${home.replace(/\/+$/, "")}${path.slice(1)}` : path;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--border-divider)] px-3 py-1.5 text-[11px]">
				<ExternalActions path={resolved} />
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-3">
				{path.startsWith("~/") && !home ? (
					<div className="text-xs text-[var(--text-60)]">无法解析 ~ 路径：{path}</div>
				) : (
					<img
						src={convertFileSrc(resolved)}
						alt={basename(path)}
						className="mx-auto max-w-full rounded-lg border border-[var(--line)] object-contain"
					/>
				)}
			</div>
		</div>
	);
}

function TextBody({ tab }: { tab: FileTab }) {
	const buffer = useFileBuffer(tab.path);
	const { saved, draft, setDraft, error, external, saving, dirty } = buffer;
	const setMode = useFilePreview((s) => s.setMode);
	const home = useHomeDir();
	const sessionId = useUi((s) => s.selectedSessionId);
	const previewRef = useRef<HTMLDivElement>(null);
	const isMarkdown = /\.(md|markdown|mdx)$/i.test(tab.path);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void buffer.save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [buffer]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b border-[var(--border-divider)] px-3 py-2">
				<div className="flex items-start gap-2">
					<FileText size={14} className="mt-0.5 shrink-0 text-neutral-400" />
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium text-xs text-[var(--text)]">{basename(tab.path)}</span>
							{dirty && (
								<span className="whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
									未保存
								</span>
							)}
						</div>
						<div className="mt-0.5 break-all font-mono text-[10px] leading-4 text-[var(--text-40)]" title={tab.path}>
							{shortPath(tab.path, home)}
						</div>
					</div>
				</div>
				<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
					<Segmented
						size="sm"
						aria-label="查看方式"
						value={tab.mode}
						onChange={(mode) => setMode(tab.path, mode)}
						options={[
							{ value: "preview", label: "预览" },
							{ value: "edit", label: "编辑" },
						]}
					/>
					<span className="flex-1" />
					<button
						type="button"
						title="保存 (⌘S)"
						disabled={!dirty || saving}
						onClick={() => void buffer.save()}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
					>
						<Save size={13} />
						保存
					</button>
					<button
						type="button"
						title="从磁盘重新加载"
						onClick={() => void buffer.reload()}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					>
						<RefreshCw size={13} />
						重新加载
					</button>
					<ExternalActions path={tab.path} />
				</div>
			</div>

			{error && (
				<div className="shrink-0 select-text whitespace-pre-wrap break-words border-b border-[var(--border-divider)] px-3 py-2 text-xs text-rose-400">
					{error}
				</div>
			)}
			{external && (
				<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-800/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
					<span className="flex-1">文件已在磁盘上被修改</span>
					<button type="button" onClick={() => void buffer.reload()} className="rounded bg-amber-800/60 px-2 py-0.5 hover:bg-amber-700/60">
						重新加载
					</button>
					<button type="button" onClick={buffer.dismissExternal} className="px-1.5 text-amber-300/80">
						保留我的修改
					</button>
				</div>
			)}

			{saved === null && !error ? (
				<div className="py-6 text-center text-xs text-[var(--text-40)]">加载中…</div>
			) : tab.mode === "edit" ? (
				<div className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-editor]:bg-neutral-950 [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs">
					<Suspense fallback={<div className="py-6 text-center text-xs text-[var(--text-40)]">加载编辑器…</div>}>
						<FileEditor path={tab.path} value={draft} onChange={setDraft} />
					</Suspense>
				</div>
			) : (
				<div ref={previewRef} className="min-h-0 flex-1 overflow-auto px-4 py-3">
					{isMarkdown ? (
						<Markdown text={draft} cwd={tab.cwd ?? tab.path.replace(/\/[^/]*$/, "")} />
					) : (
						<pre className="select-text whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[var(--text-60)]">
							{draft}
						</pre>
					)}
					{sessionId && <SelectionToolbar sessionId={sessionId} containerRef={previewRef} docFile={tab.path} />}
				</div>
			)}
		</div>
	);
}

export function FilePreviewPanel() {
	const tabs = useFilePreview((s) => s.tabs);
	const activePath = useFilePreview((s) => s.activePath);
	const active = tabs.find((t) => t.path === activePath) ?? tabs[0] ?? null;

	if (!active) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[var(--text-40)]">
				<FileText size={20} className="text-neutral-500" />
				<div>还没有打开的文件</div>
				<div className="text-[11px]">在对话里点击文件路径，即可在这里预览</div>
			</div>
		);
	}

	const kind = previewKind(active.path);
	return (
		<React.Fragment key={active.path}>
			{kind === "image" ? <ImageBody path={active.path} /> : <TextBody tab={active} />}
		</React.Fragment>
	);
}
