import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../../../core/api";
import { BottomSheet, toast } from "../../../ui";
import { useSessions } from "../../../core/stores/sessions";

export function WorkspacePickerSheet({
	open,
	onClose,
	sessionId,
	currentCwd,
	onCwdChanged,
}: {
	open: boolean;
	onClose: () => void;
	sessionId: string;
	currentCwd?: string | null;
	onCwdChanged?: (newCwd: string) => void;
}) {
	const [path, setPath] = useState(currentCwd ?? "");
	const [busy, setBusy] = useState(false);

	const submit = async () => {
		const trimmed = path.trim();
		if (!trimmed) {
			toast("请输入项目路径", { kind: "error" });
			return;
		}
		setBusy(true);
		try {
			await api("PATCH", `/sessions/${sessionId}`, { cwd: trimmed });
			await useSessions.getState().refresh();
			onCwdChanged?.(trimmed);
			toast("工作项目目录已更新", { kind: "success" });
			onClose();
		} catch (e) {
			toast(`更新目录失败：${errorMessage(e)}`, { kind: "error" });
		} finally {
			setBusy(false);
		}
	};

	return (
		<BottomSheet open={open} onClose={onClose} title="在项目中工作">
			<div className="space-y-4 px-5 pb-6 pt-2">
				<p className="text-m-sm text-m-text-2">
					设置或切换当前会话的项目工作目录。AI 代理将在该目录下读写文件与运行命令。
				</p>

				<div>
					<label className="block text-m-xs font-medium text-m-text-2 mb-1">项目目录绝对路径</label>
					<div className="flex items-center gap-2 rounded-m-md border border-m-border bg-m-surface px-3 py-2">
						<FolderOpen size={18} className="shrink-0 text-m-text-3" />
						<input
							type="text"
							value={path}
							onChange={(e) => setPath(e.target.value)}
							placeholder="/Users/username/my-project"
							className="min-w-0 flex-1 bg-transparent font-m-mono text-m-sm text-m-text outline-none placeholder:text-m-text-3"
						/>
					</div>
				</div>

				<button
					type="button"
					disabled={busy || !path.trim()}
					onClick={() => void submit()}
					className="flex min-h-11 w-full items-center justify-center rounded-m-pill bg-m-accent px-4 text-m-sm font-medium text-m-accent-text active:opacity-80 disabled:opacity-50"
				>
					{busy ? "正在更新…" : "确定并应用"}
				</button>
			</div>
		</BottomSheet>
	);
}
