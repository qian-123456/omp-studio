/** [B] Right-panel "计划" tab: review surface for the bundled plan extension.
 * Shows the plan file the model wrote while in plan mode (state arrives as the
 * extension's setStatus frames, see plan/planStatus.ts), with a contents list,
 * a diff against the previous version, selection annotations (the shared
 * annotation system, quoting the plan file) and the approval dock: run mode
 * (fresh / compacted / kept context), execution model role, save-and-exit. */

import clsx from "clsx";
import { Check, ChevronDown, NotebookPen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { Markdown } from "../../components/Markdown";
import { copyText, errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useT } from "../../stores/language";
import { useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import { approvePlan, runPlanAction } from "./plan/planActions";
import {
	diffPlanLines,
	effectiveExecMode,
	type PlanExecMode,
	type PlanStatus,
	planBody,
	planSections,
} from "./plan/planStatus";
import { SelectionToolbar } from "./SelectionToolbar";

/** Widest the right panel goes (same clamp as the splitter). */
const WIDE_WIDTH = 720;
const EXEC_MODES: PlanExecMode[] = ["execute", "compact", "keep"];

/** Plan version the user has already looked at, per session (revision banner). */
const seenVersion = new Map<string, number>();

export function PlanPanel() {
	const sessionId = useUi((s) => s.selectedSessionId);
	const { t } = useT();
	const plan = useLive((s) => (sessionId ? s.sessions[sessionId]?.plan : undefined));
	const streaming = useLive((s) => (sessionId ? s.sessions[sessionId]?.streaming === true : false));
	const alive = useLive((s) => (sessionId ? s.sessions[sessionId]?.alive === true : false));

	// A panel opened after the extension last published (window reload) asks for a fresh state.
	const hasPlan = plan !== undefined;
	useEffect(() => {
		if (sessionId && alive && !hasPlan && !streaming) void runPlanAction(sessionId, "status").catch(() => {});
	}, [sessionId, alive, hasPlan, streaming]);

	if (!sessionId) return <EmptyHint text={t("chatView.plan.emptyNoSession")} />;
	if (!plan?.enabled) return <NotEnabled sessionId={sessionId} />;
	if (!plan.content) {
		return (
			<EmptyHint text={streaming ? t("chatView.plan.planning") : t("chatView.plan.waitingTask")}>
				{plan.planModel && (
					<span className="text-[11px] text-[var(--text-30)]">{t("chatView.plan.planModel", { model: plan.planModel })}</span>
				)}
			</EmptyHint>
		);
	}
	return <PlanReview key={sessionId} sessionId={sessionId} plan={plan} streaming={streaming} />;
}

function NotEnabled({ sessionId }: { sessionId: string }) {
	const { t } = useT();
	const enable = () => {
		runPlanAction(sessionId, "enable").catch((err) => toast.error(t("chatView.plan.enableFailed", { error: errMsg(err) })));
	};
	return (
		<EmptyHint text={t("chatView.plan.emptyNotEnabled")}>
			<button
				type="button"
				onClick={enable}
				className="whitespace-nowrap rounded-full border border-[var(--border-divider)] px-3 py-1 text-[12px] text-[var(--text)] transition-colors hover:bg-[var(--ghost-hover)]"
			>
				{t("chatView.plan.enable")}
			</button>
		</EmptyHint>
	);
}

function PlanReview({ sessionId, plan, streaming }: { sessionId: string; plan: PlanStatus; streaming: boolean }) {
	const { t } = useT();
	const content = plan.content ?? "";
	const body = useMemo(() => planBody(content), [content]);
	const sections = useMemo(() => planSections(content), [content]);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [showDiff, setShowDiff] = useState(false);
	const [curSection, setCurSection] = useState(0);
	const [seen, setSeen] = useState(() => seenVersion.get(sessionId) ?? (plan.prevContent === null ? plan.version : plan.version - 1));
	const revised = plan.prevContent !== null && plan.version > seen;
	const revising = streaming;

	const markSeen = useCallback(() => {
		seenVersion.set(sessionId, plan.version);
		setSeen(plan.version);
	}, [sessionId, plan.version]);
	// The first version needs no "updated" banner.
	useEffect(() => {
		if (plan.prevContent === null) markSeen();
	}, [plan.prevContent, markSeen]);
	// A new version replaces the diff view with the fresh text.
	useEffect(() => setShowDiff(false), [plan.version]);

	const planUrl = plan.planUrl ?? plan.planFile ?? "";
	const annotations = useComposer((s) => s.annotations[sessionId]);
	const pendingBySection = useMemo(() => {
		const list = (annotations ?? []).filter((a) => a.source === "doc" && a.file === planUrl);
		return { total: list.length, list };
	}, [annotations, planUrl]);

	// Scroll spy over the rendered `##` headings.
	const headings = () => Array.from(scrollRef.current?.querySelectorAll<HTMLElement>("[data-plan-body] h2") ?? []);
	useEffect(() => {
		const el = scrollRef.current;
		if (!el || showDiff) return;
		const onScroll = () => {
			const top = el.getBoundingClientRect().top + 40;
			let cur = 0;
			headings().forEach((h, i) => {
				if (h.getBoundingClientRect().top <= top) cur = i;
			});
			setCurSection(cur);
		};
		onScroll();
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [showDiff, body]);
	const jump = (i: number) => {
		const h = headings()[i];
		const el = scrollRef.current;
		if (!h || !el) return;
		el.scrollTo({ top: h.offsetTop - 8, behavior: "smooth" });
	};
	const sectionNotes = (i: number) =>
		pendingBySection.list.filter((a) => sectionOf(content, a.text, sections) === i).length;

	// 放大: remember the width to go back to.
	const rightWidth = useUi((s) => s.rightWidth);
	const [restoreWidth, setRestoreWidth] = useState<number | null>(null);
	const wide = restoreWidth !== null && rightWidth === WIDE_WIDTH;
	const toggleWide = () => {
		const ui = useUi.getState();
		if (wide) {
			ui.setRightWidth(restoreWidth ?? ui.rightWidth);
			setRestoreWidth(null);
		} else {
			setRestoreWidth(ui.rightWidth);
			ui.setRightWidth(WIDE_WIDTH);
		}
	};

	const copy = () => {
		copyText(content).then(
			() => toast.success(t("chatView.plan.copied")),
			(err) => toast.error(t("chatView.plan.actionFailed", { error: errMsg(err) })),
		);
	};

	return (
		<div className="@container relative flex h-full flex-col">
			<div className="shrink-0 border-b border-[var(--border-divider)] px-4 pt-3 pb-2.5">
				<div className="flex items-start gap-2">
					<h1 className="min-w-0 flex-1 text-[15px] leading-[1.45] font-semibold break-words text-[var(--text)]">
						{plan.title}
					</h1>
					{plan.prevContent !== null && !revising && (
						<HeadButton
							on={showDiff}
							title={t("chatView.plan.diffTitle")}
							onClick={() => {
								setShowDiff((v) => !v);
								markSeen();
							}}
						>
							{showDiff ? t("chatView.plan.fullText") : t("chatView.plan.diff")}
						</HeadButton>
					)}
					<HeadButton
						on={wide}
						title={wide ? t("chatView.plan.narrowTitle") : t("chatView.plan.widenTitle")}
						onClick={toggleWide}
					>
						{wide ? t("chatView.plan.narrow") : t("chatView.plan.widen")}
					</HeadButton>
					<HeadButton title={t("chatView.plan.copyTitle")} onClick={copy}>
						{t("chatView.plan.copy")}
					</HeadButton>
				</div>
				{showDiff && plan.prevContent !== null ? (
					<DiffSummary before={plan.prevContent} after={content} version={plan.version} />
				) : (
					sections.length > 0 && (
						<div className="mt-2 @min-[640px]:hidden">
							<TocPill sections={sections} current={curSection} notes={sectionNotes} onJump={jump} />
						</div>
					)
				)}
			</div>
			{revising ? (
				<Banner tone="warn" spin>
					{t("chatView.plan.revising")}
				</Banner>
			) : (
				revised &&
				!showDiff && <Banner tone="info">{t("chatView.plan.revised", { version: plan.version })}</Banner>
			)}
			<div className="flex min-h-0 flex-1">
				{sections.length > 0 && !showDiff && (
					<nav
						aria-label={t("chatView.plan.toc")}
						className="hidden w-[200px] shrink-0 flex-col gap-px overflow-y-auto border-r border-[var(--border-divider)] px-2.5 py-3.5 @min-[640px]:flex"
					>
						<div className="mx-2 mb-2 text-[11px] text-[var(--text-30)]">{t("chatView.plan.toc")}</div>
						<TocList sections={sections} current={curSection} notes={sectionNotes} onJump={jump} />
					</nav>
				)}
				<div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto px-6 pt-1 pb-24">
					{showDiff && plan.prevContent !== null ? (
						<DiffView before={plan.prevContent} after={content} />
					) : (
						<div data-plan-body className={clsx("py-3", revising && "opacity-70")}>
							<Markdown text={body} sessionId={sessionId} />
						</div>
					)}
				</div>
			</div>
			{!showDiff && !revising && (
				<SelectionToolbar sessionId={sessionId} containerRef={scrollRef} compact docFile={planUrl} />
			)}
			<ApprovalDock
				sessionId={sessionId}
				plan={plan}
				disabled={revising}
				pending={pendingBySection.total}
			/>
		</div>
	);
}

/** Section index a quoted text falls into (by its first occurrence in the plan). */
function sectionOf(content: string, quote: string, sections: string[]): number {
	const at = content.indexOf(quote.split("\n")[0] ?? quote);
	if (at < 0) return -1;
	return Math.min(planSections(content.slice(0, at)).length, sections.length) - 1;
}

function HeadButton({
	on = false,
	title,
	onClick,
	children,
}: {
	on?: boolean;
	title: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			onClick={onClick}
			className={clsx(
				"shrink-0 whitespace-nowrap rounded-[7px] border px-2.5 py-0.5 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)]",
				on
					? "border-[var(--accent)]/40 bg-[var(--accent)]/15 text-[var(--accent)]"
					: "border-[var(--border-divider)] text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]",
			)}
		>
			{children}
		</button>
	);
}

function Banner({ tone, spin = false, children }: { tone: "warn" | "info"; spin?: boolean; children: React.ReactNode }) {
	return (
		<div
			className={clsx(
				"mx-3.5 mt-2.5 flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px] break-words",
				tone === "warn" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-[var(--accent)]/12 text-[var(--accent)]",
			)}
		>
			{spin && (
				<span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
			)}
			{children}
		</div>
	);
}

function TocList({
	sections,
	current,
	notes,
	onJump,
}: {
	sections: string[];
	current: number;
	notes: (i: number) => number;
	onJump: (i: number) => void;
}) {
	const { t } = useT();
	return (
		<>
			{sections.map((title, i) => {
				const n = notes(i);
				return (
					<button
						// biome-ignore lint/suspicious/noArrayIndexKey: headings may repeat; order is the identity
						key={i}
						type="button"
						onClick={() => onJump(i)}
						className={clsx(
							"flex w-full items-start gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12px] transition-colors",
							i === current
								? "bg-[var(--accent)]/12 text-[var(--text)]"
								: "text-[var(--text-60)] hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]",
						)}
					>
						<span className="min-w-[18px] shrink-0 font-mono text-[11px] leading-5 text-[var(--text-30)]">
							{String(i + 1).padStart(2, "0")}
						</span>
						<span className="min-w-0 flex-1 leading-5 break-words">{title}</span>
						{n > 0 && (
							<span className="shrink-0 whitespace-nowrap rounded-full bg-[var(--accent)]/12 px-1.5 text-[11px] leading-5 text-[var(--accent)]">
								{t("chatView.plan.tocAnnotations", { count: n })}
							</span>
						)}
					</button>
				);
			})}
		</>
	);
}

function TocPill(props: {
	sections: string[];
	current: number;
	notes: (i: number) => number;
	onJump: (i: number) => void;
}) {
	const { t } = useT();
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const cur = props.sections[props.current];
	return (
		<>
			<button
				ref={btnRef}
				type="button"
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
				className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[var(--ghost-hover)] px-2.5 py-0.5 text-left text-[12px] text-[var(--text)] transition-colors hover:bg-[var(--ghost-active,var(--ghost-hover))]"
			>
				<span className="shrink-0 whitespace-nowrap text-[var(--text-30)]">{t("chatView.plan.toc")}</span>
				{cur && (
					<span className="min-w-0 break-words">
						{String(props.current + 1).padStart(2, "0")} {cur}
					</span>
				)}
				<ChevronDown size={11} className={clsx("shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
			</button>
			<FloatingLayer
				anchor={open ? btnRef.current : null}
				placement="bottom-start"
				offset={6}
				onDismiss={() => setOpen(false)}
				ignoreRefs={[btnRef]}
				className="flex max-h-[340px] w-[300px] flex-col gap-px overflow-y-auto rounded-xl border border-[var(--border-divider)] p-1.5 shadow-xl"
				aria-label={t("chatView.plan.toc")}
			>
				<TocList
					{...props}
					onJump={(i) => {
						setOpen(false);
						props.onJump(i);
					}}
				/>
			</FloatingLayer>
		</>
	);
}

function DiffSummary({ before, after, version }: { before: string; after: string; version: number }) {
	const { t } = useT();
	const { added, removed } = useMemo(() => {
		const d = diffPlanLines(before, after);
		return {
			added: d.filter((x) => x.kind === "add").length,
			removed: d.filter((x) => x.kind === "del").length,
		};
	}, [before, after]);
	return (
		<div className="mt-2 text-[12px] text-[var(--text-60)]">
			{t("chatView.plan.diffSummary", { from: Math.max(1, version - 1), to: version, added, removed })}
		</div>
	);
}

function DiffView({ before, after }: { before: string; after: string }) {
	const { t } = useT();
	const lines = useMemo(() => diffPlanLines(before, after), [before, after]);
	return (
		<div className="py-3.5">
			{lines.map((l, i) => {
				if (!l.text.trim() || /^\s*(```|~~~)/.test(l.text)) return null;
				const heading = /^#{1,6}\s/.test(l.text);
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: diff rows have no other identity
						key={i}
						className={clsx(
							"my-px rounded-md px-2.5 py-0.5 text-[13px] leading-[1.75] break-words whitespace-pre-wrap",
							heading && "mt-2 font-semibold text-[var(--text)]",
							l.kind === "add" && "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
							l.kind === "del" && "bg-red-500/12 text-red-700 line-through dark:text-red-300",
							l.kind === "same" && !heading && "text-[var(--text-60)]",
						)}
					>
						{l.kind !== "same" && (
							<span
								className={clsx(
									"mr-1.5 inline-block text-[11px] whitespace-nowrap no-underline",
									l.kind === "add" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
								)}
							>
								{l.kind === "add" ? t("chatView.plan.diffAdded") : t("chatView.plan.diffRemoved")}
							</span>
						)}
						{l.text.replace(/^#{1,6}\s+/, "")}
					</div>
				);
			})}
		</div>
	);
}

function ApprovalDock({
	sessionId,
	plan,
	disabled,
	pending,
}: {
	sessionId: string;
	plan: PlanStatus;
	disabled: boolean;
	pending: number;
}) {
	const { t } = useT();
	const [mode, setMode] = useState<PlanExecMode>("execute");
	const [role, setRole] = useState<string | null>(() =>
		plan.tiers.some((x) => x.role === plan.defaultRole) ? plan.defaultRole : (plan.tiers[0]?.role ?? null),
	);
	const [menuOpen, setMenuOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const optRef = useRef<HTMLButtonElement>(null);
	const effective = effectiveExecMode(mode, plan);
	const single = plan.tiers.length <= 1;
	const tier = plan.tiers.find((x) => x.role === role) ?? null;
	const pct = plan.contextPercent === null ? null : Math.round(plan.contextPercent);
	const modeLabel = (m: PlanExecMode) =>
		m === "execute" ? t("chatView.plan.modeExecute") : m === "compact" ? t("chatView.plan.modeCompact") : t("chatView.plan.modeKeep");
	const modeDesc = (m: PlanExecMode) => {
		if (m === "execute") return t("chatView.plan.modeExecuteDesc");
		if (m === "compact") return t("chatView.plan.modeCompactDesc");
		if (plan.keepDisabled) return t("chatView.plan.modeKeepFull", { percent: pct ?? 100 });
		return pct === null ? t("chatView.plan.modeKeepDesc") : t("chatView.plan.modeKeepUsage", { percent: pct });
	};

	const approve = async () => {
		setBusy(true);
		try {
			await approvePlan(sessionId, plan, effective, single ? null : role);
			if (pending > 0) toast.info(t("chatView.plan.annotationsLeft", { count: pending }));
		} catch (err) {
			toast.error(t("chatView.plan.approveFailed", { error: errMsg(err) }));
		} finally {
			setBusy(false);
		}
	};
	const save = async () => {
		setMenuOpen(false);
		try {
			await runPlanAction(sessionId, "save");
			toast.success(t("chatView.plan.saved"));
		} catch (err) {
			toast.error(t("chatView.plan.actionFailed", { error: errMsg(err) }));
		}
	};

	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 bg-gradient-to-b from-transparent via-[var(--bg-panel)]/90 to-[var(--bg-panel)] px-4 pt-7 pb-3.5">
			{pending > 0 && (
				<button
					type="button"
					title={t("chatView.plan.pendingTitle")}
					onClick={() => useComposer.getState().focusComposer(sessionId)}
					className="pointer-events-auto inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--accent)]/15 px-3.5 text-[12.5px] text-[var(--accent)] backdrop-blur-md transition-colors hover:bg-[var(--accent)]/25"
				>
					<span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
					{t("chatView.plan.pendingAnnotations", { count: pending })}
				</button>
			)}
			<span className="flex-1" />
			<div className="pointer-events-auto flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--border-divider)] bg-[var(--bg-panel)]/85 p-1 shadow-lg backdrop-blur-lg">
				<button
					ref={optRef}
					type="button"
					aria-haspopup="menu"
					aria-expanded={menuOpen}
					title={t("chatView.plan.optionsTitle")}
					onClick={() => setMenuOpen((v) => !v)}
					className="inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full pr-2.5 pl-3.5 text-[12.5px] text-[var(--text-60)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)] aria-expanded:bg-[var(--ghost-hover)]"
				>
					<b className="font-medium text-[var(--text)]">{modeLabel(effective)}</b>
					{!single && role && <span>· {role}</span>}
					<ChevronDown size={11} className={clsx("opacity-60 transition-transform", menuOpen && "rotate-180")} />
				</button>
				<button
					type="button"
					disabled={disabled || busy}
					onClick={() => void approve()}
					className="inline-flex h-[34px] items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--accent)] px-4.5 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-45"
				>
					{t("chatView.plan.approve")}
				</button>
			</div>
			<FloatingLayer
				anchor={menuOpen ? optRef.current : null}
				placement="top-end"
				offset={8}
				layer="menu"
				onDismiss={() => setMenuOpen(false)}
				ignoreRefs={[optRef]}
				role="menu"
				className="w-[min(340px,calc(100vw-32px))] rounded-[14px] border border-[var(--border-divider)] p-1.5 shadow-2xl"
			>
				<MenuCaption>{t("chatView.plan.execMode")}</MenuCaption>
				{EXEC_MODES.map((m) => {
					const off = m === "keep" && plan.keepDisabled;
					return (
						<MenuRow
							key={m}
							role="menuitemradio"
							checked={m === effective}
							disabled={off}
							warn={off}
							title={modeLabel(m)}
							desc={modeDesc(m)}
							onClick={() => setMode(m)}
						/>
					);
				})}
				{!single && (
					<>
						<hr className="mx-0.5 my-1.5 border-[var(--border-divider)]" />
						<MenuCaption>{t("chatView.plan.execModel")}</MenuCaption>
						<div role="radiogroup" className="mx-1.5 flex rounded-lg bg-black/10 p-0.5 dark:bg-black/25">
							{plan.tiers.map((x) => (
								<button
									key={x.role}
									type="button"
									role="radio"
									aria-checked={x.role === role}
									onClick={() => setRole(x.role)}
									className={clsx(
										"min-w-0 flex-1 whitespace-nowrap rounded-md px-1.5 py-1 text-[12px] transition-colors",
										x.role === role ? "bg-[var(--bg-panel)] font-semibold text-[var(--text)] shadow-sm" : "text-[var(--text-60)] hover:text-[var(--text)]",
									)}
								>
									{x.role}
								</button>
							))}
						</div>
						{tier && (
							<div className="px-2 pt-1.5 pb-1 text-[12px] break-words text-[var(--text-60)]">
								<b className="font-medium text-[var(--text)]">{tier.role}</b> · {tier.spec}
							</div>
						)}
					</>
				)}
				<hr className="mx-0.5 my-1.5 border-[var(--border-divider)]" />
				<MenuRow
					role="menuitem"
					title={t("chatView.plan.save")}
					desc={t("chatView.plan.saveDesc")}
					disabled={disabled}
					onClick={() => void save()}
				/>
			</FloatingLayer>
		</div>
	);
}

function MenuCaption({ children }: { children: React.ReactNode }) {
	return <div className="px-2 pt-1.5 pb-1 text-[11px] text-[var(--text-30)]">{children}</div>;
}

function MenuRow({
	role,
	checked,
	disabled = false,
	warn = false,
	title,
	desc,
	onClick,
}: {
	role: "menuitemradio" | "menuitem";
	checked?: boolean;
	disabled?: boolean;
	warn?: boolean;
	title: string;
	desc: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role={role}
			aria-checked={role === "menuitemradio" ? checked === true : undefined}
			disabled={disabled}
			onClick={onClick}
			className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors enabled:hover:bg-[var(--ghost-hover)] disabled:opacity-45"
		>
			<span className="w-3.5 shrink-0 text-[var(--accent)]">{checked && <Check size={13} />}</span>
			<span className="min-w-0 flex-1">
				<span className="block whitespace-nowrap text-[12.5px] text-[var(--text)]">{title}</span>
				<span className={clsx("block text-[11.5px] break-words", warn ? "text-red-500" : "text-[var(--text-30)]")}>{desc}</span>
			</span>
		</button>
	);
}

function EmptyHint({ text, children }: { text: string; children?: React.ReactNode }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[12px] leading-5 text-[var(--text-40,var(--text-dim))]">
			<NotebookPen size={18} className="opacity-50" />
			<span>{text}</span>
			{children}
		</div>
	);
}
