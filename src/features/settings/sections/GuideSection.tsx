/** Settings ▸ 使用说明 (`guide`): the in-app product guide, loaded on demand. */
import { Suspense, lazy } from "react";
import { useT } from "../../../stores/language";

const GuideReader = lazy(() =>
	import("../../guide/GuideReader").then((m) => ({ default: m.GuideReader })),
);

export function GuideSection() {
	const { t } = useT();
	return (
		<Suspense fallback={<p className="text-sm text-[var(--text-60)]">{t("settingsSections.guide.loading")}</p>}>
			<GuideReader />
		</Suspense>
	);
}
