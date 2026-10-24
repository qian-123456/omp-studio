/**
 * [D] Settings ▸ 模板与自动切换: role templates plus quota-driven auto switching.
 *
 * Mounts the template list, the rule list and the switch log. The store keeps
 * the backend snapshot and the live quota status; `model_switch:changed`
 * (emitted after automatic switches and undos) re-reads both while mounted.
 */
import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ModelTemplate } from "../../../lib/contracts";
import { errMsg } from "../../../lib/dialogs";
import { modelTemplateCapture } from "../../../lib/ipc";
import { Notice } from "../../../components/Notice";
import { Button, IconButton, SectionHeader } from "../ui";
import { ApplyPreview } from "./ApplyPreview";
import { RulesCard } from "./RulesCard";
import { SwitchLogCard } from "./SwitchLogCard";
import { TemplateEditor, type TemplateDraft, draftFromInput, draftFromTemplate } from "./TemplateEditor";
import { TemplatesCard } from "./TemplatesCard";
import { inScope, type ScopeProject } from "./logic";
import { useModelTemplatesStore } from "./store";
import { useT } from "../../../stores/language";

export function ModelTemplatesPanel({ scope, projects }: { scope: string; projects: ScopeProject[] }) {
	const { t, locale } = useT();
	const snapshot = useModelTemplatesStore((s) => s.snapshot);
	const status = useModelTemplatesStore((s) => s.status);
	const loading = useModelTemplatesStore((s) => s.loading);
	const error = useModelTemplatesStore((s) => s.error);
	const statusError = useModelTemplatesStore((s) => s.statusError);
	const refresh = useModelTemplatesStore((s) => s.refresh);

	const [editorDraft, setEditorDraft] = useState<TemplateDraft | null>(null);
	const [applying, setApplying] = useState<ModelTemplate | null>(null);
	const [capturing, setCapturing] = useState(false);
	const [captureError, setCaptureError] = useState<string | null>(null);
	const scopedTemplates = useMemo(() => inScope(snapshot?.templates ?? [], scope), [snapshot, scope]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// Backend-driven switches (rules firing, undos) refresh both sources.
	useEffect(() => {
		let unlisten: (() => void) | null = null;
		let cancelled = false;
		void useModelTemplatesStore
			.getState()
			.subscribe()
			.then((stop) => {
				if (cancelled) stop();
				else unlisten = stop;
			});
		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);

	const capture = async () => {
		setCapturing(true);
		setCaptureError(null);
		try {
			const input = await modelTemplateCapture(t("modelTemplates.defaultTemplateName", { index: String(scopedTemplates.length + 1) }), scope);
			setEditorDraft(draftFromInput(input));
		} catch (e) {
			setCaptureError(errMsg(e));
		} finally {
			setCapturing(false);
		}
	};

	const duplicate = (template: ModelTemplate) => {
		setEditorDraft({
			...draftFromTemplate(template),
			id: null,
			name: t("modelTemplates.duplicateTemplateName", { name: template.name }),
			isBottomLine: false,
		});
	};

	return (
		<div className="space-y-6" data-testid="model-templates-panel">
			<SectionHeader
				title={t("modelTemplates.panelTitle")}
				description={t("modelTemplates.panelDesc")}
				actions={
					<IconButton
						icon={RefreshCw}
						label={t("modelTemplates.refreshAria")}
						onClick={() => void refresh()}
						disabled={loading}
					/>
				}
			/>

			{error && (
				<Notice
					tone="danger"
					title={snapshot ? t("modelTemplates.readErrorFallback") : t("modelTemplates.readError")}
					action={
						<Button size="sm" onClick={() => void refresh()}>
							{t("common.retry")}
						</Button>
					}
				>
					<span className="select-text break-all">{error}</span>
				</Notice>
			)}

			{status?.blocked && status.blocked.scope === scope && (
				<Notice tone="danger" title={t("modelTemplates.blockedTitle")}>
					<span className="select-text break-all">
						{status.blocked.message}
						{status.blocked.providers.length > 0 ? t("modelTemplates.blockedProviders", { providers: status.blocked.providers.join(locale === "zh-CN" ? "、" : ", ") }) : ""}
					</span>
				</Notice>
			)}

			{statusError && (
				<Notice tone="warning" title={t("modelTemplates.statusErrorTitle")}>
					<span className="select-text break-all">
						{t("modelTemplates.statusErrorDesc", { error: statusError })}
					</span>
				</Notice>
			)}

			{captureError && (
				<Notice tone="danger" title={t("modelTemplates.captureErrorTitle")}>
					<span className="select-text break-all">{captureError}</span>
				</Notice>
			)}

			<TemplatesCard
				snapshot={snapshot}
				scope={scope}
				projects={projects}
				status={status}
				onNew={() => void capture()}
				creating={capturing}
				onEdit={(template) => setEditorDraft(draftFromTemplate(template))}
				onDuplicate={duplicate}
				onApply={(template) => setApplying(template)}
			/>

			<RulesCard snapshot={snapshot} status={status} scope={scope} projects={projects} />

			<SwitchLogCard snapshot={snapshot} scope={scope} />

			{editorDraft && (
				<TemplateEditor
					draft={editorDraft}
					templates={scopedTemplates}
					onClose={() => setEditorDraft(null)}
				/>
			)}

			{applying && <ApplyPreview template={applying} onClose={() => setApplying(null)} />}
		</div>
	);
}
