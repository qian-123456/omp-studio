import clsx from "clsx";
import { Archive, Loader2, Search } from "lucide-react";
import { absoluteTime, relativeTime } from "../../../lib/format";
import type { SessionMeta, SpaceMode } from "../../../lib/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../../components/Modal";
import { isComposing } from "../../../lib/hooks";
import { isBlankDraft } from "../../../lib/createSession";
import { useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import { sideChatTitle } from "../../sidechat/sideChatTitle";
import { SPACE_MODE_META } from "../modes";
import { useSidebarStore } from "../sidebarStore";
import { HighlightedSnippet } from "./HighlightedSnippet";
import { openSearchRow } from "./openSearchRow";
import { useT } from "../../../stores/language";

const BUCKET_LABEL_KEYS: Record<string, string> = {
	today: "time.today",
	yesterday: "time.yesterday",
	last7Days: "time.past7Days",
	last30Days: "time.past30Days",
	earlier: "time.earlier",
};
import {
	RECENT_LIMIT,
	bucketRecent,
	limitBuckets,
	mergeResults,
	metadataMatches,
	searchableSessions,
	type RecentBucket,
	type SearchRow,
} from "./searchModel";
import { useSearchDialog } from "./searchStore";
import { useContentSearch, useSearchIndexStatus } from "./useContentSearch";

/** Mounts the dialog only while open so its state (query, highlight) resets on every open. */
export function SessionSearchDialog() {
	const open = useSearchDialog((s) => s.open);
	return open ? <SearchDialogBody /> : null;
}

function SearchDialogBody() {
	const { t } = useT();
	const closeDialog = useSearchDialog((s) => s.closeDialog);
	const focusSeq = useSearchDialog((s) => s.focusSeq);
	const sessions = useSessions((s) => s.sessions);
	const workspaces = useSessions((s) => s.workspaces);
	const activeMode = useSidebarStore((s) => s.activeMode);

	const [query, setQuery] = useState("");
	const [includeArchived, setIncludeArchived] = useState(true);
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const q = query.trim();
	const content = useContentSearch(query);
	const indexStatus = useSearchIndexStatus(true);

	// ⌘F (or the 🔍 button) while open re-focuses and selects the input.
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [focusSeq]);

	const listable = useMemo(() => {
		const lives = useLive.getState().sessions;
		return searchableSessions(
			Object.values(sessions).filter((s) => includeArchived || !s.archived),
			(s) => isBlankDraft(s, lives[s.id]),
		);
	}, [sessions, includeArchived]);
	const listableById = useMemo(() => new Map(listable.map((s) => [s.id, s])), [listable]);

	const recent = useMemo(
		() => limitBuckets(bucketRecent(listable), RECENT_LIMIT),
		[listable],
	);

	const rows = useMemo<SearchRow[]>(() => {
		if (!q) return [];
		const meta = metadataMatches(listable, q, workspaces);
		return mergeResults(meta, content.hits, listableById);
	}, [q, listable, workspaces, content.hits, listableById]);

	const recentRows = useMemo<SearchRow[]>(
		() =>
			recent.flatMap((b) =>
				b.sessions.map((session) => ({
					key: session.id,
					session,
					hit: null,
					source: "meta" as const,
				})),
			),
		[recent],
	);

	const nav = q ? rows : recentRows;

	// A new query starts from the top; streamed-in results keep the highlight index.
	useEffect(() => {
		setActive(0);
	}, [q]);
	const activeIdx = nav.length === 0 ? -1 : Math.min(active, nav.length - 1);

	useEffect(() => {
		if (activeIdx < 0) return;
		const el = listRef.current?.querySelector<HTMLElement>(`[data-nav-index="${activeIdx}"]`);
		el?.scrollIntoView?.({ block: "nearest" });
	}, [activeIdx]);

	const activate = useCallback(
		(row: SearchRow | undefined) => {
			if (!row) return;
			closeDialog();
			openSearchRow(row);
		},
		[closeDialog],
	);

	const workspaceNames = useMemo(() => new Map(workspaces.map((w) => [w.id, w.name])), [workspaces]);

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (isComposing(e)) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			if (nav.length === 0) return;
			const step = e.key === "ArrowDown" ? 1 : -1;
			setActive((activeIdx + step + nav.length) % nav.length);
		} else if (e.key === "Enter") {
			e.preventDefault();
			activate(nav[activeIdx]);
		}
	};

	const showEmpty = q.length > 0 && !content.loading && !content.error && rows.length === 0;

	return (
		<Modal
			onClose={closeDialog}
			size="none"
			ariaLabel={t("sessions.searchDialogAria")}
			className="h-[min(560px,85vh)] w-full max-w-xl overflow-hidden"
		>
			<div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-divider)] px-3 py-2.5">
				<Search size={16} strokeWidth={1.5} className="shrink-0 text-neutral-400" />
				<input
					ref={inputRef}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder={t("sidebar.searchSessions")}
					aria-label={t("sessions.searchDialogAria")}
					role="combobox"
					aria-expanded="true"
					aria-controls="session-search-list"
					aria-activedescendant={activeIdx >= 0 ? `session-search-opt-${activeIdx}` : undefined}
					className="min-w-0 flex-1 bg-transparent text-[14px] text-neutral-100 outline-none placeholder:text-neutral-500"
				/>
				{content.loading && (
					<Loader2
						size={14}
						role="status"
						aria-label={t("sessions.searchingAria")}
						className="shrink-0 animate-spin text-neutral-400"
					/>
				)}
				<button
					type="button"
					aria-pressed={includeArchived}
					onClick={() => setIncludeArchived((v) => !v)}
					title={includeArchived ? t("sessions.clickToExcludeArchived") : t("sessions.clickToIncludeArchived")}
					className={clsx(
						"flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[12px] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
						includeArchived ? "text-neutral-300" : "text-neutral-500",
					)}
				>
					<Archive size={13} strokeWidth={1.6} className="shrink-0" />
					{includeArchived ? t("sessions.includedArchived") : t("sessions.excludedArchived")}
				</button>
			</div>

			{indexStatus?.building && (
				<div className="shrink-0 border-b border-[var(--border-divider)] px-3 py-1.5 text-[11px] text-amber-300/90">
					{t("sessions.indexingFullText", { indexed: indexStatus.indexed, total: indexStatus.total })}
				</div>
			)}

			{content.error && (
				<div
					role="alert"
					className="shrink-0 select-text whitespace-pre-wrap break-all border-b border-[var(--border-divider)] px-3 py-2 text-[11px] text-rose-300"
				>
					{t("sessions.contentSearchFailed", { error: content.error })}
				</div>
			)}

			<div
				ref={listRef}
				id="session-search-list"
				role="listbox"
				className="min-h-0 flex-1 overflow-y-auto p-1.5"
			>
				{!q && recent.length > 0 && (
					<RecentList
						buckets={recent}
						activeIdx={activeIdx}
						onHover={setActive}
						onPick={(i) => activate(nav[i])}
						activeMode={activeMode}
						allSessions={sessions}
						workspaceNames={workspaceNames}
					/>
				)}
				{q &&
					rows.map((row, i) => (
						<OptionButton
							key={row.key}
							index={i}
							active={activeIdx === i}
							onHover={setActive}
							onPick={() => activate(nav[i])}
						>
							<SessionRowBody
								row={row}
								activeMode={activeMode}
								allSessions={sessions}
								workspaceNames={workspaceNames}
							/>
						</OptionButton>
					))}
				{showEmpty && (
					<div className="px-3 py-10 text-center text-[13px] text-neutral-500">{t("sessions.noMatchingSessions")}</div>
				)}
			</div>
		</Modal>
	);
}

