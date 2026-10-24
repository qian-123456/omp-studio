import clsx from "clsx";
import {
	ChevronDown,
	ChevronRight,
	Copy,
	FileDiff,
	MessageSquare,
	Play,
	RotateCcw,
	Terminal,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { SearchInput } from "../../components/SearchInput";
import type { GitCommit, GitSummary, TmRun, TurnCheckpoint } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { absoluteTime } from "../../lib/format";
import { gitResetTo, gitWorktreeTurns, tmRun } from "../../lib/ipc";
import { keepIfEqual } from "./useAutoRefresh";
import { isComposing } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { useTurnNav } from "../../stores/turnNav";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";
import { TmRunCard } from "./TmRunCard";
import { promptPreview, shaToTurnMap } from "./turns";

const btn =
	"flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors focus:opacity-100";

const HISTORY_KEY = "omp:tm:custom-command-history";

const COMMIT_CAP = 15;
const COMMIT_STEP = 20;
/** Conventional-commit types rendered as a chip; unknown prefixes stay in the raw subject. */
const KNOWN_TYPES: Record<string, true> = {
	feat: true,
	fix: true,
	refactor: true,
	docs: true,
	test: true,
	chore: true,
	perf: true,
	style: true,
	build: true,
	ci: true,
	revert: true,
};

export type ParsedCommitSubject =
	| { kind: "plain" }
	| { kind: "merge"; source: string }
	| { kind: "conventional"; type: string; scope: string | null; subject: string };

/**
 * Parses a commit subject into a display shape:
 * - conventional commits `type(scope): subject` / `type: subject` (known types only)
 * - git merge messages (`Merge branch 'x' into y`, `Merge pull request #n from a/b`)
 * - anything else renders as the raw subject.
 */
export function parseCommitSubject(subject: string): ParsedCommitSubject {
	let m = /^merge (?:remote(?:-tracking)? )?branch '([^']+)'/i.exec(subject);
	if (m) return { kind: "merge", source: m[1] };
	m = /^merge pull request #\d+ from (\S+)/i.exec(subject);
	if (m) return { kind: "merge", source: m[1] };
	m = /^([a-zA-Z]+)(?:\(([^)]*)\))?!?:[ \t]*(.+)$/.exec(subject);
	if (m && KNOWN_TYPES[m[1].toLowerCase()]) {
		return { kind: "conventional", type: m[1].toLowerCase(), scope: m[2] || null, subject: m[3].trim() };
	}
	return { kind: "plain" };
}


function dayKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(d: Date, now: Date, t: (key: string, params?: Record<string, string | number>) => string): string {
	const todayKey = dayKey(now);
	const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
	const yestKey = dayKey(yest);
	const targetKey = dayKey(d);

	if (targetKey === todayKey) return t("time.today");
	if (targetKey === yestKey) return t("time.yesterday");

	const m = d.getMonth() + 1;
	const day = d.getDate();
	if (d.getFullYear() === now.getFullYear()) {
		return t("git.timeline.dateSameYear", { month: m, day });
	}
	return t("git.timeline.dateDiffYear", { year: d.getFullYear(), month: m, day });
}

interface CommitRowProps {
	c: GitCommit;
	/** The agent turn that produced this commit, if any (turn checkpoints). */
	turn: TurnCheckpoint | undefined;
	/** Highlighted right after a chat → git jump. */
	flash: boolean;
	run: TmRun | undefined;
	/** Below the worktree's fork point — dimmed as inherited history. */
	inherited?: boolean;
	isFirst: boolean;
	isLast: boolean;
	expanded: boolean;
	currentCustom: string;
	customFor: boolean;
	busy: boolean;
	cmdHistory: string[];
	onToggleOpen: () => void;
	onDiff: (sha?: string, title?: string) => void;
	onStart: (sha: string, command?: string) => void;
	onCustomFor: () => void;
	onCustomChange: (v: string) => void;
	onCustomHistoryPick: (cmd: string) => void;
	onReset: (c: GitCommit, mode: "soft" | "hard") => void;
	onCopySha: (sha: string, short: string) => void;
	onRunGone: (id: string) => void;
	onRunUpdate: (run: TmRun) => void;
	onJumpTurn: (turn: TurnCheckpoint) => void;
}

