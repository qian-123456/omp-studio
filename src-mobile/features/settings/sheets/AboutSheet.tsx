import { CheckCircle2 } from "lucide-react";
import { BottomSheet } from "../../../ui/BottomSheet";

export function AboutSheet({
	open,
	onClose,
	appVersion = "1.0.0",
}: {
	open: boolean;
	onClose: () => void;
	appVersion?: string | null;
}) {
	return (
		<BottomSheet open={open} onClose={onClose} title="版本与更新 (只读)">
			<div className="space-y-4 px-4 pb-8">
				<div className="rounded-m-lg border border-m-border bg-m-bg-elev p-4 text-center space-y-1.5">
					<div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-m-accent/10 text-m-accent font-bold text-m-lg">
						OMP
					</div>
					<h3 className="text-m-md font-bold text-m-text">OMP Workspace Mobile</h3>
					<p className="text-m-xs text-m-text-3">基于 Tauri + React 的全功能智能编程工作台</p>
				</div>

				<div className="rounded-m-lg border border-m-border bg-m-bg-elev divide-y divide-m-border text-m-xs">
					<div className="flex items-center justify-between p-3">
						<span className="text-m-text-3">应用版本 (Desktop Host)</span>
						<span className="font-m-mono text-m-text font-medium">{appVersion || "v1.0.0"}</span>
					</div>
					<div className="flex items-center justify-between p-3">
						<span className="text-m-text-3">移动端 Web UI</span>
						<span className="font-m-mono text-m-text font-medium">2026.10-mobile</span>
					</div>
					<div className="flex items-center justify-between p-3">
						<span className="text-m-text-3">核心后端 (OMP Engine)</span>
						<span className="font-m-mono text-m-text font-medium">omp 18.8.0</span>
					</div>
					<div className="flex items-center justify-between p-3">
						<span className="text-m-text-3">运行架构</span>
						<span className="font-m-mono text-m-text font-medium">darwin / arm64</span>
					</div>
					<div className="flex items-center justify-between p-3">
						<span className="text-m-text-3">更新状态</span>
						<span className="flex items-center gap-1 text-m-success">
							<CheckCircle2 size={13} />
							<span>已是最新版本</span>
						</span>
					</div>
				</div>

				<p className="px-2 text-center text-[11px] text-m-text-3">
					版本升级由电脑客户端统一管理，移动端只读展示当前版本状态。
				</p>
			</div>
		</BottomSheet>
	);
}
