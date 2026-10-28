import { useState } from "react";
import { api, errorMessage } from "../../core/api";
import { ListGroup, Segmented, Stepper, Switch, toast } from "../../ui";
import { SettingRow } from "./rows";
import { clampInt, SETTING_GROUPS, type OmpValue, type SettingDef } from "./settingsMap";

export type Omp = Record<string, OmpValue>;

const DEFS: ReadonlyMap<string, SettingDef> = new Map(SETTING_GROUPS.flatMap((g) => g.items.map((d) => [d.key, d] as const)));

function SettingControl({ def, value, onSave, busy }: { def: SettingDef; value: OmpValue; onSave: (v: boolean | number | string) => void; busy: boolean }) {
	if (def.type === "bool") return <Switch label={def.name} checked={value === true} disabled={busy} onChange={onSave} />;
	if (def.type === "enum") {
		return (
			<Segmented
				label={def.name}
				value={typeof value === "string" ? value : null}
				disabled={busy}
				options={def.options.map(([v, l]) => ({ value: v, label: l }))}
				onChange={onSave}
			/>
		);
	}
	return (
		<Stepper
			label={def.name}
			value={typeof value === "number" ? value : null}
			min={def.min}
			max={def.max}
			step={def.step}
			unit={def.unit}
			disabled={busy}
			onCommit={(n) => onSave(clampInt(def, n))}
		/>
	);
}

/**
 * One group of allowlisted OMP settings (current values from `GET /left/settings` → `omp`),
 * saved optimistically through `POST /left/settings/set` with rollback. Keys the server did not
 * return (unset/unreadable config) are hidden.
 */
export function OmpSettingsGroup({
	title,
	keys,
	omp,
	onValue,
}: {
	title?: string;
	keys: readonly string[];
	omp: Omp | undefined;
	onValue: (key: string, value: OmpValue) => void;
}) {
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const defs = keys.flatMap((k) => {
		const d = DEFS.get(k);
		return d && omp && k in omp ? [d] : [];
	});
	if (defs.length === 0) return null;
	const save = async (def: SettingDef, next: boolean | number | string) => {
		if (busyKey || !omp) return;
		const prev = omp[def.key];
		setBusyKey(def.key);
		onValue(def.key, next);
		try {
			const r = await api<{ value: OmpValue }>("POST", "/left/settings/set", { key: def.key, value: next });
			onValue(def.key, r.value);
		} catch (e) {
			onValue(def.key, prev);
			toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusyKey(null);
		}
	};
	return (
		<ListGroup title={title}>
			{defs.map((def) => (
				<SettingRow key={def.key} name={def.name} hint={def.hint} stacked={def.type !== "bool"}>
					<SettingControl def={def} value={omp?.[def.key]} busy={busyKey === def.key} onSave={(v) => void save(def, v)} />
				</SettingRow>
			))}
		</ListGroup>
	);
}

/** Props of sheets editing allowlisted OMP settings. */
export interface OmpSheetProps {
	open: boolean;
	onClose: () => void;
	omp: Omp | undefined;
	ompError?: string | null;
	onOmp: (key: string, value: OmpValue) => void;
}

/** Shown instead of the rows when the desktop could not read the OMP config. */
export function OmpError({ omp, ompError }: { omp: Omp | undefined; ompError?: string | null }) {
	if (!ompError && omp) return null;
	return (
		<div role="alert" className="mx-4 rounded-m-lg bg-m-danger-bg px-4 py-3 text-m-sm break-words text-m-danger">
			<div className="font-medium">读不到电脑上的 OMP 配置</div>
			<div className="m-selectable mt-1">{ompError || "设置还没有加载出来，请返回后下拉刷新。"}</div>
		</div>
	);
}
