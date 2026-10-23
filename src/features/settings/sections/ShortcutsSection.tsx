/**
 * Settings ▸ 快捷键 (`shortcuts`): every keyboard shortcut in one place.
 * In-window combos come from `features/shortcuts` (registry + editable bindings);
 * the system-wide quick-capture key and the send key keep their existing settings
 * persistence and only live here as rows.
 */
import clsx from "clsx";
import { Keyboard, RotateCcw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Segmented } from "../../../components/Segmented";
import { confirmDialog } from "../../../lib/dialogs";
import { alternateShortcutHint, normalizeSendShortcut } from "../../chat/sendKeys";
import { acceleratorOf, findConflict, useShortcutBindings } from "../../shortcuts/bindingsStore";
import {
	SHORTCUTS,
	SHORTCUT_GROUP_LABEL,
	shortcutDef,
	type ShortcutDef,
	type ShortcutGroup,
	type ShortcutId,
} from "../../shortcuts/registry";
import { DEFAULT_SETTINGS } from "../store";
import { useAppSettings } from "../useAppSettings";
import { Button, Chip, IconButton, SaveIndicator, SectionHeader, useSaveStatus, type SaveState } from "../ui";
import { eventToAccelerator, formatAccelerator, ShortcutRecorder } from "./ShortcutRecorder";

const MODIFIER_KEY_CODES: Record<string, true> = {
	ShiftLeft: true,
	ShiftRight: true,
	ControlLeft: true,
	ControlRight: true,
	AltLeft: true,
	AltRight: true,
	MetaLeft: true,
	MetaRight: true,
	CapsLock: true,
	Fn: true,
};


const NEEDS_MODIFIER_HINT = "需要同时按住 ⌘ / ⌃ / ⌥ 之一（只加 ⇧ 不行）";

/**
 * Accelerator for an in-window combo, or null when it is unusable: a ⌘/⌃/⌥ modifier is
 * required (bare keys would hijack typing; Shift alone is just a capital letter).
 */
export function inAppAccelerator(e: {
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}): string | null {
	const acc = eventToAccelerator(e);
	if (!acc) return null;
	const mods = acc.split("+").slice(0, -1);
	return mods.some((m) => m !== "Shift") ? acc : null;
}

const GROUP_ORDER: ShortcutGroup[] = ["navigation", "session", "panel", "find", "view"];

/** Shared column template: action | description | key cell (fixed width so capsules line up). */
const ROW_GRID = "grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-x-3 px-3";

/** A key-combo capsule: wide enough for glyph strings like ⌃⌥⇧⌘[ and never wraps. */
const CAPSULE =
	"inline-flex h-6 min-w-[84px] items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-xs transition-all";

function GroupLabel({ children }: { children: ReactNode }) {
	return (
		<div className="border-t border-[var(--border-divider)] bg-[var(--well-bg)] px-3 py-1 text-[11px] font-semibold text-[var(--text-muted)] first:border-t-0">
			{children}
		</div>
	);
}

function TableRow({
	label,
	description,
	control,
	fieldId,
	status = "idle",
	statusError,
	children,
}: {
	label: ReactNode;
	description?: ReactNode;
	control: ReactNode;
	fieldId?: string;
	status?: SaveState;
	statusError?: string | null;
	children?: ReactNode;
}) {
	return (
		<div data-field-id={fieldId} className="border-t border-[var(--border-divider)] py-1 first:border-t-0 hover:bg-[var(--bg-hover)]">
			<div className={ROW_GRID}>
				<span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-[var(--text)]">
					{label}
					<SaveIndicator status={status} error={statusError} />
				</span>
				<span className="text-xs leading-4 text-[var(--text-muted)]">{description}</span>
				<div className="flex min-w-[144px] items-center justify-end gap-1.5">{control}</div>
			</div>
			{children && <div className="px-3 pb-1 pt-1">{children}</div>}
		</div>
	);
}


function FixedCapsule({ combo }: { combo: string }) {
	return (
		<div className="flex items-center gap-1.5">
			<span className={clsx(CAPSULE, "hairline bg-[var(--well-bg)] font-mono tracking-wide text-[var(--text-muted)]")}>
				{combo}
			</span>
			<div className="w-[52px]">
				<Chip>固定</Chip>
			</div>
		</div>
	);
}

interface PendingConflict {
	id: ShortcutId;
	accelerator: string;
	other: ShortcutId;
}

