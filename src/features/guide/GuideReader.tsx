/** In-app 使用说明: renders docs/guide/{zh,en}/*.md with the same markdown
 * stack as chat (react-markdown + remark-gfm + remark-cjk-friendly), plus
 * heading ids, callouts, chapter-to-chapter links and image placeholders. */

import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Clock,
	List,
	Search,
	X,
} from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkGfm from "remark-gfm";
import { CopyButton } from "../../components/CopyButton";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { HIGHLIGHT_LANGUAGES } from "../chat/markdownAssets";
import { SectionHeader } from "../settings/ui";
import {
	GUIDE_LANGS,
	GUIDE_LANG_STORAGE_KEY,
	type CalloutKind,
	type GuideLang,
	estimateReadingStats,
	extractHeadings,
	extractTitle,
	guideImageName,
	parseChapterPath,
	remarkCallouts,
	remarkHeadingIds,
	resolveGuideLink,
	searchGuideChapters,
} from "./guideContent";

const CHAPTER_LOADERS = import.meta.glob<string>("../../../docs/guide/{zh,en}/*.md", {
	query: "?raw",
	import: "default",
	eager: false,
});

/** Screenshot urls by file name; empty until humans add images, then placeholders show. */
const IMAGE_URLS: Record<string, string> = Object.fromEntries(
	Object.entries(
		import.meta.glob<string>("../../../docs/guide/images/*.{png,jpg,jpeg,gif,webp,svg}", {
			query: "?url",
			import: "default",
			eager: true,
		}),
	).map(([path, url]) => [path.slice(path.lastIndexOf("/") + 1), url]),
);

interface Chapter {
	slug: string;
	title: string;
	markdown: string;
}

const LANG_LABEL: Record<GuideLang, string> = { zh: "中文", en: "English" };

function readStoredLang(): GuideLang {
	try {
		const v = localStorage.getItem(GUIDE_LANG_STORAGE_KEY);
		return v === "en" || v === "zh" ? v : "zh";
	} catch {
		return "zh";
	}
}

async function loadChapters(lang: GuideLang): Promise<Chapter[]> {
	const entries = Object.entries(CHAPTER_LOADERS)
		.map(([path, load]) => ({ info: parseChapterPath(path), load }))
		.filter((e) => e.info?.lang === lang)
		.sort((a, b) => (a.info?.slug ?? "").localeCompare(b.info?.slug ?? ""));
	return Promise.all(
		entries.map(async ({ info, load }) => {
			const slug = info?.slug ?? "";
			const markdown = await load();
			return { slug, title: extractTitle(markdown, slug), markdown };
		}),
	);
}

const CALLOUT_STYLE: Record<CalloutKind, { label: string; box: string }> = {
	note: { label: "提示", box: "border-sky-400/60 bg-sky-400/10" },
	tip: { label: "技巧", box: "border-emerald-400/60 bg-emerald-400/10" },
	warning: { label: "注意", box: "border-amber-400/70 bg-amber-400/10" },
};

function isCalloutKind(v: unknown): v is CalloutKind {
	return v === "note" || v === "tip" || v === "warning";
}

function GuideImage({ src, alt }: { src?: string; alt?: string }) {
	const name = guideImageName(src);
	const url = name ? IMAGE_URLS[name] : undefined;
	const [failed, setFailed] = useState(false);
	if (!url || failed) {
		return (
			<span className="my-3 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-[var(--line)] px-4 py-6 text-center text-xs text-[var(--text-60)]">
				{alt || "截图"}
			</span>
		);
	}
	return (
		<img
			src={url}
			alt={alt}
			loading="lazy"
			onError={() => setFailed(true)}
			className="my-3 block max-w-full rounded-lg border border-[var(--line)]"
		/>
	);
}
function CodeBlock({ children }: { children?: React.ReactNode }) {
	const textRef = useRef<HTMLPreElement>(null);
	return (
		<div className="group relative my-3">
			<pre
				ref={textRef}
				className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--well-bg)] p-3 text-[length:var(--chat-code-font-size)]"
			>
				{children}
			</pre>
			<CopyButton
				text={() => textRef.current?.innerText ?? ""}
				size={14}
				title="复制代码"
				resetMs={2000}
				className="absolute right-2 top-2 rounded border border-[var(--line)] bg-[var(--well-bg)] px-1.5 py-0.5 text-xs text-[var(--text-60)] opacity-0 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] group-hover:opacity-100"
			/>
		</div>
	);
}


