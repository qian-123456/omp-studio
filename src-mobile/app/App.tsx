import { Suspense, useEffect } from "react";
import { ROUTES } from "./routes";
import { ConnectionBanner } from "./ConnectionBanner";
import { ErrorBoundary } from "./ErrorBoundary";
import { useTheme } from "./theme";
import { installViewportTracking } from "./viewport";
import { useRoute } from "../core/nav";
import { startSessionsSync } from "../core/stores/sessions";
import { DialogHost } from "../ui/Dialog";
import { EmptyState } from "../ui/EmptyState";
import { ImageViewerHost } from "../ui/ImageViewer";
import { Spinner } from "../ui/Spinner";
import { ToastHost } from "../ui/Toast";

function PageFallback() {
	return (
		<div className="flex flex-1 items-center justify-center text-m-text-3">
			<Spinner size={22} />
		</div>
	);
}

/** Renders the lazy page of the current route. `key` = path so a page never inherits another page's state. */
function RouteView() {
	const route = useRoute();
	if (route.name === "notFound") {
		return <EmptyState title="页面不存在" hint={route.path} />;
	}
	const Page = ROUTES[route.name];
	return (
		<ErrorBoundary resetKey={route.path}>
			<Suspense fallback={<PageFallback />}>
				<Page key={route.path} route={route} />
			</Suspense>
		</ErrorBoundary>
	);
}

export function App() {
	useTheme();
	useEffect(() => installViewportTracking(), []);
	useEffect(() => startSessionsSync(), []);
	return (
		<div className="m-app">
			<ConnectionBanner />
			<main className="m-page">
				<RouteView />
			</main>
			<DialogHost />
			<ToastHost />
			<ImageViewerHost />
		</div>
	);
}
