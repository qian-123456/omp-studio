/**
 * [D] Settings ▸ 模板与自动切换: preview before applying a template.
 *
 * Reads `modelTemplatePreview` first (never applies blind), then shows every
 * role edit as 旧 → 新, the roles the template does not mention, the projects
 * whose own `.omp/config.yml` overrides keep them from following, and the
 * preflight verdict as a three-colour `Notice`. A blocked verdict hides the
 * primary button behind 「仍然应用」.
 */
import { ArrowRight, ChevronDown, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z_LAYER } from "../../../components/FloatingLayer";
import type {
	ModelTemplate,
	PreflightVerdict,
	ProjectOverride,
	TemplatePreview,
} from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { claimEscape } from "../../../lib/escapeClaim";
import { isComposing } from "../../../lib/hooks";
import { modelTemplateApply, modelTemplatePreview } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { Button, Chip, EmptyState, IconButton, Notice, type NoticeTone } from "../ui";
import { GLOBAL_SCOPE } from "./logic";
import { useModelTemplatesStore } from "./store";

const PREFLIGHT_TONE: Record<string, NoticeTone> = {
	ok: "success",
	partial: "warning",
	blocked: "danger",
};

const PREFLIGHT_TITLE: Record<string, string> = {
	ok: "可以应用",
	partial: "部分角色额度不足",
	blocked: "当前额度不满足",
};

const PROVIDER_STATE_LABEL: Record<string, string> = {
	available: "额度可用",
	exhausted: "额度已用尽",
	unmapped: "没有额度报告",
	unknown: "无法判断额度",
};

function PreflightNotice({ preflight }: { preflight: PreflightVerdict }) {
	const tone = PREFLIGHT_TONE[preflight.level] ?? "info";
	const title = PREFLIGHT_TITLE[preflight.level] ?? "预检结果";
	return (
		<Notice tone={tone} title={title}>
			<div className="space-y-1">
				{preflight.message && <div className="select-text break-words">{preflight.message}</div>}
				<div className="flex flex-wrap items-center gap-1.5">
					<Chip tone="neutral">{PROVIDER_STATE_LABEL[preflight.providerState] ?? preflight.providerState}</Chip>
					{preflight.defaultProvider && (
						<Chip tone="neutral">主力模型供应商：{preflight.defaultProvider}</Chip>
					)}
				</div>
				{preflight.degradedRoles.length > 0 && (
					<div className="break-words text-[var(--status-warning)]">
						这些角色指向已用尽的供应商：{preflight.degradedRoles.join("、")}
					</div>
				)}
			</div>
		</Notice>
	);
}

