/** [P] Settings ▸ 隐私 (`privacy`): default reveal, native secrets status, the library of marked
 * values (placeholders sent upstream instead of values) and the omp privacy keys. */
import { Edit2, Eye, EyeOff, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEscapeKey } from "../../../lib/hooks";
import type { SecretEntry, SecretEntryPatch } from "../../../lib/contracts";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { privacyDelete, privacyMark, privacyUpdate } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { usePrivacy } from "../../../stores/privacy";
import { useAppSettings } from "../useAppSettings";
import { OmpSections } from "../OmpSettingsList";
import {
	Button,
	Chip,
	EmptyState,
	INPUT_CLASS,
	IconButton,
	Notice,
	SectionHeader,
	SettingRow,
	SettingsCard,
	ToggleRow,
} from "../ui";

const ERROR_TEXT: Record<string, string> = {
	TOO_SHORT: "内容太短（至少 3 个字符）",
	INVALID_VALUE: "内容不能包含换行，且不超过 4096 个字符",
	LABEL_CONTAINS_VALUE: "名称不能包含隐私内容本身",
};

function privacyErr(err: unknown): string {
	const msg = errMsg(err);
	return ERROR_TEXT[msg] ?? msg;
}

async function patchEntry(id: string, patch: SecretEntryPatch): Promise<void> {
	try {
		await privacyUpdate(id, patch);
		await usePrivacy.getState().load();
	} catch (err) {
		toast.error(`保存失败：${privacyErr(err)}`);
		throw err;
	}
}

