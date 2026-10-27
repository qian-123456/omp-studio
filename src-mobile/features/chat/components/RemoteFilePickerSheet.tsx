import { ChevronRight, File as FileIcon, Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, Spinner, toast } from "../../../ui";

interface DirEntry {
	name: string;
	path: string;
	kind: "dir" | "file";
	size: number;
}

interface DirData {
	path: string;
	parent: string | null;
	entries: DirEntry[];
}

export function RemoteFilePickerSheet({
	open,
	onClose,
	sessionId,
	onSelectFile,
}: {
	open: boolean;
	onClose: () => void;
	sessionId: string;
	onSelectFile: (file: { path: string; name: string }) => void;
}) {
	const [dir, setDir] = useState<string | null>(null);
	const [data, setData] = useState<DirData | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = async (path?: string | null) => {
		setLoading(true);
		setError(null);
		try {
			const q = path ? `?path=${encodeURIComponent(path)}` : "";
			const res = await api<DirData>("GET", `/sessions/${sessionId}/files${q}`);
			setData(res);
			setDir(res.path);
		} catch (e) {
			setError(errorMessage(e));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (open) {
			void load(null);
		}
	}, [open, sessionId]);

	const pickFile = (e: DirEntry) => {
		onSelectFile({ path: e.path, name: e.name });
		toast(`已附加文件：${e.name}`, { kind: "success" });
		onClose();
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="远程文件选择 (Finder 选中项)" fullHeight>
			<div className="flex h-full flex-col">
				<div className="flex items-center justify-between border-b border-m-border px-4 py-2 text-m-xs text-m-text-3">
					<span className="truncate">{data?.path || "加载中…"}</span>
					{data?.parent && (
						<button
							type="button"
							onClick={() => void load(data.parent)}
							className="shrink-0 text-m-accent underline active:opacity-70"
						>
							返回上一级
						</button>
					)}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{loading && !data ? (
						<div className="flex items-center justify-center gap-2 p-8 text-m-sm text-m-text-2">
							<Spinner /> 加载文件列表…
						</div>
					) : error ? (
						<div className="flex flex-col items-center gap-3 p-6 text-center">
							<div className="text-m-sm text-m-danger">加载失败：{error}</div>
							<button
								type="button"
								onClick={() => void load(dir)}
								className="rounded-m-pill bg-m-accent px-4 py-1.5 text-m-xs text-m-accent-text"
							>
								重试
							</button>
						</div>
					) : !data?.entries?.length ? (
						<div className="p-8 text-center text-m-sm text-m-text-3">目录为空</div>
					) : (
						<ul className="m-0 list-none p-0">
							{data.entries.map((e) => (
								<li key={e.path}>
									<button
										type="button"
										onClick={() => (e.kind === "dir" ? void load(e.path) : pickFile(e))}
										className="flex min-h-12 w-full items-center gap-3 border-b border-m-border px-4 py-2 text-left text-m-text active:bg-m-surface-hover"
									>
										<span className="shrink-0 text-m-text-2">
											{e.kind === "dir" ? <Folder size={18} /> : <FileIcon size={18} />}
										</span>
										<span className="min-w-0 flex-1 break-all text-m-sm">{e.name}</span>
										{e.kind === "dir" && <ChevronRight size={16} className="shrink-0 text-m-text-3" />}
									</button>
								</li>
							))}
						</ul>
					)}
				</div>
			</div>
		</BottomSheet>
	);
}
