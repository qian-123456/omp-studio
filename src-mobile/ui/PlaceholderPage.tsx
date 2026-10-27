import type { JSX } from "react";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";

export function placeholderPage(title: string): (props: unknown) => JSX.Element {
	return function PlaceholderPage() {
		return (
			<div className="flex h-full flex-col">
				<PageHeader title={title} />
				<EmptyState title="开发中" hint={title} />
			</div>
		);
	};
}
