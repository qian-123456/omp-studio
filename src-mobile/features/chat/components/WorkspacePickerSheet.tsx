import { Check, Folder, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { useSessions } from "../../../core/stores/sessions";
import { BottomSheet, Button, Field, ListGroup, ListRow, Spinner, TextField, toast } from "../../../ui";
import type { DirEntry } from "../../sessions/tree";

/** Strip a leading emoji/symbol from desktop directory labels (「🌐 全局」 → 「全局」). */
export function dirLabel(d: DirEntry): string {
	return d.label.replace(/^[^\p{L}\p{N}]+/u, "") || d.path;
}

/** 「在项目中工作」: move this session to another known directory, or type a path. */
export function WorkspacePickerSheet({
	open,
	onClose,
	sessionId,
	currentCwd,
}: {
	open: boolean;
	onClose: () => void;
	sessionId: string;
	currentCwd?: string | null;
}) {
	const [path, setPath] = useState(currentCwd ?? "");
	const [busy, setBusy] = useState<string | null>(null);
	const [dirs, setDirs] = useState<DirEntry[] | null>(null);
	const [dirsError, setDirsError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setPath(currentCwd ?? "");
		let dead = false;
		setDirsError(null);
		api<{ dirs: DirEntry[] }>("GET", "/left/dirs")
			.then((r) => !dead && setDirs(r.dirs ?? []))
			.catch((e) => !dead && setDirsError(errorMessage(e)));
		return () => {
			dead = true;
		};
	}, [open, currentCwd]);

	const apply = async (target: string) => {
		const trimmed = target.trim();
		if (!trimmed || busy) return;
		if (trimmed === currentCwd) {
			onClose();
			return;
		}
		setBusy(trimmed);
		try {
			await api("PATCH", `/sessions/${sessionId}`, { cwd: trimmed });
			await useSessions.getState().refresh();
			toast("已切换项目目录", { kind: "success" });
			onClose();
		} catch (e) {
			toast(`切换目录失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(null);
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="在项目中工作" subtitle="会话改在所选目录里读写文件、运行命令">
			<div className="pb-6">
				{dirs === null && !dirsError && (
					<div className="flex items-center justify-center gap-2 py-8 text-m-sm text-m-text-3">
						<Spinner /> 正在加载目录
					</div>
				)}
				{dirsError && <div className="m-selectable px-5 py-4 text-m-sm break-words text-m-danger">目录列表加载失败：{dirsError}</div>}
				{dirs && dirs.length > 0 && (
					<ListGroup title="常用目录">
						{dirs.map((d) => (
							<ListRow
								key={d.path}
								icon={d.kind === "global" ? <Globe size={22} strokeWidth={1.75} /> : <Folder size={22} strokeWidth={1.75} />}
								title={dirLabel(d)}
								subtitle={<span className="font-m-mono break-all">{d.path}</span>}
								right={busy === d.path ? <Spinner size={18} /> : d.path === currentCwd ? <Check size={20} className="text-m-accent" aria-label="当前目录" /> : undefined}
								chevron={false}
								disabled={busy !== null}
								onClick={() => void apply(d.path)}
							/>
						))}
					</ListGroup>
				)}
				<div className="flex flex-col gap-3 px-5 pt-6">
					<Field label="其他目录（绝对路径）">
						<TextField
							value={path}
							onChange={(e) => setPath(e.target.value)}
							placeholder="/Users/me/project"
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							className="font-m-mono"
						/>
					</Field>
					<Button variant="primary" block busy={busy === path.trim()} disabled={!path.trim() || busy !== null} onClick={() => void apply(path)}>
						切换到这个目录
					</Button>
				</div>
			</div>
		</BottomSheet>
	);
}
