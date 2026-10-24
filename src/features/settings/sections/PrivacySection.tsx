/** [P] Settings ▸ 隐私 (`privacy`): default reveal, native secrets status, the library of marked
 * values (placeholders sent upstream instead of values) and the omp privacy keys. */
import { Edit2, Eye, EyeOff, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tNow, useT } from "../../../stores/language";
import { isComposing, useEscapeKey } from "../../../lib/hooks";
import type { SecretEntry, SecretEntryPatch } from "../../../lib/contracts";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { privacyDelete, privacyMark, privacyUpdate } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { usePrivacy } from "../../../stores/privacy";
import { useAppSettings } from "../useAppSettings";
import { OmpSections } from "../OmpSettingsList";
import { EmptyState } from "../../../components/EmptyState";
import { Notice } from "../../../components/Notice";
import {
	Button,
	Chip,
	INPUT_CLASS,
	IconButton,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
} from "../ui";
import { SectionJumpBar } from "../SectionJumpBar";

function privacyErr(err: unknown): string {
	const msg = errMsg(err);
	if (msg === "TOO_SHORT") return tNow("settingsSectionsPrivacy.privacy.errorTooShort");
	if (msg === "INVALID_VALUE") return tNow("settingsSectionsPrivacy.privacy.errorInvalidValue");
	if (msg === "LABEL_CONTAINS_VALUE") return tNow("settingsSectionsPrivacy.privacy.errorLabelContainsValue");
	return msg;
}

async function patchEntry(id: string, patch: SecretEntryPatch): Promise<void> {
	try {
		await privacyUpdate(id, patch);
		await usePrivacy.getState().load();
	} catch (err) {
		toast.error(tNow("settingsSectionsPrivacy.privacy.saveFailed", { error: privacyErr(err) }));
		throw err;
	}
}

/** Confirm a change that stops protecting sessions the entry is linked to (§ privacy prefix rule). */
async function confirmUnprotect(entry: SecretEntry, action: "delete" | "untrack"): Promise<boolean> {
	if (entry.sessionCount <= 0) return true;
	const what = action === "delete" ? tNow("settingsSectionsPrivacy.privacy.unprotectWhatDelete") : tNow("settingsSectionsPrivacy.privacy.unprotectWhatUntrack");
	return confirmDialog(
		tNow("settingsSectionsPrivacy.privacy.unprotectConfirm", { count: entry.sessionCount, what }),
		{
			title: action === "delete" ? tNow("settingsSectionsPrivacy.privacy.unprotectTitleDelete") : tNow("settingsSectionsPrivacy.privacy.unprotectTitleUntrack"),
			danger: true,
			okLabel: action === "delete" ? tNow("settingsSectionsPrivacy.privacy.unprotectOkDelete") : tNow("settingsSectionsPrivacy.privacy.unprotectOkUntrack"),
		},
	);
}

