import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { App } from "../src/app/App";

/**
 * Whole-app smoke tests.
 *
 * These mount the real `App` — real detection, real scratch space, real LSP
 * manager — and assert on rendered frames. They are deliberately coarse: their
 * job is to catch the class of failure that unit tests structurally cannot, i.e.
 * "the thing does not come up at all".
 */

/** Mount App, let async bootstrap settle, and return the setup. */
async function mount(props: Parameters<typeof App>[0] = {}) {
	const setup = await testRender(<App {...props} />, {
		width: 100,
		height: 30,
	});
	// Detection spawns version probes; the first frame paints before they finish,
	// which is the point. Waiting lets the settled UI be asserted on.
	// Wrapped in `act` because bootstrap resolves promises — detection, the file
	// read — that set state after mount.
	await act(async () => {
		await setup.renderOnce();
		await new Promise((resolve) => setTimeout(resolve, 1_500));
	});
	await setup.renderOnce();
	return setup;
}

describe("App", () => {
	test("comes up with a scratch buffer and the run hint", async () => {
		const setup = await mount({ initialLanguage: "typescript" });
		try {
			const frame = setup.captureCharFrame();
			expect(frame).toContain("scratch.ts");
			expect(frame).toContain("ctrl+r to run");
			// The status bar's key hints prove the whole chrome laid out.
			expect(frame).toContain("^R run");
		} finally {
			setup.renderer.destroy();
		}
	}, 20_000);

	test("paints before toolchain detection finishes", async () => {
		// Detection probes dozens of binaries. Blocking first draw on it would make
		// startup feel broken on a machine with many toolchains installed.
		const setup = await testRender(<App initialLanguage="python" />, {
			width: 100,
			height: 30,
		});
		try {
			await act(async () => {
				await setup.renderOnce();
			});
			expect(setup.captureCharFrame().length).toBeGreaterThan(0);
		} finally {
			setup.renderer.destroy();
		}
	}, 20_000);

	test("opens a file given on argv, with the language from its extension", async () => {
		const root = await mkdtemp(join(tmpdir(), "code-repl-app-"));
		const file = join(root, "hello.py");
		await writeFile(file, "print('from a file')\n");

		const setup = await mount({ initialFile: file });
		try {
			const frame = setup.captureCharFrame();
			expect(frame).toContain("hello.py");
			expect(frame).toContain("from a file");
			// Extension-derived language, shown in the status bar.
			expect(frame).toContain("Python");
		} finally {
			setup.renderer.destroy();
			await rm(root, { recursive: true, force: true });
		}
	}, 20_000);

	test("opens a folder given on argv and shows its tree", async () => {
		const root = await mkdtemp(join(tmpdir(), "code-repl-app-"));
		await writeFile(join(root, "alpha.ts"), "");
		await writeFile(join(root, "beta.ts"), "");

		const setup = await mount({ initialFolder: root });
		try {
			const frame = setup.captureCharFrame();
			expect(frame).toContain("alpha.ts");
			expect(frame).toContain("beta.ts");
		} finally {
			setup.renderer.destroy();
			await rm(root, { recursive: true, force: true });
		}
	}, 20_000);

	test("typing in an overlay does not also type into the buffer", async () => {
		// `useKeyboard` is global. A pane left focused behind an overlay still
		// receives every keystroke, so filtering the language picker typed "rust"
		// into the editor as well. Found by driving the real app in a terminal.
		const setup = await mount({ initialLanguage: "python" });
		try {
			await act(async () => {
				await setup.mockInput.pressKey("\u0010"); // ctrl+p
			});
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.typeText("rust");
			});
			await setup.renderOnce();

			const frame = setup.captureCharFrame();
			// The picker filtered...
			expect(frame).toContain("Rust");
			// ...and the buffer is untouched. The popup visually occludes the rest
			// of line 1, so the assertions are on the visible prefix and on the
			// cursor, which the editor would have advanced had it taken the keys.
			expect(frame).toContain('1 print("hello fro');
			expect(frame).toContain("Col 1");
			expect(frame).not.toContain("1 rust");
		} finally {
			setup.renderer.destroy();
		}
	}, 20_000);

	test("survives a terminal too small for the tree pane", async () => {
		// Below the width threshold the tree is dropped rather than squeezing the
		// editor into nothing.
		const setup = await testRender(<App initialLanguage="typescript" />, {
			width: 50,
			height: 16,
		});
		try {
			await act(async () => {
				await setup.renderOnce();
				await new Promise((resolve) => setTimeout(resolve, 1_000));
			});
			await setup.renderOnce();
			expect(setup.captureCharFrame()).toContain("scratch.ts");
		} finally {
			setup.renderer.destroy();
		}
	}, 20_000);
});