/** One labelled line of the expanded panel: 看看 / 试试 / 回到. */
function ActionLine({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-start gap-2">
			<span className="w-11 shrink-0 whitespace-nowrap pt-[3px] text-[10px] text-neutral-500">{label}</span>
			<div className="flex min-w-0 flex-1 flex-wrap gap-1">{children}</div>
		</div>
	);
}

/** Timeline row: time gutter | rail + dot | subject. Expands into an action panel. */
function CommitRow({
	c,
	turn,
	inherited,
	flash,
	run,
	isFirst,
	isLast,
	expanded,
	currentCustom,
	customFor,
	busy,
	cmdHistory,
	onToggleOpen,
	onDiff,
	onStart,
	onCustomFor,
	onCustomChange,
	onCustomHistoryPick,
	onReset,
	onCopySha,
	onRunGone,
	onRunUpdate,
	onJumpTurn,
}: CommitRowProps) {
	const { t } = useT();
	const sessionTitle = useSessions((s) => (turn ? s.sessions[turn.sessionId]?.title : undefined)) || t("git.timeline.unnamedSession");
	const [resetOpen, setResetOpen] = useState(false);
	const parsed = parseCommitSubject(c.subject);
	const when = absoluteTime(c.ts);
	return (
		<li className="group/item relative" data-commit-sha={c.sha}>
			{/* Rail segment: starts at the first dot and stops at the last one — no dangling ends. */}
			<span
				aria-hidden
				className={clsx(
					"absolute left-[44px] w-px bg-neutral-800",
					isFirst ? "top-[11px]" : "top-0",
					isLast ? "h-[11px]" : "bottom-0",
					isFirst && isLast && "hidden",
				)}
			/>

			<div
				className={clsx(
					"relative flex items-start rounded transition-colors",
					flash
						? "bg-indigo-500/15 ring-1 ring-indigo-500/40"
						: expanded
							? "bg-neutral-800/60"
							: "hover:bg-neutral-800/40",
				)}
				title={t("git.timeline.commitTitle", { subject: c.subject, author: c.author, when, short: c.short })}
			>
				<span className="w-[38px] shrink-0 py-0.5 pl-1 font-mono text-[10px] leading-[18px] tabular-nums text-neutral-500">
					{when.slice(11, 16)}
				</span>
				<span aria-hidden className="relative w-3 shrink-0 self-stretch">
					<span
						className={clsx(
							"absolute left-1/2 top-[8px] h-1.5 w-1.5 -translate-x-1/2 rounded-full transition-colors",
							expanded
								? "bg-indigo-400"
								: run?.pid
									? "bg-emerald-400"
									: "bg-neutral-600 group-hover/item:bg-neutral-400",
						)}
					/>
				</span>
				<button
					type="button"
					onClick={onToggleOpen}
					aria-expanded={expanded}
					className={clsx(
						"min-w-0 flex-1 py-0.5 pl-1 pr-1 text-left",
						inherited && "opacity-55",
					)}
				>
					<span
						className={clsx(
							"break-words text-xs leading-[18px] transition-colors",
							parsed.kind === "merge"
								? "text-neutral-500"
								: expanded
									? "font-medium text-neutral-100"
									: "text-neutral-200",
						)}
					>
						{parsed.kind !== "plain" && (
							<span className="mr-1.5 inline-block rounded bg-neutral-800 px-1 py-px align-[1px] text-[10px] leading-none text-neutral-400">
								{parsed.kind === "merge" ? "merge" : parsed.type}
								{parsed.kind === "conventional" && parsed.scope && (
									<span className="text-neutral-500"> · {parsed.scope}</span>
								)}
							</span>
						)}
						{parsed.kind === "merge"
							? parsed.source
							: parsed.kind === "conventional"
								? parsed.subject
								: c.subject}
					</span>
				</button>

				{/* Quick actions on hover: overlaid so they never take width from the subject. */}
				<div className="absolute right-1 top-0.5 flex items-center gap-0.5 rounded bg-neutral-900/95 px-0.5 opacity-0 shadow-md transition-opacity focus-within:opacity-100 group-hover/item:opacity-100">
					<button
						type="button"
						onClick={() => onDiff(c.sha, `${c.short} ${c.subject}`)}
						title={t("git.timeline.whatChanged")}
						aria-label={t("git.timeline.whatChanged")}
						className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors"
					>
						<FileDiff size={12} />
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => onStart(c.sha)}
						title={t("git.timeline.tmPreviewTitle")}
						aria-label={t("git.timeline.tmPreview")}
						className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-emerald-300 transition-colors"
					>
						<Play size={12} />
					</button>
				</div>
			</div>
			{/* Turn checkpoints: a commit made during an agent turn names the session it came from. */}
			{turn && (
				<div className="ml-[50px] mr-1 flex items-start gap-1 px-1 text-[10px] leading-[18px] text-indigo-400/80">
					<MessageSquare size={10} className="mt-[4px] shrink-0" />
					<span className="min-w-0 break-words">{t("git.timeline.fromSession", { session: sessionTitle })}</span>
				</div>
			)}

			{expanded && (
				<div className="mb-1.5 ml-[50px] mr-1 mt-1 space-y-1.5 rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[11px]">
					<ActionLine label={t("git.timeline.labelOriginal")}>
						<span className="break-words px-1.5 py-0.5 text-neutral-300">{c.subject}</span>
					</ActionLine>
					<ActionLine label={t("git.timeline.labelAuthor")}>
						<span className="break-all px-1.5 py-0.5 text-neutral-300">{c.author}</span>
					</ActionLine>
					<ActionLine label={t("git.timeline.labelTime")}>
						<span className="px-1.5 py-0.5 font-mono tabular-nums text-neutral-300">{when}</span>
					</ActionLine>
					<ActionLine label={t("git.timeline.labelSha")}>
						<button
							type="button"
							onClick={() => onCopySha(c.sha, c.short)}
							title={t("git.timeline.copyFullSha", { sha: c.sha })}
							className={clsx(btn, "font-mono")}
						>
							{c.short}
							<Copy size={11} />
						</button>
					</ActionLine>
					{turn && (
						<>
							<ActionLine label={t("git.timeline.labelSession")}>
								<span className="break-words px-1.5 py-0.5 text-neutral-300">{sessionTitle}</span>
							</ActionLine>
							<ActionLine label={t("git.timeline.labelFromMessage")}>
								<div className="flex min-w-0 flex-1 flex-col items-start gap-1">
									<span className="ml-1.5 break-words border-l-2 border-indigo-500/40 pl-2 text-neutral-300">
										{promptPreview(turn.prompt) || t("git.timeline.emptyMessage")}
									</span>
									<button
										type="button"
										onClick={() => onJumpTurn(turn)}
										title={t("git.timeline.jumpTurnTitle")}
										className={btn}
									>
										<MessageSquare size={11} />
										{t("git.timeline.jumpTurn")}
									</button>
								</div>
							</ActionLine>
						</>
					)}
					<ActionLine label={t("git.timeline.labelSee")}>
						<button
							type="button"
							className={btn}
							onClick={() => onDiff(c.sha, `${c.short} ${c.subject}`)}
						>
							<FileDiff size={12} /> {t("git.timeline.whatChanged")}
						</button>
					</ActionLine>

					<ActionLine label={t("git.timeline.labelTry")}>
						<button
							type="button"
							className={btn}
							disabled={busy}
							onClick={() => onStart(c.sha)}
							title={t("git.timeline.tmPreviewTitle")}
						>
							<Play size={12} /> {busy ? t("git.timeline.startingTm") : t("git.timeline.tmPreview")}
						</button>
						<button type="button" className={btn} onClick={onCustomFor}>
							<Terminal size={12} /> {t("git.timeline.runCustomCmd")}
						</button>
					</ActionLine>

					{customFor && (
						<form
							className="ml-9 flex flex-col gap-1 rounded border border-neutral-800 bg-neutral-950/60 p-1.5"
							onSubmit={(e) => {
								e.preventDefault();
								if (currentCustom.trim()) onStart(c.sha, currentCustom.trim());
							}}
						>
							<div className="flex gap-1">
								<input
									autoFocus
									list={`history-${c.sha}`}
									value={currentCustom}
									onChange={(e) => onCustomChange(e.target.value)}
									onKeyDown={(e) => {
										if (isComposing(e)) return;
										if (e.key === "Enter") {
											e.preventDefault();
											if (currentCustom.trim()) onStart(c.sha, currentCustom.trim());
										}
									}}
									placeholder={t("git.timeline.customCmdPlaceholder")}
									className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-0.5 font-mono text-[11px] text-neutral-200 outline-none focus:border-indigo-500"
								/>
								<datalist id={`history-${c.sha}`}>
									{cmdHistory.map((h) => (
										<option key={h} value={h} />
									))}
								</datalist>
								<button
									type="submit"
									disabled={!currentCustom.trim() || busy}
									className="rounded bg-indigo-600 px-2 text-[11px] text-white hover:bg-indigo-500 disabled:opacity-40"
								>
									{t("git.timeline.run")}
								</button>
							</div>
							{cmdHistory.length > 0 && (
								<div className="flex flex-wrap items-center gap-1 text-[10px] text-neutral-500">
									<span>{t("git.timeline.recentUsed")}</span>
									{cmdHistory.slice(0, 3).map((cmd) => (
										<button
											key={cmd}
											type="button"
											onClick={() => onCustomHistoryPick(cmd)}
											className="rounded bg-neutral-800/80 px-1 py-0.5 font-mono text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
										>
											{cmd}
										</button>
									))}
								</div>
							)}
						</form>
					)}

					<ActionLine label={t("git.timeline.labelRevert")}>
						<button
							type="button"
							className={btn}
							aria-expanded={resetOpen}
							onClick={() => setResetOpen((v) => !v)}
						>
							<RotateCcw size={12} /> {t("git.timeline.revertToThisVersion")}
						</button>
					</ActionLine>

					{resetOpen && (
						<div className="ml-9 space-y-1">
							<button
								type="button"
								onClick={() => onReset(c, "soft")}
								className="block w-full rounded border border-neutral-700 px-2 py-1 text-left transition-colors hover:bg-neutral-800"
							>
								<span className="block text-neutral-200">{t("git.timeline.softResetTitle")}</span>
								<span className="block text-[10px] text-neutral-500">
									{t("git.timeline.softResetDesc")}
								</span>
							</button>
							<button
								type="button"
								onClick={() => onReset(c, "hard")}
								className="block w-full rounded border border-rose-900/60 px-2 py-1 text-left transition-colors hover:bg-rose-950/40"
							>
								<span className="block text-rose-300">{t("git.timeline.hardResetTitle")}</span>
								<span className="block text-[10px] text-rose-400/70">
									{t("git.timeline.hardResetDesc")}
								</span>
							</button>
						</div>
					)}
				</div>
			)}

			{run && (expanded || run.pid) && (
				<div className="mb-1.5 ml-[50px] mr-1 mt-1">
					<TmRunCard run={run} onGone={() => onRunGone(run.id)} onUpdate={onRunUpdate} />
				</div>
			)}
		</li>
	);
}

