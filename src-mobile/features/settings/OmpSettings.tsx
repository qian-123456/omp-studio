import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../core/api";
import { ListGroup, Segmented, Stepper, Switch, toast } from "../../ui";
import { SettingRow } from "./rows";
import { clampInt, SETTING_GROUPS, type OmpValue, type SettingDef } from "./settingsMap";

export type Omp = Record<string, OmpValue>;

const DEFS: ReadonlyMap<string, SettingDef> = new Map(SETTING_GROUPS.flatMap((g) => g.items.map((d) => [d.key, d] as const)));

function SettingControl({ def, value, onSave }: { def: SettingDef; value: OmpValue; onSave: (v: boolean | number | string) => void }) {
	if (def.type === "bool") return <Switch label={def.name} checked={value === true} onChange={onSave} />;
	if (def.type === "enum") {
		return (
			<Segmented
				label={def.name}
				value={typeof value === "string" ? value : null}
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
			onCommit={(n) => onSave(clampInt(def, n))}
		/>
	);
}

interface PendingSetting {
	confirmed: OmpValue;
	revision: number;
	next?: { value: boolean | number | string; revision: number };
	timer?: ReturnType<typeof setTimeout>;
	inFlight: boolean;
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
	const pending = useRef(new Map<string, PendingSetting>());
	const mounted = useRef(true);
	const onValueRef = useRef(onValue);
	onValueRef.current = onValue;
	const [errors, setErrors] = useState<Record<string, string | undefined>>({});
	const persist = async (key: string, state: PendingSetting): Promise<void> => {
		if (state.inFlight || !state.next) return;
		const next = state.next;
		state.next = undefined;
		state.inFlight = true;
		try {
			const result = await api<{ value: OmpValue }>("POST", "/left/settings/set", { key, value: next.value });
			state.confirmed = result.value;
			if (mounted.current && state.revision === next.revision) {
				onValueRef.current(key, result.value);
				setErrors((old) => ({ ...old, [key]: undefined }));
			}
		} catch (e) {
			if (mounted.current && state.revision === next.revision) {
				onValueRef.current(key, state.confirmed);
				setErrors((old) => ({ ...old, [key]: errorMessage(e) }));
				toast(`保存失败：${errorMessage(e)}`, { kind: "error" });
			}
		} finally {
			state.inFlight = false;
			if (state.next && !state.timer) void persist(key, state);
		}
	};
	const flush = () => {
		for (const [key, state] of pending.current) {
			clearTimeout(state.timer);
			state.timer = undefined;
			void persist(key, state);
		}
	};
	useEffect(() => {
		mounted.current = true;
		const onHide = () => { if (document.hidden) flush(); };
		document.addEventListener("visibilitychange", onHide);
		window.addEventListener("pagehide", flush);
		return () => {
			mounted.current = false;
			document.removeEventListener("visibilitychange", onHide);
			window.removeEventListener("pagehide", flush);
			flush();
		};
	}, []);
	const defs = keys.flatMap((k) => {
		const d = DEFS.get(k);
		return d && omp && k in omp ? [d] : [];
	});
	if (defs.length === 0) return null;
	const save = (def: SettingDef, value: boolean | number | string) => {
		if (!omp) return;
		let state = pending.current.get(def.key);
		if (!state) {
			state = { confirmed: omp[def.key], revision: 0, inFlight: false };
			pending.current.set(def.key, state);
		} else if (!state.inFlight && !state.next) {
			state.confirmed = omp[def.key];
		}
		if (!state.inFlight && !state.next && value === state.confirmed) return;
		state.next = { value, revision: ++state.revision };
		onValueRef.current(def.key, value);
		setErrors((old) => ({ ...old, [def.key]: undefined }));
		clearTimeout(state.timer);
		state.timer = undefined;
		if (def.type === "int") {
			const queued = state;
			state.timer = setTimeout(() => {
				queued.timer = undefined;
				void persist(def.key, queued);
			}, 350);
		} else void persist(def.key, state);
	};
	return (
		<div onBlur={(event) => {
			if (event.target instanceof HTMLInputElement || !event.currentTarget.contains(event.relatedTarget as Node | null)) flush();
		}}>
			<ListGroup title={title}>
				{defs.map((def) => (
					<SettingRow key={def.key} name={def.name} hint={def.hint} stacked={def.type !== "bool"}>
						<SettingControl def={def} value={omp?.[def.key]} onSave={(v) => save(def, v)} />
						{errors[def.key] && <div role="alert" className="m-selectable mt-2 whitespace-pre-wrap break-words text-m-sm text-m-danger">保存失败：{errors[def.key]}</div>}
					</SettingRow>
				))}
			</ListGroup>
		</div>
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