function OptionButton({
	index,
	active,
	onHover,
	onPick,
	children,
}: {
	index: number;
	active: boolean;
	onHover: (i: number) => void;
	onPick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			id={`session-search-opt-${index}`}
			role="option"
			aria-selected={active}
			tabIndex={-1}
			data-nav-index={index}
			onMouseMove={() => {
				if (!active) onHover(index);
			}}
			onClick={onPick}
			className={clsx(
				"flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none",
				active ? "bg-[var(--bg-active-fill)]" : "hover:bg-[var(--bg-hover)]",
			)}
		>
			{children}
		</button>
	);
}

function RecentList({
	buckets,
	activeIdx,
	onHover,
	onPick,
	activeMode,
	allSessions,
	workspaceNames,
}: {
	buckets: RecentBucket[];
	activeIdx: number;
	onHover: (i: number) => void;
	onPick: (i: number) => void;
	activeMode: SpaceMode;
	allSessions: Record<string, SessionMeta>;
	workspaceNames: ReadonlyMap<string, string>;
}) {
	const { t } = useT();
	let index = 0;
	return (
		<>
			{buckets.map((bucket) => (
				<div key={bucket.key} data-bucket={bucket.key}>
					<div className="px-2.5 pb-1 pt-3 text-[11px] font-medium text-neutral-500">
						{BUCKET_LABEL_KEYS[bucket.key] ? t(BUCKET_LABEL_KEYS[bucket.key]) : bucket.label}
					</div>
					{bucket.sessions.map((session) => {
						const i = index++;
						const row: SearchRow = { key: session.id, session, hit: null, source: "meta" };
						return (
							<OptionButton
								key={session.id}
								index={i}
								active={activeIdx === i}
								onHover={onHover}
								onPick={() => onPick(i)}
							>
								<SessionRowBody
									row={row}
									activeMode={activeMode}
									allSessions={allSessions}
									workspaceNames={workspaceNames}
								/>
							</OptionButton>
						);
					})}
				</div>
			))}
		</>
	);
}

