import { Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SPACE_MODE_META } from "../../../src/features/sessions/modes";
import { visibleTreeSessions } from "./ChronologicalView";
import { MODES, modeLabel, needsAttn } from "./tree";
import { useTree } from "./treeStore";

/** Only the loaded current-mode tree is authoritative; other modes have no measured counts. */
export function ModeSwitch({ onChange }: { onChange?: () => void }) {
	const mode = useTree((s) => s.mode);
	const tree = useTree((s) => s.data);
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const sessions = useMemo(() => tree && (!tree.mode || tree.mode === mode) ? visibleTreeSessions(tree) : null, [tree, mode]);
	const busyCount = sessions?.filter(needsAttn).length ?? 0;
	const Icon = SPACE_MODE_META[mode].icon;
	useEffect(() => {
		if (!open) return;
		const dismiss = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
		const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setOpen(false); ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
		document.addEventListener("pointerdown", dismiss);
		document.addEventListener("keydown", key, true);
		return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", key, true); };
	}, [open]);
	return (
		<div ref={ref} className="relative shrink-0">
			<button type="button" aria-haspopup="menu" aria-expanded={open}
				aria-label={`${modeLabel(mode)}空间${sessions ? `，${sessions.length} 个会话${busyCount ? `，${busyCount} 个运行中或待回复` : ""}` : ""}，点击切换`}
				onClick={() => setOpen((v) => !v)} className="flex min-h-11 min-w-11 items-center px-1">
				<span className="relative inline-flex h-9 items-center gap-1.5 rounded-m-md border border-m-border bg-m-surface px-2 text-m-sm font-medium whitespace-nowrap text-m-text-2">
					<Icon size={16} strokeWidth={1.75} />{modeLabel(mode)}
					<ChevronDown size={16} className="text-m-text-3" />
					{busyCount > 0 && <span aria-label="当前空间有运行中或待回复的会话" className="size-2 shrink-0 rounded-m-pill bg-m-accent m-pulse" />}
				</span>
			</button>
			{open && <div role="menu" aria-label="切换空间" className="absolute left-0 top-full z-(--z-banner) w-52 max-w-[calc(100vw-24px)] rounded-m-md border border-m-border bg-m-bg p-1.5 shadow-lg">
				<div className="px-2 py-1 text-m-xs text-m-text-3">切换空间</div>
				{MODES.map(([m, label]) => {
					const ItemIcon = SPACE_MODE_META[m].icon;
					return <button key={m} type="button" role="menuitemradio" aria-checked={m === mode} onClick={() => { useTree.getState().setMode(m); setOpen(false); onChange?.(); }} className={`flex min-h-11 w-full items-center gap-2 rounded-m-md px-2 text-left text-m-sm active:bg-m-surface-hover ${m === mode ? "bg-m-surface font-medium text-m-accent" : "text-m-text-2"}`}><ItemIcon size={17} strokeWidth={1.75} /><span className="flex-1">{label}</span>{m === mode && <Check size={17} />}</button>;
				})}
			</div>}
		</div>
	);
}
