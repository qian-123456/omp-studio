import { CheckCircle2, Loader2, Send, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import { NativeSelect } from "../../components/NativeSelect";
import type { BacklogItem } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { backlogBuildPrompt, backlogUpdate, dispatchPrompt, listWorkspaces, rpcStart } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useSidebarStore } from "../sessions/sidebarStore";
import { useBacklog } from "./backlogStore";
import { projectDisplayName, projectRoot, sessionOptionLabel, splitByProject, splitSent } from "./ideasLogic";
import { PILL_OUTLINE, PILL_PRIMARY } from "./ideaStyles";

type Target = "existing" | "new";
type Step = "choose" | "confirm";

function groupName(group: BacklogItem[]): string {
	const root = projectRoot(group[0]?.projectDir);
	return root ? projectDisplayName(root) : "未关联项目";
}

/** 「派给 Agent」: choose a target session, confirm, then send; keeps choices and shows full errors on failure. */
export function DispatchDialog({
	items,
	currentProject,
	onClose,
}: {
	items: BacklogItem[];
	currentProject: string | null;
	onClose: () => void;
}) {
	const sessions = useSessions((s) => s.sessions);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessionList = Object.values(sessions).filter((session) => !session.archived);
	const activeId = selectedSessionId && sessionList.some((s) => s.id === selectedSessionId) ? selectedSessionId : null;

	const [step, setStep] = useState<Step>("choose");
	const [target, setTarget] = useState<Target>(activeId || sessionList.length > 0 ? "existing" : "new");
	const [existingId, setExistingId] = useState(activeId ?? sessionList[0]?.id ?? "");
	const [busy, setBusy] = useState(false);
	const [errors, setErrors] = useState<Record<number, string>>({});
	// Items already sent in this dialog: never sent again, whatever the target becomes.
	const [sentIds, setSentIds] = useState<ReadonlySet<string>>(new Set());

	const { remaining, sent } = useMemo(() => splitSent(items, sentIds), [items, sentIds]);
	// "existing" sends everything left in one prompt (one group); "new" opens one session per project.
	const projectGroups = useMemo(() => splitByProject(remaining), [remaining]);
	const sentGroups = useMemo(() => splitByProject(sent), [sent]);
	const groups = target === "existing" ? (remaining.length > 0 ? [remaining] : []) : projectGroups;
	// Sessions already created for a group are reused on retry so a failed send does not leave strays.
	const createdSession = useRef(new Map<string, string>());

	const sendGroup = async (group: BacklogItem[]): Promise<string> => {
		const groupKey = group[0]?.id ?? "";
		let sessionId: string;
		if (target === "existing") {
			if (!existingId) throw new Error("请选择目标会话");
			sessionId = existingId;
		} else {
			const known = createdSession.current.get(groupKey);
			if (known) {
				sessionId = known;
			} else {
				const activeMode = useSidebarStore.getState().activeMode;
				const globalPath =
					activeMode === "chat"
						? (await listWorkspaces()).find((w) => w.kind === "global")?.path
						: undefined;
				const cwd = group[0]?.projectDir ?? currentProject ?? globalPath;
				if (!cwd) throw new Error("当前模式没有可用的项目目录，请先添加项目");
				const mode = globalPath && cwd === globalPath ? "chat" : activeMode === "chat" ? "code" : activeMode;
				sessionId = (await rpcStart({ cwd, mode })).sessionId;
				createdSession.current.set(groupKey, sessionId);
			}
		}
		const prompt = await backlogBuildPrompt(group.map((it) => it.id));
		await dispatchPrompt(sessionId, prompt);
		// Prompt is out: from here the group counts as dispatched even if a status write fails below.
		for (const it of group) await backlogUpdate(it.id, { status: "dispatched", targetSessionId: sessionId });
		return sessionId;
	};

	const run = async () => {
		setBusy(true);
		setErrors({});
		const done = new Set(sentIds);
		const nextErrors: Record<number, string> = {};
		let firstSession: string | null = null;
		for (const [index, group] of groups.entries()) {
			try {
				const sid = await sendGroup(group);
				for (const it of group) done.add(it.id);
				firstSession ??= sid;
			} catch (err) {
				nextErrors[index] = errMsg(err);
			}
		}
		setSentIds(done);
		setErrors(nextErrors);
		await useBacklog.getState().load().catch(() => {});
		setBusy(false);
		if (Object.keys(nextErrors).length === 0) {
			toast.success("已派给 Agent");
			onClose();
			if (firstSession) selectSession(firstSession);
		}
	};

	const switchTarget = (next: Target) => {
		setTarget(next);
		setErrors({});
		createdSession.current.clear();
	};

	const hasErrors = Object.keys(errors).length > 0;
	const existingSession = sessions[existingId];
	const choiceCls = (on: boolean) =>
		`rounded-xl border p-2.5 text-center font-medium transition-colors ${
			on
				? "border-[var(--accent)] bg-[var(--bg-hover)] text-[var(--text)]"
				: "border-[var(--border-divider)] bg-[var(--bg)] text-[var(--text-dim)] hover:text-[var(--text)]"
		}`;

	return (
		<FloatingLayer
			anchor={{ x: window.innerWidth / 2, y: window.innerHeight / 2 }}
			placement="center"
			layer="modal"
			onDismiss={() => {
				if (!busy) onClose();
			}}
			className="max-h-[calc(100vh-1rem)] w-[460px] max-w-[calc(100vw-1rem)] p-5 shadow-apple-modal"
		>
			<div className="space-y-4 text-xs">
				<div className="flex items-center justify-between border-b border-[var(--border-divider)] pb-2.5">
					<div className="flex items-center gap-2">
						<Send className="h-4 w-4 text-[var(--accent)]" />
						<h3 className="text-sm font-semibold text-[var(--text)]">派给 Agent</h3>
					</div>
					<button
						type="button"
						disabled={busy}
						onClick={onClose}
						aria-label="关闭"
						className="rounded-full p-1 text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
					>
						<X className="h-4 w-4" />
					</button>
				</div>

				{step === "choose" ? (
					<>
						<div className="grid grid-cols-2 gap-2">
							<button
								type="button"
								disabled={!sessionList.length}
								onClick={() => switchTarget("existing")}
								className={`${choiceCls(target === "existing")} disabled:opacity-40`}
							>
								现有会话
							</button>
							<button type="button" onClick={() => switchTarget("new")} className={choiceCls(target === "new")}>
								开启新会话
							</button>
						</div>
						{target === "existing" && (
							<div className="space-y-1.5">
								<label className="text-[var(--text-dim)]">选择会话</label>
								<NativeSelect value={existingId} onChange={(e) => setExistingId(e.target.value)} className="w-full">
									{sessionList.map((session) => (
										<option key={session.id} value={session.id}>
											{sessionOptionLabel(session)}
										</option>
									))}
								</NativeSelect>
							</div>
						)}
					</>
				) : (
					<div className="space-y-2 text-[var(--text-muted)]">
						{sentGroups.length > 0 && (
							<ul className="space-y-1">
								{sentGroups.map((g) => (
									<li key={g[0]?.id} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[var(--text)]">
										<span className="min-w-0 break-words font-medium">{groupName(g)}</span>
										<span className="text-[var(--text-dim)]">{g.length} 条</span>
										<span className="inline-flex items-center gap-1 text-[var(--status-success)]">
											<CheckCircle2 className="h-3 w-3" />
											已派出
										</span>
									</li>
								))}
							</ul>
						)}
						<div>
							{target === "existing"
								? `将剩余 ${remaining.length} 条发给会话「${existingSession ? sessionOptionLabel(existingSession) : ""}」`
								: groups.length > 1
									? `剩余 ${remaining.length} 条来自 ${groups.length} 个项目，将分别开 ${groups.length} 个新会话：`
									: `将在「${remaining[0]?.projectDir || currentProject ? groupName(projectGroups[0] ?? remaining) : "全局工作区"}」开启新会话，发送 ${remaining.length} 条`}
						</div>
						{target === "new" && (
							<ul className="space-y-1">
								{groups.map((g, index) => (
									<li key={g[0]?.id ?? index} className="rounded-lg bg-[var(--bg)] px-2.5 py-1.5">
										<div className="flex flex-wrap items-center gap-1.5 text-[var(--text)]">
											<span className="min-w-0 break-words font-medium">{groupName(g)}</span>
											<span className="text-[var(--text-dim)]">{g.length} 条</span>
										</div>
										{errors[index] && (
											<div className="mt-1 whitespace-pre-wrap break-words text-[var(--status-error)] select-text">
												{errors[index]}
											</div>
										)}
									</li>
								))}
							</ul>
						)}
						{target === "existing" && errors[0] && (
							<div className="whitespace-pre-wrap break-words rounded-xl border border-[color-mix(in_srgb,var(--status-error)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)] p-2 text-[var(--status-error)] select-text">
								{errors[0]}
							</div>
						)}
						{sentGroups.length > 0 && (
							<div className="text-[var(--text-dim)]">已派出的不会重复发送{hasErrors ? "，失败的可点「重试」" : ""}。</div>
						)}
					</div>
				)}

				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-2">
					{step === "confirm" && (
						<button type="button" disabled={busy} onClick={() => setStep("choose")} className={`${PILL_OUTLINE} mr-auto`}>
							上一步
						</button>
					)}
					<button type="button" disabled={busy} onClick={onClose} className={PILL_OUTLINE}>
						取消
					</button>
					{step === "choose" ? (
						<button
							type="button"
							disabled={target === "existing" && !existingId}
							onClick={() => setStep("confirm")}
							className={PILL_PRIMARY}
						>
							下一步
						</button>
					) : (
						<button type="button" disabled={busy} onClick={() => void run()} className={PILL_PRIMARY}>
							{busy && <Loader2 className="h-3 w-3 animate-spin" />}
							{hasErrors ? "重试" : "派给 Agent"}
						</button>
					)}
				</div>
			</div>
		</FloatingLayer>
	);
}
