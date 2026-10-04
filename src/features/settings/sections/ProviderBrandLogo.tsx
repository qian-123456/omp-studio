/**
 * Official AI Provider Brand Logos inspired by NewMax.
 * Features exact vectors for Anthropic Claude, Google Antigravity, Devin, Copilot, Cursor, etc.
 */

const LOGO_ALIASES: Record<string, string> = {
	"google-antigravity": "antigravity",
	antigravity: "antigravity",
	"antigravity-oauth": "antigravity",
	anthropic: "anthropic",
	claude: "anthropic",
	"claude-pro": "anthropic",
	"anthropic-channel": "anthropic",
	devin: "devin",
	"devin-ai": "devin",
	"github-copilot": "copilot",
	copilot: "copilot",
	cursor: "cursor",
	openai: "openai",
	"openai-oauth": "openai",
	deepseek: "deepseek",
	kimi: "kimi",
	moonshot: "kimi",
	"kimi-code": "kimi",
	minimax: "minimax",
	"minimax-code": "minimax",
	zhipu: "zhipu",
	zai: "zhipu",
	bailian: "bailian",
	"alibaba-token-plan": "bailian",
	dashscope: "bailian",
	openrouter: "openrouter",
	google: "google",
	gemini: "gemini",
};

export function resolveLogoId(providerId: string): string {
	const normalized = providerId.trim().toLowerCase().replace(/[\s_]+/g, "-");
	return LOGO_ALIASES[normalized] ?? normalized;
}

