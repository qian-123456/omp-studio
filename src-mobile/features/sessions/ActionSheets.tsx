import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import { nav, paths } from "../../core/nav";
import { sessionName } from "../../core/lib/format";
import { isDraftId } from "../../core/types";
import { BottomSheet, confirm } from "../../ui";
import { discardDraft, patchSession } from "./actions";
import { needsAttn, type TreeSession } from "./tree";

export interface SheetItem {
	key: string;
	label: ReactNode;
	danger?: boolean;
	active?: boolean;
	run: () => void;
}

/** Bottom action list (old `sheet()`): every item is a full-width, visibly separated button. */
export function ActionSheet({
	open,
	title,
	items,
	onClose,
}: {
	open: boolean;
	title?: ReactNode;
	items: SheetItem[];
	onClose: () => void;
}) {
	return (
		<BottomSheet open={open} onClose={onClose} title={title}>
			<div className="flex flex-col gap-2 px-4 pb-3">
				{items.map((it) => (
					<button
						key={it.key}
						type="button"
						onClick={() => {
							onClose();
							it.run();
						}}
						className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-m-md border px-4 py-2 text-m-md ${
							it.danger ? "border-m-danger text-m-danger" : it.active ? "border-m-accent text-m-text" : "border-m-border text-m-text"
						} bg-m-surface active:bg-m-surface-hover`}
					>
						{it.label}
					</button>
				))}
				<button
					type="button"
					onClick={onClose}
					className="min-h-11 w-full whitespace-nowrap rounded-m-md px-4 py-2 text-m-md text-m-text-2 active:bg-m-surface-hover"
				>
					取消
				</button>
			</div>
		</BottomSheet>
	);
}

function PromptForm({
	initial,
	placeholder,
	onDone,
}: {
	initial: string;
	placeholder?: string;
	onDone: (value: string | null) => void;
}) {
	const [value, setValue] = useState(initial);
	return (
		<form
			className="flex flex-col gap-3 px-4 pb-3"
			onSubmit={(e) => {
				e.preventDefault();
				onDone(value.trim());
			}}
		>
			<input
				autoFocus
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder={placeholder}
				className="min-h-11 rounded-m-md border border-m-border bg-m-surface px-3 text-m-md text-m-text outline-none focus:border-m-accent"
			/>
			<div className="flex gap-2">
				<button
					type="button"
					onClick={() => onDone(null)}
					className="min-h-11 flex-1 whitespace-nowrap rounded-m-md border border-m-border bg-m-surface text-m-md text-m-text"
				>
					取消
				</button>
				<button
					type="submit"
					className="min-h-11 flex-1 whitespace-nowrap rounded-m-md bg-m-accent text-m-md font-medium text-m-accent-text"
				>
					确定
				</button>
			</div>
		</form>
	);
}

/** Text prompt sheet (old `promptSheet`): reports the trimmed text, or null on cancel. */
export function PromptSheet({
	open,
	title,
	initial,
	placeholder,
	onDone,
}: {
	open: boolean;
	title: string;
	initial: string;
	placeholder?: string;
	onDone: (value: string | null) => void;
}) {
	return (
		<BottomSheet open={open} onClose={() => onDone(null)} title={title}>
			{open && <PromptForm initial={initial} placeholder={placeholder} onDone={onDone} />}
		</BottomSheet>
	);
}

interface SheetState {
	title?: ReactNode;
	items: SheetItem[];
}

/** Session row actions (pin / archive / rename / draft discard). Render `node` once in the page. */
export function useSessionActions(): { openActions: (s: TreeSession) => void; node: ReactNode } {
	const [sheet, setSheet] = useState<SheetState | null>(null);
	const [prompt, setPrompt] = useState<{ s: TreeSession; initial: string } | null>(null);
	const close = useCallback(() => setSheet(null), []);
	// Keep the last content mounted while the sheet plays its exit transition.
	const last = useRef<SheetState | null>(null);
	if (sheet) last.current = sheet;
	const shown = sheet ?? last.current;

	const openActions = useCallback((s: TreeSession) => {
		const open = { key: "open", label: "打开", run: () => nav.push(paths.chat(s.id)) };
		if (isDraftId(s.id)) {
			setSheet({
				title: "未发送的草稿",
				items: [open, { key: "discard", label: "丢弃草稿", danger: true, run: () => void discardDraft(s) }],
			});
			return;
		}
		const busy = needsAttn(s);
		setSheet({
			title: sessionName(s),
			items: [
				open,
				{ key: "rename", label: "重命名", run: () => setPrompt({ s, initial: s.title === s.label ? "" : s.title }) },
				{ key: "pin", label: s.pinned ? "取消置顶" : "置顶", run: () => void patchSession(s, { pinned: !s.pinned }) },
				s.archived
					? { key: "unarchive", label: "取消归档", run: () => void patchSession(s, { archived: false }, "已取消归档") }
					: {
							key: "archive",
							label: "归档",
							danger: true,
							run: () => {
								void (async () => {
									if (busy && !(await confirm({ message: "该会话正在运行或等待回复，确定要归档吗？", confirmText: "归档", danger: true }))) return;
									await patchSession(s, { archived: true }, "已归档");
								})();
							},
						},
			],
		});
	}, []);

	const node = (
		<>
			<ActionSheet open={sheet !== null} title={shown?.title} items={shown?.items ?? []} onClose={close} />
			<PromptSheet
				open={prompt !== null}
				title="重命名会话"
				initial={prompt?.initial ?? ""}
				placeholder="留空则恢复默认名称"
				onDone={(v) => {
					const p = prompt;
					setPrompt(null);
					if (p && v !== null) void patchSession(p.s, { customName: v }, "已重命名");
				}}
			/>
		</>
	);
	return { openActions, node };
}
