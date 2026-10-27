import { Copy, Folder, FolderOpen } from "lucide-react";
import { nav, paths } from "../../../core/nav";
import { BottomSheet, toast } from "../../../ui";

export function PathSheet({
	open,
	onClose,
	cwd,
	sessionId,
	onSwitchProject,
}: {
	open: boolean;
	onClose: () => void;
	cwd?: string | null;
	sessionId: string;
	onSwitchProject?: () => void;
}) {
	const copyPath = async () => {
		if (!cwd) return;
		try {
			await navigator.clipboard.writeText(cwd);
			toast("路径已复制到剪贴板", { kind: "success" });
		} catch {
			toast("复制失败", { kind: "error" });
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="当前工作目录">
			<div className="space-y-4 px-5 pb-6 pt-2">
				<div className="rounded-m-md border border-m-border bg-m-surface p-3">
					<div className="flex items-center gap-2 text-m-xs text-m-text-3 mb-1">
						<Folder size={14} />
						工作目录路径
					</div>
					<div className="break-all font-m-mono text-m-sm text-m-text select-all">
						{cwd || "未设置工作目录"}
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<button
						type="button"
						onClick={() => {
							void copyPath();
						}}
						disabled={!cwd}
						className="flex min-h-11 w-full items-center justify-center gap-2 rounded-m-pill border border-m-border bg-m-surface px-4 text-m-sm font-medium text-m-text active:bg-m-surface-hover disabled:opacity-40"
					>
						<Copy size={16} />
						复制路径
					</button>

					<button
						type="button"
						onClick={() => {
							onClose();
							nav.push(paths.files(sessionId));
						}}
						className="flex min-h-11 w-full items-center justify-center gap-2 rounded-m-pill border border-m-border bg-m-surface px-4 text-m-sm font-medium text-m-text active:bg-m-surface-hover"
					>
						<FolderOpen size={16} />
						浏览目录文件
					</button>

					{onSwitchProject && (
						<button
							type="button"
							onClick={() => {
								onClose();
								onSwitchProject();
							}}
							className="flex min-h-11 w-full items-center justify-center gap-2 rounded-m-pill bg-m-accent px-4 text-m-sm font-medium text-m-accent-text active:opacity-80"
						>
							在项目中工作（切换目录）
						</button>
					)}
				</div>
			</div>
		</BottomSheet>
	);
}
