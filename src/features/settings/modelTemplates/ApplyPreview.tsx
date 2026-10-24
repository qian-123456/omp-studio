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
import { useCallback, useEffect, useState } from "react";
import { Modal } from "../../../components/Modal";
import type {
	ModelTemplate,
	PreflightVerdict,
	ProjectOverride,
	TemplatePreview,
} from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { modelTemplateApply, modelTemplatePreview } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { EmptyState } from "../../../components/EmptyState";
import { Notice, type NoticeTone } from "../../../components/Notice";
import { Button, Chip, IconButton } from "../ui";
import { GLOBAL_SCOPE } from "./logic";
import { useModelTemplatesStore } from "./store";
import { useT } from "../../../stores/language";

const PREFLIGHT_TONE: Record<string, NoticeTone> = {
	ok: "success",
	partial: "warning",
	blocked: "danger",
};

const PREFLIGHT_TITLE_KEYS: Record<string, "ok" | "partial" | "blocked"> = {
	ok: "ok",
	partial: "partial",
	blocked: "blocked",
};

const PROVIDER_STATE_KEYS: Record<string, "available" | "exhausted" | "unmapped"> = {
	available: "available",
	exhausted: "exhausted",
	unmapped: "unmapped",
};

function PreflightNotice({ preflight }: { preflight: PreflightVerdict }) {
	const { t, locale } = useT();
	const tone = PREFLIGHT_TONE[preflight.level] ?? "info";
	const titleKey = PREFLIGHT_TITLE_KEYS[preflight.level];
	const title = titleKey ? t(`modelTemplates.preflightTitle.${titleKey}`) : t("modelTemplates.preflightTitle.default");
	return (
		<Notice tone={tone} title={title}>
			<div className="space-y-1">
				{preflight.message && <div className="select-text break-words">{preflight.message}</div>}
				<div className="flex flex-wrap items-center gap-1.5">
					{(() => {
						const stateKey = PROVIDER_STATE_KEYS[preflight.providerState];
						const label = stateKey ? t(`modelTemplates.preflightProviderState.${stateKey}`) : t("modelTemplates.preflightProviderState.unknown");
						return <Chip tone="neutral">{label}</Chip>;
					})()}
					{preflight.defaultProvider && (
						<Chip tone="neutral">{t("modelTemplates.defaultProvider", { provider: preflight.defaultProvider })}</Chip>
					)}
				</div>
				{preflight.degradedRoles.length > 0 && (
					<div className="break-words text-[var(--status-warning)]">
						{t("modelTemplates.degradedRolesNotice", { roles: preflight.degradedRoles.join(locale === "zh-CN" ? "、" : ", ") })}
					</div>
				)}
			</div>
		</Notice>
	);
}

