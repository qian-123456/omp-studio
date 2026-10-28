import { Copy, FolderInput, FolderOpen } from "lucide-react";
import { nav, paths } from "../../../core/nav";
import { BottomSheet, MenuRow, toast } from "../../../ui";

/** Sheet behind the folder of the status row: full path, copy, browse, switch project. */
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
			toast("路径已复制", { kind: "success" });
		} catch {
			toast("复制失败", { kind: "error" });
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="当前工作目录">
			<div className="px-5 pt-2">
				<div className="m-selectable rounded-m-lg bg-m-card px-5 py-4 font-m-mono text-m-sm break-all text-m-text shadow-m-card">
					{cwd || "未设置工作目录"}
				</div>
			</div>
			<div className="pt-3 pb-3">
				<MenuRow icon={<Copy size={22} strokeWidth={1.75} />} label="复制路径" disabled={!cwd} onClick={() => void copyPath()} />
				<MenuRow
					icon={<FolderOpen size={22} strokeWidth={1.75} />}
					label="浏览文件"
					onClick={() => {
						onClose();
						nav.push(paths.files(sessionId));
					}}
				/>
				{onSwitchProject && (
					<MenuRow
						icon={<FolderInput size={22} strokeWidth={1.75} />}
						label="切换项目目录"
						hint="让这个会话改在另一个目录里工作"
						onClick={() => {
							onClose();
							onSwitchProject();
						}}
					/>
				)}
			</div>
		</BottomSheet>
	);
}
