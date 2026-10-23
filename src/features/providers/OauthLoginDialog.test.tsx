// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { onProvidersOauth, oauthLoginProviders, oauthLoginStart } = vi.hoisted(() => ({
	onProvidersOauth: vi.fn(),
	oauthLoginProviders: vi.fn(),
	oauthLoginStart: vi.fn(),
}));

vi.mock("../../lib/events", () => ({ onProvidersOauth }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: vi.fn(), errMsg: (e: unknown) => String(e) }));
vi.mock("../../lib/ipc", () => ({
	oauthLoginCancel: vi.fn(async () => {}),
	oauthLoginOpenUrl: vi.fn(),
	oauthLoginProviders,
	oauthLoginRespond: vi.fn(),
	oauthLoginStart,
	oauthLoginStatus: vi.fn(async () => null),
}));
vi.mock("../settings/sections/ProviderBrandLogo", () => ({ ProviderBrandLogo: () => null }));

import { OauthLoginDialog } from "./OauthLoginDialog";

afterEach(cleanup);

describe("OauthLoginDialog listener registration", () => {
	it("unlistens when the dialog unmounts before onProvidersOauth resolves", async () => {
		const unlisten = vi.fn();
		let resolveListen: (fn: () => void) => void = () => {};
		onProvidersOauth.mockReturnValue(new Promise<() => void>((r) => (resolveListen = r)));
		oauthLoginProviders.mockResolvedValue([
			{ id: "p1", name: "Provider One", available: true },
		]);
		oauthLoginStart.mockResolvedValue(undefined);

		const { unmount } = render(<OauthLoginDialog onClose={() => {}} initialProviderId="p1" />);
		await waitFor(() => expect(onProvidersOauth).toHaveBeenCalled());
		unmount();
		await act(async () => {
			resolveListen(unlisten);
		});
		expect(unlisten).toHaveBeenCalledTimes(1);
		expect(oauthLoginStart).not.toHaveBeenCalled();
		expect(screen.queryByText("上一步")).toBeNull();
	});
});
