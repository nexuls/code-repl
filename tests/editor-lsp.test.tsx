import { describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { CodeEditor } from "../src/components/CodeEditor";
import {
	CompletionPopup,
	popupHeight,
} from "../src/components/CompletionPopup";
import {
	type CompletionItem,
	CompletionItemKind,
	type Diagnostic,
	DiagnosticSeverity,
} from "../src/core/lsp/protocol";
import { darkTheme } from "../src/lib/theme";

/** Mount an editor and return helpers for driving and inspecting it. */
async function mount(props: Partial<Parameters<typeof CodeEditor>[0]> = {}) {
	const setup = await testRender(
		<CodeEditor width={60} height={14} filename="demo.ts" {...props} />,
		{ width: 60, height: 14 },
	);
	await setup.renderOnce();
	return {
		setup,
		async input(run: () => void | Promise<void>) {
			await act(async () => {
				await run();
			});
			await setup.renderOnce();
		},
		/** Let a completion promise resolve and the popup render. */
		async settle() {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 40));
			});
			await setup.renderOnce();
		},
		frame: () => setup.captureCharFrame(),
	};
}

/**
 * Ctrl+Space as the terminal actually sends it: a NUL byte. Written as an escape
 * rather than a literal, which would make this file binary to grep.
 */
const CTRL_SPACE = "\u0000";

const items: CompletionItem[] = [
	{ label: "console", kind: CompletionItemKind.Variable, detail: "Console" },
	{ label: "constructor", kind: CompletionItemKind.Method },
	{ label: "continue", kind: CompletionItemKind.Keyword },
];

