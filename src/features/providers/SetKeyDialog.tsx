import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import type { ProviderRow } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing } from "../../lib/hooks";
import { useT } from "../../stores/language";
import { initialEnvName, initialKeyInputMode, type KeyInputMode as Mode, keyInputProblem, keyToSend, toastKeySaved } from "./keyInput";
import { KeyInputMode } from "./KeyInputMode";
import { presetById } from "./presets";
import { useProviders } from "./store";
/** 设置密钥: give any provider row a key, either typed in (plain text in models.yml) or as an environment variable name. */
export function SetKeyDialog({ row, onClose }: { row: ProviderRow; onClose: () => void }) {
	const { t } = useT();
	const setKey = useProviders((s) => s.setKey);
	const [mode, setMode] = useState<Mode>(() => initialKeyInputMode(row));
	const [envName, setEnvName] = useState(() => initialEnvName(row, presetById(row.id)?.envVar));
	const [attempted, setAttempted] = useState(false);
	const [apiKey, setApiKey] = useState("");
	const [show, setShow] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const problem = keyInputProblem({ mode, envName, plainKey: apiKey, requirePlainKey: true });

	const save = async () => {
		if (problem) {
			setAttempted(true);
			return;
		}
		const key = keyToSend({ mode, envName, plainKey: apiKey });
		if (!key) return;
		setSaving(true);
		setError(null);
		try {
			const saved = await setKey(row.id, key);
			toastKeySaved(saved, mode, t("providers.keySavedToast"));
			onClose();
		} catch (err) {
			setError(errMsg(err));
			setSaving(false);
		}
	};

	return (
		<Modal onClose={onClose} size="sm" title={t("providers.setKeyTitle", { name: row.displayName ?? row.id })}>
			<div className="space-y-3 p-4">
					<KeyInputMode
						name="set-key"
						mode={mode}
						onModeChange={setMode}
						envName={envName}
						onEnvNameChange={setEnvName}
						problem={problem}
						attempted={attempted}
						current={row.key.kind === "envVar" && row.key.envVar ? { name: row.key.envVar, set: row.key.envSet } : null}
						onSubmit={() => void save()}
					>
					<div>
						<label htmlFor="set-key-input" className="block text-xs font-medium text-neutral-200">
							{t("providers.apiKeyLabel")}
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
								title={show ? t("providers.hideKey") : t("providers.showKey")}
								aria-label={show ? t("providers.hideKey") : t("providers.showKey")}
								className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded p-1 text-neutral-500 hover:text-neutral-200"
							>
								{show ? <EyeOff size={14} /> : <Eye size={14} />}
							</button>
						</div>
					</div>
					</KeyInputMode>
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
						{t("common.cancel")}
					</button>
					<button
						type="button"
						disabled={saving}
						onClick={() => void save()}
						className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[var(--accent)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg)] hover:opacity-90 disabled:opacity-40"
					>
						{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
						<span>{t("common.save")}</span>
					</button>
				</div>
		</Modal>
	);
}