function SessionRowBody({
	row,
	activeMode,
	allSessions,
	workspaceNames,
}: {
	row: SearchRow;
	activeMode: SpaceMode;
	allSessions: Record<string, SessionMeta>;
	workspaceNames: ReadonlyMap<string, string>;
}) {
	const { t } = useT();
	const { session, hit } = row;
	const title =
		session.title?.trim() ||
		(session.kind === "side" ? sideChatTitle(session.id, allSessions) : null) ||
		session.label ||
		t("sessions.untitledSession");
	const wsName = session.workspaceId ? workspaceNames.get(session.workspaceId) : undefined;
	const place = [wsName, session.git?.branch].filter(Boolean).join(" · ");
	return (
		<div className="flex min-w-0 flex-1 flex-col gap-0.5">
			<div className="flex items-start gap-1.5">
				<span className="min-w-0 flex-1 break-words text-[13px] font-medium text-neutral-100">
					{title}
				</span>
				{session.archived && (
					<span className="shrink-0 whitespace-nowrap rounded bg-neutral-500/20 px-1.5 text-[10px] leading-4 text-neutral-300">
						{t("sessionActions.archived")}
					</span>
				)}
				{session.mode !== activeMode && (
					<span className="shrink-0 whitespace-nowrap rounded bg-indigo-500/15 px-1.5 text-[10px] leading-4 text-indigo-300">
						{SPACE_MODE_META[session.mode].label}
					</span>
				)}
				<span
					className="shrink-0 whitespace-nowrap text-[11px] leading-5 text-neutral-500"
					title={absoluteTime(session.updatedAt || session.createdAt)}
				>
					{relativeTime(session.updatedAt || session.createdAt)}
				</span>
			</div>
			{place && (
				<div className="break-all text-[11px] leading-4 text-neutral-500" data-session-place>
					{place}
				</div>
			)}
			{hit && (
				<div className="flex items-start gap-1.5 text-[12px] leading-5 text-neutral-400">
					<span className="shrink-0 whitespace-nowrap text-neutral-500">
						{hit.role === "user" ? t("sessions.roleYou") : t("sessions.roleAssistant")}
					</span>
					<HighlightedSnippet
						segments={hit.segments}
						truncatedStart={hit.truncatedStart}
						truncatedEnd={hit.truncatedEnd}
					/>
				</div>
			)}
		</div>
	);
}
