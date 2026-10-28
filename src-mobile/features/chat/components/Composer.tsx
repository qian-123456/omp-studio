import { FileText, Folder, FolderOpen, GitBranch, Lightbulb, Monitor, Paperclip, PenLine, Target, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../../core/api";
import { baseName } from "../../../core/lib/format";
import { usePref } from "../../../core/stores/prefs";
import { useSession } from "../../../core/stores/sessions";
import { BottomSheet, Chip, IconButton, MenuRow, Segmented, Spinner, Switch, toast } from "../../../ui";
import { useChat, useChatUi } from "../ChatContext";
import { contextTone, formatContextPercent, resolveContextPercent } from "../lib/context";
import { takeComposerAction } from "../lib/drafts";
import { BEHAVIOR_HINT, BEHAVIOR_LABEL, type StreamBehavior } from "../lib/prompt";
import { commandAction, commandInput, detectSlashQuery, type SlashCmd } from "../lib/slash";
import { saveUnsent, UNSENT_DEBOUNCE_MS } from "../lib/unsent";
import { ComposerCapsule, type ComposerApi } from "./ComposerCapsule";
import { ContextSheet } from "./ContextSheet";
import { GoalSheet, goalLabel } from "./GoalSheet";
import { PathSheet } from "./PathSheet";
import { RemoteFilePickerSheet } from "./RemoteFilePickerSheet";
import { SketchPad } from "./SketchPad";
import { SlashPopup } from "./SlashSheet";
import { WorkspacePickerSheet } from "./WorkspacePickerSheet";

type Sheet = "plus" | "goal" | "context" | "path" | "finder" | "workspace" | null;

/** Large square-ish tile of the actions sheet's top row (ChatGPT attachments sheet). */
export function ActionTile({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="flex h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-m-lg bg-m-card px-1 text-m-xs whitespace-nowrap text-m-text shadow-m-card active:bg-m-surface-2 disabled:opacity-40"
		>
			<span className="text-m-text-2">{icon}</span>
			{label}
		</button>
	);
}

const TONE_TEXT = { neutral: "text-m-text-3", warn: "text-m-warn", danger: "text-m-danger" } as const;

export function Composer({ sessionId }: { sessionId: string }) {
	const { controller } = useChatUi();
	const session = useSession(sessionId);
	const working = useChat((s) => s.working);
	const atts = useChat((s) => s.atts);
	const cstate = useChat((s) => s.cstate);
	const forkFrom = useChat((s) => s.forkFrom);
	const compacting = useChat((s) => s.compacting);
	const [behavior, setBehavior] = usePref<StreamBehavior>("chat.streamBehavior", "followUp");
	const [slashQuery, setSlashQuery] = useState<string | null>(null);
	const [sheet, setSheet] = useState<Sheet>(null);
	const [sketch, setSketch] = useState(false);
	const apiRef = useRef<ComposerApi | null>(null);
	const saveTimer = useRef<number | undefined>(undefined);
	const fileAny = useRef<HTMLInputElement>(null);

	const onInput = useCallback(() => {
		clearTimeout(saveTimer.current);
		saveTimer.current = window.setTimeout(() => saveUnsent(sessionId, apiRef.current?.get() ?? ""), UNSENT_DEBOUNCE_MS);
		controller.noteEdit();
	}, [controller, sessionId]);

	const onSync = useCallback((v: string) => setSlashQuery(detectSlashQuery(v)), []);

	const onUnmount = useCallback(
		(v: string) => {
			controller.lastText = v;
			clearTimeout(saveTimer.current);
			saveUnsent(sessionId, v);
		},
		[controller, sessionId],
	);

	// Hand the textarea to the controller (restore on failed send, annotations, edit/fork).
	useLayoutEffect(() => {
		controller.composer = apiRef.current;
		return () => {
			controller.composer = null;
		};
	}, [controller]);

	// Flush pending text if the tab is closed/backgrounded before the debounce fires.
	useEffect(() => {
		const onHide = () => saveUnsent(sessionId, apiRef.current?.get() ?? "");
		window.addEventListener("pagehide", onHide);
		return () => window.removeEventListener("pagehide", onHide);
	}, [sessionId]);

	const pickCommand = (c: SlashCmd) => {
		if (commandAction(c) === "run") {
			apiRef.current?.set("");
			void controller.runCommand(c.name, "");
		} else {
			apiRef.current?.set(commandInput(c), true);
		}
	};

	const togglePlan = async () => {
		try {
			const r = await api<{ on: boolean }>("POST", `/sessions/${sessionId}/plan-mode`, {});
			controller.patchState({ planMode: r.on });
			toast(r.on ? "规划模式已开启" : "规划模式已关闭");
		} catch (e) {
			toast(`切换失败：${errorMessage(e)}`, { kind: "error" });
		}
	};

	useEffect(() => {
		const handoff = takeComposerAction(sessionId);
		if (!handoff) return;
		if (handoff.files?.length) controller.addFiles(handoff.files);
		if (handoff.action === "sketch") setSketch(true);
		else if (handoff.action === "plan") void togglePlan();
		else if (handoff.action) setSheet(handoff.action);
	}, [controller, sessionId]);

	const cwd = session?.cwd ?? null;
	const pct = cstate ? resolveContextPercent(cstate) : null;
	const tone = contextTone(pct);
	const goal = cstate?.goal && cstate.goal.objective ? cstate.goal : null;
	const planOn = !!cstate?.planMode;
	const close = () => setSheet(null);

	const attachments =
		atts.length > 0 ? (
			<div className="m-noscrollbar flex gap-2 overflow-x-auto px-1 pt-1 pb-2">
				{atts.map((a) => (
					<div key={a.id} className={`relative flex shrink-0 items-center gap-2 rounded-m-md bg-m-surface-2 py-1.5 pr-10 pl-1.5 ${a.status === "err" ? "ring-1 ring-m-danger" : ""}`}>
						{a.isImage && a.url ? (
							<img src={a.url} alt="" className="h-11 w-11 rounded-m-sm object-cover" />
						) : (
							<span className="flex h-11 w-11 items-center justify-center rounded-m-sm bg-m-surface text-m-text-2">
								<FileText size={20} />
							</span>
						)}
						<span className="flex max-w-40 flex-col">
							<span className="text-m-xs break-all text-m-text">{a.name}</span>
							{a.status === "up" && (
								<span className="flex items-center gap-1 text-m-xs whitespace-nowrap text-m-text-3">
									<Spinner size={12} />
									上传中
								</span>
							)}
							{a.status === "err" && <span className="text-m-xs whitespace-nowrap text-m-danger">上传失败</span>}
						</span>
						<span className="absolute top-0 right-0">
							<IconButton size="sm" icon={<X size={16} />} label="移除附件" onClick={() => controller.removeAtt(a.id)} />
						</span>
					</div>
				))}
			</div>
		) : undefined;

	return (
		<div className="relative shrink-0 px-4 pt-1" style={{ paddingBottom: "calc(var(--m-safe-bottom) + 8px)" }}>
			{slashQuery !== null && sheet === null && <SlashPopup sessionId={sessionId} query={slashQuery} onPick={pickCommand} />}

			{forkFrom && (
				<div className="mb-2 flex items-start gap-3 rounded-m-lg bg-m-surface py-2 pr-1 pl-4">
					<GitBranch size={18} className="mt-2.5 shrink-0 text-m-accent" />
					<div className="min-w-0 flex-1 py-2">
						<div className="text-m-sm font-medium">从这条回复分支</div>
						<div className="text-m-xs break-words text-m-text-2">{forkFrom.preview}</div>
					</div>
					<IconButton icon={<X size={18} />} label="取消分支" onClick={() => controller.cancelFork()} />
				</div>
			)}

			{working && (
				<div className="mb-2 flex items-center gap-3 px-1">
					<Segmented<StreamBehavior>
						label="发送方式"
						value={behavior}
						options={(["followUp", "steer"] as const).map((b) => ({ value: b, label: BEHAVIOR_LABEL[b] }))}
						onChange={setBehavior}
					/>
					<span className="min-w-0 flex-1 text-m-xs text-m-text-3">{BEHAVIOR_HINT[behavior]}</span>
				</div>
			)}

			{/* Status row: folder (or plan-mode capsule) left, context usage right. */}
			<div className="flex min-h-11 flex-wrap items-center gap-x-2 text-m-xs">
				{planOn ? (
					<Chip tone="accent" icon={<Lightbulb size={14} />} onClick={() => void togglePlan()} className="h-8 shrink-0 pr-2">
						规划模式
						<X size={14} aria-hidden />
					</Chip>
				) : (
					<button
						type="button"
						aria-label="当前工作目录"
						onClick={() => setSheet("path")}
						className="-ml-2 flex min-h-11 min-w-11 max-w-[65%] items-center gap-1.5 rounded-m-pill px-2 text-m-text-3 active:bg-m-surface-hover"
					>
						<Folder size={15} className="shrink-0" />
						<span className="truncate">{cwd ? baseName(cwd) : "未设置目录"}</span>
					</button>
				)}
				{goal && (
					<Chip icon={<Target size={14} />} onClick={() => setSheet("goal")} className="h-8 min-w-0 max-w-[40%]">
						<span className="truncate">{goal.objective}</span>
					</Chip>
				)}
				<span className="flex-1" />
				<button
					type="button"
					aria-label="上下文用量"
					onClick={() => setSheet("context")}
					className={`-mr-2 flex min-h-11 shrink-0 items-center rounded-m-pill px-2 whitespace-nowrap active:bg-m-surface-hover ${TONE_TEXT[tone]}`}
				>
					上下文 {formatContextPercent(pct) ?? "未知"}
				</button>
			</div>

			<ComposerCapsule
				apiRef={apiRef}
				initialText={controller.initialText}
				placeholder={forkFrom ? "输入分支后的第一条消息" : "问问 OMP"}
				working={working}
				hasExtra={atts.length > 0}
				top={attachments}
				onPlus={() => setSheet("plus")}
				onSend={(v) => void controller.send(v, behavior)}
				onStop={() => void controller.stop()}
				onInput={onInput}
				onSync={onSync}
				onUnmount={onUnmount}
			/>

			<input ref={fileAny} type="file" multiple hidden onChange={(e) => pickFiles(e, controller)} />

			{/* ChatGPT-style actions sheet: three tiles, then rows. */}
			<BottomSheet open={sheet === "plus"} onClose={close}>
				<div className="grid grid-cols-3 gap-3 px-4 pt-1">
					<ActionTile
						icon={<Paperclip size={24} strokeWidth={1.75} />}
						label="文件"
						onClick={() => {
							close();
							fileAny.current?.click();
						}}
					/>
					<ActionTile icon={<Monitor size={24} strokeWidth={1.75} />} label="Finder 选中项" onClick={() => setSheet("finder")} />
					<ActionTile
						icon={<PenLine size={24} strokeWidth={1.75} />}
						label="草图"
						onClick={() => {
							close();
							setSketch(true);
						}}
					/>
				</div>
				<div className="pt-3 pb-3">
					<MenuRow
						icon={<FolderOpen size={22} strokeWidth={1.75} />}
						label="在项目中工作"
						hint={cwd ? baseName(cwd) : "选择项目目录"}
						onClick={() => setSheet("workspace")}
					/>
					<MenuRow
						icon={<Target size={22} strokeWidth={1.75} />}
						label="目标"
						hint={goal ? `${goalLabel(goal)}：${goal.objective}` : "设定后会持续朝它推进"}
						onClick={() => setSheet("goal")}
					/>
					<div className="flex min-h-13 w-full items-center gap-4 py-1 pr-4 pl-5">
						<span className="flex w-6 shrink-0 items-center justify-center text-m-text-2">
							<Lightbulb size={22} strokeWidth={1.75} />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block text-m-md text-m-text">规划模式</span>
							<span className="mt-0.5 block text-m-xs text-m-text-3">先出计划，确认后再动手</span>
						</span>
						<Switch label="规划模式" checked={planOn} onChange={() => void togglePlan()} />
					</div>
				</div>
			</BottomSheet>

			<GoalSheet open={sheet === "goal"} onClose={close} sessionId={sessionId} goal={goal} onGoal={(g) => controller.patchState({ goal: g })} />
			<ContextSheet open={sheet === "context"} onClose={close} cstate={cstate} compacting={compacting} controller={controller} />
			<PathSheet open={sheet === "path"} onClose={close} cwd={cwd} sessionId={sessionId} onSwitchProject={() => setSheet("workspace")} />
			<RemoteFilePickerSheet
				open={sheet === "finder"}
				onClose={close}
				sessionId={sessionId}
				onSelectFile={(f) => apiRef.current?.insert(`[${f.name}](${f.path})`)}
			/>
			<WorkspacePickerSheet open={sheet === "workspace"} onClose={close} sessionId={sessionId} currentCwd={cwd} />
			<SketchPad
				open={sketch}
				onClose={() => setSketch(false)}
				onDone={(blob) => {
					setSketch(false);
					controller.addFiles([new File([blob], `sketch-${Date.now()}.png`, { type: "image/png" })], true);
				}}
			/>
		</div>
	);
}

function pickFiles(e: React.ChangeEvent<HTMLInputElement>, controller: { addFiles(f: File[], img: boolean): void }) {
	controller.addFiles(Array.from(e.target.files ?? []), false);
	e.target.value = "";
}
