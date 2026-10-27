import { useState } from "react";
import { api, errorMessage } from "../../core/api";
import { toast } from "../../ui";
import { Row, Section, Segmented, Stepper, Switch } from "./controls";
import { clampInt, visibleGroups, type OmpValue, type SettingDef } from "./settingsMap";

type Omp = Record<string, OmpValue>;

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

/** Allowlisted OMP switches/inputs, saved optimistically through `POST /left/settings/set` with rollback. */
export function OmpSettings({ omp, onValue }: { omp: Omp; onValue: (key: string, value: OmpValue) => void }) {
	const [busyKey, setBusyKey] = useState<string | null>(null);
	const save = async (def: SettingDef, next: boolean | number | string) => {
		if (busyKey) return;
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
		<>
			{visibleGroups(omp).map((g) => (
				<Section key={g.title} title={g.title}>
					{g.items.map((def) => (
						<Row key={def.key} name={def.name} hint={def.hint} stacked={def.type !== "bool"}>
							<SettingControl def={def} value={omp[def.key]} busy={busyKey === def.key} onSave={(v) => void save(def, v)} />
						</Row>
					))}
				</Section>
			))}
		</>
	);
}
