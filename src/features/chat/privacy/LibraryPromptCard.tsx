/** [P] Non-blocking post-send card: offer to save this session's new secrets to the library. */

import { X } from "lucide-react";
import { useState } from "react";
import type { SecretEntry } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { privacyUpdate } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";

export function LibraryPromptCard({ entries }: { entries: SecretEntry[] }) {
	// Default: safe entries checked, risky unchecked.
	const [unchecked, setUnchecked] = useState<Record<string, boolean>>({});
	const [saving, setSaving] = useState(false);
	const isChecked = (e: SecretEntry) => !(unchecked[e.id] ?? e.risk === "risky");

	const finish = async (save: boolean) => {
		if (saving) return;
		setSaving(true);
		try {
			await Promise.all(
				entries.map((e) =>
					privacyUpdate(e.id, {
						libraryPrompted: true,
						...(save && isChecked(e) ? { inLibrary: true } : {}),
					}),
				),
			);
		} catch (err) {
			toast.error(`保存隐私库失败: ${errMsg(err)}`);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="mb-2 rounded-xl border border-[var(--line,var(--border))] bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-[var(--text)] shadow-sm">
			<div className="mb-1 flex items-center justify-between">
				<span className="font-medium">保存到隐私库？以后在其他会话中也会自动替换</span>
				<button
					type="button"
					aria-label="不保存"
					onClick={() => void finish(false)}
					className="text-[var(--text-40,var(--text-dim))] hover:text-[var(--text)]"
				>
					<X size={12} />
				</button>
			</div>
			<div className="flex flex-col gap-0.5">
				{entries.map((e) => (
					<label key={e.id} className="flex items-center gap-1.5">
						<input
							type="checkbox"
							checked={isChecked(e)}
							onChange={(ev) => setUnchecked((u) => ({ ...u, [e.id]: !ev.target.checked }))}
						/>
						{e.risk === "risky" && <span title="比较短/常见，可能误伤普通文字">⚠</span>}
						<span className="truncate">{e.label ?? "未命名"}</span>
						<span className="truncate font-mono text-[11px] text-[var(--text-40,var(--text-dim))]">
							{e.placeholder}
						</span>
					</label>
				))}
			</div>
			<div className="mt-1.5 flex justify-end gap-1">
				<button
					type="button"
					disabled={saving}
					onClick={() => void finish(false)}
					className="rounded-md px-2.5 py-0.5 hover:bg-[var(--ghost-hover,var(--bg-hover))] disabled:opacity-50"
				>
					不保存
				</button>
				<button
					type="button"
					disabled={saving}
					onClick={() => void finish(true)}
					className="rounded-md bg-[var(--text)] px-2.5 py-0.5 text-[var(--bg-panel)] disabled:opacity-50"
				>
					保存
				</button>
			</div>
		</div>
	);
}
