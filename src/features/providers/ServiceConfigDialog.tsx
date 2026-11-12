import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";
import { serviceConfigRead, serviceConfigWrite } from "../../lib/ipc";
import type { ServiceConfigChanges, ServiceConfigSnapshot } from "../../lib/serviceConfigTypes";
import { useT } from "../../stores/language";
import { Button } from "../settings/ui";
import type { ServiceCapability } from "./serviceCapabilities";
import { initialEnvName, initialKeyInputMode, type KeyInputMode as Mode, keyInputProblem, keyToSend, isEnvUnsetAfterSave, toastEnvUnset } from "./keyInput";
import { KeyInputMode } from "./KeyInputMode";
import { MODELS_YML_PATH } from "./keyState";
import { presetById } from "./presets";
import { useProviders } from "./store";
import { useOmpConfigStore } from "../settings/ompConfigStore";

export function ServiceConfigDialog({ capability, selector, onClose, onAdvanced, onLogin }: { capability: ServiceCapability; selector: string; onClose: () => void; onAdvanced: () => void; onLogin?: () => void }) {
	const { t } = useT();
	const supplierRow = useProviders.getState().rows?.find((r) => r.id === capability.supplier);
	const [key, setKey] = useState("");
	const [keyMode, setKeyMode] = useState<Mode>(() => initialKeyInputMode(supplierRow));
	const [envName, setEnvName] = useState(() => initialEnvName(supplierRow, presetById(capability.supplier)?.envVar));
	const [keyAttempted, setKeyAttempted] = useState(false);
	const keyProblem = keyInputProblem({ mode: keyMode, envName, plainKey: key });
	const keyToWrite = keyToSend({ mode: keyMode, envName, plainKey: key });
	const [snapshot, setSnapshot] = useState<ServiceConfigSnapshot | null>(null);
	const [changes, setChanges] = useState<ServiceConfigChanges>({});
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const settings = capability.method === "settings" || capability.method === "local";
	useEffect(() => {
		if (!settings || !capability.target) return;
		let cancelled = false;
		void serviceConfigRead(capability.target).then((value) => { if (!cancelled) setSnapshot(value); }).catch((e) => { if (!cancelled) setError(String(e)); });
		return () => { cancelled = true; };
	}, [settings, capability.target]);
	const save = async () => {
		setBusy(true); setError(""); setSaved(false);
		try {
			if (settings && snapshot && capability.target) {
				setSnapshot(await serviceConfigWrite(capability.target, changes, snapshot.stamp)); setChanges({});
				await useOmpConfigStore.getState().load(true);
			} else if (keyMode === "env" || key.trim()) {
				if (keyProblem || !keyToWrite) { setKeyAttempted(true); return; }
				const savedRow = await useProviders.getState().setKey(capability.supplier, keyToWrite); setKey("");
				if (savedRow && isEnvUnsetAfterSave(savedRow, keyMode)) toastEnvUnset(savedRow);
			} else return;
			setSaved(true);
		} catch (e) { setError(String(e)); } finally { setBusy(false); }
	};
	const fields = capability.target === "tts" ? ["localVoice", "localSpeed"] : capability.target === "stt" ? ["language"] : ["endpoint", "token", "basicUsername", "basicPassword", "categories", "engines", "language", "safesearch"];
	const canKey = capability.method === "key" || capability.method === "optional-key";
	return <Modal title={t("providers.serviceConfigTitle", { provider: capability.supplier })} onClose={onClose} size="md">
		<div className="min-h-0 max-h-[calc(85vh-64px)] space-y-4 overflow-y-auto p-4">
			<p className="text-xs text-[var(--text-dim)]">{t("providers.serviceGlobalHint")}</p>
			<p className="select-text break-all font-mono text-xs">{selector}</p>
			{capability.method === "keyless" && <p className="text-sm">{t("providers.serviceKeylessHint")}</p>}
			{capability.method === "optional-key" && <p className="text-sm">{t("providers.serviceOptionalKeyHint")}</p>}
			{capability.method === "advanced" && <><p className="text-sm">{t(capability.supplier === "kimi" ? "providers.serviceKimiHint" : "providers.serviceAdvancedHint")}</p><Button onClick={onAdvanced}>{t("settingsSections.providers.editRawConfig")}</Button></>}
			{capability.supplier === "kimi" && onLogin && <Button onClick={onLogin}>{t("providers.oauthTitleList")}</Button>}
			{canKey && <KeyInputMode name="service-key" mode={keyMode} onModeChange={(m) => { setKeyMode(m); setSaved(false); }} envName={envName} onEnvNameChange={(v) => { setEnvName(v); setSaved(false); }} problem={keyProblem} attempted={keyAttempted} current={supplierRow?.key.kind === "envVar" && supplierRow.key.envVar ? { name: supplierRow.key.envVar, set: supplierRow.key.envSet } : null} plainNote={t("providers.serviceKeyHint", { path: MODELS_YML_PATH })} onSubmit={() => void save()}>
				<label className="block space-y-2 text-xs"><span>API Key</span><input aria-label="API Key" type="password" autoComplete="new-password" value={key} onChange={(e) => { setKey(e.target.value); setSaved(false); }} placeholder={t("providers.serviceKeyUnchanged")} className="w-full rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-2" /></label>
			</KeyInputMode>}
			{settings && !snapshot && !error && <p role="status">{t("providers.serviceLoading")}</p>}
			{settings && snapshot && fields.map((field) => {
				const secret = field in snapshot.secrets;
				const value = changes[field] === null ? "" : changes[field] ?? (secret ? "" : snapshot.values[field] ?? "");
				const numeric = field === "localSpeed" || field === "safesearch";
				return <div key={field} className="space-y-1">
					<label className="block space-y-1 text-xs">
						<span>{t(`providers.serviceField_${field}`)}</span>
						<input aria-label={t(`providers.serviceField_${field}`)} list={field === "localVoice" ? "service-local-voices" : undefined} type={secret ? "password" : numeric ? "number" : "text"} autoComplete="off" value={String(value)} onChange={(e) => {
							const input = e.target.value;
							setChanges((old) => { const next = { ...old }; if (input === "") delete next[field]; else next[field] = numeric ? Number(input) : input; return next; });
							setSaved(false);
						}} placeholder={secret ? t(snapshot.secrets[field] ? "providers.serviceSecretPresent" : "providers.serviceSecretAbsent") : undefined} className="w-full rounded-lg border border-[var(--border-divider)] bg-[var(--well-bg)] p-2" />
					</label>
					{field === "localVoice" && <datalist id="service-local-voices">{["af_heart", "af_bella", "af_nicole", "af_aoede", "af_kore", "af_sarah", "am_michael", "am_fenrir", "am_puck", "bf_emma", "bm_george", "bm_fable"].map((voice) => <option key={voice} value={voice} />)}</datalist>}
					<Button disabled={busy} onClick={() => { setChanges((old) => ({ ...old, [field]: null })); setSaved(false); }}>{t(changes[field] === null ? "providers.serviceResetPending" : "providers.serviceReset")}</Button>
				</div>;
			})}
			{error && <p role="alert" className="break-words text-xs text-rose-400">{error}</p>}
			{settings && error && <Button onClick={onAdvanced}>{t("settingsSections.providers.editRawConfig")}</Button>}
			{saved && <p role="status" className="text-xs">{t("providers.serviceSaved")}</p>}
			<div className="flex justify-end gap-2"><Button onClick={onClose}>{t("common.close")}</Button>{(canKey || settings) && <Button disabled={busy || (settings ? !snapshot || Object.keys(changes).length === 0 : !keyToWrite)} onClick={() => void save()}>{t("common.save")}</Button>}</div>
		</div>
	</Modal>;
}
