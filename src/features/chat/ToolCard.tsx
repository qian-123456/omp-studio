/** [B] Codex-style tool row: leading muted kind icon, verb-first Chinese
 * label, dimmer object, and a trailing chevron that fades in on hover and
 * rotates when open. The body expands below, indented ps-6. */

import {
	Bot,
	ExternalLink,
	FileText,
	FolderOpen,
	Globe,
	Hourglass,
	ListTodo,
	type LucideIcon,
	MessageCircleQuestion,
	Pencil,
	Search,
	Terminal,
	Wrench,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { useHomeDir } from "../../lib/hooks";
import { openFileLink } from "../../stores/filePreview";
import { useSessions } from "../../stores/sessions";
import { diffCounts, DiffView, parseDiff } from "./DiffView";
import { toolFilePaths } from "./turnGrouping";
import { CopyButton } from "../../components/CopyButton";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { PrivacyText } from "../privacy/SecretChip";
import { askResultSummary } from "./ask/askDriver";
import { ActivityHeader } from "./ActivityHeader";
import { useT, tNow } from "../../stores/language";

export type ToolStatus = "running" | "done" | "error" | "called";

const asObj = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

const pick = (args: unknown, keys: string[]): string | undefined => {
	const o = asObj(args);
	for (const k of keys) {
		if (typeof o[k] === "string" && o[k]) return o[k] as string;
	}
	return undefined;
};

const FILE_KEYS = ["path", "file", "filePath", "target_file"];
const QUERY_KEYS = ["pattern", "query", "q", "regex", "search_query"];
const DIR_KEYS = ["dir", "folder", "directory", "root"];

type ToolFamily =
	| "read"
	| "search"
	| "find"
	| "list"
	| "run"
	| "edit"
	| "write"
	| "todo"
	| "web"
	| "task"
	| "wait"
	| "other";

const TOOL_FAMILY: Record<string, ToolFamily> = {
	read: "read",
	read_file: "read",
	grep: "search",
	search: "search",
	search_files: "search",
	rg: "search",
	ast_grep: "search",
	glob: "find",
	find: "find",
	fd: "find",
	list: "list",
	ls: "list",
	list_files: "list",
	bash: "run",
	shell: "run",
	exec: "run",
	run: "run",
	command: "run",
	eval: "run",
	edit: "edit",
	edit_file: "edit",
	ast_edit: "edit",
	write: "write",
	write_file: "write",
	todo: "todo",
	todo_write: "todo",
	todowrite: "todo",
	webfetch: "web",
	web_fetch: "web",
	web_search: "web",
	task: "task",
	agent: "task",
	wait: "wait",
	wait_threads: "wait",
	await: "wait",
};

/** Verb-first labels per status, Codex-style ("正在读取" / "已读取" / "运行失败"). */
const VERBS: Record<ToolFamily, { readonly doing: string; readonly did: string; readonly base: string }> = {
	read: {
		get doing() { return tNow("tools.verbs.readDoing"); },
		get did() { return tNow("tools.verbs.readDid"); },
		get base() { return tNow("tools.verbs.readBase"); },
	},
	search: {
		get doing() { return tNow("tools.verbs.searchDoing"); },
		get did() { return tNow("tools.verbs.searchDid"); },
		get base() { return tNow("tools.verbs.searchBase"); },
	},
	find: {
		get doing() { return tNow("tools.verbs.findDoing"); },
		get did() { return tNow("tools.verbs.findDid"); },
		get base() { return tNow("tools.verbs.findBase"); },
	},
	list: {
		get doing() { return tNow("tools.verbs.listDoing"); },
		get did() { return tNow("tools.verbs.listDid"); },
		get base() { return tNow("tools.verbs.listBase"); },
	},
	run: {
		get doing() { return tNow("tools.verbs.runDoing"); },
		get did() { return tNow("tools.verbs.runDid"); },
		get base() { return tNow("tools.verbs.runBase"); },
	},
	edit: {
		get doing() { return tNow("tools.verbs.editDoing"); },
		get did() { return tNow("tools.verbs.editDid"); },
		get base() { return tNow("tools.verbs.editBase"); },
	},
	write: {
		get doing() { return tNow("tools.verbs.writeDoing"); },
		get did() { return tNow("tools.verbs.writeDid"); },
		get base() { return tNow("tools.verbs.writeBase"); },
	},
	todo: {
		get doing() { return tNow("tools.verbs.todoDoing"); },
		get did() { return tNow("tools.verbs.todoDid"); },
		get base() { return tNow("tools.verbs.todoBase"); },
	},
	web: {
		get doing() { return tNow("tools.verbs.webDoing"); },
		get did() { return tNow("tools.verbs.webDid"); },
		get base() { return tNow("tools.verbs.webBase"); },
	},
	task: {
		get doing() { return tNow("tools.verbs.taskDoing"); },
		get did() { return tNow("tools.verbs.taskDid"); },
		get base() { return tNow("tools.verbs.taskBase"); },
	},
	wait: {
		get doing() { return tNow("tools.verbs.waitDoing"); },
		get did() { return tNow("tools.verbs.waitDid"); },
		get base() { return tNow("tools.verbs.waitBase"); },
	},
	other: {
		get doing() { return tNow("tools.verbs.otherDoing"); },
		get did() { return tNow("tools.verbs.otherDid"); },
		get base() { return tNow("tools.verbs.otherBase"); },
	},
};

function toolFamily(name: string): ToolFamily {
	return TOOL_FAMILY[name.toLowerCase()] ?? "other";
}

/** Leading kind icon per tool family (Codex `agent-activity` icons). */
const FAMILY_ICON: Record<ToolFamily, LucideIcon> = {
	read: FileText,
	search: Search,
	find: Search,
	list: FolderOpen,
	run: Terminal,
	edit: Pencil,
	write: Pencil,
	todo: ListTodo,
	web: Globe,
	task: Bot,
	wait: Hourglass,
	other: Wrench,
};

export function toolIcon(name: string): LucideIcon {
	return FAMILY_ICON[toolFamily(name)];
}

/** Human-readable detail (the dimmed object after the verb). */
function toolDetail(
	family: ToolFamily,
	name: string,
	args: unknown,
	intent: string | null,
): string {
	if (intent) return intent;
	switch (family) {
		case "run":
			return pick(args, ["command", "cmd"]) ?? "";
		case "search":
			return (
				pick(args, QUERY_KEYS) ??
				pick(args, [...FILE_KEYS, ...DIR_KEYS]) ??
				""
			);
		case "find":
		case "list":
			return (
				pick(args, [...QUERY_KEYS, ...FILE_KEYS, ...DIR_KEYS]) ?? ""
			);
		case "read":
		case "edit":
		case "write":
			return pick(args, FILE_KEYS) ?? "";
		case "web":
			return pick(args, ["url", "uri", "query"]) ?? "";
		case "todo":
		case "wait":
			return "";
		case "task": {
			const desc = pick(args, ["task", "description", "name"]);
			return desc ?? "";
		}
		default: {
			const first = pick(args, [...FILE_KEYS, ...QUERY_KEYS]);
			if (first) return first;
			const json = JSON.stringify(args);
			if (!json || json === "{}") return "";
			return json.length > 60 ? `${json.slice(0, 60)}…` : name;
		}
	}
}

/** +/- line counts of a tool diff; same parse (and numbers) as the DiffView body. */
function diffStat(diff: string | null): { adds: number; dels: number } | null {
	if (!diff) return null;
	const { adds, dels } = diffCounts(parseDiff(diff));
	return adds + dels > 0 ? { adds, dels } : null;
}

/** Remembered open state of tool cards, keyed by session + call id. */
const openToolCards = new Set<string>();

/** Forget remembered open state of the given sessions (call when sessions are removed). */
export function pruneToolCards(sessionIds: readonly string[]): void {
	const prefixes = sessionIds.map((sid) => `${sid}:`);
	for (const key of [...openToolCards]) {
		if (prefixes.some((p) => key.startsWith(p))) openToolCards.delete(key);
	}
}

/** Only real filesystem paths get an open button; `proc://…` style URIs don't. */
function openableFile(path: string): boolean {
	return !/^(?!file:)[a-z][a-z0-9+.-]*:\/\//i.test(path);
}

/** Multi-line / long string args become their own mono blocks. */
function splitArgs(args: unknown): {
	restArgs: Record<string, unknown>;
	longFields: [string, string][];
} {
	const restArgs: Record<string, unknown> = {};
	const longFields: [string, string][] = [];
	for (const [k, v] of Object.entries(asObj(args))) {
		if (typeof v === "string" && (v.includes("\n") || v.length > 120)) longFields.push([k, v]);
		else restArgs[k] = v;
	}
	return { restArgs, longFields };
}

/** Hover-only ghost copy affordance for quiet blocks. */
function CopyGhostButton({ text, label }: { text: string; label: string }) {
	return (
		<CopyButton
			text={text}
			size={11}
			title={label}
			className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-[var(--text-30)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/copy:opacity-100"
		/>
	);
}

/** Quiet bordered mono block used for command lines, output and payloads. */
function QuietMonoBlock({
	header,
	headerCopyText,
	headerCopyLabel,
	body,
	copyText: copyValue,
	copyLabel,
}: {
	header?: string;
	/** When set, the header has its own copy button for this text. */
	headerCopyText?: string;
	headerCopyLabel?: string;
	body: string;
	copyText?: string;
	copyLabel: string;
}) {
	const ownHeaderCopy = headerCopyText !== undefined;
	const bodyCopy = copyValue ?? body;
	return (
		<div className="group/copy overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)]">
			{header !== undefined && (
				<div
					className={clsx(
						"flex items-start justify-between gap-2 px-2.5 py-1",
						body !== "" && "border-b border-[var(--line)]",
					)}
				>
					<span className="max-h-32 min-w-0 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--text-40)]">
						<PrivacyText text={header} matchValues />
					</span>
					<CopyGhostButton
						text={ownHeaderCopy ? headerCopyText : bodyCopy}
						label={ownHeaderCopy ? (headerCopyLabel ?? copyLabel) : copyLabel}
					/>
				</div>
			)}
			{body !== "" && (
				<div className="relative">
					{(header === undefined || ownHeaderCopy) && bodyCopy.trim() !== "" && (
						<div className="absolute right-1 top-1">
							<CopyGhostButton text={bodyCopy} label={copyLabel} />
						</div>
					)}
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all px-2.5 py-1.5 font-mono text-[11px] leading-5 text-[var(--text-60)]">
						<PrivacyText text={body} matchValues />
					</pre>
				</div>
			)}
		</div>
	);
}

export function toolActivityLabel(
	name: string,
	args: unknown,
	intent: string | null,
	status: ToolStatus,
): { verb: string; object: string; objectIsCode: boolean } {
	const family = toolFamily(name);
	const verbs = VERBS[family];
	const verb =
		status === "error"
			? tNow("tools.verbs.failed")
			: status === "running"
				? verbs.doing
				: status === "done"
					? verbs.did
					: verbs.base;
	// omp intents are natural-language ("Checking port 1422"); raw paths and
	// commands read better in mono.
	return {
		verb,
		object: toolDetail(family, name, args, intent),
		objectIsCode: !intent,
	};
}

/** `ask` results render as a compact Q→A summary instead of raw output. */
export const ToolCard = memo(function ToolCard(
	props: Parameters<typeof ToolCardBodyImpl>[0],
) {
	const qa = props.name === "ask" ? askResultSummary(props.details) : null;
	if (!qa) return <ToolCardBody {...props} />;
	return (
		<div className="my-px flex flex-col">
			{qa.map((p, i) => (
				<ActivityHeader
					key={`${i}:${p.question}`}
					icon={MessageCircleQuestion}
					label={tNow("tools.ask.asked")}
					object={`${p.question} → ${p.answer || tNow("tools.ask.unanswered")}`}
				/>
			))}
		</div>
	);
});

function ToolCardBodyImpl({
	sessionId,
	name,
	args,
	intent,
	status,
	output,
	details,
	expanded,
	callId,
	startedAt: _startedAt,
	endedAt: _endedAt,
}: {
	sessionId: string;
	name: string;
	args?: unknown;
	intent?: string | null;
	status: ToolStatus;
	output?: string;
	details?: unknown;
	expanded?: boolean;
	/** Stable call id; keys the remembered open state. */
	callId?: string;
	startedAt?: number;
	endedAt?: number;
}) {
	const { t } = useT();
	// Codex keeps every tool row collapsed to one line; failures show via the
	// header's error tone, not by dumping the body open mid-run.
	const openKey = callId ? `${sessionId}:${callId}` : undefined;
	const [open, setOpen] = useState(
		expanded === true || (openKey !== undefined && openToolCards.has(openKey)),
	);
	const cwd = useSessions((s) => s.sessions[sessionId]?.cwd ?? null);
	const home = useHomeDir();

	useEffect(() => {
		if (expanded !== undefined) {
			setOpen(expanded);
		}
	}, [expanded]);

	// Remember the open state per call: a lone card can be remounted when its
	// neighbours fold into a group, and must come back as the user left it.
	useEffect(() => {
		if (openKey === undefined) return;
		if (open) openToolCards.add(openKey);
		else openToolCards.delete(openKey);
	}, [open, openKey]);

	const det = asObj(details);
	const diff = typeof det.diff === "string" ? det.diff : null;
	const files = toolFilePaths(args);
	const file = files[0];
	const command = pick(args, ["command", "cmd"]);
	const { verb, object, objectIsCode } = toolActivityLabel(
		name,
		args,
		intent ?? null,
		status,
	);
	const stat = useMemo(() => diffStat(diff), [diff]);
	const { restArgs, longFields } = useMemo(() => splitArgs(args), [args]);
	// An empty `{}` payload is noise, and a wait call has nothing to show but
	// its description.
	const hasArgsBody =
		args !== undefined &&
		toolFamily(name) !== "wait" &&
		!(typeof args === "object" && args !== null && Object.keys(args).length === 0);

	const hasBody = Boolean(
		command ||
			file ||
			diff ||
			output ||
			(name === "write" && typeof asObj(args).content === "string") ||
			hasArgsBody,
	);

	return (
		<div className="my-px">
			<ActivityHeader
				icon={FAMILY_ICON[toolFamily(name)]}
				label={verb}
				labelTitle={name}
				object={object}
				objectIsCode={objectIsCode}
				running={status === "running"}
				error={status === "error"}
				expandable={hasBody}
				open={open}
				onToggle={() => setOpen(!open)}
				accessory={
					stat &&
					status === "done" && (
						<span className="shrink-0 font-mono text-[11px] tabular-nums">
							<span className="text-[var(--status-success)]">
								+{stat.adds}
							</span>{" "}
							<span className="text-[var(--status-error)]">
								−{stat.dels}
							</span>
						</span>
					)
				}
			/>

			{open && hasBody && (
				<div className="flex flex-col gap-1.5 ps-6 pb-1 pt-0.5">
					{command && (
						<QuietMonoBlock
							header={`$ ${command}`}
							headerCopyText={command}
							headerCopyLabel={t("tools.copy.command")}
							body={output?.trim() ? output : status === "running" ? "" : t("tools.copy.noOutput")}
							copyText={output}
							copyLabel={t("tools.copy.output")}
						/>
					)}

					{!command &&
						files.map((f) => (
							<div
								key={f}
								className="group/copy flex items-start justify-between gap-2 rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2.5 py-1"
							>
								<span className="min-w-0 whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--text-60)]">
									{f}
								</span>
								{openableFile(f) && (
									<button
										type="button"
										onClick={async () => {
											try {
												await openFileLink(f, { cwd, home });
											} catch (e) {
												toast.error(t("tools.file.openFailed", { error: errMsg(e) }));
											}
										}}
										className="flex shrink-0 items-center rounded px-1 py-0.5 text-[var(--text-30)] opacity-0 transition-opacity hover:text-[var(--text)] focus:opacity-100 group-hover/copy:opacity-100"
										title={t("tools.file.open")}
										aria-label={t("tools.file.open")}
									>
										<ExternalLink size={11} />
									</button>
								)}
							</div>
						))}

					{diff && <DiffView diff={diff} file={file} sessionId={sessionId} />}

					{!command && output && (
						<QuietMonoBlock body={output} copyLabel={t("tools.copy.output")} />
					)}

					{name === "write" &&
						typeof asObj(args).content === "string" &&
						!output && (
							<QuietMonoBlock
								body={String(asObj(args).content)}
								copyLabel={t("tools.copy.writeContent")}
							/>
						)}

					{hasArgsBody &&
						!command &&
						name !== "write" &&
						!diff &&
						(files.length === 0 || longFields.length > 0) && (
							<>
								{Object.keys(restArgs).length > 0 && (
									<QuietMonoBlock
										body={JSON.stringify(restArgs, null, 2)}
										copyLabel={t("tools.copy.args")}
									/>
								)}
								{longFields.map(([key, value]) => (
									<QuietMonoBlock
										key={key}
										header={key}
										body={value}
										copyLabel={t("tools.copy.field", { field: key })}
									/>
								))}
							</>
						)}
				</div>
			)}
		</div>
	);
}

const ToolCardBody = memo(ToolCardBodyImpl);