function BindingControl({
	def,
	recording,
	hint,
	onToggleRecording,
	onReset,
}: {
	def: ShortcutDef;
	recording: boolean;
	hint: string | null;
	onToggleRecording: () => void;
	/** Restore the default; resolved by the table so it can ask about conflicts. */
	onReset: () => void;
}) {
	const overrides = useShortcutBindings((s) => s.overrides);
	const setBinding = useShortcutBindings((s) => s.setBinding);
	const id = def.id as ShortcutId;
	const current = acceleratorOf(id, overrides);
	const display = current ? formatAccelerator(current) : "";

	if (!def.editable) return <FixedCapsule combo={display} />;

	return (
		<div className="flex items-center gap-1.5">
			<button
				type="button"
				aria-label={`修改「${def.label}」的快捷键`}
				data-shortcut-recording={recording ? "" : undefined}
				onClick={onToggleRecording}
				className={clsx(
					CAPSULE,
					recording
						? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] font-medium text-[var(--accent)] ring-1 ring-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
						: "hairline bg-[var(--well-bg)] text-[var(--text)] hover:bg-[var(--bg-hover)]",
				)}
			>
				<Keyboard className="h-3.5 w-3.5 shrink-0 opacity-70" />
				{recording ? (
					<span>{hint ?? "请按下组合键，Esc 取消"}</span>
				) : display ? (
					<span className="font-mono tracking-wide">{display}</span>
				) : (
					<span className="text-[var(--text-dim)]">未设置</span>
				)}
			</button>
			<div className="flex w-[52px] items-center gap-0.5">
				{current && !recording && (
					<IconButton size="sm" icon={X} label={`清除「${def.label}」的快捷键`} title="清除（不再响应）" onClick={() => setBinding(id, "")} />
				)}
				{current !== def.defaultAccelerator && !recording && (
					<IconButton
						size="sm"
						icon={RotateCcw}
						label={`恢复「${def.label}」的默认快捷键`}
						title={`恢复默认（${def.defaultAccelerator ? formatAccelerator(def.defaultAccelerator) : "未设置"}）`}
						onClick={onReset}
					/>
				)}
			</div>
		</div>
	);
}

function ConflictNotice({ conflict, onResolve }: { conflict: PendingConflict; onResolve: (takeOver: boolean) => void }) {
	const other = shortcutDef(conflict.other);
	return (
		<div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] px-3 py-2 text-xs">
			<span className="text-[var(--text)]">
				{formatAccelerator(conflict.accelerator)} 与「{other.label}」冲突
				{other.editable ? "" : "，它是固定快捷键，不能更改"}
			</span>
			<span className="ml-auto flex items-center gap-2">
				{other.editable && (
					<Button variant="primary" size="sm" onClick={() => onResolve(true)}>
						改用这个，并取消另一个
					</Button>
				)}
				<Button size="sm" onClick={() => onResolve(false)}>
					放弃
				</Button>
			</span>
		</div>
	);
}

function ShortcutTable() {
	const setBinding = useShortcutBindings((s) => s.setBinding);
	const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
	const [hint, setHint] = useState<string | null>(null);
	const [conflict, setConflict] = useState<PendingConflict | null>(null);

	useEffect(() => {
		if (!recordingId) return;
		const stop = () => {
			setRecordingId(null);
			setHint(null);
		};
		const onKey = (e: KeyboardEvent) => {
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			if (e.code === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
				stop();
				return;
			}
			if (MODIFIER_KEY_CODES[e.code]) {
				const held = formatAccelerator(
					[e.metaKey && "Command", e.ctrlKey && "Control", e.altKey && "Alt", e.shiftKey && "Shift"]
						.filter(Boolean)
						.join("+"),
				);
				setHint(held ? `${held} + 再按一个键` : null);
				return;
			}
			const acc = inAppAccelerator(e);
			if (!acc) {
				setHint(NEEDS_MODIFIER_HINT);
				return;
			}
			const id = recordingId;
			stop();
			if (acc === acceleratorOf(id)) return;
			const other = findConflict(id, acc);
			if (other) setConflict({ id, accelerator: acc, other });
			else {
				setConflict(null);
				setBinding(id, acc);
			}
		};
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("blur", stop);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("blur", stop);
		};
	}, [recordingId, setBinding]);

	const resolve = (takeOver: boolean) => {
		if (conflict && takeOver) {
			setBinding(conflict.other, "");
			setBinding(conflict.id, conflict.accelerator);
		}
		setConflict(null);
	};

	/**
	 * Restore one default. The default chord may now belong to another action
	 * (the user moved that one onto it), so reset goes through the same conflict
	 * check as recording instead of silently creating a double binding.
	 */
	const resetToDefault = (id: ShortcutId) => {
		setHint(null);
		setRecordingId(null);
		const def = shortcutDef(id);
		if (!def.editable) return;
		const acc = def.defaultAccelerator;
		if (acc === acceleratorOf(id)) {
			setConflict(null);
			return;
		}
		if (!acc) {
			setConflict(null);
			setBinding(id, "");
			return;
		}
		const other = findConflict(id, acc);
		if (other) setConflict({ id, accelerator: acc, other });
		else {
			setConflict(null);
			setBinding(id, acc);
		}
	};

	return (
		<>
			{GROUP_ORDER.map((group) => (
				<section key={group} data-jump={SHORTCUT_GROUP_LABEL[group]}>
					<GroupLabel>{SHORTCUT_GROUP_LABEL[group]}</GroupLabel>
					{SHORTCUTS.filter((s) => s.group === group).map((def: ShortcutDef) => {
						const id = def.id as ShortcutId;
						return (
							<TableRow
								key={id}
								fieldId={`shortcut:${id}`}
								label={def.label}
								description={def.description}
								control={
									<BindingControl
										def={def}
										recording={recordingId === id}
										hint={recordingId === id ? hint : null}
										onToggleRecording={() => {
											setConflict(null);
											setHint(null);
											setRecordingId((r) => (r === id ? null : id));
										}}
										onReset={() => resetToDefault(id)}
									/>
								}
							>
								{conflict?.id === id && <ConflictNotice conflict={conflict} onResolve={resolve} />}
							</TableRow>
						);
					})}
				</section>
			))}
		</>
	);
}

