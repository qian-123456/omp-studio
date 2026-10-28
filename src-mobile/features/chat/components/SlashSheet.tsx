import { useEffect, useMemo, useState } from "react";
import { Spinner } from "../../../ui";
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
		<button type="button" onClick={() => onPick(c)} className="flex min-h-13 w-full flex-col justify-center px-4 py-2 text-left active:bg-m-surface-hover">
			<span className="flex flex-wrap items-baseline gap-x-2">
				<span className="font-m-mono text-m-md font-medium break-all">/{c.name}</span>
				{c.argHint && <span className="font-m-mono text-m-xs break-words text-m-text-3">{c.argHint}</span>}
				{commandAction(c) === "fill" && <span className="whitespace-nowrap rounded-m-pill bg-m-surface-2 px-2 text-m-xs text-m-text-3">需要参数</span>}
			</span>
			{(c.title || c.description) && (
				<span className="mt-0.5 text-m-xs break-words text-m-text-3">
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
					<div className="sticky top-0 bg-m-bg-elev px-4 pt-3 pb-1 text-m-xs font-medium whitespace-nowrap text-m-text-3">{g.group}</div>
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
			className="absolute inset-x-4 bottom-full z-(--z-banner) mb-2 max-h-[40vh] overflow-y-auto overscroll-contain rounded-m-lg bg-m-bg-elev py-1 shadow-m-pop"
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
