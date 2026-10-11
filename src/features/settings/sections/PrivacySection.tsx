/** [P] Settings ▸ 隐私库 (`privacy`): default reveal, native secrets status and
 * the library of marked values (placeholders sent upstream instead of values). */
import { AlertTriangle, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SecretEntry, SecretEntryPatch } from "../../../lib/contracts";
import { confirmDialog, errMsg } from "../../../lib/dialogs";
import { privacyDelete, privacyMark, privacyUpdate } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { usePrivacy } from "../../../stores/privacy";
import { useAppSettings } from "../useAppSettings";
import {
	CommitInput,
	INPUT_CLASS,
	SETTINGS_BUTTON_CLASS,
	SectionHeader,
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

const ICON_BTN =
	"flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200";

async function patchEntry(id: string, patch: SecretEntryPatch): Promise<void> {
	try {
		await privacyUpdate(id, patch);
		await usePrivacy.getState().load();
	} catch (err) {
		toast.error(`保存失败: ${privacyErr(err)}`);
		throw err;
	}
}

/** Confirm a change that stops protecting sessions the entry is linked to (§ privacy prefix rule). */
async function confirmUnprotect(entry: SecretEntry, action: "delete" | "untrack"): Promise<boolean> {
	if (entry.sessionCount <= 0) return true;
	const what = action === "delete" ? "删除这个条目" : "关闭追踪";
	return confirmDialog(
		`这个条目已关联 ${entry.sessionCount} 个会话。${what}后，这些会话之后的请求会重新以明文发送这个值，并且请求前缀会改变，可能使缓存失效、增加费用。`,
		{
			title: action === "delete" ? "删除后将不再保护这些会话" : "关闭追踪后将不再保护这些会话",
			danger: true,
			okLabel: action === "delete" ? "仍然删除" : "仍然关闭追踪",
		},
	);
}

function EntryRow({ entry }: { entry: SecretEntry }) {
	const [revealed, setRevealed] = useState(false);
	const risky = entry.risk === "risky";
	const remove = async () => {
		if (!(await confirmUnprotect(entry, "delete"))) return;
		const ok = await confirmDialog("删除后，历史里的这个占位符将无法还原", {
			title: "彻底删除隐私条目",
			danger: true,
			okLabel: "删除",
		});
		if (!ok) return;
		try {
			await privacyDelete(entry.id);
			await usePrivacy.getState().load();
		} catch (err) {
			toast.error(`删除失败: ${privacyErr(err)}`);
		}
	};
	return (
		<div className="flex flex-col gap-1.5 px-3 py-2.5">
			<div className="flex items-center gap-2">
				<span title={risky ? "较短或常见，可能误伤普通文字" : "可安全自动替换"}>{risky ? "🟡" : "🟢"}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-200">
					{revealed ? entry.value : "•".repeat(Math.min(entry.value.length, 12))}
				</span>
				<span className="truncate font-mono text-[11px] text-neutral-500" title="AI 看到的占位符，创建后固定不变">
					{entry.placeholder}
				</span>
				<button
					type="button"
					className={ICON_BTN}
					onClick={() => setRevealed((v) => !v)}
					title={revealed ? "隐藏" : "显示真实值"}
					aria-label={revealed ? "隐藏" : "显示真实值"}
				>
					{revealed ? <EyeOff size={13} /> : <Eye size={13} />}
				</button>
				<button type="button" className={ICON_BTN} onClick={() => void remove()} title="彻底删除" aria-label="彻底删除">
					<Trash2 size={13} />
				</button>
			</div>
			<div className="flex flex-wrap items-center gap-2 ps-6">
				<CommitInput
					value={entry.label ?? ""}
					onCommit={(next) => patchEntry(entry.id, { label: next })}
					placeholder="显示名称（选填）"
					className="w-48"
					aria-label="名称"
				/>
				{risky && (
					<label className="flex items-center gap-1 text-[11px] text-neutral-400">
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
				<button
					type="button"
					className="text-[11px] text-neutral-400 hover:text-neutral-200"
					onClick={() => void patchEntry(entry.id, { inLibrary: !entry.inLibrary })}
				>
					{entry.inLibrary ? "移出隐私库" : "加入隐私库"}
				</button>
			</div>
		</div>
	);
}

function AddEntryForm() {
	const [value, setValue] = useState("");
	const [label, setLabel] = useState("");
	const [busy, setBusy] = useState(false);
	const add = async () => {
		if (!value) return;
		setBusy(true);
		try {
			const entry = await privacyMark(null, value, label.trim() || null, true);
			if (!entry.inLibrary) await privacyUpdate(entry.id, { inLibrary: true, libraryPrompted: true });
			await usePrivacy.getState().load();
			setValue("");
			setLabel("");
		} catch (err) {
			toast.error(`添加失败: ${privacyErr(err)}`);
		} finally {
			setBusy(false);
		}
	};
	return (
		<form
			className="flex flex-wrap items-center gap-2 px-3 py-2.5"
			onSubmit={(e) => {
				e.preventDefault();
				void add();
			}}
		>
			<input
				className={`${INPUT_CLASS} min-w-0 flex-1 font-mono`}
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="隐私内容，如密码、IP、用户名"
				aria-label="隐私内容"
			/>
			<input
				className={`${INPUT_CLASS} w-40`}
				value={label}
				onChange={(e) => setLabel(e.target.value)}
				placeholder="名称（选填）"
				aria-label="名称"
			/>
			<button type="submit" className={SETTINGS_BUTTON_CLASS} disabled={busy || !value}>
				<Plus size={13} />
				添加
			</button>
		</form>
	);
}

export function PrivacySection() {
	const { settings, save } = useAppSettings();
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
			<SectionHeader
				title="隐私库"
				description="标记过的内容发给 AI 时会替换成占位符，只在本机执行工具前还原。占位符文本创建后固定不变，修改名称只影响界面显示"
			/>

			{nativeStatus !== "ok" && (
				<div className="flex items-start gap-2 rounded-xl hairline bg-[var(--bg-panel)] px-3 py-2.5 text-xs text-neutral-300">
					<AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--status-warning)]" />
					<span>
						{nativeStatus === "conflict"
							? "OMP 的 secrets.yml 不是列表格式，无法自动合并。为防泄露，压缩上下文会被暂停，请检查该文件。"
							: `隐私条目未写入 OMP secrets.yml，为防泄露，压缩上下文会被暂停${nativeError ? `：${nativeError}` : ""}`}
					</span>
				</div>
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

			<SettingsCard title="隐私库" footer="隐私库中的内容在所有会话里都会被自动识别并替换">
				{library.map((e) => (
					<EntryRow key={e.id} entry={e} />
				))}
				{library.length === 0 && <div className="px-3 py-2.5 text-xs text-neutral-500">隐私库为空</div>}
				<AddEntryForm />
			</SettingsCard>

			{sessionOnly.length > 0 && (
				<SettingsCard title="仅在会话中标记" footer="只在标记过它们的会话里自动替换">
					{sessionOnly.map((e) => (
						<EntryRow key={e.id} entry={e} />
					))}
				</SettingsCard>
			)}
		</div>
	);
}