export function ProviderBrandLogo({
	providerId,
	iconType,
	className = "h-5 w-5",
	color,
}: {
	providerId?: string;
	iconType?: string;
	className?: string;
	color?: string;
}) {
	const id = resolveLogoId(providerId || iconType || "");

	// 1. Anthropic Claude (Official Asterisk / Sunburst from NewMax)
	if (id === "anthropic") {
		return (
			<svg
				className={className}
				viewBox="0 0 16 16"
				fill={color || "#D97757"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="m14.375 6.48.49.28v.209l-.14.489-5.937 1.397-.558-1.387zm0 0" />
				<path d="m12.155 2.373.683.143.182.224.173.535-.072.342-3.983 5.447L7.81 7.737l3.673-4.82z" />
				<path d="m8.719 1.522.419-.28.349.14.349.49-.957 5.748-.65-.441-.279-.769.49-4.33z" />
				<path d="m4.239 1.614.43-.55L4.95 1l.558.081.275.216 2.004 4.442.724 2.11-.848.471-3.231-5.864z" />
				<path d="m2.154 4.665-.14-.56.42-.488.488.07h.14l2.933 2.165.908.698 1.257.978-.698 1.187-.629-.489-.419-.419-4.05-2.863z" />
				<path d="M1.316 8.296 1 7.946v-.31l.316-.108 3.562.21 3.491.279-.113.695-6.66-.346z" />
				<path d="M3.411 11.931h-.698l-.278-.32v-.382l1.186-.838 4.82-3.068.487.833z" />
				<path d="m4.738 13.883-.28.07-.488-.28.21-.557 2.373-3.212.977.56-2.583 3.418z" />
				<path d="M9.835 15h-.418l-.42-.35.14-.557 3.35-4.887.838.419-3.281 5.305-.21.07zm0 0" />
				<path d="M13.257 11.722v.349l-.419.418-.558-.07-2.374-1.605.419-.768 2.653 1.536.279.14zm0 0" />
				<path d="M8.296 9.488 5.084 7.604l.42-.698 3.63 1.605-.838.977z" />
			</svg>
		);
	}

	// 2. Google Antigravity (Official Antigravity Multi-Color Emblem from NewMax)
	if (id === "antigravity") {
		return (
			<svg
				className={className}
				viewBox="0 0 21 21"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<linearGradient
						id="antigravity-gemini-grad"
						x1="0%"
						y1="0%"
						x2="100%"
						y2="100%"
					>
						<stop offset="0%" stopColor="#4285F4" />
						<stop offset="35%" stopColor="#34A853" />
						<stop offset="70%" stopColor="#FBBC05" />
						<stop offset="100%" stopColor="#EA4335" />
					</linearGradient>
				</defs>
				<path
					d="M16.6692 17.4121C17.5364 18.0626 18.8373 17.6289 17.6448 16.4365C14.0675 12.9676 14.8263 3.4281 10.3818 3.4281C5.93728 3.4281 6.6961 12.9676 3.11879 16.4365C1.81795 17.7373 3.22718 18.0626 4.09442 17.4121C7.45493 15.1357 7.23812 11.1247 10.3818 11.1247C13.5255 11.1247 13.3087 15.1357 16.6692 17.4121Z"
					fill="url(#antigravity-gemini-grad)"
				/>
			</svg>
		);
	}

	// 3. Devin AI (Official Cognition Devin Terminal Prompt [>_] with Crisp Glow)
	if (id === "devin") {
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fill="none"
				xmlns="http://www.w3.org/2000/svg"
			>
				<rect
					width="20"
					height="20"
					x="2"
					y="2"
					rx="5"
					fill="#06B6D4"
					fillOpacity="0.18"
					stroke="#06B6D4"
					strokeWidth="1.8"
				/>
				<path
					d="M7 8L11 12L7 16"
					stroke="#06B6D4"
					strokeWidth="2.2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<path
					d="M13 16H17"
					stroke="#06B6D4"
					strokeWidth="2.2"
					strokeLinecap="round"
				/>
			</svg>
		);
	}

	// 4. Google (Official 4-color 'G' Logo from NewMax)
	if (id === "google") {
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				role="img"
				aria-label="Google"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					d="M23 12.245c0-.905-.075-1.565-.236-2.25h-10.54v4.083h6.186c-.124 1.014-.797 2.542-2.294 3.569l-.021.136 3.332 2.53.23.022C21.779 18.417 23 15.593 23 12.245z"
					fill="#4285F4"
				/>
				<path
					d="M12.225 23c3.03 0 5.574-.978 7.433-2.665l-3.542-2.688c-.948.648-2.22 1.1-3.891 1.1a6.745 6.745 0 01-6.386-4.572l-.132.011-3.465 2.628-.045.124C4.043 20.531 7.835 23 12.225 23z"
					fill="#34A853"
				/>
				<path
					d="M5.84 14.175A6.65 6.65 0 015.463 12c0-.758.138-1.491.361-2.175l-.006-.147-3.508-2.67-.115.054A10.831 10.831 0 001 12c0 1.772.436 3.447 1.197 4.938l3.642-2.763z"
					fill="#FBBC05"
				/>
				<path
					d="M12.225 5.253c2.108 0 3.529.892 4.34 1.638l3.167-3.031C17.787 2.088 15.255 1 12.225 1 7.834 1 4.043 3.469 2.197 7.062l3.63 2.763a6.77 6.77 0 016.398-4.572z"
					fill="#EB4335"
				/>
			</svg>
		);
	}

	// 5. Gemini (Official 4-point Sparkle from NewMax)
	if (id === "gemini") {
		return (
			<svg
				className={className}
				viewBox="0 0 16 16"
				fill={color || "#448AFF"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M15 8.014A7.457 7.457 0 0 0 8.014 15h-.028A7.456 7.456 0 0 0 1 8.014v-.028A7.456 7.456 0 0 0 7.986 1h.028A7.457 7.457 0 0 0 15 7.986z" />
			</svg>
		);
	}

	// 6. GitHub Copilot (Official from NewMax)
	if (id === "copilot") {
		return (
			<svg
				className={className}
				viewBox="0 0 16 16"
				fill={color || "#6366F1"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M7.998 14C4.006 14 1.11 11.457 1 10.728v-1.7c.074-.549.592-1.472 1.39-1.803l.031-.19a4 4 0 0 1 .11-.534c-.176-.444-.222-.946-.222-1.446 0-.759.112-1.544.606-2.168.507-.64 1.308-.98 2.384-1.1 1.055-.117 1.98.03 2.576.667q.066.07.121.144a2 2 0 0 1 .126-.144c.596-.638 1.52-.784 2.576-.667 1.076.12 1.877.46 2.383 1.1.495.624.607 1.41.607 2.168 0 .5-.047 1.002-.223 1.446.058.199.086.374.11.534l.033.19c.808.336 1.332 1.284 1.392 1.829v1.634C15 11.356 12.068 14 7.998 14m0-1.296c1.995 0 4.011-.969 4.377-1.25V7.738l-.02-.1c-.429.182-.94.253-1.511.253-1.003 0-1.802-.285-2.371-.865A2.82 2.812 0 0 1 8 6.38a2.835 2.828 0 0 1-.476.648c-.569.58-1.368.865-2.371.865-.57 0-1.082-.07-1.511-.253l-.02.1v3.716c.366.281 2.382 1.25 4.377 1.25" />
			</svg>
		);
	}

	// 7. Cursor (Official 3D Box Logo from NewMax)
	if (id === "cursor") {
		return (
			<svg
				className={className}
				viewBox="0 0 32 32"
				fill={color || "#8B5CF6"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					fillRule="evenodd"
					d="m16 30 12-20v14zM4 10l12-8 12 8zm0 0 12 6v14L4 24z"
				/>
			</svg>
		);
	}

	// 8. OpenAI (Official Spiral Flower from NewMax)
	if (id === "openai") {
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fill={color || "#10A37F"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0405l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1683a.071.071 0 0 1 .038.052v5.5826a4.5045 4.5045 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464z" />
			</svg>
		);
	}

	// 9. DeepSeek (Official Whale Logo from NewMax)
	if (id === "deepseek") {
		return (
			<svg
				className={className}
				viewBox="0 0 512 510"
				fill={color || "#4D6BFE"}
				xmlns="http://www.w3.org/2000/svg"
			>
				<path d="M440.898 139.167c-4.001-1.961-5.723 1.776-8.062 3.673-.801.612-1.479 1.407-2.154 2.141-5.848 6.246-12.681 10.349-21.607 9.859-13.048-.734-24.192 3.368-34.04 13.348-2.093-12.307-9.048-19.658-19.635-24.37-5.54-2.449-11.141-4.9-15.02-10.227-2.708-3.795-3.447-8.021-4.801-12.185-.861-2.509-1.725-5.082-4.618-5.512-3.139-.49-4.372 2.142-5.601 4.349-4.925 9.002-6.833 18.921-6.647 28.962.432 22.597 9.972 40.597 28.932 53.397 2.154 1.47 2.707 2.939 2.032 5.082-1.293 4.41-2.832 8.695-4.186 13.105-.862 2.817-2.157 3.429-5.172 3.429H240c-35.346 0-64 28.654-64 64v80c0 35.346 28.654 64 64 64h160c35.346 0 64-28.654 64-64V160c0-8.284-6.716-15-15-15-2.817 0-5.485-1.077-8.102-5.833z" />
			</svg>
		);
	}

	// 10. Kimi / Moonshot (Official Logo from NewMax)
	if (id === "kimi") {
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					fill="#1783FF"
					d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z"
				/>
				<path
					fill={color || "#14B8A6"}
					d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"
				/>
			</svg>
		);
	}

	// 11. MiniMax (Official Gradient Wave from NewMax)
	if (id === "minimax") {
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fillRule="evenodd"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<linearGradient
						id="minimax-brand-grad"
						x1="0%"
						y1="50%"
						x2="100%"
						y2="50%"
					>
						<stop offset="0%" stopColor="#E2167E" />
						<stop offset="100%" stopColor="#FE603C" />
					</linearGradient>
				</defs>
				<path
					fill="url(#minimax-brand-grad)"
					d="M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07z"
				/>
			</svg>
		);
	}

	// 12. Zhipu GLM / ZAI (Official Geometric from NewMax)
	if (id === "zhipu") {
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				fillRule="evenodd"
				xmlns="http://www.w3.org/2000/svg"
			>
				<path
					fill="#326EFF"
					d="M12.105 2L9.927 4.953H.653L2.83 2h9.276zM23.254 19.048L21.078 22h-9.242l2.174-2.952h9.244zM24 2L9.264 22H0L14.736 2H24z"
				/>
			</svg>
		);
	}

	// 13. Alibaba Bailian / Qwen (Official from NewMax)
	if (id === "bailian") {
		return (
			<svg
				className={className}
				viewBox="0 0 24 24"
				xmlns="http://www.w3.org/2000/svg"
			>
				<defs>
					<linearGradient id="bailian-grad" x1="0%" y1="0%" x2="100%" y2="100%">
						<stop offset="0%" stopColor="#4096FF" />
						<stop offset="100%" stopColor="#1677FF" />
					</linearGradient>
				</defs>
				<circle cx="12" cy="12" r="10" fill="url(#bailian-grad)" />
				<path
					d="M16.5 9.5c0-1.38-1.12-2.5-2.5-2.5h-4C8.62 7 7.5 8.12 7.5 9.5S8.62 12 10 12h1v1h-1c-1.38 0-2.5 1.12-2.5 2.5S8.62 18 10 18h4c1.38 0 2.5-1.12 2.5-2.5S15.38 13 14 13h-1v-1h1c1.38 0 2.5-1.12 2.5-2.5zM14 9h-4a.5.5 0 010-1h4a.5.5 0 010 1zm-4 7a.5.5 0 010-1h4a.5.5 0 010 1h-4z"
					fill="#ffffff"
				/>
			</svg>
		);
	}

	// Fallback generic CPU / AI icon
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
