import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BottomSheet, Spinner } from "../../../ui";
import { cachedCommands, commandAction, filterCommands, groupCommands, loadSlashCommands, type SlashCmd, type SlashGroup } from "../lib/slash";

function useCommands(sessionId: string, enabled: boolean): { cmds: SlashCmd[] | null; error: boolean } {
	const [cmds, setCmds] = useState<SlashCmd[] | null>(() => cachedCommands(sessionId));
	const [error, setError] = useState(false);
	useEffect(() => {
		if (!enabled) return;
		let dead = false;
		setError(false);
		loadSlashCommands(sessionId)
			.then((l) => !dead && setCmds(l))
			.catch(() => !dead && setError(true));
		return () => {
			dead = true;
		};
	}, [sessionId, enabled]);
	return { cmds, error };
}

function CommandRow({ c, onPick }: { c: SlashCmd; onPick: (c: SlashCmd) => void }) {
	return (
		<button type="button" onClick={() => onPick(c)} className="flex min-h-12 w-full flex-col justify-center px-4 py-1.5 text-left active:bg-m-surface-hover">
			<span className="flex flex-wrap items-baseline gap-x-2">
				<span className="whitespace-nowrap font-m-mono text-m-md font-medium">/{c.name}</span>
				{c.argHint && <span className="whitespace-nowrap font-m-mono text-m-xs text-m-text-3">{c.argHint}</span>}
				{commandAction(c) === "fill" && <span className="whitespace-nowrap rounded-m-pill bg-m-surface-2 px-2 text-m-xs text-m-text-3">需要参数</span>}
			</span>
			{(c.title || c.description) && (
				<span className="text-m-xs text-m-text-2">
					{c.title}
					{c.title && c.description && c.title !== c.description ? " · " : ""}
					{c.description !== c.title ? c.description : ""}
				</span>
			)}
		</button>
	);
}

function Groups({ groups, onPick }: { groups: SlashGroup[]; onPick: (c: SlashCmd) => void }) {
	return (
		<>
			{groups.map((g) => (
				<div key={g.group}>
					<div className="sticky top-0 bg-m-bg-elev px-4 py-1 text-m-xs font-semibold text-m-text-3">{g.group}</div>
					{g.items.map((c) => (
						<CommandRow key={c.name} c={c} onPick={onPick} />
					))}
				</div>
			))}
		</>
	);
}

/** Inline popup above the composer: filters the cached list locally on every keystroke, never waits on the network. */
export function SlashPopup({ sessionId, query, onPick }: { sessionId: string; query: string; onPick: (c: SlashCmd) => void }) {
	const { cmds, error } = useCommands(sessionId, true);
	const groups = useMemo(() => (cmds ? groupCommands(filterCommands(cmds, query)) : []), [cmds, query]);
	return (
		<div
			className="absolute inset-x-0 bottom-full mb-1 max-h-[40vh] overflow-y-auto overscroll-contain rounded-m-md border border-m-border bg-m-bg-elev shadow-m-pop"
			// Keep the keyboard open while tapping a row.
			onPointerDown={(e) => e.preventDefault()}
		>
			{!cmds && !error && (
				<div className="flex items-center gap-2 px-4 py-3 text-m-sm text-m-text-3">
					<Spinner size={14} />
					正在加载命令
				</div>
			)}
			{error && !cmds && <div className="px-4 py-3 text-m-sm text-m-danger">命令列表加载失败</div>}
			{cmds && groups.length === 0 && <div className="px-4 py-3 text-m-sm text-m-text-3">无匹配命令</div>}
			<Groups groups={groups} onPick={onPick} />
		</div>
	);
}

/** Full grouped, searchable list behind the persistent 「/」 button. */
export function SlashSheet({ open, onClose, sessionId, onPick }: { open: boolean; onClose: () => void; sessionId: string; onPick: (c: SlashCmd) => void }) {
	const { cmds, error } = useCommands(sessionId, open);
	const [q, setQ] = useState("");
	useEffect(() => {
		if (!open) setQ("");
	}, [open]);
	const groups = useMemo(() => (cmds ? groupCommands(filterCommands(cmds, q)) : []), [cmds, q]);
	return (
		<BottomSheet open={open} onClose={onClose} title="命令" fullHeight>
			<div className="sticky top-0 z-10 bg-m-bg-elev px-4 pb-2">
				<label className="flex min-h-11 items-center gap-2 rounded-m-pill bg-m-surface px-3">
					<Search size={16} className="text-m-text-3" />
					<input
						type="search"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						placeholder="搜索命令"
						className="min-w-0 flex-1 bg-transparent outline-none"
					/>
				</label>
			</div>
			{!cmds && !error && (
				<div className="flex items-center justify-center gap-2 py-8 text-m-sm text-m-text-3">
					<Spinner size={16} />
					正在加载命令
				</div>
			)}
			{error && !cmds && <div className="px-4 py-8 text-center text-m-sm text-m-danger">命令列表加载失败</div>}
			{cmds && groups.length === 0 && <div className="px-4 py-8 text-center text-m-sm text-m-text-3">无匹配命令</div>}
			<Groups groups={groups} onPick={onPick} />
		</BottomSheet>
	);
}
