import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

interface Props {
	children: ReactNode;
	fallback?: (error: Error, retry: () => void) => ReactNode;
	resetKey?: string;
}

interface State {
	error: Error | null;
	prevResetKey?: string;
	attempt: number;
}

export class ErrorBoundary extends Component<Props, State> {
	override state: State = { error: null, prevResetKey: this.props.resetKey, attempt: 0 };

	static getDerivedStateFromError(error: Error): Partial<State> {
		return { error };
	}

	static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
		if (props.resetKey !== state.prevResetKey) {
			return { error: null, prevResetKey: props.resetKey, attempt: 0 };
		}
		return null;
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error("[mobile app] Chunk load or render failed:", error, errorInfo);
	}

	retry = (): void => {
		this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
	};

	override render(): ReactNode {
		if (this.state.error) {
			if (this.props.fallback) {
				return this.props.fallback(this.state.error, this.retry);
			}
			return (
				<div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
					<div className="mb-4 flex size-14 items-center justify-center rounded-full bg-m-danger/10 text-m-danger">
						<AlertCircle size={28} />
					</div>
					<h2 className="text-m-lg font-semibold text-m-text">页面加载失败</h2>
					<p className="mt-2 max-w-xs text-m-sm text-m-text-3">
						{this.state.error.message || "资源加载失败或网络中断，请检查网络后重试"}
					</p>
					<button
						type="button"
						onClick={this.retry}
						className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-m-pill bg-m-accent px-6 text-m-sm font-medium text-m-accent-text active:opacity-80"
					>
						<RotateCcw size={16} />
						重试
					</button>
				</div>
			);
		}
		return <span key={this.state.attempt} className="contents">{this.props.children}</span>;
	}
}
