// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SectionJumpBar } from "./SectionJumpBar";

function Page({ count }: { count: number }) {
	const [extra, setExtra] = useState(false);
	return (
		<div>
			<button type="button" onClick={() => setExtra(true)}>
				mount-late
			</button>
			<SectionJumpBar />
			{Array.from({ length: count }, (_, i) => (
				<section key={i} data-jump={`区块${i}`} />
			))}
			{extra && <section data-jump="迟到区块" />}
		</div>
	);
}

describe("SectionJumpBar", () => {
	afterEach(cleanup);

	it("stays empty below four anchors and shows chips from four", () => {
		const { unmount } = render(<Page count={3} />);
		expect(screen.queryByRole("button", { name: "区块0" })).toBeNull();
		unmount();
		render(<Page count={4} />);
		expect(screen.getAllByRole("button", { name: /^区块/ })).toHaveLength(4);
	});

	it("picks up anchors that mount after the first render and scrolls to the clicked one", async () => {
		const scroll = vi.fn();
		Element.prototype.scrollIntoView = scroll;
		render(<Page count={3} />);
		fireEvent.click(screen.getByText("mount-late"));
		const chip = await screen.findByRole("button", { name: "迟到区块" });
		fireEvent.click(chip);
		expect(scroll).toHaveBeenCalledTimes(1);
		expect((scroll.mock.instances[0] as HTMLElement).getAttribute("data-jump")).toBe("迟到区块");
	});
});
