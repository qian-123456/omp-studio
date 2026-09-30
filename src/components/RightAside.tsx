import React, { type ReactNode } from "react";
import { type RightTab, useUi } from "../stores/ui";
import { useTabBadges } from "../features/sessions/useTabBadges";
import { RightPanelHeader } from "./RightPanelHeader";
import { RightPanelEmptyState } from "./RightPanelEmptyState";
import { FileExplorer } from "../features/explorer/FileExplorer";
import { SideChatPanel } from "../features/sidechat/SideChatPanel";
import { HeatmapPanel } from "../features/heatmap/HeatmapPanel";
import { TodoPanel } from "../features/todos/TodoPanel";
import { GitPanel } from "../features/git/GitPanel";
import { ServicesPanel } from "../features/services/ServicesPanel";

class ErrorBoundary extends React.Component<
	{ children: ReactNode; label: string },
	{ error: string | null; stack: string | null }
> {
	state = { error: null as string | null, stack: null as string | null };
	static getDerivedStateFromError(e: unknown) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
	componentDidCatch(_error: unknown, info: React.ErrorInfo) {
		this.setState({ stack: info.componentStack ?? null });
	}
	render() {
		if (this.state.error) {
			return (
				<div className="flex h-full flex-col items-center justify-center p-6 text-center text-xs text-neutral-400">
					<div className="font-medium text-red-400">
						{this.props.label} 渲染出错
					</div>
					<div className="mt-1 font-mono text-[11px] text-neutral-500">
						{this.state.error}
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}

function RightPanelBody({ tab }: { tab: RightTab }) {
	switch (tab) {
		case "explorer":
			return <FileExplorer />;
		case "sidechat":
			return <SideChatPanel />;
		case "heatmap":
			return <HeatmapPanel />;
		case "todos":
			return <TodoPanel />;
		case "git":
			return <GitPanel />;
		case "services":
			return <ServicesPanel />;
	}
}

export const RightAside = React.memo(function RightAside() {
	const rightTab = useUi((s) => s.rightTab);
	const rightWidth = useUi((s) => s.rightWidth);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const tabBadges = useTabBadges(selectedSessionId);

	return (
		<aside
			style={{ width: rightWidth }}
			className="flex shrink-0 flex-col border-l border-[var(--border-divider)] vibrancy-chrome"
		>
			{rightTab ? (
				<>
					<RightPanelHeader activeTab={rightTab} tabBadges={tabBadges} />
					<div className="min-h-0 flex-1 overflow-y-auto">
						<ErrorBoundary label="右侧面板">
							<RightPanelBody tab={rightTab} />
						</ErrorBoundary>
					</div>
				</>
			) : (
				<RightPanelEmptyState tabBadges={tabBadges} />
			)}
		</aside>
	);
});
