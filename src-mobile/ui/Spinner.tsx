export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
	return (
		<span
			role="status"
			aria-label="加载中"
			className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
			style={{ width: size, height: size }}
		/>
	);
}
