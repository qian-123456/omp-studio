/** Settings ▸ 模型与供应商 (`providers`): API keys / provider catalog and subscription quota tabs. */
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { Segmented } from "../../../components/Segmented";
import { ProviderPanel } from "../../providers/ProviderPanel";
import { OmpSections } from "../OmpSettingsList";
import { SectionJumpBar } from "../SectionJumpBar";
import { ompSectionFor } from "../ompPlacement";
import { useSettingsNav } from "../settingsNav";
import { Button, SectionHeader } from "../ui";
import { QuotaDashboardCard } from "./QuotaDashboardCard";
import { RawFilesDialog } from "./RawFilesDialog";

type Tab = "config" | "quota";

/** Tab that hosts a deep-link target (omp key placed on the quota slot, or the quota dashboard itself). */
function tabForFocus(focusKey: string | null): Tab | null {
	if (!focusKey) return null;
	if (focusKey === "quotaDashboard") return "quota";
	if (focusKey.startsWith("provider:")) return "config";
	if (focusKey === "providerList") return "config";
	const slot = ompSectionFor(focusKey).slot;
	if (slot === "quota") return "quota";
	if (slot === "keys") return "config";
	return null;
}

export function ProvidersSection() {
	const { focusKey, focusRequest } = useSettingsNav();
	const [tab, setTab] = useState<Tab>(() => tabForFocus(focusKey) ?? "config");
	const [rawOpen, setRawOpen] = useState(false);

	// biome-ignore lint/correctness/useExhaustiveDependencies: focusRequest re-fires the jump for a repeated key
	useEffect(() => {
		const wanted = tabForFocus(focusKey);
		if (wanted) setTab(wanted);
	}, [focusKey, focusRequest]);

	return (
		<div className="space-y-5">
			<SectionHeader title="模型与供应商" description="API 密钥、订阅额度，以及启用哪些模型和供应商" />
			<SectionJumpBar />
			<div className="flex items-center justify-between gap-3">
				<Segmented
					options={[
						{ value: "config", label: "接口与密钥" },
						{ value: "quota", label: "订阅与配额" },
					]}
					value={tab}
					onChange={setTab}
					size="md"
				/>
				<Button icon={FileText} onClick={() => setRawOpen(true)}>编辑原始配置文件</Button>
			</div>
			{tab === "config" ? (
				<div className="space-y-6">
					<div data-field-id="providerList" data-jump="供应商" className="scroll-mt-4">
						<ProviderPanel />
					</div>
					<OmpSections page="providers" slot="keys" />
				</div>
			) : (
				<div className="space-y-6">
					<div data-jump="配额概览" className="scroll-mt-4">
						<QuotaDashboardCard />
					</div>
					<OmpSections page="providers" slot="quota" />
				</div>
			)}
			{rawOpen ? <RawFilesDialog onClose={() => setRawOpen(false)} /> : null}
		</div>
	);
}
