/** Settings ▸ 使用说明 (`guide`): the in-app product guide, loaded on demand. */
import { Suspense, lazy } from "react";

const GuideReader = lazy(() =>
	import("../../guide/GuideReader").then((m) => ({ default: m.GuideReader })),
);

export function GuideSection() {
	return (
		<Suspense fallback={<p className="text-sm text-[var(--text-60)]">加载中</p>}>
			<GuideReader />
		</Suspense>
	);
}