export function ShortcutsSection() {
	const { settings, save } = useAppSettings();
	const shortcutSave = useSaveStatus();
	const sendSave = useSaveStatus();
	const overrides = useShortcutBindings((s) => s.overrides);
	const resetAll = useShortcutBindings((s) => s.resetAll);
	const sendShortcut = normalizeSendShortcut(settings?.sendShortcut);
	const changed = Object.keys(overrides).length > 0;

	const onResetAll = async () => {
		if (!changed) return;
		const ok = await confirmDialog("所有应用内快捷键都会恢复成默认组合，你的自定义设置会丢失。", {
			title: "全部恢复默认",
			okLabel: "恢复默认",
		});
		if (ok) resetAll();
	};

	return (
		<div className="space-y-4">
			<SectionHeader
				title="快捷键"
				description="点击右侧的按键框，再按下新的组合键即可更换。"
				actions={
					<Button icon={RotateCcw} disabled={!changed} onClick={() => void onResetAll()}>
						全部恢复默认
					</Button>
				}
			/>

			<div className="overflow-hidden rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card">
				<div className={clsx(ROW_GRID, "border-b border-[var(--border-divider)] py-1.5 text-[11px] text-[var(--text-dim)]")}>
					<span>动作</span>
					<span>说明</span>
					<span className="w-[144px] text-right">快捷键</span>
				</div>
				<ShortcutTable />

				<GroupLabel>输入框</GroupLabel>
				<TableRow
					fieldId="sendShortcut"
					label="发送"
					description="选择用哪个按键发送消息，另一个组合用于换行"
					status={sendSave.status}
					statusError={sendSave.error}
					control={
						<Segmented
							value={sendShortcut}
							onChange={(v) => void sendSave.run(() => save({ sendShortcut: v }))}
							options={[
								{ value: "enter", label: "Enter 发送", title: "Enter 发送，Shift + Enter 换行" },
								{ value: "mod-enter", label: "⌘ Enter 发送", title: "⌘ Enter 发送，Enter 换行" },
							]}
						/>
					}
				/>
				<TableRow
					label="换行"
					description="随上面的发送方式变化"
					control={<FixedCapsule combo={sendShortcut === "mod-enter" ? "Enter" : "⇧Enter"} />}
				/>
				<TableRow
					label="临时换一种发送方式"
					description="AI 还在回复时，对这一条消息改用另一种处理（引导 / 排队 / 打断）"
					control={<FixedCapsule combo={alternateShortcutHint(sendShortcut)} />}
				/>

				<GroupLabel>全局（任何应用里都能用）</GroupLabel>
				<TableRow
					fieldId="quickCaptureShortcut"
					label="快速记录"
					description="弹出快速记录窗口；清除即停用，需包含 ⌘ / ⌃ / ⌥ / ⇧ 之一（F 键除外）"
					status={shortcutSave.status}
					statusError={shortcutSave.error}
					control={
						<ShortcutRecorder
							value={settings?.quickCaptureShortcut ?? ""}
							defaultValue={DEFAULT_SETTINGS.quickCaptureShortcut}
							onCommit={(v) => void shortcutSave.run(() => save({ quickCaptureShortcut: v }))}
						/>
					}
				/>
			</div>
		</div>
	);
}
