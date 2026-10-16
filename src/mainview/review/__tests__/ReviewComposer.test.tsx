import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../../i18n";
import { ReviewComposer } from "../ReviewComposer";

const platform = vi.hoisted(() => ({ mac: true }));
vi.mock("../../utils/platform", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../utils/platform")>()),
	isMac: () => platform.mac,
}));

const PLACEHOLDER = "Leave a comment on this line...";

function renderComposer() {
	const onSubmit = vi.fn();
	const onSubmitAndSend = vi.fn();
	render(
		<I18nProvider>
			<ReviewComposer anchorLabel="a.ts · line 1" onCancel={vi.fn()} onSubmit={onSubmit} onSubmitAndSend={onSubmitAndSend} />
		</I18nProvider>,
	);
	return { onSubmit, onSubmitAndSend, input: screen.getByPlaceholderText(PLACEHOLDER) as HTMLTextAreaElement };
}

describe.each([
	{ name: "macOS", mac: true, combo: "{Meta>}{Enter}{/Meta}", label: "⌘Enter" },
	{ name: "other platforms", mac: false, combo: "{Control>}{Enter}{/Control}", label: "Ctrl+Enter" },
])("ReviewComposer send shortcut on $name", ({ mac, combo, label }) => {
	beforeEach(() => {
		platform.mac = mac;
	});

	it("sends the trimmed text now and clears the field", async () => {
		const user = userEvent.setup();
		const { onSubmit, onSubmitAndSend, input } = renderComposer();
		await user.type(input, "  Rename this  ");
		await user.keyboard(combo);

		expect(onSubmitAndSend).toHaveBeenCalledTimes(1);
		expect(onSubmitAndSend).toHaveBeenCalledWith("Rename this");
		expect(onSubmit).not.toHaveBeenCalled();
		expect(input.value).toBe("");
	});

	it("sends nothing for empty or whitespace-only text", async () => {
		const user = userEvent.setup();
		const { onSubmit, onSubmitAndSend, input } = renderComposer();
		await user.click(input);
		await user.keyboard(combo);
		await user.type(input, "   ");
		await user.keyboard(combo);

		expect(onSubmitAndSend).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("names the combo in the Send now tooltip", () => {
		renderComposer();
		expect(screen.getByTestId("inline-comment-composer-send").title).toContain(`(${label})`);
	});

	it("keeps plain Enter as a newline", async () => {
		const user = userEvent.setup();
		const { onSubmit, onSubmitAndSend, input } = renderComposer();
		await user.type(input, "one{Enter}two");

		expect(input.value).toBe("one\ntwo");
		expect(onSubmitAndSend).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
