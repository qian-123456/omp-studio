/**
 * Crisp SVG brand logos for AI providers (Claude, Google Gemini, Devin, etc.).
 */
export function ProviderBrandLogo({
	iconType,
	className = "h-5 w-5",
	color,
}: {
	iconType: string;
	className?: string;
	color?: string;
}) {
	if (iconType === "anthropic") {
		// Anthropic Claude starburst / spark
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fill={color || "currentColor"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M12 2L13.8 8.2L20 10L13.8 11.8L12 18L10.2 11.8L4 10L10.2 8.2L12 2Z" />
				<path
					d="M17.5 14.5L18.5 17.5L21.5 18.5L18.5 19.5L17.5 22.5L16.5 19.5L13.5 18.5L16.5 17.5L17.5 14.5Z"
					opacity="0.8"
				/>
				<path
					d="M6.5 2.5L7.5 5.5L10.5 6.5L7.5 7.5L6.5 10.5L5.5 7.5L2.5 6.5L5.5 5.5L6.5 2.5Z"
					opacity="0.6"
				/>
			</svg>
		);
	}

	if (iconType === "google") {
		// Google Gemini 4-point curved sparkle star
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fill={color || "currentColor"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M12 2C12 7.523 7.523 12 2 12C7.523 12 12 16.477 12 22C12 16.477 16.477 12 22 12C16.477 12 12 7.523 12 2Z" />
			</svg>
		);
	}

	if (iconType === "devin") {
		// Devin prompt terminal [>_]
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fill="none"
				stroke={color || "currentColor"}
				strokeWidth="2.2"
				strokeLinecap="round"
				strokeLinejoin="round"
				xmlns="http://www.w3.org/2000/svg"
			>
				<rect width="18" height="18" x="3" y="3" rx="4" fill="none" />
				<path d="M7 8L11 12L7 16" />
				<path d="M13 16H17" />
			</svg>
		);
	}

	if (iconType === "copilot") {
		// GitHub Copilot / robot icon
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fill="none"
				stroke={color || "currentColor"}
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				xmlns="http://www.w3.org/2000/svg"
			>
				<rect x="3" y="11" width="18" height="10" rx="3" />
				<circle cx="9" cy="16" r="1.5" fill="currentColor" />
				<circle cx="15" cy="16" r="1.5" fill="currentColor" />
				<path d="M12 2V6M8 6H16" />
			</svg>
		);
	}

	if (iconType === "cursor") {
		// Cursor arrow / diamond
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fill={color || "currentColor"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M4 3L11 20L14 13L21 10L4 3Z" />
			</svg>
		);
	}

	// Generic CPU / AI icon
	return (
		<svg
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color || "currentColor"}
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			xmlns="http://www.w3.org/2000/svg"
		>
			<rect x="4" y="4" width="16" height="16" rx="2" />
			<rect x="9" y="9" width="6" height="6" />
			<path d="M9 1V4M15 1V4M9 20V23M15 20V23M20 9H23M20 15H23M1 9H4M1 15H4" />
		</svg>
	);
}
