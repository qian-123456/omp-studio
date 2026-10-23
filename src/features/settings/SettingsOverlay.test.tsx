// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimEscape } from "../../lib/escapeClaim";
import { useEscapeKey } from "../../lib/hooks";
import { useUi } from "../../stores/ui";
import { SettingsOverlay } from "./SettingsOverlay";

function Nested({ onClose }: { onClose: () => void }) {
	useEscapeKey(onClose);
	return createPortal(
		<div role="dialog" aria-modal="true" aria-label="nested">
			<button type="button">inner</button>
		</div>,
		document.body,
	);
}

let nestedClose = vi.fn();
let withNested = true;
vi.mock("./SettingsPage", () => ({
	SettingsPage: () => (withNested ? <Nested onClose={nestedClose} /> : null),
}));

afterEach(cleanup);

describe("SettingsOverlay Esc", () => {
	beforeEach(() => {
		nestedClose = vi.fn();
		withNested = true;
		useUi.setState({ centerView: "settings" });
	});

	it("Esc inside a nested dialog does not close settings", () => {
		render(<SettingsOverlay />);
		fireEvent.keyDown(screen.getByRole("button", { name: "inner" }), { key: "Escape" });
		expect(useUi.getState().centerView).toBe("settings");
		expect(nestedClose).toHaveBeenCalledTimes(1);
	});

	it("Esc a nested dialog already handled (and unmounted) does not also close settings", () => {
		render(<SettingsOverlay />);
		// The nested surface's listener runs first and its dialog no longer counts as
		// open by the time the settings listener sees the event (React flushed the unmount).
		const first = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			claimEscape(e);
			screen.getByRole("dialog", { name: "nested" }).setAttribute("aria-modal", "false");
		};
		window.addEventListener("keydown", first, true);
		try {
			fireEvent.keyDown(document.body, { key: "Escape" });
		} finally {
			window.removeEventListener("keydown", first, true);
		}
		expect(useUi.getState().centerView).toBe("settings");
	});

	it("Esc with nothing nested closes settings", () => {
		withNested = false;
		render(<SettingsOverlay />);
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(useUi.getState().centerView).not.toBe("settings");
	});
});