/** 历史: commit timeline of one worktree, grouped by day, with time-machine runs. */
export function TimelineSection({
	cwd,
	summary,
	commits,
	forkPoint,
	baseBranch,
	runs,
	hasMore,
	loadingMore,
	onLoadMore,
	onDiff,
	onRunsChange,
	onChanged,
}: {
	cwd: string;
	summary: GitSummary;
	commits: GitCommit[];
	/** merge-base of this worktree's HEAD with `baseBranch`; null = none. */
	forkPoint?: string | null;
	baseBranch?: string | null;
	runs: TmRun[];
	hasMore?: boolean;
	loadingMore?: boolean;
	onLoadMore?: () => void;
	onDiff: (sha?: string, title?: string) => void;
	onRunsChange: (runs: TmRun[]) => void;
	onChanged: () => void;
}) {
	const { t } = useT();
	const rootRef = useRef<HTMLDivElement>(null);
	const [open, setOpen] = useState<string | null>(null);
	const [customFor, setCustomFor] = useState<string | null>(null);
	const [customCommands, setCustomCommands] = useState<Record<string, string>>({});
	const [cmdHistory, setCmdHistory] = useState<string[]>(() => {
		try {
			const raw = localStorage.getItem(HISTORY_KEY);
			return raw ? JSON.parse(raw) : ["pnpm dev", "npm run dev", "cargo run"];
		} catch {
			return ["pnpm dev", "npm run dev", "cargo run"];
		}
	});
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [dayLimits, setDayLimits] = useState<Record<string, number>>({});
	const [dayToggles, setDayToggles] = useState<Record<string, boolean>>({});
	/** Turn checkpoints recorded by app-launched sessions in this worktree. */
	const [turns, setTurns] = useState<TurnCheckpoint[]>([]);
	const revealCommit = useTurnNav((s) => s.revealCommit);
	const [flash, setFlash] = useState<string | null>(null);
	const handledReveal = useRef(0);

	// Filter state
	const [filterText, setFilterText] = useState("");

	// Filter commits by message / sha / author
	const filteredCommits = useMemo(() => {
		const query = filterText.trim().toLowerCase();
		return commits.filter((c) => {
			if (query) {
				const matchSubject = c.subject.toLowerCase().includes(query);
				const matchSha = c.sha.toLowerCase().includes(query) || c.short.toLowerCase().includes(query);
				const matchAuthor = c.author.toLowerCase().includes(query);
				if (!matchSubject && !matchSha && !matchAuthor) {
					return false;
				}
			}
			return true;
		});
	}, [commits, filterText]);

	// Fetch turn checkpoints alongside the log: keyed by cwd and the commit shas
	// so polling with unchanged history never refetches.
	const commitsKey = useMemo(() => commits.map((c) => c.sha).join(","), [commits]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: commitsKey summarizes commits
	useEffect(() => {
		let stale = false;
		gitWorktreeTurns(cwd)
			.then((ts) => {
				if (!stale) setTurns((p) => keepIfEqual(p, ts));
			})
			.catch(() => {
				if (!stale) setTurns([]);
			});
		return () => {
			stale = true;
		};
	}, [cwd, commitsKey]);

	const turnBySha = useMemo(() => shaToTurnMap(turns), [turns]);

	// Group filtered commits by calendar day
	const dayGroups = useMemo(() => {
		const map = new Map<string, { date: Date; items: GitCommit[] }>();
		const order: string[] = [];
		for (const c of filteredCommits) {
			const parsed = new Date(c.ts);
			const d = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
			const key = dayKey(d);
			if (!map.has(key)) {
				map.set(key, { date: d, items: [] });
				order.push(key);
			}
			map.get(key)!.items.push(c);
		}
		const now = new Date();
		const todayKey = dayKey(now);
		const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
		const yestKey = dayKey(yest);

		return order.map((key) => {
			const group = map.get(key)!;
			const isToday = key === todayKey;
			const isYest = key === yestKey;
			return {
				key,
				label: formatDayLabel(group.date, now, t),
				date: group.date,
				items: group.items,
				isRecent: isToday || isYest,
			};
		});
	}, [filteredCommits]);

	const hasRecent = useMemo(() => dayGroups.some((g) => g.isRecent), [dayGroups]);
	const isSearching = filterText.trim().length > 0;

	// Commits at or below the fork point are inherited from the base branch —
	// they get a divider above the fork row and a dimmed row style.
	const forkIdx = useMemo(() => {
		if (isSearching || !forkPoint) return -1;
		const i = filteredCommits.findIndex((c) => c.sha === forkPoint);
		return i > 0 ? i : -1;
	}, [filteredCommits, forkPoint, isSearching]);
	const baseLabel = baseBranch?.replace(/^origin\//, "") ?? t("git.timeline.mainline");
	// sha→true for commits inherited from the base (fork point included).
	const inherited = useMemo<Record<string, true>>(
		() =>
			forkIdx >= 0
				? Object.fromEntries(
						filteredCommits.slice(forkIdx).map((c) => [c.sha, true as const]),
					)
				: {},
		[filteredCommits, forkIdx],
	);

	const isGroupOpen = (g: (typeof dayGroups)[number], index: number) => {
		if (dayToggles[g.key] !== undefined) {
			return dayToggles[g.key];
		}
		if (isSearching) {
			return true;
		}
		// Default: today and yesterday expanded, older folded (if no recent commits, default first open)
		return g.isRecent || (!hasRecent && index === 0);
	};

	const toggleDay = (key: string, currentOpen: boolean) =>
		setDayToggles((prev) => ({ ...prev, [key]: !currentOpen }));

	const runFor = (sha: string) => runs.find((r) => r.sha === sha);

	// Chat → git jump: once the target sha is rendered, expand its day group
	// (and the COMMIT_CAP window) and flag it for the flash/scroll effect.
	useEffect(() => {
		if (!revealCommit || revealCommit.cwd !== cwd) return;
		if (revealCommit.nonce <= handledReveal.current) return;
		const commit = commits.find((c) => c.sha === revealCommit.sha);
		if (!commit) return; // keep pending — another log page may load it
		handledReveal.current = revealCommit.nonce;
		const group = dayGroups.find((g) => g.items.some((c) => c.sha === commit.sha));
		if (group) {
			setDayToggles((prev) => ({ ...prev, [group.key]: true }));
			const commitIdx = group.items.findIndex((c) => c.sha === commit.sha);
			if (commitIdx >= COMMIT_CAP) {
				setDayLimits((prev) => ({ ...prev, [group.key]: commitIdx + 1 }));
			}
		}
		setFlash(commit.sha);
		useTurnNav.getState().clearCommit();
	}, [revealCommit, commits, dayGroups, cwd]);

	// After flash renders, scroll the row into view, then fade the highlight.
	useEffect(() => {
		if (!flash) return;
		const el = rootRef.current?.querySelector(`[data-commit-sha="${flash}"]`);
		el?.scrollIntoView({ behavior: "smooth", block: "center" });
		const t = setTimeout(() => setFlash(null), 2600);
		return () => clearTimeout(t);
	}, [flash]);

	// Timeline → chat jump (revealTurn is consumed by the chat side).
	const jumpToTurn = (turn: TurnCheckpoint) => {
		useUi.getState().selectSession(turn.sessionId);
		if (turn.userItemId) {
			useTurnNav.getState().showTurn(turn.sessionId, turn.userItemId);
		}
	};

	const saveHistory = (cmd: string) => {
		const trimmed = cmd.trim();
		if (!trimmed) return;
		setCmdHistory((prev) => {
			const next = [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, 10);
			try {
				localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
			} catch {
				// ignore storage errors
			}
			return next;
		});
	};

	const start = async (sha: string, command?: string) => {
		setBusy(sha);
		setError(null);
		if (command) saveHistory(command);
		try {
			const run = await tmRun(cwd, sha, command);
			onRunsChange([...runs.filter((r) => r.id !== run.id), run]);
			setOpen(sha);
			toast.success(command ? t("git.timeline.startedCustomCmd", { command }) : t("git.timeline.startedTm"));
		} catch (e) {
			setError(errMsg(e));
			toast.error(errMsg(e));
		} finally {
			setBusy(null);
		}
	};

	const reset = async (c: GitCommit, mode: "soft" | "hard") => {
		const dirty = summary.hasUncommitted
			? t("git.timeline.dirtyFilesWarning", { count: summary.files.length })
			: "";
		const ok =
			mode === "soft"
				? await confirmDialog(
						t("git.timeline.softResetConfirm", { short: c.short, subject: c.subject, dirty }),
						{ title: t("git.timeline.revertToThisVersionTitle"), okLabel: t("git.timeline.revertToThisVersionTitle") },
					)
				: await confirmDialog(
						t("git.timeline.hardResetConfirm", { short: c.short, subject: c.subject, dirty }),
						{ danger: true, title: t("git.timeline.hardResetTitle"), okLabel: t("git.timeline.confirmDiscard") },
					);
		if (!ok) return;
		setError(null);
		try {
			await gitResetTo(cwd, c.sha, mode);
			toast.success(
				mode === "soft"
					? t("git.timeline.softResetSuccess", { short: c.short })
					: t("git.timeline.hardResetSuccess", { short: c.short }),
			);
			onChanged();
		} catch (e) {
			setError(errMsg(e));
			toast.error(errMsg(e));
		}
	};

	const copySha = async (sha: string, short: string) => {
		await copyText(sha);
		toast.success(t("git.timeline.copiedSha", { short }));
	};

	return (
		<div ref={rootRef} className="pt-1.5">
			{error && <div className="mb-1 text-[11px] text-rose-400">{error}</div>}

					{/* Filter & Search Bar */}
					{commits.length > 0 && (
						<div className="mb-2 flex items-center gap-1.5">
							<SearchInput
								value={filterText}
								onChange={setFilterText}
								placeholder={t("git.timeline.searchPlaceholder")}
								className="flex-1"
							/>
						</div>
					)}

					{commits.length === 0 && (
						<div className="py-2 text-xs text-neutral-500">{t("git.timeline.noCommits")}</div>
					)}

					{commits.length > 0 && filteredCommits.length === 0 && (
						<div className="py-3 text-center text-xs text-neutral-500">
							<p>{t("git.timeline.noMatchedCommits")}</p>
							{filterText && (
								<button
									type="button"
									onClick={() => setFilterText("")}
									className="mt-1 text-[11px] text-indigo-400 hover:text-indigo-300 underline"
								>
									{t("git.timeline.clearSearch")}
								</button>
							)}
						</div>
					)}

					{dayGroups.map((g, index) => {
						const dayOpen = isGroupOpen(g, index);
						return (
							<div key={g.key} className="mb-2 last:mb-0">
								<button
									type="button"
									onClick={() => toggleDay(g.key, dayOpen)}
									className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-xs text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200 transition-colors group"
								>
									<div className="flex items-center gap-1.5 min-w-0">
										{dayOpen ? (
											<ChevronDown
												size={12}
												className="shrink-0 text-neutral-500 group-hover:text-neutral-300 transition-transform"
											/>
										) : (
											<ChevronRight
												size={12}
												className="shrink-0 text-neutral-500 group-hover:text-neutral-300 transition-transform"
											/>
										)}
										<span
											className={clsx(
												"font-medium tracking-tight",
												g.isRecent ? "text-neutral-200" : "text-neutral-400",
											)}
										>
											{g.label}
										</span>
									</div>
									<span className="font-mono text-[10px] text-neutral-500 rounded bg-neutral-800/60 px-1.5 py-0.5">
										{g.items.length}
									</span>
								</button>
								{dayOpen && (
									<ol className="mt-1 space-y-0.5">
										{(() => {
											const limit = dayLimits[g.key] ?? COMMIT_CAP;
											const shownItems = g.items.slice(0, limit);
											const remaining = g.items.length - shownItems.length;
											return (
												<>
													{shownItems.map((c, i, shown) => {
														const run = runFor(c.sha);
														return (
															<Fragment key={c.sha}>
																{c.sha === forkPoint && (
																	<li aria-hidden className="relative">
																		<span
																			className="absolute bottom-0 left-[44px] top-0 w-px bg-neutral-800"
																		/>
																		<div className="ml-[50px] flex items-center gap-2 py-1 pr-1">
																			<span className="h-px flex-1 border-t border-dashed border-neutral-800" />
																			<span className="shrink-0 font-mono text-[10px] text-neutral-600">
																				{t("git.timeline.inheritedFrom", { base: baseLabel })}
																			</span>
																		</div>
																	</li>
																)}
																<CommitRow
																	inherited={inherited[c.sha] === true}
																	c={c}
																turn={turnBySha.get(c.sha)}
																flash={flash === c.sha}
																run={run}
																isFirst={i === 0}
																isLast={i === shown.length - 1}
																expanded={open === c.sha}
																currentCustom={customCommands[c.sha] ?? ""}
																customFor={customFor === c.sha}
																busy={busy === c.sha}
																cmdHistory={cmdHistory}
																onToggleOpen={() =>
																	setOpen(open === c.sha ? null : c.sha)
																}
																onDiff={onDiff}
																onStart={(sha, cmd) => void start(sha, cmd)}
																onCustomFor={() =>
																	setCustomFor(customFor === c.sha ? null : c.sha)
																}
																onCustomChange={(v) =>
																	setCustomCommands((prev) => ({ ...prev, [c.sha]: v }))
																}
																onCustomHistoryPick={(cmd) =>
																	setCustomCommands((prev) => ({ ...prev, [c.sha]: cmd }))
																}
																onReset={(cc, mode) => void reset(cc, mode)}
																onCopySha={(sha, short) => void copySha(sha, short)}
																onRunGone={(id) =>
																	onRunsChange(runs.filter((r) => r.id !== id))
																}
																onRunUpdate={(next) =>
																	onRunsChange(runs.map((r) => (r.id === next.id ? next : r)))
																}
																onJumpTurn={jumpToTurn}
															/>
																</Fragment>
														);
													})}
													{g.items.length > COMMIT_CAP && (
														<div className="flex items-center justify-center gap-2 py-1 text-[11px] text-neutral-500">
															{remaining > 0 && (
																<button
																	type="button"
																	onClick={() =>
																		setDayLimits((prev) => ({
																			...prev,
																			[g.key]: limit + COMMIT_STEP,
																		}))
																	}
																	className="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors"
																>
																	<ChevronDown size={12} />
																	<span>
																		{t("git.timeline.moreCommits", { remaining, step: Math.min(remaining, COMMIT_STEP) })}
																	</span>
																</button>
															)}
															{limit > COMMIT_CAP && (
																<button
																	type="button"
																	onClick={() =>
																		setDayLimits((prev) => ({
																			...prev,
																			[g.key]: COMMIT_CAP,
																		}))
																	}
																	className="rounded px-2 py-0.5 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors"
																>
																	{t("common.collapse")}
																</button>
															)}
														</div>
													)}
												</>
											);
										})()}
									</ol>
								)}
							</div>
						);
					})}

					{hasMore && (
						<div className="mt-2">
							<button
								type="button"
								disabled={loadingMore}
								onClick={onLoadMore}
								className="w-full rounded border border-neutral-800 bg-neutral-900/60 py-1 text-center text-[11px] text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-50"
							>
								{loadingMore ? t("git.timeline.loadingMoreCommits") : t("git.timeline.loadMoreCommits")}
							</button>
						</div>
			)}
		</div>
	);
}
