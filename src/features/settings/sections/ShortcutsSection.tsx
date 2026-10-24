/**
 * Settings ▸ 快捷键 (`shortcuts`): every keyboard shortcut in one place.
 * In-window combos come from `features/shortcuts` (registry + editable bindings);
 * the system-wide quick-capture key and the send key keep their existing settings
 * persistence and only live here as rows.
 */
import clsx from "clsx";
import { Keyboard, RotateCcw, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../../../stores/language";
import { Segmented } from "../../../components/Segmented";
import { confirmDialog } from "../../../lib/dialogs";
import { alternateShortcutHint, normalizeSendShortcut } from "../../chat/sendKeys";
import { acceleratorOf, findConflict, useShortcutBindings } from "../../shortcuts/bindingsStore";
import {
	SHORTCUTS,
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

const GROUP_TITLE_KEYS: Record<
	ShortcutGroup,
	| "shortcutsSettings.groups.navigation"
	| "shortcutsSettings.groups.session"
	| "shortcutsSettings.groups.panel"
	| "shortcutsSettings.groups.find"
	| "shortcutsSettings.groups.view"
> = {
	navigation: "shortcutsSettings.groups.navigation",
	session: "shortcutsSettings.groups.session",
	panel: "shortcutsSettings.groups.panel",
	find: "shortcutsSettings.groups.find",
	view: "shortcutsSettings.groups.view",
};

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
	const { t } = useT();
	return (
		<div className="flex items-center gap-1.5">
			<span className={clsx(CAPSULE, "hairline bg-[var(--well-bg)] font-mono tracking-wide text-[var(--text-muted)]")}>
				{combo}
			</span>
			<div className="w-[52px]">
				<Chip>{t("shortcutsSettings.fixedCapsule")}</Chip>
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
	const { t } = useT();
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
				aria-label={t("shortcutsSettings.modifyBindingAria", { name: def.label })}
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
					<span>{hint ?? t("shortcutsSettings.recorder.pressCombo")}</span>
				) : display ? (
					<span className="font-mono tracking-wide">{display}</span>
				) : (
					<span className="text-[var(--text-dim)]">{t("shortcutsSettings.notSet")}</span>
				)}
			</button>
			<div className="flex w-[52px] items-center gap-0.5">
				{current && !recording && (
					<IconButton
						size="sm"
						icon={X}
						label={t("shortcutsSettings.clearBindingLabel", { name: def.label })}
						title={t("shortcutsSettings.clearBindingTitle")}
						onClick={() => setBinding(id, "")}
					/>
				)}
				{current !== def.defaultAccelerator && !recording && (
					<IconButton
						size="sm"
						icon={RotateCcw}
						label={t("shortcutsSettings.resetBindingLabel", { name: def.label })}
						title={t("shortcutsSettings.resetBindingTitle", {
							def: def.defaultAccelerator ? formatAccelerator(def.defaultAccelerator) : t("shortcutsSettings.notSet"),
						})}
						onClick={onReset}
					/>
				)}
			</div>
		</div>
	);
}

function ConflictNotice({ conflict, onResolve }: { conflict: PendingConflict; onResolve: (takeOver: boolean) => void }) {
	const { t } = useT();
	const other = shortcutDef(conflict.other);
	return (
		<div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] px-3 py-2 text-xs">
			<span className="text-[var(--text)]">
				{t("shortcutsSettings.conflictNotice", { acc: formatAccelerator(conflict.accelerator), other: other.label })}
				{other.editable ? "" : t("shortcutsSettings.conflictFixed")}
			</span>
			<span className="ml-auto flex items-center gap-2">
				{other.editable && (
					<Button variant="primary" size="sm" onClick={() => onResolve(true)}>
						{t("shortcutsSettings.useThisAndCancelOther")}
					</Button>
				)}
				<Button size="sm" onClick={() => onResolve(false)}>
					{t("shortcutsSettings.cancelConflict")}
				</Button>
			</span>
		</div>
	);
}

