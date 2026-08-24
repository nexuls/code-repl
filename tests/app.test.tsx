import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyCodes } from "@opentui/core/testing";
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

/**
 * Renderer options matching production.
 *
 * `exitOnCtrlC` is the one that matters: the default is on, so a test pressing
 * ctrl+c tears the renderer down at the OpenTUI level before the app ever sees
 * the key, and every later assertion reads an empty frame. `index.tsx` sets it
 * false because the app owns its own exit path.
 */
const RENDERER = { width: 100, height: 30, exitOnCtrlC: false } as const;

/** Control keys as the terminal sends them. */
const CTRL_S = "\u0013";
const CTRL_C = "\u0003";
const CTRL_P = "\u0010";

/** Mount App, let async bootstrap settle, and return the setup. */
async function mount(props: Parameters<typeof App>[0] = {}) {
	const setup = await testRender(<App {...props} />, RENDERER);
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
				await setup.mockInput.pressKey(CTRL_P);
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

	test("ctrl+s on a scratch buffer asks for a name and writes the file", async () => {
		// ctrl+s is advertised in the status bar and the help overlay, so it has to
		// do something for a buffer with no path — which is most of them in a REPL.
		const root = await mkdtemp(join(tmpdir(), "code-repl-saveas-"));
		const setup = await mount({
			initialFolder: root,
			initialLanguage: "python",
		});
		try {
			await act(async () => {
				await setup.mockInput.pressKey(CTRL_S);
			});
			await setup.renderOnce();
			expect(setup.captureCharFrame()).toContain("save as");

			// The prompt starts with the buffer's current name; clear it first.
			await act(async () => {
				for (let i = 0; i < "scratch.py".length; i++) {
					await setup.mockInput.pressBackspace();
				}
				await setup.mockInput.typeText("named.py");
			});
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.RETURN);
				await new Promise((resolve) => setTimeout(resolve, 400));
			});
			await setup.renderOnce();

			// Written to the opened folder, with the tab renamed and marked clean.
			expect(await Bun.file(join(root, "named.py")).text()).toContain("hello");
			const frame = setup.captureCharFrame();
			expect(frame).toContain("named.py");
			expect(frame).toContain("saved");
			expect(frame).not.toContain("named.py •");
		} finally {
			setup.renderer.destroy();
			await rm(root, { recursive: true, force: true });
		}
	}, 20_000);

	test("save-as refuses to overwrite an existing file", async () => {
		// Every scratch buffer offers the same default name, so accepting it twice
		// would silently destroy the first. There is no undo for that.
		const root = await mkdtemp(join(tmpdir(), "code-repl-saveas-"));
		await writeFile(join(root, "taken.py"), "precious\n");
		const setup = await mount({
			initialFolder: root,
			initialLanguage: "python",
		});
		try {
			await act(async () => {
				await setup.mockInput.pressKey(CTRL_S);
			});
			await setup.renderOnce();
			await act(async () => {
				for (let i = 0; i < "scratch.py".length; i++) {
					await setup.mockInput.pressBackspace();
				}
				await setup.mockInput.typeText("taken.py");
			});
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.RETURN);
				await new Promise((resolve) => setTimeout(resolve, 400));
			});
			await setup.renderOnce();

			expect(await Bun.file(join(root, "taken.py")).text()).toBe("precious\n");
			expect(setup.captureCharFrame()).toContain("already exists");
		} finally {
			setup.renderer.destroy();
			await rm(root, { recursive: true, force: true });
		}
	}, 20_000);

	test("save-as adopts the language implied by the chosen name", async () => {
		// Saving a Python scratch as notes.md must stop running it as Python.
		const root = await mkdtemp(join(tmpdir(), "code-repl-saveas-"));
		const setup = await mount({
			initialFolder: root,
			initialLanguage: "python",
		});
		try {
			await act(async () => {
				await setup.mockInput.pressKey(CTRL_S);
			});
			await setup.renderOnce();
			await act(async () => {
				for (let i = 0; i < "scratch.py".length; i++) {
					await setup.mockInput.pressBackspace();
				}
				await setup.mockInput.typeText("script.lua");
			});
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.RETURN);
				await new Promise((resolve) => setTimeout(resolve, 400));
			});
			await setup.renderOnce();

			const frame = setup.captureCharFrame();
			expect(frame).toContain("script.lua");
			// Both the status bar and the editor's mode line follow the new
			// language. (The buffer text still says "hello from Python" — that is
			// the Python template's greeting, which saving does not rewrite.)
			expect(frame).toContain(" Lua ");
			expect(frame).toContain("INSERT  lua");
		} finally {
			setup.renderer.destroy();
			await rm(root, { recursive: true, force: true });
		}
	}, 20_000);

	test("a saved file appears in the tree without a restart", async () => {
		const root = await mkdtemp(join(tmpdir(), "code-repl-saveas-"));
		await writeFile(join(root, "existing.py"), "");
		const setup = await mount({
			initialFolder: root,
			initialLanguage: "python",
		});
		try {
			expect(setup.captureCharFrame()).not.toContain("fresh.py");

			await act(async () => {
				await setup.mockInput.pressKey(CTRL_S);
			});
			await setup.renderOnce();
			await act(async () => {
				for (let i = 0; i < "scratch.py".length; i++) {
					await setup.mockInput.pressBackspace();
				}
				await setup.mockInput.typeText("fresh.py");
			});
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.RETURN);
				await new Promise((resolve) => setTimeout(resolve, 600));
			});
			await setup.renderOnce();

			expect(setup.captureCharFrame()).toContain("fresh.py");
		} finally {
			setup.renderer.destroy();
			await rm(root, { recursive: true, force: true });
		}
	}, 20_000);

	test("ctrl+c dismisses an overlay instead of quitting", async () => {
		// Ctrl+C in a prompt means "cancel this", and the buffer that opened the
		// save prompt is dirty by definition — exiting on it would discard the very
		// work the prompt exists to keep. A second press, with nothing open, goes
		// through the usual confirmation.
		const setup = await mount({ initialLanguage: "python" });
		try {
			await act(async () => {
				await setup.mockInput.pressKey(CTRL_S);
			});
			await setup.renderOnce();
			expect(setup.captureCharFrame()).toContain("save as");

			await act(async () => {
				await setup.mockInput.pressKey(CTRL_C);
			});
			await setup.renderOnce();
			const dismissed = setup.captureCharFrame();
			expect(dismissed).not.toContain("save as");
			// Still running, with the buffer intact.
			expect(dismissed).toContain("scratch.py");

			await act(async () => {
				await setup.mockInput.pressKey(CTRL_C);
			});
			await setup.renderOnce();
			expect(setup.captureCharFrame()).toContain("unsaved changes");
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
