import { Hammer } from "lucide-react";
import type { JSX } from "react";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";

export function placeholderPage(title: string): (props: unknown) => JSX.Element {
	return function PlaceholderPage() {
		return (
			<div className="flex h-full flex-col bg-m-bg text-m-text">
				<PageHeader title={title} />
				<EmptyState icon={<Hammer size={26} strokeWidth={1.75} />} title="这个页面还在开发中" hint={`「${title}」稍后开放，先用电脑端操作`} />
			</div>
		);
	};
}
