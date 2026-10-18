import { FolderGit2 } from "lucide-react";
import { useMemo } from "react";
import { NativeSelect } from "../../components/NativeSelect";
import { useSessions } from "../../stores/sessions";
import { useBacklog } from "./backlogStore";
import {
	CAPTURE_PROJECT_NONE,
	captureProjectOptions,
	projectDisplayName,
	resolveCaptureProject,
} from "./ideasLogic";

const AUTO = "__auto__";

/** 「归属项目」 picker for new ideas; the resolved choice is what `backlogAdd` persists. */
export function CaptureProjectSelect({
	currentProject,
	className = "",
}: {
	currentProject: string | null;
	className?: string;
}) {
	const pick = useBacklog((s) => s.captureProject);
	const setPick = useBacklog((s) => s.setCaptureProject);
	const workspaces = useSessions((s) => s.workspaces);
	const options = useMemo(() => captureProjectOptions(workspaces), [workspaces]);

	const value = pick === null ? AUTO : pick;
	const resolved = resolveCaptureProject(pick, currentProject);
	// A remembered or current project that is no longer a workspace must stay selectable.
	const extra =
		pick !== null && pick !== CAPTURE_PROJECT_NONE && !options.some((o) => o.path === pick) ? pick : null;
	const autoName = currentProject ? projectDisplayName(currentProject) : "无项目";

	return (
		<label className={`flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-dim)] ${className}`}>
			<FolderGit2 className="h-3 w-3 shrink-0" />
			<span className="shrink-0">归属项目</span>
			<NativeSelect
				value={value}
				onChange={(e) => setPick(e.target.value === AUTO ? null : e.target.value)}
				title={resolved ?? "不归属任何项目"}
				containerClassName="min-w-0 flex-1"
				className="py-0.5 pl-2 text-[11px]"
			>
				<option value={AUTO}>跟随当前会话（{autoName}）</option>
				{options.map((o) => (
					<option key={o.path} value={o.path}>
						{o.name}
					</option>
				))}
				{extra && <option value={extra}>{projectDisplayName(extra)}</option>}
				<option value={CAPTURE_PROJECT_NONE}>不归属项目</option>
			</NativeSelect>
		</label>
	);
}