function ShortcutTable() {
	const { t } = useT();
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
				setHint(held ? t("shortcutsSettings.recorder.pressAnotherKey", { held }) : null);
				return;
			}
			const acc = inAppAccelerator(e);
			if (!acc) {
				setHint(t("shortcutsSettings.needsModifierHint"));
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
	}, [recordingId, setBinding, t]);

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
			{GROUP_ORDER.map((group) => {
				const groupName = t(GROUP_TITLE_KEYS[group]);
				return (
					<section key={group} data-jump={groupName}>
						<GroupLabel>{groupName}</GroupLabel>
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
				);
			})}
		</>
	);
}

export function ShortcutsSection() {
	const { t } = useT();
	const { settings, save } = useAppSettings();
	const shortcutSave = useSaveStatus();
	const sendSave = useSaveStatus();
	const overrides = useShortcutBindings((s) => s.overrides);
	const resetAll = useShortcutBindings((s) => s.resetAll);
	const sendShortcut = normalizeSendShortcut(settings?.sendShortcut);
	const changed = Object.keys(overrides).length > 0;

	const onResetAll = async () => {
		if (!changed) return;
		const ok = await confirmDialog(t("shortcutsSettings.resetAllConfirm"), {
			title: t("shortcutsSettings.resetAll"),
			okLabel: t("shortcutsSettings.resetAllConfirmOk"),
		});
		if (ok) resetAll();
	};

	return (
		<div className="space-y-4">
			<SectionHeader
				title={t("shortcutsSettings.title")}
				description={t("shortcutsSettings.desc")}
				actions={
					<Button icon={RotateCcw} disabled={!changed} onClick={() => void onResetAll()}>
						{t("shortcutsSettings.resetAll")}
					</Button>
				}
			/>

			<div className="overflow-hidden rounded-xl hairline bg-[var(--bg-panel)] shadow-apple-card">
				<div className={clsx(ROW_GRID, "border-b border-[var(--border-divider)] py-1.5 text-[11px] text-[var(--text-dim)]")}>
					<span>{t("shortcutsSettings.colAction")}</span>
					<span>{t("shortcutsSettings.colDesc")}</span>
					<span className="w-[144px] text-right">{t("shortcutsSettings.colShortcut")}</span>
				</div>
				<ShortcutTable />

				<GroupLabel>{t("shortcutsSettings.groups.composer")}</GroupLabel>
				<TableRow
					fieldId="sendShortcut"
					label={t("shortcutsSettings.sendLabel")}
					description={t("shortcutsSettings.sendDesc")}
					status={sendSave.status}
					statusError={sendSave.error}
					control={
						<Segmented
							value={sendShortcut}
							onChange={(v) => void sendSave.run(() => save({ sendShortcut: v }))}
							options={[
								{ value: "enter", label: t("shortcutsSettings.enterSend"), title: t("shortcutsSettings.enterSendTitle") },
								{ value: "mod-enter", label: t("shortcutsSettings.modEnterSend"), title: t("shortcutsSettings.modEnterSendTitle") },
							]}
						/>
					}
				/>
				<TableRow
					label={t("shortcutsSettings.newlineLabel")}
					description={t("shortcutsSettings.newlineDesc")}
					control={<FixedCapsule combo={sendShortcut === "mod-enter" ? "Enter" : "⇧Enter"} />}
				/>
				<TableRow
					label={t("shortcutsSettings.altSendLabel")}
					description={t("shortcutsSettings.altSendDesc")}
					control={<FixedCapsule combo={alternateShortcutHint(sendShortcut)} />}
				/>

				<GroupLabel>{t("shortcutsSettings.groups.global")}</GroupLabel>
				<TableRow
					fieldId="quickCaptureShortcut"
					label={t("shortcutsSettings.quickCaptureLabel")}
					description={t("shortcutsSettings.quickCaptureDesc")}
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