const REMARK_PLUGINS: NonNullable<React.ComponentProps<typeof ReactMarkdown>["remarkPlugins"]> = [
	remarkGfm,
	remarkCjkFriendly,
	remarkHeadingIds,
	remarkCallouts,
];
const REHYPE_PLUGINS: NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]> = [
	[rehypeHighlight, { detect: false, languages: HIGHLIGHT_LANGUAGES }],
];

function LangToggle({ lang, onChange }: { lang: GuideLang; onChange: (l: GuideLang) => void }) {
	return (
		<div
			role="group"
			aria-label="语言"
			className="inline-flex shrink-0 gap-0.5 rounded-full border border-[var(--line)] bg-[var(--well-bg)] p-0.5"
		>
			{GUIDE_LANGS.map((l) => (
				<button
					key={l}
					type="button"
					aria-pressed={lang === l}
					onClick={() => onChange(l)}
					className={clsx(
						"rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
						lang === l
							? "bg-[var(--bg-active-fill)] font-semibold text-[var(--text)] shadow-xs"
							: "text-[var(--text-60)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
					)}
				>
					{LANG_LABEL[l]}
				</button>
			))}
		</div>
	);
}

export function GuideReader() {
	const [lang, setLang] = useState<GuideLang>(readStoredLang);
	const [chapters, setChapters] = useState<Chapter[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [activeSlug, setActiveSlug] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	/** Anchor to scroll to once the target chapter has rendered (null = top). */
	const pendingAnchor = useRef<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setChapters(null);
		setLoadError(null);
		loadChapters(lang).then(
			(list) => {
				if (!cancelled) setChapters(list);
			},
			(err) => {
				if (!cancelled) {
					setChapters([]);
					setLoadError(errMsg(err));
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [lang]);

	const active = useMemo(
		() => chapters?.find((c) => c.slug === activeSlug) ?? chapters?.[0] ?? null,
		[chapters, activeSlug],
	);

	const scrollToAnchor = useCallback((anchor: string | null) => {
		const root = rootRef.current;
		if (!root) return;
		if (!anchor) {
			root.scrollIntoView({ block: "start" });
			return;
		}
		for (const el of root.querySelectorAll<HTMLElement>("[id]")) {
			if (el.id === anchor) {
				el.scrollIntoView({ block: "start" });
				return;
			}
		}
	}, []);

	// After a chapter switch apply the pending anchor / reset to top. The first
	// activation (opening the page) keeps the scroll position untouched.
	const activeKey = active?.slug ?? null;
	const activated = useRef(false);
	useEffect(() => {
		if (activeKey === null) return;
		const anchor = pendingAnchor.current;
		pendingAnchor.current = null;
		if (!activated.current) {
			activated.current = true;
			if (!anchor) return;
		}
		scrollToAnchor(anchor);
	}, [activeKey, lang, scrollToAnchor]);

	const openChapter = useCallback((slug: string, anchor: string | null) => {
		pendingAnchor.current = anchor;
		setActiveSlug(slug);
		// Same chapter: the effect above will not fire, so scroll right away.
		if (slug === activeKey) {
			pendingAnchor.current = null;
			scrollToAnchor(anchor);
		}
	}, [activeKey, scrollToAnchor]);

	const changeLang = (next: GuideLang) => {
		if (next === lang) return;
		try {
			localStorage.setItem(GUIDE_LANG_STORAGE_KEY, next);
		} catch {
			/* storage unavailable: the choice just won't persist */
		}
		pendingAnchor.current = null;
		setLang(next);
	};

	const components = useMemo(
		() => ({
			a({ href, children, title }: { href?: string; children?: React.ReactNode; title?: string }) {
				const link = resolveGuideLink(href);
				if (link.kind === "none") return <span>{children}</span>;
				const onClick = (e: React.MouseEvent) => {
					e.preventDefault();
					if (link.kind === "anchor") scrollToAnchor(link.anchor);
					else if (link.kind === "chapter") openChapter(link.slug, link.anchor);
					else openUrl(link.url).catch((err) => toast.error(`打开链接失败: ${errMsg(err)}`));
				};
				return (
					<a
						href={href}
						title={title}
						onClick={onClick}
						className="cursor-pointer text-[var(--accent)] underline decoration-[var(--accent)]/50 underline-offset-2 hover:decoration-[var(--accent)]"
					>
						{children}
					</a>
				);
			},
			img: GuideImage,
			blockquote({
				children,
				"data-callout": callout,
			}: {
				children?: React.ReactNode;
				"data-callout"?: string;
			}) {
				if (!isCalloutKind(callout)) return <blockquote>{children}</blockquote>;
				const style = CALLOUT_STYLE[callout];
				return (
					<div
						role="note"
						className={clsx("my-3 rounded-lg border-l-2 px-3.5 py-2.5", style.box)}
					>
						<div className="text-xs font-semibold text-[var(--text)]">{style.label}</div>
						<div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
					</div>
				);
			},
			table({ children }: { children?: React.ReactNode }) {
				return (
					<div className="my-3 overflow-x-auto">
						<table>{children}</table>
					</div>
				);
			},
			pre: CodeBlock,
		}),
		[openChapter, scrollToAnchor],
	);

	const [searchQuery, setSearchQuery] = useState("");
	const [tocOpenMobile, setTocOpenMobile] = useState(false);

	const searchResults = useMemo(() => {
		if (!chapters || !searchQuery.trim()) return [];
		return searchGuideChapters(chapters, searchQuery);
	}, [chapters, searchQuery]);

	const headings = useMemo(() => {
		if (!active?.markdown) return [];
		return extractHeadings(active.markdown);
	}, [active]);

	const readingStats = useMemo(() => {
		if (!active?.markdown) return { words: 0, minutes: 1 };
		return estimateReadingStats(active.markdown);
	}, [active]);

	const currentIndex = useMemo(() => {
		if (!chapters || !active) return -1;
		return chapters.findIndex((c) => c.slug === active.slug);
	}, [chapters, active]);

	const prevChapter = currentIndex > 0 && chapters ? chapters[currentIndex - 1] : null;
	const nextChapter =
		currentIndex >= 0 && chapters && currentIndex < chapters.length - 1
			? chapters[currentIndex + 1]
			: null;


	return (
		<div ref={rootRef} className="space-y-5 text-[var(--text)]">
			<SectionHeader
				title={lang === "zh" ? "使用教程" : "User Guide"}
				description={
					lang === "zh"
						? "功能详解、操作指南与进阶技巧，支持按章节阅读与全文搜索"
						: "Feature guides, walk-throughs and best practices"
				}
				actions={<LangToggle lang={lang} onChange={changeLang} />}
			/>

			{/* 搜索栏与章节导航 */}
			<div className="space-y-3">
				<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
					<div className="relative w-full sm:max-w-xs">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-60)]" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder={lang === "zh" ? "在教程中全文搜索…" : "Search in guide…"}
							className="w-full rounded-md border border-[var(--line)] bg-[var(--well-bg)] py-1.5 pl-8 pr-7 text-xs text-[var(--text)] placeholder-[var(--text-60)] focus:border-[var(--border-active)] focus:outline-none"
						/>
						{searchQuery && (
							<button
								type="button"
								onClick={() => setSearchQuery("")}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-60)] hover:text-[var(--text)]"
								aria-label={lang === "zh" ? "清空搜索" : "Clear search"}
							>
								<X className="size-3.5" />
							</button>
						)}
					</div>
					{active && (
						<div className="flex items-center gap-3 text-xs text-[var(--text-60)]">
							<span className="flex items-center gap-1">
								<Clock className="size-3.5" />
								{lang === "zh"
									? `约 ${readingStats.minutes} 分钟阅读 (${readingStats.words} 字)`
									: `~${readingStats.minutes} min read (${readingStats.words} words)`}
							</span>
							{headings.length > 0 && (
								<button
									type="button"
									onClick={() => setTocOpenMobile((v) => !v)}
									className="flex items-center gap-1 rounded border border-[var(--line)] bg-[var(--well-bg)] px-2 py-0.5 text-xs text-[var(--text)] hover:bg-[var(--bg-hover)] xl:hidden"
								>
									<List className="size-3.5" />
									{lang === "zh" ? "本章目录" : "Contents"}
								</button>
							)}
						</div>
					)}
				</div>

				{/* 搜索结果面板 */}
				{searchQuery.trim() && (
					<div className="rounded-lg border border-[var(--line)] bg-[var(--well-bg)] p-3 text-xs shadow-xs">
						<div className="mb-2 font-medium text-[var(--text-60)]">
							{searchResults.length > 0
								? lang === "zh"
									? `找到 ${searchResults.length} 条相关内容（点击直达）：`
									: `Found ${searchResults.length} match(es):`
								: lang === "zh"
									? "未找到匹配内容，请尝试其他关键词"
									: "No matches found"}
						</div>
						{searchResults.length > 0 && (
							<ul className="max-h-60 space-y-1.5 overflow-y-auto">
								{searchResults.map((item, idx) => (
									<li key={idx}>
										<button
											type="button"
											onClick={() => {
												openChapter(item.slug, item.headingId ?? null);
												setSearchQuery("");
											}}
											className="flex w-full flex-col items-start rounded p-1.5 text-left transition hover:bg-[var(--bg-hover)]"
										>
											<span className="font-semibold text-[var(--accent)]">
												{item.chapterTitle}
											</span>
											<span className="text-[var(--text)] line-clamp-1">
												{item.matchText}
											</span>
										</button>
									</li>
								))}
							</ul>
						)}
					</div>
				)}

				{/* 章节导航胶囊 */}
				<nav aria-label={lang === "zh" ? "使用教程目录" : "User guide chapters"} className="flex flex-wrap gap-1.5">
					{(chapters ?? []).map((c, i) => (
						<button
							key={c.slug}
							type="button"
							aria-current={c.slug === active?.slug ? "page" : undefined}
							onClick={() => openChapter(c.slug, null)}
							className={clsx(
								"flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
								c.slug === active?.slug
									? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] font-semibold text-[var(--text)]"
									: "border-[var(--line)] text-[var(--text-60)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
							)}
						>
							<span className="opacity-60">{String(i + 1).padStart(2, "0")}</span>
							<span>{c.title}</span>
						</button>
					))}
				</nav>
			</div>

			{/* 移动端/折叠目录 */}
			{tocOpenMobile && headings.length > 0 && (
				<div className="rounded-lg border border-[var(--line)] bg-[var(--well-bg)] p-3 text-xs xl:hidden">
					<div className="mb-2 font-semibold text-[var(--text)]">
						{lang === "zh" ? "本章目录" : "Table of Contents"}
					</div>
					<ul className="space-y-1.5">
						{headings.map((h, i) => (
							<li key={i} style={{ paddingLeft: `${(h.level - 2) * 12}px` }}>
								<button
									type="button"
									onClick={() => {
										scrollToAnchor(h.id);
										setTocOpenMobile(false);
									}}
									className="text-left text-[var(--text-60)] hover:text-[var(--accent)] hover:underline"
								>
									{h.text}
								</button>
							</li>
						))}
					</ul>
				</div>
			)}

			{/* 正文区域与大纲侧栏 */}
			<div className="select-text">
				{chapters === null ? (
					<p className="text-sm text-[var(--text-60)]">加载中</p>
				) : active ? (
					<div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_220px]">
						<div className="min-w-0">
							<article
								data-md-root
								className={clsx(
									"min-w-0 text-sm leading-7 text-[var(--text)] [overflow-wrap:anywhere]",
									"[&>*:first-child]:mt-0",
									"[&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold",
									"[&_h2]:mb-2 [&_h2]:mt-8 [&_h2]:border-b [&_h2]:border-[var(--line)] [&_h2]:pb-1.5 [&_h2]:text-lg [&_h2]:font-semibold",
									"[&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold",
									"[&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:text-sm [&_h4]:font-semibold",
									"[&_p]:my-2.5 [&_strong]:font-semibold",
									"[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1",
									"[&_table]:w-full [&_table]:border-collapse [&_table]:text-[0.92em] [&_table]:[overflow-wrap:normal]",
									"[&_th]:border [&_th]:border-[var(--line)] [&_th]:bg-[var(--ghost-hover)] [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold",
									"[&_td]:border [&_td]:border-[var(--line)] [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_td]:text-[var(--text-60)]",
									"[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--line)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-60)]",
									"[&_hr]:my-6 [&_hr]:border-[var(--line)]",
									"[&_code]:rounded [&_code]:bg-[var(--well-bg)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
									"[&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0",
								)}
							>
								<ReactMarkdown
									remarkPlugins={REMARK_PLUGINS}
									rehypePlugins={REHYPE_PLUGINS}
									components={components}
								>
									{active.markdown}
								</ReactMarkdown>
							</article>

							{/* 上一章 / 下一章 导航卡片 */}
							<div className="mt-12 flex flex-col gap-3 border-t border-[var(--line)] pt-6 sm:flex-row sm:items-center sm:justify-between">
								{prevChapter ? (
									<button
										type="button"
										onClick={() => openChapter(prevChapter.slug, null)}
										className="flex items-center gap-2.5 rounded-lg border border-[var(--line)] p-3 text-left transition hover:border-[var(--border-active)] hover:bg-[var(--bg-hover)]"
									>
										<ChevronLeft className="size-4 shrink-0 text-[var(--text-60)]" />
										<div>
											<div className="text-[11px] text-[var(--text-60)]">
												{lang === "zh" ? "上一章" : "Previous Chapter"}
											</div>
											<div className="text-xs font-medium text-[var(--text)] line-clamp-1">
												{prevChapter.title}
											</div>
										</div>
									</button>
								) : (
									<div />
								)}
								{nextChapter ? (
									<button
										type="button"
										onClick={() => openChapter(nextChapter.slug, null)}
										className="flex items-center justify-end gap-2.5 rounded-lg border border-[var(--line)] p-3 text-right transition hover:border-[var(--border-active)] hover:bg-[var(--bg-hover)] sm:ml-auto"
									>
										<div>
											<div className="text-[11px] text-[var(--text-60)]">
												{lang === "zh" ? "下一章" : "Next Chapter"}
											</div>
											<div className="text-xs font-medium text-[var(--text)] line-clamp-1">
												{nextChapter.title}
											</div>
										</div>
										<ChevronRight className="size-4 shrink-0 text-[var(--text-60)]" />
									</button>
								) : null}
							</div>
						</div>

						{/* 桌面端大纲侧栏 */}
						{headings.length > 0 && (
							<aside className="hidden xl:block">
								<div className="sticky top-6 rounded-lg border border-[var(--line)] bg-[var(--well-bg)] p-3.5 text-xs">
									<div className="mb-2.5 flex items-center gap-1.5 font-semibold text-[var(--text)]">
										<BookOpen className="size-3.5 text-[var(--accent)]" />
										<span>{lang === "zh" ? "本章目录" : "Table of Contents"}</span>
									</div>
									<ul className="max-h-[calc(100vh-220px)] space-y-2 overflow-y-auto pr-1">
										{headings.map((h, i) => (
											<li key={i} style={{ paddingLeft: `${(h.level - 2) * 10}px` }}>
												<button
													type="button"
													onClick={() => scrollToAnchor(h.id)}
													className="w-full text-left text-[var(--text-60)] transition hover:text-[var(--accent)] hover:underline line-clamp-2"
												>
													{h.text}
												</button>
											</li>
										))}
									</ul>
								</div>
							</aside>
						)}
					</div>
				) : (
					<p className="text-sm text-[var(--text-60)]">
						{loadError ? `加载失败: ${loadError}` : "暂无内容"}
					</p>
				)}
			</div>
		</div>
	);
}