describe("CompletionPopup", () => {
	test("sizes itself to the item count, up to the cap", () => {
		expect(popupHeight(3, 8)).toBe(3);
		expect(popupHeight(30, 8)).toBe(8);
		expect(popupHeight(0, 8)).toBe(0);
	});

	test("renders labels and details", async () => {
		const setup = await testRender(
			<CompletionPopup
				items={items}
				selected={0}
				width={40}
				maxRows={8}
				theme={darkTheme}
				onChoose={() => {}}
			/>,
			{ width: 40, height: 8 },
		);
		try {
			await setup.renderOnce();
			const frame = setup.captureCharFrame();
			expect(frame).toContain("console");
			expect(frame).toContain("Console");
			expect(frame).toContain("constructor");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("keeps a selection below the fold visible", async () => {
		const many = Array.from({ length: 20 }, (_, i) => ({ label: `item${i}` }));
		const setup = await testRender(
			<CompletionPopup
				items={many}
				selected={18}
				width={40}
				maxRows={5}
				theme={darkTheme}
				onChoose={() => {}}
			/>,
			{ width: 40, height: 5 },
		);
		try {
			await setup.renderOnce();
			const frame = setup.captureCharFrame();
			expect(frame).toContain("item18");
			expect(frame).not.toContain("item0 ");
		} finally {
			setup.renderer.destroy();
		}
	});
});

describe("editor completion", () => {
	test("no popup appears when the provider returns nothing", async () => {
		// The common case: a machine with no language server. It must be
		// indistinguishable from having nothing to suggest.
		const { setup, input, settle, frame } = await mount({
			value: "con",
			completionProvider: async () => [],
		});
		try {
			await input(() => setup.mockInput.typeText("s"));
			await settle();
			expect(frame()).not.toContain("console");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("ctrl+space opens the popup", async () => {
		const { setup, input, settle, frame } = await mount({
			value: "con",
			completionProvider: async () => items,
		});
		try {
			await input(() => setup.mockInput.pressKey(CTRL_SPACE));
			await settle();
			expect(frame()).toContain("console");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("typing a dot opens the popup unasked", async () => {
		const { setup, input, settle, frame } = await mount({
			value: "obj",
			completionProvider: async () => items,
		});
		try {
			await input(() => setup.mockInput.typeText("."));
			await settle();
			expect(frame()).toContain("console");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("arrows move through the list instead of the buffer", async () => {
		const { setup, input, settle, frame } = await mount({
			value: "",
			completionProvider: async () => items,
		});
		try {
			await input(() => setup.mockInput.pressKey(CTRL_SPACE));
			await settle();
			await input(() => setup.mockInput.pressKey(KeyCodes.ARROW_DOWN));

			// The cursor must not have left line 1 — the popup consumed the key.
			expect(frame()).toContain("Ln 1/1");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("accepting replaces the partial word rather than appending to it", async () => {
		// The bug this guards: inserting at the cursor turns "con" + "console"
		// into "conconsole".
		const texts: string[] = [];
		const { setup, input, settle } = await mount({
			value: "con",
			completionProvider: async () => items,
			onChange: (text) => texts.push(text),
		});
		try {
			// Move to the end of "con" first.
			await input(() => setup.mockInput.pressKey(KeyCodes.END));
			await input(() => setup.mockInput.pressKey(CTRL_SPACE));
			await settle();
			await input(() => setup.mockInput.pressKey(KeyCodes.RETURN));
			await settle();

			expect(texts[texts.length - 1]).toBe("console");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("prefers insertText and textEdit over the display label", async () => {
		const texts: string[] = [];
		const { setup, input, settle } = await mount({
			value: "",
			completionProvider: async () => [
				{ label: "log (method)", insertText: "log" },
			],
			onChange: (text) => texts.push(text),
		});
		try {
			await input(() => setup.mockInput.pressKey(CTRL_SPACE));
			await settle();
			await input(() => setup.mockInput.pressKey(KeyCodes.RETURN));
			await settle();
			expect(texts[texts.length - 1]).toBe("log");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("escape dismisses without inserting", async () => {
		const texts: string[] = [];
		const { setup, input, settle, frame } = await mount({
			value: "",
			completionProvider: async () => items,
			onChange: (text) => texts.push(text),
		});
		try {
			await input(() => setup.mockInput.pressKey(CTRL_SPACE));
			await settle();
			expect(frame()).toContain("console");

			await input(async () => {
				await setup.mockInput.pressKey(KeyCodes.ESCAPE);
				// A lone ESC is held briefly while the parser rules out a sequence.
				await new Promise((resolve) => setTimeout(resolve, 100));
			});
			expect(frame()).not.toContain("constructor");
			expect(texts.join("")).toBe("");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("a stale response cannot reopen the popup", async () => {
		// A slow provider answering for a position the cursor has already left must
		// be discarded, or the popup flickers back under an old prefix.
		let resolveFirst: ((value: CompletionItem[]) => void) | undefined;
		let call = 0;
		const { setup, input, settle, frame } = await mount({
			value: "",
			completionProvider: () => {
				call += 1;
				if (call === 1) {
					return new Promise<CompletionItem[]>((resolve) => {
						resolveFirst = resolve;
					});
				}
				return Promise.resolve([]);
			},
		});
		try {
			await input(() => setup.mockInput.pressKey(CTRL_SPACE));
			// Second request supersedes the first, and returns empty.
			await input(() => setup.mockInput.pressKey(CTRL_SPACE));
			await settle();

			// Now the first, stale request finally answers.
			await act(async () => {
				resolveFirst?.(items);
				await new Promise((resolve) => setTimeout(resolve, 40));
			});
			await setup.renderOnce();

			expect(frame()).not.toContain("constructor");
		} finally {
			setup.renderer.destroy();
		}
	});
});

describe("editor diagnostics", () => {
	const error: Diagnostic = {
		range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
		severity: DiagnosticSeverity.Error,
		message: "Cannot find name 'foo'",
		source: "ts",
	};

	test("shows the message for the diagnostic under the cursor", async () => {
		const { setup, frame } = await mount({
			value: "const foo = 1",
			diagnostics: [error],
		});
		try {
			// The cursor starts at 0,0, which is outside the range — the line's
			// diagnostic is still the useful thing to show.
			expect(frame()).toContain("Cannot find name");
			expect(frame()).toContain("ts:");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("marks the gutter without widening it", async () => {
		const clean = await mount({ value: "const foo = 1" });
		const cleanFrame = clean.frame();
		clean.setup.renderer.destroy();

		const marked = await mount({
			value: "const foo = 1",
			diagnostics: [error],
		});
		try {
			const frame = marked.frame();
			expect(frame).toContain("✖");
			// The code must start in the same column in both, or a diagnostic
			// appearing would reflow the whole document sideways.
			const codeColumn = (f: string) =>
				f
					.split("\n")
					.find((l) => l.includes("const"))
					?.indexOf("const");
			expect(codeColumn(frame)).toBe(codeColumn(cleanFrame));
		} finally {
			marked.setup.renderer.destroy();
		}
	});

	test("a warning is marked differently from an error", async () => {
		const { setup, frame } = await mount({
			value: "const foo = 1",
			diagnostics: [{ ...error, severity: DiagnosticSeverity.Warning }],
		});
		try {
			expect(frame()).toContain("▲");
			expect(frame()).not.toContain("✖");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("the most severe diagnostic on a line wins the gutter", async () => {
		const { setup, frame } = await mount({
			value: "const foo = 1",
			diagnostics: [
				{ ...error, severity: DiagnosticSeverity.Hint, message: "hint" },
				error,
			],
		});
		try {
			expect(frame()).toContain("✖");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("a multi-line diagnostic marks every line it spans", async () => {
		const { setup, frame } = await mount({
			value: "const a = {\n  b: 1,\n}",
			diagnostics: [
				{
					range: {
						start: { line: 0, character: 0 },
						end: { line: 2, character: 1 },
					},
					severity: DiagnosticSeverity.Error,
					message: "spans lines",
				},
			],
		});
		try {
			// Three marks: one per covered line.
			expect(frame().split("✖").length - 1).toBe(3);
		} finally {
			setup.renderer.destroy();
		}
	});

	test("a multi-line message is flattened to fit one footer row", async () => {
		const { setup, frame } = await mount({
			value: "x",
			diagnostics: [
				{
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 1 },
					},
					message: "first line\nsecond line",
				},
			],
		});
		try {
			expect(frame()).toContain("first line second line");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("no diagnostics means the ordinary status line", async () => {
		const { setup, frame } = await mount({ value: "const a = 1" });
		try {
			expect(frame()).toContain("Ln 1/1");
		} finally {
			setup.renderer.destroy();
		}
	});
});

describe("editor mouse", () => {
	test("a click moves the cursor to the clicked cell", async () => {
		const { setup, frame } = await mount({ value: "const a = 1\nlet b = 2" });
		try {
			// Row 2 of the editor box is document line 2; the gutter is 3 cells wide
			// plus the border, so column 8 lands mid-line.
			await act(async () => {
				await setup.mockMouse.click(8, 2);
			});
			await setup.renderOnce();
			expect(frame()).toContain("Ln 2/2");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("clicking past the end of a line lands at its end", async () => {
		const { setup, frame } = await mount({ value: "ab\nlonger line here" });
		try {
			await act(async () => {
				await setup.mockMouse.click(50, 1);
			});
			await setup.renderOnce();
			// "ab" is two characters, so the cursor stops at column 3 (1-based).
			expect(frame()).toContain("Col 3");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("the wheel scrolls the viewport", async () => {
		const value = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
		const { setup, frame } = await mount({ value });
		try {
			expect(frame()).toContain("line 0");
			await act(async () => {
				await setup.mockMouse.scroll(10, 5, "down");
			});
			await setup.renderOnce();
			expect(frame()).not.toContain("line 0 ");
		} finally {
			setup.renderer.destroy();
		}
	});
});
