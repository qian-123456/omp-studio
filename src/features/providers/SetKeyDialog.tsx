import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import type { KeyMode, ProviderRow } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { toast } from "../../lib/toast";
import { KeyModeRadio } from "./KeyModeRadio";
import { useProviders } from "./store";

/** 设置密钥: type a key for any provider row and choose 明文 / 加密 storage. */
export function SetKeyDialog({ row, onClose }: { row: ProviderRow; onClose: () => void }) {
	const setKey = useProviders((s) => s.setKey);
	const [apiKey, setApiKey] = useState("");
	const [mode, setMode] = useState<KeyMode>("encrypted");
	const [show, setShow] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const save = async () => {
		const key = apiKey.trim();
		if (!key) {
			setError("请输入密钥");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			await setKey(row.id, key, mode);
			toast.success(mode === "encrypted" ? "密钥已加密保存" : "密钥已保存");
			onClose();
		} catch (err) {
			setError(errMsg(err));
			setSaving(false);
		}
	};

	return (
		<Modal onClose={onClose} size="sm" title={<>设置密钥 · {row.displayName ?? row.id}</>}>
			<div className="space-y-3 p-4">
					<div>
						<label htmlFor="set-key-input" className="block text-xs font-medium text-neutral-200">
							API 密钥
						</label>
						<div className="relative">
							<input
								id="set-key-input"
								ref={inputRef}
								type={show ? "text" : "password"}
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								onKeyDown={(e) => {
									if (isComposing(e)) return;
									if (e.key === "Enter" && !saving) void save();
								}}
								autoComplete="new-password"
								spellCheck={false}
								placeholder="sk-xxx"
								className="mt-1.5 w-full rounded-lg hairline bg-[var(--well-bg)] py-1.5 pl-3 pr-9 text-xs text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--accent)_50%,transparent)]"
							/>
							<button
								type="button"
								onClick={() => setShow((v) => !v)}
								title={show ? "隐藏密钥" : "显示密钥"}
								aria-label={show ? "隐藏密钥" : "显示密钥"}
								className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded p-1 text-neutral-500 hover:text-neutral-200"
							>
								{show ? <EyeOff size={14} /> : <Eye size={14} />}
							</button>
						</div>
					</div>
					<KeyModeRadio name="set-key-mode" value={mode} onChange={setMode} />
					{error && (
						<div role="alert" className="select-text break-words text-[11px] text-rose-300">
							{error}
						</div>
					)}
				</div>
				<div className="flex items-center justify-end gap-2 border-t border-[var(--border-divider)] px-4 py-3">
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200"
					>
						取消
					</button>
					<button
						type="button"
						disabled={saving}
						onClick={() => void save()}
						className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 disabled:opacity-40"
					>
						{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						<span>保存</span>
					</button>
				</div>
		</Modal>
	);
}
