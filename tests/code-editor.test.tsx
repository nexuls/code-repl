import { expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { CodeEditor } from "../src/components/CodeEditor";

async function mount(props: Partial<Parameters<typeof CodeEditor>[0]> = {}) {
	const setup = await testRender(<CodeEditor width={40} height={12} filename="demo.ts" {...props} />, {
		width: 40,
		height: 12,
	});
	await setup.renderOnce();
	return {
		setup,
		async input(run: () => void) {
			await act(async () => run());
			await setup.renderOnce();
		},
		frame: () => setup.captureCharFrame(),
	};
}

test("renders a line-number gutter beside the source", async () => {
	const { setup, frame } = await mount({ value: "const a = 1\nconst b = 2" });
	try {
		expect(frame()).toContain("1 const a = 1");
		expect(frame()).toContain("2 const b = 2");
	} finally {
		setup.renderer.destroy();
	}
});

test("typing inserts text and reports the cursor position", async () => {
	const { setup, input, frame } = await mount({ value: "let x" });
	try {
		await input(() => {
			setup.mockInput.pressKey(KeyCodes.END);
			setup.mockInput.typeText(" = 7");
		});
		expect(frame()).toContain("let x = 7");
		expect(frame()).toContain("Ln 1/1, Col 10");
	} finally {
		setup.renderer.destroy();
	}
});

test("enter splits the line and keeps the indentation", async () => {
	const { setup, input, frame } = await mount({ value: "  call()" });
	try {
		await input(() => {
			setup.mockInput.pressKey(KeyCodes.END);
			setup.mockInput.pressEnter();
			setup.mockInput.typeText("next()");
		});
		expect(frame()).toContain("2   next()");
		expect(frame()).toContain("Ln 2/2");
	} finally {
		setup.renderer.destroy();
	}
});

test("backspace at column zero joins with the previous line", async () => {
	const { setup, input, frame } = await mount({ value: "one\ntwo" });
	try {
		await input(() => {
			setup.mockInput.pressKey(KeyCodes.ARROW_DOWN);
			setup.mockInput.pressKey("\x1b[H"); // home
			setup.mockInput.pressBackspace();
		});
		expect(frame()).toContain("1 onetwo");
		expect(frame()).not.toContain("2 two");
	} finally {
		setup.renderer.destroy();
	}
});

test("ctrl+z undoes an edit", async () => {
	const { setup, input, frame } = await mount({ value: "keep" });
	try {
		await input(() => {
			setup.mockInput.pressKey(KeyCodes.END);
			setup.mockInput.typeText("!");
		});
		expect(frame()).toContain("keep!");
		await input(() => setup.mockInput.pressKey("z", { ctrl: true }));
		expect(frame()).toContain("keep");
		expect(frame()).not.toContain("keep!");
	} finally {
		setup.renderer.destroy();
	}
});

test("ctrl+k deletes the current line and ctrl+d duplicates it", async () => {
	const { setup, input, frame } = await mount({ value: "alpha\nbeta\ngamma" });
	try {
		await input(() => setup.mockInput.pressKey("k", { ctrl: true }));
		expect(frame()).toContain("1 beta");
		await input(() => setup.mockInput.pressKey("d", { ctrl: true }));
		expect(frame()).toContain("2 beta");
	} finally {
		setup.renderer.destroy();
	}
});

test("scrolls vertically to follow the cursor", async () => {
	const value = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n");
	const { setup, input, frame } = await mount({ value });
	try {
		expect(frame()).toContain("1 line1");
		await input(() => {
			for (let i = 0; i < 30; i++) setup.mockInput.pressKey(KeyCodes.ARROW_DOWN);
		});
		expect(frame()).not.toContain(" 1 line1");
		expect(frame()).toContain("31 line31");
		expect(frame()).toContain("Ln 31/60");
	} finally {
		setup.renderer.destroy();
	}
});

test("readOnly rejects edits", async () => {
	const { setup, input, frame } = await mount({ value: "frozen", readOnly: true });
	try {
		await input(() => setup.mockInput.typeText("xyz"));
		expect(frame()).toContain("frozen");
		expect(frame()).not.toContain("xyzfrozen");
		expect(frame()).toContain("READ-ONLY");
	} finally {
		setup.renderer.destroy();
	}
});

test("reports edits through onChange", async () => {
	let latest = "";
	const { setup, input } = await mount({ value: "a", onChange: (text) => (latest = text) });
	try {
		await input(() => {
			setup.mockInput.pressKey(KeyCodes.END);
			setup.mockInput.pressEnter();
			setup.mockInput.typeText("b");
		});
		expect(latest).toBe("a\nb");
	} finally {
		setup.renderer.destroy();
	}
});

test("applies distinct colours to keywords, strings, and comments", async () => {
	const { setup } = await mount({ value: `const s = "hi" // note` });
	try {
		const spans = (setup.captureSpans().lines[1] as { spans: { text: string; fg: unknown }[] }).spans;
		const colorOf = (needle: string) =>
			JSON.stringify(spans.find((span) => span.text.includes(needle))?.fg);
		// The cursor sits on the first character, so match on the tail of "const".
		expect(colorOf("onst")).toBeDefined();
		expect(colorOf("onst")).not.toBe(colorOf("hi"));
		expect(colorOf("// note")).not.toBe(colorOf("onst"));
	} finally {
		setup.renderer.destroy();
	}
});