function ProjectOverrides({ projects }: { projects: ProjectOverride[] }) {
	const { t, locale } = useT();
	const [open, setOpen] = useState(false);
	if (projects.length === 0) return null;
	return (
		<Notice tone="warning" title={t("modelTemplates.projectOverridesTitle")}>
			<div className="space-y-1">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((v) => !v)}
					className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--status-warning)_16%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--status-warning)] transition-colors hover:bg-[color-mix(in_srgb,var(--status-warning)_24%,transparent)]"
				>
					{open ? t("modelTemplates.collapseList") : t("modelTemplates.expandAllProjects", { count: String(projects.length) })}
					<ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
				</button>
				{open && (
					<ul className="space-y-1 pt-1">
						{projects.map((p) => (
							<li key={p.path} className="break-all">
								<span className="font-medium text-[var(--text)]">{p.name}</span>
								<span className="text-[var(--text-dim)]">{t("modelTemplates.pathParen", { path: p.path })}</span>
								<span>{t("modelTemplates.overrideRoles", { roles: p.roles.join(locale === "zh-CN" ? "、" : ", ") })}</span>
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
	const { t, locale } = useT();
	const [preview, setPreview] = useState<TemplatePreview | null>(null);
	const [loading, setLoading] = useState(true);
	const [applying, setApplying] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [applyError, setApplyError] = useState<string | null>(null);
	/** The backend refused because of the preflight; the footer offers 仍然应用. */
	const [refused, setRefused] = useState(false);

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
				setApplyError(result.reason || t("modelTemplates.applyRefusedQuota"));
				return;
			}
			if (result.status === "skipped") {
				toast.info(result.reason || t("modelTemplates.applySkippedSame"));
			} else if (result.status === "partial") {
				toast.info(t("modelTemplates.applyPartial", { reason: result.reason || t("modelTemplates.partialFailDefault") }));
			} else {
				toast.success(t("modelTemplates.appliedSuccess", { name: template.name }));
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

	return (
		<Modal
			// Escape/backdrop are swallowed (not passed through) while applying so they never reach settings underneath.
			onClose={() => {
				if (!applying) onClose();
			}}
			size="none"
			ariaLabel={t("modelTemplates.applyModalAria", { name: template.name })}
			className="h-[min(86vh,760px)] w-[820px] max-w-[calc(100vw-2rem)] overflow-hidden p-4 text-[var(--text)]"
		>
			<div
				className="flex min-h-0 flex-1 flex-col"
				onKeyDown={(e) => {
					// Escape must reach Modal's window listener; other keys stay inside the dialog.
					if (e.key !== "Escape") e.stopPropagation();
				}}
			>
				<div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-divider)] pb-3">
					<div className="min-w-0">
						<h2 id="model-template-apply-title" className="text-sm font-semibold text-[var(--text)]">
							{t("modelTemplates.applyModalTitle", { name: template.name })}
						</h2>
						<p className="mt-0.5 text-[11px] leading-5 text-[var(--text-muted)]">
							{t("modelTemplates.applyModalDesc1")}
							{template.scope === GLOBAL_SCOPE ? t("modelTemplates.applyScopeGlobal") : t("modelTemplates.applyScopeProject")}
						</p>
					</div>
					<IconButton icon={X} label={t("common.close")} onClick={onClose} disabled={applying} />
				</div>

				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto py-3">
					{loading && (
						<div className="flex items-center gap-2 px-1 py-6 text-xs text-[var(--text-dim)]">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							{t("modelTemplates.generatingPreview")}
						</div>
					)}

					{error && (
						<Notice
							tone="danger"
							title={t("modelTemplates.previewErrorTitle")}
							action={
								<Button size="sm" onClick={() => void load()}>
									{t("common.retry")}
								</Button>
							}
						>
							<span className="select-text break-all">{error}</span>
						</Notice>
					)}

					{preview && (
						<>
							<div className="break-all px-1 text-[11px] leading-4 text-[var(--text-muted)]">
								{t("modelTemplates.writeFile", { path: preview.configPath })}
							</div>
							{preview.willCreateFile && (
								<Notice tone="info">
									<span className="break-all">{t("modelTemplates.willCreateFile", { path: preview.configPath })}</span>
								</Notice>
							)}

							<PreflightNotice preflight={preview.preflight} />

							<section className="space-y-1">
								<div className="flex items-center gap-2 px-1">
									<h3 className="text-xs font-semibold text-[var(--text)]">{t("modelTemplates.upcomingChanges")}</h3>
									<Chip tone={hasEdits ? "accent" : "neutral"}>{t("modelTemplates.editsCount", { count: String(preview.edits.length) })}</Chip>
								</div>
								{hasEdits ? (
									<div className="divide-y divide-[var(--border-divider)] rounded-xl hairline bg-[var(--well-bg)]">
										{preview.edits.map((edit) => (
											<div key={edit.role} className="px-3 py-2">
												<div className="break-all font-mono text-[11px] font-semibold text-[var(--text)]">
													{edit.role}
												</div>
												<div className="mt-0.5 flex flex-wrap items-start gap-1.5 text-[11px] leading-[18px]">
													<span className="break-all text-[var(--text-muted)]">{edit.before === null || edit.before === "" ? t("modelTemplates.unconfigured") : edit.before}</span>
													<ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[var(--text-dim)]" />
													<span className="break-all font-medium text-[var(--text)]">{edit.after === null || edit.after === "" ? t("modelTemplates.unconfigured") : edit.after}</span>
												</div>
											</div>
										))}
									</div>
								) : (
									<EmptyState
										title={t("modelTemplates.applySkippedSame")}
										description={t("modelTemplates.noChangesDesc")}
									/>
								)}
							</section>

							{preview.unchanged.length > 0 && (
								<section className="px-1">
									<h3 className="text-xs font-semibold text-[var(--text)]">{t("modelTemplates.unchangedRolesTitle")}</h3>
									<p className="mt-0.5 break-all text-[11px] leading-4 text-[var(--text-muted)]">
										{preview.unchanged.join(locale === "zh-CN" ? "、" : ", ")}
									</p>
								</section>
							)}

							{preview.notInTemplate.length > 0 && (
								<Notice tone="info" title={t("modelTemplates.notInTemplateTitle")}>
									<span className="break-all">{preview.notInTemplate.join(locale === "zh-CN" ? "、" : ", ")}</span>
								</Notice>
							)}

							<ProjectOverrides projects={preview.projectOverrides} />
						</>
					)}

					{applyError && (
						<Notice tone="danger" title={t("modelTemplates.applyFailedTitle")}>
							<span className="select-text break-all">{applyError}</span>
						</Notice>
					)}
				</div>

				<div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border-divider)] pt-3">
					<Button onClick={onClose} disabled={applying}>
						{t("common.cancel")}
					</Button>
					{forceNeeded ? (
						<Button
							variant="danger"
							disabled={busy || !preview}
							loading={applying}
							onClick={() => void apply(true)}
						>
							{t("modelTemplates.forceApply")}
						</Button>
					) : (
						<Button
							variant="primary"
							disabled={busy || !preview}
							loading={applying}
							onClick={() => void apply(false)}
						>
							{t("modelTemplates.confirmApply")}
						</Button>
					)}
				</div>
			</div>
		</Modal>
	);
}