function ProjectOverrides({ projects }: { projects: ProjectOverride[] }) {
	const [open, setOpen] = useState(false);
	if (projects.length === 0) return null;
	return (
		<Notice tone="warning" title="这些项目有自己的覆盖，不会跟随">
			<div className="space-y-1">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
					className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--status-warning)_16%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-warning)] transition-colors hover:bg-[color-mix(in_srgb,var(--status-warning)_24%,transparent)]"
				>
					{open ? "收起列表" : `展开全部 ${projects.length} 个项目`}
					<ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
				</button>
				{open && (
					<ul className="space-y-1 pt-1">
						{projects.map((p) => (
							<li key={p.path} className="break-all">
								<span className="font-medium text-[var(--text)]">{p.name}</span>
								<span className="text-[var(--text-dim)]">（{p.path}）</span>
								<span>覆盖角色：{p.roles.join("、")}</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</Notice>
	);
}

export function ApplyPreview({
	template,
	onClose,
}: {
	template: ModelTemplate;
	onClose: () => void;
}) {
	const [preview, setPreview] = useState<TemplatePreview | null>(null);
	const [loading, setLoading] = useState(true);
	const [applying, setApplying] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [applyError, setApplyError] = useState<string | null>(null);
	/** The backend refused because of the preflight; the footer offers 仍然应用. */
	const [refused, setRefused] = useState(false);
	const dialogRef = useRef<HTMLDivElement>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setPreview(await modelTemplatePreview(template.id));
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setLoading(false);
		}
	}, [template.id]);

	useEffect(() => {
		void load();
	}, [load]);

	// Move focus into the dialog so Tab/Escape stay inside it.
	useEffect(() => {
		dialogRef.current?.focus();
	}, []);

	const apply = async (force: boolean) => {
		setApplying(true);
		setApplyError(null);
		setRefused(false);
		try {
			const result = await modelTemplateApply(template.id, force);
			await useModelTemplatesStore.getState().refresh();
			// Refused keeps the dialog open: the user can still choose 仍然应用.
			if (result.status === "refused") {
				setRefused(true);
				setApplyError(result.reason || "额度预检未通过，应用被拒绝");
				return;
			}
			if (result.status === "skipped") {
				toast.info(result.reason || "当前配置已与模板一致");
			} else if (result.status === "partial") {
				toast.info(`已部分应用：${result.reason || "部分会话未能切换"}`);
			} else {
				toast.success(`已应用模板「${template.name}」`);
			}
			onClose();
		} catch (e) {
			setApplyError(errMsg(e));
		} finally {
			setApplying(false);
		}
	};

	// A blocked preflight (or a refusal from the backend) needs the explicit force button.
	const forceNeeded = preview?.preflight.level === "blocked" || refused;
	const hasEdits = (preview?.edits.length ?? 0) > 0;
	const busy = loading || applying;

	return createPortal(
		<div
			style={{ zIndex: Z_LAYER.modal }}
			className="fixed inset-0 flex items-center justify-center bg-[var(--overlay)] p-6 backdrop-blur-sm"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget && !applying) onClose();
			}}
		>
			<div
				ref={dialogRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="model-template-apply-title"
				tabIndex={-1}
				className="flex h-[min(86vh,760px)] w-[820px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-[var(--bg-panel)] p-4 text-[var(--text)] shadow-apple-modal hairline outline-none"
				onMouseDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (isComposing(e)) return;
					if (e.key === "Escape") {
						claimEscape(e);
						if (!applying) onClose();
					}
				}}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-divider)] pb-3">
					<div className="min-w-0">
						<h2 id="model-template-apply-title" className="text-sm font-semibold text-[var(--text)]">
							应用模板「{template.name}」
						</h2>
						<p className="mt-0.5 text-[11px] leading-5 text-[var(--text-muted)]">
							先确认将要发生的改动，再决定是否应用。
							{template.scope === GLOBAL_SCOPE ? "只会写全局模型角色。" : "只会写该项目的模型角色。"}
						</p>
					</div>
					<IconButton icon={X} label="关闭" onClick={onClose} disabled={applying} />
				</div>

				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
					{loading && (
						<div className="flex items-center gap-2 px-1 py-6 text-xs text-[var(--text-dim)]">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							正在生成预览
						</div>
					)}

					{error && (
						<Notice
							tone="danger"
							title="无法生成预览"
							action={
								<Button size="sm" onClick={() => void load()}>
									重试
								</Button>
							}
						>
							<span className="select-text break-all">{error}</span>
						</Notice>
					)}

					{preview && (
						<>
							<div className="break-all px-1 text-[11px] leading-4 text-[var(--text-muted)]">
								写入文件：<span className="select-text font-mono text-[var(--text)]">{preview.configPath}</span>
							</div>
							{preview.willCreateFile && (
								<Notice tone="info">
									<span className="break-all">将新建 {preview.configPath}</span>
								</Notice>
							)}

							<PreflightNotice preflight={preview.preflight} />

							<section className="space-y-1">
								<div className="flex items-center gap-2 px-1">
									<h3 className="text-xs font-semibold text-[var(--text)]">将要改动</h3>
									<Chip tone={hasEdits ? "accent" : "neutral"}>{preview.edits.length} 处</Chip>
								</div>
								{hasEdits ? (
									<div className="divide-y divide-[var(--border-divider)] rounded-xl hairline bg-[var(--well-bg)]">
										{preview.edits.map((edit) => (
											<div key={edit.role} className="px-3 py-2">
												<div className="break-all font-mono text-[11px] font-semibold text-[var(--text)]">
													{edit.role}
												</div>
												<div className="mt-0.5 flex flex-wrap items-start gap-1.5 text-[11px] leading-[18px]">
													<span className="break-all text-[var(--text-muted)]">{edit.before === null || edit.before === "" ? "未配置" : edit.before}</span>
													<ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-dim)]" />
													<span className="break-all font-medium text-[var(--text)]">{edit.after === null || edit.after === "" ? "未配置" : edit.after}</span>
												</div>
											</div>
										))}
									</div>
								) : (
									<EmptyState
										title="当前配置已与模板一致"
										description="应用不会产生任何改动。"
									/>
								)}
							</section>

							{preview.unchanged.length > 0 && (
								<section className="px-1">
									<h3 className="text-xs font-semibold text-[var(--text)]">保持不变的已覆盖角色</h3>
									<p className="mt-0.5 break-all text-[11px] leading-4 text-[var(--text-muted)]">
										{preview.unchanged.join("、")}
									</p>
								</section>
							)}

							{preview.notInTemplate.length > 0 && (
								<Notice tone="info" title="以下角色不在模板中，将保持不变">
									<span className="break-all">{preview.notInTemplate.join("、")}</span>
								</Notice>
							)}

							<ProjectOverrides projects={preview.projectOverrides} />
						</>
					)}

					{applyError && (
						<Notice tone="danger" title="应用失败">
							<span className="select-text break-all">{applyError}</span>
						</Notice>
					)}
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-3">
					<Button onClick={onClose} disabled={applying}>
						取消
					</Button>
					{forceNeeded ? (
						<Button
							variant="danger"
							disabled={busy || !preview}
							loading={applying}
							onClick={() => void apply(true)}
						>
							仍然应用
						</Button>
					) : (
						<Button
							variant="primary"
							disabled={busy || !preview}
							loading={applying}
							onClick={() => void apply(false)}
						>
							确认应用
						</Button>
					)}
				</div>
			</div>
		</div>,
		document.body,
	);
}