function EntryRow({
	entry,
	onEdit,
}: {
	entry: SecretEntry;
	onEdit: (entry: SecretEntry) => void;
}) {
	const { t } = useT();
	const [revealed, setRevealed] = useState(false);
	const risky = entry.risk === "risky";
	const remove = async () => {
		if (!(await confirmUnprotect(entry, "delete"))) return;
		const ok = await confirmDialog(t("settingsSectionsPrivacy.privacy.deletePermanentConfirm"), {
			title: t("settingsSectionsPrivacy.privacy.deletePermanentTitle"),
			danger: true,
			okLabel: t("settingsSectionsPrivacy.privacy.deletePermanentOk"),
		});
		if (!ok) return;
		try {
			await privacyDelete(entry.id);
			await usePrivacy.getState().load();
		} catch (err) {
			toast.error(t("settingsSectionsPrivacy.privacy.deleteFailed", { error: privacyErr(err) }));
		}
	};
	return (
		<div className="flex flex-col gap-1 px-3 py-2.5">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
					{entry.label || t("settingsSectionsPrivacy.privacy.unnamed")}
				</span>
				{risky ? (
					<Chip tone="warning" title={t("settingsSectionsPrivacy.privacy.riskyChipTitle")}>
						{t("settingsSectionsPrivacy.privacy.riskyChip")}
					</Chip>
				) : (
					<Chip tone="success" title={t("settingsSectionsPrivacy.privacy.safeChipTitle")}>
						{t("settingsSectionsPrivacy.privacy.safeChip")}
					</Chip>
				)}
				<IconButton size="sm" icon={Edit2} label={t("settingsSectionsPrivacy.privacy.editLabelAria")} onClick={() => onEdit(entry)} />
				<IconButton
					size="sm"
					icon={revealed ? EyeOff : Eye}
					label={revealed ? t("settingsSectionsPrivacy.privacy.hideValueAria") : t("settingsSectionsPrivacy.privacy.showValueAria")}
					onClick={() => setRevealed((v) => !v)}
				/>
				<IconButton size="sm" variant="danger" icon={Trash2} label={t("settingsSectionsPrivacy.privacy.deletePermanentAria")} onClick={() => void remove()} />
			</div>
			<div className="flex items-center gap-2 ps-4">
				<span className="min-w-0 truncate px-1.5 font-mono text-xs text-[var(--text-muted)]">
					{revealed ? entry.value : "•".repeat(Math.min(entry.value.length, 12))}
				</span>
				<span className="shrink-0 truncate font-mono text-xs text-[var(--text-dim)]" title={t("settingsSectionsPrivacy.privacy.placeholderTitle")}>
					{t("settingsSectionsPrivacy.privacy.placeholderPrefix", { placeholder: entry.placeholder })}
				</span>
			</div>
			<div className="flex flex-wrap items-center gap-2 ps-4">
				{risky && (
					<label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
						<input
							type="checkbox"
							checked={!entry.track}
							onChange={(e) => {
								const track = !e.target.checked;
								void (async () => {
									if (!track && !(await confirmUnprotect(entry, "untrack"))) return;
									await patchEntry(entry.id, { track }).catch(() => undefined);
								})();
							}}
						/>
						{t("settingsSectionsPrivacy.privacy.untrackLabel")}
					</label>
				)}
				<Button
					size="sm"
					variant="ghost"
					onClick={() => void patchEntry(entry.id, { inLibrary: !entry.inLibrary })}
				>
					{entry.inLibrary ? t("settingsSectionsPrivacy.privacy.removeFromLibrary") : t("settingsSectionsPrivacy.privacy.addToLibrary")}
				</Button>
			</div>
		</div>
	);
}

function AddSecretDialog({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	const { t } = useT();
	const [value, setValue] = useState("");
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);
	const valueInputRef = useRef<HTMLInputElement>(null);

	useEscapeKey(() => {
		if (!busy) onClose();
	}, open);

	useEffect(() => {
		if (open) {
			setValue("");
			setLabel("");
			setTimeout(() => valueInputRef.current?.focus(), 50);
		}
	}, [open]);

	if (!open) return null;

	const add = async () => {
		if (!value.trim()) return;
		setBusy(true);
		try {
			const entry = await privacyMark(null, value.trim(), label.trim() || null, true);
			if (!entry.inLibrary) await privacyUpdate(entry.id, { inLibrary: true, libraryPrompted: true });
			await usePrivacy.getState().load();
			toast.success(t("settingsSectionsPrivacy.privacy.addSuccess"));
			onClose();
		} catch (err) {
			toast.error(t("settingsSectionsPrivacy.privacy.addFailed", { error: privacyErr(err) }));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !busy) onClose();
			}}
		>
			<div
				className="w-[440px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-5 shadow-apple-modal text-[var(--text)] transition-all animate-in zoom-in-95 duration-150"
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !isComposing(e) && value.trim() && !busy) {
						e.preventDefault();
						void add();
					}
				}}
			>
				<div className="flex items-center justify-between pb-3 border-b border-[var(--border-divider)]">
					<h3 className="text-sm font-semibold text-[var(--text)]">{t("settingsSectionsPrivacy.privacy.addTitle")}</h3>
					<IconButton icon={X} label={t("settingsSectionsPrivacy.privacy.closeAria")} disabled={busy} onClick={onClose} />
				</div>

				<div className="space-y-3.5 py-4">
					<div className="space-y-1.5">
						<label className="text-[11.5px] font-medium text-[var(--text-muted)]">
							{t("settingsSectionsPrivacy.privacy.valueLabel")}
						</label>
						<input
							ref={valueInputRef}
							className={`${INPUT_CLASS} w-full font-mono text-xs`}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder={t("settingsSectionsPrivacy.privacy.valuePlaceholder")}
							aria-label={t("settingsSectionsPrivacy.privacy.valueAria")}
						/>
						<p className="text-[11px] text-[var(--text-dim)]">
							{t("settingsSectionsPrivacy.privacy.valueHint")}
						</p>
					</div>

					<div className="space-y-1.5">
						<label className="text-[11.5px] font-medium text-[var(--text-muted)]">
							{t("settingsSectionsPrivacy.privacy.labelLabel")}
						</label>
						<input
							className={`${INPUT_CLASS} w-full text-xs`}
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder={t("settingsSectionsPrivacy.privacy.labelPlaceholder")}
							aria-label={t("settingsSectionsPrivacy.privacy.labelAria")}
						/>
						<p className="text-[11px] text-[var(--text-dim)]">
							{t("settingsSectionsPrivacy.privacy.labelHint")}
						</p>
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-divider)]">
					<Button variant="ghost" disabled={busy} onClick={onClose}>
						{t("settingsSectionsPrivacy.privacy.cancel")}
					</Button>
					<Button variant="primary" disabled={!value.trim()} loading={busy} onClick={() => void add()}>
						{busy ? t("settingsSectionsPrivacy.privacy.adding") : t("settingsSectionsPrivacy.privacy.add")}
					</Button>
				</div>
			</div>
		</div>
	);
}

