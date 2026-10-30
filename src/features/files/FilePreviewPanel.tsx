/**
 * Right-panel file preview: one tab per opened file (see `stores/filePreview`).
 * Text files open read-only in 预览 and can switch to 编辑 (CodeMirror, ⌘S);
 * images render inline. Markdown previews reuse the chat renderer, so paths
 * inside the document stay clickable.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
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
import { Markdown } from "../../components/Markdown";
import { useFileBuffer } from "../editor/useFileBuffer";
import { useT } from "../../stores/language";
import { buildHtmlPreviewDoc, HTML_PREVIEW_SANDBOX, isHtmlPreviewPath, relayedExternalUrl } from "./htmlPreview";

const FileEditor = React.lazy(() => import("./FileEditor"));

function ExternalActions({ path, isHtml }: { path: string; isHtml?: boolean }) {
	const { t } = useT();
	const run = (fn: () => Promise<void>, what: string) => {
		void fn().catch((e: unknown) => toast.error(t("files.actionFailed", { action: what, error: errMsg(e) })));
	};
	return (
		<>
			<button
				type="button"
				onClick={() => run(() => openPath(path), t("files.actionOpen"))}
				title={t("files.openWithSystemDefault")}
				className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
			>
				<ExternalLink size={13} />
				{isHtml ? t("files.openInBrowser") : t("files.systemOpen")}
			</button>
			<button
				type="button"
				onClick={() => run(() => revealItemInDir(path), t("files.actionReveal"))}
				title={t("files.actionReveal")}
				className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
			>
				<FolderOpen size={13} />
				{t("files.finder")}
			</button>
		</>
	);
}

function ImageBody({ path }: { path: string }) {
	const { t } = useT();
	const home = useHomeDir();
	const resolved = path.startsWith("~/") && home ? `${home.replace(/\/+$/, "")}${path.slice(1)}` : path;
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--border-divider)] px-3 py-1.5 text-[11px]">
				<ExternalActions path={resolved} />
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-3">
				{path.startsWith("~/") && !home ? (
					<div className="text-xs text-[var(--text-60)]">{t("files.cannotResolveTildePath", { path })}</div>
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
	const { t } = useT();
	const buffer = useFileBuffer(tab.path);
	const { saved, draft, setDraft, error, external, saving, dirty } = buffer;
	const setMode = useFilePreview((s) => s.setMode);
	const home = useHomeDir();
	const sessionId = useUi((s) => s.selectedSessionId);
	const previewRef = useRef<HTMLDivElement>(null);
	const isMarkdown = /\.(md|markdown|mdx)$/i.test(tab.path);
	const isHtml = isHtmlPreviewPath(tab.path);
	const iframeRef = useRef<HTMLIFrameElement>(null);

	// Links clicked inside the opaque-origin preview are relayed here; only
	// http(s) from this frame is opened, in the system browser.
	useEffect(() => {
		if (!isHtml || tab.mode !== "preview") return;
		const onMessage = (e: MessageEvent) => {
			if (e.source !== iframeRef.current?.contentWindow) return;
			const url = relayedExternalUrl(e.data);
			if (url) void openUrl(url).catch((err: unknown) => toast.error(errMsg(err)));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [isHtml, tab.mode]);

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
									{t("files.unsaved")}
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
						aria-label={t("files.viewMode")}
						value={tab.mode}
						onChange={(mode) => setMode(tab.path, mode)}
						options={[
							{ value: "preview", label: t("files.tabPreview") },
							{ value: "edit", label: t("files.tabEdit") },
						]}
					/>
					<span className="flex-1" />
					<button
						type="button"
						title={t("files.saveShortcut")}
						disabled={!dirty || saving}
						onClick={() => void buffer.save()}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40"
					>
						<Save size={13} />
						{t("common.save")}
					</button>
					<button
						type="button"
						title={t("files.reloadFromDisk")}
						onClick={() => void buffer.reload()}
						className="flex items-center gap-1 rounded-lg px-2 py-1 text-neutral-300 transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					>
						<RefreshCw size={13} />
						{t("editor.reload")}
					</button>
					<ExternalActions path={tab.path} isHtml={isHtml} />
				</div>
			</div>

			{error && (
				<div className="shrink-0 select-text whitespace-pre-wrap break-words border-b border-[var(--border-divider)] px-3 py-2 text-xs text-rose-400">
					{error}
				</div>
			)}
			{external && (
				<div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-800/60 bg-amber-950/40 px-3 py-1.5 text-xs text-amber-200">
					<span className="flex-1">{t("files.fileModifiedOnDisk")}</span>
					<button type="button" onClick={() => void buffer.reload()} className="rounded bg-amber-800/60 px-2 py-0.5 hover:bg-amber-700/60">
						{t("editor.reload")}
					</button>
					<button type="button" onClick={buffer.dismissExternal} className="px-1.5 text-amber-300/80">
						{t("files.keepMyChanges")}
					</button>
				</div>
			)}

			{saved === null && !error ? (
				<div className="py-6 text-center text-xs text-[var(--text-40)]">{t("files.loading")}</div>
			) : tab.mode === "edit" ? (
				<div className="min-h-0 flex-1 overflow-hidden [&_.cm-editor]:h-full [&_.cm-editor]:bg-neutral-950 [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-xs">
					<Suspense fallback={<div className="py-6 text-center text-xs text-[var(--text-40)]">{t("files.loadingEditor")}</div>}>
						<FileEditor path={tab.path} value={draft} onChange={setDraft} />
					</Suspense>
				</div>
			) : (
				<div ref={previewRef} className={isHtml ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto px-4 py-3"}>
					{isMarkdown ? (
						<Markdown text={draft} cwd={tab.cwd ?? tab.path.replace(/\/[^/]*$/, "")} />
					) : isHtml ? (
						<iframe
							ref={iframeRef}
							title={basename(tab.path)}
							srcDoc={buildHtmlPreviewDoc(tab.path, draft)}
							sandbox={HTML_PREVIEW_SANDBOX}
							referrerPolicy="no-referrer"
							className="h-full w-full border-0 bg-white"
						/>
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
	const { t } = useT();
	const tabs = useFilePreview((s) => s.tabs);
	const activePath = useFilePreview((s) => s.activePath);
	const active = tabs.find((t) => t.path === activePath) ?? tabs[0] ?? null;

	if (!active) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[var(--text-40)]">
				<FileText size={20} className="text-neutral-500" />
				<div>{t("files.noOpenFile")}</div>
				<div className="text-[11px]">{t("files.clickPathToPreview")}</div>
			</div>
		);
	}

	const kind = previewKind(active.path);
	return (
		<React.Fragment key={active.path}>
			{kind === "image" && !isHtmlPreviewPath(active.path) ? <ImageBody path={active.path} /> : <TextBody tab={active} />}
		</React.Fragment>
	);
}