/** Confirm a change that stops protecting sessions the entry is linked to (§ privacy prefix rule). */
async function confirmUnprotect(entry: SecretEntry, action: "delete" | "untrack"): Promise<boolean> {
	if (entry.sessionCount <= 0) return true;
	const what = action === "delete" ? "删除这项内容" : "关闭追踪";
	return confirmDialog(
		`这项内容已在 ${entry.sessionCount} 个会话中使用。${what}后，之后的请求会重新以明文发送该内容，并可能导致缓存失效、增加费用。`,
		{
			title: action === "delete" ? "删除后将不再保护这些会话" : "关闭追踪后将不再保护这些会话",
			danger: true,
			okLabel: action === "delete" ? "仍然删除" : "仍然关闭追踪",
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
	const [revealed, setRevealed] = useState(false);
	const risky = entry.risk === "risky";
	const remove = async () => {
		if (!(await confirmUnprotect(entry, "delete"))) return;
		const ok = await confirmDialog("删除后，历史里的占位符将无法还原", {
			title: "彻底删除",
			danger: true,
			okLabel: "删除",
		});
		if (!ok) return;
		try {
			await privacyDelete(entry.id);
			await usePrivacy.getState().load();
		} catch (err) {
			toast.error(`删除失败：${privacyErr(err)}`);
		}
	};
	return (
		<div className="flex flex-col gap-1 px-3 py-2.5">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text)]">
					{entry.label || "未命名"}
				</span>
				{risky ? (
					<Chip tone="warning" title="较短或常见，可能误伤普通文字">
						易误伤
					</Chip>
				) : (
					<Chip tone="success" title="可安全自动替换">
						可自动替换
					</Chip>
				)}
				<IconButton size="sm" icon={Edit2} label="编辑备注" onClick={() => onEdit(entry)} />
				<IconButton
					size="sm"
					icon={revealed ? EyeOff : Eye}
					label={revealed ? "隐藏" : "显示真实值"}
					onClick={() => setRevealed((v) => !v)}
				/>
				<IconButton size="sm" variant="danger" icon={Trash2} label="彻底删除" onClick={() => void remove()} />
			</div>
			<div className="flex items-center gap-2 ps-4">
				<span className="min-w-0 truncate px-1.5 font-mono text-xs text-[var(--text-muted)]">
					{revealed ? entry.value : "•".repeat(Math.min(entry.value.length, 12))}
				</span>
				<span className="shrink-0 truncate font-mono text-xs text-[var(--text-dim)]" title="AI 看到的占位符，创建后固定不变">
					→ 占位符：{entry.placeholder}
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
						不追踪（只还原已标记处）
					</label>
				)}
				<Button
					size="sm"
					variant="ghost"
					onClick={() => void patchEntry(entry.id, { inLibrary: !entry.inLibrary })}
				>
					{entry.inLibrary ? "移出隐私库" : "加入隐私库"}
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
			toast.success("已添加到隐私库");
			onClose();
		} catch (err) {
			toast.error(`添加失败：${privacyErr(err)}`);
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
					if (e.key === "Enter" && !e.shiftKey && value.trim() && !busy) {
						e.preventDefault();
						void add();
					}
				}}
			>
				<div className="flex items-center justify-between pb-3 border-b border-[var(--border-divider)]">
					<h3 className="text-sm font-semibold text-[var(--text)]">添加保护内容</h3>
					<IconButton icon={X} label="关闭" disabled={busy} onClick={onClose} />
				</div>

				<div className="space-y-3.5 py-4">
					<div className="space-y-1.5">
						<label className="text-[11.5px] font-medium text-[var(--text-muted)]">
							隐私内容（密码、Token、私钥等）
						</label>
						<input
							ref={valueInputRef}
							className={`${INPUT_CLASS} w-full font-mono text-xs`}
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder="输入需要脱敏的敏感信息"
							aria-label="隐私内容"
						/>
						<p className="text-[11px] text-[var(--text-dim)]">
							发给 AI 时会自动替换为安全占位符，仅在本地终端执行工具前还原。
						</p>
					</div>

					<div className="space-y-1.5">
						<label className="text-[11.5px] font-medium text-[var(--text-muted)]">
							备注名称（选填）
						</label>
						<input
							className={`${INPUT_CLASS} w-full text-xs`}
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="如：知返_ssh_密码"
							aria-label="备注名称"
						/>
						<p className="text-[11px] text-[var(--text-dim)]">
							给自己看的别名；不填会自动生成代号。
						</p>
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-divider)]">
					<Button variant="ghost" disabled={busy} onClick={onClose}>
						取消
					</Button>
					<Button variant="primary" disabled={!value.trim()} loading={busy} onClick={() => void add()}>
						{busy ? "正在添加" : "添加"}
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
			toast.success("已更新备注");
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
					if (e.key === "Enter" && !e.shiftKey && !busy) {
						e.preventDefault();
						void save();
					}
				}}
			>
				<div className="flex items-center justify-between pb-3 border-b border-[var(--border-divider)]">
					<h3 className="text-sm font-semibold text-[var(--text)]">编辑保护信息</h3>
					<IconButton icon={X} label="关闭" disabled={busy} onClick={onClose} />
				</div>

				<div className="space-y-3.5 py-4">
					<div className="space-y-1.5">
						<label className="text-[11.5px] font-medium text-[var(--text-muted)]">
							备注名称
						</label>
						<input
							ref={labelInputRef}
							className={`${INPUT_CLASS} w-full text-xs`}
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="如：知返_ssh_密码"
							aria-label="备注名称"
						/>
						<p className="text-[11px] text-[var(--text-dim)]">
							用于在界面上标识该项；修改后立即生效。
						</p>
					</div>

					<div className="space-y-1.5">
						<label className="text-[11.5px] font-medium text-[var(--text-muted)]">
							占位符（系统分配）
						</label>
						<input
							className={`${INPUT_CLASS} w-full font-mono text-xs opacity-60 cursor-not-allowed`}
							value={entry.placeholder}
							readOnly
							disabled
							aria-label="占位符"
						/>
						<p className="text-[11px] text-[var(--text-dim)]">
							占位符在首次创建时已固定，发给 AI 时始终使用此代号。
						</p>
					</div>
				</div>

				<div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-divider)]">
					<Button variant="ghost" disabled={busy} onClick={onClose}>
						取消
					</Button>
					<Button variant="primary" loading={busy} onClick={() => void save()}>
						{busy ? "正在保存" : "保存修改"}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function PrivacySection() {
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
			<SectionHeader title="隐私" description="隐私库里的敏感信息如何替换，以及 omp 的密钥脱敏和数据上报" />

			{nativeStatus !== "ok" && (
				<Notice tone="warning">
					{nativeStatus === "conflict"
						? "omp 的 secrets.yml 不是列表格式，无法自动合并。为防泄露，压缩上下文会被暂停，请检查该文件。"
						: `隐私设置未写入 omp 的 secrets.yml，为防泄露，压缩上下文会被暂停${nativeError ? `：${nativeError}` : ""}`}
				</Notice>
			)}

			<SettingsCard title="显示">
				<ToggleRow
					fieldId="privacyRevealDefault"
					label="默认显示真实值"
					description="对话中的占位符默认显示为真实内容；关闭后显示名称，点击可临时切换"
					checked={settings?.privacyRevealDefault ?? true}
					onChange={(v) => save({ privacyRevealDefault: v })}
				/>
			</SettingsCard>

			<SettingsCard
				title="隐私库"
				description="标记过的内容发给 AI 时会替换成占位符，只在本机执行工具前还原；占位符创建后固定不变，修改名称只影响界面显示。"
				footer="隐私库中的内容在所有会话里都会被自动识别并替换。"
			>
				<SettingRow
					label={`已保护 ${library.length} 项`}
					control={
						<Button variant="primary" icon={Plus} onClick={() => setAddModalOpen(true)}>
							添加
						</Button>
					}
				/>
				{library.map((e) => (
					<EntryRow key={e.id} entry={e} onEdit={setEditingEntry} />
				))}
				{library.length === 0 && <EmptyState icon={ShieldCheck} title="暂无保护内容" description="点击「添加」把密码、Token 等敏感信息放进隐私库。" />}
			</SettingsCard>

			<AddSecretDialog open={addModalOpen} onClose={() => setAddModalOpen(false)} />
			<EditSecretDialog entry={editingEntry} onClose={() => setEditingEntry(null)} />

			{sessionOnly.length > 0 && (
				<SettingsCard title="仅在会话中标记" footer="只在标记过它们的会话里自动替换">
					{sessionOnly.map((e) => (
						<EntryRow key={e.id} entry={e} onEdit={setEditingEntry} />
					))}
				</SettingsCard>
			)}

			{library.length > 0 && (
				<Notice tone="info">
					隐私库里有内容时，omp 的「密钥脱敏」会在会话启动时自动开启，不需要在下面手动打开。
				</Notice>
			)}
			<OmpSections page="privacy" />
		</div>
	);
}