function EditSecretDialog({
	entry,
	onClose,
}: {
	entry: SecretEntry | null;
	onClose: () => void;
}) {
	const { t } = useT();
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);
	const labelInputRef = useRef<HTMLInputElement>(null);

	useEscapeKey(() => {
		if (!busy) onClose();
	}, Boolean(entry));

	useEffect(() => {
		if (entry) {
			setLabel(entry.label ?? "");
			setTimeout(() => labelInputRef.current?.focus(), 50);
		}
	}, [entry]);

	if (!entry) return null;

	const save = async () => {
		setBusy(true);
		try {
			await patchEntry(entry.id, { label: label.trim() });
			toast.success(t("settingsSectionsPrivacy.privacy.updateLabelSuccess"));
			onClose();
		} catch {
			// error handled in patchEntry
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-150"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !busy) onClose();
			}}
		>
			<div
				className="w-[440px] max-w-[calc(100vw-2rem)] rounded-2xl border border-[var(--border-divider)] bg-[var(--bg-panel)] p-5 shadow-apple-modal text-[var(--text)] transition-all animate-in zoom-in-95 duration-150"
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !isComposing(e) && !busy) {
						e.preventDefault();
						void save();
					}
				}}
			>
				<div className="flex items-center justify-between pb-3 border-b border-[var(--border-divider)]">
					<h3 className="text-sm font-semibold text-[var(--text)]">{t("settingsSectionsPrivacy.privacy.editTitle")}</h3>
					<IconButton icon={X} label={t("settingsSectionsPrivacy.privacy.closeAria")} disabled={busy} onClick={onClose} />
				</div>

				<div className="space-y-3.5 py-4">
					<div className="space-y-1.5">
						<label className="text-[11.5px] font-medium text-[var(--text-muted)]">
							{t("settingsSectionsPrivacy.privacy.labelLabel")}
						</label>
						<input
							ref={labelInputRef}
							className={`${INPUT_CLASS} w-full text-xs`}
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder={t("settingsSectionsPrivacy.privacy.labelPlaceholder")}
							aria-label={t("settingsSectionsPrivacy.privacy.labelAria")}
						/>
						<p className="text-[11px] text-[var(--text-dim)]">
							{t("settingsSectionsPrivacy.privacy.editLabelHint")}
						</p>
					</div>

					<div className="space-y-1.5">
						<label className="text-[11.5px] font-medium text-[var(--text-muted)]">
							{t("settingsSectionsPrivacy.privacy.placeholderLabel")}
						</label>
						<input
							className={`${INPUT_CLASS} w-full font-mono text-xs opacity-60 cursor-not-allowed`}
							value={entry.placeholder}
							readOnly
							disabled
							aria-label={t("settingsSectionsPrivacy.privacy.placeholderAria")}
						/>
						<p className="text-[11px] text-[var(--text-dim)]">
							{t("settingsSectionsPrivacy.privacy.placeholderHint")}
						</p>
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-divider)]">
					<Button variant="ghost" disabled={busy} onClick={onClose}>
						{t("settingsSectionsPrivacy.privacy.cancel")}
					</Button>
					<Button variant="primary" loading={busy} onClick={() => void save()}>
						{busy ? t("settingsSectionsPrivacy.privacy.saving") : t("settingsSectionsPrivacy.privacy.saveChanges")}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function PrivacySection() {
	const { t } = useT();
	const { settings, save } = useAppSettings();
	const [addModalOpen, setAddModalOpen] = useState(false);
	const [editingEntry, setEditingEntry] = useState<SecretEntry | null>(null);
	const entries = usePrivacy((s) => s.entries);
	const nativeStatus = usePrivacy((s) => s.nativeStatus);
	const nativeError = usePrivacy((s) => s.nativeError);
	useEffect(() => {
		void usePrivacy.getState().load();
	}, []);
	const library = entries.filter((e) => e.inLibrary);
	const sessionOnly = entries.filter((e) => !e.inLibrary);

	return (
		<div className="space-y-6">
			<SectionHeader title={t("settingsSectionsPrivacy.privacy.title")} description={t("settingsSectionsPrivacy.privacy.description")} />
			<SectionJumpBar />

			{nativeStatus !== "ok" && (
				<Notice tone="warning">
					{nativeStatus === "conflict"
						? t("settingsSectionsPrivacy.privacy.conflictNotice")
						: t("settingsSectionsPrivacy.privacy.notWrittenNotice", { error: nativeError ? t("settingsSectionsPrivacy.privacy.errorSuffix", { error: nativeError }) : "" })}
				</Notice>
			)}

			<SettingsCard jump={t("settingsSectionsPrivacy.privacy.jumpDisplay")} title={t("settingsSectionsPrivacy.privacy.titleDisplay")}>
				<ToggleRow
					fieldId="privacyRevealDefault"
					label={t("settingsSectionsPrivacy.privacy.revealDefaultLabel")}
					description={t("settingsSectionsPrivacy.privacy.revealDefaultDesc")}
					checked={settings?.privacyRevealDefault ?? true}
					onChange={(v) => save({ privacyRevealDefault: v })}
				/>
			</SettingsCard>

			<SettingsCard jump={t("settingsSectionsPrivacy.privacy.jumpLibrary")}
				title={t("settingsSectionsPrivacy.privacy.titleLibrary")}
				description={t("settingsSectionsPrivacy.privacy.descLibrary")}
				footer={t("settingsSectionsPrivacy.privacy.footerLibrary")}
			>
				<SettingRow
					label={t("settingsSectionsPrivacy.privacy.protectedCount", { count: library.length })}
					control={
						<Button variant="primary" icon={Plus} onClick={() => setAddModalOpen(true)}>
							{t("settingsSectionsPrivacy.privacy.addProtectedBtn")}
						</Button>
					}
				/>
				{library.map((e) => (
					<EntryRow key={e.id} entry={e} onEdit={setEditingEntry} />
				))}
				{library.length === 0 && <EmptyState icon={ShieldCheck} title={t("settingsSectionsPrivacy.privacy.emptyTitle")} description={t("settingsSectionsPrivacy.privacy.emptyDesc")} />}
			</SettingsCard>

			<AddSecretDialog open={addModalOpen} onClose={() => setAddModalOpen(false)} />
			<EditSecretDialog entry={editingEntry} onClose={() => setEditingEntry(null)} />

			{sessionOnly.length > 0 && (
				<SettingsCard jump={t("settingsSectionsPrivacy.privacy.jumpSessionOnly")} title={t("settingsSectionsPrivacy.privacy.titleSessionOnly")} footer={t("settingsSectionsPrivacy.privacy.footerSessionOnly")}>
					{sessionOnly.map((e) => (
						<EntryRow key={e.id} entry={e} onEdit={setEditingEntry} />
					))}
				</SettingsCard>
			)}

			{library.length > 0 && (
				<Notice tone="info">
					{t("settingsSectionsPrivacy.privacy.autoEnableNotice")}
				</Notice>
			)}
			<OmpSections page="privacy" />
		</div>
	);
}
