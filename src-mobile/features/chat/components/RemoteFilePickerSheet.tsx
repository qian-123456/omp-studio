import { ChevronLeft, File as FileIcon, Folder } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, Button, EmptyState, IconButton, ListGroup, ListRow, Spinner, toast } from "../../../ui";

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

/** 「Finder 选中项」: browse the computer's project directory and reference a file in the message. */
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
	const [data, setData] = useState<DirData | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<{ path: string | null; message: string } | null>(null);

	const load = useCallback(
		async (path: string | null) => {
			setLoading(true);
			setError(null);
			try {
				const q = path ? `?path=${encodeURIComponent(path)}` : "";
				setData(await api<DirData>("GET", `/sessions/${sessionId}/files${q}`));
			} catch (e) {
				setError({ path, message: errorMessage(e) });
			} finally {
				setLoading(false);
			}
		},
		[sessionId],
	);

	useEffect(() => {
		if (open) void load(null);
	}, [open, load]);

	const pickFile = (e: DirEntry) => {
		onSelectFile({ path: e.path, name: e.name });
		toast(`已引用文件：${e.name}`, { kind: "success" });
		onClose();
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="选择电脑上的文件" fullHeight>
			<div className="flex items-center gap-1 px-3 pb-1">
				{data?.parent ? (
					<IconButton variant="filled" icon={<ChevronLeft size={22} />} label="上一级" onClick={() => void load(data.parent)} />
				) : (
					<span className="w-2" />
				)}
				<div className="m-selectable min-w-0 flex-1 px-1 font-m-mono text-m-xs break-all text-m-text-3">{data?.path ?? ""}</div>
				{loading && data && <Spinner size={16} />}
			</div>
			{loading && !data ? (
				<div className="flex items-center justify-center gap-2 py-16 text-m-sm text-m-text-3">
					<Spinner /> 正在加载文件
				</div>
			) : error ? (
				<EmptyState
					title="加载失败"
					hint={<span className="m-selectable">{error.message}</span>}
					action={
						<Button variant="tonal" onClick={() => void load(error.path)}>
							重试
						</Button>
					}
				/>
			) : !data?.entries?.length ? (
				<EmptyState icon={<Folder size={24} />} title="这个目录是空的" />
			) : (
				<ListGroup className="pb-6">
					{data.entries.map((e) => (
						<ListRow
							key={e.path}
							icon={e.kind === "dir" ? <Folder size={22} strokeWidth={1.75} /> : <FileIcon size={22} strokeWidth={1.75} />}
							title={<span className="break-all">{e.name}</span>}
							chevron={e.kind === "dir"}
							onClick={() => (e.kind === "dir" ? void load(e.path) : pickFile(e))}
						/>
					))}
				</ListGroup>
			)}
		</BottomSheet>
	);
}
